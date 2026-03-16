"""Unit tests for Decision Engine service - decision rules, routing, SLA, and API."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# Decision Rules: Priority Determination
# ---------------------------------------------------------------------------


class TestDecisionRules:
    """Test risk-score-to-priority mapping logic."""

    def test_critical_priority_at_90(self):
        """Risk score of 90 should map to critical priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(90) == "critical"

    def test_critical_priority_above_90(self):
        """Risk score above 90 should map to critical priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(95) == "critical"
        assert determine_priority(100) == "critical"

    def test_high_priority_at_70(self):
        """Risk score of 70 should map to high priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(70) == "high"

    def test_high_priority_between_70_and_89(self):
        """Risk scores between 70 and 89 should map to high priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(75) == "high"
        assert determine_priority(89) == "high"
        assert determine_priority(89.9) == "high"

    def test_medium_priority_at_40(self):
        """Risk score of 40 should map to medium priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(40) == "medium"

    def test_medium_priority_between_40_and_69(self):
        """Risk scores between 40 and 69 should map to medium priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(50) == "medium"
        assert determine_priority(69) == "medium"

    def test_low_priority_at_20(self):
        """Risk score of 20 should map to low priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(20) == "low"

    def test_low_priority_between_20_and_39(self):
        """Risk scores between 20 and 39 should map to low priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(25) == "low"
        assert determine_priority(39) == "low"

    def test_info_priority_below_20(self):
        """Risk scores below 20 should map to info priority."""
        from services.decision_engine.main import determine_priority

        assert determine_priority(19) == "info"
        assert determine_priority(10) == "info"
        assert determine_priority(0) == "info"


# ---------------------------------------------------------------------------
# Human Review Determination
# ---------------------------------------------------------------------------


class TestHumanReview:
    """Test human review requirement logic."""

    def test_high_risk_requires_review(self):
        """Risk score >= 70 always requires human review."""
        from services.decision_engine.main import determine_human_review

        assert determine_human_review(70, 0.9, "malware") is True
        assert determine_human_review(95, 0.99, "anomaly") is True

    def test_low_confidence_requires_review(self):
        """Confidence below 0.5 always requires human review."""
        from services.decision_engine.main import determine_human_review

        assert determine_human_review(30, 0.3, "malware") is True
        assert determine_human_review(10, 0.49, "anomaly") is True

    def test_sensitive_type_with_medium_risk_requires_review(self):
        """Sensitive alert types with risk >= 40 require review."""
        from services.decision_engine.main import determine_human_review

        assert determine_human_review(40, 0.9, "data_exfiltration") is True
        assert determine_human_review(50, 0.9, "insider_threat") is True
        assert determine_human_review(60, 0.9, "apt") is True

    def test_sensitive_type_low_risk_no_review(self):
        """Sensitive types with risk < 40 and high confidence do not require review."""
        from services.decision_engine.main import determine_human_review

        assert determine_human_review(30, 0.9, "data_exfiltration") is False

    def test_normal_medium_risk_no_review(self):
        """Normal alert types at medium risk with high confidence do not require review."""
        from services.decision_engine.main import determine_human_review

        assert determine_human_review(50, 0.8, "malware") is False
        assert determine_human_review(60, 0.9, "brute_force") is False

    def test_low_risk_high_confidence_no_review(self):
        """Low risk with high confidence should not require review."""
        from services.decision_engine.main import determine_human_review

        assert determine_human_review(10, 0.95, "anomaly") is False


# ---------------------------------------------------------------------------
# Auto-Close Logic
# ---------------------------------------------------------------------------


class TestAutoClose:
    """Test auto-close candidate determination."""

    def test_auto_close_info_high_confidence(self):
        """Info-level alerts with high confidence can be auto-closed."""
        from services.decision_engine.main import determine_auto_close

        assert determine_auto_close(10, 0.9, "anomaly") is True
        assert determine_auto_close(5, 0.8, "malware") is True

    def test_no_auto_close_risk_too_high(self):
        """Alerts with risk >= 20 should not be auto-closed."""
        from services.decision_engine.main import determine_auto_close

        assert determine_auto_close(20, 0.95, "anomaly") is False
        assert determine_auto_close(50, 0.99, "malware") is False

    def test_no_auto_close_low_confidence(self):
        """Low confidence prevents auto-close even at low risk."""
        from services.decision_engine.main import determine_auto_close

        assert determine_auto_close(10, 0.5, "anomaly") is False
        assert determine_auto_close(5, 0.79, "malware") is False

    def test_no_auto_close_sensitive_types(self):
        """Sensitive alert types are never auto-closed."""
        from services.decision_engine.main import determine_auto_close

        assert determine_auto_close(5, 0.99, "data_exfiltration") is False
        assert determine_auto_close(5, 0.99, "insider_threat") is False
        assert determine_auto_close(5, 0.99, "apt") is False


# ---------------------------------------------------------------------------
# Auto-Escalation
# ---------------------------------------------------------------------------


class TestAutoEscalate:
    """Test auto-escalation determination."""

    def test_critical_risk_escalates(self):
        """Risk >= 90 always auto-escalates."""
        from services.decision_engine.main import determine_auto_escalate

        assert determine_auto_escalate(90, "medium") is True
        assert determine_auto_escalate(95, "low") is True

    def test_critical_severity_high_risk_escalates(self):
        """Critical severity with risk >= 70 escalates."""
        from services.decision_engine.main import determine_auto_escalate

        assert determine_auto_escalate(70, "critical") is True

    def test_high_risk_non_critical_severity_no_escalate(self):
        """High risk with non-critical severity does not auto-escalate."""
        from services.decision_engine.main import determine_auto_escalate

        assert determine_auto_escalate(70, "high") is False
        assert determine_auto_escalate(80, "medium") is False

    def test_low_risk_no_escalate(self):
        """Low risk never auto-escalates."""
        from services.decision_engine.main import determine_auto_escalate

        assert determine_auto_escalate(30, "critical") is False


# ---------------------------------------------------------------------------
# Approval Workflow Levels
# ---------------------------------------------------------------------------


class TestApprovalLevels:
    """Test approval level determination."""

    def test_critical_approval_at_90(self):
        """Risk >= 90 requires critical (director) approval."""
        from services.decision_engine.main import APPROVAL_LEVELS, determine_approval_level

        level = determine_approval_level(90)
        assert level == "critical"
        assert APPROVAL_LEVELS[level]["approver_role"] == "director"
        assert APPROVAL_LEVELS[level]["timeout_minutes"] == 10

    def test_high_approval_at_70(self):
        """Risk >= 70 requires high (manager) approval."""
        from services.decision_engine.main import APPROVAL_LEVELS, determine_approval_level

        level = determine_approval_level(70)
        assert level == "high"
        assert APPROVAL_LEVELS[level]["approver_role"] == "manager"
        assert APPROVAL_LEVELS[level]["timeout_minutes"] == 15

    def test_medium_approval_at_40(self):
        """Risk >= 40 requires medium (team_lead) approval."""
        from services.decision_engine.main import APPROVAL_LEVELS, determine_approval_level

        level = determine_approval_level(50)
        assert level == "medium"
        assert APPROVAL_LEVELS[level]["approver_role"] == "team_lead"

    def test_low_approval_auto(self):
        """Risk < 40 is auto-approved."""
        from services.decision_engine.main import APPROVAL_LEVELS, determine_approval_level

        level = determine_approval_level(20)
        assert level == "low"
        assert APPROVAL_LEVELS[level]["approver_role"] == "auto"
        assert APPROVAL_LEVELS[level]["timeout_minutes"] == 0


# ---------------------------------------------------------------------------
# Analyst Routing (Skill-Based Matching)
# ---------------------------------------------------------------------------


class TestAnalystRouting:
    """Test skill-based analyst selection and workload balancing."""

    def _reset_analyst_pool(self):
        """Reset analyst pool to default state before each test."""
        from services.decision_engine.main import ANALYST_POOL

        for analyst in ANALYST_POOL:
            analyst["active_tasks"] = 0
            analyst["available"] = True

    def test_skill_match_preferred(self):
        """Analyst with matching skill should be preferred."""
        from services.decision_engine.main import select_analyst

        self._reset_analyst_pool()

        # Analyst 1 has "malware" skill
        selected = select_analyst("malware", "medium")
        assert selected is not None
        assert "malware" in selected["skills"]

        self._reset_analyst_pool()

    def test_tier_bonus_for_high_priority(self):
        """Higher-tier analysts preferred for critical/high priority alerts."""
        from services.decision_engine.main import ANALYST_POOL, select_analyst

        self._reset_analyst_pool()

        selected = select_analyst("malware", "critical")
        assert selected is not None
        # Analyst 5 (tier3) or Analyst 3 (tier2) should be preferred for critical
        assert selected["team"] in ("soc-tier2", "soc-tier3")

        self._reset_analyst_pool()

    def test_no_analyst_when_all_at_capacity(self):
        """Returns None when all analysts are at maximum capacity."""
        from services.decision_engine.main import ANALYST_POOL, select_analyst

        self._reset_analyst_pool()

        for analyst in ANALYST_POOL:
            analyst["active_tasks"] = analyst["max_tasks"]

        selected = select_analyst("malware", "medium")
        assert selected is None

        self._reset_analyst_pool()

    def test_no_analyst_when_all_unavailable(self):
        """Returns None when all analysts are unavailable."""
        from services.decision_engine.main import ANALYST_POOL, select_analyst

        self._reset_analyst_pool()

        for analyst in ANALYST_POOL:
            analyst["available"] = False

        selected = select_analyst("malware", "medium")
        assert selected is None

        self._reset_analyst_pool()

    def test_workload_incremented(self):
        """Selected analyst's active_tasks should be incremented."""
        from services.decision_engine.main import ANALYST_POOL, select_analyst

        self._reset_analyst_pool()

        selected = select_analyst("malware", "medium")
        assert selected is not None
        assert selected["active_tasks"] == 1

        self._reset_analyst_pool()


