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
Authentication and authorization utilities for the web dashboard.

This module provides secure password handling, JWT token management,
and user authentication logic.
"""

import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from bcrypt import hashpw, gensalt, checkpw
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.models import User
from shared.utils import get_logger

logger = get_logger(__name__)

# JWT Configuration
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = 60


def validate_jwt_config() -> None:
    """Validate that JWT configuration is present."""
    if not JWT_SECRET_KEY:
        raise ValueError(
            "JWT_SECRET_KEY environment variable must be set. "
            "Generate a secure key with: python -c 'import secrets; print(secrets.token_urlsafe(32))'"
        )


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: Plain text password

    Returns:
        Hashed password as a string
    """
    salt = gensalt()
    hashed = hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash.

    Args:
        plain_password: Plain text password to verify
        hashed_password: Hashed password to compare against

    Returns:
        True if password matches, False otherwise
    """
    return checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.

    Args:
        data: Data to encode in the token (typically user_id, username, role)
        expires_delta: Optional custom expiration time

    Returns:
        Encoded JWT token as a string
    """
    validate_jwt_config()

    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow()
    })

    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode and validate a JWT access token.

    Args:
        token: JWT token to decode

    Returns:
        Decoded token payload if valid, None otherwise
    """
    validate_jwt_config()

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as e:
        logger.warning(f"Failed to decode JWT token: {e}")
        return None


async def get_user_by_username(session: AsyncSession, username: str) -> Optional[User]:
    """
    Retrieve a user by username.

    Args:
        session: Database session
        username: Username to look up

    Returns:
        User object if found, None otherwise
    """
    query = select(User).where(User.username == username, User.is_active == True)
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: str) -> Optional[User]:
    """
    Retrieve a user by ID.

    Args:
        session: Database session
        user_id: User ID to look up

    Returns:
        User object if found, None otherwise
    """
    query = select(User).where(User.id == user_id, User.is_active == True)
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def authenticate_user(
    session: AsyncSession,
    username: str,
    password: str
) -> Optional[User]:
    """
    Authenticate a user with username and password.

    Args:
        session: Database session
        username: Username
        password: Plain text password

    Returns:
        User object if authentication successful, None otherwise
    """
    user = await get_user_by_username(session, username)

    if not user:
        logger.warning(f"Authentication failed: User '{username}' not found")
        return None

    if not verify_password(password, user.password_hash):
        logger.warning(f"Authentication failed: Invalid password for user '{username}'")
        return None

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    await session.commit()

    logger.info(f"User '{username}' authenticated successfully")
    return user


def user_to_dict(user: User) -> Dict[str, Any]:
    """
    Convert a User object to a dictionary for API responses.

    Args:
        user: User object

    Returns:
        Dictionary representation of the user
    """
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "department": user.department,
        "last_login": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "permissions": get_permissions_for_role(user.role)
    }


def get_permissions_for_role(role: str) -> list[str]:
    """
    Get permissions for a given role.

    Args:
        role: User role (admin, operator, analyst, viewer)

    Returns:
        List of permission strings
    """
    role_permissions = {
        "admin": [
            "alerts.create",
            "alerts.update",
            "alerts.delete",
            "alerts.assign",
            "workflows.execute",
            "workflows.manage",
            "config.update",
            "users.manage",
            "reports.create",
            "reports.delete",
        ],
        "operator": [
            "alerts.create",
            "alerts.update",
            "alerts.assign",
            "workflows.execute",
            "reports.create",
        ],
        "analyst": [
            "alerts.create",
            "alerts.update",
            "alerts.view",
            "workflows.view",
            "reports.view",
        ],
        "viewer": [
            "alerts.view",
            "workflows.view",
            "reports.view",
        ],
    }

    return role_permissions.get(role, [])
