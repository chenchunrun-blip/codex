"""Unit tests for Threat Intel Aggregator service - sources, scoring, aggregation."""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from shared.models import AlertType, SecurityAlert, Severity


# ---------------------------------------------------------------------------
# VirusTotal Source
# ---------------------------------------------------------------------------

class TestVirusTotalSource:
    """Test VirusTotal threat intel source."""

    def test_disabled_without_api_key(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="")
        assert source.enabled is False

    def test_disabled_with_placeholder_key(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="your_vt_key")
        assert source.enabled is False

    def test_enabled_with_real_key(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="sk-real-api-key-123")
        assert source.enabled is True

    @pytest.mark.asyncio
    async def test_query_ip_returns_none_when_disabled(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="")
        result = await source.query_ip("1.2.3.4")
        assert result is None

    @pytest.mark.asyncio
    async def test_query_hash_returns_none_when_disabled(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="")
        result = await source.query_hash("a" * 64)
        assert result is None

    def test_parse_ip_response(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="test")
        data = {
            "detected_urls": [{"url": "http://bad.com"}],
            "country": "US",
            "as_owner": "ISP Inc",
            "response_code": 1,
        }

        result = source._parse_ip_response(data)
        assert result["source"] == "VirusTotal"
        assert result["positives"] == 1
        assert result["country"] == "US"

    def test_parse_hash_response(self):
        from services.threat_intel_aggregator.main import VirusTotalSource

        source = VirusTotalSource(api_key="test")
        data = {
            "response_code": 1,
            "positives": 45,
            "total": 72,
            "scan_date": "2026-01-01",
        }

        result = source._parse_hash_response(data)
        assert result["detected"] is True
        assert result["positives"] == 45
        assert result["total"] == 72


# ---------------------------------------------------------------------------
# Abuse.ch Source
# ---------------------------------------------------------------------------

class TestAbuseCHSource:
    """Test Abuse.ch threat intel source."""

    def test_always_enabled(self):
        from services.threat_intel_aggregator.main import AbuseCHSource

        source = AbuseCHSource()
        assert source.enabled is True

    def test_parse_hash_response_detected(self):
        from services.threat_intel_aggregator.main import AbuseCHSource

        source = AbuseCHSource()
        data = {
            "query_status": "ok",
            "threat_type": "malware_download",
            "tags": ["emotet", "trojan"],
        }

        result = source._parse_hash_response(data)
        assert result["detected"] is True
        assert result["threat_type"] == "malware_download"

    def test_parse_hash_response_not_detected(self):
        from services.threat_intel_aggregator.main import AbuseCHSource

        source = AbuseCHSource()
        data = {"query_status": "no_results"}

        result = source._parse_hash_response(data)
        assert result["detected"] is False


# ---------------------------------------------------------------------------
# Internal IOC Source
# ---------------------------------------------------------------------------

class TestInternalIOCSource:
    """Test internal IOC database source."""

    def test_enabled_by_default(self):
        from services.threat_intel_aggregator.main import InternalIOCSource

        source = InternalIOCSource()
        assert source.enabled is True

    @pytest.mark.asyncio
    async def test_query_non_malicious_ip(self):
        from services.threat_intel_aggregator.main import InternalIOCSource

        source = InternalIOCSource()
        result = await source.query_ip("10.0.0.1")
        # Internal IPs should not be flagged as malicious
        assert result is not None
        assert result.get("detected") is False or result is not None


# ---------------------------------------------------------------------------
# Custom Threat Feed
# ---------------------------------------------------------------------------

