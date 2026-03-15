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
Alert Ingestor Service - Main Application

Receives security alerts from multiple sources and publishes to message queue.
"""

import asyncio
import json
import os
import re
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from shared.database import DatabaseManager, get_database_manager, init_database, close_database
from shared.errors import ValidationError
from shared.messaging import MessagePublisher
from shared.models import (
    AlertBatch,
    AlertType,
    ErrorResponse,
    ResponseMeta,
    SecurityAlert,
    Severity,
    SuccessResponse,
)
from shared.deduplication import AlertDeduplicator
from shared.metrics import (
    ALERTS_DEDUPLICATED,
    ALERTS_INGESTED,
    DEDUP_CHECKS,
    MetricsCollector,
)
from shared.utils import Config, get_logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Initialize logger
logger = get_logger(__name__)

# Initialize config
config = Config()

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)
logger.info("Rate limiter initialized")

# Global variables
db_manager: DatabaseManager = None
message_publisher: MessagePublisher = None
alert_deduplicator: AlertDeduplicator = None
metrics = MetricsCollector("alert_ingestor")

# In-memory rate limit tracking (fallback if slowapi not available)
rate_limit_tracker: Dict[str, List[datetime]] = defaultdict(list)
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_WINDOW = 60  # seconds


async def check_rate_limit(request: Request) -> None:
    """
    Check rate limit for client IP.

    Allows 100 requests per minute per IP.
    """
    client_ip = request.client.host
    now = datetime.utcnow()

    # Clean old entries
    rate_limit_tracker[client_ip] = [
        ts for ts in rate_limit_tracker[client_ip] if (now - ts).total_seconds() < RATE_LIMIT_WINDOW
    ]

    # Check limit
    if len(rate_limit_tracker[client_ip]) >= RATE_LIMIT_REQUESTS:
        logger.warning(f"Rate limit exceeded for {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
        )

    # Add current request
    rate_limit_tracker[client_ip].append(now)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global db_manager, message_publisher, alert_deduplicator

    # Startup
    logger.info("Starting Alert Ingestor Service")

    try:
        # Initialize database FIRST before getting manager
        await init_database(
            database_url=config.database_url,
            pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
            echo=config.debug,
        )
        db_manager = get_database_manager()
        logger.info("✓ Database connected")

        # Initialize message publisher
        message_publisher = MessagePublisher(config.rabbitmq_url)
        await message_publisher.connect()
        logger.info("✓ Message publisher connected")

        # Initialize alert deduplicator (Redis-backed when available)
        redis_client = None
        redis_url = os.getenv("REDIS_URL", config.get("redis_url", None))
        if redis_url:
            try:
                import redis.asyncio as aioredis
                redis_client = aioredis.from_url(redis_url, decode_responses=True)
                await redis_client.ping()
                logger.info("✓ Redis connected for deduplication")
            except Exception as e:
                logger.warning(f"Redis unavailable, using in-memory dedup: {e}")
                redis_client = None

        dedup_window = int(os.getenv("DEDUP_WINDOW_SECONDS", "3600"))
        alert_deduplicator = AlertDeduplicator(
            redis_client=redis_client,
            time_window_seconds=dedup_window,
        )
        logger.info(f"✓ Alert deduplicator initialized (window={dedup_window}s)")

        logger.info("✓ Alert Ingestor Service started successfully")

        yield

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise

    finally:
        # Shutdown
        logger.info("Shutting down Alert Ingestor Service")

        if message_publisher:
            await message_publisher.close()
            logger.info("✓ Message publisher closed")

        # Close database using the close_database function
        await close_database()
        logger.info("✓ Database connection closed")

        logger.info("✓ Alert Ingestor Service stopped")


# Create FastAPI app
app = FastAPI(
    title="Alert Ingestor API",
    description="Security alert ingestion service with rate limiting",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limit exception handler
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Health check
@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    try:
        # Check database
        db_health = await db_manager.health_check()

        return {
            "status": "healthy",
            "service": "alert-ingestor",
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "database": db_health,
                "message_queue": "connected" if message_publisher else "disconnected",
                "deduplication": alert_deduplicator.get_stats() if alert_deduplicator else "disabled",
                "metrics": metrics.to_dict(),
            },
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "service": "alert-ingestor",
                "error": str(e),
            },
        )


# API Routes
@app.post(
    "/api/v1/alerts",
    response_model=SuccessResponse[dict],
    tags=["Alerts"],
    summary="Ingest a single alert",
    dependencies=[Depends(check_rate_limit)],
)
async def ingest_alert(request: Request, alert: SecurityAlert):
    """
    Ingest a single security alert.

    Validates the alert, persists to database, and publishes to message queue.

    Args:
        request: FastAPI request object
        alert: Security alert data

    Returns:
        Ingestion confirmation with ingestion_id

    Raises:
        HTTPException: If validation fails or ingestion error occurs
    """
    try:
        # Generate ingestion ID
        ingestion_id = str(uuid.uuid4())

        # Validate alert
        if not alert.alert_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="alert_id is required",
            )

        # Deduplication check
        if alert_deduplicator:
            metrics.inc(DEDUP_CHECKS)
            is_dup = await alert_deduplicator.check_and_register(alert)
            if is_dup:
                metrics.inc(ALERTS_DEDUPLICATED)
                logger.info(
                    "Duplicate alert skipped",
                    extra={"alert_id": alert.alert_id, "client_ip": request.client.host},
                )
                return SuccessResponse(
                    data={
                        "ingestion_id": ingestion_id,
                        "alert_id": alert.alert_id,
                        "status": "duplicate",
                        "message": "Alert identified as duplicate and skipped",
                    },
                    meta=ResponseMeta(
                        timestamp=datetime.utcnow(),
                        request_id=ingestion_id,
                    ),
                )

        # Persist to database
        async with db_manager.get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO alerts (alert_id, received_at, alert_type, severity, description,
                                      source_ip, destination_ip, file_hash, url, asset_id, user_name)
                    VALUES (:alert_id, :received_at, :alert_type, :severity, :description,
                            :source_ip, :destination_ip, :file_hash, :url, :asset_id, :user_name)
                """),
                {
                    "alert_id": alert.alert_id,
                    "received_at": alert.timestamp,
                    "alert_type": alert.alert_type.value,
                    "severity": alert.severity.value,
                    "description": alert.description,
                    "source_ip": alert.source_ip,
                    "destination_ip": alert.target_ip,
                    "file_hash": alert.file_hash,
                    "url": alert.url,
                    "asset_id": alert.asset_id,
                    "user_name": alert.user_id,
                }
            )
            await session.commit()

        # Create message
        message = {
            "message_id": ingestion_id,
            "message_type": "alert.raw",
            "correlation_id": alert.alert_id,
            "timestamp": datetime.utcnow().isoformat(),
            "version": "1.0",
            "payload": alert.model_dump(),
        }

        # Publish to message queue
        await message_publisher.publish("alert.raw", message)
        metrics.inc(ALERTS_INGESTED)

        # Log successful ingestion
        logger.info(
            "Alert ingested successfully",
            extra={
                "ingestion_id": ingestion_id,
                "alert_id": alert.alert_id,
                "alert_type": alert.alert_type.value,
                "severity": alert.severity.value,
                "source_ip": alert.source_ip,
                "target_ip": alert.target_ip,
                "client_ip": request.client.host,
            },
        )

        # Return response
        return SuccessResponse(
            data={
                "ingestion_id": ingestion_id,
                "alert_id": alert.alert_id,
                "status": "queued",
                "message": "Alert queued for processing",
            },
            meta=ResponseMeta(
                timestamp=datetime.utcnow(),
                request_id=ingestion_id,
            ),
        )

    except ValidationError as e:
        logger.warning(f"Validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Validation error: {str(e)}",
        )
    except Exception as e:
        logger.error(f"Failed to ingest alert {alert.alert_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to ingest alert: {str(e)}",
        )


