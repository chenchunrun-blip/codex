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
Decision Engine Service - Determines actions for triaged security alerts.

This service consumes triaged alerts and makes decisions about:
- Human review requirements (based on risk score, confidence, alert type)
- Escalation decisions (SLA-based, severity-based, pattern-based)
- Routing rules (route alerts to appropriate analysts/teams)
- Auto-close logic for low-risk alerts
- Approval workflow triggering for high-risk automated responses
"""

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.messaging import MessageConsumer, MessagePublisher
from shared.utils import Config, get_logger

# Initialize logger
logger = get_logger(__name__)

# Initialize config
config = Config()

# Global variables
db_manager: DatabaseManager = None
publisher: MessagePublisher = None
consumer: MessageConsumer = None


# =============================================================================
# Decision Result Tracking
# =============================================================================

# In-memory tracking (backed by database for persistence)
decisions_made: Dict[str, Dict[str, Any]] = {}
pending_approvals: Dict[str, Dict[str, Any]] = {}
escalation_timers: Dict[str, Dict[str, Any]] = {}

# Metrics counters
decision_metrics: Dict[str, int] = {
    "total_decisions": 0,
    "human_review_required": 0,
    "auto_assigned": 0,
    "auto_closed": 0,
    "escalations": 0,
    "approval_requests": 0,
}


# =============================================================================
# SLA Configuration
# =============================================================================

SLA_CONFIG: Dict[str, Dict[str, int]] = {
    "critical": {"response_minutes": 5, "resolve_minutes": 30},
    "high": {"response_minutes": 15, "resolve_minutes": 120},
    "medium": {"response_minutes": 60, "resolve_minutes": 480},
    "low": {"response_minutes": 240, "resolve_minutes": 1440},
    "info": {"response_minutes": 480, "resolve_minutes": 2880},
}


# =============================================================================
# Analyst Pool
# =============================================================================

ANALYST_POOL: List[Dict[str, Any]] = [
    {
        "id": "analyst-1",
        "name": "Analyst 1",
        "skills": ["malware", "phishing", "incident_response"],
        "team": "soc-tier1",
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
    {
        "id": "analyst-2",
        "name": "Analyst 2",
        "skills": ["brute_force", "data_exfiltration", "anomaly"],
        "team": "soc-tier1",
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
    {
        "id": "analyst-3",
        "name": "Analyst 3",
        "skills": ["malware", "brute_force", "phishing", "incident_response"],
        "team": "soc-tier2",
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
    {
        "id": "analyst-4",
        "name": "Analyst 4",
        "skills": ["data_exfiltration", "anomaly", "insider_threat"],
        "team": "soc-tier2",
        "active_tasks": 0,
        "max_tasks": 5,
        "available": True,
    },
    {
        "id": "analyst-5",
        "name": "Analyst 5",
        "skills": ["malware", "data_exfiltration", "brute_force", "phishing", "anomaly"],
        "team": "soc-tier3",
        "active_tasks": 0,
        "max_tasks": 3,
        "available": True,
    },
]


# =============================================================================
# Approval Levels
# =============================================================================

APPROVAL_LEVELS: Dict[str, Dict[str, Any]] = {
    "low": {
        "approver_role": "auto",
        "description": "Auto-approved for low risk actions",
        "timeout_minutes": 0,
    },
    "medium": {
        "approver_role": "team_lead",
        "description": "Team lead approval required",
        "timeout_minutes": 30,
    },
    "high": {
        "approver_role": "manager",
        "description": "Manager approval required",
        "timeout_minutes": 15,
    },
    "critical": {
        "approver_role": "director",
        "description": "Director approval required",
        "timeout_minutes": 10,
    },
}


# =============================================================================
# API Request/Response Models
# =============================================================================


class DecisionRequest(BaseModel):
    """Request model for manual decision evaluation."""

    alert_id: str
    risk_score: float = Field(ge=0.0, le=100.0)
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    alert_type: str = "unknown"
    severity: str = "medium"
    asset_criticality: str = "medium"


class RuleUpdateRequest(BaseModel):
    """Request model for updating decision rules."""

    rule_id: str
    enabled: Optional[bool] = None
    threshold: Optional[float] = None
    description: Optional[str] = None


class EscalationCheckRequest(BaseModel):
    """Request model for escalation check."""

    alert_id: str
    priority: str = "medium"
    created_at: Optional[str] = None


# =============================================================================
# Decision Rules Engine
# =============================================================================


def determine_priority(risk_score: float) -> str:
    """
    Determine alert priority based on risk score.

    Args:
        risk_score: Calculated risk score (0-100)

    Returns:
        Priority level string
    """
    if risk_score >= 90:
        return "critical"
    elif risk_score >= 70:
        return "high"
    elif risk_score >= 40:
        return "medium"
    elif risk_score >= 20:
        return "low"
    else:
        return "info"


def determine_human_review(
    risk_score: float,
    confidence: float,
    alert_type: str,
) -> bool:
    """
    Determine if human review is required.

    Args:
        risk_score: Calculated risk score (0-100)
        confidence: AI confidence level (0-1)
        alert_type: Type of alert

    Returns:
        True if human review is required
    """
    # High/critical risk always requires human review
    if risk_score >= 70:
        return True

    # Low confidence requires human review regardless of risk
    if confidence < 0.5:
        return True

    # Certain alert types always require review above a threshold
    high_sensitivity_types = {"data_exfiltration", "insider_threat", "apt"}
    if alert_type in high_sensitivity_types and risk_score >= 40:
        return True

    return False


def determine_auto_close(
    risk_score: float,
    confidence: float,
    alert_type: str,
) -> bool:
    """
    Determine if an alert is a candidate for auto-close.

    Args:
        risk_score: Calculated risk score (0-100)
        confidence: AI confidence level (0-1)
        alert_type: Type of alert

    Returns:
        True if alert can be auto-closed
    """
    # Only auto-close info-level alerts with high confidence
    if risk_score < 20 and confidence >= 0.8:
        # Never auto-close certain sensitive types
        no_auto_close_types = {"data_exfiltration", "insider_threat", "apt"}
        if alert_type not in no_auto_close_types:
            return True

    return False


def determine_auto_escalate(risk_score: float, severity: str) -> bool:
    """
    Determine if an alert should be auto-escalated.

    Args:
        risk_score: Calculated risk score (0-100)
        severity: Alert severity level

    Returns:
        True if alert should be auto-escalated
    """
    # Critical risk always escalates
    if risk_score >= 90:
        return True

    # High severity with high risk escalates
    if severity == "critical" and risk_score >= 70:
        return True

    return False


def determine_approval_level(risk_score: float) -> str:
    """
    Determine the approval level needed for automated response actions.

    Args:
        risk_score: Calculated risk score (0-100)

    Returns:
        Approval level string
    """
    if risk_score >= 90:
        return "critical"
    elif risk_score >= 70:
        return "high"
    elif risk_score >= 40:
        return "medium"
    else:
        return "low"


def select_analyst(alert_type: str, priority: str) -> Optional[Dict[str, Any]]:
    """
    Select the best analyst for an alert based on skill match and workload.

    Routing logic:
    - Match alert_type to analyst skill sets
    - Filter by availability and capacity
    - Load-balance across available analysts (least loaded first)
    - Prefer higher-tier analysts for higher-priority alerts

    Args:
        alert_type: Type of alert to assign
        priority: Alert priority level

    Returns:
        Selected analyst dict or None if no analyst available
    """
    candidates = []

    for analyst in ANALYST_POOL:
        if not analyst["available"]:
            continue
        if analyst["active_tasks"] >= analyst["max_tasks"]:
            continue

        # Skill match score
        skill_match = 1 if alert_type in analyst["skills"] else 0

        # For critical/high priority, prefer tier2/tier3 analysts
        tier_bonus = 0
        if priority in ("critical", "high"):
            if analyst["team"] == "soc-tier3":
                tier_bonus = 2
            elif analyst["team"] == "soc-tier2":
                tier_bonus = 1

        # Lower active_tasks = higher availability score
        availability_score = analyst["max_tasks"] - analyst["active_tasks"]

        candidates.append(
            {
                "analyst": analyst,
                "score": skill_match * 10 + tier_bonus * 5 + availability_score,
            }
        )

    if not candidates:
        return None

    # Sort by score descending, pick best
    candidates.sort(key=lambda c: c["score"], reverse=True)
    selected = candidates[0]["analyst"]

    # Update workload
    selected["active_tasks"] += 1

    logger.info(
        f"Selected analyst {selected['id']} for alert_type={alert_type}, "
        f"priority={priority}, active_tasks={selected['active_tasks']}"
    )

    return selected


def calculate_sla_deadline(priority: str, created_at: datetime) -> Dict[str, datetime]:
    """
    Calculate SLA response and resolution deadlines.

    Args:
        priority: Alert priority level
        created_at: When the alert was created

    Returns:
        Dict with response_deadline and resolve_deadline
    """
    sla = SLA_CONFIG.get(priority, SLA_CONFIG["medium"])
    return {
        "response_deadline": created_at + timedelta(minutes=sla["response_minutes"]),
        "resolve_deadline": created_at + timedelta(minutes=sla["resolve_minutes"]),
    }


def check_sla_breach(
    priority: str,
    created_at: datetime,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Check if SLA deadlines have been breached.

    Args:
        priority: Alert priority level
        created_at: When the alert was created
        now: Current time (defaults to utcnow)

    Returns:
        SLA breach status dict
    """
    if now is None:
        now = datetime.utcnow()

    deadlines = calculate_sla_deadline(priority, created_at)

    response_breached = now > deadlines["response_deadline"]
    resolve_breached = now > deadlines["resolve_deadline"]

    response_remaining = (deadlines["response_deadline"] - now).total_seconds()
    resolve_remaining = (deadlines["resolve_deadline"] - now).total_seconds()

    return {
        "priority": priority,
        "response_deadline": deadlines["response_deadline"].isoformat(),
        "resolve_deadline": deadlines["resolve_deadline"].isoformat(),
        "response_breached": response_breached,
        "resolve_breached": resolve_breached,
        "response_remaining_seconds": max(0, response_remaining),
        "resolve_remaining_seconds": max(0, resolve_remaining),
        "needs_escalation": response_breached or resolve_breached,
    }


