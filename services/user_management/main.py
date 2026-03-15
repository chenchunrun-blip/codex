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

"""User Management Service - User CRUD, roles, permissions, and authentication."""

import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from shared.auth import (
    AuditAction,
    AuthConfig,
    Permission,
    ROLE_PERMISSIONS,
    UserRole,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_permissions,
    hash_password,
    log_audit_event,
    verify_password,
)
from shared.auth import User as AuthUser
from shared.database import DatabaseManager, get_database_manager
from shared.database.models import AuditLog
from shared.database.repositories.user_repository import UserRepository
from shared.utils import Config, get_logger

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class UserCreateRequest(BaseModel):
    """Request to create a new user."""

    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=255)
    role: str = Field(default="viewer")
    phone: Optional[str] = Field(None, max_length=20)
    department: Optional[str] = Field(None, max_length=100)


class UserUpdateRequest(BaseModel):
    """Request to update user fields."""

    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, max_length=255)
    role: Optional[str] = None
    phone: Optional[str] = Field(None, max_length=20)
    department: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None


class PasswordChangeRequest(BaseModel):
    """Request to change password."""

    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


class RoleChangeRequest(BaseModel):
    """Request to change user role."""

    role: str


class LoginRequest(BaseModel):
    """Login request."""

    username_or_email: str
    password: str


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _user_to_dict(user) -> Dict[str, Any]:
    """Convert ORM User to response dict."""
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "permissions": [p.value for p in get_user_permissions(UserRole(user.role))]
        if user.role in [r.value for r in UserRole]
        else [],
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "phone": user.phone,
        "department": user.department,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


def _orm_user_to_auth_user(user) -> AuthUser:
    """Convert ORM User to auth User for token generation."""
    try:
        role = UserRole(user.role)
    except ValueError:
        role = UserRole.VIEWER
    return AuthUser(
        id=str(user.id),
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        role=role,
        permissions=get_user_permissions(role),
        is_active=user.is_active,
        created_at=user.created_at or datetime.utcnow(),
        updated_at=user.updated_at or datetime.utcnow(),
        last_login=user.last_login_at,
    )


async def get_current_user_from_token(request: Request) -> Optional[AuthUser]:
    """Extract current user from Authorization header. Returns None if no token."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    payload = decode_token(token)
    if not payload:
        return None
    return AuthUser(
        id=payload.sub,
        email=payload.email,
        username=payload.email.split("@")[0],
        role=payload.role,
        permissions={p for p in Permission if p.value in payload.permissions},
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


def require_auth(request: Request) -> AuthUser:
    """Require authentication - raise 401 if not authenticated."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = auth_header[7:]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return AuthUser(
        id=payload.sub,
        email=payload.email,
        username=payload.email.split("@")[0],
        role=payload.role,
        permissions={p for p in Permission if p.value in payload.permissions},
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


def require_admin(request: Request) -> AuthUser:
    """Require admin role."""
    user = require_auth(request)
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_user_management_permission(request: Request) -> AuthUser:
    """Require system:users permission."""
    user = require_auth(request)
    if Permission.SYSTEM_USERS not in user.permissions and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="User management permission required")
    return user


# ---------------------------------------------------------------------------
# Audit logging helper
# ---------------------------------------------------------------------------


