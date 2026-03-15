"""Unit tests for User Management service - CRUD, auth, roles, permissions, audit."""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from fastapi import HTTPException

from shared.auth import (
    Permission,
    ROLE_PERMISSIONS,
    UserRole,
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_permissions,
    has_permission,
    has_any_permission,
    has_all_permissions,
)
from shared.auth import User as AuthUser


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_auth_user(
    user_id: str = "user-123",
    role: UserRole = UserRole.ADMIN,
    email: str = "admin@test.com",
) -> AuthUser:
    return AuthUser(
        id=user_id,
        email=email,
        username=email.split("@")[0],
        role=role,
        permissions=get_user_permissions(role),
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


def _make_mock_request(token: str = None, user: AuthUser = None):
    """Create a mock FastAPI Request with optional auth header."""
    mock = MagicMock()
    if token:
        mock.headers = {"Authorization": f"Bearer {token}"}
    elif user:
        # Generate a real token for the user
        tok = create_access_token(user)
        mock.headers = {"Authorization": f"Bearer {tok}"}
    else:
        mock.headers = {}
    return mock


def _make_mock_orm_user(**overrides):
    """Create a mock ORM user object."""
    defaults = {
        "id": "user-uuid-123",
        "username": "testuser",
        "email": "test@example.com",
        "full_name": "Test User",
        "password_hash": hash_password("TestPass123"),
        "role": "viewer",
        "is_active": True,
        "is_verified": False,
        "phone": None,
        "department": "Security",
        "last_login_at": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "mfa_enabled": False,
        "mfa_secret": None,
    }
    defaults.update(overrides)

    mock_user = MagicMock()
    for key, value in defaults.items():
        setattr(mock_user, key, value)
    return mock_user


# ---------------------------------------------------------------------------
# Auth Module Tests
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    """Test password hashing and verification."""

    def test_hash_password_returns_string(self):
        hashed = hash_password("testpassword")
        assert isinstance(hashed, str)
        assert hashed != "testpassword"

    def test_verify_password_correct(self):
        hashed = hash_password("MyPassword123")
        assert verify_password("MyPassword123", hashed) is True

    def test_verify_password_incorrect(self):
        hashed = hash_password("MyPassword123")
        assert verify_password("WrongPassword", hashed) is False

    def test_different_passwords_different_hashes(self):
        h1 = hash_password("password1")
        h2 = hash_password("password2")
        assert h1 != h2


class TestJWTTokens:
    """Test JWT token creation and validation."""

    def test_create_access_token(self):
        user = _make_auth_user()
        token = create_access_token(user)
        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_refresh_token(self):
        user = _make_auth_user()
        token = create_refresh_token(user)
        assert isinstance(token, str)

    def test_decode_valid_token(self):
        user = _make_auth_user()
        token = create_access_token(user)
        payload = decode_token(token)
        assert payload is not None
        assert payload.sub == "user-123"
        assert payload.role == UserRole.ADMIN

    def test_decode_invalid_token(self):
        payload = decode_token("invalid.token.here")
        assert payload is None

    def test_token_contains_permissions(self):
        user = _make_auth_user(role=UserRole.SECURITY_ANALYST)
        token = create_access_token(user)
        payload = decode_token(token)
        assert "alert:view" in payload.permissions


class TestRBACPermissions:
    """Test RBAC permission system."""

    def test_admin_has_all_permissions(self):
        user = _make_auth_user(role=UserRole.ADMIN)
        for perm in Permission:
            assert has_permission(user, perm) is True

    def test_viewer_limited_permissions(self):
        user = _make_auth_user(role=UserRole.VIEWER)
        assert has_permission(user, Permission.ALERT_VIEW) is True
        assert has_permission(user, Permission.ALERT_DELETE) is False
        assert has_permission(user, Permission.SYSTEM_USERS) is False

    def test_security_analyst_permissions(self):
        user = _make_auth_user(role=UserRole.SECURITY_ANALYST)
        assert has_permission(user, Permission.ALERT_VIEW) is True
        assert has_permission(user, Permission.TRIAGE_EXECUTE) is True
        assert has_permission(user, Permission.SYSTEM_CONFIG) is False

    def test_operator_permissions(self):
        user = _make_auth_user(role=UserRole.OPERATOR)
        assert has_permission(user, Permission.AUTOMATION_EXECUTE) is True
        assert has_permission(user, Permission.TRIAGE_EXECUTE) is False

    def test_auditor_permissions(self):
        user = _make_auth_user(role=UserRole.AUDITOR)
        assert has_permission(user, Permission.SYSTEM_AUDIT) is True
        assert has_permission(user, Permission.ALERT_DELETE) is False

    def test_has_any_permission_true(self):
        user = _make_auth_user(role=UserRole.VIEWER)
        assert has_any_permission(user, [Permission.ALERT_VIEW, Permission.SYSTEM_USERS]) is True

    def test_has_any_permission_false(self):
        user = _make_auth_user(role=UserRole.VIEWER)
        assert has_any_permission(user, [Permission.SYSTEM_CONFIG, Permission.SYSTEM_USERS]) is False

    def test_has_all_permissions_true(self):
        user = _make_auth_user(role=UserRole.ADMIN)
        assert has_all_permissions(user, [Permission.ALERT_VIEW, Permission.SYSTEM_USERS]) is True

    def test_has_all_permissions_false(self):
        user = _make_auth_user(role=UserRole.VIEWER)
        assert has_all_permissions(user, [Permission.ALERT_VIEW, Permission.SYSTEM_USERS]) is False

    def test_role_permissions_mapping_completeness(self):
        for role in UserRole:
            assert role in ROLE_PERMISSIONS

    def test_get_user_permissions(self):
        perms = get_user_permissions(UserRole.ADMIN)
        assert len(perms) == len(Permission)  # Admin has all


# ---------------------------------------------------------------------------
# Auth Helper Tests
# ---------------------------------------------------------------------------


class TestAuthHelpers:
    """Test authentication helper functions in user_management."""

    def test_require_auth_no_header(self):
        from services.user_management.main import require_auth

        request = _make_mock_request()
        with pytest.raises(HTTPException) as exc_info:
            require_auth(request)
        assert exc_info.value.status_code == 401

    def test_require_auth_valid_token(self):
        from services.user_management.main import require_auth

        user = _make_auth_user()
        request = _make_mock_request(user=user)
        result = require_auth(request)
        assert result.id == "user-123"

    def test_require_admin_non_admin(self):
        from services.user_management.main import require_admin

        user = _make_auth_user(role=UserRole.VIEWER)
        request = _make_mock_request(user=user)
        with pytest.raises(HTTPException) as exc_info:
            require_admin(request)
        assert exc_info.value.status_code == 403

    def test_require_admin_is_admin(self):
        from services.user_management.main import require_admin

        user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=user)
        result = require_admin(request)
        assert result.role == UserRole.ADMIN

    def test_require_user_management_permission_viewer(self):
        from services.user_management.main import require_user_management_permission

        user = _make_auth_user(role=UserRole.VIEWER)
        request = _make_mock_request(user=user)
        with pytest.raises(HTTPException) as exc_info:
            require_user_management_permission(request)
        assert exc_info.value.status_code == 403

    def test_require_user_management_permission_admin(self):
        from services.user_management.main import require_user_management_permission

        user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=user)
        result = require_user_management_permission(request)
        assert result.role == UserRole.ADMIN