@app.post(
    "/api/v1/alerts/batch",
    response_model=SuccessResponse[dict],
    tags=["Alerts"],
    summary="Ingest multiple alerts",
)
async def ingest_alert_batch(batch: AlertBatch):
    """
    Ingest multiple security alerts in batch.

    Args:
        batch: Batch of alerts (max 100)

    Returns:
        Batch ingestion confirmation
    """
    try:
        # Generate batch ID if not provided
        if not batch.batch_id:
            batch.batch_id = f"BATCH-{uuid.uuid4()}"

        # Process each alert
        ingestion_ids = []
        errors = []

        for alert in batch.alerts:
            try:
                ingestion_id = str(uuid.uuid4())
                message = {
                    "message_id": ingestion_id,
                    "message_type": "alert.raw",
                    "correlation_id": alert.alert_id,
                    "batch_id": batch.batch_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "payload": alert.model_dump(),
                }

                await message_publisher.publish("alert.raw", message)
                ingestion_ids.append(ingestion_id)

            except Exception as e:
                logger.error(f"Failed to ingest alert {alert.alert_id}: {e}")
                errors.append({"alert_id": alert.alert_id, "error": str(e)})

        # Log
        logger.info(
            f"Batch ingested: {batch.batch_id}",
            extra={
                "batch_id": batch.batch_id,
                "total": len(batch.alerts),
                "successful": len(ingestion_ids),
                "failed": len(errors),
            },
        )

        # Return response
        return SuccessResponse(
            data={
                "batch_id": batch.batch_id,
                "total": len(batch.alerts),
                "successful": len(ingestion_ids),
                "failed": len(errors),
                "ingestion_ids": ingestion_ids,
                "errors": errors if errors else None,
            },
            meta=ResponseMeta(
                timestamp=datetime.utcnow(),
                request_id=batch.batch_id,
            ),
        )

    except Exception as e:
        logger.error(f"Failed to ingest batch: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to ingest batch: {str(e)}",
        )


