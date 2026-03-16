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

"""Notification Service - Sends notifications via multiple channels."""

import asyncio
import os
import smtplib
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jinja2 import Template
from shared.database import DatabaseManager, get_database_manager
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import ResponseMeta, SuccessResponse
from shared.utils import Config, get_logger
from shared.utils.prometheus import setup_prometheus
from sqlalchemy import text

logger = get_logger(__name__)
config = Config()

# SMTP configuration from environment
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "security-triage@example.com")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

# Twilio SMS configuration
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")

# Escalation configuration
ESCALATION_DELAY_SECONDS = int(os.getenv("ESCALATION_DELAY_SECONDS", "300"))  # 5 min
MAX_ESCALATION_LEVEL = int(os.getenv("MAX_ESCALATION_LEVEL", "3"))

# Throttle configuration
THROTTLE_WINDOW_SECONDS = int(os.getenv("THROTTLE_WINDOW_SECONDS", "3600"))
THROTTLE_MAX_PER_WINDOW = int(os.getenv("THROTTLE_MAX_PER_WINDOW", "20"))

db_manager: DatabaseManager = None
consumer: MessageConsumer = None
publisher: MessagePublisher = None


class NotificationChannel(str, Enum):
    """Notification channels."""

    EMAIL = "email"
    SMS = "sms"
    SLACK = "slack"
    WEBHOOK = "webhook"
    IN_APP = "in_app"
    DINGTALK = "dingtalk"
    WECHAT_WORK = "wechat_work"
    TEAMS = "teams"
    WEBEX = "webex"
    PAGERDUTY = "pagerduty"


class NotificationPriority(str, Enum):
    """Notification priority levels."""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, consumer, publisher

    logger.info("Starting Notification service...")

    # Initialize database
    db_manager = get_database_manager()
    await db_manager.initialize()

    # Initialize messaging
    publisher = MessagePublisher(config.rabbitmq_url)
    await publisher.connect()

    consumer = MessageConsumer(config.rabbitmq_url, "notifications.send")
    await consumer.connect()

    # Start consuming notification requests
    asyncio.create_task(consume_notifications())

    logger.info("Notification service started successfully")

    yield

    # Cleanup
    await consumer.close()
    await publisher.close()
    await db_manager.close()
    logger.info("Notification service stopped")


app = FastAPI(
    title="Notification Service",
    description="Sends notifications via multiple channels",
    version="1.0.0",
    lifespan=lifespan,
)

