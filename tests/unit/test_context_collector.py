"""Unit tests for Context Collector service - IP detection, context collection, caching."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# Internal IP Detection
# ---------------------------------------------------------------------------


class TestInternalIPDetection:
    """Test RFC 1918 / private IP detection."""

    def test_class_a_private(self):
        from services.context_collector.main import is_internal_ip

        assert is_internal_ip("10.0.0.1") is True
        assert is_internal_ip("10.255.255.255") is True

    def test_class_b_private(self):
        from services.context_collector.main import is_internal_ip

        assert is_internal_ip("172.16.0.1") is True
        assert is_internal_ip("172.31.255.255") is True

    def test_class_c_private(self):
        from services.context_collector.main import is_internal_ip

        assert is_internal_ip("192.168.0.1") is True
        assert is_internal_ip("192.168.255.255") is True

    def test_loopback(self):
        from services.context_collector.main import is_internal_ip

        assert is_internal_ip("127.0.0.1") is True

    def test_public_ip(self):
        from services.context_collector.main import is_internal_ip

        assert is_internal_ip("8.8.8.8") is False
        assert is_internal_ip("1.1.1.1") is False
        assert is_internal_ip("203.0.113.50") is False

    def test_invalid_ip(self):
        from services.context_collector.main import is_internal_ip

        assert is_internal_ip("not-an-ip") is False
        assert is_internal_ip("999.999.999.999") is False
        assert is_internal_ip("") is False


# ---------------------------------------------------------------------------
# Subnet Detection
# ---------------------------------------------------------------------------


class TestSubnetDetection:
    """Test subnet calculation for internal IPs."""

    def test_class_a_subnet(self):
        from services.context_collector.main import get_subnet

        result = get_subnet("10.1.2.3")
        assert result is not None
        assert "/8" in result

    def test_class_c_subnet(self):
        from services.context_collector.main import get_subnet

        result = get_subnet("192.168.1.100")
        assert result is not None
        assert "192.168.1.0/24" == result

    def test_loopback_subnet(self):
        from services.context_collector.main import get_subnet

        result = get_subnet("127.0.0.1")
        assert result == "127.0.0.0/8"

    def test_public_ip_returns_none(self):
        from services.context_collector.main import get_subnet

        assert get_subnet("8.8.8.8") is None

    def test_invalid_ip_returns_none(self):
        from services.context_collector.main import get_subnet

        assert get_subnet("invalid") is None


# ---------------------------------------------------------------------------
# Network Context Collection
# ---------------------------------------------------------------------------


class TestNetworkContext:
    """Test network context collection."""

    @pytest.mark.asyncio
    async def test_internal_ip_context(self):
        from services.context_collector.main import context_cache, get_network_context

        # Clear cache
        cache_keys = [k for k in context_cache if k.startswith("network:10.0.0")]
        for k in cache_keys:
            del context_cache[k]

        ctx = await get_network_context("10.0.0.1")

        assert ctx["is_internal"] is True
        assert ctx["network_type"] == "internal"
        assert ctx["country"] == "Internal"
        assert ctx["reputation_score"] == 80.0

    @pytest.mark.asyncio
    async def test_external_ip_context(self):
        from services.context_collector.main import context_cache, get_network_context

        cache_keys = [k for k in context_cache if k.startswith("network:8.8.8")]
        for k in cache_keys:
            del context_cache[k]

        ctx = await get_network_context("8.8.8.8")

        assert ctx["is_internal"] is False
        assert ctx["network_type"] == "external"

    @pytest.mark.asyncio
    async def test_context_caching(self):
        from services.context_collector.main import context_cache, get_network_context

        # Clear cache
        cache_keys = [k for k in context_cache if k.startswith("network:10.1.1")]
        for k in cache_keys:
            del context_cache[k]

        # First call populates cache
        ctx1 = await get_network_context("10.1.1.1")
        assert "network:10.1.1.1" in context_cache

        # Second call should hit cache (same result)
        ctx2 = await get_network_context("10.1.1.1")
        assert ctx1 == ctx2


# ---------------------------------------------------------------------------
# Alert Enrichment
# ---------------------------------------------------------------------------


class TestAlertEnrichment:
    """Test alert enrichment pipeline."""

    @pytest.mark.asyncio
    async def test_enrich_alert_with_ips(self):
        from services.context_collector.main import enrich_alert

        alert = SecurityAlert(
            alert_id="CTX-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Test enrichment",
            source_ip="10.0.0.1",
            target_ip="8.8.8.8",
        )

        enrichment = await enrich_alert(alert)

        assert enrichment["alert_id"] == "CTX-001"
        assert "source_network" in enrichment
        assert "target_network" in enrichment
        assert "source_network" in enrichment["enrichment_sources"]
        assert "target_network" in enrichment["enrichment_sources"]

    @pytest.mark.asyncio
    async def test_enrich_alert_no_optional_fields(self):
        from services.context_collector.main import enrich_alert

        alert = SecurityAlert(
            alert_id="CTX-002",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.ANOMALY,
            severity=Severity.LOW,
            description="Minimal alert",
        )

        enrichment = await enrich_alert(alert)

        assert enrichment["alert_id"] == "CTX-002"
        # No source/target IPs, no asset, no user
        assert "source_network" not in enrichment
        assert "target_network" not in enrichment
        assert "asset" not in enrichment
        assert "user" not in enrichment

    @pytest.mark.asyncio
    async def test_enrich_alert_with_asset_and_user(self):
        """If asset_id and user_id are provided, context should be collected."""
        from services.context_collector.main import enrich_alert

        alert = SecurityAlert(
            alert_id="CTX-003",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.BRUTE_FORCE,
            severity=Severity.HIGH,
            description="Test with asset and user",
            asset_id="ASSET-001",
            user_id="USER-001",
        )

        enrichment = await enrich_alert(alert)

        # Asset and user context should be attempted
        # (may return "not found" if no mock data, but keys should exist)
        assert "asset" in enrichment
        assert "user" in enrichment
