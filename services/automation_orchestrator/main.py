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

"""Automation Orchestrator Service - SOAR functionality for automated response."""

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shared.database import DatabaseManager, get_database_manager
from shared.database.models import AuditLog
from shared.database.repositories.workflow_repository import WorkflowRepository
from shared.errors import AutomationError
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import (
    AutomationPlaybook,
    PlaybookAction,
    PlaybookExecution,
    ResponseMeta,
    SuccessResponse,
    WorkflowStatus,
)
from shared.utils import Config, get_logger

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
publisher: MessagePublisher = None
consumer: MessageConsumer = None

# In-memory cache (backed by database)
active_executions: Dict[str, PlaybookExecution] = {}
playbooks: Dict[str, AutomationPlaybook] = {}

# Default automation playbooks
DEFAULT_PLAYBOOKS = {
    "malware-response": AutomationPlaybook(
        playbook_id="malware-response",
        name="Malware Response Playbook",
        description="Automated response actions for malware alerts",
        version="1.0.0",
        actions=[
            PlaybookAction(
                action_id="isolate-host",
                action_type="ssh_command",
                name="Isolate infected host from network",
                description="Block network access for infected host",
                parameters={
                    "command_template": "iptables -A INPUT -s {target_ip} -j DROP",
                    "target_host": "{target_ip}",
                    "timeout": 30,
                },
                timeout_seconds=60,
                rollback_action="remove_firewall_rule",
            ),
            PlaybookAction(
                action_id="quarantine-file",
                action_type="edr_command",
                name="Quarantine malicious file",
                description="Quarantine detected malicious file via EDR",
                parameters={"file_hash": "{file_hash}", "action": "quarantine"},
                timeout_seconds=120,
                rollback_action="restore_file",
            ),
            PlaybookAction(
                action_id="create-ticket",
                action_type="api_call",
                name="Create incident ticket",
                description="Create ticket in ticketing system",
                parameters={
                    "endpoint": "api/tickets",
                    "title": "Malware incident - {alert_id}",
                    "severity": "high",
                },
                timeout_seconds=30,
            ),
        ],
        approval_required=True,
        timeout_seconds=600,
        trigger_conditions={"alert_type": "malware", "risk_level": ["CRITICAL", "HIGH"]},
    ),
    "phishing-response": AutomationPlaybook(
        playbook_id="phishing-response",
        name="Phishing Response Playbook",
        description="Automated response for phishing alerts",
        version="1.0.0",
        actions=[
            PlaybookAction(
                action_id="block-sender",
                action_type="email_command",
                name="Block phishing sender",
                description="Block email sender at mail gateway",
                parameters={"action": "block_sender", "sender_address": "{sender_email}"},
                timeout_seconds=60,
                rollback_action="unblock_sender",
            ),
            PlaybookAction(
                action_id="delete-emails",
                action_type="email_command",
                name="Delete phishing emails",
                description="Remove all instances of phishing email",
                parameters={
                    "action": "delete",
                    "subject": "{email_subject}",
                    "sender": "{sender_email}",
                },
                timeout_seconds=300,
            ),
        ],
        approval_required=True,
        timeout_seconds=600,
        trigger_conditions={"alert_type": "phishing", "confidence_threshold": 80},
    ),
}


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------


async def audit_log(
    event_type: str,
    action: str,
    target_type: str = "playbook",
    target_id: Optional[str] = None,
    actor_id: str = "system",
    details: Optional[Dict[str, Any]] = None,
    old_values: Optional[Dict[str, Any]] = None,
    new_values: Optional[Dict[str, Any]] = None,
    status: str = "success",
    error_message: Optional[str] = None,
) -> None:
    """Record an audit log entry for an automation action."""
    if not db_manager:
        logger.debug(f"Audit log (no db): {event_type} {action} {target_type}:{target_id}")
        return

    try:
        async with db_manager.get_session() as session:
            log_entry = AuditLog(
                event_type=event_type,
                event_category="automation",
                action=action,
                actor_id=actor_id,
                actor_type="system",
                target_type=target_type,
                target_id=target_id,
                details=details,
                old_values=old_values,
                new_values=new_values,
                status=status,
                error_message=error_message,
            )
            session.add(log_entry)
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


