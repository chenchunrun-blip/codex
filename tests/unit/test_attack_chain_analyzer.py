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

"""Unit tests for the Attack Chain Analyzer service."""

import os
import sys

import pytest

# Ensure services directory is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "services"))

from attack_chain_analyzer.main import (
    ALERT_TYPE_TECHNIQUE_MAP,
    KILL_CHAIN_STAGES,
    KILL_CHAIN_TRANSITIONS,
    MITRE_TECHNIQUES,
    _add_ioc_technique,
    classify_kill_chain_stage,
    extract_ttps,
    predict_next_steps,
)


@pytest.mark.unit
class TestMITRETechniqueMapping:
    """Tests for the MITRE ATT&CK technique database."""

    def test_techniques_have_required_fields(self):
        for tech_id, tech in MITRE_TECHNIQUES.items():
            assert "name" in tech, f"{tech_id} missing 'name'"
            assert "tactic" in tech, f"{tech_id} missing 'tactic'"
            assert "kill_chain_stage" in tech, f"{tech_id} missing 'kill_chain_stage'"
            assert "indicators" in tech, f"{tech_id} missing 'indicators'"
            assert len(tech["indicators"]) > 0, f"{tech_id} needs indicators"

    def test_kill_chain_stages_are_valid(self):
        valid_stages = set(KILL_CHAIN_STAGES.keys())
        for tech_id, tech in MITRE_TECHNIQUES.items():
            assert tech["kill_chain_stage"] in valid_stages

    def test_alert_type_techniques_exist(self):
        for alert_type, tech_ids in ALERT_TYPE_TECHNIQUE_MAP.items():
            for tech_id in tech_ids:
                base_id = tech_id.split(".")[0]
                assert base_id in MITRE_TECHNIQUES or tech_id in MITRE_TECHNIQUES


@pytest.mark.unit
class TestKillChainClassification:
    """Tests for kill chain stage classification."""

    def test_malware_classification(self):
        result = classify_kill_chain_stage(
            alert_type="malware",
            description="Malware detected: trojan installed on workstation",
        )
        assert result["primary_stage"] in (
            "installation",
            "command_and_control",
            "actions_on_objectives",
        )
        assert 0 <= result["confidence"] <= 1.0

    def test_phishing_classification(self):
        result = classify_kill_chain_stage(
            alert_type="phishing",
            description="Phishing email with malicious attachment detected",
        )
        assert result["primary_stage"] == "delivery"

    def test_brute_force_classification(self):
        result = classify_kill_chain_stage(
            alert_type="brute_force",
            description="Multiple failed login attempts from external IP",
        )
        assert result["primary_stage"] == "exploitation"

    def test_data_exfiltration_classification(self):
        result = classify_kill_chain_stage(
            alert_type="data_exfiltration",
            description="Large data transfer to external server, possible data exfiltration",
        )
        assert result["primary_stage"] == "actions_on_objectives"

    def test_scan_as_reconnaissance(self):
        result = classify_kill_chain_stage(
            alert_type="anomaly",
            description="Port scan detected from external IP, enumerating services",
        )
        assert result["primary_stage"] == "reconnaissance"

    def test_c2_as_command_and_control(self):
        result = classify_kill_chain_stage(
            alert_type="anomaly",
            description="Beacon detected: periodic c2 callback to external server",
        )
        assert result["primary_stage"] == "command_and_control"

    def test_classification_with_matched_techniques(self):
        result = classify_kill_chain_stage(
            alert_type="anomaly",
            description="Suspicious activity detected",
            matched_techniques=["T1595", "T1046"],
        )
        assert result["primary_stage"] == "reconnaissance"

    def test_classification_with_iocs(self):
        result = classify_kill_chain_stage(
            alert_type="anomaly",
            description="Unknown activity",
            iocs={"file_hashes": ["abc123"], "urls": ["http://evil.com"]},
        )
        assert result["stage_scores"]

    def test_classification_returns_required_fields(self):
        result = classify_kill_chain_stage(alert_type="malware", description="Test")
        for field in (
            "primary_stage",
            "stage_name",
            "stage_order",
            "stage_description",
            "confidence",
            "secondary_stages",
            "stage_scores",
            "reasoning",
        ):
            assert field in result

    def test_empty_description_handled(self):
        result = classify_kill_chain_stage(alert_type="malware", description="")
        assert result["primary_stage"] is not None

    def test_unknown_alert_type_handled(self):
        result = classify_kill_chain_stage(
            alert_type="unknown_type",
            description="Some suspicious activity with exploit attempt",
        )
        assert result["primary_stage"] is not None


