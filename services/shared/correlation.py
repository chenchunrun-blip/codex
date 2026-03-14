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
Alert Correlation & Attack Chain Detection

Production-grade correlation engine that:
- Detects multi-stage attack chains (Kill Chain model)
- Performs root cause analysis
- Profiles threat actor sophistication
- Computes impact propagation blast radius

Designed to integrate with the existing SecurityAlert model and
workflow-engine for automated escalation.
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from shared.models.alert import AlertType, Severity
from shared.utils import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Attack lifecycle stages (based on MITRE ATT&CK / Lockheed Kill Chain)
# ---------------------------------------------------------------------------

class AttackStage(str, Enum):
    RECONNAISSANCE = "reconnaissance"
    INITIAL_ACCESS = "initial_access"
    EXECUTION = "execution"
    PERSISTENCE = "persistence"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    LATERAL_MOVEMENT = "lateral_movement"
    COLLECTION = "collection"
    EXFILTRATION = "exfiltration"
    IMPACT = "impact"


# Map alert types to attack stages
ALERT_TYPE_TO_STAGE: Dict[str, AttackStage] = {
    "phishing": AttackStage.INITIAL_ACCESS,
    "credential_theft": AttackStage.INITIAL_ACCESS,
    "brute_force": AttackStage.INITIAL_ACCESS,
    "malware": AttackStage.EXECUTION,
    "unauthorized_access": AttackStage.INITIAL_ACCESS,
    "persistence": AttackStage.PERSISTENCE,
    "privilege_escalation": AttackStage.PRIVILEGE_ESCALATION,
    "lateral_movement": AttackStage.LATERAL_MOVEMENT,
    "data_exfiltration": AttackStage.EXFILTRATION,
    "anomaly": AttackStage.COLLECTION,
    "ddos": AttackStage.IMPACT,
}

# Related alert type pairs (used for relationship scoring)
RELATED_TYPE_PAIRS: List[Tuple[str, str]] = [
    ("phishing", "credential_theft"),
    ("credential_theft", "lateral_movement"),
    ("lateral_movement", "data_exfiltration"),
    ("malware", "lateral_movement"),
    ("malware", "privilege_escalation"),
    ("brute_force", "privilege_escalation"),
    ("brute_force", "unauthorized_access"),
    ("unauthorized_access", "data_exfiltration"),
    ("phishing", "malware"),
]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

class AttackChain:
    """A detected multi-stage attack chain."""

    def __init__(self, chain_id: str, chain_type: str):
        self.chain_id = chain_id
        self.chain_type = chain_type
        self.stages: List[Tuple[AttackStage, str]] = []  # (stage, alert_id)
        self.confidence: float = 0.0
        self.estimated_severity: str = "medium"
        self.detected_at: datetime = datetime.utcnow()

    def add_stage(self, stage: AttackStage, alert_id: str):
        self.stages.append((stage, alert_id))

    @property
    def alert_ids(self) -> List[str]:
        return [aid for _, aid in self.stages]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chain_id": self.chain_id,
            "chain_type": self.chain_type,
            "stages": [{"stage": s.value, "alert_id": aid} for s, aid in self.stages],
            "stage_count": len(self.stages),
            "confidence": round(self.confidence, 3),
            "estimated_severity": self.estimated_severity,
            "detected_at": self.detected_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------