# Prometheus metrics
setup_prometheus(app, "notification-service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Notification channel implementations


async def send_email(
    recipient: str, subject: str, body: str, html_body: Optional[str] = None
) -> Dict[str, Any]:
    """Send email notification via SMTP."""
    try:
        if not SMTP_HOST or not SMTP_USERNAME:
            logger.warning("SMTP not configured, simulating email send")
            await asyncio.sleep(0.1)
            return {
                "success": True,
                "channel": "email",
                "recipient": recipient,
                "message_id": f"email-{uuid.uuid4()}",
                "_simulated": True,
            }

        msg = MIMEMultipart("alternative")
        msg["From"] = SMTP_FROM_EMAIL
        msg["To"] = recipient
        msg["Subject"] = subject

        msg.attach(MIMEText(body, "plain"))
        if html_body:
            msg.attach(MIMEText(html_body, "html"))

        # Run SMTP in a thread to avoid blocking the event loop
        def _send():
            if SMTP_USE_TLS:
                server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
                server.starttls()
            else:
                server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
            server.quit()

        await asyncio.get_event_loop().run_in_executor(None, _send)

        message_id = f"email-{uuid.uuid4()}"
        logger.info(f"Email sent to {recipient}: {subject}", extra={"message_id": message_id})

        return {
            "success": True,
            "channel": "email",
            "recipient": recipient,
            "message_id": message_id,
        }

    except Exception as e:
        logger.error(f"Failed to send email to {recipient}: {e}", exc_info=True)
        return {"success": False, "channel": "email", "error": str(e)}


async def send_slack(
    webhook_url: str, message: str, channel: Optional[str] = None, username: Optional[str] = None
) -> Dict[str, Any]:
    """Send Slack notification."""
    try:
        payload = {"text": message, "username": username or "Security Triage Bot"}

        if channel:
            payload["channel"] = channel

        async with httpx.AsyncClient() as client:
            response = await client.post(webhook_url, json=payload, timeout=10.0)
            response.raise_for_status()

        logger.info(f"Slack message sent to {channel or 'default channel'}")

        return {"success": True, "channel": "slack", "webhook_url": webhook_url}

    except Exception as e:
        logger.error(f"Failed to send Slack message: {e}", exc_info=True)
        return {"success": False, "channel": "slack", "error": str(e)}


async def send_webhook(
    webhook_url: str, payload: Dict[str, Any], headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Send webhook notification."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                webhook_url, json=payload, headers=headers or {}, timeout=10.0
            )
            response.raise_for_status()

        logger.info(f"Webhook sent to {webhook_url}")

        return {
            "success": True,
            "channel": "webhook",
            "webhook_url": webhook_url,
            "status_code": response.status_code,
        }

    except Exception as e:
        logger.error(f"Failed to send webhook: {e}", exc_info=True)
        return {"success": False, "channel": "webhook", "error": str(e)}


async def send_dingtalk(
    webhook_url: str, message: str, at_mobiles: Optional[List[str]] = None, at_all: bool = False
) -> Dict[str, Any]:
    """Send DingTalk notification."""
    try:
        payload = {
            "msgtype": "text",
            "text": {
                "content": message,
            },
            "at": {
                "atMobiles": at_mobiles or [],
                "isAtAll": at_all,
            },
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(webhook_url, json=payload, timeout=10.0)
            response.raise_for_status()

        logger.info(f"DingTalk message sent")

        return {"success": True, "channel": "dingtalk", "webhook_url": webhook_url}

    except Exception as e:
        logger.error(f"Failed to send DingTalk message: {e}", exc_info=True)
        return {"success": False, "channel": "dingtalk", "error": str(e)}


async def send_wechat_work(
    webhook_url: str, message: str, mentioned_list: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Send WeChat Work notification."""
    try:
        payload = {
            "msgtype": "text",
            "text": {
                "content": message,
                "mentioned_list": mentioned_list or [],
            },
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(webhook_url, json=payload, timeout=10.0)
            response.raise_for_status()

        logger.info(f"WeChat Work message sent")

        return {"success": True, "channel": "wechat_work", "webhook_url": webhook_url}

    except Exception as e:
        logger.error(f"Failed to send WeChat Work message: {e}", exc_info=True)
        return {"success": False, "channel": "wechat_work", "error": str(e)}


async def send_teams(
    webhook_url: str, title: str, message: str, summary: Optional[str] = None
) -> Dict[str, Any]:
    """Send Microsoft Teams notification."""
    try:
        payload = {
            "@type": "MessageCard",
            "@context": "https://schema.org/extensions",
            "summary": summary or title,
            "themeColor": "0078D7",
            "title": title,
            "text": message,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(webhook_url, json=payload, timeout=10.0)
            response.raise_for_status()

        logger.info(f"Teams message sent")

        return {"success": True, "channel": "teams", "webhook_url": webhook_url}

    except Exception as e:
        logger.error(f"Failed to send Teams message: {e}", exc_info=True)
        return {"success": False, "channel": "teams", "error": str(e)}


async def send_pagerduty(
    api_key: str, routing_key: str, event_action: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Send PagerDuty notification."""
    try:
        pd_payload = {
            "routing_key": routing_key,
            "event_action": event_action,
            "payload": payload,
        }

        headers = {"Authorization": f"Token token={api_key}"}
        url = "https://events.pagerduty.com/v2/enqueue"

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=pd_payload, headers=headers, timeout=10.0)
            response.raise_for_status()

        logger.info(f"PagerDuty event sent")

        return {"success": True, "channel": "pagerduty"}

    except Exception as e:
        logger.error(f"Failed to send PagerDuty event: {e}", exc_info=True)
        return {"success": False, "channel": "pagerduty", "error": str(e)}


async def send_sms(recipient: str, message: str) -> Dict[str, Any]:
    """Send SMS notification via Twilio API."""
    try:
        if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
            logger.warning("Twilio not configured, simulating SMS send")
            await asyncio.sleep(0.1)
            return {"success": True, "channel": "sms", "recipient": recipient, "_simulated": True}

        url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                data={"To": recipient, "From": TWILIO_FROM_NUMBER, "Body": message},
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=15.0,
            )
            response.raise_for_status()
            resp_data = response.json()

        logger.info(f"SMS sent to {recipient}", extra={"sid": resp_data.get("sid")})
        return {
            "success": True,
            "channel": "sms",
            "recipient": recipient,
            "sid": resp_data.get("sid"),
        }

    except Exception as e:
        logger.error(f"Failed to send SMS to {recipient}: {e}", exc_info=True)
        return {"success": False, "channel": "sms", "error": str(e)}


async def send_in_app(
    user_id: str,
    subject: str,
    message: str,
    priority: "NotificationPriority" = None,
) -> Dict[str, Any]:
    """Store in-app notification in the database."""
    try:
        notification_id = str(uuid.uuid4())

        if db_manager:
            async with db_manager.get_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO notifications (id, user_id, title, message, priority, is_read, created_at)
                        VALUES (:id, :user_id, :title, :message, :priority, FALSE, NOW())
                    """),
                    {
                        "id": notification_id,
                        "user_id": user_id,
                        "title": subject,
                        "message": message,
                        "priority": priority.value if priority else "normal",
                    },
                )
                await session.commit()

        logger.info(f"In-app notification stored for {user_id}", extra={"id": notification_id})
        return {
            "success": True,
            "channel": "in_app",
            "notification_id": notification_id,
            "user_id": user_id,
        }

    except Exception as e:
        logger.error(f"Failed to store in-app notification: {e}", exc_info=True)
        return {"success": False, "channel": "in_app", "error": str(e)}


# ---------------------------------------------------------------------------
# Escalation logic
# ---------------------------------------------------------------------------

# Track pending acknowledgements: notification_id -> {details}
_pending_acks: Dict[str, Dict[str, Any]] = {}

# Track recent sends per recipient for throttling
_throttle_tracker: Dict[str, List[datetime]] = {}

# ---------------------------------------------------------------------------
# Notification templates (Jinja2)
# ---------------------------------------------------------------------------

NOTIFICATION_TEMPLATES: Dict[str, Dict[str, str]] = {
    "alert_triggered": {
        "subject": "[{{ severity | upper }}] Security Alert: {{ alert_type }} ({{ alert_id }})",
        "body": (
            "Security Alert Triggered\n"
            "========================\n"
            "Alert ID:    {{ alert_id }}\n"
            "Type:        {{ alert_type }}\n"
            "Severity:    {{ severity }}\n"
            "Description: {{ description }}\n"
            "Source IP:   {{ source_ip }}\n"
            "Target IP:   {{ target_ip }}\n"
            "Timestamp:   {{ timestamp }}\n"
            "\n"
            "Please investigate this alert promptly."
        ),
        "html_body": (
            "<h2>Security Alert Triggered</h2>"
            "<table>"
            "<tr><td><strong>Alert ID</strong></td><td>{{ alert_id }}</td></tr>"
            "<tr><td><strong>Type</strong></td><td>{{ alert_type }}</td></tr>"
            "<tr><td><strong>Severity</strong></td><td>{{ severity }}</td></tr>"
            "<tr><td><strong>Description</strong></td><td>{{ description }}</td></tr>"
            "<tr><td><strong>Source IP</strong></td><td>{{ source_ip }}</td></tr>"
            "<tr><td><strong>Target IP</strong></td><td>{{ target_ip }}</td></tr>"
            "<tr><td><strong>Timestamp</strong></td><td>{{ timestamp }}</td></tr>"
            "</table>"
            "<p>Please investigate this alert promptly.</p>"
        ),
    },
    "escalation_warning": {
        "subject": "[ESCALATION L{{ level }}] Alert {{ alert_id }} - {{ severity | upper }}",
        "body": (
            "Escalation Warning\n"
            "===================\n"
            "Alert ID:           {{ alert_id }}\n"
            "Severity:           {{ severity }}\n"
            "Escalation Level:   {{ level }}\n"
            "Elapsed Time:       {{ elapsed_time }}\n"
            "Original Assignee:  {{ original_assignee }}\n"
            "\n"
            "This alert has not been acknowledged and is being escalated."
        ),
        "html_body": (
            "<h2>Escalation Warning</h2>"
            "<table>"
            "<tr><td><strong>Alert ID</strong></td><td>{{ alert_id }}</td></tr>"
            "<tr><td><strong>Severity</strong></td><td>{{ severity }}</td></tr>"
            "<tr><td><strong>Escalation Level</strong></td><td>{{ level }}</td></tr>"
            "<tr><td><strong>Elapsed Time</strong></td><td>{{ elapsed_time }}</td></tr>"
            "<tr><td><strong>Original Assignee</strong></td><td>{{ original_assignee }}</td></tr>"
            "</table>"
            "<p>This alert has not been acknowledged and is being escalated.</p>"
        ),
    },
    "triage_complete": {
        "subject": "Triage Complete: {{ alert_id }} - Risk {{ risk_level | upper }} ({{ risk_score }})",
        "body": (
            "Triage Complete\n"
            "================\n"
            "Alert ID:       {{ alert_id }}\n"
            "Risk Score:     {{ risk_score }}\n"
            "Risk Level:     {{ risk_level }}\n"
            "Confidence:     {{ confidence }}\n"
            "Recommendation: {{ recommendation }}\n"
            "Analyst:        {{ analyst }}\n"
            "\n"
            "The triage process has been completed for this alert."
        ),
        "html_body": (
            "<h2>Triage Complete</h2>"
            "<table>"
            "<tr><td><strong>Alert ID</strong></td><td>{{ alert_id }}</td></tr>"
            "<tr><td><strong>Risk Score</strong></td><td>{{ risk_score }}</td></tr>"
            "<tr><td><strong>Risk Level</strong></td><td>{{ risk_level }}</td></tr>"
            "<tr><td><strong>Confidence</strong></td><td>{{ confidence }}</td></tr>"
            "<tr><td><strong>Recommendation</strong></td><td>{{ recommendation }}</td></tr>"
            "<tr><td><strong>Analyst</strong></td><td>{{ analyst }}</td></tr>"
            "</table>"
            "<p>The triage process has been completed for this alert.</p>"
        ),
    },
    "false_positive": {
        "subject": "False Positive: Alert {{ alert_id }} Closed",
        "body": (
            "False Positive Notification\n"
            "===========================\n"
            "Alert ID: {{ alert_id }}\n"
            "Analyst:  {{ analyst }}\n"
            "Reason:   {{ reason }}\n"
            "\n"
            "This alert has been classified as a false positive and closed."
        ),
        "html_body": (
            "<h2>False Positive Notification</h2>"
            "<table>"
            "<tr><td><strong>Alert ID</strong></td><td>{{ alert_id }}</td></tr>"
            "<tr><td><strong>Analyst</strong></td><td>{{ analyst }}</td></tr>"
            "<tr><td><strong>Reason</strong></td><td>{{ reason }}</td></tr>"
            "</table>"
            "<p>This alert has been classified as a false positive and closed.</p>"
        ),
    },
}


def render_template(template_name: str, context: Dict[str, Any]) -> Dict[str, str]:
    """
    Render a notification template with the given context variables.

    Args:
        template_name: Name of the template to render
        context: Template variables to substitute

    Returns:
        Dict with 'subject', 'body', and 'html_body' keys

    Raises:
        ValueError: If template_name is not found
    """
    if template_name not in NOTIFICATION_TEMPLATES:
        raise ValueError(
            f"Unknown template: {template_name}. "
            f"Available templates: {list(NOTIFICATION_TEMPLATES.keys())}"
        )

    template_def = NOTIFICATION_TEMPLATES[template_name]
    return {
        "subject": Template(template_def["subject"]).render(**context),
        "body": Template(template_def["body"]).render(**context),
        "html_body": Template(template_def["html_body"]).render(**context),
    }


def _check_throttle(recipient: str) -> bool:
    """
    Check if a recipient has exceeded the notification rate limit.

    Args:
        recipient: Recipient identifier (email, user ID, webhook URL, etc.)

    Returns:
        True if the recipient is throttled, False otherwise
    """
    now = datetime.utcnow()
    window_start = now.timestamp() - THROTTLE_WINDOW_SECONDS

    # Clean up old entries and count recent sends
    if recipient in _throttle_tracker:
        _throttle_tracker[recipient] = [
            ts for ts in _throttle_tracker[recipient] if ts.timestamp() > window_start
        ]
    else:
        _throttle_tracker[recipient] = []

    return len(_throttle_tracker[recipient]) >= THROTTLE_MAX_PER_WINDOW


async def send_with_escalation(
    channels: List[NotificationChannel],
    recipients_by_level: List[List[str]],
    subject: str,
    message: str,
    priority: "NotificationPriority" = None,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Send notification with escalation: if no acknowledgement within the delay,
    escalate to the next level of recipients.

    Args:
        channels: Channels to use at each level
        recipients_by_level: List of recipient lists per escalation level
        subject: Notification subject
        message: Notification message
        priority: Priority level
        data: Additional data

    Returns:
        Escalation results
    """
    escalation_id = str(uuid.uuid4())
    results = []

    for level, recipients in enumerate(recipients_by_level[:MAX_ESCALATION_LEVEL]):
        level_results = []
        for channel in channels:
            for recipient in recipients:
                result = await send_notification(
                    channel, recipient, f"[ESC-L{level}] {subject}", message, priority, data
                )
                level_results.append(result)

        results.append({"level": level, "results": level_results})

        # Check if any succeeded at this level
        any_success = any(r.get("success") for r in level_results)
        if not any_success:
            logger.warning(f"Escalation level {level} failed, escalating immediately")
            continue

        # Wait for acknowledgement before escalating
        if level < len(recipients_by_level) - 1:
            ack_key = f"esc:{escalation_id}:level:{level}"
            _pending_acks[ack_key] = {
                "escalation_id": escalation_id,
                "level": level,
                "created_at": datetime.utcnow(),
            }

            await asyncio.sleep(ESCALATION_DELAY_SECONDS)

            if ack_key in _pending_acks:
                # Not acknowledged, escalate
                del _pending_acks[ack_key]
                logger.info(f"Escalating from level {level} to {level + 1}")
            else:
                # Acknowledged, stop escalation
                logger.info(f"Notification acknowledged at level {level}, stopping escalation")
                break

    return {
        "success": True,
        "escalation_id": escalation_id,
        "levels_notified": len(results),
        "results": results,
    }


async def send_notification(
    channel: NotificationChannel,
    recipient: str,
    subject: str,
    message: str,
    priority: NotificationPriority = NotificationPriority.NORMAL,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Send notification via specified channel."""
    try:
        # Check throttle before sending
        if _check_throttle(recipient):
            logger.warning(
                f"Recipient throttled: {recipient}",
                extra={"channel": channel.value, "recipient": recipient},
            )
            return {
                "success": False,
                "channel": channel.value,
                "error": "Recipient throttled",
                "throttled": True,
            }

        result = None

        if channel == NotificationChannel.EMAIL:
            result = await send_email(recipient, subject, message)

        elif channel == NotificationChannel.SLACK:
            result = await send_slack(recipient, message)

        elif channel == NotificationChannel.WEBHOOK:
            result = await send_webhook(recipient, data or {"message": message, "subject": subject})

        elif channel == NotificationChannel.SMS:
            result = await send_sms(recipient, message)

        elif channel == NotificationChannel.IN_APP:
            result = await send_in_app(recipient, subject, message, priority)

        elif channel == NotificationChannel.DINGTALK:
            at_mobiles = data.get("at_mobiles") if data else None
            at_all = data.get("at_all", False) if data else False
            result = await send_dingtalk(recipient, message, at_mobiles, at_all)

        elif channel == NotificationChannel.WECHAT_WORK:
            mentioned_list = data.get("mentioned_list") if data else None
            result = await send_wechat_work(recipient, message, mentioned_list)

        elif channel == NotificationChannel.TEAMS:
            result = await send_teams(recipient, subject, message)

        elif channel == NotificationChannel.PAGERDUTY:
            pd_data = data or {}
            result = await send_pagerduty(
                api_key=pd_data.get("api_key", ""),
                routing_key=pd_data.get("routing_key", ""),
                event_action=pd_data.get("event_action", "trigger"),
                payload=pd_data.get("payload", {"summary": message}),
            )

        else:
            raise ValueError(f"Unsupported channel: {channel}")

        # Record send in throttle tracker
        if result and result.get("success"):
            if recipient not in _throttle_tracker:
                _throttle_tracker[recipient] = []
            _throttle_tracker[recipient].append(datetime.utcnow())

        return result

    except Exception as e:
        logger.error(f"Failed to send notification: {e}", exc_info=True)
        return {"success": False, "channel": channel.value, "error": str(e)}


async def consume_notifications():
    """Consume notification requests from message queue."""

    async def process_message(message: dict):
        try:
            payload = message["payload"]
            channel = NotificationChannel(payload.get("channel", "email"))
            recipient = payload.get("recipient")
            subject = payload.get("subject", "")
            message_text = payload.get("message", "")
            priority = NotificationPriority(payload.get("priority", "normal"))
            data = payload.get("data")

            if not recipient or not message_text:
                logger.error("Missing required fields in notification message")
                return

            # Send notification
            result = await send_notification(
                channel, recipient, subject, message_text, priority, data
            )

            if result.get("success"):
                logger.info(f"Notification sent successfully via {channel.value}")
            else:
                logger.error(f"Notification failed: {result.get('error')}")

        except Exception as e:
            logger.error(f"Failed to process notification: {e}", exc_info=True)

    await consumer.consume(process_message)


# API Endpoints


@app.post("/api/v1/notifications/send", response_model=Dict[str, Any])
async def send_notification_api(
    channel: NotificationChannel,
    recipient: str,
    subject: str,
    message: str,
    priority: NotificationPriority = NotificationPriority.NORMAL,
    data: Optional[Dict[str, Any]] = None,
    background_tasks: BackgroundTasks = None,
):
    """
    Send notification via API.

    Args:
        channel: Notification channel
        recipient: Recipient address/webhook URL
        subject: Notification subject/title
        message: Notification message body
        priority: Notification priority
        data: Additional data for the notification
    """
    try:
        # Send notification
        result = await send_notification(channel, recipient, subject, message, priority, data)

        return {
            "success": result.get("success", False),
            "data": result,
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to send notification: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to send notification: {str(e)}")


@app.post("/api/v1/notifications/broadcast", response_model=Dict[str, Any])
async def broadcast_notification(
    channel: NotificationChannel,
    recipients: List[str],
    subject: str,
    message: str,
    priority: NotificationPriority = NotificationPriority.NORMAL,
    background_tasks: BackgroundTasks = None,
):
    """Broadcast notification to multiple recipients."""
    try:
        results = []

        for recipient in recipients:
            result = await send_notification(channel, recipient, subject, message, priority)
            results.append(result)

        successful = sum(1 for r in results if r.get("success"))
        total = len(results)

        return {
            "success": successful > 0,
            "data": {
                "total": total,
                "successful": successful,
                "failed": total - successful,
                "results": results,
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to broadcast notification: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to broadcast notification: {str(e)}")


@app.post("/api/v1/notifications/escalate", response_model=Dict[str, Any])
async def escalate_notification_api(
    channels: List[NotificationChannel],
    recipients_by_level: List[List[str]],
    subject: str,
    message: str,
    priority: NotificationPriority = NotificationPriority.URGENT,
    data: Optional[Dict[str, Any]] = None,
    background_tasks: BackgroundTasks = None,
):
    """Send notification with escalation across multiple levels."""
    try:
        if background_tasks:
            background_tasks.add_task(
                send_with_escalation,
                channels,
                recipients_by_level,
                subject,
                message,
                priority,
                data,
            )
            return {
                "success": True,
                "data": {"message": "Escalation started in background"},
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "request_id": str(uuid.uuid4()),
                },
            }

        result = await send_with_escalation(
            channels, recipients_by_level, subject, message, priority, data
        )
        return {
            "success": True,
            "data": result,
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Escalation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/notifications/acknowledge/{escalation_id}")
async def acknowledge_notification(escalation_id: str, level: int = 0):
    """Acknowledge an escalation notification to prevent further escalation."""
    ack_key = f"esc:{escalation_id}:level:{level}"
    if ack_key in _pending_acks:
        del _pending_acks[ack_key]
        return {
            "success": True,
            "message": f"Escalation {escalation_id} level {level} acknowledged",
        }
    return {"success": False, "message": "Escalation not found or already resolved"}


@app.post("/api/v1/notifications/send-templated", response_model=Dict[str, Any])
async def send_templated_notification(
    template_name: str,
    channel: NotificationChannel,
    recipient: str,
    template_vars: Dict[str, Any],
    priority: NotificationPriority = NotificationPriority.NORMAL,
):
    """
    Send a notification using a pre-defined template.

    Args:
        template_name: Name of the template (alert_triggered, escalation_warning,
                       triage_complete, false_positive)
        channel: Notification channel
        recipient: Recipient address/webhook URL
        template_vars: Variables to render the template with
        priority: Notification priority
    """
    try:
        rendered = render_template(template_name, template_vars)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = await send_notification(
            channel,
            recipient,
            rendered["subject"],
            rendered["body"],
            priority,
        )

        return {
            "success": result.get("success", False),
            "data": {**result, "template": template_name},
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to send templated notification: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to send notification: {str(e)}")


@app.get("/api/v1/notifications/throttle-status/{recipient}", response_model=Dict[str, Any])
async def get_throttle_status(recipient: str):
    """
    Get the current throttle status for a recipient.

    Args:
        recipient: Recipient identifier to check
    """
    now = datetime.utcnow()
    window_start = now.timestamp() - THROTTLE_WINDOW_SECONDS

    # Count recent sends within the window
    recent_sends = []
    if recipient in _throttle_tracker:
        recent_sends = [ts for ts in _throttle_tracker[recipient] if ts.timestamp() > window_start]

    current_count = len(recent_sends)
    remaining = max(0, THROTTLE_MAX_PER_WINDOW - current_count)
    is_throttled = current_count >= THROTTLE_MAX_PER_WINDOW

    return {
        "success": True,
        "data": {
            "recipient": recipient,
            "current_count": current_count,
            "max_per_window": THROTTLE_MAX_PER_WINDOW,
            "remaining": remaining,
            "throttled": is_throttled,
            "window_seconds": THROTTLE_WINDOW_SECONDS,
        },
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "notification-service",
        "timestamp": datetime.utcnow().isoformat(),
        "channels": [c.value for c in NotificationChannel],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
