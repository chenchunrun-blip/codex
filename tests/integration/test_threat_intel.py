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
Integration tests for Threat Intelligence Aggregator Service.

Tests real API integrations with VirusTotal, Abuse.ch, and OTX.
"""

import asyncio
import os
import pytest

from services.threat_intel_aggregator.sources.virustotal import VirusTotalSource
from services.threat_intel_aggregator.sources.abuse_ch import AbuseCHSource
from services.threat_intel_aggregator.sources.otx import OTXSource


class TestVirusTotalIntegration:
    """Test VirusTotal API integration."""

    @pytest.fixture
    def vt_source(self):
        """Create VirusTotal source instance."""
        api_key = os.getenv("VIRUSTOTAL_API_KEY", "")
        return VirusTotalSource(api_key)

    @pytest.mark.asyncio
    async def test_query_ip(self, vt_source):
        """Test querying IP reputation."""
        if not vt_source.enabled:
            pytest.skip("VirusTotal API key not configured")

        # Google DNS - should be safe
        result = await vt_source.query_ioc("8.8.8.8", "ip")

        assert result is not None
        assert result["source"] == "virustotal"
        assert "detected" in result
        assert "country" in result or "as_owner" in result

    @pytest.mark.asyncio
    async def test_query_hash(self, vt_source):
        """Test querying file hash reputation."""
        if not vt_source.enabled:
            pytest.skip("VirusTotal API key not configured")

        # EICAR test file signature (safe test file)
        eicar_hash = "44d88612fea8a8f36de82e1278abb02f"
        result = await vt_source.query_ioc(eicar_hash, "hash")

        assert result is not None
        assert result["source"] == "virustotal"
        assert "detected" in result
        assert "positives" in result

    @pytest.mark.asyncio
    async def test_cache_functionality(self, vt_source):
        """Test that caching works correctly."""
        if not vt_source.enabled:
            pytest.skip("VirusTotal API key not configured")

        # First query
        result1 = await vt_source.query_ioc("8.8.8.8", "ip")
        # Second query (should be cached)
        result2 = await vt_source.query_ioc("8.8.8.8", "ip")

        assert result1 == result2


class TestAbuseCHIntegration:
    """Test Abuse.ch API integration."""

    @pytest.fixture
    def abuse_source(self):
        """Create Abuse.ch source instance."""
        return AbuseCHSource()

    @pytest.mark.asyncio
    async def test_query_url(self, abuse_source):
        """Test querying URL reputation."""
        # Test with a known safe URL
        result = await abuse_source.query_ioc("https://www.google.com", "url")

        assert result is not None
        assert result["source"] == "abuse_ch"
        assert "detected" in result

    @pytest.mark.asyncio
    async def test_query_hash(self, abuse_source):
        """Test querying file hash."""
        # EICAR test file
        eicar_hash = "44d88612fea8a8f36de82e1278abb02f"
        result = await abuse_source.query_ioc(eicar_hash, "hash")

        assert result is not None
        assert "detected" in result


class TestOTXIntegration:
    """Test AlienVault OTX API integration."""

    @pytest.fixture
    def otx_source(self):
        """Create OTX source instance."""
        api_key = os.getenv("OTX_API_KEY", "")
        return OTXSource(api_key)

    @pytest.mark.asyncio
    async def test_query_ip(self, otx_source):
        """Test querying IP reputation."""
        if not otx_source.enabled:
            pytest.skip("OTX API key not configured")

        result = await otx_source.query_ioc("8.8.8.8", "ip")

        assert result is not None
        assert result["source"] == "otx"
        assert "detected" in result


class TestAggregation:
    """Test threat intelligence aggregation."""

    @pytest.mark.asyncio
    async def test_multiple_sources(self):
        """Test querying multiple sources in parallel."""
        from services.threat_intel_aggregator.sources.aggregator import ThreatIntelAggregator

        sources = [
            AbuseCHSource(),  # Always available
        ]

        # Add optional sources if API keys are configured
        vt_key = os.getenv("VIRUSTOTAL_API_KEY")
        if vt_key and vt_key != "your_vt_key":
            sources.append(VirusTotalSource(vt_key))

        otx_key = os.getenv("OTX_API_KEY")
        if otx_key and otx_key != "your_otx_key":
            sources.append(OTXSource(otx_key))

        aggregator = ThreatIntelAggregator(sources)
        result = await aggregator.query_multiple_sources("8.8.8.8", "ip")

        assert result is not None
        assert "ioc" in result
        assert "aggregate_score" in result
        assert "threat_level" in result
        assert "detected_by_count" in result
        assert "total_sources" in result
        assert result["total_sources"] >= 1


@pytest.mark.integration
class TestEndToEndThreatIntel:
    """End-to-end tests for threat intelligence workflow."""

    @pytest.mark.asyncio
    async def test_alert_enrichment_flow(self):
        """Test complete alert enrichment with threat intel."""
        # This test requires running services
        pytest.skip("Requires running services - add to workflow tests")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
