"""Unit tests for AI Triage Agent service - prompts, parsing, routing."""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# System Prompt Selection
# ---------------------------------------------------------------------------


class TestSystemPrompts:
    """Test system prompt selection by alert type."""

    def test_malware_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("malware")
        assert "malware" in prompt.lower()
        assert "JSON format" in prompt

    def test_phishing_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("phishing")
        assert "phishing" in prompt.lower()

    def test_brute_force_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("brute_force")
        assert "brute force" in prompt.lower() or "authentication" in prompt.lower()

    def test_data_exfiltration_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("data_exfiltration")
        assert "exfiltration" in prompt.lower() or "data" in prompt.lower()

    def test_intrusion_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("intrusion")
        assert "intrusion" in prompt.lower() or "network" in prompt.lower()

    def test_ddos_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("ddos")
        assert "ddos" in prompt.lower() or "denial" in prompt.lower()

    def test_default_prompt(self):
        from services.ai_triage_agent.main import get_system_prompt

        prompt = get_system_prompt("unknown_type")
        assert "security analyst" in prompt.lower()

    def test_all_prompts_require_json_response(self):
        from services.ai_triage_agent.main import TRIAGE_SYSTEM_PROMPTS

        for alert_type, prompt in TRIAGE_SYSTEM_PROMPTS.items():
            assert "risk_level" in prompt, f"Prompt for {alert_type} missing risk_level"
            assert "confidence" in prompt, f"Prompt for {alert_type} missing confidence"
            assert (
                "recommended_actions" in prompt
            ), f"Prompt for {alert_type} missing recommended_actions"


# ---------------------------------------------------------------------------
# Prompt Building
# ---------------------------------------------------------------------------


class TestPromptBuilding:
    """Test triage prompt construction."""

    def test_basic_prompt(self):
        from services.ai_triage_agent.main import build_triage_prompt

        alert = SecurityAlert(
            alert_id="PROMPT-001",
            timestamp=datetime(2026, 1, 15, 10, 30),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Malware detected on server",
            source_ip="45.33.32.156",
            target_ip="10.0.0.50",
        )

        prompt = build_triage_prompt(alert)

        assert "PROMPT-001" in prompt
        assert "malware" in prompt.lower() or "Malware" in prompt
        assert "high" in prompt.lower() or "HIGH" in prompt
        assert "45.33.32.156" in prompt
        assert "10.0.0.50" in prompt
        assert "Malware detected on server" in prompt

    def test_prompt_with_enrichment(self):
        from services.ai_triage_agent.main import build_triage_prompt

        alert = SecurityAlert(
            alert_id="PROMPT-002",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.CRITICAL,
            description="Test with enrichment",
            source_ip="1.2.3.4",
        )

        enrichment = {
            "source_network": {
                "is_internal": False,
                "reputation_score": 20.0,
                "country": "CN",
            },
            "asset": {
                "asset_name": "web-server-01",
                "asset_type": "server",
                "criticality": "critical",
                "owner": "ops-team",
                "environment": "production",
            },
            "user": {
                "username": "admin",
                "department": "IT",
                "privilege_level": "admin",
                "account_status": "active",
            },
            "threat_intel": {
                "source_ip": {
                    "threat_score": 85.0,
                    "sources_found": 3,
                },
            },
        }

        prompt = build_triage_prompt(alert, enrichment)

        assert "CN" in prompt  # Country
        assert "web-server-01" in prompt  # Asset name
        assert "critical" in prompt.lower()  # Asset criticality
        assert "admin" in prompt  # Username
        assert "85" in prompt  # Threat score

    def test_prompt_with_similar_alerts(self):
        from services.ai_triage_agent.main import build_triage_prompt

        alert = SecurityAlert(
            alert_id="PROMPT-003",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.PHISHING,
            severity=Severity.MEDIUM,
            description="Test similar alerts",
        )

        enrichment = {
            "similar_alerts": {
                "results": [
                    {
                        "alert_id": "HIST-001",
                        "similarity_score": 0.92,
                        "risk_level": "high",
                        "alert_data": {"description": "Previous phishing attempt"},
                    },
                ],
            },
        }

        prompt = build_triage_prompt(alert, enrichment)
        assert "Similar Historical Alerts" in prompt
        assert "HIST-001" in prompt
        assert "92" in prompt  # 0.92 formatted as percentage

    def test_prompt_minimal_alert(self):
        """Prompt should work with minimal alert data."""
        from services.ai_triage_agent.main import build_triage_prompt

        alert = SecurityAlert(
            alert_id="PROMPT-MIN",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.OTHER,
            severity=Severity.INFO,
            description="Minimal",
        )

        prompt = build_triage_prompt(alert)
        assert "PROMPT-MIN" in prompt
        assert "analyze" in prompt.lower() or "assessment" in prompt.lower()


# ---------------------------------------------------------------------------
# LLM Response Parsing
# ---------------------------------------------------------------------------


