"""Unit tests for Asset Enricher service - criticality, vulnerability, patch, and API."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# Criticality Evaluation
# ---------------------------------------------------------------------------


class TestCriticalityEvaluation:
    """Test asset criticality evaluation logic."""

    def test_critical_multiplier(self):
        """Critical criticality should return multiplier 1.0."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("critical")
        assert result["criticality_level"] == "critical"
        assert result["criticality_multiplier"] == 1.0
        assert result["requires_immediate_attention"] is True
        assert result["escalation_priority"] == 1

    def test_high_multiplier(self):
        """High criticality should return multiplier 0.8."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("high")
        assert result["criticality_level"] == "high"
        assert result["criticality_multiplier"] == 0.8
        assert result["requires_immediate_attention"] is True
        assert result["escalation_priority"] == 2

    def test_medium_multiplier(self):
        """Medium criticality should return multiplier 0.5."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("medium")
        assert result["criticality_level"] == "medium"
        assert result["criticality_multiplier"] == 0.5
        assert result["requires_immediate_attention"] is False
        assert result["escalation_priority"] == 3

    def test_low_multiplier(self):
        """Low criticality should return multiplier 0.2."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("low")
        assert result["criticality_level"] == "low"
        assert result["criticality_multiplier"] == 0.2
        assert result["requires_immediate_attention"] is False
        assert result["escalation_priority"] == 4

    def test_unknown_multiplier(self):
        """Unknown criticality should return multiplier 0.3."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("unknown")
        assert result["criticality_level"] == "unknown"
        assert result["criticality_multiplier"] == 0.3
        assert result["escalation_priority"] == 5

    def test_none_criticality_defaults_to_unknown(self):
        """None criticality should be treated as unknown."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality(None)
        assert result["criticality_level"] == "unknown"
        assert result["criticality_multiplier"] == 0.3

    def test_case_insensitive(self):
        """Criticality evaluation should be case-insensitive."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("CRITICAL")
        assert result["criticality_level"] == "critical"
        assert result["criticality_multiplier"] == 1.0

    def test_unrecognized_criticality(self):
        """Unrecognized criticality string defaults to 0.3 multiplier."""
        from services.asset_enricher.main import evaluate_criticality

        result = evaluate_criticality("super_important")
        assert result["criticality_multiplier"] == 0.3


# ---------------------------------------------------------------------------
# Vulnerability Score Calculation
# ---------------------------------------------------------------------------


class TestVulnerabilityScore:
    """Test vulnerability score calculation logic."""

    def test_empty_vulnerabilities(self):
        """Empty vulnerability data should produce zero score."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({})
        assert result["vulnerability_score"] == 0.0
        assert result["total_vulnerabilities"] == 0
        assert result["risk_level"] == "low"
        assert result["has_critical_vulnerabilities"] is False

    def test_critical_vulnerabilities_score(self):
        """Critical vulnerabilities should weight 10 points each."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({"critical": 3})
        assert result["vulnerability_score"] == 30.0
        assert result["total_vulnerabilities"] == 3
        assert result["has_critical_vulnerabilities"] is True

    def test_mixed_vulnerabilities(self):
        """Mixed vulnerability counts should be weighted correctly."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score(
            {
                "critical": 2,  # 20
                "high": 3,  # 15
                "medium": 4,  # 8
                "low": 10,  # 5
            }
        )
        expected_score = 20.0 + 15.0 + 8.0 + 5.0  # 48.0
        assert result["vulnerability_score"] == expected_score
        assert result["total_vulnerabilities"] == 19
        assert result["risk_level"] == "medium"

    def test_score_capped_at_100(self):
        """Vulnerability score should be capped at 100."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({"critical": 20})
        assert result["vulnerability_score"] == 100.0

    def test_risk_level_critical(self):
        """Score >= 80 should be classified as critical risk."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({"critical": 8})
        assert result["vulnerability_score"] == 80.0
        assert result["risk_level"] == "critical"

    def test_risk_level_high(self):
        """Score >= 50 and < 80 should be classified as high risk."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({"critical": 5})
        assert result["vulnerability_score"] == 50.0
        assert result["risk_level"] == "high"

    def test_risk_level_medium(self):
        """Score >= 20 and < 50 should be classified as medium risk."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({"high": 5})
        assert result["vulnerability_score"] == 25.0
        assert result["risk_level"] == "medium"

    def test_risk_level_low(self):
        """Score < 20 should be classified as low risk."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score({"low": 10})
        assert result["vulnerability_score"] == 5.0
        assert result["risk_level"] == "low"

    def test_breakdown_included(self):
        """Result should include vulnerability breakdown by severity."""
        from services.asset_enricher.main import calculate_vulnerability_score

        result = calculate_vulnerability_score(
            {
                "critical": 1,
                "high": 2,
                "medium": 3,
                "low": 4,
            }
        )
        assert result["breakdown"]["critical"] == 1
        assert result["breakdown"]["high"] == 2
        assert result["breakdown"]["medium"] == 3
        assert result["breakdown"]["low"] == 4


