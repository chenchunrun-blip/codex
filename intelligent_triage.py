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
Intelligent Alert Triage System

Enhanced triage module with:
- Alert clustering and deduplication
- Adaptive learning from historical data
- Correlation analysis
- Automated routing and prioritization
- Machine learning integration
"""

import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from enum import Enum
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)


class AlertPriority(Enum):
    """Alert priority levels"""
    CRITICAL = 1
    HIGH = 2
    MEDIUM = 3
    LOW = 4
    INFO = 5


class TriageAction(Enum):
    """Automated triage actions"""
    AUTO_REMEDIATE = "auto_remediate"
    ESCALATE_IMMEDIATE = "escalate_immediate"
    INVESTIGATE_MANUAL = "investigate_manual"
    QUARANTINE = "quarantine"
    MONITOR_ONLY = "monitor_only"
    ARCHIVE = "archive"


@dataclass
class TriageMetrics:
    """Metrics for triage decision"""
    alert_type_match_score: float = 0.0
    severity_score: float = 0.0
    threat_intel_score: float = 0.0
    asset_criticality_score: float = 0.0
    historical_pattern_score: float = 0.0
    correlation_score: float = 0.0

    def get_total_score(self) -> float:
        """Calculate weighted total score"""
        weights = {
            'alert_type_match': 0.15,
            'severity': 0.20,
            'threat_intel': 0.25,
            'asset_criticality': 0.15,
            'historical_pattern': 0.15,
            'correlation': 0.10
        }
        return (
            self.alert_type_match_score * weights['alert_type_match'] +
            self.severity_score * weights['severity'] +
            self.threat_intel_score * weights['threat_intel'] +
            self.asset_criticality_score * weights['asset_criticality'] +
            self.historical_pattern_score * weights['historical_pattern'] +
            self.correlation_score * weights['correlation']
        )


@dataclass
class AlertFingerprint:
    """Fingerprint for alert deduplication"""
    alert_type: str
    source_ip: Optional[str]
    target_ip: Optional[str]
    asset_id: Optional[str]
    file_hash: Optional[str]

    def get_hash(self) -> str:
        """Generate hash fingerprint"""
        content = f"{self.alert_type}|{self.source_ip}|{self.target_ip}|{self.asset_id}|{self.file_hash}"
        return hashlib.sha256(content.encode()).hexdigest()


@dataclass
class AlertCluster:
    """Cluster of related alerts"""
    cluster_id: str
    primary_alert_id: str
    related_alert_ids: List[str] = field(default_factory=list)
    cluster_type: str = ""
    confidence: float = 0.0
    first_seen: datetime = field(default_factory=datetime.now)
    last_updated: datetime = field(default_factory=datetime.now)

    def add_alert(self, alert_id: str):
        """Add alert to cluster"""
        if alert_id not in self.related_alert_ids:
            self.related_alert_ids.append(alert_id)
            self.last_updated = datetime.now()

    def get_severity(self) -> str:
        """Estimate severity based on cluster"""
        alert_count = len(self.related_alert_ids) + 1
        if alert_count > 10:
            return "critical"
        elif alert_count > 5:
            return "high"
        elif alert_count > 2:
            return "medium"
        return "low"


@dataclass
class TriageDecision:
    """Intelligent triage decision"""
    alert_id: str
    recommended_action: TriageAction
    priority: AlertPriority
    confidence: float
    reasoning: List[str] = field(default_factory=list)
    cluster_id: Optional[str] = None
    estimated_impact: str = ""
    suggested_teams: List[str] = field(default_factory=list)
    automation_enabled: bool = False
    metrics: TriageMetrics = field(default_factory=TriageMetrics)


class AlertDeduplicator:
    """Handles alert deduplication using fingerprints"""

    def __init__(self, time_window_minutes: int = 60):
        self.time_window = timedelta(minutes=time_window_minutes)
        self.fingerprints: Dict[str, List[Tuple[str, datetime]]] = defaultdict(list)

    def get_fingerprint(self, alert: Dict[str, Any]) -> AlertFingerprint:
        """Extract fingerprint from alert"""
        return AlertFingerprint(
            alert_type=alert.get('alert_type', ''),
            source_ip=alert.get('source_ip'),
            target_ip=alert.get('target_ip'),
            asset_id=alert.get('asset_id'),
            file_hash=alert.get('file_hash')
        )

    def is_duplicate(self, alert: Dict[str, Any]) -> bool:
        """Check if alert is duplicate of recent alert"""
        fp = self.get_fingerprint(alert)
        fp_hash = fp.get_hash()
        current_time = datetime.now()

        # Check existing fingerprints
        if fp_hash in self.fingerprints:
            recent = [
                (aid, ts) for aid, ts in self.fingerprints[fp_hash]
                if current_time - ts < self.time_window
            ]
            return len(recent) > 0

        return False

    def register_alert(self, alert_id: str, alert: Dict[str, Any]):
        """Register alert with fingerprint"""
        fp = self.get_fingerprint(alert)
        fp_hash = fp.get_hash()
        self.fingerprints[fp_hash].append((alert_id, datetime.now()))

        # Cleanup old entries
        self._cleanup_old_entries(fp_hash)

    def _cleanup_old_entries(self, fp_hash: str):
        """Remove expired fingerprint entries"""
        current_time = datetime.now()
        self.fingerprints[fp_hash] = [
            (aid, ts) for aid, ts in self.fingerprints[fp_hash]
            if current_time - ts < self.time_window
        ]


class AlertClusterer:
    """Clusters related alerts"""

    def __init__(self):
        self.clusters: Dict[str, AlertCluster] = {}
        self.alert_to_cluster: Dict[str, str] = {}

    def find_related_alerts(
        self,
        alert: Dict[str, Any],
        candidate_alerts: List[Dict[str, Any]],
        similarity_threshold: float = 0.7
    ) -> List[str]:
        """Find related alerts based on similarity"""
        related = []

        for candidate in candidate_alerts:
            similarity = self._calculate_similarity(alert, candidate)
            if similarity >= similarity_threshold:
                related.append(candidate.get('alert_id', ''))

        return related

    def _calculate_similarity(self, alert1: Dict, alert2: Dict) -> float:
        """Calculate similarity between two alerts"""
        score = 0.0
        total_weight = 0.0

        # Alert type match
        if alert1.get('alert_type') == alert2.get('alert_type'):
            score += 0.4
            total_weight += 0.4

        # Source/Target IP match
        if (alert1.get('source_ip') == alert2.get('source_ip') or
            alert1.get('target_ip') == alert2.get('target_ip')):
            score += 0.3
            total_weight += 0.3

        # Asset match
        if alert1.get('asset_id') == alert2.get('asset_id'):
            score += 0.2
            total_weight += 0.2

        # File hash match
        if alert1.get('file_hash') == alert2.get('file_hash'):
            score += 0.1
            total_weight += 0.1

        return score / total_weight if total_weight > 0 else 0.0

    def create_cluster(
        self,
        cluster_id: str,
        primary_alert_id: str,
        related_alert_ids: List[str],
        cluster_type: str = "unknown"
    ) -> AlertCluster:
        """Create a new alert cluster"""
        cluster = AlertCluster(
            cluster_id=cluster_id,
            primary_alert_id=primary_alert_id,
            related_alert_ids=related_alert_ids,
            cluster_type=cluster_type
        )

        self.clusters[cluster_id] = cluster
        self.alert_to_cluster[primary_alert_id] = cluster_id
        for aid in related_alert_ids:
            self.alert_to_cluster[aid] = cluster_id

        return cluster

    def get_cluster_for_alert(self, alert_id: str) -> Optional[AlertCluster]:
        """Get cluster for given alert"""
        cluster_id = self.alert_to_cluster.get(alert_id)
        return self.clusters.get(cluster_id) if cluster_id else None


class HistoricalLearning:
    """Learns from historical triage decisions"""

    def __init__(self):
        self.alert_patterns: Dict[str, Dict[str, Any]] = {}
        self.team_expertise: Dict[str, float] = defaultdict(float)
        self.action_outcomes: List[Dict[str, Any]] = []

    def record_alert_pattern(
        self,
        alert_type: str,
        severity: str,
        action_taken: str,
        outcome: str
    ):
        """Record alert pattern and outcome"""
        key = f"{alert_type}_{severity}"
        if key not in self.alert_patterns:
            self.alert_patterns[key] = {
                'count': 0,
                'successful_outcomes': 0,
                'actions': defaultdict(int),
                'avg_resolution_time': 0
            }

        pattern = self.alert_patterns[key]
        pattern['count'] += 1
        pattern['actions'][action_taken] += 1

        if outcome == 'resolved':
            pattern['successful_outcomes'] += 1

    def get_recommended_action(self, alert_type: str, severity: str) -> Optional[str]:
        """Get recommended action based on history"""
        key = f"{alert_type}_{severity}"
        if key not in self.alert_patterns:
            return None

        pattern = self.alert_patterns[key]
        if pattern['count'] == 0:
            return None

        # Return most frequently successful action
        actions = pattern['actions']
        if not actions:
            return None

        return max(actions.items(), key=lambda x: x[1])[0]

    def get_success_rate(self, alert_type: str, severity: str) -> float:
        """Get success rate for alert type/severity combination"""
        key = f"{alert_type}_{severity}"
        if key not in self.alert_patterns:
            return 0.0

        pattern = self.alert_patterns[key]
        if pattern['count'] == 0:
            return 0.0

        return pattern['successful_outcomes'] / pattern['count']


class IntelligentTriageEngine:
    """Main intelligent triage engine"""

    def __init__(self):
        self.deduplicator = AlertDeduplicator(time_window_minutes=60)
        self.clusterer = AlertClusterer()
        self.learning = HistoricalLearning()
        self.alert_history: List[Dict[str, Any]] = []

    def triage_alert(
        self,
        alert: Dict[str, Any],
        threat_intel: Optional[Dict[str, Any]] = None,
        asset_context: Optional[Dict[str, Any]] = None,
        user_context: Optional[Dict[str, Any]] = None,
        recent_alerts: Optional[List[Dict[str, Any]]] = None
    ) -> TriageDecision:
        """
        Perform intelligent triage on alert

        Args:
            alert: Alert data
            threat_intel: Threat intelligence
            asset_context: Asset information
            user_context: User information
            recent_alerts: Recent alerts for correlation

        Returns:
            Triage decision with recommendations
        """
        alert_id = alert.get('alert_id', 'unknown')
        logger.info(f"Triaging alert {alert_id}")

        # Step 1: Check for duplicates
        if self.deduplicator.is_duplicate(alert):
            return TriageDecision(
                alert_id=alert_id,
                recommended_action=TriageAction.ARCHIVE,
                priority=AlertPriority.LOW,
                confidence=0.95,
                reasoning=["Alert is duplicate of recent alert"],
                automation_enabled=True
            )

        # Register alert
        self.deduplicator.register_alert(alert_id, alert)

        # Step 2: Calculate metrics
        metrics = self._calculate_metrics(
            alert,
            threat_intel,
            asset_context,
            recent_alerts
        )

        # Step 3: Find related alerts and create cluster
        cluster_id = None
        if recent_alerts:
            related = self.clusterer.find_related_alerts(alert, recent_alerts)
            if related:
                cluster_id = f"cluster_{alert_id}_{int(datetime.now().timestamp())}"
                self.clusterer.create_cluster(
                    cluster_id=cluster_id,
                    primary_alert_id=alert_id,
                    related_alert_ids=related,
                    cluster_type=alert.get('alert_type', 'unknown')
                )

        # Step 4: Determine priority
        priority = self._determine_priority(metrics)

        # Step 5: Recommend action
        action, confidence = self._recommend_action(alert, metrics, priority)

        # Step 6: Build decision
        decision = TriageDecision(
            alert_id=alert_id,
            recommended_action=action,
            priority=priority,
            confidence=confidence,
            cluster_id=cluster_id,
            metrics=metrics,
            estimated_impact=self._estimate_impact(alert, metrics),
            suggested_teams=self._suggest_teams(alert, action)
        )

        decision.reasoning = self._build_reasoning(decision, metrics)
        decision.automation_enabled = self._should_automate(decision)

        # Store in history
        self.alert_history.append({
            'alert_id': alert_id,
            'decision': asdict(decision),
            'timestamp': datetime.now().isoformat()
        })

        return decision

    def _calculate_metrics(
        self,
        alert: Dict[str, Any],
        threat_intel: Optional[Dict[str, Any]],
        asset_context: Optional[Dict[str, Any]],
        recent_alerts: Optional[List[Dict[str, Any]]]
    ) -> TriageMetrics:
        """Calculate triage metrics"""
        metrics = TriageMetrics()

        # Alert type match
        alert_type = alert.get('alert_type', '')
        if alert_type in ['malware', 'phishing', 'data_exfiltration']:
            metrics.alert_type_match_score = 90.0
        elif alert_type in ['brute_force', 'intrusion']:
            metrics.alert_type_match_score = 75.0
        else:
            metrics.alert_type_match_score = 50.0

        # Severity score
        severity = alert.get('severity', 'low')
        severity_map = {'critical': 100, 'high': 80, 'medium': 60, 'low': 40}
        metrics.severity_score = severity_map.get(severity, 50)

        # Threat intel score
        if threat_intel:
            # Try multiple possible keys for threat level score
            score = threat_intel.get('threat_level_score')
            if score is None:
                score = threat_intel.get('threat_score')
            if score is None:
                # Map threat level to score if numeric score not available
                threat_level = threat_intel.get('threat_level', 'unknown').lower()
                threat_level_map = {'critical': 95, 'high': 80, 'medium': 60, 'low': 40, 'unknown': 50}
                score = threat_level_map.get(threat_level, 50)
            metrics.threat_intel_score = float(score) if score is not None else 50

        # Asset criticality
        if asset_context:
            criticality_map = {'critical': 100, 'high': 80, 'medium': 50, 'low': 20}
            criticality = asset_context.get('criticality', 'low')
            metrics.asset_criticality_score = criticality_map.get(criticality, 30)

        # Historical pattern
        success_rate = self.learning.get_success_rate(alert_type, severity)
        metrics.historical_pattern_score = success_rate * 100

        # Correlation score
        if recent_alerts:
            correlation = len(recent_alerts) / 10.0  # Normalize
            metrics.correlation_score = min(correlation * 100, 100)

        return metrics

    def _determine_priority(self, metrics: TriageMetrics) -> AlertPriority:
        """Determine alert priority based on metrics"""
        total_score = metrics.get_total_score()

        # Adjust thresholds based on available metrics
        # High severity and high alert type match already indicate critical/high
        if metrics.severity_score >= 90 and metrics.alert_type_match_score >= 80:
            return AlertPriority.CRITICAL
        elif metrics.severity_score >= 80 and metrics.alert_type_match_score >= 70:
            return AlertPriority.HIGH

        # Fall back to total score for other cases
        if total_score >= 70:
            return AlertPriority.CRITICAL
        elif total_score >= 55:
            return AlertPriority.HIGH
        elif total_score >= 40:
            return AlertPriority.MEDIUM
        elif total_score >= 25:
            return AlertPriority.LOW
        else:
            return AlertPriority.INFO

    def _recommend_action(
        self,
        alert: Dict[str, Any],
        metrics: TriageMetrics,
        priority: AlertPriority
    ) -> Tuple[TriageAction, float]:
        """Recommend action based on analysis"""
        alert_type = alert.get('alert_type', '')
        severity = alert.get('severity', 'low')

        # Check historical recommendation
        historical_action = self.learning.get_recommended_action(alert_type, severity)

        total_score = metrics.get_total_score()

        if priority == AlertPriority.CRITICAL:
            return TriageAction.ESCALATE_IMMEDIATE, 0.95
        elif priority == AlertPriority.HIGH:
            if alert_type == 'malware':
                return TriageAction.QUARANTINE, 0.90
            return TriageAction.INVESTIGATE_MANUAL, 0.85
        elif priority == AlertPriority.MEDIUM:
            if alert_type in ['phishing', 'data_exfiltration']:
                return TriageAction.INVESTIGATE_MANUAL, 0.80
            return TriageAction.MONITOR_ONLY, 0.70
        else:
            return TriageAction.ARCHIVE, 0.60

    def _estimate_impact(self, alert: Dict[str, Any], metrics: TriageMetrics) -> str:
        """Estimate business impact"""
        severity = alert.get('severity', 'low')
        asset_criticality = metrics.asset_criticality_score

        if severity in ['critical', 'high'] and asset_criticality > 70:
            return "Severe - Critical asset compromised"
        elif severity in ['critical', 'high']:
            return "High - Significant business impact"
        elif severity == 'medium' and asset_criticality > 50:
            return "Moderate - Important asset affected"
        else:
            return "Low - Limited business impact"

    def _suggest_teams(self, alert: Dict[str, Any], action: TriageAction) -> List[str]:
        """Suggest teams for handling alert"""
        teams = []
        alert_type = alert.get('alert_type', '')

        if action == TriageAction.ESCALATE_IMMEDIATE:
            teams.extend(['SOC', 'Management', 'Legal/Compliance'])
        elif action == TriageAction.INVESTIGATE_MANUAL:
            teams.append('SOC')
            if 'malware' in alert_type:
                teams.append('Forensics')
        elif action == TriageAction.QUARANTINE:
            teams.extend(['SOC', 'IT'])
        elif action == TriageAction.MONITOR_ONLY:
            teams.append('SOC')

        return teams

    def _build_reasoning(self, decision: TriageDecision, metrics: TriageMetrics) -> List[str]:
        """Build reasoning for decision"""
        reasoning = []

        if metrics.threat_intel_score > 75:
            reasoning.append("Strong threat intelligence indicators detected")

        if metrics.asset_criticality_score > 80:
            reasoning.append("Alert affects critical asset")

        if metrics.correlation_score > 70:
            reasoning.append("Multiple correlated alerts suggest coordinated attack")

        if metrics.historical_pattern_score > 80:
            reasoning.append("Similar alerts have high resolution success rate")

        if not reasoning:
            reasoning.append(f"Action recommended based on {decision.priority.name} priority classification")

        return reasoning

    def _should_automate(self, decision: TriageDecision) -> bool:
        """Determine if action can be automated"""
        if decision.recommended_action == TriageAction.ARCHIVE:
            return True
        elif decision.recommended_action == TriageAction.AUTO_REMEDIATE:
            return decision.confidence > 0.85
        return False


# Convenience functions
def create_triage_engine() -> IntelligentTriageEngine:
    """Create triage engine instance"""
    return IntelligentTriageEngine()


async def intelligent_triage_alert(
    alert: Dict[str, Any],
    threat_intel: Optional[Dict[str, Any]] = None,
    asset_context: Optional[Dict[str, Any]] = None,
    user_context: Optional[Dict[str, Any]] = None,
    recent_alerts: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Convenience function for intelligent alert triage"""
    engine = create_triage_engine()
    decision = engine.triage_alert(
        alert,
        threat_intel,
        asset_context,
        user_context,
        recent_alerts
    )
    return asdict(decision)
