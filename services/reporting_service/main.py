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

"""Reporting Service - Generates various security reports."""

import asyncio
import io
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.messaging import MessageConsumer
from shared.models import ResponseMeta, SuccessResponse
from shared.utils import Config, get_logger

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
consumer: MessageConsumer = None


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, consumer

    logger.info("Starting Reporting service...")

    # Initialize database
    import os
    await init_database(
        database_url=config.database_url,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        echo=config.debug,
    )
    db_manager = get_database_manager()

    logger.info("Reporting service started successfully")

    yield

    # Cleanup
    await db_manager.close()
    logger.info("Reporting service stopped")


app = FastAPI(
    title="Reporting Service",
    description="Generates various security reports and summaries",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# In-memory report storage (use database in production)
report_cache: Dict[str, Dict[str, Any]] = {}


async def generate_daily_summary(report_id: str, date: datetime):
    """Generate daily summary report."""
    try:
        report_cache[report_id]["status"] = ReportStatus.GENERATING

        # TODO: Query actual data from database and analytics service
        report_data = {
            "report_id": report_id,
            "report_type": ReportType.DAILY_SUMMARY,
            "date": date.date().isoformat(),
            "generated_at": datetime.utcnow().isoformat(),
            "summary": {
                "total_alerts": 150,
                "critical_alerts": 5,
                "high_alerts": 20,
                "medium_alerts": 45,
                "low_alerts": 80,
                "triaged_alerts": 120,
                "automation_executed": 15,
                "time_saved_hours": 7.5,
            },
            "top_alerts": [
                {
                    "alert_id": "ALT-001",
                    "type": "malware",
                    "severity": "critical",
                    "description": "Ransomware detected on server-001",
                },
                {
                    "alert_id": "ALT-002",
                    "type": "phishing",
                    "severity": "high",
                    "description": "Spear phishing campaign targeting finance",
                },
            ],
            "recommendations": [
                "Update firewall rules for known malicious IPs",
                "Conduct security awareness training for phishing",
                "Review EDR policies for endpoint protection",
            ],
        }

        report_cache[report_id]["status"] = ReportStatus.COMPLETED
        report_cache[report_id]["data"] = report_data

        logger.info(f"Daily summary report {report_id} generated")

    except Exception as e:
        logger.error(f"Failed to generate daily summary: {e}", exc_info=True)
        report_cache[report_id]["status"] = ReportStatus.FAILED
        report_cache[report_id]["error"] = str(e)


async def generate_incident_report(report_id: str, alert_id: str):
    """Generate detailed incident report."""
    try:
        report_cache[report_id]["status"] = ReportStatus.GENERATING

        # TODO: Query actual alert data, triage results, automation actions
        report_data = {
            "report_id": report_id,
            "report_type": ReportType.INCIDENT_REPORT,
            "alert_id": alert_id,
            "generated_at": datetime.utcnow().isoformat(),
            "incident_details": {
                "alert_id": alert_id,
                "type": "malware",
                "severity": "critical",
                "first_seen": "2025-01-05T10:00:00Z",
                "last_seen": "2025-01-05T12:00:00Z",
                "affected_assets": ["server-001", "workstation-005"],
                "description": "Ransomware infection detected on critical server",
            },
            "timeline": [
                {"timestamp": "2025-01-05T10:00:00Z", "event": "Alert triggered by EDR"},
                {
                    "timestamp": "2025-01-05T10:01:00Z",
                    "event": "AI Triage completed - Risk: Critical",
                },
                {
                    "timestamp": "2025-01-05T10:02:00Z",
                    "event": "Automation playbook executed - Isolated host",
                },
                {"timestamp": "2025-01-05T10:05:00Z", "event": "Security analyst notified"},
                {
                    "timestamp": "2025-01-05T12:00:00Z",
                    "event": "Incident contained - System restored",
                },
            ],
            "triage_details": {
                "risk_level": "critical",
                "confidence": 0.95,
                "triaged_by": "ai-agent",
                "triaged_at": "2025-01-05T10:01:00Z",
                "reasoning": "High confidence ransomware detection based on file behavior and network activity",
            },
            "actions_taken": [
                {
                    "action": "isolate_host",
                    "executed_at": "2025-01-05T10:02:00Z",
                    "status": "success",
                    "result": "Host isolated from network",
                },
                {
                    "action": "quarantine_file",
                    "executed_at": "2025-01-05T10:03:00Z",
                    "status": "success",
                    "result": "Malicious file quarantined",
                },
                {
                    "action": "create_ticket",
                    "executed_at": "2025-01-05T10:04:00Z",
                    "status": "success",
                    "result": "Incident ticket INC-12345 created",
                },
            ],
            "lessons_learned": [
                "Quick isolation prevented lateral movement",
                "AI triage reduced response time by 80%",
                "Automation playbook executed successfully",
            ],
            "recommendations": [
                "Review backup and recovery procedures",
                "Conduct forensic analysis on isolated systems",
                "Update security policies based on incident findings",
            ],
        }

        report_cache[report_id]["status"] = ReportStatus.COMPLETED
        report_cache[report_id]["data"] = report_data

        logger.info(f"Incident report {report_id} generated")

    except Exception as e:
        logger.error(f"Failed to generate incident report: {e}", exc_info=True)
        report_cache[report_id]["status"] = ReportStatus.FAILED
        report_cache[report_id]["error"] = str(e)


def format_report_html(report_data: Dict[str, Any]) -> str:
    """Format report data as HTML."""
    html_template = f"""
<!DOCTYPE html>
<html>
<head>
    <title>{report_data['report_type'].replace('_', ' ').title()}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; }}
        h1 {{ color: #333; }}
        .summary {{ background: #f5f5f5; padding: 20px; border-radius: 5px; }}
        .section {{ margin: 20px 0; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #4CAF50; color: white; }}
    </style>
</head>
<body>
    <h1>{report_data['report_type'].replace('_', ' ').title()}</h1>
    <p><strong>Generated:</strong> {report_data.get('generated_at', 'N/A')}</p>

    <div class="summary">
        <h2>Summary</h2>
        <pre>{report_data.get('summary', {})}</pre>
    </div>

    <div class="section">
        <h2>Details</h2>
        <pre>{report_data}</pre>
    </div>
</body>
</html>
    """
    return html_template


# API Endpoints


@app.post("/api/v1/reports/generate", response_model=Dict[str, Any])
async def generate_report(
    report_type: ReportType,
    background_tasks: BackgroundTasks,
    date: Optional[str] = None,
    alert_id: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
):
    """
    Generate a report asynchronously.

    Args:
        report_type: Type of report to generate
        date: Date for summary reports (YYYY-MM-DD)
        alert_id: Alert ID for incident reports
        parameters: Additional parameters for custom reports
    """
    try:
        report_id = f"report-{uuid.uuid4()}"

        # Initialize report entry
        report_cache[report_id] = {
            "report_id": report_id,
            "report_type": report_type,
            "status": ReportStatus.PENDING,
            "created_at": datetime.utcnow().isoformat(),
        }

        # Schedule report generation
        if report_type == ReportType.DAILY_SUMMARY:
            report_date = datetime.fromisoformat(date) if date else datetime.utcnow()
            background_tasks.add_task(generate_daily_summary, report_id, report_date)

        elif report_type == ReportType.INCIDENT_REPORT:
            if not alert_id:
                raise HTTPException(
                    status_code=400, detail="alert_id is required for incident reports"
                )
            background_tasks.add_task(generate_incident_report, report_id, alert_id)

        else:
            # TODO: Implement other report types
            report_cache[report_id]["status"] = ReportStatus.FAILED
            report_cache[report_id]["error"] = "Report type not yet implemented"

        return {
            "success": True,
            "data": {
                "report_id": report_id,
                "report_type": report_type.value,
                "status": report_cache[report_id]["status"].value,
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
    """Get report status and data."""
    report = report_cache.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

    return {
        "success": True,
        "data": report,
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/reports/{report_id}/download")
async def download_report(report_id: str, format: ReportFormat = ReportFormat.HTML):
    """Download generated report in specified format."""
    report = report_cache.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

    if report["status"] != ReportStatus.COMPLETED:
        raise HTTPException(
            status_code=400, detail=f"Report not ready. Current status: {report['status']}"
        )

    report_data = report.get("data")
    if not report_data:
        raise HTTPException(status_code=404, detail="Report data not available")

    try:
        if format == ReportFormat.HTML:
            html_content = format_report_html(report_data)

            # Return HTML file
            return FileResponse(
                path=None,  # We're returning content directly
                filename=f"{report_id}.html",
                media_type="text/html",
                content=html_content.encode(),
            )

        elif format == ReportFormat.JSON:
            from fastapi.responses import JSONResponse

            return JSONResponse(
                content=report_data,
                headers={"Content-Disposition": f"attachment; filename={report_id}.json"},
            )

        elif format == ReportFormat.CSV:
            # Simple CSV export
            import csv

            output = io.StringIO()
            writer = csv.writer(output)

            # Write basic info
            writer.writerow(["Key", "Value"])
            writer.writerow(["Report ID", report_data.get("report_id")])
            writer.writerow(["Report Type", report_data.get("report_type")])
            writer.writerow(["Generated At", report_data.get("generated_at")])

            csv_content = output.getvalue()

            return FileResponse(
                path=None,
                filename=f"{report_id}.csv",
                media_type="text/csv",
                content=csv_content.encode(),
            )

        elif format == ReportFormat.PDF:
            # TODO: Implement PDF generation (using reportlab or weasyprint)
            raise HTTPException(status_code=501, detail="PDF format not yet implemented")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to download report: {str(e)}")


@app.get("/api/v1/reports", response_model=Dict[str, Any])
async def list_reports(
    status: Optional[ReportStatus] = None, report_type: Optional[ReportType] = None
):
    """List all reports."""
    reports = list(report_cache.values())

    if status:
        reports = [r for r in reports if r["status"] == status]

    if report_type:
        reports = [r for r in reports if r["report_type"] == report_type]

    return {
        "success": True,
        "data": {"reports": reports, "total": len(reports)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.delete("/api/v1/reports/{report_id}", response_model=Dict[str, Any])
async def delete_report(report_id: str):
    """Delete a report."""
    if report_id not in report_cache:
        raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

    del report_cache[report_id]

    return {
        "success": True,
        "message": "Report deleted",
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "reporting-service",
        "timestamp": datetime.utcnow().isoformat(),
        "reports": {
            "total": len(report_cache),
            "completed": len(
                [r for r in report_cache.values() if r["status"] == ReportStatus.COMPLETED]
            ),
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
