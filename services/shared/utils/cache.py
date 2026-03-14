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
Redis cache manager.

Provides caching utilities with Redis.
"""

import json
from typing import Any, Dict, Optional

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
