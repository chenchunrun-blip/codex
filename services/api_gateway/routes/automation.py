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
Automation API endpoints.

Proxies requests to the automation_orchestrator backend service
for playbook execution and execution status tracking.
"""

import os
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter()

AUTOMATION_URL = os.getenv(
    "AUTOMATION_URL",
    "http://automation-orchestrator:8000",
)


# =============================================================================
# Request / Response Helpers
# =============================================================================

class ExecutePlaybookRequest(BaseModel):
    """Request body for executing a playbook."""

    alert_id: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None


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
    timeout: float = 30.0,
) -> Any:
    """
    Forward a request to the automation orchestrator service.

    Args:
        method: HTTP method.
        path: URL path to append to the base URL.
        json: JSON body for POST requests.
        timeout: Request timeout in seconds.

    Returns:
        Parsed JSON response from the backend.

    Raises:
        HTTPException: On backend errors or connectivity issues.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method,
                f"{AUTOMATION_URL}{path}",
                json=json,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Automation service returned error",
            extra={"path": path, "status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach automation service: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Automation orchestrator service unavailable",
        )


# =============================================================================
# Execute Playbook
# =============================================================================

@router.post(
    "/automation/playbooks/{playbook_id}/execute",
    summary="Execute Playbook",
    description="Execute an automation playbook by its ID",
)
async def execute_playbook(
    playbook_id: str,
    request: ExecutePlaybookRequest,
):
    """
    Execute an automation playbook.

    Args:
        playbook_id: The playbook identifier.
        request: Execution parameters including optional alert_id.

    Returns:
        Execution details including the execution ID for status tracking.
    """
    data = await _proxy_request(
        "POST",
        f"/api/v1/automation/playbooks/{playbook_id}/execute",
        json=request.model_dump(),
    )
    return _wrap_response(data)


# =============================================================================
# Get Execution Status
# =============================================================================

@router.get(
    "/automation/executions/{execution_id}",
    summary="Get Execution Status",
    description="Retrieve the status of a playbook execution",
)
async def get_execution_status(execution_id: str):
    """
    Get the status of a playbook execution.

    Args:
        execution_id: The execution identifier.

    Returns:
        Execution status and result details.
    """
    data = await _proxy_request(
        "GET",
        f"/api/v1/automation/executions/{execution_id}",
    )
    return _wrap_response(data)