# =============================================================================
# Core Decision Logic
# =============================================================================


async def make_decision(
    alert_id: str,
    risk_score: float,
    confidence: float = 0.8,
    alert_type: str = "unknown",
    severity: str = "medium",
    asset_criticality: str = "medium",
    triage_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Make a comprehensive decision for a triaged alert.

    This is the core decision function that evaluates all rules and produces
    a decision result including priority, review requirements, routing,
    escalation, and approval needs.

    Args:
        alert_id: Alert identifier
        risk_score: Calculated risk score (0-100)
        confidence: AI confidence level (0-1)
        alert_type: Type of security alert
        severity: Alert severity level
        asset_criticality: Criticality of the affected asset
        triage_result: Full triage result data (optional)

    Returns:
        Decision result dictionary
    """
    now = datetime.utcnow()

    # Determine priority
    priority = determine_priority(risk_score)

    # Human review determination
    requires_human_review = determine_human_review(risk_score, confidence, alert_type)

    # Auto-close candidate
    auto_close = determine_auto_close(risk_score, confidence, alert_type)

    # Auto-escalate
    auto_escalate = determine_auto_escalate(risk_score, severity)

    # Approval level for automated responses
    approval_level = determine_approval_level(risk_score)
    approval_config = APPROVAL_LEVELS.get(approval_level, APPROVAL_LEVELS["medium"])

    # SLA deadlines
    sla_deadlines = calculate_sla_deadline(priority, now)

    # Analyst routing (skip if auto-close)
    assigned_analyst = None
    if not auto_close:
        assigned_analyst = select_analyst(alert_type, priority)

    # Build decision result
    decision = {
        "decision_id": str(uuid.uuid4()),
        "alert_id": alert_id,
        "decided_at": now.isoformat(),
        "priority": priority,
        "risk_score": risk_score,
        "confidence": confidence,
        "alert_type": alert_type,
        "severity": severity,
        "asset_criticality": asset_criticality,
        "requires_human_review": requires_human_review,
        "auto_close": auto_close,
        "auto_escalate": auto_escalate,
        "approval": {
            "level": approval_level,
            "approver_role": approval_config["approver_role"],
            "description": approval_config["description"],
            "auto_approved": approval_config["approver_role"] == "auto",
            "timeout_minutes": approval_config["timeout_minutes"],
        },
        "routing": {
            "assigned_analyst": (
                {
                    "id": assigned_analyst["id"],
                    "name": assigned_analyst["name"],
                    "team": assigned_analyst["team"],
                }
                if assigned_analyst
                else None
            ),
            "assignment_reason": _build_assignment_reason(alert_type, priority, assigned_analyst),
        },
        "sla": {
            "response_deadline": sla_deadlines["response_deadline"].isoformat(),
            "resolve_deadline": sla_deadlines["resolve_deadline"].isoformat(),
            "response_minutes": SLA_CONFIG.get(priority, SLA_CONFIG["medium"])["response_minutes"],
            "resolve_minutes": SLA_CONFIG.get(priority, SLA_CONFIG["medium"])["resolve_minutes"],
        },
        "actions": _determine_actions(
            priority, requires_human_review, auto_close, auto_escalate, approval_level
        ),
    }

    # Track the decision
    decisions_made[alert_id] = decision

    # Update metrics
    decision_metrics["total_decisions"] += 1
    if requires_human_review:
        decision_metrics["human_review_required"] += 1
    if auto_close:
        decision_metrics["auto_closed"] += 1
    elif assigned_analyst:
        decision_metrics["auto_assigned"] += 1
    if auto_escalate:
        decision_metrics["escalations"] += 1
    if approval_config["approver_role"] != "auto":
        decision_metrics["approval_requests"] += 1

    # Track escalation timer
    escalation_timers[alert_id] = {
        "priority": priority,
        "created_at": now,
        "sla_deadlines": sla_deadlines,
        "escalated": False,
    }

    logger.info(
        f"Decision made for alert {alert_id}: priority={priority}, "
        f"human_review={requires_human_review}, auto_close={auto_close}, "
        f"auto_escalate={auto_escalate}, approval_level={approval_level}",
        extra={
            "alert_id": alert_id,
            "decision_id": decision["decision_id"],
            "priority": priority,
        },
    )

    return decision


def _build_assignment_reason(
    alert_type: str, priority: str, analyst: Optional[Dict[str, Any]]
) -> str:
    """Build a human-readable reason for analyst assignment."""
    if analyst is None:
        return "No analyst available; queued for assignment"

    reasons = []
    if alert_type in analyst.get("skills", []):
        reasons.append(f"skill match for {alert_type}")
    else:
        reasons.append("best available analyst (no exact skill match)")

    reasons.append(f"workload: {analyst['active_tasks']}/{analyst['max_tasks']}")
    reasons.append(f"team: {analyst['team']}")

    return "; ".join(reasons)


def _determine_actions(
    priority: str,
    requires_human_review: bool,
    auto_close: bool,
    auto_escalate: bool,
    approval_level: str,
) -> List[Dict[str, str]]:
    """
    Build a list of actions to take based on the decision.

    Args:
        priority: Alert priority
        requires_human_review: Whether human review is needed
        auto_close: Whether alert should be auto-closed
        auto_escalate: Whether alert should be auto-escalated
        approval_level: Approval level for automated responses

    Returns:
        List of action dicts with type and description
    """
    actions = []

    if auto_close:
        actions.append(
            {
                "type": "auto_close",
                "description": "Auto-close low-risk alert with high confidence",
            }
        )
        return actions

    if auto_escalate:
        actions.append(
            {
                "type": "escalate",
                "description": f"Auto-escalate {priority} priority alert",
            }
        )

    if requires_human_review:
        actions.append(
            {
                "type": "human_review",
                "description": f"Assign to analyst for {priority} priority review",
            }
        )

    if approval_level != "low":
        actions.append(
            {
                "type": "approval_required",
                "description": f"Requires {APPROVAL_LEVELS[approval_level]['approver_role']} approval for automated response",
            }
        )

    if not actions:
        actions.append(
            {
                "type": "auto_assign",
                "description": f"Auto-assign {priority} priority alert to analyst",
            }
        )

    return actions


# =============================================================================
# Message Persistence
# =============================================================================


async def persist_decision_to_db(decision: Dict[str, Any]) -> None:
    """
    Persist a decision result to the database.

    Args:
        decision: Decision result dictionary
    """
    if not db_manager:
        return

    try:
        from sqlalchemy import text

        async with db_manager.get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO alert_decisions (
                        decision_id, alert_id, priority, risk_score,
                        requires_human_review, auto_close, auto_escalate,
                        approval_level, assigned_analyst_id, decided_at,
                        decision_data
                    ) VALUES (
                        :decision_id, :alert_id, :priority, :risk_score,
                        :requires_human_review, :auto_close, :auto_escalate,
                        :approval_level, :assigned_analyst_id, :decided_at,
                        :decision_data
                    )
                """),
                {
                    "decision_id": decision["decision_id"],
                    "alert_id": decision["alert_id"],
                    "priority": decision["priority"],
                    "risk_score": decision["risk_score"],
                    "requires_human_review": decision["requires_human_review"],
                    "auto_close": decision["auto_close"],
                    "auto_escalate": decision["auto_escalate"],
                    "approval_level": decision["approval"]["level"],
                    "assigned_analyst_id": (
                        decision["routing"]["assigned_analyst"]["id"]
                        if decision["routing"]["assigned_analyst"]
                        else None
                    ),
                    "decided_at": decision["decided_at"],
                    "decision_data": json.dumps(decision),
                },
            )
            await session.commit()
            logger.debug(f"Decision persisted for alert {decision['alert_id']}")

    except Exception as e:
        logger.error(f"Failed to persist decision: {e}", exc_info=True)


