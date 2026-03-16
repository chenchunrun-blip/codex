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
Advanced Alert Correlation Analysis

Performs sophisticated correlation analysis including:
- Attack chain detection (multi-stage attack patterns)
- Root cause analysis
- Impact propagation analysis
- Threat actor behavior profiling
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, deque

logger = logging.getLogger(__name__)


class AttackStage(Enum):
    """Stages of attack lifecycle"""
    RECONNAISSANCE = "reconnaissance"
    INITIAL_COMPROMISE = "initial_compromise"
    PERSISTENCE = "persistence"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    LATERAL_MOVEMENT = "lateral_movement"
    DATA_EXFILTRATION = "data_exfiltration"
    IMPACT = "impact"


class AttackChainType(Enum):
    """Types of attack chains"""
    CREDENTIAL_THEFT_TO_EXFIL = "credential_theft_to_exfil"
    MALWARE_DELIVERY = "malware_delivery"
    RANSOMWARE_DEPLOYMENT = "ransomware_deployment"
    APT_STYLE = "apt_style"
    INSIDER_THREAT = "insider_threat"
    DATA_DESTRUCTION = "data_destruction"


@dataclass
class AlertRelationship:
    """Relationship between two alerts"""
    source_alert_id: str
    target_alert_id: str
    relationship_type: str  # "causes", "follows", "enables", "related"
    confidence: float
    time_delta_seconds: float
    reasoning: str = ""


@dataclass
class AttackChain:
    """Detected attack chain"""
    chain_id: str
    chain_type: AttackChainType
    stages: List[Tuple[AttackStage, str]] = field(default_factory=list)  # (stage, alert_id)
    alert_ids: List[str] = field(default_factory=list)
    confidence: float = 0.0
    time_span_seconds: float = 0.0
    estimated_severity: str = "unknown"
    detection_timestamp: datetime = field(default_factory=datetime.now)

    def add_stage(self, stage: AttackStage, alert_id: str):
        """Add stage to attack chain"""
        self.stages.append((stage, alert_id))
        if alert_id not in self.alert_ids:
            self.alert_ids.append(alert_id)


@dataclass
class RootCauseAnalysis:
    """Root cause analysis result"""
    root_cause_alert_id: str
    affected_alerts: List[str] = field(default_factory=list)
    impact_score: float = 0.0
    reasoning: List[str] = field(default_factory=list)
    recommended_remediation: List[str] = field(default_factory=list)


@dataclass
class ThreatActorProfile:
    """Profile of threat actor behavior"""
    profile_id: str
    suspected_motive: str  # "financial", "espionage", "disruption", "unknown"
    attack_sophistication: str  # "low", "medium", "high", "very_high"
    observed_ttps: List[str] = field(default_factory=list)  # Tactics, Techniques, Procedures
    attack_patterns: List[AttackChainType] = field(default_factory=list)
    alert_count: int = 0
    time_window_hours: int = 24