class TestLLMResponseParsing:
    """Test LLM response parsing and fallback."""

    @pytest.mark.asyncio
    async def test_parse_valid_json_response(self):
        from services.ai_triage_agent.main import parse_llm_response

        llm_response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "risk_level": "high",
                                "confidence": 85,
                                "reasoning": "Multiple IOCs detected",
                                "recommended_actions": [
                                    {
                                        "action": "Block IP",
                                        "priority": "high",
                                        "type": "containment",
                                    }
                                ],
                                "requires_human_review": True,
                                "estimated_impact": "Potential data breach",
                            }
                        )
                    }
                }
            ]
        }

        result = await parse_llm_response(llm_response)

        assert result["risk_level"] == "high"
        assert result["confidence"] == 85
        assert result["reasoning"] == "Multiple IOCs detected"
        assert len(result["recommended_actions"]) == 1
        assert result["requires_human_review"] is True

    @pytest.mark.asyncio
    async def test_parse_non_json_fallback(self):
        """Non-JSON LLM response should use text fallback."""
        from services.ai_triage_agent.main import parse_llm_response

        llm_response = {
            "choices": [
                {"message": {"content": "This is a text analysis without JSON formatting."}}
            ]
        }

        result = await parse_llm_response(llm_response)

        assert result["risk_level"] == "medium"  # Default
        assert result["confidence"] == 50  # Default
        assert result["requires_human_review"] is True
        assert result.get("parsing_error") is True

    @pytest.mark.asyncio
    async def test_parse_missing_required_fields(self):
        """JSON response missing required fields should get defaults."""
        from services.ai_triage_agent.main import parse_llm_response

        llm_response = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "risk_level": "critical",
                                # Missing: confidence, reasoning, recommended_actions
                            }
                        )
                    }
                }
            ]
        }

        result = await parse_llm_response(llm_response)

        assert result["risk_level"] == "critical"
        assert result["confidence"] == 50  # Default
        assert result["reasoning"] is not None  # Default added
        assert len(result["recommended_actions"]) >= 1  # Default action

    @pytest.mark.asyncio
    async def test_parse_empty_choices(self):
        """Empty choices should return error result."""
        from services.ai_triage_agent.main import parse_llm_response

        llm_response = {"choices": []}

        result = await parse_llm_response(llm_response)

        assert result["risk_level"] == "medium"
        assert result["requires_human_review"] is True
        assert result.get("parsing_error") is True

    @pytest.mark.asyncio
    async def test_parse_no_choices_key(self):
        """Response without choices key should return error result."""
        from services.ai_triage_agent.main import parse_llm_response

        result = await parse_llm_response({})

        assert result["requires_human_review"] is True
        assert result.get("parsing_error") is True


# ---------------------------------------------------------------------------
# Complexity Assessment
# ---------------------------------------------------------------------------


class TestComplexityAssessment:
    """Test how triage_alert determines complexity."""

    @pytest.mark.asyncio
    async def test_high_complexity_from_threat_score(self):
        """High threat score should set complexity to 'high'."""
        from services.ai_triage_agent.main import triage_alert

        alert = SecurityAlert(
            alert_id="COMPLEX-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.CRITICAL,
            description="High threat",
            source_ip="45.33.32.156",
        )

        enrichment = {
            "threat_intel": {
                "source_ip": {"threat_score": 90},
            },
        }

        # Mock external calls
        with (
            patch(
                "services.ai_triage_agent.main.query_similar_alerts",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "services.ai_triage_agent.main.get_llm_route_from_router", new_callable=AsyncMock
            ) as mock_router,
            patch("services.ai_triage_agent.main.call_llm_api", new_callable=AsyncMock) as mock_llm,
        ):

            mock_router.return_value = {
                "model": "deepseek-v3",
                "provider": "deepseek",
                "base_url": "http://test",
                "api_key": "test",
            }
            mock_llm.return_value = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "risk_level": "critical",
                                    "confidence": 90,
                                    "reasoning": "test",
                                    "recommended_actions": [],
                                }
                            )
                        }
                    }
                ]
            }

            result = await triage_alert(alert, enrichment)

            # Router should have been called with high complexity
            mock_router.assert_called_once_with("triage", "high")

    @pytest.mark.asyncio
    async def test_high_complexity_from_critical_asset(self):
        """Critical asset should set complexity to 'high'."""
        from services.ai_triage_agent.main import triage_alert

        alert = SecurityAlert(
            alert_id="COMPLEX-002",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Critical asset",
        )

        enrichment = {
            "asset": {"criticality": "critical"},
        }

        with (
            patch(
                "services.ai_triage_agent.main.query_similar_alerts",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch(
                "services.ai_triage_agent.main.get_llm_route_from_router", new_callable=AsyncMock
            ) as mock_router,
            patch("services.ai_triage_agent.main.call_llm_api", new_callable=AsyncMock) as mock_llm,
        ):

            mock_router.return_value = {
                "model": "deepseek-v3",
                "provider": "deepseek",
                "base_url": "http://test",
                "api_key": "test",
            }
            mock_llm.return_value = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "risk_level": "high",
                                    "confidence": 80,
                                    "reasoning": "test",
                                    "recommended_actions": [],
                                }
                            )
                        }
                    }
                ]
            }

            result = await triage_alert(alert, enrichment)
            mock_router.assert_called_once_with("triage", "high")


# ---------------------------------------------------------------------------
# Error Handling
# ---------------------------------------------------------------------------


class TestTriageErrorHandling:
    """Test error handling in triage flow."""

    @pytest.mark.asyncio
    async def test_triage_returns_error_result_on_failure(self):
        """When triage fails, should return safe error result."""
        from services.ai_triage_agent.main import triage_alert

        alert = SecurityAlert(
            alert_id="ERR-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Error test",
        )

        with (
            patch(
                "services.ai_triage_agent.main.query_similar_alerts",
                new_callable=AsyncMock,
                side_effect=Exception("Network error"),
            ),
            patch(
                "services.ai_triage_agent.main.get_llm_route_from_router",
                new_callable=AsyncMock,
                side_effect=Exception("Router down"),
            ),
        ):

            result = await triage_alert(alert, {})

            assert result["alert_id"] == "ERR-001"
            assert result["risk_level"] == "high"  # Default on error
            assert result["requires_human_review"] is True
            assert result.get("processing_error") is True