# ---------------------------------------------------------------------------
# User Conversion Tests
# ---------------------------------------------------------------------------


class TestUserConversion:
    """Test ORM user to dict/auth user conversion."""

    def test_user_to_dict(self):
        from services.user_management.main import _user_to_dict

        orm_user = _make_mock_orm_user(role="admin")
        result = _user_to_dict(orm_user)

        assert result["username"] == "testuser"
        assert result["email"] == "test@example.com"
        assert result["role"] == "admin"
        assert "alert:view" in result["permissions"]
        assert result["is_active"] is True

    def test_user_to_dict_unknown_role(self):
        from services.user_management.main import _user_to_dict

        orm_user = _make_mock_orm_user(role="unknown_role")
        result = _user_to_dict(orm_user)
        assert result["permissions"] == []

    def test_orm_user_to_auth_user(self):
        from services.user_management.main import _orm_user_to_auth_user

        orm_user = _make_mock_orm_user(role="security_analyst")
        auth_user = _orm_user_to_auth_user(orm_user)

        assert auth_user.role == UserRole.SECURITY_ANALYST
        assert Permission.ALERT_VIEW in auth_user.permissions

    def test_orm_user_to_auth_user_unknown_role(self):
        from services.user_management.main import _orm_user_to_auth_user

        orm_user = _make_mock_orm_user(role="nonexistent")
        auth_user = _orm_user_to_auth_user(orm_user)
        assert auth_user.role == UserRole.VIEWER


