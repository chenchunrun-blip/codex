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
Unit tests for shared models.

Tests model validation, serialization, and basic functionality.
"""

from datetime import datetime, timedelta

import pytest
from shared.models.alert import (
    AlertBatch,
    AlertFilter,
    AlertStatus,
    AlertType,
    SecurityAlert,
    Severity,
)
from shared.models.context import (
    AssetContext,
    EnrichedContext,
    NetworkContext,
    UserContext,
)
from shared.models.risk import (
    RemediationAction,
    RiskAssessment,
    RiskLevel,
    TriageResult,
)
from shared.models.threat_intel import (
    AggregatedThreatIntel,
    IOCType,
    ThreatIntel,
    ThreatLevel,
)


class TestAlertModels:
    """Test alert-related models."""

    def test_security_alert_creation(self):
        """Test creating a valid security alert."""
        alert = SecurityAlert(
            alert_id="ALT-2025-001",
            timestamp=datetime.utcnow(),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Malware detected",
            source_ip="45.33.32.156",
            target_ip="10.0.0.50",
        )

        assert alert.alert_id == "ALT-2025-001"
        assert alert.alert_type == AlertType.MALWARE
        assert alert.severity == Severity.HIGH

    def test_security_alert_invalid_ip(self):
        """Test that invalid IP addresses are rejected."""
        with pytest.raises(ValueError, match="Invalid IP address"):
            SecurityAlert(
                alert_id="ALT-001",
                timestamp=datetime.utcnow(),
                alert_type=AlertType.MALWARE,
                severity=Severity.HIGH,
                description="Test",
                source_ip="invalid-ip",
            )

    def test_security_alert_invalid_file_hash(self):
        """Test that invalid file hashes are rejected."""
        with pytest.raises(ValueError, match="Invalid file hash"):
            SecurityAlert(
                alert_id="ALT-001",
                timestamp=datetime.utcnow(),
                alert_type=AlertType.MALWARE,
                severity=Severity.HIGH,
                description="Test",
                file_hash="not-a-valid-hash",
            )

    def test_severity_from_score(self):
        """Test converting numeric scores to Severity."""
        assert Severity.from_score(95) == Severity.CRITICAL
        assert Severity.from_score(75) == Severity.HIGH
        assert Severity.from_score(50) == Severity.MEDIUM
        assert Severity.from_score(25) == Severity.LOW
        assert Severity.from_score(10) == Severity.INFO

    def test_alert_filter(self):
        """Test alert filter model."""
        filter_obj = AlertFilter(
            severity=Severity.HIGH,
            status=AlertStatus.NEW,
            start_date=datetime.utcnow() - timedelta(days=7),
        )

        assert filter_obj.severity == Severity.HIGH
        assert filter_obj.status == AlertStatus.NEW


class TestThreatIntelModels:
    """Test threat intelligence models."""

    def test_threat_intel_creation(self):
        """Test creating threat intelligence."""
        intel = ThreatIntel(
            ioc_type=IOCType.FILE_HASH_SHA256,
            ioc_value="5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
            threat_level=ThreatLevel.MALICIOUS,
            confidence=0.95,
            source="virustotal",
            tags=["trojan", "ransomware"],
        )

        assert intel.ioc_type == IOCType.FILE_HASH_SHA256
        assert intel.threat_level == ThreatLevel.MALICIOUS
        assert intel.confidence == 0.95
        assert len(intel.tags) == 2

    def test_aggregated_threat_intel(self):
        """Test aggregated threat intelligence."""
        intel1 = ThreatIntel(
            ioc_type=IOCType.IP_ADDRESS,
            ioc_value="45.33.32.156",
            threat_level=ThreatLevel.MALICIOUS,
            confidence=0.9,
            source="virustotal",
        )

        intel2 = ThreatIntel(
            ioc_type=IOCType.IP_ADDRESS,
            ioc_value="45.33.32.156",
            threat_level=ThreatLevel.MALICIOUS,
            confidence=0.8,
            source="abuse_ch",
        )

        aggregated = AggregatedThreatIntel(
            ioc_type=IOCType.IP_ADDRESS,
            ioc_value="45.33.32.156",
            threat_level=ThreatLevel.MALICIOUS,
            threat_score=85.0,
            sources=[intel1, intel2],
            positive_sources=2,
            total_sources=2,
        )

        assert aggregated.threat_score == 85.0
        assert len(aggregated.sources) == 2
        assert aggregated.positive_sources == 2


class TestContextModels:
    """Test context models."""

    def test_network_context(self):
        """Test network context model."""
        context = NetworkContext(
            ip_address="45.33.32.156",
            is_internal=False,
            is_known_malicious=True,
            reputation_score=15.0,
            country="US",
            city="Dallas",
        )

        assert context.ip_address == "45.33.32.156"
        assert context.is_internal is False
        assert context.is_known_malicious is True

    def test_asset_context(self):
        """Test asset context model."""
        context = AssetContext(
            asset_id="ASSET-001",
            asset_name="WEB-SRV-01",
            asset_type="server",
            criticality="high",
            os_type="Linux",
            vulnerability_count=5,
        )

        assert context.asset_id == "ASSET-001"
        assert context.criticality == "high"
        assert context.vulnerability_count == 5

    def test_enriched_context(self):
        """Test enriched context model."""
        source_network = NetworkContext(
            ip_address="45.33.32.156",
            is_internal=False,
            reputation_score=15.0,
        )

        target_network = NetworkContext(
            ip_address="10.0.0.50",
            is_internal=True,
            reputation_score=80.0,
        )

        enriched = EnrichedContext(
            alert_id="ALT-001",
            source_network=source_network,
            target_network=target_network,
            enrichment_sources=["geoip", "threat_intel"],
        )

        assert enriched.alert_id == "ALT-001"
        assert enriched.source_network is not None
        assert enriched.target_network is not None
        assert len(enriched.enrichment_sources) == 2


class TestRiskModels:
    """Test risk assessment models."""

    def test_risk_level_from_score(self):
        """Test converting scores to risk levels."""
        assert RiskLevel.from_score(95) == RiskLevel.CRITICAL
        assert RiskLevel.from_score(75) == RiskLevel.HIGH
        assert RiskLevel.from_score(50) == RiskLevel.MEDIUM
        assert RiskLevel.from_score(25) == RiskLevel.LOW
        assert RiskLevel.from_score(10) == RiskLevel.INFO

    def test_risk_assessment(self):
        """Test risk assessment model."""
        assessment = RiskAssessment(
            risk_score=75.5,
            risk_level=RiskLevel.HIGH,
            confidence=0.85,
            severity_score=80.0,
            threat_intel_score=70.0,
            asset_criticality_score=75.0,
            exploitability_score=75.0,
            key_factors=["High severity", "Malicious IP"],
            requires_human_review=True,
            review_reason="High risk score",
        )

        assert assessment.risk_score == 75.5
        assert assessment.risk_level == RiskLevel.HIGH
        assert assessment.requires_human_review is True
        assert len(assessment.key_factors) == 2

    def test_remediation_action(self):
        """Test remediation action model."""
        action = RemediationAction(
            action_type="isolate_host",
            priority="immediate",
            title="Isolate host",
            description="Disconnect host from network",
            is_automated=True,
            execution_time_seconds=30,
        )

        assert action.action_type == "isolate_host"
        assert action.priority == "immediate"
        assert action.is_automated is True

    def test_triage_result(self):
        """Test triage result model."""
        risk_assessment = RiskAssessment(
            risk_score=75.5,
            risk_level=RiskLevel.HIGH,
            confidence=0.85,
            requires_human_review=True,
        )

        action = RemediationAction(
            action_type="isolate_host",
            priority="immediate",
            title="Isolate host",
            description="Disconnect from network",
        )

        result = TriageResult(
            alert_id="ALT-001",
            risk_assessment=risk_assessment,
            remediation_actions=[action],
            requires_human_review=True,
            processing_time_ms=2340.5,
        )

        assert result.alert_id == "ALT-001"
        assert result.risk_assessment.risk_score == 75.5
        assert len(result.remediation_actions) == 1
        assert result.requires_human_review is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
