# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Workflow Engine Service - Manages workflow definitions and executions.

This service orchestrates multi-step alert processing workflows using a
state-machine pattern.  It supports:

- Multiple workflow types (alert-processing, incident-response)
- Step types: activity, human_task, decision, notification, automation
- Built-in correlation analysis with attack chain auto-escalation
- Step-level retry with configurable backoff
- Human task creation with workflow pause/resume
- Decision branching with expression evaluation
- Notification dispatch for workflow lifecycle events
- Automation trigger for SOAR playbook execution
- Execution timeout monitoring
- Step result aggregation across the full workflow
- Database persistence for workflows and executions
- Audit logging for all workflow actions
- SLA management with breach detection and escalation
- Smart task assignment (skill-based / load-balanced)
- Approval workflow for high-risk automation
"""

import asyncio
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from shared.correlation import CorrelationEngine
from shared.database import DatabaseManager, get_database_manager
from shared.database.models import AuditLog
from shared.database.repositories.workflow_repository import WorkflowRepository
from shared.errors import WorkflowError
from shared.messaging import MessageConsumer, MessagePublisher
from shared.metrics import (
    ATTACK_CHAINS_DETECTED,
    CORRELATIONS_PERFORMED,
    INCIDENT_RESPONSES_TRIGGERED,
    WORKFLOWS_COMPLETED,
    WORKFLOWS_STARTED,
    MetricsCollector,
)
from shared.models import (
    HumanTask,
    ResponseMeta,
    SuccessResponse,
    TaskPriority,
    TaskStatus,
    WorkflowDefinition,
    WorkflowExecution,
    WorkflowStatus,
)
from shared.utils import Config, get_logger
from shared.utils.prometheus import setup_prometheus

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
publisher: MessagePublisher = None
consumer: MessageConsumer = None

# In-memory caches (backed by database for persistence)
active_executions: Dict[str, WorkflowExecution] = {}
workflow_definitions: Dict[str, WorkflowDefinition] = {}

# Human tasks awaiting completion (task_id -> HumanTask)
pending_tasks: Dict[str, HumanTask] = {}

# Step results accumulated per execution (execution_id -> {step_name: result})
execution_step_results: Dict[str, Dict[str, Any]] = {}

# Recent alerts cache for correlation (bounded ring buffer)
recent_alerts_cache: List[Dict[str, Any]] = []
MAX_RECENT_ALERTS = 200
_cache_lock = asyncio.Lock()
metrics = MetricsCollector("workflow_engine")

# Events used to resume workflows paused on human tasks
_resume_events: Dict[str, asyncio.Event] = {}

# ---------------------------------------------------------------------------
# State Machine - Valid Transitions
# ---------------------------------------------------------------------------

VALID_WORKFLOW_TRANSITIONS: Dict[str, List[str]] = {
    WorkflowStatus.PENDING: [WorkflowStatus.RUNNING, WorkflowStatus.CANCELLED],
    WorkflowStatus.RUNNING: [
        WorkflowStatus.COMPLETED,
        WorkflowStatus.FAILED,
        WorkflowStatus.CANCELLED,
        WorkflowStatus.TIMED_OUT,
    ],
    WorkflowStatus.COMPLETED: [],  # terminal
    WorkflowStatus.FAILED: [WorkflowStatus.PENDING],  # allow retry
    WorkflowStatus.CANCELLED: [],  # terminal
    WorkflowStatus.TIMED_OUT: [WorkflowStatus.PENDING],  # allow retry
}

VALID_TASK_TRANSITIONS: Dict[str, List[str]] = {
    TaskStatus.PENDING: [
        TaskStatus.ASSIGNED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.SKIPPED,
        TaskStatus.CANCELLED,
    ],
    TaskStatus.ASSIGNED: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
    TaskStatus.IN_PROGRESS: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED],
    TaskStatus.COMPLETED: [],  # terminal
    TaskStatus.FAILED: [TaskStatus.PENDING],  # allow retry
    TaskStatus.SKIPPED: [],  # terminal
    TaskStatus.CANCELLED: [],  # terminal
}


def validate_workflow_transition(current: WorkflowStatus, target: WorkflowStatus) -> bool:
    """
    Validate that a workflow status transition is allowed.

    Args:
        current: Current workflow status
        target: Target workflow status

    Returns:
        True if transition is valid

    Raises:
        ValueError: If transition is invalid
    """
    allowed = VALID_WORKFLOW_TRANSITIONS.get(current, [])
    if target not in allowed:
        raise ValueError(
            f"Invalid workflow transition: {current.value} -> {target.value}. "
            f"Allowed: {[s.value for s in allowed]}"
        )
    return True


def validate_task_transition(current: TaskStatus, target: TaskStatus) -> bool:
    """
    Validate that a task status transition is allowed.

    Args:
        current: Current task status
        target: Target task status

    Returns:
        True if transition is valid

    Raises:
        ValueError: If transition is invalid
    """
    allowed = VALID_TASK_TRANSITIONS.get(current, [])
    if target not in allowed:
        raise ValueError(
            f"Invalid task transition: {current.value} -> {target.value}. "
            f"Allowed: {[s.value for s in allowed]}"
        )
    return True


async def transition_workflow_status(
    execution: WorkflowExecution,
    new_status: WorkflowStatus,
    reason: str = "",
) -> None:
    """
    Transition workflow to a new status with validation and audit logging.

    Args:
        execution: Workflow execution to transition
        new_status: Target status
        reason: Reason for transition
    """
    old_status = execution.status
    validate_workflow_transition(old_status, new_status)
    execution.status = new_status
    if new_status in (
        WorkflowStatus.COMPLETED,
        WorkflowStatus.FAILED,
        WorkflowStatus.CANCELLED,
        WorkflowStatus.TIMED_OUT,
    ):
        execution.completed_at = datetime.utcnow()
    logger.info(
        f"Workflow {execution.execution_id} transitioned: {old_status.value} -> {new_status.value}",
        extra={"execution_id": execution.execution_id, "reason": reason},
    )


# ---------------------------------------------------------------------------
# SLA Configuration
# ---------------------------------------------------------------------------

SLA_CONFIG: Dict[str, Dict[str, int]] = {
    "critical": {"response_minutes": 15, "resolve_minutes": 60},
    "high": {"response_minutes": 30, "resolve_minutes": 120},
    "medium": {"response_minutes": 60, "resolve_minutes": 480},
    "low": {"response_minutes": 120, "resolve_minutes": 1440},
}


# ---------------------------------------------------------------------------
# Analyst pool for smart task assignment
# ---------------------------------------------------------------------------

ANALYST_POOL: List[Dict[str, Any]] = [
    {
        "id": "analyst-1",
        "name": "Analyst 1",
        "skills": ["malware", "phishing", "incident_response"],
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
    {
        "id": "analyst-2",
        "name": "Analyst 2",
        "skills": ["brute_force", "data_exfiltration", "anomaly"],
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
    {
        "id": "analyst-3",
        "name": "Analyst 3",
        "skills": ["malware", "brute_force", "phishing", "incident_response"],
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
]


# ---------------------------------------------------------------------------
# Approval tracking for high-risk automation
# ---------------------------------------------------------------------------

pending_approvals: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# API request models
# ---------------------------------------------------------------------------


class WorkflowUpdateRequest(BaseModel):
    """Request model for updating a workflow definition."""

    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    steps: Optional[list[dict[str, Any]]] = None
    timeout_seconds: Optional[int] = Field(default=None, ge=0)
    status: Optional[str] = Field(default=None, pattern=r"^(draft|active|disabled)$")


class TaskCompleteRequest(BaseModel):
    """Request model for completing a human task."""

    output_data: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class ApprovalRequest(BaseModel):
    """Request model for approving/rejecting automation."""

    approved: bool
    approver: str
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Default workflow definitions
# ---------------------------------------------------------------------------

DEFAULT_WORKFLOWS = {
    "alert-processing": WorkflowDefinition(
        workflow_id="alert-processing",
        name="Alert Processing Workflow",
        description="Standard workflow for processing security alerts",
        version="1.0.0",
        steps=[
            {
                "name": "enrich",
                "type": "activity",
                "description": "Enrich alert with context",
                "service": "context_collector",
                "retry": {"max_attempts": 3, "backoff_seconds": 2},
            },
            {
                "name": "analyze",
                "type": "activity",
                "description": "AI triage analysis",
                "service": "ai_triage_agent",
                "retry": {"max_attempts": 2, "backoff_seconds": 5},
            },
            {
                "name": "correlate",
                "type": "activity",
                "description": "Correlate alert with recent alerts for attack chain detection",
                "service": "correlation",
            },
            {
                "name": "auto_response",
                "type": "decision",
                "description": "Check if auto-response is needed",
                "condition": "risk_level in ('CRITICAL', 'HIGH')",
                "on_true": "trigger_automation",
                "on_false": "human_review",
            },
            {
                "name": "trigger_automation",
                "type": "automation",
                "description": "Trigger automation playbook for high-risk alerts",
                "playbook_selector": "by_alert_type",
            },
            {
                "name": "notify_team",
                "type": "notification",
                "description": "Notify security team of results",
                "channels": ["security-team"],
                "template": "workflow_completed",
            },
            {
                "name": "human_review",
                "type": "human_task",
                "description": "Security analyst review",
                "assignee": "security-team",
                "priority": "medium",
            },
        ],
        timeout_seconds=3600,
        retry_policy={"max_attempts": 3, "backoff_seconds": 2},
    ),
    "incident-response": WorkflowDefinition(
        workflow_id="incident-response",
        name="Incident Response Workflow",
        description="Workflow for handling security incidents",
        version="1.0.0",
        steps=[
            {
                "name": "assess",
                "type": "activity",
                "description": "Initial incident assessment",
                "service": "ai_triage_agent",
                "retry": {"max_attempts": 2, "backoff_seconds": 3},
            },
            {
                "name": "contain",
                "type": "automation",
                "description": "Contain the threat via automation",
                "playbook_selector": "by_alert_type",
            },
            {
                "name": "notify_escalation",
                "type": "notification",
                "description": "Notify incident response team",
                "channels": ["incident-response-team", "management"],
                "template": "incident_escalation",
            },
            {
                "name": "eradicate",
                "type": "human_task",
                "description": "Manual threat eradication by IR team",
                "assignee": "incident-response-team",
                "priority": "critical",
            },
            {
                "name": "recover",
                "type": "activity",
                "description": "Recover systems",
                "service": "context_collector",
            },
        ],
        timeout_seconds=7200,
    ),
}


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------


async def audit_log(
    event_type: str,
    action: str,
    target_type: str = "workflow",
    target_id: Optional[str] = None,
    actor_id: str = "system",
    details: Optional[Dict[str, Any]] = None,
    old_values: Optional[Dict[str, Any]] = None,
    new_values: Optional[Dict[str, Any]] = None,
    status: str = "success",
    error_message: Optional[str] = None,
) -> None:
    """
    Record an audit log entry for a workflow action.

    Args:
        event_type: Type of event (e.g. workflow.created, task.completed)
        action: Action performed (e.g. create, update, delete)
        target_type: Type of target object (workflow, execution, task)
        target_id: Identifier of the target object
        actor_id: Who performed the action
        details: Additional event details
        old_values: Previous values (for updates)
        new_values: New values (for updates)
        status: Result status (success/failure)
        error_message: Error message if failed
    """
    if not db_manager:
        logger.debug(f"Audit log (no db): {event_type} {action} {target_type}:{target_id}")
        return

    try:
        async with db_manager.get_session() as session:
            log_entry = AuditLog(
                event_type=event_type,
                event_category="workflow",
                action=action,
                actor_id=actor_id,
                actor_type="system" if actor_id == "system" else "user",
                target_type=target_type,
                target_id=target_id,
                details=details,
                old_values=old_values,
                new_values=new_values,
                status=status,
                error_message=error_message,
            )
            session.add(log_entry)
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


# ---------------------------------------------------------------------------
# Database persistence helpers
# ---------------------------------------------------------------------------


async def persist_workflow_definition(definition: WorkflowDefinition) -> None:
    """Persist a workflow definition to the database."""
    if not db_manager:
        return
    try:
        async with db_manager.get_session() as session:
            repo = WorkflowRepository(session)
            existing = await repo.get_workflow(definition.workflow_id)
            if existing:
                await repo.update_workflow(
                    definition.workflow_id,
                    name=definition.name,
                    description=definition.description,
                    steps=[s for s in definition.steps],
                    status="active",
                )
            else:
                await repo.create_workflow(
                    workflow_id=definition.workflow_id,
                    name=definition.name,
                    description=definition.description,
                    category="alert_processing",
                    steps=[s for s in definition.steps],
                    trigger_type="manual",
                    status="active",
                )
    except Exception as e:
        logger.warning(f"Failed to persist workflow definition: {e}")


async def persist_execution(execution: WorkflowExecution) -> None:
    """Persist a workflow execution to the database."""
    if not db_manager:
        return
    try:
        async with db_manager.get_session() as session:
            repo = WorkflowRepository(session)
            existing = await repo.get_execution(execution.execution_id)
            if existing:
                updates = {
                    "status": execution.status.value,
                    "steps_execution": execution_step_results.get(execution.execution_id, {}),
                }
                if execution.completed_at:
                    updates["completed_at"] = execution.completed_at
                    duration = (execution.completed_at - execution.started_at).total_seconds()
                    updates["duration_seconds"] = int(duration)
                if execution.error:
                    updates["error_message"] = execution.error
                if execution.output:
                    updates["result"] = json.dumps(execution.output)
                await repo.update_workflow_execution(execution.execution_id, **updates)
            else:
                await repo.create_workflow_execution(
                    execution_id=execution.execution_id,
                    workflow_id=execution.workflow_id,
                    trigger_type="manual",
                    trigger_reference=execution.input.get("alert", execution.input).get("alert_id"),
                )
    except Exception as e:
        logger.warning(f"Failed to persist execution: {e}")


async def load_workflow_definitions_from_db() -> None:
    """Load workflow definitions from database into memory on startup."""
    if not db_manager:
        return
    try:
        async with db_manager.get_session() as session:
            repo = WorkflowRepository(session)
            db_workflows = await repo.get_all_workflows(status="active")
            for wf in db_workflows:
                if wf.workflow_id not in workflow_definitions:
                    workflow_definitions[wf.workflow_id] = WorkflowDefinition(
                        workflow_id=wf.workflow_id,
                        name=wf.name,
                        description=wf.description,
                        version="1.0.0",
                        steps=wf.steps or [],
                        timeout_seconds=3600,
                    )
            logger.info(f"Loaded {len(db_workflows)} workflow definitions from database")
    except Exception as e:
        logger.warning(f"Failed to load workflows from database: {e}")


# ---------------------------------------------------------------------------
# SLA management
# ---------------------------------------------------------------------------


def calculate_sla_deadline(priority: str, created_at: datetime) -> Dict[str, datetime]:
    """
    Calculate SLA response and resolution deadlines.

    Args:
        priority: Task priority level
        created_at: When the task was created

    Returns:
        Dict with response_deadline and resolve_deadline
    """
    sla = SLA_CONFIG.get(priority.lower(), SLA_CONFIG["medium"])
    return {
        "response_deadline": created_at + timedelta(minutes=sla["response_minutes"]),
        "resolve_deadline": created_at + timedelta(minutes=sla["resolve_minutes"]),
    }


async def check_sla_breaches() -> List[Dict[str, Any]]:
    """
    Check all pending tasks for SLA breaches and trigger escalations.

    Returns:
        List of breached task details
    """
    breaches: List[Dict[str, Any]] = []
    now = datetime.utcnow()

    for task_id, task in list(pending_tasks.items()):
        if task.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
            continue

        deadlines = calculate_sla_deadline(task.priority.value, task.created_at)

        response_breached = (
            task.status == TaskStatus.ASSIGNED and now > deadlines["response_deadline"]
        )
        resolve_breached = now > deadlines["resolve_deadline"]

        if response_breached or resolve_breached:
            breach_type = "resolve" if resolve_breached else "response"
            breach_info = {
                "task_id": task_id,
                "execution_id": task.execution_id,
                "priority": task.priority.value,
                "assigned_to": task.assigned_to,
                "breach_type": breach_type,
                "created_at": task.created_at.isoformat(),
                "deadline": deadlines[f"{breach_type}_deadline"].isoformat(),
                "overdue_minutes": int(
                    (now - deadlines[f"{breach_type}_deadline"]).total_seconds() / 60
                ),
            }
            breaches.append(breach_info)

            # Escalate: notify and re-assign if response SLA breached
            if response_breached:
                await _escalate_task(task, breach_info)

    return breaches


async def _escalate_task(task: HumanTask, breach_info: Dict[str, Any]) -> None:
    """Escalate a task that has breached its SLA."""
    logger.warning(
        f"SLA breach for task {task.task_id}: "
        f"{breach_info['breach_type']} deadline exceeded by "
        f"{breach_info['overdue_minutes']} minutes"
    )

    # Re-assign to a less loaded analyst
    new_assignee = _find_best_assignee(
        task.priority.value,
        task.input_data.get("alert_type", ""),
        exclude=task.assigned_to,
    )
    if new_assignee and new_assignee != task.assigned_to:
        old_assignee = task.assigned_to
        task.assigned_to = new_assignee
        logger.info(f"Task {task.task_id} re-assigned from {old_assignee} to {new_assignee}")

    await send_notification(
        channels=["security-team", "management"],
        template="sla_breach",
        context=breach_info,
    )

    await audit_log(
        event_type="task.sla_breach",
        action="escalate",
        target_type="task",
        target_id=task.task_id,
        details=breach_info,
    )


async def monitor_sla():
    """Background task to periodically check SLA breaches."""
    while True:
        try:
            await asyncio.sleep(60)
            breaches = await check_sla_breaches()
            if breaches:
                logger.warning(f"SLA breaches detected: {len(breaches)} tasks")
        except Exception as e:
            logger.error(f"Error monitoring SLA: {e}", exc_info=True)


AUTO_CLOSE_HOURS = int(os.getenv("AUTO_CLOSE_HOURS", "24"))


async def auto_close_resolved():
    """Auto-close completed/resolved workflows after configured timeout."""
    while True:
        try:
            await asyncio.sleep(3600)  # Check hourly
            cutoff = datetime.utcnow() - timedelta(hours=AUTO_CLOSE_HOURS)
            closed_count = 0

            for exec_id, execution in list(active_executions.items()):
                if execution.status == WorkflowStatus.COMPLETED and execution.completed_at:
                    if execution.completed_at < cutoff:
                        del active_executions[exec_id]
                        closed_count += 1
                        logger.debug(f"Auto-cleaned completed execution {exec_id}")

            if closed_count > 0:
                logger.info(
                    f"Auto-cleaned {closed_count} completed executions older than {AUTO_CLOSE_HOURS}h"
                )

        except Exception as e:
            logger.error(f"Auto-close task error: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# Smart task assignment
# ---------------------------------------------------------------------------


def _find_best_assignee(
    priority: str,
    alert_type: str = "",
    exclude: Optional[str] = None,
) -> str:
    """
    Find the best analyst for a task using skill matching and load balancing.

    Strategy:
    1. Filter available analysts (not at max capacity, not excluded)
    2. Score by skill match (has relevant alert_type skill)
    3. Break ties by lowest active task count (load balancing)

    Args:
        priority: Task priority
        alert_type: Alert type for skill matching
        exclude: Analyst ID to exclude (e.g. current assignee during escalation)

    Returns:
        Best analyst ID, or 'security-team' as fallback
    """
    candidates = [
        a
        for a in ANALYST_POOL
        if a["available"] and a["active_tasks"] < a["max_tasks"] and a["id"] != exclude
    ]

    if not candidates:
        return "security-team"

    def score(analyst: Dict[str, Any]) -> tuple:
        skill_match = 1 if alert_type.lower() in analyst["skills"] else 0
        priority_bonus = (
            1
            if priority in ("critical", "high") and "incident_response" in analyst["skills"]
            else 0
        )
        return (skill_match + priority_bonus, -analyst["active_tasks"])

    candidates.sort(key=score, reverse=True)
    best = candidates[0]
    best["active_tasks"] += 1
    return best["id"]


def _release_analyst(analyst_id: str) -> None:
    """Decrement active task count when a task is completed."""
    for analyst in ANALYST_POOL:
        if analyst["id"] == analyst_id and analyst["active_tasks"] > 0:
            analyst["active_tasks"] -= 1
            break


# ---------------------------------------------------------------------------
# Approval workflow for high-risk automation
# ---------------------------------------------------------------------------


def requires_approval(playbook_id: str, risk_level: str) -> bool:
    """
    Determine if automation execution requires approval.

    High-risk playbooks or critical risk levels require approval.
    """
    high_risk_playbooks = {"malware-response", "incident-containment"}
    return playbook_id in high_risk_playbooks and risk_level.upper() in ("CRITICAL", "HIGH")


async def request_approval(
    execution: WorkflowExecution,
    playbook_id: str,
    step: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Create an approval request for high-risk automation.

    Returns:
        Approval request details
    """
    approval_id = f"approval-{uuid.uuid4()}"
    alert = execution.input.get("alert", execution.input)

    approval = {
        "approval_id": approval_id,
        "execution_id": execution.execution_id,
        "playbook_id": playbook_id,
        "alert_id": alert.get("alert_id", "unknown"),
        "risk_level": execution.input.get("risk_level", "unknown"),
        "status": "pending",
        "requested_at": datetime.utcnow().isoformat(),
        "step": step,
    }
    pending_approvals[approval_id] = approval

    await send_notification(
        channels=["security-team", "management"],
        template="approval_required",
        context={
            "approval_id": approval_id,
            "playbook_id": playbook_id,
            "alert_id": alert.get("alert_id", "unknown"),
            "risk_level": execution.input.get("risk_level", "unknown"),
        },
    )

    await audit_log(
        event_type="automation.approval_requested",
        action="request_approval",
        target_type="automation",
        target_id=approval_id,
        details=approval,
    )

    logger.info(f"Approval requested for playbook {playbook_id} " f"(approval_id={approval_id})")

    return approval


