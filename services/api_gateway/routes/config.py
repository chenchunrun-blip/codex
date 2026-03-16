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
Configuration API endpoints.

Proxies requests to the configuration_service backend for
reading and updating system configuration.
"""

import os
from datetime import datetime
from typing import Any, Dict
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter()

CONFIGURATION_URL = os.getenv(
    "CONFIGURATION_URL",
    "http://configuration-service:8000",
)


# =============================================================================
# Request / Response Helpers
# =============================================================================

class UpdateConfigRequest(BaseModel):
    """Request body for updating configuration."""

    settings: Dict[str, Any]
    """Dictionary of configuration keys and values to update."""


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
    Forward a request to the configuration service.

    Args:
        method: HTTP method.
        path: URL path to append to the base URL.
        json: JSON body for PATCH requests.
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
                f"{CONFIGURATION_URL}{path}",
                json=json,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Configuration service returned error",
            extra={"path": path, "status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach configuration service: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Configuration service unavailable",
        )


# =============================================================================
# Get Configuration
# =============================================================================

@router.get(
    "/config",
    summary="Get System Configuration",
    description="Retrieve the current system configuration",
)
async def get_config():
    """
    Get the current system configuration.

    Returns:
        Current configuration settings.
    """
    data = await _proxy_request("GET", "/api/v1/config")
    return _wrap_response(data)


# =============================================================================
# Update Configuration
# =============================================================================

@router.patch(
    "/config",
    summary="Update System Configuration",
    description="Update system configuration settings",
)
async def update_config(request: UpdateConfigRequest):
    """
    Update system configuration.

    Args:
        request: Configuration settings to update.

    Returns:
        Updated configuration.
    """
    data = await _proxy_request(
        "PATCH",
        "/api/v1/config",
        json=request.model_dump(),
    )
    return _wrap_response(data)
