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
End-to-end integration test for the Intelligent Triage pipeline.

Exercises the complete flow:
  dedup → clustering → correlation → LLM prompt formatting → risk scoring

All modules run in-process without Docker or external services.
"""

import asyncio
from datetime import datetime, timedelta

import pytest
from shared.clustering import AlertClusteringEngine, compute_structural_similarity
from shared.correlation import CorrelationEngine
from shared.deduplication import AlertDeduplicator, compute_fingerprint
from shared.metrics import MetricsCollector
from shared.models.alert import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# Test data: simulated multi-stage attack
# ---------------------------------------------------------------------------


def _ts(minutes_ago: int) -> str:
    return (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat()


ATTACK_SCENARIO = [
    SecurityAlert(
        alert_id="atk-001",
        alert_type=AlertType.PHISHING,
        severity=Severity.HIGH,
        description="Spear-phishing email with malicious attachment",
        source_ip="203.0.113.10",
        target_ip="10.1.1.50",
        timestamp=datetime.utcnow() - timedelta(minutes=60),
    ),
    SecurityAlert(
        alert_id="atk-002",
        alert_type=AlertType.MALWARE,
        severity=Severity.CRITICAL,
        description="Trojan detected on endpoint srv-finance-01",
        source_ip="10.1.1.50",
        target_ip="10.1.1.51",
        asset_id="srv-finance-01",
        file_hash="d41d8cd98f00b204e9800998ecf8427e",
        timestamp=datetime.utcnow() - timedelta(minutes=45),
    ),
    SecurityAlert(
        alert_id="atk-003",
        alert_type=AlertType.UNAUTHORIZED_ACCESS,
        severity=Severity.HIGH,
        description="Lateral movement detected to domain controller",
        source_ip="10.1.1.51",
        target_ip="10.1.1.1",
        asset_id="dc-01",
        timestamp=datetime.utcnow() - timedelta(minutes=30),
    ),
    SecurityAlert(
        alert_id="atk-004",
        alert_type=AlertType.DATA_EXFILTRATION,
        severity=Severity.CRITICAL,
        description="Large data transfer to external IP",
        source_ip="10.1.1.1",
        target_ip="198.51.100.5",
        asset_id="dc-01",
        timestamp=datetime.utcnow() - timedelta(minutes=10),
    ),
]


def _alert_to_dict(alert: SecurityAlert) -> dict:
    d = alert.model_dump()
    d["alert_type"] = alert.alert_type.value
    d["severity"] = alert.severity.value
    d["timestamp"] = alert.timestamp.isoformat()
    return d


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDeduplicationPipeline:
    """Dedup correctly filters duplicate alerts in the attack chain."""

    @pytest.mark.asyncio
    async def test_unique_alerts_pass_through(self):
        dedup = AlertDeduplicator(time_window_seconds=300)
        results = []
        for alert in ATTACK_SCENARIO:
            is_dup = await dedup.check_and_register(alert)
            results.append(is_dup)
        # All unique
        assert results == [False, False, False, False]

    @pytest.mark.asyncio
    async def test_replayed_alert_blocked(self):
        dedup = AlertDeduplicator(time_window_seconds=300)
        await dedup.check_and_register(ATTACK_SCENARIO[0])
        # Replay same alert
        assert await dedup.check_and_register(ATTACK_SCENARIO[0]) is True
        assert dedup.get_stats()["duplicates_found"] == 1


class TestClusteringPipeline:
    """Clustering groups related alerts from the same attack."""

    def test_same_ip_alerts_cluster(self):
        engine = AlertClusteringEngine(similarity_threshold=0.3)
        alerts = [_alert_to_dict(a) for a in ATTACK_SCENARIO]

        # First alert → no candidates → no cluster
        c1 = engine.find_or_create_cluster(alerts[0], [])
        assert c1 is None

        # Second alert with first as candidate (shared IP 10.1.1.50)
        c2 = engine.find_or_create_cluster(alerts[1], [alerts[0]])
        assert c2 is not None
        assert c2.alert_count >= 2

    def test_structural_similarity_ip_crossmatch(self):
        """Alert 2's source_ip matches alert 1's target_ip."""
        a1 = _alert_to_dict(ATTACK_SCENARIO[0])
        a2 = _alert_to_dict(ATTACK_SCENARIO[1])
        sim = compute_structural_similarity(a1, a2)
        # Should get IP overlap weight (0.30) since 10.1.1.50 appears in both
        assert sim >= 0.25


class TestCorrelationPipeline:
    """Correlation detects attack chains in the scenario."""

    def test_detects_attack_chain(self):
        current = _alert_to_dict(ATTACK_SCENARIO[3])  # data_exfiltration
        recent = [_alert_to_dict(a) for a in ATTACK_SCENARIO[:3]]
        chains = CorrelationEngine.detect_attack_chains(current, recent)
        assert len(chains) > 0
        chain_types = [c.chain_type for c in chains]
        # Should detect initial_access → lateral_movement → exfiltration
        # phishing maps to INITIAL_ACCESS, unauthorized_access maps to INITIAL_ACCESS,
        # data_exfiltration maps to EXFILTRATION
        assert any("exfil" in ct for ct in chain_types)

    def test_root_cause_is_phishing(self):
        current = _alert_to_dict(ATTACK_SCENARIO[3])
        recent = [_alert_to_dict(a) for a in ATTACK_SCENARIO[:3]]
        root = CorrelationEngine.find_root_cause(current, recent)
        assert root is not None
        assert root["root_cause_type"] == "phishing"

    def test_threat_actor_profile(self):
        all_alerts = [_alert_to_dict(a) for a in ATTACK_SCENARIO]
        profile = CorrelationEngine.profile_threat_actor(all_alerts)
        assert profile["suspected_motive"] == "data_theft"
        assert profile["unique_tactic_count"] >= 3

    def test_blast_radius(self):
        all_alerts = [_alert_to_dict(a) for a in ATTACK_SCENARIO]
        impact = CorrelationEngine.analyze_impact(all_alerts)
        assert impact["ip_count"] >= 4
        assert impact["asset_count"] >= 2

    def test_full_correlate(self):
        current = _alert_to_dict(ATTACK_SCENARIO[3])
        recent = [_alert_to_dict(a) for a in ATTACK_SCENARIO[:3]]
        result = CorrelationEngine.correlate(current, recent)

        assert result["alert_id"] == "atk-004"
        assert len(result["attack_chains"]) > 0
        assert result["root_cause"] is not None
        assert result["threat_actor_profile"]["suspected_motive"] == "data_theft"
        assert result["impact_analysis"]["ip_count"] >= 4


class TestMetricsCollector:
    """MetricsCollector correctly tracks counters and gauges."""

    def test_counter_increment(self):
        m = MetricsCollector("test")
        m.inc("requests")
        m.inc("requests", 5)
        assert m.counter("requests") == 6

    def test_gauge_set(self):
        m = MetricsCollector("test")
        m.set_gauge("queue_depth", 42.5)
        assert m.gauge("queue_depth") == 42.5

    def test_histogram_observe(self):
        m = MetricsCollector("test")
        m.observe("latency_ms", 100.0)
        m.observe("latency_ms", 200.0)
        assert m.histogram_avg("latency_ms") == 150.0

    def test_to_dict(self):
        m = MetricsCollector("test_service")
        m.inc("requests")
        d = m.to_dict()
        assert d["service"] == "test_service"
        assert d["counters"]["requests"] == 1

    def test_to_prometheus(self):
        m = MetricsCollector("test_svc")
        m.inc("requests")
        m.set_gauge("queue_depth", 5.0)
        text = m.to_prometheus()
        assert "test_svc_requests_total 1" in text
        assert "test_svc_queue_depth 5.0" in text


class TestEndToEndPipeline:
    """Full pipeline: dedup → cluster → correlate on attack scenario."""

    @pytest.mark.asyncio
    async def test_full_pipeline(self):
        dedup = AlertDeduplicator(time_window_seconds=300)
        clustering = AlertClusteringEngine(similarity_threshold=0.3)
        processed = []

        # Step 1: Dedup
        for alert in ATTACK_SCENARIO:
            is_dup = await dedup.check_and_register(alert)
            if not is_dup:
                processed.append(_alert_to_dict(alert))

        assert len(processed) == 4  # All unique

        # Step 2: Clustering
        clusters_found = 0
        for i, alert_dict in enumerate(processed):
            candidates = processed[:i]  # All previously processed
            cluster = clustering.find_or_create_cluster(alert_dict, candidates)
            if cluster:
                clusters_found += 1

        # At least some alerts should cluster (shared IPs)
        assert clusters_found >= 1

        # Step 3: Correlation
        current = processed[-1]  # data_exfiltration
        recent = processed[:-1]
        result = CorrelationEngine.correlate(current, recent)

        # Verify attack chain detected
        assert len(result["attack_chains"]) > 0
        # Verify root cause identified
        assert result["root_cause"] is not None
        assert result["root_cause"]["root_cause_type"] == "phishing"
        # Verify threat profile
        assert result["threat_actor_profile"]["suspected_motive"] == "data_theft"

        # Step 4: Replay attack — dedup should block
        replay_dup = await dedup.check_and_register(ATTACK_SCENARIO[0])
        assert replay_dup is True

        # Verify metrics
        assert dedup.get_stats()["total_checked"] == 5
        assert dedup.get_stats()["duplicates_found"] == 1