def process_approval(
    approval_id: str,
    approved: bool,
    approver: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Process an approval decision.

    Args:
        approval_id: Approval request ID
        approved: Whether approved or rejected
        approver: Who made the decision
        reason: Optional reason

    Returns:
        Updated approval record

    Raises:
        WorkflowError: If approval not found or already processed
    """
    approval = pending_approvals.get(approval_id)
    if not approval:
        raise WorkflowError(f"Approval request not found: {approval_id}")

    if approval["status"] != "pending":
        raise WorkflowError(f"Approval already processed: {approval['status']}")

    approval["status"] = "approved" if approved else "rejected"
    approval["approved_by"] = approver
    approval["decided_at"] = datetime.utcnow().isoformat()
    approval["reason"] = reason

    return approval


# ---------------------------------------------------------------------------
# Notification helpers
# ---------------------------------------------------------------------------

NOTIFICATION_TEMPLATES: Dict[str, str] = {
    "workflow_completed": (
        "Workflow {workflow_id} completed for alert {alert_id}.\n"
        "Risk level: {risk_level}. Status: {status}."
    ),
    "incident_escalation": (
        "INCIDENT ESCALATION: Attack chain detected for alert {alert_id}.\n"
        "Triggered by: {triggered_by}. Immediate response required."
    ),
    "human_task_created": (
        "New task assigned: {title}\n" "Priority: {priority}. Execution: {execution_id}."
    ),
    "workflow_failed": (
        "Workflow {workflow_id} FAILED for alert {alert_id}.\n"
        "Error: {error}. Step: {current_step}."
    ),
    "sla_breach": (
        "SLA BREACH: Task {task_id} ({breach_type} deadline exceeded).\n"
        "Priority: {priority}. Assigned to: {assigned_to}. "
        "Overdue by {overdue_minutes} minutes."
    ),
    "approval_required": (
        "APPROVAL REQUIRED: Playbook {playbook_id} for alert {alert_id}.\n"
        "Risk level: {risk_level}. Approval ID: {approval_id}."
    ),
    "approval_decided": (
        "Approval {approval_id} {status}: Playbook {playbook_id}.\n"
        "Decided by: {approved_by}. Reason: {reason}."
    ),
}


async def send_notification(
    channels: List[str],
    template: str,
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Send notifications via the notification service queue.

    Args:
        channels: Target channel names (teams/groups)
        template: Template name from NOTIFICATION_TEMPLATES
        context: Variables to fill into the template

    Returns:
        Notification dispatch result
    """
    template_str = NOTIFICATION_TEMPLATES.get(template, template)
    try:
        message_text = template_str.format_map(_SafeFormatDict(context))
    except Exception:
        message_text = template_str

    notification_payload = {
        "message_id": str(uuid.uuid4()),
        "message_type": "notification.send",
        "payload": {
            "channels": channels,
            "template": template,
            "message": message_text,
            "context": context,
            "timestamp": datetime.utcnow().isoformat(),
        },
        "timestamp": datetime.utcnow().isoformat(),
    }

    if publisher:
        await publisher.publish("notification.send", notification_payload)
        logger.info(f"Notification dispatched to {channels} (template={template})")
    else:
        logger.warning("Publisher not available, notification skipped")

    return {"status": "dispatched", "channels": channels, "template": template}


class _SafeFormatDict(dict):
    """dict subclass that returns '{key}' for missing keys during str.format_map."""

    def __missing__(self, key: str) -> str:
        return f"{{{key}}}"


# ---------------------------------------------------------------------------
# Decision expression evaluator
# ---------------------------------------------------------------------------


def evaluate_condition(condition: str, context: Dict[str, Any]) -> bool:
    """
    Evaluate a simple condition expression against the execution context.

    Supports:
    - Variable references: risk_level, severity, etc.
    - Comparisons: ==, !=, in, not in
    - Logical operators: and, or, not
    - String literals: 'CRITICAL', "HIGH"

    This uses a safe subset approach rather than raw eval().
    """
    if not condition or not condition.strip():
        return True

    # Replace variable references with their values for simple checks
    ctx = {k: v for k, v in context.items() if isinstance(v, (str, int, float, bool, list))}

    # Handle common patterns directly
    # Pattern: "var in ('A', 'B')"
    in_match = re.match(r"^\s*(\w+)\s+in\s+\((.+)\)\s*$", condition)
    if in_match:
        var_name = in_match.group(1)
        values_str = in_match.group(2)
        var_value = str(ctx.get(var_name, "")).upper()
        allowed = [v.strip().strip("'\"").upper() for v in values_str.split(",")]
        return var_value in allowed

    # Pattern: "var == 'value'" or "var != 'value'"
    eq_match = re.match(r"^\s*(\w+)\s*(==|!=)\s*['\"](.+?)['\"]\s*$", condition)
    if eq_match:
        var_name = eq_match.group(1)
        operator = eq_match.group(2)
        target = eq_match.group(3)
        var_value = str(ctx.get(var_name, ""))
        if operator == "==":
            return var_value.upper() == target.upper()
        else:
            return var_value.upper() != target.upper()

    # Pattern: "var > number" / "var >= number"
    num_match = re.match(r"^\s*(\w+)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)\s*$", condition)
    if num_match:
        var_name = num_match.group(1)
        operator = num_match.group(2)
        threshold = float(num_match.group(3))
        try:
            var_value = float(ctx.get(var_name, 0))
        except (ValueError, TypeError):
            return False
        ops = {
            ">=": var_value >= threshold,
            "<=": var_value <= threshold,
            ">": var_value > threshold,
            "<": var_value < threshold,
        }
        return ops[operator]

    # Legacy / fallback: simple risk_level check
    if "risk_level" in condition:
        risk_level = str(ctx.get("risk_level", "")).upper()
        if risk_level in ("CRITICAL", "HIGH"):
            return True
        return False

    # Default: treat as true (permissive)
    return True


# ---------------------------------------------------------------------------
# Automation trigger
# ---------------------------------------------------------------------------

ALERT_TYPE_PLAYBOOK_MAP: Dict[str, str] = {
    "malware": "malware-response",
    "phishing": "phishing-response",
}


async def trigger_automation(
    execution: WorkflowExecution,
    step: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Trigger an automation playbook based on the alert context.

    The playbook is selected by alert_type using ALERT_TYPE_PLAYBOOK_MAP.
    """
    alert = execution.input.get("alert", execution.input)
    alert_type = str(alert.get("alert_type", "")).lower()
    alert_id = alert.get("alert_id", execution.execution_id)

    selector = step.get("playbook_selector", "by_alert_type")
    playbook_id = step.get("playbook_id")

    if not playbook_id and selector == "by_alert_type":
        playbook_id = ALERT_TYPE_PLAYBOOK_MAP.get(alert_type)

    if not playbook_id:
        logger.info(f"No playbook mapped for alert_type={alert_type}, skipping automation")
        return {"status": "skipped", "reason": f"No playbook for alert_type={alert_type}"}

    # Check if approval is required for high-risk automation
    risk_level = execution.input.get("risk_level", "MEDIUM")
    if requires_approval(playbook_id, risk_level):
        approval = await request_approval(execution, playbook_id, step)
        return {
            "status": "awaiting_approval",
            "approval_id": approval["approval_id"],
            "playbook_id": playbook_id,
            "alert_id": alert_id,
        }

    trigger_payload = {
        "message_id": str(uuid.uuid4()),
        "message_type": "automation.trigger",
        "payload": {
            "playbook_id": playbook_id,
            "alert_id": alert_id,
            "input": {
                "alert_id": alert_id,
                "alert_type": alert_type,
                "source_ip": alert.get("source_ip"),
                "target_ip": alert.get("target_ip"),
                "file_hash": alert.get("file_hash"),
                "risk_level": execution.input.get("risk_level", "HIGH"),
                **execution.input.get("triage_result", {}),
            },
        },
        "timestamp": datetime.utcnow().isoformat(),
    }

    if publisher:
        await publisher.publish("automation.trigger", trigger_payload)
        logger.info(f"Automation triggered: playbook={playbook_id} for alert={alert_id}")
    else:
        logger.warning("Publisher not available, automation trigger skipped")

    return {
        "status": "triggered",
        "playbook_id": playbook_id,
        "alert_id": alert_id,
    }


# ---------------------------------------------------------------------------
# Step execution with retry
# ---------------------------------------------------------------------------


async def execute_step_with_retry(
    execution: WorkflowExecution,
    step: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Execute a workflow step with optional retry logic.

    Reads retry config from step['retry'] or falls back to workflow-level
    retry_policy.
    """
    retry_config = step.get("retry", {})
    max_attempts = retry_config.get("max_attempts", 1)
    backoff_seconds = retry_config.get("backoff_seconds", 2)

    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            result = await execute_workflow_step(execution, step)
            if result.get("status") != "failed":
                return result
            last_error = result.get("error", "Unknown error")
        except Exception as e:
            last_error = str(e)

        if attempt < max_attempts:
            wait = backoff_seconds * (2 ** (attempt - 1))
            logger.warning(
                f"Step {step.get('name')} failed (attempt {attempt}/{max_attempts}), "
                f"retrying in {wait}s: {last_error}"
            )
            await asyncio.sleep(wait)

    logger.error(f"Step {step.get('name')} failed after {max_attempts} attempts: {last_error}")
    return {"status": "failed", "error": last_error, "attempts": max_attempts}


async def execute_workflow_step(
    execution: WorkflowExecution, step: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Execute a single workflow step.

    Supports:
    - activity: Service call (built-in correlation or generic publish)
    - human_task: Create human task and pause workflow
    - decision: Conditional branching
    - notification: Send notification via channels
    - automation: Trigger SOAR playbook
    """
    step_type = step.get("type")
    step_name = step.get("name")

    logger.info(f"Executing step {step_name} (type: {step_type})")

    try:
        if step_type == "activity":
            return await _execute_activity(execution, step)

        elif step_type == "human_task":
            return await _execute_human_task(execution, step)

        elif step_type == "decision":
            return _execute_decision(execution, step)

        elif step_type == "notification":
            return await _execute_notification(execution, step)

        elif step_type == "automation":
            return await trigger_automation(execution, step)

        else:
            logger.warning(f"Unknown step type: {step_type}")
            return {"status": "skipped", "reason": f"Unknown step type: {step_type}"}

    except Exception as e:
        logger.error(f"Step execution failed: {e}", exc_info=True)
        return {"status": "failed", "error": str(e)}


async def _execute_activity(execution: WorkflowExecution, step: Dict[str, Any]) -> Dict[str, Any]:
    """Execute an activity step (service call or built-in)."""
    service = step.get("service")

    # --- Built-in correlation activity ------------------------------------
    if service == "correlation":
        correlation_result = await _run_correlation(execution.input)
        execution.input["correlation"] = correlation_result

        # Auto-escalate when attack chains are detected
        chains = correlation_result.get("attack_chains", [])
        if chains:
            logger.warning(
                f"Attack chain(s) detected for execution {execution.execution_id}: "
                f"{[c['chain_type'] for c in chains]}"
            )
            execution.input["risk_level"] = "CRITICAL"
            # Trigger incident-response workflow asynchronously
            asyncio.create_task(_trigger_incident_response(execution, correlation_result))

        return {"status": "completed", "output": correlation_result}

    # --- Generic service activity -----------------------------------------
    if service:
        msg = {
            "message_id": str(uuid.uuid4()),
            "message_type": "workflow.activity",
            "payload": {
                "execution_id": execution.execution_id,
                "step": step.get("name"),
                "service": service,
                "input": execution.input,
            },
            "timestamp": datetime.utcnow().isoformat(),
        }

        if publisher:
            await publisher.publish(f"workflow.{service}", msg)
        else:
            logger.warning(f"Publisher not available, skipping publish to workflow.{service}")

        return {"status": "completed", "output": {"service": service, "dispatched": True}}

    return {"status": "completed"}


async def _execute_human_task(execution: WorkflowExecution, step: Dict[str, Any]) -> Dict[str, Any]:
    """Create a human task and prepare for workflow pause."""
    priority_str = step.get("priority", "medium").lower()
    priority_map = {
        "critical": TaskPriority.CRITICAL,
        "high": TaskPriority.HIGH,
        "medium": TaskPriority.MEDIUM,
        "low": TaskPriority.LOW,
    }

    # Smart task assignment: find best analyst based on skills and load
    alert = execution.input.get("alert", execution.input)
    alert_type = str(alert.get("alert_type", "")).lower()
    explicit_assignee = step.get("assignee")

    if explicit_assignee and explicit_assignee not in ("security-team", "auto"):
        assignee = explicit_assignee
    else:
        assignee = _find_best_assignee(priority_str, alert_type)

    task = HumanTask(
        task_id=f"task-{uuid.uuid4()}",
        execution_id=execution.execution_id,
        task_type=step.get("task_type", "manual_review"),
        title=step.get("title", f"Complete task: {step.get('name')}"),
        description=step.get("description", ""),
        assigned_to=assignee,
        status=TaskStatus.ASSIGNED,
        priority=priority_map.get(priority_str, TaskPriority.MEDIUM),
        input_data=execution.input.copy(),
    )

    # Calculate SLA deadlines and store in task data
    sla_deadlines = calculate_sla_deadline(priority_str, task.created_at)
    task.input_data["sla"] = {
        "response_deadline": sla_deadlines["response_deadline"].isoformat(),
        "resolve_deadline": sla_deadlines["resolve_deadline"].isoformat(),
    }

    pending_tasks[task.task_id] = task

    # Notify assignee
    await send_notification(
        channels=[task.assigned_to],
        template="human_task_created",
        context={
            "title": task.title,
            "priority": task.priority.value,
            "execution_id": execution.execution_id,
            "task_id": task.task_id,
        },
    )

    logger.info(
        f"Human task {task.task_id} created for execution {execution.execution_id}, "
        f"assigned to {task.assigned_to}"
    )

    await audit_log(
        event_type="task.created",
        action="create",
        target_type="task",
        target_id=task.task_id,
        details={
            "execution_id": execution.execution_id,
            "assigned_to": task.assigned_to,
            "priority": task.priority.value,
            "sla": task.input_data.get("sla"),
        },
    )

    return {
        "status": "pending",
        "task_id": task.task_id,
        "assigned_to": task.assigned_to,
        "message": "Human task created, awaiting completion",
    }


def _execute_decision(execution: WorkflowExecution, step: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate a decision condition and determine branching."""
    condition = step.get("condition", "")
    decision_result = evaluate_condition(condition, execution.input)

    logger.info(
        f"Decision '{step.get('name')}' evaluated: {decision_result} " f"(condition: {condition})"
    )

    return {
        "status": "completed",
        "decision": decision_result,
        "goto": step.get("on_true") if decision_result else step.get("on_false"),
    }


async def _execute_notification(
    execution: WorkflowExecution, step: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute a notification step."""
    channels = step.get("channels", [])
    template = step.get("template", "workflow_completed")
    alert = execution.input.get("alert", execution.input)

    context = {
        "workflow_id": execution.workflow_id,
        "execution_id": execution.execution_id,
        "alert_id": alert.get("alert_id", "unknown"),
        "risk_level": execution.input.get("risk_level", "unknown"),
        "status": execution.status.value,
        "current_step": execution.current_step or "",
        "error": execution.error or "",
        "triggered_by": execution.input.get("triggered_by", ""),
    }

    result = await send_notification(channels, template, context)
    return {"status": "completed", "output": result}


# ---------------------------------------------------------------------------
# Workflow execution orchestrator
# ---------------------------------------------------------------------------


async def execute_workflow(execution: WorkflowExecution):
    """
    Execute workflow steps sequentially with branching, pause/resume,
    and step result aggregation.
    """
    try:
        workflow_def = workflow_definitions.get(execution.workflow_id)
        if not workflow_def:
            raise WorkflowError(f"Workflow definition not found: {execution.workflow_id}")

        execution.status = WorkflowStatus.RUNNING
        active_executions[execution.execution_id] = execution
        execution_step_results[execution.execution_id] = {}
        metrics.inc(WORKFLOWS_STARTED)

        await persist_execution(execution)
        await audit_log(
            event_type="workflow.started",
            action="start",
            target_type="execution",
            target_id=execution.execution_id,
            details={
                "workflow_id": execution.workflow_id,
                "input_keys": list(execution.input.keys()),
            },
        )

        steps = workflow_def.steps
        step_index = 0
        skip_until: Optional[str] = None  # For decision branching (goto)

        while step_index < len(steps):
            step = steps[step_index]
            step_name = step.get("name")

            # Handle decision branching: skip steps until we reach the goto target
            if skip_until:
                if step_name == skip_until:
                    skip_until = None  # Found the target, resume normal execution
                else:
                    step_index += 1
                    continue

            execution.current_step = step_name
            execution.progress = step_index / len(steps)

            # Execute step (with retry for activity steps)
            if step.get("type") == "activity" and step.get("retry"):
                result = await execute_step_with_retry(execution, step)
            else:
                result = await execute_workflow_step(execution, step)

            # Store step result
            execution_step_results[execution.execution_id][step_name] = result

            # Merge useful output into execution input for downstream steps
            step_output = result.get("output", {})
            if isinstance(step_output, dict):
                execution.input.setdefault("step_results", {})[step_name] = step_output

            if result.get("status") == "failed":
                execution.status = WorkflowStatus.FAILED
                execution.error = result.get("error", "Step execution failed")
                execution.completed_at = datetime.utcnow()

                # Notify on failure
                await _notify_workflow_event(execution, "workflow_failed")
                break

            elif result.get("status") == "pending":
                # Workflow paused waiting for human task
                execution.status = WorkflowStatus.PENDING

                # Set up resume event
                event = asyncio.Event()
                _resume_events[execution.execution_id] = event

                logger.info(f"Workflow {execution.execution_id} paused at step {step_name}")

                # Wait for task completion (with timeout)
                timeout = workflow_def.timeout_seconds
                try:
                    await asyncio.wait_for(event.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    execution.status = WorkflowStatus.TIMED_OUT
                    execution.error = (
                        f"Workflow timed out waiting for human task at step {step_name}"
                    )
                    execution.completed_at = datetime.utcnow()
                    break
                finally:
                    _resume_events.pop(execution.execution_id, None)

                # Resumed - continue execution
                execution.status = WorkflowStatus.RUNNING
                logger.info(f"Workflow {execution.execution_id} resumed from step {step_name}")

            elif result.get("goto"):
                # Decision branching: jump to a specific step
                goto_target = result["goto"]
                # Find the target step index
                target_indices = [i for i, s in enumerate(steps) if s.get("name") == goto_target]
                if target_indices:
                    step_index = target_indices[0]
                    continue  # Don't increment, jump directly
                else:
                    logger.warning(f"Decision goto target '{goto_target}' not found, continuing")

            step_index += 1

        # If all steps completed successfully
        if execution.status == WorkflowStatus.RUNNING:
            execution.status = WorkflowStatus.COMPLETED
            execution.completed_at = datetime.utcnow()
            execution.progress = 1.0
            execution.output = {
                "message": "Workflow completed successfully",
                "step_results": execution_step_results.get(execution.execution_id, {}),
            }
            metrics.inc(WORKFLOWS_COMPLETED)

            await persist_execution(execution)
            await audit_log(
                event_type="workflow.completed",
                action="complete",
                target_type="execution",
                target_id=execution.execution_id,
                details={
                    "workflow_id": execution.workflow_id,
                    "duration_seconds": (
                        (execution.completed_at - execution.started_at).total_seconds()
                        if execution.completed_at
                        else None
                    ),
                },
            )

            # Notify on completion
            await _notify_workflow_event(execution, "workflow_completed")

        # Publish completion event
        if publisher:
            await publisher.publish(
                "workflow.completed",
                {
                    "message_id": str(uuid.uuid4()),
                    "message_type": "workflow.completed",
                    "payload": execution.model_dump(),
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )

        logger.info(
            f"Workflow execution {execution.execution_id} finished: {execution.status.value}"
        )

    except Exception as e:
        logger.error(f"Workflow execution failed: {e}", exc_info=True)
        execution.status = WorkflowStatus.FAILED
        execution.error = str(e)
        execution.completed_at = datetime.utcnow()
        await persist_execution(execution)
        await audit_log(
            event_type="workflow.failed",
            action="fail",
            target_type="execution",
            target_id=execution.execution_id,
            status="failure",
            error_message=str(e),
        )

    finally:
        # Clean up step results for completed/failed workflows
        if execution.status in (
            WorkflowStatus.COMPLETED,
            WorkflowStatus.FAILED,
            WorkflowStatus.TIMED_OUT,
            WorkflowStatus.CANCELLED,
        ):
            execution_step_results.pop(execution.execution_id, None)


async def _notify_workflow_event(execution: WorkflowExecution, template: str) -> None:
    """Send a notification for a workflow lifecycle event."""
    alert = execution.input.get("alert", execution.input)
    try:
        await send_notification(
            channels=["security-team"],
            template=template,
            context={
                "workflow_id": execution.workflow_id,
                "execution_id": execution.execution_id,
                "alert_id": alert.get("alert_id", "unknown"),
                "risk_level": execution.input.get("risk_level", "unknown"),
                "status": execution.status.value,
                "current_step": execution.current_step or "",
                "error": execution.error or "",
            },
        )
    except Exception as e:
        logger.warning(f"Failed to send workflow event notification: {e}")


# ---------------------------------------------------------------------------
# Human task completion & workflow resume
# ---------------------------------------------------------------------------


def complete_human_task(
    task_id: str,
    output_data: Dict[str, Any] = None,
    notes: Optional[str] = None,
) -> HumanTask:
    """
    Mark a human task as completed and resume the associated workflow.

    Args:
        task_id: Task identifier
        output_data: Output from the human reviewer
        notes: Optional reviewer notes

    Returns:
        Updated HumanTask

    Raises:
        WorkflowError: If task not found or already completed
    """
    task = pending_tasks.get(task_id)
    if not task:
        raise WorkflowError(f"Task not found: {task_id}")

    if task.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        raise WorkflowError(f"Task already in terminal state: {task.status.value}")

    task.status = TaskStatus.COMPLETED
    task.completed_at = datetime.utcnow()
    task.output_data = output_data or {}
    task.notes = notes

    # Merge task output into execution input
    execution = active_executions.get(task.execution_id)
    if execution:
        execution.input["human_task_result"] = task.output_data
        execution.input.setdefault("step_results", {})[f"task_{task_id}"] = task.output_data

    # Resume the workflow
    event = _resume_events.get(task.execution_id)
    if event:
        event.set()

    # Release the analyst's capacity
    if task.assigned_to:
        _release_analyst(task.assigned_to)

    # Remove from pending
    pending_tasks.pop(task_id, None)

    logger.info(f"Human task {task_id} completed, workflow {task.execution_id} resuming")
    return task


# ---------------------------------------------------------------------------
# Workflow lifecycle
# ---------------------------------------------------------------------------


async def consume_workflow_triggers():
    """Consume workflow trigger messages from queue."""

    async def process_message(message: dict):
        try:
            payload = message.get("payload", message)
            workflow_id = payload.get("workflow_id")
            input_data = payload.get("input", {})

            if not workflow_id:
                logger.error("Missing workflow_id in trigger message")
                return

            # Start workflow execution
            execution = start_workflow_execution(workflow_id, input_data)
            logger.info(f"Started workflow execution {execution.execution_id}")

        except Exception as e:
            logger.error(f"Failed to process workflow trigger: {e}", exc_info=True)

    await consumer.consume(process_message)


def start_workflow_execution(workflow_id: str, input_data: Dict[str, Any]) -> WorkflowExecution:
    """
    Start a new workflow execution.

    Args:
        workflow_id: Workflow definition ID
        input_data: Input parameters for workflow

    Returns:
        WorkflowExecution instance

    Raises:
        WorkflowError: If workflow definition not found
    """
    if workflow_id not in workflow_definitions:
        raise WorkflowError(f"Workflow definition not found: {workflow_id}")

    execution = WorkflowExecution(
        execution_id=f"exec-{uuid.uuid4()}",
        workflow_id=workflow_id,
        status=WorkflowStatus.PENDING,
        input=input_data,
        started_at=datetime.utcnow(),
    )

    # Start execution in background
    asyncio.create_task(execute_workflow(execution))

    return execution


async def cancel_workflow_execution(execution_id: str) -> WorkflowExecution:
    """
    Cancel a running or pending workflow execution.

    Args:
        execution_id: Execution identifier

    Returns:
        Updated WorkflowExecution

    Raises:
        WorkflowError: If execution not found or not cancellable
    """
    execution = active_executions.get(execution_id)
    if not execution:
        raise WorkflowError(f"Execution not found: {execution_id}")

    if execution.status not in (WorkflowStatus.PENDING, WorkflowStatus.RUNNING):
        raise WorkflowError(f"Cannot cancel execution in status: {execution.status.value}")

    execution.status = WorkflowStatus.CANCELLED
    execution.completed_at = datetime.utcnow()

    # If paused on a human task, signal the event so the wait unblocks
    event = _resume_events.pop(execution_id, None)
    if event:
        event.set()

    logger.info(f"Workflow execution {execution_id} cancelled")
    return execution


def get_execution_step_results(execution_id: str) -> Dict[str, Any]:
    """Get accumulated step results for an active execution."""
    return execution_step_results.get(execution_id, {})


# ---------------------------------------------------------------------------
# Execution monitoring
# ---------------------------------------------------------------------------


async def monitor_executions():
    """Monitor active workflow executions for timeouts."""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute

            current_time = datetime.utcnow()
            timed_out = []

            for exec_id, execution in active_executions.items():
                if execution.status not in (WorkflowStatus.RUNNING, WorkflowStatus.PENDING):
                    continue

                workflow_def = workflow_definitions.get(execution.workflow_id)
                if not workflow_def:
                    continue

                timeout = timedelta(seconds=workflow_def.timeout_seconds)
                if current_time - execution.started_at > timeout:
                    execution.status = WorkflowStatus.TIMED_OUT
                    execution.error = "Workflow execution timed out"
                    execution.completed_at = current_time
                    timed_out.append(exec_id)

                    # Unblock any resume waits
                    event = _resume_events.pop(exec_id, None)
                    if event:
                        event.set()

                    logger.warning(f"Workflow execution {exec_id} timed out")

            # Clean up timed out executions
            for exec_id in timed_out:
                del active_executions[exec_id]
                execution_step_results.pop(exec_id, None)

        except Exception as e:
            logger.error(f"Error monitoring executions: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# Correlation helpers
# ---------------------------------------------------------------------------


async def _run_correlation(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """Run correlation analysis on the current alert against recent cache."""
    alert = input_data.get("alert") or input_data
    metrics.inc(CORRELATIONS_PERFORMED)

    async with _cache_lock:
        # Snapshot cache under lock, then release for CPU-bound correlation
        cache_snapshot = list(recent_alerts_cache)

    result = CorrelationEngine.correlate(alert, cache_snapshot)

    chains = result.get("attack_chains", [])
    if chains:
        metrics.inc(ATTACK_CHAINS_DETECTED, len(chains))

    # Cache this alert for future correlations
    if alert.get("alert_id"):
        async with _cache_lock:
            recent_alerts_cache.append(alert)
            # Trim to bounded size
            while len(recent_alerts_cache) > MAX_RECENT_ALERTS:
                recent_alerts_cache.pop(0)

    return result


async def _trigger_incident_response(
    source_execution: WorkflowExecution,
    correlation_result: Dict[str, Any],
) -> None:
    """Auto-trigger an incident-response workflow when attack chains are detected."""
    try:
        ir_input = {
            "triggered_by": source_execution.execution_id,
            "alert": source_execution.input.get("alert", {}),
            "correlation": correlation_result,
            "reason": "Automated escalation: attack chain detected",
        }
        execution = start_workflow_execution("incident-response", ir_input)
        metrics.inc(INCIDENT_RESPONSES_TRIGGERED)
        logger.info(
            f"Auto-triggered incident-response workflow {execution.execution_id} "
            f"from {source_execution.execution_id}"
        )
    except Exception as e:
        logger.error(f"Failed to auto-trigger incident-response: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, publisher, consumer, workflow_definitions

    logger.info("Starting Workflow Engine service...")

    # Initialize database
    db_manager = get_database_manager()
    await db_manager.initialize()

    # Initialize messaging
    publisher = MessagePublisher(config.rabbitmq_url)
    await publisher.connect()

    consumer = MessageConsumer(config.rabbitmq_url, "workflow.trigger")
    await consumer.connect()

    # Load workflow definitions
    workflow_definitions.update(DEFAULT_WORKFLOWS)

    # Persist default workflows to database
    for wf_def in DEFAULT_WORKFLOWS.values():
        await persist_workflow_definition(wf_def)

    # Load any additional workflows from database
    await load_workflow_definitions_from_db()

    # Start consuming workflow triggers
    asyncio.create_task(consume_workflow_triggers())

    # Start background task to monitor active executions
    asyncio.create_task(monitor_executions())

    # Start SLA monitoring
    asyncio.create_task(monitor_sla())

    # Start auto-close background task for resolved workflows
    asyncio.create_task(auto_close_resolved())

    logger.info("Workflow Engine service started successfully")

    yield

    # Cleanup
    await consumer.close()
    await publisher.close()
    await db_manager.close()
    logger.info("Workflow Engine service stopped")


app = FastAPI(
    title="Workflow Engine Service",
    description="Manages workflow definitions and executions",
    version="1.0.0",
    lifespan=lifespan,
)

# Prometheus metrics
setup_prometheus(app, "workflow-engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/workflows/definitions", response_model=Dict[str, Any])
async def create_workflow_definition(definition: WorkflowDefinition):
    """Create a new workflow definition."""
    try:
        workflow_definitions[definition.workflow_id] = definition
        await persist_workflow_definition(definition)
        await audit_log(
            event_type="workflow.definition_created",
            action="create",
            target_type="workflow_definition",
            target_id=definition.workflow_id,
            details={"name": definition.name, "steps_count": len(definition.steps)},
        )

        return {
            "success": True,
            "data": definition.model_dump(),
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to create workflow definition: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to create workflow definition: {str(e)}"
        )


@app.get("/api/v1/workflows/definitions", response_model=Dict[str, Any])
async def list_workflow_definitions():
    """List all workflow definitions."""
    return {
        "success": True,
        "data": {
            "workflows": [wf.model_dump() for wf in workflow_definitions.values()],
            "total": len(workflow_definitions),
        },
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/workflows/definitions/{workflow_id}", response_model=Dict[str, Any])
async def get_workflow_definition(workflow_id: str):
    """Get a specific workflow definition."""
    workflow = workflow_definitions.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow definition not found: {workflow_id}")

    return {
        "success": True,
        "data": workflow.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.put("/api/v1/workflows/definitions/{workflow_id}", response_model=Dict[str, Any])
async def update_workflow_definition(workflow_id: str, updates: WorkflowUpdateRequest):
    """Update an existing workflow definition."""
    workflow = workflow_definitions.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow definition not found: {workflow_id}")

    old_values = {}
    new_values = {}

    update_data = updates.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            old_values[field] = getattr(workflow, field, None)
            if isinstance(old_values[field], list):
                old_values[field] = f"[{len(old_values[field])} steps]"
            setattr(workflow, field, value)
            new_values[field] = value if not isinstance(value, list) else f"[{len(value)} steps]"

    await persist_workflow_definition(workflow)
    await audit_log(
        event_type="workflow.definition_updated",
        action="update",
        target_type="workflow_definition",
        target_id=workflow_id,
        old_values=old_values,
        new_values=new_values,
    )

    return {
        "success": True,
        "data": workflow.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.delete("/api/v1/workflows/definitions/{workflow_id}", response_model=Dict[str, Any])
async def delete_workflow_definition(workflow_id: str):
    """Delete a workflow definition."""
    workflow = workflow_definitions.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow definition not found: {workflow_id}")

    # Prevent deleting workflows with active executions
    active = [
        e
        for e in active_executions.values()
        if e.workflow_id == workflow_id
        and e.status in (WorkflowStatus.RUNNING, WorkflowStatus.PENDING)
    ]
    if active:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete workflow with {len(active)} active execution(s)",
        )

    del workflow_definitions[workflow_id]

    if db_manager:
        try:
            async with db_manager.get_session() as session:
                repo = WorkflowRepository(session)
                await repo.delete_workflow(workflow_id)
        except Exception as e:
            logger.warning(f"Failed to delete workflow from database: {e}")

    await audit_log(
        event_type="workflow.definition_deleted",
        action="delete",
        target_type="workflow_definition",
        target_id=workflow_id,
        details={"name": workflow.name},
    )

    return {
        "success": True,
        "message": f"Workflow '{workflow_id}' deleted",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post(
    "/api/v1/workflows/definitions/{workflow_id}/status",
    response_model=Dict[str, Any],
)
async def set_workflow_status(workflow_id: str, status: str):
    """Enable or disable a workflow definition (set status to active/disabled/draft)."""
    if status not in ("active", "disabled", "draft"):
        raise HTTPException(
            status_code=400,
            detail="Status must be one of: active, disabled, draft",
        )

    workflow = workflow_definitions.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow definition not found: {workflow_id}")

    old_status = "active"  # in-memory workflows are implicitly active
    if status == "disabled":
        # Remove from active definitions so it can't be triggered
        workflow_definitions.pop(workflow_id, None)
    else:
        workflow_definitions[workflow_id] = workflow

    if db_manager:
        try:
            async with db_manager.get_session() as session:
                repo = WorkflowRepository(session)
                await repo.update_workflow(workflow_id, status=status)
        except Exception as e:
            logger.warning(f"Failed to update workflow status in database: {e}")

    await audit_log(
        event_type="workflow.status_changed",
        action="update_status",
        target_type="workflow_definition",
        target_id=workflow_id,
        old_values={"status": old_status},
        new_values={"status": status},
    )

    return {
        "success": True,
        "data": {"workflow_id": workflow_id, "status": status},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/workflows/execute", response_model=Dict[str, Any])
async def execute_workflow_api(
    workflow_id: str, input_data: Dict[str, Any], background_tasks: BackgroundTasks
):
    """Start workflow execution via API."""
    try:
        if workflow_id not in workflow_definitions:
            raise HTTPException(
                status_code=404, detail=f"Workflow definition not found: {workflow_id}"
            )

        execution = start_workflow_execution(workflow_id, input_data)

        return {
            "success": True,
            "data": {
                "execution_id": execution.execution_id,
                "workflow_id": execution.workflow_id,
                "status": execution.status.value,
                "started_at": execution.started_at.isoformat(),
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start workflow execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start workflow execution: {str(e)}")


@app.get("/api/v1/workflows/executions", response_model=Dict[str, Any])
async def list_executions(
    status: Optional[WorkflowStatus] = None, workflow_id: Optional[str] = None
):
    """List workflow executions, optionally filtered by status or workflow."""
    executions = list(active_executions.values())

    if status:
        executions = [e for e in executions if e.status == status]

    if workflow_id:
        executions = [e for e in executions if e.workflow_id == workflow_id]

    return {
        "success": True,
        "data": {"executions": [e.model_dump() for e in executions], "total": len(executions)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/workflows/executions/{execution_id}", response_model=Dict[str, Any])
async def get_execution(execution_id: str):
    """Get a specific workflow execution."""
    execution = active_executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    return {
        "success": True,
        "data": execution.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/workflows/executions/{execution_id}/steps", response_model=Dict[str, Any])
async def get_execution_steps(execution_id: str):
    """Get step results for a specific execution."""
    if execution_id not in active_executions:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    return {
        "success": True,
        "data": {"step_results": get_execution_step_results(execution_id)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/workflows/executions/{execution_id}/cancel", response_model=Dict[str, Any])
async def cancel_execution_api(execution_id: str):
    """Cancel a running workflow execution."""
    try:
        execution = await cancel_workflow_execution(execution_id)
        return {
            "success": True,
            "message": "Execution cancelled",
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Human task endpoints
# ---------------------------------------------------------------------------


@app.get("/api/v1/tasks", response_model=Dict[str, Any])
async def list_tasks(status: Optional[str] = None, assignee: Optional[str] = None):
    """List pending human tasks."""
    tasks = list(pending_tasks.values())

    if status:
        tasks = [t for t in tasks if t.status.value == status]
    if assignee:
        tasks = [t for t in tasks if t.assigned_to == assignee]

    return {
        "success": True,
        "data": {"tasks": [t.model_dump() for t in tasks], "total": len(tasks)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/tasks/{task_id}", response_model=Dict[str, Any])
async def get_task(task_id: str):
    """Get a specific human task."""
    task = pending_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    return {
        "success": True,
        "data": task.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/tasks/{task_id}/complete", response_model=Dict[str, Any])
async def complete_task_api(task_id: str, body: TaskCompleteRequest = None):
    """Complete a human task and resume the associated workflow."""
    try:
        if body is None:
            body = TaskCompleteRequest()
        task = complete_human_task(task_id, body.output_data, body.notes)

        await audit_log(
            event_type="task.completed",
            action="complete",
            target_type="task",
            target_id=task_id,
            details={
                "execution_id": task.execution_id,
                "output_data": task.output_data,
                "notes": task.notes,
            },
        )

        return {
            "success": True,
            "data": task.model_dump(),
            "message": "Task completed, workflow resuming",
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Correlation endpoint
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Approval endpoints
# ---------------------------------------------------------------------------


@app.get("/api/v1/approvals", response_model=Dict[str, Any])
async def list_approvals(status: Optional[str] = None):
    """List automation approval requests."""
    approvals = list(pending_approvals.values())
    if status:
        approvals = [a for a in approvals if a["status"] == status]

    return {
        "success": True,
        "data": {"approvals": approvals, "total": len(approvals)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/approvals/{approval_id}", response_model=Dict[str, Any])
async def decide_approval(approval_id: str, body: ApprovalRequest):
    """Approve or reject an automation execution."""
    try:
        approval = process_approval(approval_id, body.approved, body.approver, body.reason)

        await audit_log(
            event_type="automation.approval_decided",
            action="approve" if body.approved else "reject",
            target_type="automation",
            target_id=approval_id,
            actor_id=body.approver,
            details={
                "playbook_id": approval["playbook_id"],
                "approved": body.approved,
                "reason": body.reason,
            },
        )

        # If approved, trigger the automation
        if body.approved:
            execution = active_executions.get(approval["execution_id"])
            if execution:
                step = approval.get("step", {})
                step["playbook_id"] = approval["playbook_id"]
                # Temporarily remove approval requirement to avoid loop
                original_risk = execution.input.get("risk_level")
                execution.input["risk_level"] = "APPROVED"
                result = await trigger_automation(execution, step)
                execution.input["risk_level"] = original_risk
                approval["automation_result"] = result

        await send_notification(
            channels=["security-team"],
            template="approval_decided",
            context={
                "approval_id": approval_id,
                "playbook_id": approval.get("playbook_id", "unknown"),
                "status": approval["status"],
                "approved_by": body.approver,
                "reason": body.reason or "N/A",
            },
        )

        return {
            "success": True,
            "data": approval,
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# SLA endpoints
# ---------------------------------------------------------------------------


@app.get("/api/v1/sla/breaches", response_model=Dict[str, Any])
async def get_sla_breaches():
    """Check for current SLA breaches across all pending tasks."""
    breaches = await check_sla_breaches()
    return {
        "success": True,
        "data": {"breaches": breaches, "total": len(breaches)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/sla/config", response_model=Dict[str, Any])
async def get_sla_config():
    """Get current SLA configuration."""
    return {
        "success": True,
        "data": SLA_CONFIG,
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


# ---------------------------------------------------------------------------
# Audit log endpoint
# ---------------------------------------------------------------------------


@app.get("/api/v1/audit-logs", response_model=Dict[str, Any])
async def get_audit_logs(
    event_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = 50,
):
    """Query audit logs for workflow events."""
    if not db_manager:
        return {
            "success": True,
            "data": {"logs": [], "total": 0, "message": "Database not available"},
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    try:
        from sqlalchemy import select

        async with db_manager.get_session() as session:
            query = select(AuditLog).where(AuditLog.event_category == "workflow")
            if event_type:
                query = query.where(AuditLog.event_type == event_type)
            if target_id:
                query = query.where(AuditLog.target_id == target_id)
            query = query.order_by(AuditLog.timestamp.desc()).limit(limit)

            result = await session.execute(query)
            logs = result.scalars().all()

            log_data = [
                {
                    "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                    "event_type": log.event_type,
                    "action": log.action,
                    "actor_id": log.actor_id,
                    "target_type": log.target_type,
                    "target_id": log.target_id,
                    "details": log.details,
                    "status": log.status,
                    "error_message": log.error_message,
                }
                for log in logs
            ]

        return {
            "success": True,
            "data": {"logs": log_data, "total": len(log_data)},
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }
    except Exception as e:
        logger.error(f"Failed to query audit logs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to query audit logs: {str(e)}")


# ---------------------------------------------------------------------------
# Analyst pool management endpoints
# ---------------------------------------------------------------------------


@app.get("/api/v1/analysts", response_model=Dict[str, Any])
async def list_analysts():
    """List all analysts and their current workload."""
    return {
        "success": True,
        "data": {"analysts": ANALYST_POOL, "total": len(ANALYST_POOL)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


# ---------------------------------------------------------------------------
# Correlation endpoint
# ---------------------------------------------------------------------------


@app.post("/api/v1/correlate", response_model=Dict[str, Any])
async def correlate_alert(alert_data: Dict[str, Any]):
    """
    On-demand correlation analysis for an alert.

    Runs attack chain detection, root cause analysis, threat actor profiling,
    and impact analysis against recently cached alerts.
    """
    try:
        if not alert_data.get("alert_id"):
            raise HTTPException(status_code=400, detail="Missing required field: alert_id")

        result = await _run_correlation(alert_data)

        return {
            "success": True,
            "data": result,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": str(uuid.uuid4()),
                "recent_alerts_cached": len(recent_alerts_cache),
            },
        }
    except Exception as e:
        logger.error(f"Correlation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Correlation failed: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "workflow-engine",
        "timestamp": datetime.utcnow().isoformat(),
        "workflows": {
            "definitions": len(workflow_definitions),
            "active_executions": len(active_executions),
        },
        "tasks": {
            "pending": len(pending_tasks),
        },
        "approvals": {
            "pending": len([a for a in pending_approvals.values() if a["status"] == "pending"]),
            "total": len(pending_approvals),
        },
        "analysts": {
            "total": len(ANALYST_POOL),
            "available": len(
                [a for a in ANALYST_POOL if a["available"] and a["active_tasks"] < a["max_tasks"]]
            ),
        },
        "correlation": {
            "recent_alerts_cached": len(recent_alerts_cache),
        },
        "metrics": metrics.to_dict(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