@app.get(
    "/api/v1/alerts/{alert_id}",
    response_model=SuccessResponse[dict],
    tags=["Alerts"],
    summary="Get alert status",
)
async def get_alert_status(alert_id: str):
    """
    Get alert processing status.

    Args:
        alert_id: Alert identifier

    Returns:
        Alert status information
    """
    # TODO: Implement actual status lookup from database
    return SuccessResponse(
        data={
            "alert_id": alert_id,
            "status": "processing",
            "message": "Alert is being processed",
        },
        meta=ResponseMeta(
            timestamp=datetime.utcnow(),
            request_id=str(uuid.uuid4()),
        ),
    )


# ---------------------------------------------------------------------------
# Syslog Protocol Support (RFC 5424)
# ---------------------------------------------------------------------------

# RFC 5424 severity mapping to our Severity enum
_SYSLOG_SEVERITY_MAP: Dict[int, Severity] = {
    0: Severity.CRITICAL,   # Emergency
    1: Severity.CRITICAL,   # Alert
    2: Severity.CRITICAL,   # Critical
    3: Severity.HIGH,       # Error
    4: Severity.HIGH,       # Warning
    5: Severity.MEDIUM,     # Notice
    6: Severity.LOW,        # Informational
    7: Severity.INFO,       # Debug
}

# RFC 5424 structured data pattern
_RFC5424_PATTERN = re.compile(
    r"^<(?P<priority>\d{1,3})>"           # PRI
    r"(?P<version>\d{1,2})\s+"            # VERSION
    r"(?P<timestamp>\S+)\s+"              # TIMESTAMP
    r"(?P<hostname>\S+)\s+"               # HOSTNAME
    r"(?P<appname>\S+)\s+"                # APP-NAME
    r"(?P<procid>\S+)\s+"                 # PROCID
    r"(?P<msgid>\S+)\s+"                  # MSGID
    r"(?P<structured_data>-|\[.+?\])\s*"  # STRUCTURED-DATA
    r"(?P<msg>.*)",                        # MSG
    re.DOTALL,
)

# Fallback BSD-style syslog (RFC 3164)
_RFC3164_PATTERN = re.compile(
    r"^<(?P<priority>\d{1,3})>"
    r"(?P<msg>.*)",
    re.DOTALL,
)


def _parse_syslog_message(data: bytes) -> Optional[Dict[str, Any]]:
    """
    Parse an RFC 5424 syslog message, falling back to RFC 3164.

    Args:
        data: Raw syslog message bytes.

    Returns:
        Parsed fields dict or None if parsing fails.
    """
    try:
        text = data.decode("utf-8", errors="replace").strip()
    except Exception:
        return None

    if not text:
        return None

    match = _RFC5424_PATTERN.match(text)
    if match:
        groups = match.groupdict()
        priority = int(groups["priority"])
        severity_code = priority & 0x07
        facility_code = priority >> 3

        return {
            "priority": priority,
            "facility": facility_code,
            "severity_code": severity_code,
            "version": groups.get("version"),
            "timestamp_raw": groups.get("timestamp"),
            "hostname": groups.get("hostname"),
            "appname": groups.get("appname"),
            "procid": groups.get("procid"),
            "msgid": groups.get("msgid"),
            "structured_data": groups.get("structured_data"),
            "message": groups.get("msg", ""),
        }

    # Fallback to RFC 3164
    match = _RFC3164_PATTERN.match(text)
    if match:
        priority = int(match.group("priority"))
        severity_code = priority & 0x07
        facility_code = priority >> 3

        return {
            "priority": priority,
            "facility": facility_code,
            "severity_code": severity_code,
            "version": None,
            "timestamp_raw": None,
            "hostname": None,
            "appname": None,
            "procid": None,
            "msgid": None,
            "structured_data": None,
            "message": match.group("msg").strip(),
        }

    return None


