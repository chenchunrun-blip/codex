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

"""Unit tests for the CorrelationEngine module."""

from datetime import datetime, timedelta

import pytest
from shared.correlation import (
    ALERT_TYPE_TO_STAGE,
    AttackChain,
    AttackStage,
    CorrelationEngine,
)


def _ts(minutes_ago: int = 0) -> str:
    return (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat()


def _alert(
    alert_id: str,
    alert_type: str,
    severity: str = "high",
    source_ip: str = "10.0.0.1",
    target_ip: str = "10.0.0.2",
    minutes_ago: int = 0,
    **kwargs,
) -> dict:
    d = {
        "alert_id": alert_id,
        "alert_type": alert_type,
        "severity": severity,
        "source_ip": source_ip,
        "target_ip": target_ip,
        "timestamp": _ts(minutes_ago),
    }
    d.update(kwargs)
    return d


# ---------------------------------------------------------------------------
# AttackChain data class
# ---------------------------------------------------------------------------


class TestAttackChain:
    def test_add_stage(self):
        chain = AttackChain("c1", "test")
        chain.add_stage(AttackStage.INITIAL_ACCESS, "a1")
        chain.add_stage(AttackStage.EXECUTION, "a2")
        assert chain.alert_ids == ["a1", "a2"]

    def test_to_dict(self):
        chain = AttackChain("c1", "test")
        chain.add_stage(AttackStage.INITIAL_ACCESS, "a1")
        chain.confidence = 0.8
        d = chain.to_dict()
        assert d["chain_id"] == "c1"
        assert d["confidence"] == 0.8
        assert len(d["stages"]) == 1


# ---------------------------------------------------------------------------
# Attack chain detection
# ---------------------------------------------------------------------------


class TestDetectAttackChains:
    def test_initial_access_to_exfil(self):
        current = _alert("a3", "data_exfiltration", minutes_ago=0)
        recent = [
            _alert("a1", "phishing", minutes_ago=30),
            _alert("a2", "lateral_movement", minutes_ago=15),
        ]
        chains = CorrelationEngine.detect_attack_chains(current, recent)
        chain_types = [c.chain_type for c in chains]
        assert "initial_access_to_exfil" in chain_types

    def test_malware_persistence_chain(self):
        current = _alert("a4", "privilege_escalation", minutes_ago=0)
        recent = [
            _alert("a1", "brute_force", minutes_ago=30),
            _alert("a2", "malware", minutes_ago=20),
            _alert("a3", "persistence", minutes_ago=10),
        ]
        chains = CorrelationEngine.detect_attack_chains(current, recent)
        chain_types = [c.chain_type for c in chains]
        assert "malware_persistence" in chain_types

    def test_no_chain_single_stage(self):
        current = _alert("a1", "malware", minutes_ago=0)
        recent = []
        chains = CorrelationEngine.detect_attack_chains(current, recent)
        assert len(chains) == 0

    def test_worm_propagation_chain(self):
        current = _alert("a3", "ddos", minutes_ago=0)
        recent = [
            _alert("a1", "malware", minutes_ago=20),
            _alert("a2", "lateral_movement", minutes_ago=10),
        ]
        chains = CorrelationEngine.detect_attack_chains(current, recent)
        chain_types = [c.chain_type for c in chains]
        assert "worm_propagation" in chain_types


# ---------------------------------------------------------------------------
# Root cause analysis
# ---------------------------------------------------------------------------


class TestFindRootCause:
    def test_finds_phishing_root_cause(self):
        current = _alert("a3", "data_exfiltration", source_ip="10.0.0.1")
        recent = [
            _alert("a1", "phishing", severity="critical", source_ip="10.0.0.1", minutes_ago=60),
            _alert("a2", "lateral_movement", source_ip="10.0.0.1", minutes_ago=30),
        ]
        result = CorrelationEngine.find_root_cause(current, recent)
        assert result is not None
        assert result["root_cause_type"] == "phishing"
        assert result["root_cause_alert_id"] == "a1"

    def test_no_root_cause_low_severity(self):
        current = _alert("a2", "anomaly", source_ip="10.0.0.1")
        recent = [
            _alert("a1", "phishing", severity="low", source_ip="10.0.0.1", minutes_ago=60),
        ]
        result = CorrelationEngine.find_root_cause(current, recent)
        assert result is None

    def test_no_root_cause_no_ip_overlap(self):
        current = _alert("a2", "malware", source_ip="10.0.0.1")
        recent = [
            _alert(
                "a1",
                "phishing",
                severity="critical",
                source_ip="192.168.1.1",
                target_ip="192.168.1.2",
                minutes_ago=30,
            ),
        ]
        result = CorrelationEngine.find_root_cause(current, recent)
        assert result is None


# ---------------------------------------------------------------------------
# Threat actor profiling
# ---------------------------------------------------------------------------


class TestProfileThreatActor:
    def test_data_theft_motive(self):
        alerts = [
            _alert("a1", "credential_theft"),
            _alert("a2", "data_exfiltration"),
        ]
        profile = CorrelationEngine.profile_threat_actor(alerts)
        assert profile["suspected_motive"] == "data_theft"

    def test_espionage_motive(self):
        alerts = [
            _alert("a1", "persistence"),
            _alert("a2", "lateral_movement"),
            _alert("a3", "malware"),
        ]
        profile = CorrelationEngine.profile_threat_actor(alerts)
        assert profile["suspected_motive"] == "espionage"

    def test_high_sophistication(self):
        alerts = [
            _alert("a1", "persistence"),
            _alert("a2", "privilege_escalation"),
            _alert("a3", "lateral_movement"),
        ]
        profile = CorrelationEngine.profile_threat_actor(alerts)
        assert profile["sophistication"] == "high"

    def test_low_sophistication(self):
        alerts = [_alert("a1", "brute_force")]
        profile = CorrelationEngine.profile_threat_actor(alerts)
        assert profile["sophistication"] == "low"


# ---------------------------------------------------------------------------
# Impact analysis
# ---------------------------------------------------------------------------


class TestAnalyzeImpact:
    def test_blast_radius(self):
        alerts = [
            _alert(
                "a1",
                "malware",
                source_ip="10.0.0.1",
                target_ip="10.0.0.2",
                asset_id="srv-01",
                user_id="user1",
            ),
            _alert(
                "a2",
                "lateral_movement",
                source_ip="10.0.0.2",
                target_ip="10.0.0.3",
                asset_id="srv-02",
                user_id="user2",
            ),
        ]
        impact = CorrelationEngine.analyze_impact(alerts)
        assert impact["ip_count"] == 3
        assert impact["asset_count"] == 2
        assert impact["user_count"] == 2
        assert impact["blast_radius"] == 5  # 3 IPs + 2 assets


# ---------------------------------------------------------------------------
# Full correlation
# ---------------------------------------------------------------------------


class TestCorrelate:
    def test_correlate_returns_all_sections(self):
        current = _alert("a3", "data_exfiltration", source_ip="10.0.0.1")
        recent = [
            _alert("a1", "phishing", severity="critical", source_ip="10.0.0.1", minutes_ago=60),
            _alert("a2", "lateral_movement", source_ip="10.0.0.1", minutes_ago=30),
        ]
        result = CorrelationEngine.correlate(current, recent)
        assert "attack_chains" in result
        assert "root_cause" in result
        assert "threat_actor_profile" in result
        assert "impact_analysis" in result
        assert result["alert_id"] == "a3"


# ---------------------------------------------------------------------------
# ALERT_TYPE_TO_STAGE mapping
# ---------------------------------------------------------------------------


class TestAlertTypeToStage:
    def test_known_types_mapped(self):
        assert ALERT_TYPE_TO_STAGE["phishing"] == AttackStage.INITIAL_ACCESS
        assert ALERT_TYPE_TO_STAGE["malware"] == AttackStage.EXECUTION
        assert ALERT_TYPE_TO_STAGE["data_exfiltration"] == AttackStage.EXFILTRATION
        assert ALERT_TYPE_TO_STAGE["ddos"] == AttackStage.IMPACT

    def test_unknown_type_not_mapped(self):
        assert "unknown_type" not in ALERT_TYPE_TO_STAGE
