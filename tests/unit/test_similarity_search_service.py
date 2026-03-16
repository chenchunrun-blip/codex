"""Unit tests for Similarity Search service - text conversion, clustering integration."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# Alert to Text Conversion
# ---------------------------------------------------------------------------


class TestAlertToText:
    """Test converting SecurityAlert to text for embedding."""

    def test_basic_alert_to_text(self):
        from services.similarity_search.main import alert_to_text

        alert = SecurityAlert(
            alert_id="SIM-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Trojan detected on workstation",
            source_ip="45.33.32.156",
            target_ip="10.0.0.50",
        )

        text = alert_to_text(alert)

        assert "malware" in text.lower() or "Malware" in text
        assert "high" in text.lower() or "HIGH" in text
        assert "Trojan detected" in text
        assert "45.33.32.156" in text
        assert "10.0.0.50" in text

    def test_minimal_alert_to_text(self):
        from services.similarity_search.main import alert_to_text

        alert = SecurityAlert(
            alert_id="SIM-002",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.ANOMALY,
            severity=Severity.LOW,
            description="Unusual traffic pattern",
        )

        text = alert_to_text(alert)

        assert "anomaly" in text.lower() or "Anomaly" in text
        assert "Unusual traffic pattern" in text
        # No IPs, hash, URL should not cause issues
        assert "None" not in text

    def test_alert_with_file_hash(self):
        from services.similarity_search.main import alert_to_text

        alert = SecurityAlert(
            alert_id="SIM-003",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.CRITICAL,
            description="Malware hash detected",
            file_hash="a" * 64,
        )

        text = alert_to_text(alert)
        assert "a" * 64 in text

    def test_alert_with_url(self):
        from services.similarity_search.main import alert_to_text

        alert = SecurityAlert(
            alert_id="SIM-004",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.PHISHING,
            severity=Severity.HIGH,
            description="Phishing URL detected",
            url="http://evil.example.com/login",
        )

        text = alert_to_text(alert)
        assert "evil.example.com" in text


# ---------------------------------------------------------------------------
# Clustering Engine (shared module, tested via service)
# ---------------------------------------------------------------------------


class TestClusteringEngine:
    """Test AlertClusteringEngine integration."""

    def test_no_cluster_without_candidates(self):
        """Alert with no candidates returns None (no cluster formed)."""
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.65)

        alert = {
            "alert_id": "CLUST-001",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
            "target_ip": "5.6.7.8",
        }

        cluster = engine.find_or_create_cluster(
            alert=alert,
            candidate_alerts=[],
            vector_similarities=[],
        )

        # No candidates -> no cluster
        assert cluster is None
        assert engine.total_new_clusters == 0

    def test_similar_alerts_cluster_together(self):
        """Two similar alerts with high vector similarity should cluster."""
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.5)

        alert1 = {
            "alert_id": "CLUST-A",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
            "target_ip": "5.6.7.8",
        }

        alert2 = {
            "alert_id": "CLUST-B",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
            "target_ip": "5.6.7.8",
        }

        # First alert with no candidates -> no cluster
        engine.find_or_create_cluster(alert=alert1, candidate_alerts=[], vector_similarities=[])

        # Second alert with first as candidate and high similarity -> new cluster
        cluster2 = engine.find_or_create_cluster(
            alert=alert2,
            candidate_alerts=[alert1],
            vector_similarities=[("CLUST-A", 0.95)],
        )

        assert cluster2 is not None
        assert engine.total_new_clusters == 1

    def test_already_clustered_alert_returns_same_cluster(self):
        """An alert already in a cluster should return that cluster."""
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.5)

        alert1 = {
            "alert_id": "SAME-A",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }
        alert2 = {
            "alert_id": "SAME-B",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }

        engine.find_or_create_cluster(alert1, [], [])
        cluster = engine.find_or_create_cluster(alert2, [alert1], [("SAME-A", 0.9)])

        # Call again for alert2 - should return same cluster
        cluster_again = engine.find_or_create_cluster(alert2, [], [])
        assert cluster_again is not None
        assert cluster_again.cluster_id == cluster.cluster_id

    def test_dissimilar_alerts_not_clustered(self):
        """Alerts with low similarity should not form a cluster."""
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.65)

        alert1 = {
            "alert_id": "DIS-X",
            "alert_type": "malware",
            "severity": "critical",
            "source_ip": "1.2.3.4",
        }
        alert2 = {
            "alert_id": "DIS-Y",
            "alert_type": "phishing",
            "severity": "low",
            "source_ip": "9.8.7.6",
        }

        engine.find_or_create_cluster(alert1, [], [])
        cluster2 = engine.find_or_create_cluster(alert2, [alert1], [("DIS-X", 0.2)])

        # Low similarity -> no cluster for alert2
        assert cluster2 is None

    def test_cluster_stats_initial(self):
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.65)

        stats = engine.get_stats()
        assert stats["total_clusters"] == 0
        assert stats["total_alerts_clustered"] == 0

    def test_cluster_stats_after_clustering(self):
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.5)

        alert1 = {
            "alert_id": "STAT-A",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }
        alert2 = {
            "alert_id": "STAT-B",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }

        engine.find_or_create_cluster(alert1, [], [])
        engine.find_or_create_cluster(alert2, [alert1], [("STAT-A", 0.9)])

        stats = engine.get_stats()
        assert stats["total_clusters"] == 1
        assert stats["total_alerts_clustered"] == 1  # Only alert2 is counted as "clustered"
        assert stats["new_clusters_created"] == 1

    def test_cluster_eviction(self):
        """Clusters with TTL=0 should be evicted immediately."""
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.5, cluster_ttl_hours=0)

        # Create a cluster by clustering two similar alerts
        a1 = {
            "alert_id": "EV-A",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }
        a2 = {
            "alert_id": "EV-B",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }

        engine.find_or_create_cluster(a1, [], [])
        engine.find_or_create_cluster(a2, [a1], [("EV-A", 0.9)])

        assert len(engine.clusters) == 1

        evicted = engine.evict_expired_clusters()
        assert evicted == 1
        assert len(engine.clusters) == 0

    def test_get_cluster(self):
        """get_cluster should return the cluster for a clustered alert."""
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.5)

        a1 = {
            "alert_id": "GET-A",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }
        a2 = {
            "alert_id": "GET-B",
            "alert_type": "malware",
            "severity": "high",
            "source_ip": "1.2.3.4",
        }

        engine.find_or_create_cluster(a1, [], [])
        engine.find_or_create_cluster(a2, [a1], [("GET-A", 0.9)])

        cluster = engine.get_cluster("GET-B")
        assert cluster is not None

    def test_get_cluster_for_unknown_alert(self):
        from shared.clustering import AlertClusteringEngine

        engine = AlertClusteringEngine(similarity_threshold=0.65)
        cluster = engine.get_cluster("NONEXISTENT")
        assert cluster is None
