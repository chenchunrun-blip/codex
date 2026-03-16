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
User Management API endpoints.

Proxies requests to the user_management backend service for
user CRUD operations.
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel

router = APIRouter()

USER_MANAGEMENT_URL = os.getenv(
    "USER_MANAGEMENT_URL",
    "http://user-management:8000",
)


# =============================================================================
# Request / Response Helpers
# =============================================================================

class CreateUserRequest(BaseModel):
    """Request body for creating a user."""

    username: str
    email: str
    full_name: Optional[str] = None
    role: Optional[str] = "analyst"
    team: Optional[str] = None


class UpdateUserRequest(BaseModel):
    """Request body for updating a user."""

    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    team: Optional[str] = None
    is_active: Optional[bool] = None


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
    Forward a request to the user management service.

    Args:
        method: HTTP method.
        path: URL path to append to the base URL.
        json: JSON body for POST/PATCH requests.
        params: Query parameters.
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
                f"{USER_MANAGEMENT_URL}{path}",
                json=json,
                params=params,
            )
            resp.raise_for_status()
            # DELETE may return 204 with no body
            if resp.status_code == 204:
                return None
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "User management service returned error",
            extra={"path": path, "status_code": exc.response.status_code},
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        )
    except httpx.RequestError as exc:
        logger.error(f"Failed to reach user management service: {exc}")
        raise HTTPException(
            status_code=502,
            detail="User management service unavailable",
        )


# =============================================================================
# Create User
# =============================================================================

@router.post(
    "/users",
    status_code=201,
    summary="Create User",
    description="Create a new user account",
)
async def create_user(request: CreateUserRequest):
    """
    Create a new user.

    Args:
        request: User creation details.

    Returns:
        Created user information.
    """
    data = await _proxy_request(
        "POST",
        "/api/v1/users",
        json=request.model_dump(),
    )
    return _wrap_response(data)


# =============================================================================
# List Users
# =============================================================================

@router.get(
    "/users",
    summary="List Users",
    description="Retrieve a paginated list of users",
)
async def list_users(
    role: Optional[str] = Query(None, description="Filter by role"),
    team: Optional[str] = Query(None, description="Filter by team"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
):
    """
    List users with optional filtering and pagination.

    Args:
        role: Optional role filter.
        team: Optional team filter.
        is_active: Optional active-status filter.
        skip: Pagination offset.
        limit: Maximum number of results.

    Returns:
        Paginated list of users.
    """
    params: Dict[str, Any] = {"skip": skip, "limit": limit}
    if role:
        params["role"] = role
    if team:
        params["team"] = team
    if is_active is not None:
        params["is_active"] = is_active

    data = await _proxy_request(
        "GET",
        "/api/v1/users",
        params=params,
    )
    return _wrap_response(data)


# =============================================================================
# Get User Details
# =============================================================================

@router.get(
    "/users/{user_id}",
    summary="Get User Details",
    description="Retrieve detailed information about a specific user",
)
async def get_user(user_id: str):
    """
    Get user details by ID.

    Args:
        user_id: The user identifier.

    Returns:
        User details.
    """
    data = await _proxy_request(
        "GET",
        f"/api/v1/users/{user_id}",
    )
    return _wrap_response(data)


# =============================================================================
# Update User
# =============================================================================

@router.patch(
    "/users/{user_id}",
    summary="Update User",
    description="Update an existing user's information",
)
async def update_user(user_id: str, request: UpdateUserRequest):
    """
    Update user information.

    Args:
        user_id: The user identifier.
        request: Fields to update.

    Returns:
        Updated user information.
    """
    # Only send non-None fields
    update_data = {k: v for k, v in request.model_dump().items() if v is not None}
    data = await _proxy_request(
        "PATCH",
        f"/api/v1/users/{user_id}",
        json=update_data,
    )
    return _wrap_response(data)


# =============================================================================
# Delete User
# =============================================================================

@router.delete(
    "/users/{user_id}",
    summary="Delete User",
    description="Delete a user account",
)
async def delete_user(user_id: str):
    """
    Delete a user.

    Args:
        user_id: The user identifier.

    Returns:
        Confirmation of deletion.
    """
    data = await _proxy_request(
        "DELETE",
        f"/api/v1/users/{user_id}",
    )
    return _wrap_response(data or {"deleted": True, "user_id": user_id})
