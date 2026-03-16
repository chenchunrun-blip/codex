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
Unit tests for the multi-level cache system.

Tests L1 (in-memory), L2 (Redis), and the MultiLevelCache coordinator.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.utils.cache import CacheKeys, CacheManager, L1MemoryCache, MultiLevelCache


class TestL1MemoryCache:
    """Tests for the L1 in-process memory cache."""

    def test_get_set(self):
        """Test basic get/set operations."""
        cache = L1MemoryCache(capacity=100, default_ttl=300)
        cache.set("key1", {"data": "value1"})
        assert cache.get("key1") == {"data": "value1"}

    def test_get_miss(self):
        """Test cache miss returns None."""
        cache = L1MemoryCache()
        assert cache.get("nonexistent") is None

    def test_ttl_expiry(self):
        """Test that entries expire after TTL."""
        cache = L1MemoryCache(default_ttl=1)
        cache.set("key1", "value1", ttl=0)  # immediate expiry
        # Force expiry by manipulating stored time
        key_data = cache._store["key1"]
        cache._store["key1"] = (key_data[0], time.monotonic() - 1)
        assert cache.get("key1") is None

    def test_lru_eviction(self):
        """Test LRU eviction when capacity exceeded."""
        cache = L1MemoryCache(capacity=3, default_ttl=300)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.set("k3", "v3")
        cache.set("k4", "v4")  # Should evict k1

        assert cache.get("k1") is None
        assert cache.get("k2") == "v2"
        assert cache.get("k4") == "v4"

    def test_lru_access_order(self):
        """Test that accessing a key moves it to end of LRU queue."""
        cache = L1MemoryCache(capacity=3, default_ttl=300)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.set("k3", "v3")

        # Access k1 to move it to end
        cache.get("k1")

        # k2 should be evicted now (least recently used)
        cache.set("k4", "v4")
        assert cache.get("k2") is None
        assert cache.get("k1") == "v1"

    def test_delete(self):
        """Test delete operation."""
        cache = L1MemoryCache()
        cache.set("key1", "value1")
        cache.delete("key1")
        assert cache.get("key1") is None

    def test_clear(self):
        """Test clearing all entries."""
        cache = L1MemoryCache()
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.clear()
        assert cache.get("k1") is None
        assert cache.get("k2") is None

    def test_hit_rate(self):
        """Test hit rate tracking."""
        cache = L1MemoryCache()
        cache.set("k1", "v1")

        cache.get("k1")  # hit
        cache.get("k1")  # hit
        cache.get("missing")  # miss

        assert cache.hit_rate == pytest.approx(2 / 3, abs=0.01)

    def test_stats(self):
        """Test stats reporting."""
        cache = L1MemoryCache(capacity=100, default_ttl=300)
        cache.set("k1", "v1")
        cache.get("k1")  # hit
        cache.get("k2")  # miss

        stats = cache.stats
        assert stats["size"] == 1
        assert stats["capacity"] == 100
        assert stats["hits"] == 1
        assert stats["misses"] == 1
        assert stats["default_ttl"] == 300

    def test_overwrite_existing_key(self):
        """Test overwriting an existing key."""
        cache = L1MemoryCache()
        cache.set("k1", "v1")
        cache.set("k1", "v2")
        assert cache.get("k1") == "v2"


