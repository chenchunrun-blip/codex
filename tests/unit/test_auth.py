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
Unit tests for authentication and authorization.

Tests JWT token creation/validation, password hashing, and role permissions.
"""

import os
from datetime import timedelta
from unittest.mock import patch

import pytest

# Set JWT_SECRET_KEY before importing auth module
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

from shared.auth import AuthConfig


class TestAuthConfig:
    """Tests for AuthConfig."""

    def test_default_algorithm(self):
        assert AuthConfig.ALGORITHM == "HS256"

    def test_default_token_expiry(self):
        assert AuthConfig.ACCESS_TOKEN_EXPIRE_MINUTES > 0

    def test_secret_key_exists(self):
        assert AuthConfig.SECRET_KEY is not None


class TestWebDashboardAuth:
    """Tests for web dashboard auth utilities."""

    def test_hash_password(self):
        """Test password hashing produces different hash each time."""
        from services.web_dashboard.auth import hash_password

        h1 = hash_password("test_password")
        h2 = hash_password("test_password")
        assert h1 != h2  # Different salts
        assert h1.startswith("$2")  # bcrypt prefix

    def test_verify_password_correct(self):
        """Test verifying correct password."""
        from services.web_dashboard.auth import hash_password, verify_password

        hashed = hash_password("my_password")
        assert verify_password("my_password", hashed) is True

    def test_verify_password_incorrect(self):
        """Test verifying incorrect password."""
        from services.web_dashboard.auth import hash_password, verify_password

        hashed = hash_password("my_password")
        assert verify_password("wrong_password", hashed) is False

    def test_create_access_token(self):
        """Test JWT token creation."""
        from services.web_dashboard.auth import create_access_token, decode_access_token

        token = create_access_token({"sub": "user-123", "username": "testuser"})
        assert isinstance(token, str)
        assert len(token) > 0

    def test_decode_valid_token(self):
        """Test decoding a valid JWT token."""
        from services.web_dashboard.auth import create_access_token, decode_access_token

        data = {"sub": "user-123", "username": "testuser", "role": "admin"}
        token = create_access_token(data)
        decoded = decode_access_token(token)
        assert decoded is not None
        assert decoded["sub"] == "user-123"
        assert decoded["username"] == "testuser"
        assert decoded["role"] == "admin"

    def test_decode_expired_token(self):
        """Test that expired tokens are rejected."""
        from services.web_dashboard.auth import create_access_token, decode_access_token

        token = create_access_token(
            {"sub": "user-123"},
            expires_delta=timedelta(seconds=-1),
        )
        decoded = decode_access_token(token)
        assert decoded is None

    def test_decode_invalid_token(self):
        """Test that invalid tokens return None."""
        from services.web_dashboard.auth import decode_access_token

        decoded = decode_access_token("invalid.token.here")
        assert decoded is None

    def test_permissions_for_admin(self):
        """Test admin role has all permissions."""
        from services.web_dashboard.auth import get_permissions_for_role

        perms = get_permissions_for_role("admin")
        assert "alerts.create" in perms
        assert "users.manage" in perms
        assert "config.update" in perms

    def test_permissions_for_analyst(self):
        """Test analyst role has limited permissions."""
        from services.web_dashboard.auth import get_permissions_for_role

        perms = get_permissions_for_role("analyst")
        assert "alerts.view" in perms
        assert "users.manage" not in perms

    def test_permissions_for_viewer(self):
        """Test viewer role is read-only."""
        from services.web_dashboard.auth import get_permissions_for_role

        perms = get_permissions_for_role("viewer")
        assert "alerts.view" in perms
        assert "alerts.create" not in perms
        assert "alerts.update" not in perms

    def test_permissions_for_unknown_role(self):
        """Test unknown role returns empty permissions."""
        from services.web_dashboard.auth import get_permissions_for_role

        perms = get_permissions_for_role("nonexistent")
        assert perms == []