# =============================================================================
# Background Task: Message Consumer
# =============================================================================


async def consume_triaged_alerts():
    """Consume triaged alerts and make decisions."""

    async def process_message(message: dict):
        try:
            # Unwrap message envelope if present
            if "data" in message and isinstance(message["data"], dict):
                actual_message = message["data"]
                meta = message.get("_meta", {})
                message_id = meta.get("message_id", message.get("message_id", "unknown"))
            else:
                actual_message = message
                message_id = message.get("message_id", "unknown")

            payload = actual_message.get("payload", actual_message)

            # Extract triage result fields
            alert_id = payload.get("alert_id", "unknown")
            risk_score = float(payload.get("risk_score", 50.0))
            confidence = float(payload.get("confidence", 0.8))
            alert_type = payload.get("alert_type", "unknown")
            severity = payload.get("severity", "medium")
            asset_criticality = payload.get("asset_criticality", "medium")

            logger.info(
                f"Processing triaged alert {alert_id}: risk_score={risk_score}, "
                f"confidence={confidence}, alert_type={alert_type}"
            )

            # Make decision
            decision = await make_decision(
                alert_id=alert_id,
                risk_score=risk_score,
                confidence=confidence,
                alert_type=alert_type,
                severity=severity,
                asset_criticality=asset_criticality,
                triage_result=payload,
            )

            # Persist to database
            await persist_decision_to_db(decision)

            # Build decided message
            decided_message = {
                "message_id": str(uuid.uuid4()),
                "message_type": "alert.decided",
                "correlation_id": alert_id,
                "original_message_id": message_id,
                "timestamp": datetime.utcnow().isoformat(),
                "version": "1.0",
                "payload": decision,
            }

            # Publish to alert.decided queue
            await publisher.publish("alert.decided", decided_message)

            # If escalation or workflow trigger needed, publish to workflow.trigger
            if decision["auto_escalate"] or decision["requires_human_review"]:
                workflow_message = {
                    "message_id": str(uuid.uuid4()),
                    "message_type": "workflow.trigger",
                    "correlation_id": alert_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "version": "1.0",
                    "payload": {
                        "workflow_type": (
                            "incident-response" if decision["auto_escalate"] else "alert-processing"
                        ),
                        "trigger_source": "decision-engine",
                        "alert_id": alert_id,
                        "priority": decision["priority"],
                        "decision": decision,
                    },
                }
                await publisher.publish("workflow.trigger", workflow_message)
                logger.info(
                    f"Workflow trigger published for alert {alert_id} "
                    f"(type={'incident-response' if decision['auto_escalate'] else 'alert-processing'})"
                )

            # If approval is needed (non-auto), track it
            if not decision["approval"]["auto_approved"]:
                pending_approvals[alert_id] = {
                    "decision": decision,
                    "requested_at": datetime.utcnow(),
                    "status": "pending",
                }
                logger.info(
                    f"Approval requested for alert {alert_id}: "
                    f"level={decision['approval']['level']}, "
                    f"approver_role={decision['approval']['approver_role']}"
                )

            logger.info(
                f"Decision published for alert {alert_id} "
                f"(decision_id: {decision['decision_id']})"
            )

        except Exception as e:
            logger.error(f"Decision processing failed: {e}", exc_info=True)
            raise

    # Start consuming
    await consumer.consume(process_message)