# ---------------------------------------------------------------------------
# DB persistence helpers
# ---------------------------------------------------------------------------


async def persist_execution_start(execution: PlaybookExecution) -> None:
    """Persist a new execution record to the database."""
    if not db_manager:
        return
    try:
        async with db_manager.get_session() as session:
            repo = WorkflowRepository(session)
            await repo.create_workflow_execution(
                execution_id=execution.execution_id,
                workflow_id=execution.playbook_id,
                trigger_type="automation",
                trigger_reference=execution.trigger_alert_id,
                executed_by="system",
            )
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to persist execution to DB: {e}")


async def persist_execution_update(execution: PlaybookExecution) -> None:
    """Update execution record in the database."""
    if not db_manager:
        return
    try:
        async with db_manager.get_session() as session:
            repo = WorkflowRepository(session)
            duration = None
            if execution.completed_at and execution.started_at:
                duration = int((execution.completed_at - execution.started_at).total_seconds())
            await repo.update_workflow_execution(
                execution_id=execution.execution_id,
                status=execution.status.value,
                completed_at=execution.completed_at,
                duration_seconds=duration,
                steps_execution={"results": execution.results},
                result=json.dumps(execution.results[-1]) if execution.results else None,
                error_message=execution.error,
            )
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to update execution in DB: {e}")


async def persist_playbook(playbook: AutomationPlaybook) -> None:
    """Save a playbook definition to the database."""
    if not db_manager:
        return
    try:
        async with db_manager.get_session() as session:
            repo = WorkflowRepository(session)
            existing = await repo.get_workflow(playbook.playbook_id)
            if existing:
                await repo.update_workflow(
                    playbook.playbook_id,
                    name=playbook.name,
                    description=playbook.description,
                    steps=[a.model_dump() for a in playbook.actions],
                    trigger_conditions=playbook.trigger_conditions,
                )
            else:
                await repo.create_workflow(
                    workflow_id=playbook.playbook_id,
                    name=playbook.name,
                    description=playbook.description,
                    category="automation",
                    steps=[a.model_dump() for a in playbook.actions],
                    trigger_type="alert_created",
                    trigger_conditions=playbook.trigger_conditions,
                    status="active",
                    priority="high",
                    created_by="system",
                )
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to persist playbook to DB: {e}")


# ---------------------------------------------------------------------------
# Action executors
# ---------------------------------------------------------------------------


class ActionExecutor:
    """Base class for action executors."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute an action."""
        raise NotImplementedError