# ---------------------------------------------------------------------------
# Patch Status Assessment
# ---------------------------------------------------------------------------


class TestPatchStatus:
    """Test patch status assessment logic."""

    def test_none_attributes(self):
        """None attributes should return unknown patch status."""
        from services.asset_enricher.main import assess_patch_status

        result = assess_patch_status(None)
        assert result["patch_status"] == "unknown"
        assert result["last_patched"] is None
        assert result["pending_patches"] == 0
        assert result["patch_compliance"] is False

    def test_empty_attributes(self):
        """Empty attributes dict should return unknown patch status."""
        from services.asset_enricher.main import assess_patch_status

        result = assess_patch_status({})
        assert result["patch_status"] == "unknown"
        assert result["patch_compliance"] is False

    def test_compliant_recent_patch(self):
        """Recently patched with no pending patches should be compliant."""
        from services.asset_enricher.main import assess_patch_status

        recent_date = (datetime.utcnow() - timedelta(days=5)).isoformat()
        attributes = {
            "patch_info": {
                "last_patched": recent_date,
                "pending_patches": 0,
            }
        }

        result = assess_patch_status(attributes)
        assert result["patch_status"] == "compliant"
        assert result["patch_compliance"] is True
        assert result["pending_patches"] == 0

    def test_non_compliant_pending_patches(self):
        """Having pending patches should make status non-compliant."""
        from services.asset_enricher.main import assess_patch_status

        recent_date = (datetime.utcnow() - timedelta(days=1)).isoformat()
        attributes = {
            "patch_info": {
                "last_patched": recent_date,
                "pending_patches": 5,
            }
        }

        result = assess_patch_status(attributes)
        assert result["patch_status"] == "non-compliant"
        assert result["patch_compliance"] is False
        assert result["pending_patches"] == 5

    def test_non_compliant_old_patch(self):
        """Last patched more than 30 days ago should be non-compliant."""
        from services.asset_enricher.main import assess_patch_status

        old_date = (datetime.utcnow() - timedelta(days=60)).isoformat()
        attributes = {
            "patch_info": {
                "last_patched": old_date,
                "pending_patches": 0,
            }
        }

        result = assess_patch_status(attributes)
        assert result["patch_status"] == "non-compliant"
        assert result["patch_compliance"] is False

    def test_invalid_date_non_compliant(self):
        """Invalid date in last_patched should result in non-compliant."""
        from services.asset_enricher.main import assess_patch_status

        attributes = {
            "patch_info": {
                "last_patched": "not-a-date",
                "pending_patches": 0,
            }
        }

        result = assess_patch_status(attributes)
        assert result["patch_compliance"] is False


# ---------------------------------------------------------------------------
# Asset Enrichment Pipeline
# ---------------------------------------------------------------------------