# =============================================================================
# Background Task: SLA Monitor
# =============================================================================


async def monitor_sla():
    """
    Periodically check for SLA breaches and trigger escalations.
    Runs every 60 seconds.
    """
    while True:
        try:
            now = datetime.utcnow()

            for alert_id, timer in list(escalation_timers.items()):
                if timer["escalated"]:
                    continue

                breach_info = check_sla_breach(
                    timer["priority"],
                    timer["created_at"],
                    now,
                )

                if breach_info["needs_escalation"]:
                    timer["escalated"] = True
                    decision_metrics["escalations"] += 1

                    logger.warning(
                        f"SLA breach detected for alert {alert_id}: "
                        f"priority={timer['priority']}, "
                        f"response_breached={breach_info['response_breached']}, "
                        f"resolve_breached={breach_info['resolve_breached']}",
                        extra={"alert_id": alert_id},
                    )

                    # Publish escalation to workflow.trigger
                    if publisher:
                        escalation_message = {
                            "message_id": str(uuid.uuid4()),
                            "message_type": "workflow.trigger",
                            "correlation_id": alert_id,
                            "timestamp": now.isoformat(),
                            "version": "1.0",
                            "payload": {
                                "workflow_type": "incident-response",
                                "trigger_source": "decision-engine-sla",
                                "alert_id": alert_id,
                                "priority": timer["priority"],
                                "sla_breach": breach_info,
                            },
                        }
                        await publisher.publish("workflow.trigger", escalation_message)

            # Sleep for 60 seconds
            await asyncio.sleep(60)

        except Exception as e:
            logger.error(f"SLA monitor failed: {e}", exc_info=True)
            await asyncio.sleep(30)


