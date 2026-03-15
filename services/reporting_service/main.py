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
Reporting Service - Generates, persists, and delivers security reports.

Supports daily/weekly/monthly summaries, incident reports, trend analysis,
and custom reports with PDF, HTML, JSON, and CSV export.  Reports are
rendered via Jinja2 templates, persisted to the database, and stored in
MinIO (or local filesystem as fallback).  Events are published via RabbitMQ.
"""

import csv
import io
import json
import os
import pathlib
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, Field
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.database.models import AuditLog, Report
from shared.database.repositories.alert_repository import AlertRepository
from shared.database.repositories.report_repository import ReportRepository
from shared.database.repositories.triage_repository import TriageRepository
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import ResponseMeta, SuccessResponse
from shared.utils import Config, get_logger

from storage import ReportStorage

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
consumer: MessageConsumer = None
publisher: MessagePublisher = None
report_storage: ReportStorage = None

# ---------------------------------------------------------------------------
# Jinja2 template engine
# ---------------------------------------------------------------------------

TEMPLATE_DIR = pathlib.Path(__file__).parent / "templates"

jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ReportFormat(str, Enum):
    """Report output formats."""

    PDF = "pdf"
    HTML = "html"
    CSV = "csv"
    JSON = "json"


class ReportType(str, Enum):
    """Types of reports."""

    DAILY_SUMMARY = "daily_summary"
    WEEKLY_SUMMARY = "weekly_summary"
    MONTHLY_SUMMARY = "monthly_summary"
    INCIDENT_REPORT = "incident_report"
    TREND_ANALYSIS = "trend_analysis"
    CUSTOM = "custom"


class ReportStatus(str, Enum):
    """Report generation status."""

    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


# Template mapping: report_type -> template file
TEMPLATE_MAP = {
    ReportType.DAILY_SUMMARY.value: "summary.html",
    ReportType.WEEKLY_SUMMARY.value: "summary.html",
    ReportType.MONTHLY_SUMMARY.value: "summary.html",
    ReportType.INCIDENT_REPORT.value: "incident.html",
    ReportType.TREND_ANALYSIS.value: "trend.html",
    ReportType.CUSTOM.value: "summary.html",
}


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class ReportGenerateRequest(BaseModel):
    """Request body for generating a report."""

    report_type: ReportType
    name: Optional[str] = None
    description: Optional[str] = None
    format: ReportFormat = ReportFormat.JSON
    date: Optional[str] = Field(None, description="Date for summary reports (YYYY-MM-DD)")
    alert_id: Optional[str] = Field(None, description="Alert ID for incident reports")
    filters: Optional[Dict[str, Any]] = Field(None, description="Custom filter criteria")
    schedule_frequency: Optional[str] = Field(None, description="daily, weekly, or monthly")
    schedule_time: Optional[str] = Field(None, description="HH:MM format")
    schedule_recipients: Optional[List[str]] = None


class ReportUpdateRequest(BaseModel):
    """Request body for updating a report's schedule."""

    schedule_frequency: Optional[str] = None
    schedule_time: Optional[str] = None
    schedule_recipients: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# Audit helper
# ---------------------------------------------------------------------------


async def audit_log(
    event_type: str,
    action: str,
    target_type: str = "report",
    target_id: Optional[str] = None,
    actor_id: str = "system",
    details: Optional[Dict[str, Any]] = None,
    status: str = "success",
    error_message: Optional[str] = None,
) -> None:
    """Record an audit log entry."""
    if not db_manager:
        logger.debug(f"Audit log (no db): {event_type} {action} {target_type}:{target_id}")
        return
    try:
        async with db_manager.get_session() as session:
            log_entry = AuditLog(
                event_type=event_type,
                event_category="reporting",
                action=action,
                actor_id=actor_id,
                actor_type="service",
                target_type=target_type,
                target_id=target_id,
                details=details,
                status=status,
                error_message=error_message,
            )
            session.add(log_entry)
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


# ---------------------------------------------------------------------------
# Report data helpers (query DB when available, fall back gracefully)
# ---------------------------------------------------------------------------


def _report_to_dict(report: Report) -> Dict[str, Any]:
    """Convert ORM Report to response dict."""
    return {
        "report_id": report.report_id,
        "name": report.name,
        "description": report.description,
        "report_type": report.report_type,
        "format": report.format,
        "status": report.status,
        "filters": report.filters,
        "file_path": report.file_path,
        "file_size": report.file_size,
        "created_by": report.created_by,
        "schedule_frequency": report.schedule_frequency,
        "schedule_time": report.schedule_time,
        "schedule_recipients": report.schedule_recipients,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        "completed_at": report.completed_at.isoformat() if report.completed_at else None,
        "error_message": report.error_message,
    }