# ---------------------------------------------------------------------------
# SLA Deadline Calculation and Breach Detection
# ---------------------------------------------------------------------------


class TestSLA:
    """Test SLA deadline calculation and breach detection."""

    def test_sla_deadlines_critical(self):
        """Critical SLA: 5-minute response, 30-minute resolve."""
        from services.decision_engine.main import calculate_sla_deadline

        now = datetime(2026, 1, 1, 12, 0, 0)
        deadlines = calculate_sla_deadline("critical", now)

        assert deadlines["response_deadline"] == now + timedelta(minutes=5)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=30)

    def test_sla_deadlines_high(self):
        """High SLA: 15-minute response, 120-minute resolve."""
        from services.decision_engine.main import calculate_sla_deadline

        now = datetime(2026, 1, 1, 12, 0, 0)
        deadlines = calculate_sla_deadline("high", now)

        assert deadlines["response_deadline"] == now + timedelta(minutes=15)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=120)

    def test_sla_deadlines_medium(self):
        """Medium SLA: 60-minute response, 480-minute resolve."""
        from services.decision_engine.main import calculate_sla_deadline

        now = datetime(2026, 1, 1, 12, 0, 0)
        deadlines = calculate_sla_deadline("medium", now)

        assert deadlines["response_deadline"] == now + timedelta(minutes=60)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=480)

    def test_sla_breach_detected(self):
        """SLA breach should be detected when deadline has passed."""
        from services.decision_engine.main import check_sla_breach

        created = datetime(2026, 1, 1, 12, 0, 0)
        # 10 minutes later for a critical alert (5-min response SLA)
        now = created + timedelta(minutes=10)

        result = check_sla_breach("critical", created, now)
        assert result["response_breached"] is True
        assert result["needs_escalation"] is True

    def test_sla_no_breach_within_window(self):
        """No SLA breach when still within deadline window."""
        from services.decision_engine.main import check_sla_breach

        created = datetime(2026, 1, 1, 12, 0, 0)
        now = created + timedelta(minutes=2)  # Within 5-min response window

        result = check_sla_breach("critical", created, now)
        assert result["response_breached"] is False
        assert result["resolve_breached"] is False
        assert result["needs_escalation"] is False

    def test_sla_remaining_seconds_positive(self):
        """Remaining seconds should be positive when within SLA window."""
        from services.decision_engine.main import check_sla_breach

        created = datetime(2026, 1, 1, 12, 0, 0)
        now = created + timedelta(minutes=2)

        result = check_sla_breach("critical", created, now)
        assert result["response_remaining_seconds"] > 0
        assert result["resolve_remaining_seconds"] > 0

    def test_sla_remaining_clamped_to_zero(self):
        """Remaining seconds should be zero (not negative) after breach."""
        from services.decision_engine.main import check_sla_breach

        created = datetime(2026, 1, 1, 12, 0, 0)
        now = created + timedelta(hours=2)  # Well past all deadlines

        result = check_sla_breach("critical", created, now)
        assert result["response_remaining_seconds"] == 0
        assert result["resolve_remaining_seconds"] == 0

    def test_sla_unknown_priority_defaults_to_medium(self):
        """Unknown priority should default to medium SLA config."""
        from services.decision_engine.main import calculate_sla_deadline

        now = datetime(2026, 1, 1, 12, 0, 0)
        deadlines = calculate_sla_deadline("unknown_priority", now)

        assert deadlines["response_deadline"] == now + timedelta(minutes=60)
        assert deadlines["resolve_deadline"] == now + timedelta(minutes=480)