# =============================================================================
# Decision Rules (configurable)
# =============================================================================

DECISION_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "critical_auto_escalate",
        "name": "Critical Risk Auto-Escalate",
        "description": "Risk score >= 90: requires human review, priority=critical, auto-escalate",
        "condition": "risk_score >= 90",
        "enabled": True,
        "priority_override": "critical",
        "human_review": True,
        "auto_escalate": True,
    },
    {
        "rule_id": "high_risk_review",
        "name": "High Risk Human Review",
        "description": "Risk score >= 70: requires human review, priority=high",
        "condition": "risk_score >= 70",
        "enabled": True,
        "priority_override": "high",
        "human_review": True,
        "auto_escalate": False,
    },
    {
        "rule_id": "medium_auto_assign",
        "name": "Medium Risk Auto-Assign",
        "description": "Risk score >= 40: auto-assign to team, priority=medium",
        "condition": "risk_score >= 40",
        "enabled": True,
        "priority_override": "medium",
        "human_review": False,
        "auto_escalate": False,
    },
    {
        "rule_id": "low_auto_assign",
        "name": "Low Risk Auto-Assign",
        "description": "Risk score >= 20: auto-assign, priority=low",
        "condition": "risk_score >= 20",
        "enabled": True,
        "priority_override": "low",
        "human_review": False,
        "auto_escalate": False,
    },
    {
        "rule_id": "info_auto_close",
        "name": "Info Level Auto-Close Candidate",
        "description": "Risk score < 20: auto-close candidate, priority=info",
        "condition": "risk_score < 20",
        "enabled": True,
        "priority_override": "info",
        "human_review": False,
        "auto_escalate": False,
    },
    {
        "rule_id": "low_confidence_review",
        "name": "Low Confidence Review",
        "description": "Confidence < 0.5: always require human review",
        "condition": "confidence < 0.5",
        "enabled": True,
        "human_review": True,
        "auto_escalate": False,
    },
    {
        "rule_id": "sensitive_type_review",
        "name": "Sensitive Alert Type Review",
        "description": "Data exfiltration/insider threat/APT with risk >= 40: require review",
        "condition": "alert_type in ('data_exfiltration', 'insider_threat', 'apt') and risk_score >= 40",
        "enabled": True,
        "human_review": True,
        "auto_escalate": False,
    },
]


