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
Threat Intelligence API endpoints.

Proxies requests to the threat_intel_aggregator backend service
for IOC queries and batch lookups.
"""

import os
from datetime import datetime
from typing import Any, Dict, List
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request
from loguru import logger
from pydantic import BaseModel

router = APIRouter()

THREAT_INTEL_URL = os.getenv(
    "THREAT_INTEL_URL",
    "http://threat-intel-aggregator:8000",
)


# =============================================================================
# Request / Response Models
# =============================================================================


class BatchIOCRequest(BaseModel):
    """Request body for batch IOC queries."""

    iocs: List[Dict[str, str]]
    """List of IOC dicts, each with 'type' and 'value' keys."""


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
# Query Single IOC
# =============================================================================


@router.get(
    "/threat-intel/{ioc_type}/{ioc_value}",
    summary="Query Single IOC",
    description="Query threat intelligence for a single Indicator of Compromise",
)
async def query_ioc(ioc_type: str, ioc_value: str):
    """
    Query threat intelligence for a single IOC.

    Args:
        ioc_type: Type of IOC (ip, domain, hash, url).
        ioc_value: The IOC value to look up.

    Returns:
        Threat intelligence results for the IOC.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{THREAT_INTEL_URL}/api/v1/threat-intel/{ioc_type}/{ioc_value}",
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Threat intel service returned error",
            extra={
                "ioc_type": ioc_type,
                "ioc_value": ioc_value,
                "status_code": exc.response.status_code,
            },
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(
            f"Failed to reach threat intel service: {exc}",
            extra={"ioc_type": ioc_type, "ioc_value": ioc_value},
        )
        raise HTTPException(
            status_code=502,
            detail="Threat intelligence service unavailable",
        )

    return _wrap_response(data)


# =============================================================================
# Batch IOC Query
# =============================================================================


@router.post(
    "/threat-intel/batch",
    summary="Batch IOC Query",
    description="Query threat intelligence for multiple IOCs in a single request",
)
async def batch_query_iocs(request: BatchIOCRequest):
    """
    Query threat intelligence for a batch of IOCs.

    Args:
        request: List of IOCs to query.

    Returns:
        Aggregated threat intelligence results.
    """
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{THREAT_INTEL_URL}/api/v1/threat-intel/batch",
                json={"iocs": request.iocs},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Threat intel batch query returned error",
            extra={"status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach threat intel service: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Threat intelligence service unavailable",
        )

    return _wrap_response(data)