def _extract_ip_from_message(message: str) -> Optional[str]:
    """Extract the first IPv4 address found in a syslog message body."""
    ip_match = re.search(
        r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}"
        r"(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",
        message,
    )
    return ip_match.group(0) if ip_match else None


def _detect_alert_type(message: str) -> AlertType:
    """Heuristically detect AlertType from the syslog message text."""
    lower = message.lower()
    if any(kw in lower for kw in ("malware", "virus", "trojan", "ransomware")):
        return AlertType.MALWARE
    if any(kw in lower for kw in ("phish", "phishing", "spoof")):
        return AlertType.PHISHING
    if any(kw in lower for kw in ("brute", "login fail", "authentication fail")):
        return AlertType.BRUTE_FORCE
    if any(kw in lower for kw in ("ddos", "denial of service", "flood")):
        return AlertType.DDOS
    if any(kw in lower for kw in ("exfiltrat", "data leak", "data loss")):
        return AlertType.DATA_EXFILTRATION
    if any(kw in lower for kw in ("unauthorized", "forbidden", "privilege escalat")):
        return AlertType.UNAUTHORIZED_ACCESS
    if any(kw in lower for kw in ("anomal", "unusual", "deviation")):
        return AlertType.ANOMALY
    return AlertType.OTHER


def _syslog_to_security_alert(
    parsed: Dict[str, Any],
    addr: Optional[tuple] = None,
) -> SecurityAlert:
    """
    Convert parsed syslog fields into a SecurityAlert.

    Args:
        parsed: Dict returned by _parse_syslog_message.
        addr: Optional (host, port) tuple of the sender.

    Returns:
        A SecurityAlert instance.
    """
    severity = _SYSLOG_SEVERITY_MAP.get(parsed["severity_code"], Severity.MEDIUM)
    message = parsed.get("message", "")
    alert_type = _detect_alert_type(message)
    source_ip = _extract_ip_from_message(message)

    # Use the sender address as source_ip if none found in the message
    if not source_ip and addr:
        source_ip = addr[0]

    description = message[:2000] if message else "Syslog alert (no message body)"

    return SecurityAlert(
        alert_id=f"SYSLOG-{uuid.uuid4()}",
        timestamp=datetime.utcnow(),
        alert_type=alert_type,
        severity=severity,
        description=description,
        source_ip=source_ip,
        source="syslog",
        raw_data={
            "hostname": parsed.get("hostname"),
            "appname": parsed.get("appname"),
            "procid": parsed.get("procid"),
            "msgid": parsed.get("msgid"),
            "facility": parsed.get("facility"),
            "severity_code": parsed.get("severity_code"),
            "structured_data": parsed.get("structured_data"),
        },
    )