# =============================================================================
# FastAPI Application
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global db_manager, publisher, consumer

    logger.info("Starting Decision Engine Service")

    try:
        # Initialize database
        await init_database(
            database_url=config.database_url,
            pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
            echo=config.debug,
        )
        db_manager = get_database_manager()
        logger.info("Database connected")

        # Initialize message publisher
        publisher = MessagePublisher(config.rabbitmq_url)
        await publisher.connect()
        logger.info("Message publisher connected")

        # Initialize message consumer
        consumer = MessageConsumer(config.rabbitmq_url, "alert.triaged")
        await consumer.connect()
        logger.info("Message consumer connected")

        # Start message consumer task
        asyncio.create_task(consume_triaged_alerts())
        logger.info("Message consumer task started")

        # Start SLA monitor task
        asyncio.create_task(monitor_sla())
        logger.info("SLA monitor task started")

        logger.info("Decision Engine Service started successfully")

        yield

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise

    finally:
        logger.info("Shutting down Decision Engine Service")

        if consumer:
            await consumer.close()
            logger.info("Message consumer closed")

        if publisher:
            await publisher.close()
            logger.info("Message publisher closed")

        # Close database
        await close_database()
        logger.info("Database connection closed")

        logger.info("Decision Engine Service stopped")


# Create FastAPI app
app = FastAPI(
    title="Decision Engine API",
    description="Determines actions for triaged security alerts",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# API Endpoints
# =============================================================================


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    try:
        return {
            "status": "healthy",
            "service": "decision-engine",
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "database": "connected" if db_manager else "disconnected",
                "message_queue_consumer": "connected" if consumer else "disconnected",
                "message_queue_publisher": "connected" if publisher else "disconnected",
                "pending_approvals": len(pending_approvals),
                "active_escalation_timers": len(escalation_timers),
            },
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "decision-engine",
            "error": str(e),
        }


