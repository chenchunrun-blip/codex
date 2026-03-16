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

"""Unit tests for the AlertClusteringEngine module."""

import pytest
from shared.clustering import (
    AlertCluster,
    AlertClusteringEngine,
    compute_structural_similarity,
)

# ---------------------------------------------------------------------------
# Structural similarity
# ---------------------------------------------------------------------------


class TestComputeStructuralSimilarity:
    def test_identical_alerts(self):
        a = {
            "alert_type": "malware",
            "source_ip": "10.0.0.1",
            "target_ip": "10.0.0.2",
            "asset_id": "srv-01",
            "file_hash": "abc123",
        }
        score = compute_structural_similarity(a, a)
        assert score == pytest.approx(1.0)

    def test_completely_different(self):
        a = {"alert_type": "malware", "source_ip": "10.0.0.1"}
        b = {"alert_type": "phishing", "source_ip": "192.168.1.1"}
        score = compute_structural_similarity(a, b)
        assert score < 0.3

    def test_same_type_no_ip_overlap(self):
        a = {"alert_type": "malware", "source_ip": "10.0.0.1"}
        b = {"alert_type": "malware", "source_ip": "192.168.1.1"}
        score = compute_structural_similarity(a, b)
        # Same type (0.35/1.0), no IP overlap → 0.35
        assert score == pytest.approx(0.35)

    def test_ip_cross_match(self):
        """source_ip of alert1 matches target_ip of alert2."""
        a = {"alert_type": "phishing", "source_ip": "10.0.0.1"}
        b = {"alert_type": "malware", "target_ip": "10.0.0.1"}
        score = compute_structural_similarity(a, b)
        # Different type, but IP overlap → 0.30/1.0 = 0.30
        assert score == pytest.approx(0.30)


# ---------------------------------------------------------------------------
# AlertCluster
# ---------------------------------------------------------------------------


class TestAlertCluster:
    def test_alert_count(self):
        cluster = AlertCluster("c1", "alert-001")
        assert cluster.alert_count == 1  # primary only
        cluster.add_alert("alert-002")
        assert cluster.alert_count == 2
        cluster.add_alert("alert-002")  # duplicate add
        assert cluster.alert_count == 2

    def test_escalated_severity(self):
        cluster = AlertCluster("c1", "alert-001")
        assert cluster.escalated_severity == "low"
        for i in range(3):
            cluster.add_alert(f"alert-{i+10}")
        assert cluster.escalated_severity == "medium"

    def test_to_dict(self):
        cluster = AlertCluster("c1", "alert-001", cluster_type="malware")
        cluster.add_alert("alert-002")
        d = cluster.to_dict()
        assert d["cluster_id"] == "c1"
        assert d["alert_count"] == 2
        assert "alert-002" in d["related_alert_ids"]


# ---------------------------------------------------------------------------
# AlertClusteringEngine
# ---------------------------------------------------------------------------


class TestAlertClusteringEngine:
    @pytest.fixture
    def engine(self):
        return AlertClusteringEngine(similarity_threshold=0.5)

    def test_no_candidates_returns_none(self, engine):
        alert = {"alert_id": "a1", "alert_type": "malware"}
        result = engine.find_or_create_cluster(alert, [])
        assert result is None

    def test_creates_cluster_when_similar(self, engine):
        alert = {
            "alert_id": "a1",
            "alert_type": "malware",
            "source_ip": "10.0.0.1",
            "asset_id": "srv-01",
        }
        candidates = [
            {
                "alert_id": "a2",
                "alert_type": "malware",
                "source_ip": "10.0.0.1",
                "asset_id": "srv-01",
            },
        ]
        # High structural similarity (same type + same IP + same asset)
        cluster = engine.find_or_create_cluster(alert, candidates)
        assert cluster is not None
        assert cluster.alert_count == 2

    def test_already_clustered_returns_existing(self, engine):
        alert = {
            "alert_id": "a1",
            "alert_type": "malware",
            "source_ip": "10.0.0.1",
            "asset_id": "srv-01",
        }
        candidates = [
            {
                "alert_id": "a2",
                "alert_type": "malware",
                "source_ip": "10.0.0.1",
                "asset_id": "srv-01",
            },
        ]
        c1 = engine.find_or_create_cluster(alert, candidates)
        c2 = engine.find_or_create_cluster(alert, candidates)
        assert c1.cluster_id == c2.cluster_id

    def test_joins_existing_cluster(self, engine):
        # Create a cluster with a1 + a2
        a1 = {
            "alert_id": "a1",
            "alert_type": "malware",
            "source_ip": "10.0.0.1",
            "asset_id": "srv-01",
        }
        candidates_1 = [
            {
                "alert_id": "a2",
                "alert_type": "malware",
                "source_ip": "10.0.0.1",
                "asset_id": "srv-01",
            },
        ]
        engine.find_or_create_cluster(a1, candidates_1)

        # New alert a3 similar to a2 should join the existing cluster
        a3 = {
            "alert_id": "a3",
            "alert_type": "malware",
            "source_ip": "10.0.0.1",
            "asset_id": "srv-01",
        }
        candidates_3 = [
            {
                "alert_id": "a2",
                "alert_type": "malware",
                "source_ip": "10.0.0.1",
                "asset_id": "srv-01",
            },
        ]
        cluster = engine.find_or_create_cluster(a3, candidates_3)
        assert cluster is not None
        assert cluster.alert_count == 3

    def test_vector_similarity_blending(self, engine):
        """Vector similarities should boost the combined score."""
        alert = {"alert_id": "a1", "alert_type": "phishing", "source_ip": "10.0.0.1"}
        candidates = [
            {"alert_id": "a2", "alert_type": "malware", "source_ip": "10.0.0.1"},
        ]
        # Without vector similarity: only IP overlap (0.30) → below threshold 0.5
        c1 = engine.find_or_create_cluster(alert, candidates)
        assert c1 is None

        # With high vector similarity: 0.4*0.30 + 0.6*0.9 = 0.66 → above threshold
        c2 = engine.find_or_create_cluster(alert, candidates, vector_similarities=[("a2", 0.9)])
        assert c2 is not None

    def test_stats(self, engine):
        stats = engine.get_stats()
        assert "total_clusters" in stats
        assert "total_alerts_clustered" in stats