async def audit_log(
    event_type: str,
    action: str,
    target_type: str = "user",
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
                event_category="user_management",
                action=action,
                actor_id=actor_id,
                actor_type="user",
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
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager

    logger.info("Starting User Management service...")

    db_manager = get_database_manager()
    await db_manager.initialize()

    # Ensure initial admin user exists
    try:
        async with db_manager.get_session() as session:
            repo = UserRepository(session)
            admin = await repo.get_by_username("admin")
            if not admin:
                import os

                admin_password = os.getenv("INITIAL_ADMIN_PASSWORD", "Admin123!")
                await repo.create_user(
                    username="admin",
                    email="admin@security-triage.local",
                    password_hash=hash_password(admin_password),
                    role="admin",
                    full_name="Security Administrator",
                )
                await session.commit()
                logger.info("Initial admin user created")
    except Exception as e:
        logger.warning(f"Could not create initial admin: {e}")

    logger.info("User Management service started successfully")
    yield

    await db_manager.close()
    logger.info("User Management service stopped")


app = FastAPI(
    title="User Management Service",
    description="User CRUD, roles, permissions, and authentication",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Authentication Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/auth/login", response_model=Dict[str, Any])
async def login(body: LoginRequest):
    """Authenticate user and return JWT tokens."""
    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_username_or_email(body.username_or_email)

        if not user or not verify_password(body.password, user.password_hash):
            await audit_log(
                event_type="auth.login_failed",
                action="login",
                details={"username_or_email": body.username_or_email},
                status="failure",
                error_message="Invalid credentials",
            )
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account is deactivated")

        # Update last login
        await repo.update_last_login(str(user.id))
        await session.commit()

    auth_user = _orm_user_to_auth_user(user)
    access_token = create_access_token(auth_user)
    refresh_token = create_refresh_token(auth_user)

    await audit_log(
        event_type="auth.login",
        action="login",
        target_id=str(user.id),
        actor_id=str(user.id),
        details={"username": user.username},
    )

    return {
        "success": True,
        "data": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": AuthConfig.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "user": _user_to_dict(user),
        },
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.post("/api/v1/auth/refresh", response_model=Dict[str, Any])
async def refresh_token(refresh_token_str: str):
    """Refresh access token."""
    payload = decode_token(refresh_token_str)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_id(payload.sub)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")

    auth_user = _orm_user_to_auth_user(user)
    new_access_token = create_access_token(auth_user)

    return {
        "success": True,
        "data": {
            "access_token": new_access_token,
            "token_type": "bearer",
            "expires_in": AuthConfig.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        },
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.get("/api/v1/auth/me", response_model=Dict[str, Any])
async def get_current_user_info(request: Request):
    """Get current authenticated user info."""
    current_user = require_auth(request)

    if not db_manager:
        return {
            "success": True,
            "data": {
                "id": current_user.id,
                "username": current_user.username,
                "email": current_user.email,
                "role": current_user.role.value,
                "permissions": [p.value for p in current_user.permissions],
            },
            "meta": {"timestamp": datetime.utcnow().isoformat()},
        }

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_id(current_user.id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

    return {
        "success": True,
        "data": _user_to_dict(user),
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


# ---------------------------------------------------------------------------
# User CRUD Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/users", response_model=Dict[str, Any])
async def create_user(body: UserCreateRequest, request: Request):
    """Create a new user (admin only)."""
    current_user = require_user_management_permission(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    # Validate role
    valid_roles = [r.value for r in UserRole]
    if body.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}. Valid: {valid_roles}")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)

        # Check duplicates
        if await repo.get_by_username(body.username):
            raise HTTPException(status_code=409, detail=f"Username already exists: {body.username}")
        if await repo.get_by_email(body.email):
            raise HTTPException(status_code=409, detail=f"Email already exists: {body.email}")

        user = await repo.create_user(
            username=body.username,
            email=body.email,
            password_hash=hash_password(body.password),
            role=body.role,
            full_name=body.full_name,
            phone=body.phone,
            department=body.department,
        )
        await session.commit()

        user_data = _user_to_dict(user)

    await audit_log(
        event_type="user.created",
        action="create",
        target_id=user_data["id"],
        actor_id=current_user.id,
        details={"username": body.username, "role": body.role},
    )

    return {
        "success": True,
        "data": user_data,
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.get("/api/v1/users", response_model=Dict[str, Any])
async def list_users(
    request: Request,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    department: Optional[str] = None,
    search: Optional[str] = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
):
    """List users with filters and pagination."""
    require_user_management_permission(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        users, total = await repo.list_users(
            role=role,
            is_active=is_active,
            department=department,
            search=search,
            offset=offset,
            limit=limit,
        )

    return {
        "success": True,
        "data": {
            "users": [_user_to_dict(u) for u in users],
            "total": total,
            "offset": offset,
            "limit": limit,
        },
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.get("/api/v1/users/{user_id}", response_model=Dict[str, Any])
async def get_user(user_id: str, request: Request):
    """Get a specific user."""
    require_user_management_permission(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")

    return {
        "success": True,
        "data": _user_to_dict(user),
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.put("/api/v1/users/{user_id}", response_model=Dict[str, Any])
async def update_user(user_id: str, body: UserUpdateRequest, request: Request):
    """Update user fields."""
    current_user = require_user_management_permission(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    # Validate role if provided
    if body.role:
        valid_roles = [r.value for r in UserRole]
        if body.role not in valid_roles:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")

        old_values = {"role": user.role, "is_active": user.is_active, "email": user.email}

        updates = body.model_dump(exclude_none=True)
        if updates:
            await repo.update_user(user_id, **updates)
            await session.commit()
            # Re-fetch
            user = await repo.get_by_id(user_id)

    new_values = body.model_dump(exclude_none=True)
    await audit_log(
        event_type="user.updated",
        action="update",
        target_id=user_id,
        actor_id=current_user.id,
        details={"old_values": old_values, "new_values": new_values},
    )

    return {
        "success": True,
        "data": _user_to_dict(user),
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.delete("/api/v1/users/{user_id}", response_model=Dict[str, Any])
async def delete_user(user_id: str, request: Request):
    """Delete a user (admin only)."""
    current_user = require_admin(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    # Prevent self-deletion
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        deleted = await repo.delete_user(user_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        await session.commit()

    await audit_log(
        event_type="user.deleted",
        action="delete",
        target_id=user_id,
        actor_id=current_user.id,
    )

    return {
        "success": True,
        "message": f"User {user_id} deleted",
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


# ---------------------------------------------------------------------------
# Role & Permission Endpoints
# ---------------------------------------------------------------------------


@app.put("/api/v1/users/{user_id}/role", response_model=Dict[str, Any])
async def change_user_role(user_id: str, body: RoleChangeRequest, request: Request):
    """Change user's role (admin only)."""
    current_user = require_admin(request)

    valid_roles = [r.value for r in UserRole]
    if body.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}. Valid: {valid_roles}")

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")

        old_role = user.role
        await repo.change_role(user_id, body.role)
        await session.commit()
        user = await repo.get_by_id(user_id)

    await audit_log(
        event_type="user.role_changed",
        action="role_change",
        target_id=user_id,
        actor_id=current_user.id,
        details={"old_role": old_role, "new_role": body.role},
    )

    return {
        "success": True,
        "data": _user_to_dict(user),
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.post("/api/v1/users/{user_id}/deactivate", response_model=Dict[str, Any])
async def deactivate_user(user_id: str, request: Request):
    """Deactivate a user account."""
    current_user = require_user_management_permission(request)

    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.deactivate_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        await session.commit()

    await audit_log(
        event_type="user.deactivated",
        action="deactivate",
        target_id=user_id,
        actor_id=current_user.id,
    )

    return {
        "success": True,
        "data": _user_to_dict(user),
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.post("/api/v1/users/{user_id}/activate", response_model=Dict[str, Any])
async def activate_user(user_id: str, request: Request):
    """Reactivate a user account."""
    current_user = require_user_management_permission(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.activate_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        await session.commit()

    await audit_log(
        event_type="user.activated",
        action="activate",
        target_id=user_id,
        actor_id=current_user.id,
    )

    return {
        "success": True,
        "data": _user_to_dict(user),
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.put("/api/v1/users/me/password", response_model=Dict[str, Any])
async def change_own_password(body: PasswordChangeRequest, request: Request):
    """Change own password (requires current password)."""
    current_user = require_auth(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        user = await repo.get_by_id(current_user.id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if not verify_password(body.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        await repo.change_password(current_user.id, hash_password(body.new_password))
        await session.commit()

    await audit_log(
        event_type="user.password_changed",
        action="password_change",
        target_id=current_user.id,
        actor_id=current_user.id,
    )

    return {
        "success": True,
        "message": "Password changed successfully",
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.put("/api/v1/users/{user_id}/password", response_model=Dict[str, Any])
async def admin_reset_password(user_id: str, new_password: str, request: Request):
    """Admin reset user password (no current password required)."""
    current_user = require_admin(request)

    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        success = await repo.change_password(user_id, hash_password(new_password))
        if not success:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        await session.commit()

    await audit_log(
        event_type="user.password_reset",
        action="password_reset",
        target_id=user_id,
        actor_id=current_user.id,
    )

    return {
        "success": True,
        "message": f"Password reset for user {user_id}",
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


# ---------------------------------------------------------------------------
# Roles & Permissions Info
# ---------------------------------------------------------------------------


@app.get("/api/v1/roles", response_model=Dict[str, Any])
async def list_roles():
    """List all available roles and their permissions."""
    roles_data = {}
    for role in UserRole:
        perms = ROLE_PERMISSIONS.get(role, set())
        roles_data[role.value] = {
            "name": role.value,
            "permissions": sorted([p.value for p in perms]),
            "permission_count": len(perms),
        }

    return {
        "success": True,
        "data": {"roles": roles_data, "total": len(roles_data)},
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.get("/api/v1/permissions", response_model=Dict[str, Any])
async def list_permissions():
    """List all available permissions."""
    permissions = {}
    for perm in Permission:
        category, action = perm.value.split(":")
        if category not in permissions:
            permissions[category] = []
        permissions[category].append({"value": perm.value, "action": action})

    return {
        "success": True,
        "data": {"permissions": permissions, "total": len(Permission)},
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


@app.get("/api/v1/users/stats", response_model=Dict[str, Any])
async def get_user_stats(request: Request):
    """Get user statistics (admin/user manager)."""
    require_user_management_permission(request)

    if not db_manager:
        raise HTTPException(status_code=503, detail="Database not available")

    async with db_manager.get_session() as session:
        repo = UserRepository(session)
        role_counts = await repo.count_by_role()
        _, total = await repo.list_users(limit=0)
        _, active = await repo.list_users(is_active=True, limit=0)

    return {
        "success": True,
        "data": {
            "total_users": total,
            "active_users": active,
            "inactive_users": total - active,
            "by_role": role_counts,
        },
        "meta": {"timestamp": datetime.utcnow().isoformat()},
    }


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "user-management",
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