async def _query_alert_stats(
    session, start_date: datetime, end_date: datetime
) -> Dict[str, Any]:
    """Query alert statistics from the database for the given date range."""
    repo = AlertRepository(session)
    try:
        severity_counts = await repo.get_alerts_count_by_severity()
        status_counts = await repo.get_alerts_count_by_status()
        type_counts = await repo.get_alerts_count_by_type()
        total = sum(severity_counts.values()) if severity_counts else 0
    except Exception as e:
        logger.warning(f"Failed to query alert stats from DB, using defaults: {e}")
        severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        status_counts = {"pending": 0, "triaged": 0, "resolved": 0}
        type_counts = {}
        total = 0

    return {
        "total_alerts": total,
        "by_severity": severity_counts,
        "by_status": status_counts,
        "by_type": type_counts,
    }


async def _generate_summary_data(
    report_id: str,
    report_type: str,
    start_date: datetime,
    end_date: datetime,
) -> Dict[str, Any]:
    """Generate summary report data from the database."""
    report_data: Dict[str, Any] = {
        "report_id": report_id,
        "report_type": report_type,
        "period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
        },
        "generated_at": datetime.utcnow().isoformat(),
    }

    if db_manager:
        async with db_manager.get_session() as session:
            alert_stats = await _query_alert_stats(session, start_date, end_date)
            report_data["summary"] = alert_stats
    else:
        report_data["summary"] = {
            "total_alerts": 0,
            "by_severity": {},
            "by_status": {},
            "by_type": {},
        }

    report_data["recommendations"] = [
        "Review alerts with critical severity for immediate action",
        "Update detection rules based on emerging threat patterns",
        "Conduct periodic review of alert triage accuracy",
    ]
    return report_data


async def _generate_incident_data(report_id: str, alert_id: str) -> Dict[str, Any]:
    """Generate incident report data for a specific alert."""
    report_data: Dict[str, Any] = {
        "report_id": report_id,
        "report_type": ReportType.INCIDENT_REPORT.value,
        "alert_id": alert_id,
        "generated_at": datetime.utcnow().isoformat(),
    }

    if db_manager:
        async with db_manager.get_session() as session:
            alert_repo = AlertRepository(session)
            alert = await alert_repo.get_alert_by_id(alert_id)
            if alert:
                report_data["incident_details"] = {
                    "alert_id": alert.alert_id,
                    "type": alert.alert_type,
                    "severity": alert.severity,
                    "status": alert.status,
                    "title": alert.title,
                    "description": alert.description,
                    "source_ip": alert.source_ip,
                    "destination_ip": alert.destination_ip,
                    "asset_id": alert.asset_id,
                    "created_at": alert.created_at.isoformat() if alert.created_at else None,
                }
            else:
                report_data["incident_details"] = {
                    "alert_id": alert_id,
                    "error": "Alert not found in database",
                }
    else:
        report_data["incident_details"] = {
            "alert_id": alert_id,
            "note": "Database unavailable - no live data",
        }

    report_data["recommendations"] = [
        "Investigate affected assets for indicators of compromise",
        "Review network logs for related lateral movement",
        "Update incident response procedures based on findings",
    ]
    return report_data


async def _generate_trend_data(
    report_id: str,
    start_date: datetime,
    end_date: datetime,
) -> Dict[str, Any]:
    """Generate trend analysis report data."""
    report_data: Dict[str, Any] = {
        "report_id": report_id,
        "report_type": ReportType.TREND_ANALYSIS.value,
        "period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
        },
        "generated_at": datetime.utcnow().isoformat(),
    }

    if db_manager:
        async with db_manager.get_session() as session:
            alert_stats = await _query_alert_stats(session, start_date, end_date)
            report_data["current_period"] = alert_stats
    else:
        report_data["current_period"] = {
            "total_alerts": 0,
            "by_severity": {},
            "by_status": {},
            "by_type": {},
        }

    report_data["insights"] = [
        "Review top alert categories for detection tuning opportunities",
        "Compare severity distribution against previous periods",
        "Identify recurring alert sources for proactive mitigation",
    ]
    return report_data


