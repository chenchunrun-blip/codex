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
Alert Clustering Module

Groups related alerts into clusters using vector similarity from ChromaDB
and structural similarity from alert metadata.  Clusters are persisted
to PostgreSQL via the shared database layer.
"""

import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from shared.models.alert import AlertType, SecurityAlert, Severity
from shared.utils import get_logger

logger = get_logger(__name__)


class AlertCluster:
    """Represents a cluster of correlated alerts."""

    def __init__(
        self,
        cluster_id: str,
        primary_alert_id: str,
        cluster_type: str = "unknown",
    ):
        self.cluster_id = cluster_id
        self.primary_alert_id = primary_alert_id
        self.related_alert_ids: List[str] = []
        self.cluster_type = cluster_type
        self.confidence: float = 0.0
        self.first_seen: datetime = datetime.utcnow()
        self.last_updated: datetime = datetime.utcnow()

    def add_alert(self, alert_id: str) -> None:
        if alert_id not in self.related_alert_ids and alert_id != self.primary_alert_id:
            self.related_alert_ids.append(alert_id)
            self.last_updated = datetime.utcnow()

    @property
    def alert_count(self) -> int:
        return len(self.related_alert_ids) + 1

    @property
    def escalated_severity(self) -> str:
        """Cluster size influences severity."""
        if self.alert_count > 10:
            return "critical"
        elif self.alert_count > 5:
            return "high"
        elif self.alert_count > 2:
            return "medium"
        return "low"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cluster_id": self.cluster_id,
            "primary_alert_id": self.primary_alert_id,
            "related_alert_ids": self.related_alert_ids,
            "alert_count": self.alert_count,
            "cluster_type": self.cluster_type,
            "confidence": self.confidence,
            "escalated_severity": self.escalated_severity,
            "first_seen": self.first_seen.isoformat(),
            "last_updated": self.last_updated.isoformat(),
        }


def compute_structural_similarity(
    alert1: Dict[str, Any],
    alert2: Dict[str, Any],
) -> float:
    """
    Compute structural similarity between two alerts based on metadata fields.

    Returns a score in [0.0, 1.0].
    """
    score = 0.0
    total_weight = 0.0

    # Alert type match (weight 0.35)
    w = 0.35
    total_weight += w
    if alert1.get("alert_type") == alert2.get("alert_type"):
        score += w

    # IP overlap (weight 0.30) - source/target cross-match
    w = 0.30
    total_weight += w
    ips1 = {alert1.get("source_ip"), alert1.get("target_ip")} - {None, ""}
    ips2 = {alert2.get("source_ip"), alert2.get("target_ip")} - {None, ""}
    if ips1 & ips2:
        score += w

    # Asset match (weight 0.20)
    w = 0.20
    total_weight += w
    a1 = alert1.get("asset_id")
    a2 = alert2.get("asset_id")
    if a1 and a2 and a1 == a2:
        score += w

    # File hash match (weight 0.15)
    w = 0.15
    total_weight += w
    h1 = alert1.get("file_hash")
    h2 = alert2.get("file_hash")
    if h1 and h2 and h1 == h2:
        score += w

    return score / total_weight if total_weight > 0 else 0.0


class AlertClusteringEngine:
    """
    Clusters related alerts using a combination of:
    - Vector similarity from ChromaDB (semantic)
    - Structural similarity from metadata fields

    Results are stored in-memory but can be persisted to the database.
    """

    # Max age for clusters before they are eligible for eviction
    DEFAULT_CLUSTER_TTL_HOURS = 24
    # Max number of clusters before forced eviction
    MAX_CLUSTERS = 5000

    def __init__(
        self,
        similarity_threshold: float = 0.65,
        cluster_ttl_hours: int = DEFAULT_CLUSTER_TTL_HOURS,
    ):
        self.similarity_threshold = similarity_threshold
        self.cluster_ttl = timedelta(hours=cluster_ttl_hours)
        self.clusters: Dict[str, AlertCluster] = {}
        self.alert_to_cluster: Dict[str, str] = {}
        # Metrics
        self.total_clustered = 0
        self.total_new_clusters = 0
        self.total_evicted = 0

    def find_or_create_cluster(
        self,
        alert: Dict[str, Any],
        candidate_alerts: List[Dict[str, Any]],
        vector_similarities: Optional[List[Tuple[str, float]]] = None,
    ) -> Optional[AlertCluster]:
        """
        Find an existing cluster for *alert*, or create a new one if
        enough related alerts are found.

        Args:
            alert: The incoming alert dict (must contain alert_id, alert_type, etc.).
            candidate_alerts: Recent alerts to compare against.
            vector_similarities: Optional pre-computed vector similarities
                                 as list of (alert_id, score) pairs.

        Returns:
            AlertCluster if the alert was clustered, else None.
        """
        alert_id = alert.get("alert_id", "")

        # Periodic eviction: check every 100 clusters
        if len(self.clusters) > 0 and len(self.clusters) % 100 == 0:
            self.evict_expired_clusters()

        # Already clustered?
        if alert_id in self.alert_to_cluster:
            cluster = self.clusters[self.alert_to_cluster[alert_id]]
            cluster.last_updated = datetime.utcnow()
            return cluster

        # Score every candidate
        related: List[Tuple[str, float]] = []

        # Build a lookup for vector scores
        vector_score_map: Dict[str, float] = {}
        if vector_similarities:
            vector_score_map = {aid: score for aid, score in vector_similarities}

        for candidate in candidate_alerts:
            cid = candidate.get("alert_id", "")
            if cid == alert_id:
                continue

            struct_sim = compute_structural_similarity(alert, candidate)
            vec_sim = vector_score_map.get(cid, 0.0)

            # Weighted blend: 40% structural, 60% vector when available
            if vec_sim > 0:
                combined = 0.4 * struct_sim + 0.6 * vec_sim
            else:
                combined = struct_sim

            if combined >= self.similarity_threshold:
                related.append((cid, combined))

        if not related:
            return None

        # Sort by similarity descending
        related.sort(key=lambda x: x[1], reverse=True)

        # Check if any related alert already belongs to a cluster
        for cid, sim in related:
            if cid in self.alert_to_cluster:
                existing_cluster = self.clusters[self.alert_to_cluster[cid]]
                existing_cluster.add_alert(alert_id)
                existing_cluster.confidence = max(existing_cluster.confidence, sim)
                self.alert_to_cluster[alert_id] = existing_cluster.cluster_id
                self.total_clustered += 1
                logger.info(
                    f"Alert {alert_id} added to existing cluster {existing_cluster.cluster_id}"
                )
                return existing_cluster

        # Create a new cluster
        cluster_id = f"cluster-{uuid.uuid4().hex[:12]}"
        cluster = AlertCluster(
            cluster_id=cluster_id,
            primary_alert_id=alert_id,
            cluster_type=alert.get("alert_type", "unknown"),
        )
        cluster.confidence = related[0][1]

        for cid, _ in related:
            cluster.add_alert(cid)
            self.alert_to_cluster[cid] = cluster_id

        self.alert_to_cluster[alert_id] = cluster_id
        self.clusters[cluster_id] = cluster
        self.total_clustered += 1
        self.total_new_clusters += 1

        logger.info(f"Created new cluster {cluster_id} with {cluster.alert_count} alerts")
        return cluster

    def get_cluster(self, alert_id: str) -> Optional[AlertCluster]:
        cid = self.alert_to_cluster.get(alert_id)
        return self.clusters.get(cid) if cid else None

    def evict_expired_clusters(self) -> int:
        """Remove clusters that haven't been updated within the TTL.

        Returns:
            Number of clusters evicted.
        """
        now = datetime.utcnow()
        expired_ids = [
            cid
            for cid, cluster in self.clusters.items()
            if (now - cluster.last_updated) > self.cluster_ttl
        ]

        # If still over capacity after TTL eviction, evict oldest first
        if len(self.clusters) - len(expired_ids) > self.MAX_CLUSTERS:
            remaining = [(cid, c) for cid, c in self.clusters.items() if cid not in expired_ids]
            remaining.sort(key=lambda x: x[1].last_updated)
            overage = len(remaining) - self.MAX_CLUSTERS
            if overage > 0:
                expired_ids.extend(cid for cid, _ in remaining[:overage])

        for cid in expired_ids:
            cluster = self.clusters.pop(cid, None)
            if cluster:
                # Clean up alert-to-cluster mappings
                self.alert_to_cluster.pop(cluster.primary_alert_id, None)
                for aid in cluster.related_alert_ids:
                    self.alert_to_cluster.pop(aid, None)

        if expired_ids:
            self.total_evicted += len(expired_ids)
            logger.info(f"Evicted {len(expired_ids)} expired clusters")

        return len(expired_ids)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_clusters": len(self.clusters),
            "total_alerts_clustered": self.total_clustered,
            "new_clusters_created": self.total_new_clusters,
            "total_evicted": self.total_evicted,
        }