class SSHCommandExecutor(ActionExecutor):
    """Execute SSH commands on remote hosts."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute SSH command (mock - replace with asyncssh in production)."""
        try:
            command_template = action.parameters.get("command_template", "")
            target_host = action.parameters.get("target_host", "")

            command = command_template.format(**context) if command_template else ""
            target = target_host.format(**context) if target_host else ""

            logger.info(f"Executing SSH command on {target}: {command}")

            # TODO: Implement actual SSH execution with asyncssh
            await asyncio.sleep(0.5)

            return {
                "status": "success",
                "output": f"Command executed successfully on {target}",
                "exit_code": 0,
            }

        except Exception as e:
            logger.error(f"SSH command execution failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class EDRCommandExecutor(ActionExecutor):
    """Execute commands via EDR (Endpoint Detection and Response)."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute EDR command (mock - replace with real EDR API in production)."""
        try:
            raw_hash = action.parameters.get("file_hash", "")
            file_hash = raw_hash.format(**context) if isinstance(raw_hash, str) else raw_hash
            edr_action = action.parameters.get("action", "quarantine")

            logger.info(f"Executing EDR action: {edr_action} for file {file_hash}")

            await asyncio.sleep(0.5)

            return {"status": "success", "output": f"File {file_hash} {edr_action}d successfully"}

        except Exception as e:
            logger.error(f"EDR command execution failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class EmailCommandExecutor(ActionExecutor):
    """Execute email gateway commands."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute email gateway command (mock - replace with real API in production)."""
        try:
            email_action = action.parameters.get("action", "")
            raw_sender = action.parameters.get("sender_address", "")
            sender = raw_sender.format(**context) if isinstance(raw_sender, str) else raw_sender

            logger.info(f"Executing email gateway action: {email_action} for sender {sender}")

            await asyncio.sleep(0.5)

            return {
                "status": "success",
                "output": f"Email action {email_action} completed for {sender}",
            }

        except Exception as e:
            logger.error(f"Email command execution failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class APICallExecutor(ActionExecutor):
    """Execute HTTP API calls."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute HTTP API call."""
        try:
            import httpx

            endpoint = action.parameters.get("endpoint", "").format(**context)
            method = action.parameters.get("method", "POST").upper()

            url = f"{context.get('base_url', '')}/{endpoint}"
            headers = action.parameters.get("headers", {})
            body = {
                k: v.format(**context) if isinstance(v, str) else v
                for k, v in action.parameters.get("body", {}).items()
            }

            logger.info(f"Executing API call: {method} {url}")

            async with httpx.AsyncClient() as client:
                if method == "GET":
                    response = await client.get(url, headers=headers, params=body)
                elif method == "POST":
                    response = await client.post(url, headers=headers, json=body)
                elif method == "PUT":
                    response = await client.put(url, headers=headers, json=body)
                elif method == "DELETE":
                    response = await client.delete(url, headers=headers)
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")

                response.raise_for_status()

                return {
                    "status": "success",
                    "output": response.json(),
                    "status_code": response.status_code,
                }

        except Exception as e:
            logger.error(f"API call execution failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class NotificationExecutor(ActionExecutor):
    """Execute notification actions (mock - replace with real notification service)."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        try:
            channels = action.parameters.get("channels", [])
            recipients = action.parameters.get("recipients", [])
            raw_msg = action.parameters.get("message", "")
            message = raw_msg.format(**context) if isinstance(raw_msg, str) else str(raw_msg)

            logger.info(f"Sending notification to {recipients} via {channels}")
            await asyncio.sleep(0.3)

            return {
                "status": "success",
                "output": f"Notification sent to {len(recipients)} recipients via {channels}",
            }
        except Exception as e:
            logger.error(f"Notification failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class FirewallRuleExecutor(ActionExecutor):
    """Execute firewall rule changes (mock)."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        try:
            raw_rule = action.parameters.get("rule_template", "")
            rule = raw_rule.format(**context) if isinstance(raw_rule, str) else str(raw_rule)
            logger.info(f"Applying firewall rule: {rule}")
            await asyncio.sleep(0.3)
            return {"status": "success", "output": f"Firewall rule applied: {rule}"}
        except Exception as e:
            logger.error(f"Firewall rule failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class ADCommandExecutor(ActionExecutor):
    """Execute Active Directory commands (mock)."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        try:
            raw_user = action.parameters.get("username", "")
            username = raw_user.format(**context) if isinstance(raw_user, str) else str(raw_user)
            logger.info(f"Executing AD command for user: {username}")
            await asyncio.sleep(0.3)
            return {"status": "success", "output": f"AD command executed for {username}"}
        except Exception as e:
            logger.error(f"AD command failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


class GenericExecutor(ActionExecutor):
    """Generic executor for action types without specific implementation."""

    async def execute(self, action: PlaybookAction, context: Dict[str, Any]) -> Dict[str, Any]:
        try:
            logger.info(f"Executing generic action: {action.action_type} ({action.action_id})")
            await asyncio.sleep(0.3)
            return {"status": "success", "output": f"Action {action.action_type} executed (mock)"}
        except Exception as e:
            logger.error(f"Generic action failed: {e}", exc_info=True)
            return {"status": "failed", "error": str(e)}


# Action executor registry
ACTION_EXECUTORS = {
    "ssh_command": SSHCommandExecutor(),
    "edr_command": EDRCommandExecutor(),
    "email_command": EmailCommandExecutor(),
    "api_call": APICallExecutor(),
    "notification": NotificationExecutor(),
    "firewall_rule": FirewallRuleExecutor(),
    "ad_command": ADCommandExecutor(),
    "network_change": GenericExecutor(),
    "email_action": GenericExecutor(),
    "email_filter": GenericExecutor(),
    "security_filter": GenericExecutor(),
    "threat_intel_upload": GenericExecutor(),
    "rate_limit": GenericExecutor(),
    "security_config": GenericExecutor(),
    "forensics": GenericExecutor(),
    "access_control": GenericExecutor(),
    "log_collection": GenericExecutor(),
    "audit_log": GenericExecutor(),
    "workflow_trigger": GenericExecutor(),
}


# ---------------------------------------------------------------------------
# Playbook execution logic
# ---------------------------------------------------------------------------


async def execute_playbook_action(
    execution: PlaybookExecution, action: PlaybookAction, context: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute a single playbook action."""
    try:
        logger.info(
            f"Executing action {action.action_id} "
            f"(type: {action.action_type}) for execution {execution.execution_id}"
        )

        # Check conditions
        if action.conditions:
            for condition in action.conditions:
                field = condition.get("field", "")
                operator = condition.get("operator", "==")
                value = condition.get("value")
                ctx_value = context.get(field)
                if operator == "==" and ctx_value != value:
                    return {"status": "skipped", "output": f"Condition not met: {field} {operator} {value}"}
                elif operator == "!=" and ctx_value == value:
                    return {"status": "skipped", "output": f"Condition not met: {field} {operator} {value}"}
                elif operator == "in" and ctx_value not in (value or []):
                    return {"status": "skipped", "output": f"Condition not met: {field} {operator} {value}"}

        # Get executor
        executor = ACTION_EXECUTORS.get(action.action_type)
        if not executor:
            raise AutomationError(f"No executor found for action type: {action.action_type}")

        # Execute action with timeout
        result = await asyncio.wait_for(
            executor.execute(action, context), timeout=action.timeout_seconds
        )

        # Audit log for action execution
        await audit_log(
            event_type="automation.action_executed",
            action="execute",
            target_type="action",
            target_id=action.action_id,
            details={
                "execution_id": execution.execution_id,
                "action_type": action.action_type,
                "result_status": result.get("status"),
            },
            status="success" if result.get("status") == "success" else "failure",
            error_message=result.get("error"),
        )

        return result

    except asyncio.TimeoutError:
        logger.error(f"Action {action.action_id} timed out")
        return {
            "status": "failed",
            "error": f"Action timed out after {action.timeout_seconds} seconds",
        }

    except Exception as e:
        logger.error(f"Action execution failed: {e}", exc_info=True)
        return {"status": "failed", "error": str(e)}


async def perform_rollback(
    execution: PlaybookExecution,
    playbook: AutomationPlaybook,
    context: Dict[str, Any],
    failed_action_index: int,
) -> None:
    """Roll back successfully completed actions in reverse order."""
    logger.warning(f"Starting rollback for execution {execution.execution_id}")

    rollback_results = []
    for i in range(failed_action_index - 1, -1, -1):
        action = playbook.actions[i]
        rollback_action_type = action.rollback_action
        if not rollback_action_type:
            continue

        try:
            logger.info(f"Rolling back action {action.action_id} using {rollback_action_type}")
            rollback = PlaybookAction(
                action_id=f"rollback-{action.action_id}",
                action_type=action.action_type,
                name=f"Rollback: {action.name}",
                description=f"Rollback action for {action.action_id}",
                parameters={
                    **action.parameters,
                    "rollback": True,
                    "rollback_action": rollback_action_type,
                },
                timeout_seconds=action.timeout_seconds,
            )
            result = await execute_playbook_action(execution, rollback, context)
            rollback_results.append({
                "action_id": action.action_id,
                "rollback_action": rollback_action_type,
                "result": result,
            })

            await audit_log(
                event_type="automation.rollback",
                action="rollback",
                target_type="action",
                target_id=action.action_id,
                details={
                    "execution_id": execution.execution_id,
                    "rollback_action": rollback_action_type,
                    "result": result,
                },
                status="success" if result.get("status") == "success" else "failure",
            )
        except Exception as e:
            logger.error(f"Rollback failed for {action.action_id}: {e}")
            rollback_results.append({
                "action_id": action.action_id,
                "error": str(e),
            })

    execution.rollback_performed = True
    execution.results.append({
        "type": "rollback",
        "executed_at": datetime.utcnow().isoformat(),
        "rollback_results": rollback_results,
    })

    logger.info(f"Rollback completed for execution {execution.execution_id}")


async def execute_playbook(execution: PlaybookExecution):
    """Execute playbook actions sequentially."""
    try:
        playbook = playbooks.get(execution.playbook_id)
        if not playbook:
            raise AutomationError(f"Playbook not found: {execution.playbook_id}")

        execution.status = WorkflowStatus.RUNNING
        active_executions[execution.execution_id] = execution

        # Build execution context
        context = {
            "alert_id": execution.trigger_alert_id,
            "execution_id": execution.execution_id,
            **execution.input_data,
        }

        # Check approval
        if playbook.approval_required and execution.approval_status != "approved":
            execution.status = WorkflowStatus.PENDING
            logger.info(f"Playbook {execution.playbook_id} awaiting approval")
            return

        await audit_log(
            event_type="automation.execution_started",
            action="start",
            target_type="execution",
            target_id=execution.execution_id,
            details={
                "playbook_id": execution.playbook_id,
                "alert_id": execution.trigger_alert_id,
            },
        )

        # Execute each action
        for i, action in enumerate(playbook.actions):
            execution.current_action_index = i
            execution.current_action = action.action_id

            logger.info(f"Executing action {i + 1}/{len(playbook.actions)}: {action.action_id}")

            result = await execute_playbook_action(execution, action, context)

            # Store result
            execution.results.append(
                {
                    "action_id": action.action_id,
                    "action_name": action.name,
                    "executed_at": datetime.utcnow().isoformat(),
                    "result": result,
                }
            )

            # Skip doesn't count as failure
            if result.get("status") == "skipped":
                continue

            # Check if action failed
            if result.get("status") == "failed":
                execution.status = WorkflowStatus.FAILED
                execution.error = f"Action {action.action_id} failed: {result.get('error')}"
                execution.completed_at = datetime.utcnow()

                # Perform rollback for previously succeeded actions
                await perform_rollback(execution, playbook, context, i)
                break

        # If all actions succeeded
        if execution.status == WorkflowStatus.RUNNING:
            execution.status = WorkflowStatus.COMPLETED
            execution.completed_at = datetime.utcnow()
            execution.current_action = None

        # Persist to DB
        await persist_execution_update(execution)

        # Publish completion event
        try:
            await publisher.publish(
                "automation.completed",
                {
                    "message_id": str(uuid.uuid4()),
                    "message_type": "automation.completed",
                    "payload": execution.model_dump(),
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
        except Exception as e:
            logger.warning(f"Failed to publish completion event: {e}")

        await audit_log(
            event_type="automation.execution_completed",
            action="complete",
            target_type="execution",
            target_id=execution.execution_id,
            details={
                "playbook_id": execution.playbook_id,
                "final_status": execution.status.value,
                "actions_executed": len(execution.results),
                "rollback_performed": execution.rollback_performed,
            },
            status="success" if execution.status == WorkflowStatus.COMPLETED else "failure",
            error_message=execution.error,
        )

        logger.info(
            f"Playbook execution {execution.execution_id} completed: {execution.status.value}"
        )

    except Exception as e:
        logger.error(f"Playbook execution failed: {e}", exc_info=True)
        execution.status = WorkflowStatus.FAILED
        execution.error = str(e)
        execution.completed_at = datetime.utcnow()
        await persist_execution_update(execution)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, publisher, consumer, playbooks

    logger.info("Starting Automation Orchestrator service...")

    # Initialize database
    db_manager = get_database_manager()
    await db_manager.initialize()

    # Initialize messaging
    publisher = MessagePublisher(config.rabbitmq_url)
    await publisher.connect()

    consumer = MessageConsumer(config.rabbitmq_url, "automation.trigger")
    await consumer.connect()

    # Load default playbooks
    playbooks.update(DEFAULT_PLAYBOOKS)

    # Load extended playbooks from playbooks module
    try:
        from services.automation_orchestrator.playbooks import get_all_playbooks

        playbooks.update(get_all_playbooks())
    except Exception:
        try:
            from playbooks import get_all_playbooks

            playbooks.update(get_all_playbooks())
        except Exception as e:
            logger.warning(f"Could not load extended playbooks: {e}")

    # Persist playbooks to DB
    for pb in playbooks.values():
        asyncio.create_task(persist_playbook(pb))

    # Start consuming automation triggers
    asyncio.create_task(consume_automation_triggers())

    logger.info("Automation Orchestrator service started successfully")

    yield

    # Cleanup
    await consumer.close()
    await publisher.close()
    await db_manager.close()
    logger.info("Automation Orchestrator service stopped")


app = FastAPI(
    title="Automation Orchestrator Service",
    description="SOAR functionality for automated security response",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Message consumption
# ---------------------------------------------------------------------------


async def consume_automation_triggers():
    """Consume automation trigger messages from queue."""

    async def process_message(message: dict):
        try:
            payload = message["payload"]
            playbook_id = payload.get("playbook_id")
            alert_id = payload.get("alert_id")
            input_data = payload.get("input", {})

            if not playbook_id:
                logger.error("Missing playbook_id in trigger message")
                return

            execution = await start_playbook_execution(playbook_id, alert_id, input_data)
            logger.info(f"Started playbook execution {execution.execution_id}")

        except Exception as e:
            logger.error(f"Failed to process automation trigger: {e}", exc_info=True)

    await consumer.consume(process_message)


async def start_playbook_execution(
    playbook_id: str, alert_id: str, input_data: Dict[str, Any]
) -> PlaybookExecution:
    """Start a new playbook execution."""
    execution = PlaybookExecution(
        execution_id=f"pb-exec-{uuid.uuid4()}",
        playbook_id=playbook_id,
        trigger_alert_id=alert_id,
        status=WorkflowStatus.PENDING,
        started_at=datetime.utcnow(),
        results=[],
        input_data=input_data,
    )

    # Persist to DB
    await persist_execution_start(execution)

    # Start execution in background
    asyncio.create_task(execute_playbook(execution))

    return execution


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/playbooks", response_model=Dict[str, Any])
async def create_playbook(playbook: AutomationPlaybook):
    """Create a new automation playbook."""
    try:
        playbooks[playbook.playbook_id] = playbook

        # Persist to DB
        await persist_playbook(playbook)

        await audit_log(
            event_type="automation.playbook_created",
            action="create",
            target_type="playbook",
            target_id=playbook.playbook_id,
            details={"name": playbook.name, "actions_count": len(playbook.actions)},
        )

        return {
            "success": True,
            "data": playbook.model_dump(),
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to create playbook: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create playbook: {str(e)}")


@app.get("/api/v1/playbooks", response_model=Dict[str, Any])
async def list_playbooks():
    """List all automation playbooks."""
    return {
        "success": True,
        "data": {
            "playbooks": [pb.model_dump() for pb in playbooks.values()],
            "total": len(playbooks),
        },
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/playbooks/{playbook_id}", response_model=Dict[str, Any])
async def get_playbook(playbook_id: str):
    """Get a specific playbook."""
    playbook = playbooks.get(playbook_id)
    if not playbook:
        raise HTTPException(status_code=404, detail=f"Playbook not found: {playbook_id}")

    return {
        "success": True,
        "data": playbook.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.delete("/api/v1/playbooks/{playbook_id}", response_model=Dict[str, Any])
async def delete_playbook(playbook_id: str):
    """Delete a playbook."""
    if playbook_id not in playbooks:
        raise HTTPException(status_code=404, detail=f"Playbook not found: {playbook_id}")

    del playbooks[playbook_id]

    if db_manager:
        try:
            async with db_manager.get_session() as session:
                repo = WorkflowRepository(session)
                await repo.delete_workflow(playbook_id)
                await session.commit()
        except Exception as e:
            logger.warning(f"Failed to delete playbook from DB: {e}")

    await audit_log(
        event_type="automation.playbook_deleted",
        action="delete",
        target_type="playbook",
        target_id=playbook_id,
    )

    return {
        "success": True,
        "message": f"Playbook {playbook_id} deleted",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/playbooks/execute", response_model=Dict[str, Any])
async def execute_playbook_api(
    playbook_id: str,
    alert_id: str,
    input_data: Dict[str, Any] = None,
    background_tasks: BackgroundTasks = None,
):
    """Start playbook execution via API."""
    try:
        if playbook_id not in playbooks:
            raise HTTPException(status_code=404, detail=f"Playbook not found: {playbook_id}")

        execution = await start_playbook_execution(playbook_id, alert_id, input_data or {})

        return {
            "success": True,
            "data": {
                "execution_id": execution.execution_id,
                "playbook_id": execution.playbook_id,
                "trigger_alert_id": execution.trigger_alert_id,
                "status": execution.status.value,
                "started_at": execution.started_at.isoformat(),
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start playbook execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start playbook execution: {str(e)}")


@app.get("/api/v1/executions", response_model=Dict[str, Any])
async def list_executions(
    status: Optional[WorkflowStatus] = None, playbook_id: Optional[str] = None
):
    """List playbook executions."""
    executions = list(active_executions.values())

    if status:
        executions = [e for e in executions if e.status == status]

    if playbook_id:
        executions = [e for e in executions if e.playbook_id == playbook_id]

    return {
        "success": True,
        "data": {"executions": [e.model_dump() for e in executions], "total": len(executions)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/executions/{execution_id}", response_model=Dict[str, Any])
async def get_execution(execution_id: str):
    """Get a specific playbook execution."""
    execution = active_executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    return {
        "success": True,
        "data": execution.model_dump(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/executions/{execution_id}/approve", response_model=Dict[str, Any])
async def approve_execution(execution_id: str, approver: str, comments: Optional[str] = None):
    """Approve a playbook execution awaiting approval."""
    execution = active_executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    if execution.status != WorkflowStatus.PENDING:
        raise HTTPException(
            status_code=400, detail=f"Execution not in PENDING status: {execution.status.value}"
        )

    execution.approval_status = "approved"
    execution.approved_by = approver

    # Resume execution
    asyncio.create_task(execute_playbook(execution))

    await audit_log(
        event_type="automation.execution_approved",
        action="approve",
        target_type="execution",
        target_id=execution_id,
        actor_id=approver,
        details={"comments": comments, "playbook_id": execution.playbook_id},
    )

    return {
        "success": True,
        "message": "Execution approved",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.post("/api/v1/executions/{execution_id}/cancel", response_model=Dict[str, Any])
async def cancel_execution(execution_id: str):
    """Cancel a running playbook execution."""
    execution = active_executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail=f"Execution not found: {execution_id}")

    if execution.status not in [WorkflowStatus.PENDING, WorkflowStatus.RUNNING]:
        raise HTTPException(
            status_code=400, detail=f"Cannot cancel execution in status: {execution.status.value}"
        )

    execution.status = WorkflowStatus.CANCELLED
    execution.completed_at = datetime.utcnow()

    await persist_execution_update(execution)

    await audit_log(
        event_type="automation.execution_cancelled",
        action="cancel",
        target_type="execution",
        target_id=execution_id,
        details={"playbook_id": execution.playbook_id},
    )

    return {
        "success": True,
        "message": "Execution cancelled",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/executions/{execution_id}/audit", response_model=Dict[str, Any])
async def get_execution_audit_trail(execution_id: str):
    """Get audit trail for a specific execution."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        from sqlalchemy import select

        async with db_manager.get_session() as session:
            result = await session.execute(
                select(AuditLog)
                .where(AuditLog.target_id == execution_id)
                .order_by(AuditLog.timestamp.asc())
            )
            logs = result.scalars().all()

            return {
                "success": True,
                "data": {
                    "execution_id": execution_id,
                    "audit_trail": [
                        {
                            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                            "event_type": log.event_type,
                            "action": log.action,
                            "actor_id": log.actor_id,
                            "details": log.details,
                            "status": log.status,
                            "error_message": log.error_message,
                        }
                        for log in logs
                    ],
                    "total": len(logs),
                },
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "request_id": str(uuid.uuid4()),
                },
            }
    except Exception as e:
        logger.error(f"Failed to get audit trail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get audit trail: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "automation-orchestrator",
        "timestamp": datetime.utcnow().isoformat(),
        "playbooks": {"total": len(playbooks), "active_executions": len(active_executions)},
        "executors": list(ACTION_EXECUTORS.keys()),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