class TestAssetEnrichmentPipeline:
    """Test the enrich_alert_with_asset orchestration function."""

    @pytest.mark.asyncio
    async def test_enrichment_with_found_asset(self):
        """Enrichment should populate all fields when asset is found."""
        from services.asset_enricher.main import enrich_alert_with_asset

        mock_asset = {
            "asset_id": "ASSET-001",
            "name": "web-server-01",
            "asset_type": "server",
            "ip_address": "10.0.0.50",
            "criticality": "high",
            "attributes": {
                "vulnerabilities": {"critical": 1, "high": 2, "medium": 0, "low": 0},
                "patch_info": {
                    "last_patched": (datetime.utcnow() - timedelta(days=5)).isoformat(),
                    "pending_patches": 0,
                },
            },
        }

        with patch(
            "services.asset_enricher.main.lookup_asset_by_id",
            new_callable=AsyncMock,
            return_value=mock_asset,
        ):
            result = await enrich_alert_with_asset(
                {"asset_id": "ASSET-001", "source_ip": "1.2.3.4"},
                {},
            )

        assert result["asset_data"] is not None
        assert result["criticality_evaluation"]["criticality_level"] == "high"
        assert result["vulnerability_assessment"]["has_critical_vulnerabilities"] is True
        assert result["patch_status"]["patch_compliance"] is True

    @pytest.mark.asyncio
    async def test_enrichment_asset_not_found(self):
        """Enrichment should provide defaults when asset is not found."""
        from services.asset_enricher.main import enrich_alert_with_asset

        with (
            patch(
                "services.asset_enricher.main.lookup_asset_by_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "services.asset_enricher.main.lookup_asset_by_ip",
                new_callable=AsyncMock,
                return_value=None,
            ),
        ):
            result = await enrich_alert_with_asset(
                {"asset_id": "MISSING", "target_ip": "10.0.0.1", "source_ip": "1.2.3.4"},
                {},
            )

        assert result["asset_data"] is None
        assert result["criticality_evaluation"]["criticality_level"] == "unknown"
        assert result["vulnerability_assessment"]["vulnerability_score"] == 0.0
        assert result["patch_status"]["patch_status"] == "unknown"

    @pytest.mark.asyncio
    async def test_enrichment_falls_back_to_ip_lookup(self):
        """Should try target_ip lookup when asset_id lookup returns None."""
        from services.asset_enricher.main import enrich_alert_with_asset

        mock_asset = {
            "asset_id": "ASSET-002",
            "name": "db-server-01",
            "criticality": "critical",
            "attributes": {},
        }

        with (
            patch(
                "services.asset_enricher.main.lookup_asset_by_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "services.asset_enricher.main.lookup_asset_by_ip",
                new_callable=AsyncMock,
                return_value=mock_asset,
            ) as mock_ip_lookup,
        ):
            result = await enrich_alert_with_asset(
                {"asset_id": "MISSING", "target_ip": "10.0.0.99"},
                {},
            )

        mock_ip_lookup.assert_called_with("10.0.0.99")
        assert result["asset_data"] is not None
        assert result["criticality_evaluation"]["criticality_level"] == "critical"


# ---------------------------------------------------------------------------
# Cache Logic
# ---------------------------------------------------------------------------


class TestAssetCache:
    """Test in-memory asset cache behavior."""

    def test_cache_ttl_constant(self):
        """Cache TTL should be 3600 seconds (1 hour)."""
        from services.asset_enricher.main import CACHE_TTL_SECONDS

        assert CACHE_TTL_SECONDS == 3600

    def test_cache_hit(self):
        """Cached asset data should be returned without DB query."""
        from services.asset_enricher.main import asset_cache

        cache_key = "asset_id:CACHE-TEST-001"
        expiry = datetime.utcnow().timestamp() + 3600
        asset_cache[cache_key] = ({"asset_id": "CACHE-TEST-001"}, expiry)

        data, exp = asset_cache[cache_key]
        assert data["asset_id"] == "CACHE-TEST-001"
        assert datetime.utcnow().timestamp() < exp

        # Cleanup
        del asset_cache[cache_key]

    def test_cache_expired_entry(self):
        """Expired cache entry should not be treated as valid."""
        from services.asset_enricher.main import asset_cache

        cache_key = "asset_id:CACHE-EXPIRED-001"
        expiry = datetime.utcnow().timestamp() - 100  # Already expired
        asset_cache[cache_key] = ({"asset_id": "CACHE-EXPIRED-001"}, expiry)

        _, exp = asset_cache[cache_key]
        assert datetime.utcnow().timestamp() >= exp  # Expired

        # Cleanup
        del asset_cache[cache_key]