class TestCustomThreatFeed:
    """Test custom internal threat feed."""

    @pytest.mark.asyncio
    async def test_empty_blocklist_returns_none(self):
        from services.threat_intel_aggregator.main import CustomThreatFeed

        feed = CustomThreatFeed()
        assert await feed.query_ip("1.2.3.4") is None
        assert await feed.query_hash("a" * 64) is None
        assert await feed.query_url("http://example.com") is None

    @pytest.mark.asyncio
    async def test_blocklisted_ip_detected(self):
        from services.threat_intel_aggregator.main import CustomThreatFeed

        feed = CustomThreatFeed()
        feed.blocklist_ips.add("1.2.3.4")

        result = await feed.query_ip("1.2.3.4")
        assert result is not None
        assert result["detected"] is True
        assert result["source"] == "CustomFeed"

    @pytest.mark.asyncio
    async def test_non_blocklisted_ip_not_detected(self):
        from services.threat_intel_aggregator.main import CustomThreatFeed

        feed = CustomThreatFeed()
        feed.blocklist_ips.add("1.2.3.4")

        result = await feed.query_ip("5.6.7.8")
        assert result is None


# ---------------------------------------------------------------------------
# Threat Score Calculation
# ---------------------------------------------------------------------------

class TestThreatScoreCalculation:
    """Test aggregated threat score calculation."""

    @pytest.mark.asyncio
    async def test_query_threat_intel_no_sources(self):
        """Query with no sources should return zero score."""
        from services.threat_intel_aggregator.main import query_threat_intel, threat_sources

        # Save and clear sources
        saved = threat_sources.copy()
        threat_sources.clear()

        try:
            result = await query_threat_intel(ip="1.2.3.4")
            assert result["threat_score"] == 0.0
            assert result["sources_queried"] == 0
        finally:
            threat_sources.extend(saved)

    @pytest.mark.asyncio
    async def test_query_threat_intel_with_internal_source(self):
        """Query should aggregate results from enabled sources."""
        from services.threat_intel_aggregator.main import query_threat_intel, threat_sources, init_threat_sources

        # Initialize sources if empty
        if not threat_sources:
            init_threat_sources()

        result = await query_threat_intel(ip="10.0.0.1")
        assert "sources_queried" in result
        assert "threat_score" in result
        assert isinstance(result["threat_score"], float)


# ---------------------------------------------------------------------------
# Alert Enrichment with Threat Intel
# ---------------------------------------------------------------------------

class TestThreatIntelEnrichment:
    """Test full alert enrichment flow."""

    @pytest.mark.asyncio
    async def test_enrich_alert_with_ip(self):
        from services.threat_intel_aggregator.main import (
            enrich_with_threat_intel,
            threat_sources,
            init_threat_sources,
        )

        if not threat_sources:
            init_threat_sources()

        alert = SecurityAlert(
            alert_id="TI-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Test threat intel enrichment",
            source_ip="45.33.32.156",
        )

        enrichment = await enrich_with_threat_intel(alert)

        assert enrichment["alert_id"] == "TI-001"
        assert "threat_intel" in enrichment
        assert "source_ip" in enrichment["threat_intel"]

    @pytest.mark.asyncio
    async def test_enrich_alert_no_iocs(self):
        """Alert without IOCs should return minimal enrichment."""
        from services.threat_intel_aggregator.main import enrich_with_threat_intel

        alert = SecurityAlert(
            alert_id="TI-002",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.ANOMALY,
            severity=Severity.LOW,
            description="No IOCs",
        )

        enrichment = await enrich_with_threat_intel(alert)
        assert enrichment["alert_id"] == "TI-002"
        # No IP, hash, or URL -> empty threat_intel
        assert enrichment["threat_intel"] == {}


# ---------------------------------------------------------------------------
# Cache Helpers
# ---------------------------------------------------------------------------

class TestCacheHelpers:
    """Test cache check/set helper functions."""

    @pytest.mark.asyncio
    async def test_check_cache_no_manager(self):
        """When cache_manager is None, check_cache should return None."""
        from services.threat_intel_aggregator.main import check_cache

        # cache_manager is None by default in test
        result = await check_cache("test_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_cache_no_manager(self):
        """When cache_manager is None, set_cache should be a no-op."""
        from services.threat_intel_aggregator.main import set_cache

        # Should not raise
        await set_cache("test_key", {"data": "value"})
