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
Authentication and Authorization Module.

Provides JWT-based authentication and RBAC authorization for the system.
Supports both the legacy simple API and the full RBAC system.
"""

import datetime
import os
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field
from shared.errors.exceptions import AuthenticationError, AuthorizationError
from shared.utils.logger import get_logger

logger = get_logger(__name__)


# =============================================================================
# Configuration
# =============================================================================


class AuthConfig:
    """Authentication configuration."""

    SECRET_KEY = os.getenv(
        "JWT_SECRET_KEY", os.getenv("ENCRYPTION_KEY", "dev-secret-key-change-me")
    )
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

    # Password hashing
    bcrypt_rounds = int(os.getenv("BCRYPT_ROUNDS", "12"))


# Legacy config aliases (backward compatibility)
SECRET_KEY = AuthConfig.SECRET_KEY
ALGORITHM = AuthConfig.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = AuthConfig.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = AuthConfig.REFRESH_TOKEN_EXPIRE_DAYS


# =============================================================================
# RBAC Models
# =============================================================================


class UserRole(str, Enum):
    """User roles with hierarchical permissions."""

    ADMIN = "admin"
    SECURITY_ANALYST = "security_analyst"
    OPERATOR = "operator"
    VIEWER = "viewer"
    AUDITOR = "auditor"


class Permission(str, Enum):
    """Fine-grained permissions."""

    # Alert permissions
    ALERT_VIEW = "alert:view"
    ALERT_CREATE = "alert:create"
    ALERT_UPDATE = "alert:update"
    ALERT_DELETE = "alert:delete"
    ALERT_ASSIGN = "alert:assign"
    ALERT_CLOSE = "alert:close"

    # Triage permissions
    TRIAGE_VIEW = "triage:view"
    TRIAGE_EXECUTE = "triage:execute"
    TRIAGE_OVERRIDE = "triage:override"

    # Automation permissions
    AUTOMATION_VIEW = "automation:view"
    AUTOMATION_EXECUTE = "automation:execute"
    AUTOMATION_APPROVE = "automation:approve"

    # System permissions
    SYSTEM_CONFIG = "system:config"
    SYSTEM_USERS = "system:users"
    SYSTEM_MONITORING = "system:monitoring"
    SYSTEM_AUDIT = "system:audit"

    # Threat Intel permissions
    THREAT_INTEL_VIEW = "threat_intel:view"
    THREAT_INTEL_QUERY = "threat_intel:query"


# Role-Permission mapping
ROLE_PERMISSIONS: Dict[UserRole, Set[Permission]] = {
    UserRole.ADMIN: {perm for perm in Permission},  # All permissions
    UserRole.SECURITY_ANALYST: {
        Permission.ALERT_VIEW,
        Permission.ALERT_UPDATE,
        Permission.ALERT_ASSIGN,
        Permission.ALERT_CLOSE,
        Permission.TRIAGE_VIEW,
        Permission.TRIAGE_EXECUTE,
        Permission.AUTOMATION_VIEW,
        Permission.THREAT_INTEL_VIEW,
        Permission.THREAT_INTEL_QUERY,
    },
    UserRole.OPERATOR: {
        Permission.ALERT_VIEW,
        Permission.ALERT_CREATE,
        Permission.ALERT_UPDATE,
        Permission.AUTOMATION_VIEW,
        Permission.AUTOMATION_EXECUTE,
        Permission.THREAT_INTEL_VIEW,
        Permission.SYSTEM_MONITORING,
    },
    UserRole.VIEWER: {
        Permission.ALERT_VIEW,
        Permission.TRIAGE_VIEW,
        Permission.AUTOMATION_VIEW,
        Permission.THREAT_INTEL_VIEW,
    },
    UserRole.AUDITOR: {
        Permission.ALERT_VIEW,
        Permission.TRIAGE_VIEW,
        Permission.AUTOMATION_VIEW,
        Permission.SYSTEM_AUDIT,
    },
}


# Legacy aliases
class Role(str):
    """Legacy user roles (use UserRole enum instead)."""

    ADMIN = "admin"
    ANALYST = "security_analyst"
    VIEWER = "viewer"


# =============================================================================
# Pydantic Models
# =============================================================================


class TokenPayload(BaseModel):
    """JWT token payload."""

    sub: str = Field(..., description="User ID")
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    permissions: List[str] = Field(default_factory=list)
    exp: Optional[int] = None
    iat: Optional[int] = None
    jti: Optional[str] = None
    type: Optional[str] = None


class User(BaseModel):
    """User model for auth context."""

    id: str
    email: EmailStr
    username: str
    full_name: Optional[str] = None
    role: UserRole
    permissions: Set[Permission]
    is_active: bool = True
    created_at: datetime.datetime
    updated_at: datetime.datetime
    last_login: Optional[datetime.datetime] = None


class UserCreate(BaseModel):
    """User creation request."""

    email: EmailStr
    username: str
    full_name: Optional[str] = None
    password: str
    role: UserRole = UserRole.VIEWER


class UserUpdate(BaseModel):
    """User update request."""

    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class LoginRequest(BaseModel):
    """Login request."""

    username_or_email: str
    password: str


class RefreshTokenRequest(BaseModel):
    """Refresh token request."""

    refresh_token: str


# =============================================================================
# Password Functions
# =============================================================================


def hash_password(password: str) -> str:
    """Hash a password for storage."""
    import bcrypt

    salt = bcrypt.gensalt(rounds=AuthConfig.bcrypt_rounds)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    import bcrypt

    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


# =============================================================================
# JWT Token Functions
# =============================================================================


def create_access_token(user_or_id, permissions=None, expires_delta=None):
    """
    Create JWT access token.

    Supports both:
    - create_access_token(User) - RBAC mode
    - create_access_token(user_id, permissions) - Legacy mode
    """
    now = datetime.datetime.utcnow()

    if isinstance(user_or_id, User):
        user = user_or_id
        expire = now + datetime.timedelta(minutes=AuthConfig.ACCESS_TOKEN_EXPIRE_MINUTES)
        payload = {
            "sub": user.id,
            "email": user.email,
            "role": user.role.value,
            "permissions": [perm.value for perm in user.permissions],
            "exp": int(expire.timestamp()),
            "iat": int(now.timestamp()),
        }
    else:
        # Legacy mode
        if expires_delta:
            expire = now + expires_delta
        else:
            expire = now + datetime.timedelta(minutes=AuthConfig.ACCESS_TOKEN_EXPIRE_MINUTES)
        payload = {
            "sub": user_or_id,
            "type": "access",
            "permissions": permissions or [],
            "exp": expire,
            "iat": now,
        }

    return jwt.encode(payload, AuthConfig.SECRET_KEY, algorithm=AuthConfig.ALGORITHM)


def create_refresh_token(user_or_id):
    """Create JWT refresh token."""
    now = datetime.datetime.utcnow()
    expire = now + datetime.timedelta(days=AuthConfig.REFRESH_TOKEN_EXPIRE_DAYS)

    if isinstance(user_or_id, User):
        payload = {
            "sub": user_or_id.id,
            "exp": int(expire.timestamp()),
            "type": "refresh",
        }
    else:
        payload = {
            "sub": user_or_id,
            "type": "refresh",
            "exp": expire,
            "iat": now,
        }

    return jwt.encode(payload, AuthConfig.SECRET_KEY, algorithm=AuthConfig.ALGORITHM)


def decode_token(token: str) -> Optional[TokenPayload]:
    """Decode and validate JWT token."""
    try:
        payload = jwt.decode(
            token,
            AuthConfig.SECRET_KEY,
            algorithms=[AuthConfig.ALGORITHM],
        )
        return TokenPayload(**payload)
    except JWTError as e:
        logger.warning(f"Invalid token: {e}")
        return None


def verify_token(token: str) -> Dict[str, Any]:
    """Verify JWT token (legacy API, raises on failure)."""
    try:
        payload = jwt.decode(token, AuthConfig.SECRET_KEY, algorithms=[AuthConfig.ALGORITHM])
        return payload
    except JWTError as e:
        if "expired" in str(e).lower():
            raise AuthenticationError("Token has expired")
        raise AuthenticationError(f"Invalid token: {str(e)}")


# =============================================================================
# Authorization Functions
# =============================================================================


def get_user_permissions(user_role) -> Set[Permission]:
    """Get permissions for a user role."""
    if isinstance(user_role, UserRole):
        return ROLE_PERMISSIONS.get(user_role, set())
    # Try to convert string to UserRole
    try:
        return ROLE_PERMISSIONS.get(UserRole(user_role), set())
    except ValueError:
        return set()


def has_permission(user: User, permission: Permission) -> bool:
    """Check if user has a specific permission."""
    if user.role == UserRole.ADMIN:
        return True
    return permission in user.permissions


def has_any_permission(user: User, permissions: List[Permission]) -> bool:
    """Check if user has any of the specified permissions."""
    return any(has_permission(user, perm) for perm in permissions)


def has_all_permissions(user: User, permissions: List[Permission]) -> bool:
    """Check if user has all of the specified permissions."""
    return all(has_permission(user, perm) for perm in permissions)


def check_permission(required_permission: str, user_permissions: List[str]) -> bool:
    """Legacy: Check if user has required permission."""
    if "admin:all" in user_permissions:
        return True
    return required_permission in user_permissions


def require_permission(required_permission: str):
    """Legacy decorator to check permission."""

    def decorator(func):
        async def wrapper(*args, current_user: Dict[str, Any] = None, **kwargs):
            if not current_user:
                raise AuthenticationError("Not authenticated")
            user_permissions = current_user.get("permissions", [])
            if not check_permission(required_permission, user_permissions):
                raise AuthorizationError(
                    message="Permission denied",
                    required_permission=required_permission,
                )
            return await func(*args, current_user=current_user, **kwargs)

        return wrapper

    return decorator


# =============================================================================
# Admin User Creation
# =============================================================================


def create_admin_user() -> User:
    """Create initial admin user for first-time setup."""
    admin_password = os.getenv("INITIAL_ADMIN_PASSWORD", "Admin123!")

    user = User(
        id="admin",
        email="admin@security-triage.local",
        username="admin",
        full_name="Security Administrator",
        role=UserRole.ADMIN,
        permissions=set(Permission),
        is_active=True,
        created_at=datetime.datetime.utcnow(),
        updated_at=datetime.datetime.utcnow(),
    )

    logger.warning("Initial admin user created. Please change the password immediately!")
    return user


# =============================================================================
# Audit Logging
# =============================================================================


class AuditAction(str, Enum):
    """Audit action types."""

    LOGIN = "login"
    LOGOUT = "logout"
    TOKEN_REFRESH = "token_refresh"
    PASSWORD_CHANGE = "password_change"
    USER_CREATE = "user_create"
    USER_UPDATE = "user_update"
    USER_DELETE = "user_delete"
    ROLE_CHANGE = "role_change"
    PERMISSION_GRANTED = "permission_granted"
    PERMISSION_REVOKED = "permission_revoked"
    ALERT_VIEW = "alert_view"
    ALERT_UPDATE = "alert_update"
    ALERT_DELETE = "alert_delete"
    TRIAGE_EXECUTE = "triage_execute"
    AUTOMATION_EXECUTE = "automation_execute"
    CONFIG_CHANGE = "config_change"


def log_audit_event(
    action: AuditAction,
    user_id: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    success: bool = True,
    error_message: Optional[str] = None,
):
    """Log an audit event."""
    logger.info(
        "Audit Event",
        extra={
            "audit": True,
            "action": action.value,
            "user_id": user_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "success": success,
            "error_message": error_message,
            "timestamp": datetime.datetime.utcnow().isoformat(),
        },
    )