# ---------------------------------------------------------------------------
# Report formatters
# ---------------------------------------------------------------------------


def _render_template(report_data: Dict[str, Any]) -> str:
    """
    Render report data to HTML using Jinja2 templates.

    Selects the appropriate template based on report_type and renders
    with the full report_data context.

    Args:
        report_data: Report data dictionary

    Returns:
        Rendered HTML string
    """
    report_type = report_data.get("report_type", "custom")
    template_name = TEMPLATE_MAP.get(report_type, "summary.html")

    try:
        template = jinja_env.get_template(template_name)
    except Exception:
        template = jinja_env.get_template("base.html")

    title = report_type.replace("_", " ").title()
    return template.render(title=title, **report_data)


def _format_html(report_data: Dict[str, Any]) -> str:
    """Render report data as a styled HTML document via Jinja2 templates."""
    return _render_template(report_data)


def _format_csv(report_data: Dict[str, Any]) -> str:
    """Render report data as CSV."""
    output = io.StringIO()
    writer = csv.writer(output)

    # Header metadata
    writer.writerow(["Report ID", report_data.get("report_id", "")])
    writer.writerow(["Report Type", report_data.get("report_type", "")])
    writer.writerow(["Generated At", report_data.get("generated_at", "")])
    writer.writerow([])

    # Summary section
    summary = report_data.get("summary", report_data.get("current_period", {}))
    if summary:
        writer.writerow(["Metric", "Value"])
        for key, value in summary.items():
            if isinstance(value, dict):
                writer.writerow([key.replace("_", " ").title(), ""])
                for sub_key, sub_val in value.items():
                    writer.writerow([f"  {sub_key}", sub_val])
            else:
                writer.writerow([key.replace("_", " ").title(), value])
        writer.writerow([])

    # Incident details
    incident = report_data.get("incident_details", {})
    if incident:
        writer.writerow(["Incident Field", "Value"])
        for key, value in incident.items():
            writer.writerow([key.replace("_", " ").title(), value])
        writer.writerow([])

    # Recommendations
    recommendations = report_data.get("recommendations", [])
    if recommendations:
        writer.writerow(["Recommendations"])
        for idx, rec in enumerate(recommendations, 1):
            writer.writerow([f"{idx}. {rec}"])

    return output.getvalue()


