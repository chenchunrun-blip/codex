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
Reporting API endpoints.

Proxies requests to the reporting_service backend for report
generation and download.
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

router = APIRouter()

REPORTING_URL = os.getenv(
    "REPORTING_URL",
    "http://reporting-service:8000",
)


# =============================================================================
# Request / Response Helpers
# =============================================================================


class GenerateReportRequest(BaseModel):
    """Request body for generating a report."""

    report_type: str
    """Type of report (e.g. 'daily_summary', 'incident', 'compliance')."""

    time_range: Optional[str] = "24h"
    """Time range for the report data."""

    filters: Optional[Dict[str, Any]] = None
    """Optional filters to apply to the report data."""

    format: Optional[str] = "pdf"
    """Output format (pdf, csv, json)."""


def _wrap_response(
    data: Any,
    *,
    success: bool = True,
) -> Dict[str, Any]:
    """Wrap data in the standard API response envelope."""
    return {
        "success": success,
        "data": data,
        "meta": {
            "timestamp": datetime.utcnow().isoformat(),
            "request_id": str(uuid4()),
        },
    }


# =============================================================================
# Generate Report
# =============================================================================


@router.post(
    "/reports",
    summary="Generate Report",
    description="Request generation of a new report",
)
async def generate_report(request: GenerateReportRequest):
    """
    Generate a new report.

    Args:
        request: Report generation parameters.

    Returns:
        Report metadata including the report_id for download.
    """
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{REPORTING_URL}/api/v1/reports",
                json=request.model_dump(),
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Reporting service returned error",
            extra={"status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach reporting service: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Reporting service unavailable",
        )

    return _wrap_response(data)


# =============================================================================
# Download Report
# =============================================================================


@router.get(
    "/reports/{report_id}/download",
    summary="Download Report",
    description="Download a previously generated report",
)
async def download_report(report_id: str):
    """
    Download a generated report.

    Streams the report file from the reporting service back to the
    client, preserving the original content type and filename.

    Args:
        report_id: The report identifier.

    Returns:
        Streamed file response with the report content.
    """
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.get(
                f"{REPORTING_URL}/api/v1/reports/{report_id}/download",
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Report download failed",
            extra={"report_id": report_id, "status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach reporting service: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Reporting service unavailable",
        )

    # Forward the file response with original headers
    content_type = resp.headers.get("content-type", "application/octet-stream")
    content_disposition = resp.headers.get(
        "content-disposition",
        f'attachment; filename="report_{report_id}"',
    )

    return StreamingResponse(
        iter([resp.content]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition},
    )