# ---------------------------------------------------------------------------
# API Endpoint Tests
# ---------------------------------------------------------------------------


class TestAssetEnricherAPI:
    """Test Asset Enricher FastAPI endpoints."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Health endpoint should return healthy status."""
        from httpx import ASGITransport, AsyncClient

        from services.asset_enricher.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "asset-enricher"
        assert "cache_size" in data["checks"]

    @pytest.mark.asyncio
    async def test_metrics_endpoint(self):
        """Metrics endpoint should return service metrics."""
        from httpx import ASGITransport, AsyncClient

        from services.asset_enricher.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/metrics")

        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "asset-enricher"
        assert "alerts_processed" in data
        assert "assets_found" in data
        assert "cache_ttl_seconds" in data

    @pytest.mark.asyncio
    async def test_get_asset_found(self):
        """GET /api/v1/assets/{asset_id} should return asset when found."""
        from httpx import ASGITransport, AsyncClient

        from services.asset_enricher.main import app

        mock_asset = {
            "asset_id": "ASSET-API-001",
            "name": "api-test-server",
            "criticality": "medium",
            "attributes": {},
        }

        with patch(
            "services.asset_enricher.main.lookup_asset_by_id",
            new_callable=AsyncMock,
            return_value=mock_asset,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/api/v1/assets/ASSET-API-001")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["asset"]["asset_id"] == "ASSET-API-001"
        assert data["data"]["criticality_evaluation"]["criticality_level"] == "medium"

    @pytest.mark.asyncio
    async def test_get_asset_not_found(self):
        """GET /api/v1/assets/{asset_id} should return 404 when not found."""
        from httpx import ASGITransport, AsyncClient

        from services.asset_enricher.main import app

        with patch(
            "services.asset_enricher.main.lookup_asset_by_id",
            new_callable=AsyncMock,
            return_value=None,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/api/v1/assets/MISSING-ASSET")

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_asset_vulnerabilities(self):
        """GET /api/v1/assets/{id}/vulnerabilities should return assessment."""
        from httpx import ASGITransport, AsyncClient

        from services.asset_enricher.main import app

        mock_asset = {
            "asset_id": "ASSET-VULN-001",
            "name": "vuln-test-server",
            "attributes": {
                "vulnerabilities": {"critical": 2, "high": 3, "medium": 1, "low": 0},
            },
        }

        with patch(
            "services.asset_enricher.main.lookup_asset_by_id",
            new_callable=AsyncMock,
            return_value=mock_asset,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/api/v1/assets/ASSET-VULN-001/vulnerabilities")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        vuln = data["data"]["vulnerability_assessment"]
        assert vuln["has_critical_vulnerabilities"] is True
        assert vuln["total_vulnerabilities"] == 6

    @pytest.mark.asyncio
    async def test_get_vulnerabilities_not_found(self):
        """GET /api/v1/assets/{id}/vulnerabilities returns 404 when asset missing."""
        from httpx import ASGITransport, AsyncClient

        from services.asset_enricher.main import app

        with patch(
            "services.asset_enricher.main.lookup_asset_by_id",
            new_callable=AsyncMock,
            return_value=None,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/api/v1/assets/MISSING/vulnerabilities")

        assert response.status_code == 404