@app.get("/metrics", tags=["Metrics"])
async def get_metrics():
    """Get decision engine metrics."""
    return {
        "service": "decision-engine",
        "decisions": decision_metrics,
        "pending_approvals": len(pending_approvals),
        "active_escalation_timers": sum(
            1 for t in escalation_timers.values() if not t["escalated"]
        ),
        "breached_escalations": sum(1 for t in escalation_timers.values() if t["escalated"]),
        "analyst_workload": {
            a["id"]: {
                "active_tasks": a["active_tasks"],
                "max_tasks": a["max_tasks"],
                "available": a["available"],
            }
            for a in ANALYST_POOL
        },
    }


@app.post("/api/v1/decide/{alert_id}", tags=["Decision"])
async def decide_alert(alert_id: str, request: DecisionRequest):
    """
    Manually trigger a decision evaluation for an alert.

    Args:
        alert_id: Alert identifier
        request: Decision request parameters

    Returns:
        Decision result
    """
    try:
        decision = await make_decision(
            alert_id=alert_id,
            risk_score=request.risk_score,
            confidence=request.confidence,
            alert_type=request.alert_type,
            severity=request.severity,
            asset_criticality=request.asset_criticality,
        )

        # Persist to database
        await persist_decision_to_db(decision)

        return {
            "success": True,
            "data": decision,
        }

    except Exception as e:
        logger.error(f"Decision failed for alert {alert_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/decide/{alert_id}", tags=["Decision"])