async def _ingest_syslog_alert(alert: SecurityAlert) -> None:
    """
    Deduplicate, persist, publish, and record metrics for a syslog-sourced alert.

    Args:
        alert: The SecurityAlert to ingest.
    """
    ingestion_id = str(uuid.uuid4())

    # Deduplication check
    if alert_deduplicator:
        metrics.inc(DEDUP_CHECKS)
        is_dup = await alert_deduplicator.check_and_register(alert)
        if is_dup:
            metrics.inc(ALERTS_DEDUPLICATED)
            logger.debug(
                "Syslog duplicate alert skipped",
                extra={"alert_id": alert.alert_id},
            )
            return

    # Persist to database
    try:
        async with db_manager.get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO alerts (alert_id, received_at, alert_type, severity, description,
                                      source_ip, destination_ip, file_hash, url, asset_id, user_name)
                    VALUES (:alert_id, :received_at, :alert_type, :severity, :description,
                            :source_ip, :destination_ip, :file_hash, :url, :asset_id, :user_name)
                """),
                {
                    "alert_id": alert.alert_id,
                    "received_at": alert.timestamp,
                    "alert_type": alert.alert_type.value,
                    "severity": alert.severity.value,
                    "description": alert.description,
                    "source_ip": alert.source_ip,
                    "destination_ip": alert.target_ip,
                    "file_hash": alert.file_hash,
                    "url": alert.url,
                    "asset_id": alert.asset_id,
                    "user_name": alert.user_id,
                },
            )
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to persist syslog alert: {e}", exc_info=True)

    # Publish to message queue
    message = {
        "message_id": ingestion_id,
        "message_type": "alert.raw",
        "correlation_id": alert.alert_id,
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0",
        "payload": alert.model_dump(),
    }
    await message_publisher.publish("alert.raw", message)
    metrics.inc(ALERTS_INGESTED)

    logger.info(
        "Syslog alert ingested",
        extra={
            "ingestion_id": ingestion_id,
            "alert_id": alert.alert_id,
            "alert_type": alert.alert_type.value,
            "severity": alert.severity.value,
            "source": "syslog",
        },
    )


class _SyslogUDPProtocol(asyncio.DatagramProtocol):
    """Asyncio UDP protocol handler for syslog messages."""

    def connection_made(self, transport: asyncio.DatagramTransport) -> None:
        self.transport = transport

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        parsed = _parse_syslog_message(data)
        if parsed is None:
            logger.warning(
                "Failed to parse syslog UDP message",
                extra={"sender": addr[0]},
            )
            return

        alert = _syslog_to_security_alert(parsed, addr)
        asyncio.ensure_future(_ingest_syslog_alert(alert))


async def _handle_syslog_tcp_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
) -> None:
    """
    Handle a single TCP syslog client connection.

    Reads newline-delimited or NUL-delimited syslog messages.

    Args:
        reader: Asyncio stream reader.
        writer: Asyncio stream writer.
    """
    addr = writer.get_extra_info("peername")
    logger.info("Syslog TCP connection from %s", addr)

    try:
        while True:
            data = await reader.readline()
            if not data:
                break

            parsed = _parse_syslog_message(data)
            if parsed is None:
                logger.warning(
                    "Failed to parse syslog TCP message",
                    extra={"sender": addr[0] if addr else "unknown"},
                )
                continue

            alert = _syslog_to_security_alert(parsed, addr)
            await _ingest_syslog_alert(alert)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"Syslog TCP handler error: {e}", exc_info=True)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        logger.info("Syslog TCP connection closed from %s", addr)


async def start_syslog_listeners() -> tuple:
    """
    Start UDP and TCP syslog listeners on port 514.

    Returns:
        Tuple of (udp_transport, tcp_server) for later cleanup.
    """
    syslog_host = os.getenv("SYSLOG_HOST", "0.0.0.0")
    syslog_port = int(os.getenv("SYSLOG_PORT", "514"))

    loop = asyncio.get_running_loop()

    # UDP listener
    udp_transport, _ = await loop.create_datagram_endpoint(
        lambda: _SyslogUDPProtocol(),
        local_addr=(syslog_host, syslog_port),
    )
    logger.info(
        f"Syslog UDP listener started on {syslog_host}:{syslog_port}"
    )

    # TCP listener
    tcp_server = await asyncio.start_server(
        _handle_syslog_tcp_client,
        host=syslog_host,
        port=syslog_port,
    )
    logger.info(
        f"Syslog TCP listener started on {syslog_host}:{syslog_port}"
    )

    return udp_transport, tcp_server


# Store syslog listener handles for cleanup
_syslog_udp_transport = None
_syslog_tcp_server = None


# Patch the lifespan to start/stop syslog listeners
_original_lifespan = lifespan


@asynccontextmanager
async def _extended_lifespan(app: FastAPI):
    """Extended lifespan that includes syslog listeners."""
    global _syslog_udp_transport, _syslog_tcp_server

    async with _original_lifespan(app):
        # Start syslog listeners after core services are up
        try:
            _syslog_udp_transport, _syslog_tcp_server = (
                await start_syslog_listeners()
            )
        except Exception as e:
            logger.warning(
                f"Failed to start syslog listeners (non-fatal): {e}"
            )

        yield

        # Shutdown syslog listeners
        if _syslog_udp_transport:
            _syslog_udp_transport.close()
            logger.info("Syslog UDP listener stopped")
        if _syslog_tcp_server:
            _syslog_tcp_server.close()
            await _syslog_tcp_server.wait_closed()
            logger.info("Syslog TCP listener stopped")


app.router.lifespan_context = _extended_lifespan


# ---------------------------------------------------------------------------
# WebSocket Alert Ingestion
# ---------------------------------------------------------------------------

@app.websocket("/ws/alerts")
async def websocket_alert_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for streaming alert ingestion.

    Accepts JSON-encoded SecurityAlert messages. Each message must be a
    single JSON object matching the SecurityAlert schema. The server
    responds with a JSON acknowledgement for every successfully ingested
    alert or an error object on failure.

    Example client message::

        {
            "alert_id": "WS-001",
            "timestamp": "2026-03-15T10:00:00Z",
            "alert_type": "malware",
            "severity": "high",
            "description": "Suspicious binary executed"
        }
    """
    await websocket.accept()
    client_host = (
        websocket.client.host if websocket.client else "unknown"
    )
    logger.info(
        "WebSocket alert connection opened",
        extra={"client_ip": client_host},
    )

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                await websocket.send_json({
                    "status": "error",
                    "message": f"Invalid JSON: {e}",
                })
                continue

            # Validate and construct SecurityAlert
            try:
                alert = SecurityAlert(**data)
            except Exception as e:
                await websocket.send_json({
                    "status": "error",
                    "message": f"Validation error: {e}",
                })
                continue

            if not alert.alert_id:
                await websocket.send_json({
                    "status": "error",
                    "message": "alert_id is required",
                })
                continue

            ingestion_id = str(uuid.uuid4())

            # Deduplication check
            if alert_deduplicator:
                metrics.inc(DEDUP_CHECKS)
                is_dup = await alert_deduplicator.check_and_register(alert)
                if is_dup:
                    metrics.inc(ALERTS_DEDUPLICATED)
                    logger.info(
                        "WebSocket duplicate alert skipped",
                        extra={
                            "alert_id": alert.alert_id,
                            "client_ip": client_host,
                        },
                    )
                    await websocket.send_json({
                        "status": "duplicate",
                        "ingestion_id": ingestion_id,
                        "alert_id": alert.alert_id,
                        "message": "Alert identified as duplicate and skipped",
                    })
                    continue

            # Persist to database
            try:
                async with db_manager.get_session() as session:
                    await session.execute(
                        text("""
                            INSERT INTO alerts (alert_id, received_at, alert_type, severity, description,
                                              source_ip, destination_ip, file_hash, url, asset_id, user_name)
                            VALUES (:alert_id, :received_at, :alert_type, :severity, :description,
                                    :source_ip, :destination_ip, :file_hash, :url, :asset_id, :user_name)
                        """),
                        {
                            "alert_id": alert.alert_id,
                            "received_at": alert.timestamp,
                            "alert_type": alert.alert_type.value,
                            "severity": alert.severity.value,
                            "description": alert.description,
                            "source_ip": alert.source_ip,
                            "destination_ip": alert.target_ip,
                            "file_hash": alert.file_hash,
                            "url": alert.url,
                            "asset_id": alert.asset_id,
                            "user_name": alert.user_id,
                        },
                    )
                    await session.commit()
            except Exception as e:
                logger.error(
                    f"Failed to persist WebSocket alert: {e}",
                    exc_info=True,
                )
                await websocket.send_json({
                    "status": "error",
                    "ingestion_id": ingestion_id,
                    "alert_id": alert.alert_id,
                    "message": f"Database error: {e}",
                })
                continue

            # Publish to message queue
            message = {
                "message_id": ingestion_id,
                "message_type": "alert.raw",
                "correlation_id": alert.alert_id,
                "timestamp": datetime.utcnow().isoformat(),
                "version": "1.0",
                "payload": alert.model_dump(),
            }
            await message_publisher.publish("alert.raw", message)
            metrics.inc(ALERTS_INGESTED)

            logger.info(
                "WebSocket alert ingested",
                extra={
                    "ingestion_id": ingestion_id,
                    "alert_id": alert.alert_id,
                    "alert_type": alert.alert_type.value,
                    "severity": alert.severity.value,
                    "client_ip": client_host,
                },
            )

            await websocket.send_json({
                "status": "queued",
                "ingestion_id": ingestion_id,
                "alert_id": alert.alert_id,
                "message": "Alert queued for processing",
            })

    except WebSocketDisconnect:
        logger.info(
            "WebSocket alert connection closed",
            extra={"client_ip": client_host},
        )
    except Exception as e:
        logger.error(
            f"WebSocket alert error: {e}",
            extra={"client_ip": client_host},
            exc_info=True,
        )
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level=config.log_level.lower(),
    )
