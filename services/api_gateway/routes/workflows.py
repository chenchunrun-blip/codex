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
Workflow management API endpoints.

Proxies requests to the workflow_engine backend service for
alert assignment, escalation, and workflow lifecycle operations.
"""

import os
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel

router = APIRouter()

WORKFLOW_ENGINE_URL = os.getenv(
    "WORKFLOW_ENGINE_URL",
    "http://workflow-engine:8000",
)


# =============================================================================
# Request / Response Helpers
# =============================================================================


class AssignAlertRequest(BaseModel):
    """Request body for assigning an alert."""

    user_id: str
    comment: Optional[str] = None


class EscalateAlertRequest(BaseModel):
    """Request body for escalating an alert."""

    reason: str
    escalate_to: Optional[str] = None
    priority: Optional[str] = None


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


async def _proxy_request(
    method: str,
    path: str,
    *,
    json: Any = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
) -> Any:
    """
    Forward a request to the workflow engine service.

    Args:
        method: HTTP method (GET, POST, etc.).
        path: URL path to append to the base URL.
        json: JSON body for POST/PATCH requests.
        params: Query parameters.
        timeout: Request timeout in seconds.

    Returns:
        Parsed JSON response from the backend service.

    Raises:
        HTTPException: On backend errors or connectivity issues.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method,
                f"{WORKFLOW_ENGINE_URL}{path}",
                json=json,
                params=params,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Workflow engine returned error",
            extra={"path": path, "status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach workflow engine: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Workflow engine service unavailable",
        )


# =============================================================================
# Assign Alert
# =============================================================================


@router.post(
    "/alerts/{alert_id}/assign",
    summary="Assign Alert",
    description="Assign an alert to a specific user for investigation",
)
async def assign_alert(alert_id: str, request: AssignAlertRequest):
    """
    Assign an alert to a user.

    Args:
        alert_id: The alert identifier.
        request: Assignment details including target user.

    Returns:
        Updated alert assignment information.
    """
    data = await _proxy_request(
        "POST",
        f"/api/v1/alerts/{alert_id}/assign",
        json=request.model_dump(),
    )
    return _wrap_response(data)


# =============================================================================
# Escalate Alert
# =============================================================================


@router.post(
    "/alerts/{alert_id}/escalate",
    summary="Escalate Alert",
    description="Escalate an alert to a higher priority or team",
)
async def escalate_alert(alert_id: str, request: EscalateAlertRequest):
    """
    Escalate an alert.

    Args:
        alert_id: The alert identifier.
        request: Escalation details including reason.

    Returns:
        Escalation result.
    """
    data = await _proxy_request(
        "POST",
        f"/api/v1/alerts/{alert_id}/escalate",
        json=request.model_dump(),
    )
    return _wrap_response(data)


# =============================================================================
# List Workflows
# =============================================================================


@router.get(
    "/workflows",
    summary="List Workflows",
    description="Retrieve a list of workflows with optional filtering",
)
async def list_workflows(
    status: Optional[str] = Query(None, description="Filter by workflow status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
):
    """
    List workflows with optional status filter and pagination.

    Args:
        status: Optional workflow status filter.
        skip: Pagination offset.
        limit: Maximum number of results.

    Returns:
        Paginated list of workflows.
    """
    params: Dict[str, Any] = {"skip": skip, "limit": limit}
    if status:
        params["status"] = status

    data = await _proxy_request(
        "GET",
        "/api/v1/workflows",
        params=params,
    )
    return _wrap_response(data)


# =============================================================================
# Get Workflow Details
# =============================================================================


@router.get(
    "/workflows/{workflow_id}",
    summary="Get Workflow Details",
    description="Retrieve detailed information about a specific workflow",
)
async def get_workflow(workflow_id: str):
    """
    Get workflow details by ID.

    Args:
        workflow_id: The workflow identifier.

    Returns:
        Detailed workflow information.
    """
    data = await _proxy_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}",
    )
    return _wrap_response(data)