class TestMultiLevelCache:
    """Tests for the multi-level cache coordinator."""

    @pytest.fixture
    def mock_redis(self):
        """Create a mock Redis client."""
        client = AsyncMock()
        client.get = AsyncMock(return_value=None)
        client.setex = AsyncMock()
        client.delete = AsyncMock()
        client.close = AsyncMock()
        return client

    @pytest.fixture
    def cache(self, mock_redis):
        """Create a MultiLevelCache with mocked Redis."""
        mlc = MultiLevelCache(redis_url="redis://localhost:6379/0")
        mlc._redis = mock_redis
        return mlc

    @pytest.mark.asyncio
    async def test_l1_hit(self, cache):
        """Test that L1 hit returns immediately without touching L2."""
        cache.l1.set("key1", "value1")
        result = await cache.get("key1")
        assert result == "value1"
        cache._redis.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_l2_hit_promotes_to_l1(self, cache):
        """Test that L2 hit promotes value to L1."""
        import json

        cache._redis.get = AsyncMock(return_value=json.dumps("value_from_redis").encode())

        result = await cache.get("key1")
        assert result == "value_from_redis"
        # Check promoted to L1
        assert cache.l1.get("key1") == "value_from_redis"

    @pytest.mark.asyncio
    async def test_l3_fallback_called_on_miss(self, cache):
        """Test L3 fallback is called when L1 and L2 miss."""
        fallback = AsyncMock(return_value="value_from_api")

        result = await cache.get("key1", fallback=fallback)
        assert result == "value_from_api"
        fallback.assert_called_once()

    @pytest.mark.asyncio
    async def test_l3_result_cached_in_l1_and_l2(self, cache):
        """Test that L3 result is cached in both L1 and L2."""
        fallback = AsyncMock(return_value={"data": "fresh"})

        await cache.get("key1", fallback=fallback, tier="hot")

        # L1 should have it
        assert cache.l1.get("key1") == {"data": "fresh"}
        # L2 should have been called to set
        cache._redis.setex.assert_called_once()

    @pytest.mark.asyncio
    async def test_set_writes_to_both_levels(self, cache):
        """Test that set writes to both L1 and L2."""
        await cache.set("key1", "value1", tier="warm")
        assert cache.l1.get("key1") == "value1"
        cache._redis.setex.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_removes_from_both_levels(self, cache):
        """Test that delete removes from both L1 and L2."""
        cache.l1.set("key1", "value1")
        await cache.delete("key1")
        assert cache.l1.get("key1") is None
        cache._redis.delete.assert_called_once_with("key1")

    @pytest.mark.asyncio
    async def test_stats(self, cache):
        """Test stats include all levels."""
        stats = cache.stats
        assert "l1" in stats
        assert "l2" in stats
        assert "l3" in stats

    @pytest.mark.asyncio
    async def test_l3_fallback_error_handling(self, cache):
        """Test graceful handling of L3 fallback errors."""
        fallback = AsyncMock(side_effect=Exception("API down"))
        result = await cache.get("key1", fallback=fallback)
        assert result is None

    @pytest.mark.asyncio
    async def test_ttl_tiers(self, cache):
        """Test that different tiers use different TTLs."""
        import json

        await cache.set("hot_key", "v1", tier="hot")
        call_args = cache._redis.setex.call_args
        assert call_args[0][1] == 3600  # 1 hour

        cache._redis.setex.reset_mock()
        await cache.set("warm_key", "v2", tier="warm")
        call_args = cache._redis.setex.call_args
        assert call_args[0][1] == 86400  # 24 hours

        cache._redis.setex.reset_mock()
        await cache.set("cold_key", "v3", tier="cold")
        call_args = cache._redis.setex.call_args
        assert call_args[0][1] == 604800  # 7 days

    @pytest.mark.asyncio
    async def test_redis_unavailable_graceful_degradation(self, cache):
        """Test that L2 failure degrades gracefully."""
        cache._redis.get = AsyncMock(side_effect=Exception("Redis down"))
        fallback = AsyncMock(return_value="fallback_value")

        result = await cache.get("key1", fallback=fallback)
        assert result == "fallback_value"


class TestCacheKeys:
    """Tests for cache key templates."""

    def test_build_alert_key(self):
        """Test building an alert cache key."""
        key = CacheKeys.build(CacheKeys.ALERT, alert_id="ALT-001")
        assert key == "alerts:alert:ALT-001"

    def test_build_threat_intel_key(self):
        """Test building a threat intel cache key."""
        key = CacheKeys.build(CacheKeys.THREAT_INTEL, ioc_type="ip", ioc_value="1.2.3.4")
        assert key == "threatintel:ip:1.2.3.4"

    def test_build_user_key(self):
        """Test building a user cache key."""
        key = CacheKeys.build(CacheKeys.USER, user_id="user-123")
        assert key == "users:user:user-123"