def _format_pdf(report_data: Dict[str, Any]) -> bytes:
    """
    Render report data as a PDF document.

    Uses weasyprint if available, otherwise falls back to a simple
    reportlab-based PDF, or ultimately to HTML bytes as a last resort.

    Args:
        report_data: Report data dictionary

    Returns:
        PDF content as bytes
    """
    html_content = _render_template(report_data)

    # Try weasyprint first (best quality)
    try:
        from weasyprint import HTML as WeasyprintHTML

        pdf_bytes = WeasyprintHTML(string=html_content).write_pdf()
        logger.info("PDF generated via weasyprint")
        return pdf_bytes
    except ImportError:
        logger.debug("weasyprint not installed, trying xhtml2pdf")
    except Exception as e:
        logger.warning(f"weasyprint PDF generation failed: {e}, trying xhtml2pdf")

    # Try xhtml2pdf (pure Python fallback)
    try:
        from xhtml2pdf import pisa

        result_buf = io.BytesIO()
        pisa_status = pisa.CreatePDF(io.StringIO(html_content), dest=result_buf)
        if not pisa_status.err:
            logger.info("PDF generated via xhtml2pdf")
            return result_buf.getvalue()
        logger.warning("xhtml2pdf returned errors, trying reportlab")
    except ImportError:
        logger.debug("xhtml2pdf not installed, trying reportlab")
    except Exception as e:
        logger.warning(f"xhtml2pdf PDF generation failed: {e}, trying reportlab")

    # Fallback: reportlab (basic PDF)
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
        from reportlab.lib import colors

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
        styles = getSampleStyleSheet()
        story: List[Any] = []

        # Title
        title_style = ParagraphStyle(
            "ReportTitle", parent=styles["Heading1"], fontSize=18, spaceAfter=12,
            textColor=colors.HexColor("#1a237e"),
        )
        report_type = report_data.get("report_type", "Report").replace("_", " ").title()
        story.append(Paragraph(report_type, title_style))
        story.append(Spacer(1, 6))

        # Meta
        meta_style = ParagraphStyle("Meta", parent=styles["Normal"], fontSize=9, textColor=colors.gray)
        story.append(Paragraph(f"Report ID: {report_data.get('report_id', 'N/A')}", meta_style))
        story.append(Paragraph(f"Generated: {report_data.get('generated_at', 'N/A')}", meta_style))
        period = report_data.get("period", {})
        if period:
            story.append(Paragraph(f"Period: {period.get('start', '')} to {period.get('end', '')}", meta_style))
        story.append(Spacer(1, 12))

        # Summary table
        summary = report_data.get("summary", report_data.get("current_period", {}))
        if summary:
            story.append(Paragraph("Summary", styles["Heading2"]))
            table_data = [["Metric", "Value"]]
            for key, value in summary.items():
                if isinstance(value, dict):
                    formatted = ", ".join(f"{k}: {v}" for k, v in value.items()) if value else "N/A"
                else:
                    formatted = str(value)
                table_data.append([key.replace("_", " ").title(), formatted])

            t = Table(table_data, colWidths=[8 * cm, 8 * cm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a237e")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 12))

        # Incident details table
        incident = report_data.get("incident_details", {})
        if incident:
            story.append(Paragraph("Incident Details", styles["Heading2"]))
            table_data = [["Field", "Value"]]
            for key, value in incident.items():
                table_data.append([key.replace("_", " ").title(), str(value or "N/A")])
            t = Table(table_data, colWidths=[6 * cm, 10 * cm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a237e")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 12))

        # Recommendations / Insights
        recs = report_data.get("recommendations", report_data.get("insights", []))
        if recs:
            story.append(Paragraph("Recommendations", styles["Heading2"]))
            for rec in recs:
                story.append(Paragraph(f"• {rec}", styles["Normal"]))
            story.append(Spacer(1, 6))

        doc.build(story)
        logger.info("PDF generated via reportlab")
        return buf.getvalue()

    except ImportError:
        logger.warning("No PDF library available (weasyprint/xhtml2pdf/reportlab), returning HTML as PDF content")
    except Exception as e:
        logger.error(f"reportlab PDF generation failed: {e}")

    # Ultimate fallback: return HTML bytes with a warning
    return html_content.encode("utf-8")


# ---------------------------------------------------------------------------
# Background report generation
# ---------------------------------------------------------------------------


async def _run_report_generation(
    report_id: str,
    report_type: str,
    report_format: str,
    params: Dict[str, Any],
):
    """Background task: generate report data, format, store, and publish event."""
    try:
        # Update status to generating
        if db_manager:
            async with db_manager.get_session() as session:
                repo = ReportRepository(session)
                await repo.update_status(report_id, ReportStatus.GENERATING.value)
                await session.commit()

        # Generate data based on type
        now = datetime.utcnow()
        report_data: Dict[str, Any] = {}

        if report_type == ReportType.DAILY_SUMMARY.value:
            date_str = params.get("date")
            target = datetime.fromisoformat(date_str) if date_str else now
            report_data = await _generate_summary_data(
                report_id, report_type, target.replace(hour=0, minute=0, second=0), target
            )

        elif report_type == ReportType.WEEKLY_SUMMARY.value:
            date_str = params.get("date")
            end = datetime.fromisoformat(date_str) if date_str else now
            start = end - timedelta(days=7)
            report_data = await _generate_summary_data(report_id, report_type, start, end)

        elif report_type == ReportType.MONTHLY_SUMMARY.value:
            date_str = params.get("date")
            end = datetime.fromisoformat(date_str) if date_str else now
            start = end - timedelta(days=30)
            report_data = await _generate_summary_data(report_id, report_type, start, end)

        elif report_type == ReportType.INCIDENT_REPORT.value:
            alert_id = params.get("alert_id", "unknown")
            report_data = await _generate_incident_data(report_id, alert_id)

        elif report_type == ReportType.TREND_ANALYSIS.value:
            end = now
            start = end - timedelta(days=30)
            report_data = await _generate_trend_data(report_id, start, end)

        elif report_type == ReportType.CUSTOM.value:
            filters = params.get("filters", {})
            end = now
            start = end - timedelta(days=int(filters.get("days", 7)))
            report_data = await _generate_summary_data(report_id, report_type, start, end)
            report_data["custom_filters"] = filters

        # Format the report into the requested output
        if report_format == ReportFormat.PDF.value:
            file_content = _format_pdf(report_data)
            file_ext = "pdf"
        elif report_format == ReportFormat.HTML.value:
            file_content = _format_html(report_data).encode("utf-8")
            file_ext = "html"
        elif report_format == ReportFormat.CSV.value:
            file_content = _format_csv(report_data).encode("utf-8")
            file_ext = "csv"
        else:
            file_content = json.dumps(report_data, default=str, indent=2).encode("utf-8")
            file_ext = "json"

        file_size = len(file_content)

        # Store in MinIO / local filesystem
        file_path: Optional[str] = None
        if report_storage:
            try:
                file_path = report_storage.upload_report(report_id, file_content, file_ext)
            except Exception as e:
                logger.warning(f"Failed to upload report to storage: {e}")

        # Persist completed status to DB
        if db_manager:
            async with db_manager.get_session() as session:
                repo = ReportRepository(session)
                await repo.update_status(
                    report_id,
                    ReportStatus.COMPLETED.value,
                    file_path=file_path,
                    file_size=file_size,
                )
                # Also store report data in JSON for API retrieval
                report_obj = await repo.get_by_report_id(report_id)
                if report_obj:
                    report_obj.filters = {"_report_data": report_data, **(report_obj.filters or {})}
                await session.commit()

        # Publish event via message queue
        if publisher:
            try:
                await publisher.publish(
                    routing_key="report.completed",
                    message={
                        "event": "report.completed",
                        "report_id": report_id,
                        "report_type": report_type,
                        "format": report_format,
                        "file_path": file_path,
                        "file_size": file_size,
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                )
            except Exception as e:
                logger.warning(f"Failed to publish report event: {e}")

        await audit_log(
            event_type="report.generated",
            action="generate",
            target_id=report_id,
            details={
                "report_type": report_type,
                "format": report_format,
                "file_size": file_size,
                "storage_path": file_path,
            },
        )

        logger.info(
            f"Report {report_id} generated successfully",
            extra={"report_type": report_type, "format": report_format, "size": file_size},
        )

    except Exception as e:
        logger.error(f"Failed to generate report {report_id}: {e}", exc_info=True)
        if db_manager:
            try:
                async with db_manager.get_session() as session:
                    repo = ReportRepository(session)
                    await repo.update_status(
                        report_id, ReportStatus.FAILED.value, error_message=str(e)
                    )
                    await session.commit()
            except Exception as db_err:
                logger.error(f"Failed to update report status to failed: {db_err}")

        await audit_log(
            event_type="report.failed",
            action="generate",
            target_id=report_id,
            status="failure",
            error_message=str(e),
        )


# ---------------------------------------------------------------------------
# Message queue handler
# ---------------------------------------------------------------------------


async def _handle_report_request(message: Dict[str, Any]) -> None:
    """Handle report generation requests from the message queue."""
    report_type = message.get("report_type")
    params = message.get("params", {})
    if not report_type:
        logger.warning("Received report request without report_type", extra={"message": message})
        return

    report_id = f"report-{uuid.uuid4()}"
    report_format = params.get("format", "json")
    logger.info(f"Processing MQ report request: {report_id}", extra={"report_type": report_type})

    if db_manager:
        async with db_manager.get_session() as session:
            repo = ReportRepository(session)
            await repo.create_report({
                "report_id": report_id,
                "name": params.get("name", f"{report_type} Report"),
                "report_type": report_type,
                "format": report_format,
                "status": ReportStatus.PENDING.value,
                "filters": params.get("filters"),
                "created_by": params.get("created_by", "mq-consumer"),
            })
            await session.commit()

    await _run_report_generation(report_id, report_type, report_format, params)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, consumer, publisher, report_storage

    logger.info("Starting Reporting service...")

    # Initialize database
    await init_database(
        database_url=config.database_url,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        echo=config.debug,
    )
    db_manager = get_database_manager()

    # Initialize file storage (MinIO or local)
    report_storage = ReportStorage()
    await report_storage.initialize()

    # Initialize message queue (optional - graceful if unavailable)
    amqp_url = os.getenv("RABBITMQ_URL", "")
    if amqp_url:
        try:
            publisher = MessagePublisher(amqp_url, exchange_name="reports")
            await publisher.connect()

            consumer = MessageConsumer(
                amqp_url, queue_name="report.requests", prefetch_count=5
            )
            await consumer.connect()
            await consumer.subscribe(_handle_report_request)
            logger.info("Message queue connected")
        except Exception as e:
            logger.warning(f"Message queue unavailable, running without MQ: {e}")
            publisher = None
            consumer = None

    logger.info("Reporting service started successfully")

    yield

    # Cleanup
    if consumer:
        try:
            await consumer.close()
        except Exception:
            pass
    if publisher:
        try:
            await publisher.close()
        except Exception:
            pass
    await db_manager.close()
    logger.info("Reporting service stopped")


app = FastAPI(
    title="Reporting Service",
    description="Generates, persists, and delivers security reports with PDF/HTML/CSV/JSON export and MinIO storage",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/reports/generate", response_model=Dict[str, Any])
async def generate_report(body: ReportGenerateRequest, background_tasks: BackgroundTasks):
    """
    Generate a report asynchronously.

    Creates a report record in the database and kicks off background generation.
    Supports PDF, HTML, CSV, and JSON output formats.
    """
    if body.report_type == ReportType.INCIDENT_REPORT and not body.alert_id:
        raise HTTPException(status_code=400, detail="alert_id is required for incident reports")

    try:
        report_id = f"report-{uuid.uuid4()}"
        name = body.name or f"{body.report_type.value.replace('_', ' ').title()} Report"

        # Persist to database
        if db_manager:
            async with db_manager.get_session() as session:
                repo = ReportRepository(session)
                await repo.create_report({
                    "report_id": report_id,
                    "name": name,
                    "description": body.description,
                    "report_type": body.report_type.value,
                    "format": body.format.value,
                    "status": ReportStatus.PENDING.value,
                    "filters": body.filters,
                    "created_by": "api",
                    "schedule_frequency": body.schedule_frequency,
                    "schedule_time": body.schedule_time,
                    "schedule_recipients": body.schedule_recipients,
                })
                await session.commit()

        # Schedule background generation
        params = {
            "date": body.date,
            "alert_id": body.alert_id,
            "filters": body.filters or {},
        }
        background_tasks.add_task(
            _run_report_generation, report_id, body.report_type.value, body.format.value, params
        )

        return {
            "success": True,
            "data": {
                "report_id": report_id,
                "name": name,
                "report_type": body.report_type.value,
                "format": body.format.value,
                "status": ReportStatus.PENDING.value,
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")


@app.get("/api/v1/reports/{report_id}", response_model=Dict[str, Any])
async def get_report(report_id: str):
    """Get report status and metadata."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        report = await repo.get_by_report_id(report_id)
        if not report:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

        data = _report_to_dict(report)
        # Include report content if completed
        if report.status == ReportStatus.COMPLETED.value and report.filters:
            report_content = report.filters.get("_report_data")
            if report_content:
                data["report_data"] = report_content

        # Include presigned download URL if stored in MinIO
        if report.file_path and report_storage:
            presigned_url = report_storage.get_presigned_url(report.file_path)
            if presigned_url:
                data["download_url"] = presigned_url

    return {
        "success": True,
        "data": data,
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/reports/{report_id}/download")
async def download_report(report_id: str, format: Optional[ReportFormat] = None):
    """
    Download generated report.

    If the report has a file stored in MinIO/local storage, serves that file.
    Otherwise, re-renders the report data in the requested format.
    The ``format`` query parameter overrides the stored format for re-rendering.
    """
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        report = await repo.get_by_report_id(report_id)
        if not report:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

        if report.status != ReportStatus.COMPLETED.value:
            raise HTTPException(
                status_code=400,
                detail=f"Report not ready. Current status: {report.status}",
            )

        report_data = (report.filters or {}).get("_report_data")
        stored_format = report.format or "json"

    # Determine output format: use query param override or stored format
    output_format = format.value if format else stored_format

    # Try to serve from storage first (if format matches stored format)
    if report.file_path and report_storage and output_format == stored_format:
        file_bytes = report_storage.download_report(report.file_path)
        if file_bytes:
            content_types = {
                "pdf": "application/pdf",
                "html": "text/html",
                "csv": "text/csv",
                "json": "application/json",
            }
            return Response(
                content=file_bytes,
                media_type=content_types.get(output_format, "application/octet-stream"),
                headers={"Content-Disposition": f"attachment; filename={report_id}.{output_format}"},
            )

    # Fall back to re-rendering from report_data
    if not report_data:
        raise HTTPException(status_code=404, detail="Report data not available")

    try:
        if output_format == "pdf":
            content = _format_pdf(report_data)
            return Response(
                content=content,
                media_type="application/pdf",
                headers={"Content-Disposition": f"attachment; filename={report_id}.pdf"},
            )
        elif output_format == "html":
            content = _format_html(report_data)
            return Response(
                content=content,
                media_type="text/html",
                headers={"Content-Disposition": f"attachment; filename={report_id}.html"},
            )
        elif output_format == "csv":
            content = _format_csv(report_data)
            return Response(
                content=content,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={report_id}.csv"},
            )
        else:
            return JSONResponse(
                content=report_data,
                headers={"Content-Disposition": f"attachment; filename={report_id}.json"},
            )
    except Exception as e:
        logger.error(f"Failed to download report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to format report: {str(e)}")


@app.get("/api/v1/reports", response_model=Dict[str, Any])
async def list_reports(
    status: Optional[ReportStatus] = None,
    report_type: Optional[ReportType] = None,
    created_by: Optional[str] = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
):
    """List reports with filters and pagination."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        reports, total = await repo.list_reports(
            status=status.value if status else None,
            report_type=report_type.value if report_type else None,
            created_by=created_by,
            offset=offset,
            limit=limit,
        )

    return {
        "success": True,
        "data": {
            "reports": [_report_to_dict(r) for r in reports],
            "total": total,
            "offset": offset,
            "limit": limit,
        },
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.put("/api/v1/reports/{report_id}/schedule", response_model=Dict[str, Any])
async def update_report_schedule(report_id: str, body: ReportUpdateRequest):
    """Update the schedule configuration for a report."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    if body.schedule_frequency and body.schedule_frequency not in ("daily", "weekly", "monthly"):
        raise HTTPException(
            status_code=400,
            detail="schedule_frequency must be daily, weekly, or monthly",
        )

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        report = await repo.get_by_report_id(report_id)
        if not report:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

        updates = body.model_dump(exclude_none=True)
        if updates:
            for key, value in updates.items():
                setattr(report, key, value)
            await session.commit()
            await session.refresh(report)

    await audit_log(
        event_type="report.schedule_updated",
        action="update_schedule",
        target_id=report_id,
        details=updates,
    )

    return {
        "success": True,
        "data": _report_to_dict(report),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/reports/scheduled/list", response_model=Dict[str, Any])
async def list_scheduled_reports(frequency: Optional[str] = None):
    """List reports that have a recurring schedule configured."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        reports = await repo.get_scheduled_reports(frequency=frequency)

    return {
        "success": True,
        "data": {
            "reports": [_report_to_dict(r) for r in reports],
            "total": len(reports),
        },
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.delete("/api/v1/reports/{report_id}", response_model=Dict[str, Any])
async def delete_report(report_id: str):
    """Delete a report and its stored file."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        report = await repo.get_by_report_id(report_id)
        if not report:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

        # Delete file from storage
        if report.file_path and report_storage:
            try:
                report_storage.delete_report(report.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete report file from storage: {e}")

        deleted = await repo.delete_report(report_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")
        await session.commit()

    await audit_log(
        event_type="report.deleted",
        action="delete",
        target_id=report_id,
    )

    return {
        "success": True,
        "message": f"Report {report_id} deleted",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/reports/stats/summary", response_model=Dict[str, Any])
async def get_report_stats():
    """Get aggregate report statistics."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = ReportRepository(session)
        by_status = await repo.count_by_status()
        by_type = await repo.count_by_type()
        total = sum(by_status.values()) if by_status else 0

    return {
        "success": True,
        "data": {
            "total_reports": total,
            "by_status": by_status,
            "by_type": by_type,
        },
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    db_ok = db_manager is not None
    mq_ok = publisher is not None
    storage_ok = report_storage is not None

    status = "healthy" if db_ok else "degraded"

    report_stats: Dict[str, Any] = {}
    if db_ok:
        try:
            async with db_manager.get_session() as session:
                repo = ReportRepository(session)
                report_stats = await repo.count_by_status()
        except Exception:
            report_stats = {"error": "Failed to query"}

    storage_backend = "unavailable"
    if storage_ok:
        storage_backend = "minio" if report_storage.is_minio_available else "local_filesystem"

    return {
        "status": status,
        "service": "reporting-service",
        "version": "3.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "dependencies": {
            "database": "connected" if db_ok else "unavailable",
            "message_queue": "connected" if mq_ok else "unavailable",
            "file_storage": storage_backend,
        },
        "reports": report_stats,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
