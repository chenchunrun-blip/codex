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
JWT Authentication Middleware.

Validates Bearer tokens on all /api/ routes, skipping public endpoints
such as health checks, documentation, and auth endpoints.
Uses shared.auth.decode_token to validate JWT tokens.
"""

from typing import Set

from loguru import logger
from shared.auth import decode_token
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Paths that do not require authentication
EXCLUDED_PATHS: Set[str] = {
    "/health",
    "/health/live",
    "/health/ready",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
}

# Path prefixes that do not require authentication
EXCLUDED_PREFIXES = (
    "/docs",
    "/redoc",
)


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """
    JWT authentication middleware for FastAPI.

    Intercepts all incoming requests to /api/ routes and validates the
    Authorization header. On success, the decoded user information is
    attached to ``request.state`` for downstream handlers to consume.

    Requests to public endpoints (health checks, docs, login, refresh)
    are passed through without authentication.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """
        Process the request and validate JWT token if required.

        Args:
            request: Incoming HTTP request.
            call_next: Next middleware or route handler.

        Returns:
            Response from downstream handler, or 401 JSON error.
        """
        path = request.url.path

        # Skip authentication for excluded paths
        if self._is_excluded(path):
            return await call_next(request)

        # Only enforce auth on /api/ routes
        if not path.startswith("/api/"):
            return await call_next(request)

        # Extract Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            logger.warning(
                "Missing Authorization header",
                extra={"path": path, "method": request.method},
            )
            return self._unauthorized_response("Missing Authorization header")

        # Validate Bearer scheme
        parts = auth_header.split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            logger.warning(
                "Invalid Authorization scheme",
                extra={"path": path, "method": request.method},
            )
            return self._unauthorized_response(
                "Invalid Authorization header. Expected: Bearer <token>"
            )

        token = parts[1]

        # Decode and validate the token
        payload = decode_token(token)
        if payload is None:
            logger.warning(
                "Invalid or expired JWT token",
                extra={"path": path, "method": request.method},
            )
            return self._unauthorized_response("Invalid or expired token")

        # Attach user info to request state for downstream handlers
        request.state.user_id = payload.sub
        request.state.user_email = payload.email
        request.state.user_role = payload.role
        request.state.user_permissions = payload.permissions
        request.state.token_payload = payload

        logger.debug(
            "JWT authentication successful",
            extra={
                "user_id": payload.sub,
                "role": payload.role,
                "path": path,
            },
        )

        return await call_next(request)

    def _is_excluded(self, path: str) -> bool:
        """
        Check if the path is excluded from authentication.

        Args:
            path: Request URL path.

        Returns:
            True if the path should skip authentication.
        """
        if path in EXCLUDED_PATHS:
            return True

        for prefix in EXCLUDED_PREFIXES:
            if path.startswith(prefix):
                return True

        return False

    @staticmethod
    def _unauthorized_response(detail: str) -> JSONResponse:
        """
        Build a 401 Unauthorized JSON response.

        Args:
            detail: Human-readable error description.

        Returns:
            JSONResponse with 401 status code.
        """
        return JSONResponse(
            status_code=401,
            content={
                "success": False,
                "error": "UNAUTHORIZED",
                "message": detail,
            },
            headers={"WWW-Authenticate": "Bearer"},
        )