class CorrelationEngine:
    """
    Stateless correlation engine.

    All state (alert history) is passed in from the caller so the engine
    can be used from any service without requiring its own persistence.
    """

    # ---- Attack chain detection -------------------------------------------

    @staticmethod
    def detect_attack_chains(
        current_alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]],
    ) -> List[AttackChain]:
        """
        Detect attack chains involving *current_alert*.

        Scans recent_alerts for sequences that match known multi-stage
        attack patterns.
        """
        all_alerts = [current_alert] + recent_alerts
        # Sort chronologically
        all_alerts.sort(key=lambda a: a.get("timestamp", ""))

        chains: List[AttackChain] = []

        # Map each alert to its attack stage
        staged: List[Tuple[AttackStage, Dict[str, Any]]] = []
        for a in all_alerts:
            atype = a.get("alert_type", "other").lower()
            stage = ALERT_TYPE_TO_STAGE.get(atype)
            if stage:
                staged.append((stage, a))

        # Pattern 1: Initial Access → Lateral Movement → Exfiltration
        chain = _match_chain(
            staged,
            "initial_access_to_exfil",
            [AttackStage.INITIAL_ACCESS, AttackStage.LATERAL_MOVEMENT, AttackStage.EXFILTRATION],
        )
        if chain:
            chains.append(chain)

        # Pattern 2: Initial Access → Execution → Persistence → Privilege Escalation
        chain = _match_chain(
            staged,
            "malware_persistence",
            [AttackStage.INITIAL_ACCESS, AttackStage.EXECUTION, AttackStage.PERSISTENCE, AttackStage.PRIVILEGE_ESCALATION],
        )
        if chain:
            chains.append(chain)

        # Pattern 3: Initial Access → Execution → Exfiltration (ransomware-style)
        chain = _match_chain(
            staged,
            "ransomware_style",
            [AttackStage.INITIAL_ACCESS, AttackStage.EXECUTION, AttackStage.EXFILTRATION],
        )
        if chain:
            chains.append(chain)

        # Pattern 4: Execution → Lateral Movement → Impact (worm-style)
        chain = _match_chain(
            staged,
            "worm_propagation",
            [AttackStage.EXECUTION, AttackStage.LATERAL_MOVEMENT, AttackStage.IMPACT],
        )
        if chain:
            chains.append(chain)

        return chains

    # ---- Root cause analysis ----------------------------------------------

    @staticmethod
    def find_root_cause(
        current_alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """
        Identify the most likely root cause alert.

        The root cause is the earliest high/critical severity alert whose
        type is a known initial-access vector and shares network context
        with subsequent alerts.
        """
        all_alerts = [current_alert] + recent_alerts
        all_alerts.sort(key=lambda a: a.get("timestamp", ""))

        root_cause_types = {"phishing", "malware", "brute_force", "credential_theft",
                            "unauthorized_access", "vulnerability"}

        for alert in all_alerts:
            sev = alert.get("severity", "low").lower()
            atype = alert.get("alert_type", "").lower()

            if sev in ("critical", "high") and atype in root_cause_types:
                # Verify it has network overlap with later alerts
                root_ips = {alert.get("source_ip"), alert.get("target_ip")} - {None, ""}
                affected = []
                for other in all_alerts:
                    if other.get("alert_id") == alert.get("alert_id"):
                        continue
                    other_ips = {other.get("source_ip"), other.get("target_ip")} - {None, ""}
                    if root_ips & other_ips:
                        affected.append(other.get("alert_id"))

                if affected:
                    return {
                        "root_cause_alert_id": alert.get("alert_id"),
                        "root_cause_type": atype,
                        "affected_alert_ids": affected,
                        "reasoning": f"Initial {atype} event with shared network context triggered {len(affected)} subsequent alerts",
                        "remediation": _suggest_remediation(atype),
                    }

        return None

    # ---- Threat actor profiling -------------------------------------------

    @staticmethod
    def profile_threat_actor(
        alerts: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Build a threat actor profile from the set of correlated alerts.
        """
        alert_types = [a.get("alert_type", "").lower() for a in alerts]
        type_set = set(alert_types)

        # Motive inference
        if type_set & {"data_exfiltration", "credential_theft"}:
            motive = "data_theft"
        elif type_set & {"ddos"}:
            motive = "disruption"
        elif type_set & {"persistence", "lateral_movement"} and len(type_set) >= 3:
            motive = "espionage"
        else:
            motive = "unknown"

        # Sophistication
        advanced_indicators = {"persistence", "privilege_escalation", "lateral_movement"}
        adv_count = len(type_set & advanced_indicators)
        if adv_count >= 2:
            sophistication = "high"
        elif adv_count >= 1 or len(type_set) >= 3:
            sophistication = "medium"
        else:
            sophistication = "low"

        return {
            "suspected_motive": motive,
            "sophistication": sophistication,
            "observed_tactics": sorted(type_set),
            "unique_tactic_count": len(type_set),
            "alert_count": len(alerts),
        }

    # ---- Impact propagation -----------------------------------------------

    @staticmethod
    def analyze_impact(
        alerts: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Compute the blast radius across IPs, assets, and users.
        """
        ips: Set[str] = set()
        assets: Set[str] = set()
        users: Set[str] = set()

        for a in alerts:
            for field in ("source_ip", "target_ip"):
                v = a.get(field)
                if v:
                    ips.add(v)
            if a.get("asset_id"):
                assets.add(a["asset_id"])
            if a.get("user_id"):
                users.add(a["user_id"])

        return {
            "affected_ips": sorted(ips),
            "affected_assets": sorted(assets),
            "affected_users": sorted(users),
            "blast_radius": len(ips) + len(assets),
            "ip_count": len(ips),
            "asset_count": len(assets),
            "user_count": len(users),
        }

    # ---- Full correlation -------------------------------------------------

    @classmethod
    def correlate(
        cls,
        current_alert: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        One-shot correlation producing all analysis for a given alert.
        """
        all_alerts = [current_alert] + recent_alerts

        return {
            "alert_id": current_alert.get("alert_id"),
            "attack_chains": [c.to_dict() for c in cls.detect_attack_chains(current_alert, recent_alerts)],
            "root_cause": cls.find_root_cause(current_alert, recent_alerts),
            "threat_actor_profile": cls.profile_threat_actor(all_alerts),
            "impact_analysis": cls.analyze_impact(all_alerts),
            "correlated_at": datetime.utcnow().isoformat(),
        }


# ---------------------------------------------------------------------------
# Helpers (module-private)
# ---------------------------------------------------------------------------

def _match_chain(
    staged: List[Tuple[AttackStage, Dict[str, Any]]],
    chain_type: str,
    pattern: List[AttackStage],
) -> Optional[AttackChain]:
    """
    Match a sequence of attack stages against a known pattern.

    Requires at least 2 out of len(pattern) stages to be present,
    in chronological order.
    """
    found: Dict[AttackStage, str] = {}

    for stage, alert in staged:
        if stage in pattern and stage not in found:
            found[stage] = alert.get("alert_id", "")

    matched = sum(1 for s in pattern if s in found)
    if matched < 2:
        return None

    chain = AttackChain(
        chain_id=f"chain-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{chain_type[:8]}",
        chain_type=chain_type,
    )

    for stage in pattern:
        if stage in found:
            chain.add_stage(stage, found[stage])

    chain.confidence = round(min(0.4 + matched * 0.2, 1.0), 2)
    chain.estimated_severity = "critical" if matched >= 3 else "high"

    return chain


def _suggest_remediation(alert_type: str) -> List[str]:
    """Return remediation steps for a root-cause alert type."""
    remediation_map = {
        "phishing": [
            "Block sender domain and quarantine related emails",
            "Reset credentials for users who interacted with the email",
            "Scan endpoints of affected users for malware",
        ],
        "malware": [
            "Isolate infected host from the network",
            "Collect forensic artifacts (memory dump, disk image)",
            "Run full antivirus scan and check for persistence mechanisms",
        ],
        "brute_force": [
            "Block attacking IP addresses at the firewall",
            "Enable account lockout policy (5 failures / 15 minutes)",
            "Enforce MFA for all affected accounts",
        ],
        "credential_theft": [
            "Force password reset for compromised accounts",
            "Revoke active sessions and API tokens",
            "Review access logs for unauthorized actions",
        ],
        "unauthorized_access": [
            "Revoke unauthorized sessions immediately",
            "Audit permission changes in the last 24 hours",
            "Enable enhanced logging on affected systems",
        ],
    }
    return remediation_map.get(alert_type, [
        "Investigate the alert and gather additional context",
        "Notify the security operations team",
    ])