# ---------------------------------------------------------------------------
# API Endpoint Tests
# ---------------------------------------------------------------------------


class TestHealthCheck:
    """Test health check endpoint."""

    @pytest.mark.asyncio
    async def test_health_check(self):
        from services.user_management.main import health_check

        result = await health_check()
        assert result["status"] == "healthy"
        assert result["service"] == "user-management"


class TestListRoles:
    """Test roles listing."""

    @pytest.mark.asyncio
    async def test_list_roles(self):
        from services.user_management.main import list_roles

        result = await list_roles()
        assert result["success"] is True
        assert "admin" in result["data"]["roles"]
        assert result["data"]["total"] == 5

    @pytest.mark.asyncio
    async def test_admin_has_most_permissions(self):
        from services.user_management.main import list_roles

        result = await list_roles()
        admin_perms = result["data"]["roles"]["admin"]["permission_count"]
        viewer_perms = result["data"]["roles"]["viewer"]["permission_count"]
        assert admin_perms > viewer_perms


class TestListPermissions:
    """Test permissions listing."""

    @pytest.mark.asyncio
    async def test_list_permissions(self):
        from services.user_management.main import list_permissions

        result = await list_permissions()
        assert result["success"] is True
        assert "alert" in result["data"]["permissions"]
        assert "system" in result["data"]["permissions"]
        assert result["data"]["total"] == len(Permission)


class TestLoginEndpoint:
    """Test login endpoint."""

    @pytest.mark.asyncio
    async def test_login_success(self):
        import services.user_management.main as mod

        password = "SecurePass123"
        orm_user = _make_mock_orm_user(
            password_hash=hash_password(password),
            role="admin",
        )

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_username_or_email = AsyncMock(return_value=orm_user)
        mock_repo.update_last_login = AsyncMock()

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    from services.user_management.main import LoginRequest
                    result = await mod.login(LoginRequest(
                        username_or_email="testuser",
                        password=password,
                    ))

            assert result["success"] is True
            assert "access_token" in result["data"]
            assert "refresh_token" in result["data"]
            assert result["data"]["user"]["username"] == "testuser"
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(self):
        import services.user_management.main as mod

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_username_or_email = AsyncMock(return_value=None)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    from services.user_management.main import LoginRequest
                    with pytest.raises(HTTPException) as exc_info:
                        await mod.login(LoginRequest(
                            username_or_email="nobody",
                            password="wrong",
                        ))
                    assert exc_info.value.status_code == 401
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_login_inactive_user(self):
        import services.user_management.main as mod

        password = "SecurePass123"
        orm_user = _make_mock_orm_user(
            password_hash=hash_password(password),
            is_active=False,
        )

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_username_or_email = AsyncMock(return_value=orm_user)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    from services.user_management.main import LoginRequest
                    with pytest.raises(HTTPException) as exc_info:
                        await mod.login(LoginRequest(
                            username_or_email="testuser",
                            password=password,
                        ))
                    assert exc_info.value.status_code == 403
        finally:
            mod.db_manager = old_db