async def get_decision(alert_id: str):
    """
    Retrieve a previous decision for an alert.

    Args:
        alert_id: Alert identifier

    Returns:
        Decision result if found
    """
    decision = decisions_made.get(alert_id)
    if not decision:
        raise HTTPException(status_code=404, detail=f"No decision found for alert {alert_id}")

    return {
        "success": True,
        "data": decision,
    }


@app.get("/api/v1/rules", tags=["Rules"])
async def get_rules():
    """
    Retrieve all configured decision rules.

    Returns:
        List of decision rules
    """
    return {
        "success": True,
        "data": {
            "rules": DECISION_RULES,
            "sla_config": SLA_CONFIG,
            "approval_levels": APPROVAL_LEVELS,
        },
    }


@app.put("/api/v1/rules/{rule_id}", tags=["Rules"])
async def update_rule(rule_id: str, request: RuleUpdateRequest):
    """
    Update a decision rule.

    Args:
        rule_id: Rule identifier
        request: Rule update parameters

    Returns:
        Updated rule
    """
    for rule in DECISION_RULES:
        if rule["rule_id"] == rule_id:
            if request.enabled is not None:
                rule["enabled"] = request.enabled
            if request.threshold is not None:
                rule["threshold"] = request.threshold
            if request.description is not None:
                rule["description"] = request.description

            logger.info(f"Rule updated: {rule_id}", extra={"rule_id": rule_id})

            return {
                "success": True,
                "data": rule,
            }

    raise HTTPException(status_code=404, detail=f"Rule not found: {rule_id}")


@app.post("/api/v1/escalation/check", tags=["Escalation"])
async def check_escalation(request: EscalationCheckRequest):
    """
    Check SLA status and escalation needs for an alert.

    Args:
        request: Escalation check parameters

    Returns:
        SLA breach status
    """
    try:
        created_at = (
            datetime.fromisoformat(request.created_at)
            if request.created_at
            else datetime.utcnow() - timedelta(minutes=30)
        )

        breach_info = check_sla_breach(request.priority, created_at)

        return {
            "success": True,
            "data": {
                "alert_id": request.alert_id,
                **breach_info,
            },
        }

    except Exception as e:
        logger.error(f"Escalation check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/escalation/check", tags=["Escalation"])
async def get_escalation_status():
    """
    Get the current escalation status for all tracked alerts.

    Returns:
        Escalation status for all alerts with active timers
    """
    now = datetime.utcnow()
    statuses = []

    for alert_id, timer in escalation_timers.items():
        breach_info = check_sla_breach(timer["priority"], timer["created_at"], now)
        statuses.append(
            {
                "alert_id": alert_id,
                "escalated": timer["escalated"],
                **breach_info,
            }
        )

    return {
        "success": True,
        "data": statuses,
    }


@app.post("/api/v1/approvals/{alert_id}", tags=["Approval"])
async def process_approval(
    alert_id: str, approved: bool, approver: str, reason: Optional[str] = None
):
    """
    Process an approval or rejection for a pending approval request.

    Args:
        alert_id: Alert identifier
        approved: Whether the request is approved
        approver: Approver identity
        reason: Reason for approval/rejection

    Returns:
        Updated approval status
    """
    if alert_id not in pending_approvals:
        raise HTTPException(status_code=404, detail=f"No pending approval for alert {alert_id}")

    approval = pending_approvals[alert_id]
    approval["status"] = "approved" if approved else "rejected"
    approval["approver"] = approver
    approval["reason"] = reason
    approval["processed_at"] = datetime.utcnow().isoformat()

    logger.info(
        f"Approval {'approved' if approved else 'rejected'} for alert {alert_id} by {approver}",
        extra={"alert_id": alert_id, "approver": approver},
    )

    return {
        "success": True,
        "data": {
            "alert_id": alert_id,
            "status": approval["status"],
            "approver": approver,
            "reason": reason,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level=config.log_level.lower(),
    )