class AlertCorrelationEngine:
    """Advanced alert correlation analysis"""

    def __init__(self, correlation_window_hours: int = 24):
        self.correlation_window = timedelta(hours=correlation_window_hours)
        self.attack_chains: Dict[str, AttackChain] = {}
        self.alert_relationships: List[AlertRelationship] = []
        self.threat_actor_profiles: Dict[str, ThreatActorProfile] = {}
        self.root_causes: Dict[str, RootCauseAnalysis] = {}

    def analyze_correlation(
        self,
        alert_id: str,
        alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Perform comprehensive correlation analysis

        Args:
            alert_id: Current alert ID
            alert: Current alert data
            recent_alerts: Recent alerts for correlation

        Returns:
            Correlation analysis results
        """
        logger.info(f"Performing correlation analysis for {alert_id}")

        analysis = {
            'alert_id': alert_id,
            'related_alerts': self._find_related_alerts(alert, recent_alerts),
            'attack_chains': self._detect_attack_chains(alert, recent_alerts),
            'root_cause': self._analyze_root_cause(alert, recent_alerts),
            'threat_actor': self._profile_threat_actor(alert, recent_alerts),
            'impact_propagation': self._analyze_impact_propagation(alert, recent_alerts)
        }

        return analysis

    def _find_related_alerts(
        self,
        alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Find alerts related to current alert"""
        related = []

        for other_alert in recent_alerts:
            relationship = self._calculate_relationship(alert, other_alert)
            if relationship and relationship.confidence > 0.5:
                related.append({
                    'alert_id': other_alert.get('alert_id'),
                    'relationship': relationship.relationship_type,
                    'confidence': relationship.confidence,
                    'time_delta_seconds': relationship.time_delta_seconds,
                    'reasoning': relationship.reasoning
                })

                # Store relationship
                self.alert_relationships.append(relationship)

        return sorted(related, key=lambda x: x['confidence'], reverse=True)

    def _calculate_relationship(
        self,
        alert1: Dict[str, Any],
        alert2: Dict[str, Any]
    ) -> Optional[AlertRelationship]:
        """Calculate relationship between two alerts"""
        relationship_type = ""
        confidence = 0.0
        reasoning_parts = []

        # IP relationship (source or target matching)
        alert1_ips = {alert1.get('source_ip'), alert1.get('target_ip')} - {None}
        alert2_ips = {alert2.get('source_ip'), alert2.get('target_ip')} - {None}
        shared_ips = alert1_ips & alert2_ips

        if shared_ips:
            confidence += 0.3
            relationship_type = "related_ip"
            reasoning_parts.append(f"Shared IP: {list(shared_ips)[0]}")

        # Same asset
        if alert1.get('asset_id') == alert2.get('asset_id') and alert1.get('asset_id'):
            confidence += 0.2
            reasoning_parts.append("Same asset affected")

        # Related alert types
        if self._are_alert_types_related(alert1.get('alert_type'), alert2.get('alert_type')):
            confidence += 0.2
            reasoning_parts.append(f"Related attack types: {alert1.get('alert_type')} and {alert2.get('alert_type')}")

        # Time proximity and ordering
        time1 = alert1.get('timestamp')
        time2 = alert2.get('timestamp')
        time_delta = 0.0

        if time1 and time2:
            try:
                dt1 = datetime.fromisoformat(time1)
                dt2 = datetime.fromisoformat(time2)
                time_delta = (dt2 - dt1).total_seconds()
                abs_time_delta = abs(time_delta)

                if abs_time_delta < 300:  # Within 5 minutes
                    confidence += 0.2
                    reasoning_parts.append(f"Temporal proximity ({abs_time_delta:.0f}s)")
            except:
                pass  # Invalid timestamp format

        if confidence > 0:
            reasoning = ", ".join(reasoning_parts) if reasoning_parts else ""

            return AlertRelationship(
                source_alert_id=alert1.get('alert_id', ''),
                target_alert_id=alert2.get('alert_id', ''),
                relationship_type=relationship_type,
                confidence=min(confidence, 1.0),
                time_delta_seconds=time_delta,
                reasoning=reasoning
            )

        return None

    def _are_alert_types_related(self, type1: str, type2: str) -> bool:
        """Check if alert types are related"""
        related_pairs = [
            ('phishing', 'credential_theft'),
            ('credential_theft', 'lateral_movement'),
            ('lateral_movement', 'data_exfiltration'),
            ('malware', 'lateral_movement'),
            ('malware', 'privilege_escalation'),
            ('brute_force', 'privilege_escalation'),
        ]

        type1_lower = type1.lower() if type1 else ""
        type2_lower = type2.lower() if type2 else ""

        for pair in related_pairs:
            if (type1_lower in pair and type2_lower in pair):
                return True

        return False

    def _detect_attack_chains(
        self,
        alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Detect attack chains involving current alert"""
        chains = []

        # Look for attack sequences
        all_alerts = [alert] + recent_alerts
        sorted_alerts = sorted(
            all_alerts,
            key=lambda x: x.get('timestamp', ''),
            reverse=False
        )

        # Pattern: Phishing -> Credential Theft -> Lateral Movement -> Data Exfil
        chain = self._detect_exfiltration_chain(sorted_alerts)
        if chain:
            chains.append({
                'chain_type': chain.chain_type.value,
                'stages': [(s.value, aid) for s, aid in chain.stages],
                'confidence': chain.confidence,
                'severity': chain.estimated_severity
            })

        # Pattern: Malware -> Persistence -> Privilege Escalation
        chain = self._detect_malware_chain(sorted_alerts)
        if chain:
            chains.append({
                'chain_type': chain.chain_type.value,
                'stages': [(s.value, aid) for s, aid in chain.stages],
                'confidence': chain.confidence,
                'severity': chain.estimated_severity
            })

        return chains

    def _detect_exfiltration_chain(self, sorted_alerts: List[Dict[str, Any]]) -> Optional[AttackChain]:
        """Detect credential theft to data exfiltration chain"""
        stages_found = {}

        for alert in sorted_alerts:
            alert_type = alert.get('alert_type', '').lower()

            if 'phishing' in alert_type or 'credential' in alert_type:
                if AttackStage.INITIAL_COMPROMISE not in stages_found:
                    stages_found[AttackStage.INITIAL_COMPROMISE] = alert.get('alert_id')

            if 'lateral' in alert_type or 'lateral_movement' in alert_type:
                if AttackStage.LATERAL_MOVEMENT not in stages_found:
                    stages_found[AttackStage.LATERAL_MOVEMENT] = alert.get('alert_id')

            if 'exfiltration' in alert_type or 'data_exfil' in alert_type:
                if AttackStage.DATA_EXFILTRATION not in stages_found:
                    stages_found[AttackStage.DATA_EXFILTRATION] = alert.get('alert_id')

        if len(stages_found) >= 2:
            chain = AttackChain(
                chain_id=f"chain_{int(datetime.now().timestamp())}",
                chain_type=AttackChainType.CREDENTIAL_THEFT_TO_EXFIL,
                confidence=min(0.5 + len(stages_found) * 0.15, 1.0),
                estimated_severity="critical" if len(stages_found) >= 3 else "high"
            )

            for stage in [
                AttackStage.INITIAL_COMPROMISE,
                AttackStage.LATERAL_MOVEMENT,
                AttackStage.DATA_EXFILTRATION
            ]:
                if stage in stages_found:
                    chain.add_stage(stage, stages_found[stage])

            return chain

        return None

    def _detect_malware_chain(self, sorted_alerts: List[Dict[str, Any]]) -> Optional[AttackChain]:
        """Detect malware deployment chain"""
        stages_found = {}

        for alert in sorted_alerts:
            alert_type = alert.get('alert_type', '').lower()

            if 'malware' in alert_type:
                if AttackStage.INITIAL_COMPROMISE not in stages_found:
                    stages_found[AttackStage.INITIAL_COMPROMISE] = alert.get('alert_id')

            if 'persistence' in alert_type:
                if AttackStage.PERSISTENCE not in stages_found:
                    stages_found[AttackStage.PERSISTENCE] = alert.get('alert_id')

            if 'privilege' in alert_type or 'escalation' in alert_type:
                if AttackStage.PRIVILEGE_ESCALATION not in stages_found:
                    stages_found[AttackStage.PRIVILEGE_ESCALATION] = alert.get('alert_id')

        if len(stages_found) >= 2:
            chain = AttackChain(
                chain_id=f"chain_{int(datetime.now().timestamp())}",
                chain_type=AttackChainType.MALWARE_DELIVERY,
                confidence=min(0.5 + len(stages_found) * 0.15, 1.0),
                estimated_severity="high"
            )

            for stage in [
                AttackStage.INITIAL_COMPROMISE,
                AttackStage.PERSISTENCE,
                AttackStage.PRIVILEGE_ESCALATION
            ]:
                if stage in stages_found:
                    chain.add_stage(stage, stages_found[stage])

            return chain

        return None

    def _analyze_root_cause(
        self,
        alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Analyze root cause of current alert"""
        all_alerts = [alert] + recent_alerts
        sorted_alerts = sorted(
            all_alerts,
            key=lambda x: x.get('timestamp', ''),
            reverse=False
        )

        # Root cause is typically the earliest critical event
        for potential_root in sorted_alerts:
            severity = potential_root.get('severity', 'low')
            alert_type = potential_root.get('alert_type', '')

            if severity in ['critical', 'high'] and self._is_root_cause_type(alert_type):
                affected = [a.get('alert_id') for a in sorted_alerts if a.get('timestamp', '') >= potential_root.get('timestamp', '')]

                return {
                    'root_cause_alert_id': potential_root.get('alert_id'),
                    'affected_alerts': affected,
                    'reasoning': f"Initial {alert_type} event triggered subsequent alerts",
                    'remediation': self._suggest_remediation(potential_root)
                }

        return None

    def _is_root_cause_type(self, alert_type: str) -> bool:
        """Check if alert type is typically a root cause"""
        root_cause_types = [
            'phishing', 'malware', 'brute_force', 'vulnerability',
            'initial_access', 'credential_theft'
        ]
        return any(cause in alert_type.lower() for cause in root_cause_types)

    def _suggest_remediation(self, alert: Dict[str, Any]) -> List[str]:
        """Suggest remediation steps"""
        suggestions = []
        alert_type = alert.get('alert_type', '').lower()

        if 'phishing' in alert_type:
            suggestions.extend([
                'Block sender email address',
                'Quarantine affected emails',
                'Reset credentials of users who clicked'
            ])
        elif 'malware' in alert_type:
            suggestions.extend([
                'Isolate infected system',
                'Run antivirus scan',
                'Analyze for persistence mechanisms'
            ])
        elif 'brute_force' in alert_type:
            suggestions.extend([
                'Block attacking IP address',
                'Enable account lockout',
                'Require MFA for all accounts'
            ])

        return suggestions

    def _profile_threat_actor(
        self,
        alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Profile threat actor based on observed behavior"""
        all_alerts = [alert] + recent_alerts
        motive = self._determine_motive(all_alerts)
        sophistication = self._assess_sophistication(all_alerts)
        ttps = self._extract_ttps(all_alerts)

        return {
            'suspected_motive': motive,
            'sophistication': sophistication,
            'observed_tactics': ttps,
            'alert_count': len(all_alerts)
        }

    def _determine_motive(self, alerts: List[Dict[str, Any]]) -> str:
        """Determine threat actor motive"""
        alert_types = [a.get('alert_type', '').lower() for a in alerts]

        if any('exfiltration' in t or 'data' in t for t in alert_types):
            return "financial"
        elif any('espionage' in t or 'persistence' in t for t in alert_types):
            return "espionage"
        elif any('ransomware' in t or 'deletion' in t for t in alert_types):
            return "disruption"

        return "unknown"

    def _assess_sophistication(self, alerts: List[Dict[str, Any]]) -> str:
        """Assess threat actor sophistication"""
        complexity_indicators = 0

        for alert in alerts:
            alert_type = alert.get('alert_type', '').lower()

            if any(t in alert_type for t in ['persistence', 'privilege', 'lateral']):
                complexity_indicators += 2
            elif any(t in alert_type for t in ['malware', 'exploit']):
                complexity_indicators += 1

        if complexity_indicators >= 6:
            return "very_high"
        elif complexity_indicators >= 4:
            return "high"
        elif complexity_indicators >= 2:
            return "medium"

        return "low"

    def _extract_ttps(self, alerts: List[Dict[str, Any]]) -> List[str]:
        """Extract tactics, techniques, procedures"""
        ttps = set()

        for alert in alerts:
            alert_type = alert.get('alert_type', '').lower()
            if alert_type:
                ttps.add(alert_type)

        return list(ttps)

    def _analyze_impact_propagation(
        self,
        alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Analyze how impact propagates through the network"""
        affected_ips = set()
        affected_assets = set()
        affected_users = set()

        for a in [alert] + recent_alerts:
            if a.get('source_ip'):
                affected_ips.add(a['source_ip'])
            if a.get('target_ip'):
                affected_ips.add(a['target_ip'])
            if a.get('asset_id'):
                affected_assets.add(a['asset_id'])
            if a.get('user_id'):
                affected_users.add(a['user_id'])

        return {
            'affected_ip_addresses': list(affected_ips),
            'affected_assets': list(affected_assets),
            'affected_users': list(affected_users),
            'blast_radius': len(affected_ips) + len(affected_assets),
            'propagation_rate': self._estimate_propagation_rate(recent_alerts)
        }

    def _estimate_propagation_rate(self, alerts: List[Dict[str, Any]]) -> str:
        """Estimate how fast the attack is spreading"""
        if not alerts or len(alerts) < 2:
            return "slow"

        # Count alerts per hour
        time_window = timedelta(hours=1)
        recent_count = sum(1 for a in alerts if self._is_within_window(a, time_window))

        if recent_count > 10:
            return "very_fast"
        elif recent_count > 5:
            return "fast"
        elif recent_count > 2:
            return "moderate"

        return "slow"

    def _is_within_window(self, alert: Dict[str, Any], window: timedelta) -> bool:
        """Check if alert is within time window"""
        try:
            alert_time = datetime.fromisoformat(alert.get('timestamp', ''))
            return datetime.now() - alert_time < window
        except:
            return False


# Convenience function
def create_correlation_engine(correlation_window_hours: int = 24) -> AlertCorrelationEngine:
    """Create correlation engine instance"""
    return AlertCorrelationEngine(correlation_window_hours)
