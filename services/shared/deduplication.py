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
Alert Deduplication Module (Redis-backed)

Provides fingerprint-based alert deduplication using Redis for persistence.
Integrates with the SecurityAlert Pydantic model and supports configurable
time windows and fingerprint strategies.
"""

import hashlib
import json
from datetime import datetime
from typing import Optional

from shared.models.alert import SecurityAlert
from shared.utils import get_logger

logger = get_logger(__name__)

# Redis key prefix
DEDUP_KEY_PREFIX = "alert:dedup:"
DEDUP_STATS_KEY = "alert:dedup:stats"


def compute_fingerprint(alert: SecurityAlert) -> str:
    """
    Compute a SHA-256 fingerprint for deduplication.

    Uses a multi-field composite key so that alerts with identical
    type + network tuple + asset + hash are treated as duplicates.

    Args:
        alert: Validated SecurityAlert instance.

    Returns:
        Hex digest of the fingerprint.
    """
    parts = [
        alert.alert_type.value,
        alert.source_ip or "",
        alert.target_ip or "",
        alert.asset_id or "",
        alert.file_hash or "",
    ]
    content = "|".join(parts)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class AlertDeduplicator:
    """
    Redis-backed alert deduplication.

    For each incoming alert a fingerprint is computed and checked against
    Redis. If the fingerprint already exists within the configured time
    window the alert is considered a duplicate.

    Falls back to in-memory dict when Redis is unavailable.
    """

    def __init__(
        self,
        redis_client=None,
        time_window_seconds: int = 3600,
    ):
        """
        Args:
            redis_client: An async Redis client (aioredis / redis.asyncio).
                          If None, uses in-memory fallback.
            time_window_seconds: TTL for fingerprint keys (default 1 hour).
        """
        self.redis = redis_client
        self.ttl = time_window_seconds
        # In-memory fallback
        self._memory_store: dict[str, float] = {}
        # Metrics
        self.total_checked = 0
        self.duplicates_found = 0

    async def is_duplicate(self, alert: SecurityAlert) -> bool:
        """
        Check whether *alert* is a duplicate of a recently seen alert.

        Args:
            alert: Validated SecurityAlert.

        Returns:
            True if the same fingerprint was seen within the time window.
        """
        fp = compute_fingerprint(alert)
        key = f"{DEDUP_KEY_PREFIX}{fp}"
        self.total_checked += 1

        if self.redis is not None:
            return await self._check_redis(key)
        return self._check_memory(fp)

    async def register(self, alert: SecurityAlert) -> str:
        """
        Register the alert fingerprint so future duplicates are caught.

        Args:
            alert: Validated SecurityAlert.

        Returns:
            The computed fingerprint hex string.
        """
        fp = compute_fingerprint(alert)
        key = f"{DEDUP_KEY_PREFIX}{fp}"

        if self.redis is not None:
            await self._register_redis(key, alert.alert_id)
        else:
            self._register_memory(fp)

        return fp

    async def check_and_register(self, alert: SecurityAlert) -> bool:
        """
        Atomic check-and-register.  Returns True if duplicate.
        """
        fp = compute_fingerprint(alert)
        key = f"{DEDUP_KEY_PREFIX}{fp}"
        self.total_checked += 1

        if self.redis is not None:
            exists = await self.redis.exists(key)
            if exists:
                self.duplicates_found += 1
                logger.info(
                    "Duplicate alert detected",
                    extra={"alert_id": alert.alert_id, "fingerprint": fp[:16]},
                )
                return True
            await self.redis.setex(key, self.ttl, alert.alert_id)
            return False

        # Memory fallback
        if self._check_memory(fp):
            return True
        self._register_memory(fp)
        return False

    def get_stats(self) -> dict:
        """Return deduplication statistics."""
        return {
            "total_checked": self.total_checked,
            "duplicates_found": self.duplicates_found,
            "dedup_rate": (
                f"{self.duplicates_found / self.total_checked * 100:.1f}%"
                if self.total_checked > 0
                else "0.0%"
            ),
        }

    # -- Redis helpers --------------------------------------------------------

    async def _check_redis(self, key: str) -> bool:
        try:
            exists = await self.redis.exists(key)
            if exists:
                self.duplicates_found += 1
                return True
            return False
        except Exception as e:
            logger.warning(f"Redis check failed, falling back to memory: {e}")
            return False

    async def _register_redis(self, key: str, alert_id: str) -> None:
        try:
            await self.redis.setex(key, self.ttl, alert_id)
        except Exception as e:
            logger.warning(f"Redis register failed: {e}")

    # -- Memory fallback ------------------------------------------------------

    def _check_memory(self, fp: str) -> bool:
        ts = self._memory_store.get(fp)
        if ts is None:
            return False
        age = datetime.now().timestamp() - ts
        if age < self.ttl:
            self.duplicates_found += 1
            return True
        # Expired
        del self._memory_store[fp]
        return False

    def _register_memory(self, fp: str) -> None:
        self._memory_store[fp] = datetime.now().timestamp()
        # Evict expired entries periodically
        if len(self._memory_store) > 10_000:
            self._evict_expired()

    def _evict_expired(self) -> None:
        now = datetime.now().timestamp()
        expired = [k for k, v in self._memory_store.items() if now - v >= self.ttl]
        for k in expired:
            del self._memory_store[k]
