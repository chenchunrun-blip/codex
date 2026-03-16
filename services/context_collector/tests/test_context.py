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
Unit tests for Context Collector.

Tests the collection of network, asset, and user context.
"""

import pytest

from services.context_collector.collectors import (
    AssetCollector,
    NetworkCollector,
    UserCollector,
)


class TestNetworkCollector:
    """Test cases for NetworkCollector."""

    @pytest.fixture
    def collector(self):
        """Create a NetworkCollector instance."""
        return NetworkCollector()

    @pytest.mark.asyncio
    async def test_collect_internal_ip(self, collector):
        """Test collecting context for internal IP."""
        context = await collector.collect_context("192.168.1.100")

        assert context["ip"] == "192.168.1.100"
        assert context["is_internal"] is True
        assert context["geolocation"]["country"] == "Internal"
        assert context["reputation"]["score"] == 0
        assert context["subnet"]["is_internal"] is True

    @pytest.mark.asyncio
    async def test_collect_external_ip(self, collector):
        """Test collecting context for external IP."""
        context = await collector.collect_context("8.8.8.8")

        assert context["ip"] == "8.8.8.8"
        assert context["is_internal"] is False
        assert context["subnet"]["is_internal"] is False

    @pytest.mark.asyncio
    async def test_invalid_ip(self, collector):
        """Test collecting context for invalid IP."""
        context = await collector.collect_context("invalid-ip")

        assert "error" in context
        assert context["is_internal"] is False

    @pytest.mark.asyncio
    async def test_cache_hit(self, collector):
        """Test that cache works correctly."""
        # First call should populate cache
        await collector.collect_context("10.0.0.1")

        # Second call should hit cache
        context = await collector.collect_context("10.0.0.1")

        assert context["ip"] == "10.0.0.1"

    def test_is_internal_ip(self, collector):
        """Test internal IP detection."""
        assert collector._is_internal_ip("192.168.1.1") is True
        assert collector._is_internal_ip("10.0.0.1") is True
        assert collector._is_internal_ip("172.16.0.1") is True
        assert collector._is_internal_ip("8.8.8.8") is False
        assert collector._is_internal_ip("1.1.1.1") is False

    @pytest.mark.asyncio
    async def test_batch_collect(self, collector):
        """Test batch collection of network context."""
        ips = ["192.168.1.1", "192.168.1.2", "10.0.0.1"]
        results = await collector.collect_batch_context(ips)

        assert len(results) == 3
        assert all(ip in results for ip in ips)

    def test_cache_stats(self, collector):
        """Test cache statistics."""
        stats = collector.get_cache_stats()

        assert "cache_size" in stats
        assert "cache_ttl_seconds" in stats


class TestAssetCollector:
    """Test cases for AssetCollector."""

    @pytest.fixture
    def collector(self):
        """Create an AssetCollector instance."""
        return AssetCollector()

    @pytest.mark.asyncio
    async def test_collect_server_asset(self, collector):
        """Test collecting context for server asset."""
        context = await collector.collect_context("server-001")

        assert context["asset_id"] == "server-001"
        assert context["type"] in ["server", "unknown"]

    @pytest.mark.asyncio
    async def test_collect_workstation_asset(self, collector):
        """Test collecting context for workstation asset."""
        context = await collector.collect_context("desktop-001")

        assert context["asset_id"] == "desktop-001"
        # Type detection based on name
        assert context["type"] in ["workstation", "unknown"]

    @pytest.mark.asyncio
    async def test_cache_hit(self, collector):
        """Test that cache works correctly."""
        await collector.collect_context("server-001")
        context = await collector.collect_context("server-001")

        assert context["asset_id"] == "server-001"

    @pytest.mark.asyncio
    async def test_batch_collect(self, collector):
        """Test batch collection of asset context."""
        assets = ["server-001", "server-002", "desktop-001"]
        results = await collector.collect_batch_context(assets)

        assert len(results) == 3
        assert all(asset in results for asset in assets)


class TestUserCollector:
    """Test cases for UserCollector."""

    @pytest.fixture
    def collector(self):
        """Create a UserCollector instance."""
        return UserCollector()

    @pytest.mark.asyncio
    async def test_collect_user_by_username(self, collector):
        """Test collecting context by username."""
        context = await collector.collect_context("john.doe")

        assert context["user_id"] == "john.doe"
        assert context["username"] == "john.doe"
        assert context["email"] == "john.doe@example.com"

    @pytest.mark.asyncio
    async def test_collect_user_by_email(self, collector):
        """Test collecting context by email."""
        context = await collector.collect_context("john.doe@example.com")

        assert context["user_id"] == "john.doe@example.com"
        assert context["username"] == "john.doe"

    @pytest.mark.asyncio
    async def test_cache_hit(self, collector):
        """Test that cache works correctly."""
        await collector.collect_context("jane.doe")
        context = await collector.collect_context("jane.doe")

        assert context["user_id"] == "jane.doe"

    @pytest.mark.asyncio
    async def test_batch_collect(self, collector):
        """Test batch collection of user context."""
        users = ["user1", "user2", "user3"]
        results = await collector.collect_batch_context(users)

        assert len(results) == 3
        assert all(user in results for user in users)

    @pytest.mark.asyncio
    async def test_groups_included(self, collector):
        """Test that group information is included."""
        context = await collector.collect_context("test.user")

        assert "groups" in context
        assert isinstance(context["groups"], list)

    @pytest.mark.asyncio
    async def test_manager_included(self, collector):
        """Test that manager information is included."""
        context = await collector.collect_context("test.user")

        assert "manager" in context
        assert isinstance(context["manager"], dict)