# ---------------------------------------------------------------------------
# Core make_decision Integration
# ---------------------------------------------------------------------------


class TestMakeDecision:
    """Test the core make_decision orchestration function."""

    def _reset_state(self):
        """Reset global state for clean test runs."""
        from services.decision_engine import main as de

        de.decisions_made.clear()
        de.pending_approvals.clear()
        de.escalation_timers.clear()
        for analyst in de.ANALYST_POOL:
            analyst["active_tasks"] = 0
            analyst["available"] = True

    @pytest.mark.asyncio
    async def test_critical_decision(self):
        """Critical risk score produces correct decision structure."""
        from services.decision_engine.main import make_decision

        self._reset_state()

        decision = await make_decision(
            alert_id="ALT-CRIT-001",
            risk_score=95,
            confidence=0.9,
            alert_type="malware",
            severity="critical",
        )

        assert decision["priority"] == "critical"
        assert decision["requires_human_review"] is True
        assert decision["auto_escalate"] is True
        assert decision["approval"]["level"] == "critical"
        assert decision["routing"]["assigned_analyst"] is not None
        assert decision["sla"]["response_minutes"] == 5

        self._reset_state()

    @pytest.mark.asyncio
    async def test_auto_close_decision(self):
        """Low-risk alert with high confidence triggers auto-close."""
        from services.decision_engine.main import make_decision

        self._reset_state()

        decision = await make_decision(
            alert_id="ALT-LOW-001",
            risk_score=5,
            confidence=0.95,
            alert_type="anomaly",
        )

        assert decision["priority"] == "info"
        assert decision["auto_close"] is True
        assert decision["routing"]["assigned_analyst"] is None
        assert any(a["type"] == "auto_close" for a in decision["actions"])

        self._reset_state()

    @pytest.mark.asyncio
    async def test_decision_tracked(self):
        """Decision should be stored in decisions_made dict."""
        from services.decision_engine.main import decisions_made, make_decision

        self._reset_state()

        await make_decision(
            alert_id="ALT-TRACK-001",
            risk_score=50,
            confidence=0.8,
            alert_type="brute_force",
        )

        assert "ALT-TRACK-001" in decisions_made

        self._reset_state()