@pytest.mark.unit
class TestTTPExtraction:
    """Tests for TTP extraction from alert data."""

    def test_malware_ttp_extraction(self):
        result = extract_ttps(alert_type="malware", description="Trojan detected", severity="high")
        assert result["technique_count"] > 0
        assert result["tactic_count"] > 0

    def test_phishing_ttp_extraction(self):
        result = extract_ttps(
            alert_type="phishing",
            description="Spear-phishing email with malicious link",
            severity="medium",
        )
        assert any("Initial Access" in t for t in result["tactics"])

    def test_brute_force_ttp_extraction(self):
        result = extract_ttps(
            alert_type="brute_force",
            description="Brute force password attack against SSH",
            severity="high",
        )
        technique_ids = [t["technique_id"] for t in result["techniques"]]
        assert "T1110" in technique_ids

    def test_data_exfiltration_ttp_extraction(self):
        result = extract_ttps(
            alert_type="data_exfiltration",
            description="Large outbound data transfer to external server",
            severity="critical",
        )
        technique_ids = [t["technique_id"] for t in result["techniques"]]
        assert any(t in technique_ids for t in ["T1041", "T1048", "T1567"])

    def test_file_hash_ioc_adds_techniques(self):
        result = extract_ttps(
            alert_type="anomaly",
            description="Suspicious file",
            severity="medium",
            file_hash="abc123",
        )
        technique_ids = [t["technique_id"] for t in result["techniques"]]
        assert "T1204" in technique_ids or "T1105" in technique_ids

    def test_url_ioc_adds_techniques(self):
        result = extract_ttps(
            alert_type="anomaly",
            description="Connection to suspicious URL",
            severity="medium",
            url="http://malicious.com/payload",
        )
        technique_ids = [t["technique_id"] for t in result["techniques"]]
        assert "T1071" in technique_ids

    def test_techniques_sorted_by_confidence(self):
        result = extract_ttps(
            alert_type="malware",
            description="Malware trojan installed with rootkit persistence",
            severity="critical",
        )
        techniques = result["techniques"]
        if len(techniques) > 1:
            for i in range(len(techniques) - 1):
                assert techniques[i]["confidence"] >= techniques[i + 1]["confidence"]

    def test_techniques_deduplicated(self):
        result = extract_ttps(
            alert_type="malware",
            description="Malware with backdoor persistence",
            severity="high",
            file_hash="abc123",
        )
        ids = [t["technique_id"] for t in result["techniques"]]
        assert len(ids) == len(set(ids))


@pytest.mark.unit
class TestAddIOCTechnique:
    """Tests for the _add_ioc_technique helper."""

    def test_adds_new_technique(self):
        techniques, tactics = [], set()
        _add_ioc_technique(techniques, tactics, "T1204", "test", 0.5)
        assert len(techniques) == 1

    def test_skips_higher_confidence_existing(self):
        techniques = [{"technique_id": "T1204", "confidence": 0.8}]
        tactics = {"Execution"}
        _add_ioc_technique(techniques, tactics, "T1204", "test", 0.5)
        assert len(techniques) == 1
        assert techniques[0]["confidence"] == 0.8

    def test_skips_invalid_technique_id(self):
        techniques, tactics = [], set()
        _add_ioc_technique(techniques, tactics, "T9999", "test", 0.5)
        assert len(techniques) == 0


@pytest.mark.unit
class TestNextStepPrediction:
    """Tests for kill chain next step prediction."""

    def test_reconnaissance_predictions(self):
        result = predict_next_steps("reconnaissance")
        assert len(result["predictions"]) > 0
        stages = [p["next_stage"] for p in result["predictions"]]
        assert "weaponization" in stages or "delivery" in stages

    def test_exploitation_predictions(self):
        result = predict_next_steps("exploitation")
        assert result["predictions"][0]["next_stage"] == "installation"

    def test_all_stages_have_transitions(self):
        for stage in KILL_CHAIN_STAGES:
            result = predict_next_steps(stage)
            assert len(result["predictions"]) > 0

    def test_recommendations_included(self):
        result = predict_next_steps("command_and_control", severity="critical")
        assert "recommendations" in result
        assert len(result["recommendations"]) > 0


@pytest.mark.unit
class TestKillChainStages:
    """Tests for kill chain stage definitions."""

    def test_stages_ordered(self):
        orders = [(s, info["order"]) for s, info in KILL_CHAIN_STAGES.items()]
        orders.sort(key=lambda x: x[1])
        for i in range(len(orders) - 1):
            assert orders[i][1] < orders[i + 1][1]

    def test_stages_have_required_fields(self):
        for stage, info in KILL_CHAIN_STAGES.items():
            for field in ("name", "description", "order", "typical_techniques"):
                assert field in info

    def test_all_transitions_reference_valid_stages(self):
        for from_stage, transitions in KILL_CHAIN_TRANSITIONS.items():
            assert from_stage in KILL_CHAIN_STAGES
            for to_stage, prob, desc in transitions:
                assert to_stage in KILL_CHAIN_STAGES
                assert 0 < prob <= 1.0
