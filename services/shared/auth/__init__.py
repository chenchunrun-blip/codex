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
Shared authentication and authorization layer.

Provides JWT token management and RBAC permissions.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import jwt
from shared.errors.exceptions import AuthenticationError, AuthorizationError
from shared.utils.logger import get_logger

logger = get_logger(__name__)

# JWT Configuration
SECRET_KEY = "your-secret-key-change-in-production"  # From environment
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 7


class Permission(str):
    """Permission strings."""

    # Alert permissions
    ALERT_READ = "alerts:read"
    ALERT_WRITE = "alerts:write"
    ALERT_DELETE = "alerts:delete"

    # Threat Intel permissions
    THREAT_INTEL_READ = "threat_intel:read"
    THREAT_INTEL_WRITE = "threat_intel:write"

    # User permissions
    USER_READ = "users:read"
    USER_WRITE = "users:write"
    USER_DELETE = "users:delete"

    # Admin permissions
    ADMIN = "admin:all"


class Role(str):
    """User roles."""

    ADMIN = "admin"
    ANALYST = "analyst"
    VIEWER = "viewer"


# Role to permissions mapping
ROLE_PERMISSIONS: Dict[Role, List[str]] = {
    Role.ADMIN: [Permission.ADMIN],
    Role.ANALYST: [
        Permission.ALERT_READ,
        Permission.ALERT_WRITE,
        Permission.THREAT_INTEL_READ,
        Permission.USER_READ,
    ],
    Role.VIEWER: [
        Permission.ALERT_READ,
        Permission.THREAT_INTEL_READ,
    ],
}


def create_access_token(
    user_id: str,
    permissions: List[str],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Create JWT access token.

    Args:
        user_id: User identifier
        permissions: List of permissions
        expires_delta: Custom expiration (optional)

    Returns:
        JWT token string
    """
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": user_id,
        "type": "access",
        "permissions": permissions,
        "exp": expire,
        "iat": datetime.utcnow(),
    }

    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    logger.debug(f"Created access token for user {user_id}")
    return token


def create_refresh_token(user_id: str) -> str:
    """
    Create JWT refresh token.

    Args:
        user_id: User identifier

    Returns:
        JWT refresh token
    """
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": expire,
        "iat": datetime.utcnow(),
    }

    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    logger.debug(f"Created refresh token for user {user_id}")
    return token


def verify_token(token: str) -> Dict[str, Any]:
    """
    Verify JWT token.

    Args:
        token: JWT token string

    Returns:
        Token payload

    Raises:
        AuthenticationError: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired")
    except jwt.InvalidTokenError as e:
        raise AuthenticationError(f"Invalid token: {str(e)}")


def get_user_permissions(role: Role) -> List[str]:
    """
    Get permissions for a role.

    Args:
        role: User role

    Returns:
        List of permissions
    """
    return ROLE_PERMISSIONS.get(role, [])


def check_permission(required_permission: str, user_permissions: List[str]) -> bool:
    """
    Check if user has required permission.

    Args:
        required_permission: Required permission
        user_permissions: User's permissions

    Returns:
        True if has permission, False otherwise
    """
    # Admin has all permissions
    if Permission.ADMIN in user_permissions:
        return True

    return required_permission in user_permissions


def require_permission(required_permission: str):
    """
    Decorator to check permission.

    Args:
        required_permission: Required permission string

    Returns:
        Decorator function

    Example:
        @require_permission(Permission.ALERT_WRITE)
        async def update_alert():
            ...
    """

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