# ---------------------------------------------------------------------------
# API Endpoint Tests
# ---------------------------------------------------------------------------


class TestDecisionAPI:
    """Test Decision Engine FastAPI endpoints."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Health endpoint should return healthy status."""
        from httpx import ASGITransport, AsyncClient

        from services.decision_engine.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "decision-engine"

    @pytest.mark.asyncio
    async def test_decide_endpoint_post(self):
        """POST /api/v1/decide/{alert_id} should return a decision."""
        from httpx import ASGITransport, AsyncClient

        from services.decision_engine import main as de

        # Reset state
        de.decisions_made.clear()
        de.escalation_timers.clear()
        for analyst in de.ANALYST_POOL:
            analyst["active_tasks"] = 0
            analyst["available"] = True

        with patch.object(de, "persist_decision_to_db", new_callable=AsyncMock):
            async with AsyncClient(
                transport=ASGITransport(app=de.app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/v1/decide/ALT-API-001",
                    json={
                        "alert_id": "ALT-API-001",
                        "risk_score": 75,
                        "confidence": 0.85,
                        "alert_type": "malware",
                        "severity": "high",
                        "asset_criticality": "high",
                    },
                )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["priority"] == "high"
        assert data["data"]["requires_human_review"] is True

        # Cleanup
        de.decisions_made.clear()
        de.escalation_timers.clear()
        for analyst in de.ANALYST_POOL:
            analyst["active_tasks"] = 0
            analyst["available"] = True

    @pytest.mark.asyncio
    async def test_decide_endpoint_get_not_found(self):
        """GET /api/v1/decide/{alert_id} returns 404 for unknown alert."""
        from httpx import ASGITransport, AsyncClient

        from services.decision_engine.main import app, decisions_made

        decisions_made.clear()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/decide/ALT-NONEXISTENT")

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rules_endpoint(self):
        """GET /api/v1/rules should list decision rules."""
        from httpx import ASGITransport, AsyncClient

        from services.decision_engine.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/rules")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["rules"]) > 0
        assert "sla_config" in data["data"]
        assert "approval_levels" in data["data"]

    @pytest.mark.asyncio
    async def test_metrics_endpoint(self):
        """GET /metrics should return decision metrics."""
        from httpx import ASGITransport, AsyncClient

        from services.decision_engine.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/metrics")

        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "decision-engine"
        assert "decisions" in data