class TestCreateUser:
    """Test create user endpoint."""

    @pytest.mark.asyncio
    async def test_create_user_success(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        new_orm_user = _make_mock_orm_user(role="viewer")

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_username = AsyncMock(return_value=None)
        mock_repo.get_by_email = AsyncMock(return_value=None)
        mock_repo.create_user = AsyncMock(return_value=new_orm_user)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    from services.user_management.main import UserCreateRequest
                    result = await mod.create_user(
                        UserCreateRequest(
                            username="newuser",
                            email="new@test.com",
                            password="SecurePass123",
                            role="viewer",
                        ),
                        request,
                    )

            assert result["success"] is True
            assert result["data"]["username"] == "testuser"
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_create_user_duplicate_username(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_username = AsyncMock(return_value=_make_mock_orm_user())

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                from services.user_management.main import UserCreateRequest
                with pytest.raises(HTTPException) as exc_info:
                    await mod.create_user(
                        UserCreateRequest(
                            username="existing",
                            email="new@test.com",
                            password="SecurePass123",
                        ),
                        request,
                    )
                assert exc_info.value.status_code == 409
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_create_user_invalid_role(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        old_db = mod.db_manager
        mock_db = MagicMock()
        mod.db_manager = mock_db

        try:
            from services.user_management.main import UserCreateRequest
            with pytest.raises(HTTPException) as exc_info:
                await mod.create_user(
                    UserCreateRequest(
                        username="newuser",
                        email="new@test.com",
                        password="SecurePass123",
                        role="superadmin",
                    ),
                    request,
                )
            assert exc_info.value.status_code == 400
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_create_user_non_admin_rejected(self):
        import services.user_management.main as mod

        viewer_user = _make_auth_user(role=UserRole.VIEWER)
        request = _make_mock_request(user=viewer_user)

        from services.user_management.main import UserCreateRequest
        with pytest.raises(HTTPException) as exc_info:
            await mod.create_user(
                UserCreateRequest(
                    username="newuser",
                    email="new@test.com",
                    password="SecurePass123",
                ),
                request,
            )
        assert exc_info.value.status_code == 403


class TestDeleteUser:
    """Test delete user endpoint."""

    @pytest.mark.asyncio
    async def test_delete_user_success(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.delete_user = AsyncMock(return_value=True)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    result = await mod.delete_user("other-user-id", request)
            assert result["success"] is True
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_delete_self_rejected(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(user_id="admin-id", role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        old_db = mod.db_manager
        mod.db_manager = MagicMock()

        try:
            with pytest.raises(HTTPException) as exc_info:
                await mod.delete_user("admin-id", request)
            assert exc_info.value.status_code == 400
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_delete_nonexistent_user(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.delete_user = AsyncMock(return_value=False)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with pytest.raises(HTTPException) as exc_info:
                    await mod.delete_user("nonexistent-id", request)
                assert exc_info.value.status_code == 404
        finally:
            mod.db_manager = old_db


class TestRoleChange:
    """Test role change endpoint."""

    @pytest.mark.asyncio
    async def test_change_role_success(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        orm_user = _make_mock_orm_user(role="viewer")
        updated_user = _make_mock_orm_user(role="security_analyst")

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id = AsyncMock(side_effect=[orm_user, updated_user])
        mock_repo.change_role = AsyncMock()

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    from services.user_management.main import RoleChangeRequest
                    result = await mod.change_user_role(
                        "user-id", RoleChangeRequest(role="security_analyst"), request
                    )
            assert result["success"] is True
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_change_role_invalid(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        old_db = mod.db_manager
        mod.db_manager = MagicMock()

        try:
            from services.user_management.main import RoleChangeRequest
            with pytest.raises(HTTPException) as exc_info:
                await mod.change_user_role(
                    "user-id", RoleChangeRequest(role="superadmin"), request
                )
            assert exc_info.value.status_code == 400
        finally:
            mod.db_manager = old_db


class TestDeactivateActivate:
    """Test user deactivation and activation."""

    @pytest.mark.asyncio
    async def test_deactivate_user(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        orm_user = _make_mock_orm_user(is_active=False)

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.deactivate_user = AsyncMock(return_value=orm_user)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    result = await mod.deactivate_user("other-user", request)
            assert result["success"] is True
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_deactivate_self_rejected(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(user_id="self-id", role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        with pytest.raises(HTTPException) as exc_info:
            await mod.deactivate_user("self-id", request)
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_activate_user(self):
        import services.user_management.main as mod

        admin_user = _make_auth_user(role=UserRole.ADMIN)
        request = _make_mock_request(user=admin_user)

        orm_user = _make_mock_orm_user(is_active=True)

        mock_session = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.activate_user = AsyncMock(return_value=orm_user)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            with patch("services.user_management.main.UserRepository", return_value=mock_repo):
                with patch.object(mod, "audit_log", new_callable=AsyncMock):
                    result = await mod.activate_user("user-id", request)
            assert result["success"] is True
        finally:
            mod.db_manager = old_db


class TestAuditLog:
    """Test audit logging for user management."""

    @pytest.mark.asyncio
    async def test_audit_log_no_db(self):
        import services.user_management.main as mod

        old_db = mod.db_manager
        mod.db_manager = None
        try:
            await mod.audit_log(event_type="test", action="test")
        finally:
            mod.db_manager = old_db

    @pytest.mark.asyncio
    async def test_audit_log_with_db(self):
        import services.user_management.main as mod

        mock_session = AsyncMock()
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_db = MagicMock()
        mock_db.get_session = MagicMock(return_value=mock_ctx)

        old_db = mod.db_manager
        mod.db_manager = mock_db

        try:
            await mod.audit_log(
                event_type="user.created",
                action="create",
                target_id="user-123",
                actor_id="admin",
            )
            mock_session.add.assert_called_once()
            mock_session.commit.assert_called_once()
        finally:
            mod.db_manager = old_db


# ---------------------------------------------------------------------------
# Pydantic Model Validation Tests
# ---------------------------------------------------------------------------


class TestRequestModels:
    """Test request model validation."""

    def test_user_create_request_valid(self):
        from services.user_management.main import UserCreateRequest

        req = UserCreateRequest(
            username="testuser",
            email="test@example.com",
            password="StrongPass123",
            role="viewer",
        )
        assert req.username == "testuser"

    def test_user_create_request_short_username(self):
        from services.user_management.main import UserCreateRequest

        with pytest.raises(Exception):  # Pydantic validation error
            UserCreateRequest(
                username="ab",  # too short
                email="test@example.com",
                password="StrongPass123",
            )

    def test_user_create_request_short_password(self):
        from services.user_management.main import UserCreateRequest

        with pytest.raises(Exception):
            UserCreateRequest(
                username="testuser",
                email="test@example.com",
                password="short",  # too short
            )

    def test_user_create_request_invalid_email(self):
        from services.user_management.main import UserCreateRequest

        with pytest.raises(Exception):
            UserCreateRequest(
                username="testuser",
                email="not-an-email",
                password="StrongPass123",
            )

    def test_password_change_request_valid(self):
        from services.user_management.main import PasswordChangeRequest

        req = PasswordChangeRequest(
            current_password="OldPass123",
            new_password="NewStrongPass123",
        )
        assert req.new_password == "NewStrongPass123"

    def test_role_change_request(self):
        from services.user_management.main import RoleChangeRequest

        req = RoleChangeRequest(role="admin")
        assert req.role == "admin"

    def test_login_request(self):
        from services.user_management.main import LoginRequest

        req = LoginRequest(username_or_email="admin", password="pass123")
        assert req.username_or_email == "admin"
