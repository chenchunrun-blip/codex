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
Rate Limiting Middleware.

Implements a token bucket algorithm per client IP address with
configurable limits via environment variables. Expired buckets are
periodically cleaned up to prevent unbounded memory growth.
"""

import math
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Dict

from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# ---------------------------------------------------------------------------
# Configuration (from environment variables)
# ---------------------------------------------------------------------------

# Maximum number of requests allowed per window
RATE_LIMIT_MAX_REQUESTS: int = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "100"))

# Time window in seconds (default 60s = 1 minute)
RATE_LIMIT_WINDOW_SECONDS: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

# How often (in seconds) the background cleanup runs
_CLEANUP_INTERVAL_SECONDS: int = int(os.getenv("RATE_LIMIT_CLEANUP_INTERVAL", "120"))


# ---------------------------------------------------------------------------
# Token Bucket
# ---------------------------------------------------------------------------


@dataclass
class TokenBucket:
    """
    Token bucket for a single client.

    Tokens are refilled at a steady rate. Each request consumes one
    token. When the bucket is empty the client is rate-limited.

    Attributes:
        capacity: Maximum number of tokens the bucket can hold.
        refill_rate: Tokens added per second.
        tokens: Current number of available tokens.
        last_refill: Timestamp of the last refill calculation.
    """

    capacity: int
    refill_rate: float
    tokens: float = field(init=False)
    last_refill: float = field(init=False)

    def __post_init__(self) -> None:
        self.tokens = float(self.capacity)
        self.last_refill = time.monotonic()

    def consume(self) -> bool:
        """
        Try to consume one token.

        Refills tokens based on elapsed time before checking availability.

        Returns:
            True if the request is allowed, False if rate-limited.
        """
        now = time.monotonic()
        elapsed = now - self.last_refill
        self.tokens = min(
            self.capacity,
            self.tokens + elapsed * self.refill_rate,
        )
        self.last_refill = now

        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False

    def retry_after(self) -> int:
        """
        Seconds until at least one token is available.

        Returns:
            Number of seconds the client should wait.
        """
        if self.tokens >= 1.0:
            return 0
        deficit = 1.0 - self.tokens
        return max(1, math.ceil(deficit / self.refill_rate))


# ---------------------------------------------------------------------------
# In-memory Bucket Store
# ---------------------------------------------------------------------------


class BucketStore:
    """
    Thread-safe in-memory store for per-client token buckets.

    Periodically removes buckets that have been idle longer than twice the
    configured time window to prevent unbounded memory growth.
    """

    def __init__(
        self,
        capacity: int,
        window_seconds: int,
        cleanup_interval: int,
    ) -> None:
        self._capacity = capacity
        self._refill_rate = capacity / window_seconds
        self._ttl = window_seconds * 2
        self._cleanup_interval = cleanup_interval

        self._buckets: Dict[str, TokenBucket] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.monotonic()

    def get_bucket(self, key: str) -> TokenBucket:
        """
        Retrieve or create a token bucket for the given key.

        Args:
            key: Client identifier (typically IP address).

        Returns:
            The client's token bucket.
        """
        with self._lock:
            self._maybe_cleanup()

            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = TokenBucket(
                    capacity=self._capacity,
                    refill_rate=self._refill_rate,
                )
                self._buckets[key] = bucket
            return bucket

    def _maybe_cleanup(self) -> None:
        """Remove stale buckets if the cleanup interval has elapsed."""
        now = time.monotonic()
        if now - self._last_cleanup < self._cleanup_interval:
            return

        self._last_cleanup = now
        stale_keys = [
            key for key, bucket in self._buckets.items() if now - bucket.last_refill > self._ttl
        ]
        for key in stale_keys:
            del self._buckets[key]

        if stale_keys:
            logger.debug(f"Rate limiter cleanup: removed {len(stale_keys)} stale buckets")


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiting middleware using the token bucket algorithm.

    Each client IP address gets an independent token bucket. When the
    bucket is exhausted the middleware returns 429 Too Many Requests with
    a ``Retry-After`` header.

    Configuration via environment variables:
        RATE_LIMIT_MAX_REQUESTS  - max requests per window (default 100)
        RATE_LIMIT_WINDOW_SECONDS - window length in seconds (default 60)
    """

    def __init__(self, app, **kwargs) -> None:  # type: ignore[override]
        super().__init__(app)
        self._store = BucketStore(
            capacity=RATE_LIMIT_MAX_REQUESTS,
            window_seconds=RATE_LIMIT_WINDOW_SECONDS,
            cleanup_interval=_CLEANUP_INTERVAL_SECONDS,
        )

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """
        Check rate limit for the incoming request.

        Args:
            request: Incoming HTTP request.
            call_next: Next middleware or route handler.

        Returns:
            Response from downstream, or 429 if rate-limited.
        """
        client_ip = self._get_client_ip(request)
        bucket = self._store.get_bucket(client_ip)

        if not bucket.consume():
            retry_after = bucket.retry_after()
            logger.warning(
                "Rate limit exceeded",
                extra={
                    "client_ip": client_ip,
                    "path": request.url.path,
                    "retry_after": retry_after,
                },
            )
            return JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "error": "RATE_LIMIT_EXCEEDED",
                    "message": (
                        f"Rate limit exceeded. Maximum {RATE_LIMIT_MAX_REQUESTS} "
                        f"requests per {RATE_LIMIT_WINDOW_SECONDS} seconds."
                    ),
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(RATE_LIMIT_MAX_REQUESTS),
                    "X-RateLimit-Remaining": "0",
                },
            )

        # Attach rate-limit info headers to successful responses
        response = await call_next(request)
        remaining = max(0, int(bucket.tokens))
        response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_MAX_REQUESTS)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """
        Extract the client IP address from the request.

        Respects the ``X-Forwarded-For`` header when the application sits
        behind a reverse proxy.

        Args:
            request: Incoming HTTP request.

        Returns:
            Client IP address string.
        """
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Take the first (original client) IP
            return forwarded_for.split(",")[0].strip()

        if request.client:
            return request.client.host

        return "unknown"
