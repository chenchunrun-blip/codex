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
Multi-level cache manager.

Provides a three-level caching system per design requirements:
- L1: In-process memory cache (10K entries, 5min TTL, 60% hit target)
- L2: Redis cache (1M entries, tiered TTL: 1h/24h/7d, 30% hit target)
- L3: API/database fallback (10% of requests)

Also provides the original single-level Redis CacheManager for backward compatibility.
"""

import asyncio
import json
import time
from collections import OrderedDict
from typing import Any, Callable, Coroutine, Dict, Optional, Tuple

import redis.asyncio as redis
from shared.utils.logger import get_logger

logger = get_logger(__name__)


class CacheManager:
    """
    Redis cache manager.

    Provides simple get/set/delete operations with JSON serialization.
    """

    def __init__(self, redis_url: str, pool_size: int = 10):
        """
        Initialize cache manager.

        Args:
            redis_url: Redis connection URL
            pool_size: Connection pool size
        """
        self.redis_url = redis_url
        self.pool_size = pool_size
        self.client: Optional[redis.Redis] = None

    async def connect(self):
        """Connect to Redis."""
        self.client = await redis.from_url(
            self.redis_url,
            max_connections=self.pool_size,
            decode_responses=False,  # We'll handle decoding
        )
        logger.info("Connected to Redis")

    async def close(self):
        """Close Redis connection."""
        if self.client:
            await self.client.close()
            logger.info("Redis connection closed")

    async def get(self, key: str) -> Optional[Any]:
        """
        Get value from cache.

        Args:
            key: Cache key

        Returns:
            Cached value or None
        """
        if not self.client:
            await self.connect()

        try:
            value = await self.client.get(key)
            if value:
                return json.loads(value.decode())
            return None
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int = 3600,
    ):
        """
        Set value in cache.

        Args:
            key: Cache key
            value: Value to cache (will be JSON serialized)
            ttl: Time to live in seconds
        """
        if not self.client:
            await self.connect()

        try:
            serialized = json.dumps(value).encode()
            await self.client.setex(key, ttl, serialized)
            logger.debug(f"Cached key: {key}, TTL: {ttl}s")
        except Exception as e:
            logger.error(f"Cache set error: {e}")

    async def delete(self, key: str):
        """
        Delete key from cache.

        Args:
            key: Cache key
        """
        if not self.client:
            await self.connect()

        try:
            await self.client.delete(key)
            logger.debug(f"Deleted cache key: {key}")
        except Exception as e:
            logger.error(f"Cache delete error: {e}")

    async def delete_many(self, *keys: str):
        """
        Delete multiple keys.

        Args:
            *keys: Cache keys to delete
        """
        if not keys:
            return

        if not self.client:
            await self.connect()

        try:
            await self.client.delete(*keys)
            logger.debug(f"Deleted {len(keys)} cache keys")
        except Exception as e:
            logger.error(f"Cache delete many error: {e}")

    async def exists(self, key: str) -> bool:
        """
        Check if key exists.

        Args:
            key: Cache key

        Returns:
            True if key exists
        """
        if not self.client:
            await self.connect()

        try:
            return await self.client.exists(key) > 0
        except Exception as e:
            logger.error(f"Cache exists error: {e}")
            return False

    async def clear(self):
        """Clear all cache (use with caution)."""
        if not self.client:
            await self.connect()

        try:
            await self.client.flushdb()
            logger.warning("Cache cleared")
        except Exception as e:
            logger.error(f"Cache clear error: {e}")


# Cache key templates
class CacheKeys:
    """Cache key name templates."""

    ALERT = "alerts:alert:{alert_id}"
    ALERT_LIST = "alerts:list:{filters_hash}"
    THREAT_INTEL = "threatintel:{ioc_type}:{ioc_value}"
    CONTEXT = "context:{alert_id}"
    USER = "users:user:{user_id}"
    USER_PERMISSIONS = "users:permissions:{user_id}"

    @staticmethod
    def build(template: str, **kwargs) -> str:
        """
        Build cache key from template.

        Args:
            template: Key template
            **kwargs: Template variables

        Returns:
            Formatted cache key
        """
        return template.format(**kwargs)


class L1MemoryCache:
    """
    L1 in-process memory cache with LRU eviction.

    Design spec: 10K entries, 5min TTL, 60% hit rate target.
    """

    def __init__(self, capacity: int = 10000, default_ttl: int = 300):
        self._capacity = capacity
        self._default_ttl = default_ttl
        self._store: OrderedDict[str, Tuple[Any, float]] = OrderedDict()
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Optional[Any]:
        """Get value from L1 cache. Returns None on miss or expiry."""
        if key in self._store:
            value, expiry = self._store[key]
            if time.monotonic() < expiry:
                self._hits += 1
                self._store.move_to_end(key)
                return value
            del self._store[key]
        self._misses += 1
        return None

    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """Set value in L1 cache with LRU eviction."""
        ttl = ttl or self._default_ttl
        expiry = time.monotonic() + ttl

        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (value, expiry)

        while len(self._store) > self._capacity:
            self._store.popitem(last=False)

    def delete(self, key: str):
        """Remove key from L1 cache."""
        self._store.pop(key, None)

    def clear(self):
        """Clear all L1 cache entries."""
        self._store.clear()

    @property
    def hit_rate(self) -> float:
        """Current hit rate as a fraction."""
        total = self._hits + self._misses
        return self._hits / total if total > 0 else 0.0

    @property
    def stats(self) -> Dict[str, Any]:
        """Return cache statistics."""
        return {
            "size": len(self._store),
            "capacity": self._capacity,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": round(self.hit_rate, 4),
            "default_ttl": self._default_ttl,
        }


class MultiLevelCache:
    """
    Three-level cache per design requirements.

    L1: In-process memory (fast, small, short TTL)
    L2: Redis (medium speed, large capacity, tiered TTL)
    L3: Fallback function (slow, authoritative source)

    Usage:
        cache = MultiLevelCache(redis_url="redis://localhost:6379/0")
        await cache.connect()

        # With L3 fallback
        result = await cache.get("key", fallback=async_fetch_from_api)

        # Direct set
        await cache.set("key", value, tier="hot")
    """

    # Tiered TTL for L2 Redis per design: hot=1h, warm=24h, cold=7d
    TTL_TIERS = {
        "hot": 3600,
        "warm": 86400,
        "cold": 604800,
    }

    def __init__(
        self,
        redis_url: str,
        l1_capacity: int = 10000,
        l1_ttl: int = 300,
        pool_size: int = 10,
    ):
        self.l1 = L1MemoryCache(capacity=l1_capacity, default_ttl=l1_ttl)
        self._redis_url = redis_url
        self._pool_size = pool_size
        self._redis: Optional[redis.Redis] = None
        self._l2_hits = 0
        self._l2_misses = 0
        self._l3_calls = 0

    async def connect(self):
        """Connect to Redis (L2)."""
        self._redis = await redis.from_url(
            self._redis_url,
            max_connections=self._pool_size,
            decode_responses=False,
        )
        logger.info("MultiLevelCache: L2 Redis connected")

    async def close(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            logger.info("MultiLevelCache: L2 Redis closed")

    async def get(
        self,
        key: str,
        fallback: Optional[Callable[..., Coroutine]] = None,
        fallback_args: Optional[tuple] = None,
        tier: str = "hot",
    ) -> Optional[Any]:
        """
        Get value through the cache hierarchy: L1 → L2 → L3 (fallback).

        Args:
            key: Cache key
            fallback: Async function to call on L1+L2 miss (L3 source)
            fallback_args: Arguments to pass to fallback function
            tier: TTL tier for L2 caching ("hot", "warm", "cold")

        Returns:
            Cached or fetched value, or None
        """
        # L1 check
        value = self.l1.get(key)
        if value is not None:
            return value

        # L2 check (Redis)
        value = await self._l2_get(key)
        if value is not None:
            self._l2_hits += 1
            self.l1.set(key, value)
            return value
        self._l2_misses += 1

        # L3 fallback
        if fallback:
            self._l3_calls += 1
            try:
                args = fallback_args or ()
                value = await fallback(*args)
                if value is not None:
                    await self.set(key, value, tier=tier)
                return value
            except Exception as e:
                logger.error(f"L3 fallback error for key {key}: {e}")
                return None

        return None

    async def set(self, key: str, value: Any, tier: str = "hot"):
        """
        Set value in both L1 and L2.

        Args:
            key: Cache key
            value: Value to cache
            tier: TTL tier for L2 ("hot", "warm", "cold")
        """
        ttl = self.TTL_TIERS.get(tier, self.TTL_TIERS["hot"])
        self.l1.set(key, value)
        await self._l2_set(key, value, ttl)

    async def delete(self, key: str):
        """Delete key from all cache levels."""
        self.l1.delete(key)
        await self._l2_delete(key)

    async def _l2_get(self, key: str) -> Optional[Any]:
        """Get from Redis L2 cache."""
        if not self._redis:
            return None
        try:
            raw = await self._redis.get(key)
            if raw:
                return json.loads(raw.decode())
        except Exception as e:
            logger.error(f"L2 get error: {e}")
        return None

    async def _l2_set(self, key: str, value: Any, ttl: int):
        """Set in Redis L2 cache."""
        if not self._redis:
            return
        try:
            serialized = json.dumps(value).encode()
            await self._redis.setex(key, ttl, serialized)
        except Exception as e:
            logger.error(f"L2 set error: {e}")

    async def _l2_delete(self, key: str):
        """Delete from Redis L2 cache."""
        if not self._redis:
            return
        try:
            await self._redis.delete(key)
        except Exception as e:
            logger.error(f"L2 delete error: {e}")

    @property
    def stats(self) -> Dict[str, Any]:
        """Return statistics for all cache levels."""
        l2_total = self._l2_hits + self._l2_misses
        return {
            "l1": self.l1.stats,
            "l2": {
                "hits": self._l2_hits,
                "misses": self._l2_misses,
                "hit_rate": round(self._l2_hits / l2_total, 4) if l2_total > 0 else 0.0,
            },
            "l3": {
                "calls": self._l3_calls,
            },
            "overall_l1_hit_rate": round(self.l1.hit_rate, 4),
        }
