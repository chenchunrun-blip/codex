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
Attack Chain Analyzer Service - MITRE ATT&CK mapping and kill chain analysis.

This service consumes triaged alerts and performs:
- MITRE ATT&CK technique identification
- Kill chain stage classification (Cyber Kill Chain)
- TTP (Tactics, Techniques, Procedures) extraction from alert data
- Prediction of likely next attack steps based on current stage
"""

import asyncio
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import SecurityAlert
from shared.utils import Config, get_logger
from sqlalchemy import text

# Initialize logger
logger = get_logger(__name__)

# Initialize config
config = Config()

# Global variables
db_manager: DatabaseManager = None
publisher: MessagePublisher = None
consumer: MessageConsumer = None

# Metrics counters
metrics = {
    "alerts_analyzed": 0,
    "techniques_identified": 0,
    "kill_chain_classifications": 0,
    "predictions_made": 0,
    "errors": 0,
}


# =============================================================================
# MITRE ATT&CK Technique Mapping
# =============================================================================

# Comprehensive mapping of alert patterns to MITRE ATT&CK techniques.
# Each entry: technique_id -> {name, tactic, description, kill_chain_stage, indicators}
MITRE_TECHNIQUES: Dict[str, Dict[str, Any]] = {
    # --- Reconnaissance ---
    "T1595": {
        "name": "Active Scanning",
        "tactic": "Reconnaissance",
        "description": "Adversaries may scan victim IP blocks to gather information for targeting.",
        "kill_chain_stage": "reconnaissance",
        "indicators": ["port_scan", "network_scan", "vulnerability_scan", "sweep"],
    },
    "T1592": {
        "name": "Gather Victim Host Information",
        "tactic": "Reconnaissance",
        "description": "Adversaries may gather information about victim hosts for targeting.",
        "kill_chain_stage": "reconnaissance",
        "indicators": ["host_enumeration", "os_fingerprint", "service_detection"],
    },
    "T1589": {
        "name": "Gather Victim Identity Information",
        "tactic": "Reconnaissance",
        "description": "Adversaries may gather credentials or identity information.",
        "kill_chain_stage": "reconnaissance",
        "indicators": ["credential_harvest", "email_harvest", "employee_enumeration"],
    },
    # --- Initial Access ---
    "T1566": {
        "name": "Phishing",
        "tactic": "Initial Access",
        "description": "Adversaries may send phishing messages to gain access to victim systems.",
        "kill_chain_stage": "delivery",
        "indicators": [
            "phishing",
            "spearphishing",
            "suspicious_email",
            "malicious_attachment",
            "email_link",
        ],
    },
    "T1566.001": {
        "name": "Spearphishing Attachment",
        "tactic": "Initial Access",
        "description": "Adversaries may send spearphishing emails with a malicious attachment.",
        "kill_chain_stage": "delivery",
        "indicators": [
            "malicious_attachment",
            "macro_enabled",
            "suspicious_document",
            "office_macro",
        ],
    },
    "T1566.002": {
        "name": "Spearphishing Link",
        "tactic": "Initial Access",
        "description": "Adversaries may send spearphishing emails with a malicious link.",
        "kill_chain_stage": "delivery",
        "indicators": ["phishing_url", "credential_phishing", "fake_login", "suspicious_link"],
    },
    "T1190": {
        "name": "Exploit Public-Facing Application",
        "tactic": "Initial Access",
        "description": "Adversaries may exploit vulnerabilities in internet-facing applications.",
        "kill_chain_stage": "exploitation",
        "indicators": [
            "web_exploit",
            "cve_exploit",
            "sql_injection",
            "rce",
            "remote_code_execution",
            "application_exploit",
            "vulnerability_exploit",
        ],
    },
    "T1133": {
        "name": "External Remote Services",
        "tactic": "Initial Access",
        "description": "Adversaries may leverage external remote services as an access point.",
        "kill_chain_stage": "delivery",
        "indicators": ["rdp_external", "vpn_unauthorized", "ssh_external", "remote_access"],
    },
    "T1078": {
        "name": "Valid Accounts",
        "tactic": "Initial Access",
        "description": "Adversaries may use credentials of existing accounts to gain access.",
        "kill_chain_stage": "exploitation",
        "indicators": [
            "credential_use",
            "account_compromise",
            "valid_credential",
            "stolen_credential",
        ],
    },
    "T1110": {
        "name": "Brute Force",
        "tactic": "Credential Access",
        "description": "Adversaries may use brute force techniques to gain access to accounts.",
        "kill_chain_stage": "exploitation",
        "indicators": [
            "brute_force",
            "password_spray",
            "credential_stuffing",
            "login_failure",
            "failed_login",
            "authentication_failure",
            "multiple_failed_logins",
        ],
    },
    "T1110.001": {
        "name": "Password Guessing",
        "tactic": "Credential Access",
        "description": "Adversaries may guess passwords to attempt access to accounts.",
        "kill_chain_stage": "exploitation",
        "indicators": ["password_guess", "dictionary_attack", "common_password"],
    },
    "T1110.003": {
        "name": "Password Spraying",
        "tactic": "Credential Access",
        "description": "Adversaries may use a single password against many accounts.",
        "kill_chain_stage": "exploitation",
        "indicators": ["password_spray", "spray_attack", "single_password_multiple_accounts"],
    },
    # --- Execution ---
    "T1059": {
        "name": "Command and Scripting Interpreter",
        "tactic": "Execution",
        "description": "Adversaries may abuse command and script interpreters to execute commands.",
        "kill_chain_stage": "installation",
        "indicators": [
            "command_execution",
            "script_execution",
            "powershell",
            "bash_command",
            "cmd_execution",
            "shell_command",
            "scripting",
        ],
    },
    "T1059.001": {
        "name": "PowerShell",
        "tactic": "Execution",
        "description": "Adversaries may abuse PowerShell for execution.",
        "kill_chain_stage": "installation",
        "indicators": ["powershell", "ps1_script", "encoded_command", "invoke_expression"],
    },
    "T1059.003": {
        "name": "Windows Command Shell",
        "tactic": "Execution",
        "description": "Adversaries may abuse the Windows command shell for execution.",
        "kill_chain_stage": "installation",
        "indicators": ["cmd_exe", "batch_file", "command_prompt"],
    },
    "T1204": {
        "name": "User Execution",
        "tactic": "Execution",
        "description": "Adversaries may rely on a user opening a malicious file or link.",
        "kill_chain_stage": "exploitation",
        "indicators": [
            "user_click",
            "malicious_file_open",
            "macro_execution",
            "social_engineering",
        ],
    },
    "T1203": {
        "name": "Exploitation for Client Execution",
        "tactic": "Execution",
        "description": "Adversaries may exploit software vulnerabilities in client applications.",
        "kill_chain_stage": "exploitation",
        "indicators": ["client_exploit", "browser_exploit", "pdf_exploit", "office_exploit"],
    },
    # --- Persistence ---
    "T1547": {
        "name": "Boot or Logon Autostart Execution",
        "tactic": "Persistence",
        "description": "Adversaries may configure system settings for persistent execution.",
        "kill_chain_stage": "installation",
        "indicators": ["autostart", "registry_run_key", "startup_folder", "boot_persistence"],
    },
    "T1053": {
        "name": "Scheduled Task/Job",
        "tactic": "Persistence",
        "description": "Adversaries may abuse task scheduling for persistent execution.",
        "kill_chain_stage": "installation",
        "indicators": ["scheduled_task", "cron_job", "at_job", "task_scheduler"],
    },
    "T1136": {
        "name": "Create Account",
        "tactic": "Persistence",
        "description": "Adversaries may create an account to maintain access.",
        "kill_chain_stage": "installation",
        "indicators": ["account_creation", "new_user", "unauthorized_account", "backdoor_account"],
    },
    # --- Privilege Escalation ---
    "T1068": {
        "name": "Exploitation for Privilege Escalation",
        "tactic": "Privilege Escalation",
        "description": "Adversaries may exploit vulnerabilities to escalate privileges.",
        "kill_chain_stage": "exploitation",
        "indicators": ["privilege_escalation", "local_exploit", "kernel_exploit", "elevation"],
    },
    # --- Defense Evasion ---
    "T1070": {
        "name": "Indicator Removal",
        "tactic": "Defense Evasion",
        "description": "Adversaries may delete or modify artifacts to remove evidence.",
        "kill_chain_stage": "installation",
        "indicators": [
            "log_deletion",
            "log_tampering",
            "evidence_removal",
            "artifact_cleanup",
            "clear_logs",
            "indicator_removal",
        ],
    },
    "T1562": {
        "name": "Impair Defenses",
        "tactic": "Defense Evasion",
        "description": "Adversaries may maliciously modify security tools to avoid detection.",
        "kill_chain_stage": "installation",
        "indicators": [
            "disable_antivirus",
            "disable_firewall",
            "security_tool_disabled",
            "tamper_protection",
            "defense_evasion",
        ],
    },
    "T1027": {
        "name": "Obfuscated Files or Information",
        "tactic": "Defense Evasion",
        "description": "Adversaries may obfuscate files or information to evade detection.",
        "kill_chain_stage": "delivery",
        "indicators": ["obfuscation", "encoded_payload", "packed_binary", "encrypted_payload"],
    },
    # --- Credential Access ---
    "T1003": {
        "name": "OS Credential Dumping",
        "tactic": "Credential Access",
        "description": "Adversaries may dump credentials from OS credential stores.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": [
            "credential_dump",
            "mimikatz",
            "lsass_access",
            "sam_dump",
            "ntds_dump",
            "password_dump",
        ],
    },
    "T1552": {
        "name": "Unsecured Credentials",
        "tactic": "Credential Access",
        "description": "Adversaries may search for unsecured credentials in various locations.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": [
            "credential_file",
            "password_file",
            "config_credential",
            "hardcoded_password",
        ],
    },
    # --- Discovery ---
    "T1046": {
        "name": "Network Service Discovery",
        "tactic": "Discovery",
        "description": "Adversaries may attempt to discover services running on remote hosts.",
        "kill_chain_stage": "reconnaissance",
        "indicators": ["service_scan", "port_scan", "network_discovery", "service_enumeration"],
    },
    "T1087": {
        "name": "Account Discovery",
        "tactic": "Discovery",
        "description": "Adversaries may attempt to get a listing of accounts on a system.",
        "kill_chain_stage": "reconnaissance",
        "indicators": ["account_enumeration", "user_listing", "directory_query", "ad_enumeration"],
    },
    # --- Lateral Movement ---
    "T1021": {
        "name": "Remote Services",
        "tactic": "Lateral Movement",
        "description": "Adversaries may use remote services to move laterally.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": [
            "lateral_movement",
            "rdp_lateral",
            "ssh_lateral",
            "smb_lateral",
            "remote_service",
            "psexec",
        ],
    },
    "T1570": {
        "name": "Lateral Tool Transfer",
        "tactic": "Lateral Movement",
        "description": "Adversaries may transfer tools between systems within a network.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["tool_transfer", "file_copy_lateral", "smb_transfer", "internal_transfer"],
    },
    # --- Collection ---
    "T1005": {
        "name": "Data from Local System",
        "tactic": "Collection",
        "description": "Adversaries may search local system sources for data of interest.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["data_collection", "file_access", "sensitive_data_access", "data_staging"],
    },
    "T1114": {
        "name": "Email Collection",
        "tactic": "Collection",
        "description": "Adversaries may target user email to collect sensitive information.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["email_access", "mailbox_access", "email_forwarding", "email_collection"],
    },
    # --- Command and Control ---
    "T1071": {
        "name": "Application Layer Protocol",
        "tactic": "Command and Control",
        "description": "Adversaries may communicate using application layer protocols.",
        "kill_chain_stage": "command_and_control",
        "indicators": [
            "c2_http",
            "c2_https",
            "c2_dns",
            "beacon",
            "command_control",
            "c2_communication",
            "callback",
        ],
    },
    "T1571": {
        "name": "Non-Standard Port",
        "tactic": "Command and Control",
        "description": "Adversaries may communicate over a non-standard port.",
        "kill_chain_stage": "command_and_control",
        "indicators": ["non_standard_port", "unusual_port", "covert_channel"],
    },
    "T1573": {
        "name": "Encrypted Channel",
        "tactic": "Command and Control",
        "description": "Adversaries may employ encryption to conceal C2 communications.",
        "kill_chain_stage": "command_and_control",
        "indicators": ["encrypted_c2", "ssl_c2", "tls_tunnel", "encrypted_channel"],
    },
    "T1105": {
        "name": "Ingress Tool Transfer",
        "tactic": "Command and Control",
        "description": "Adversaries may transfer tools from an external system into the environment.",
        "kill_chain_stage": "command_and_control",
        "indicators": ["tool_download", "payload_download", "malware_download", "dropper"],
    },
    # --- Exfiltration ---
    "T1041": {
        "name": "Exfiltration Over C2 Channel",
        "tactic": "Exfiltration",
        "description": "Adversaries may steal data by exfiltrating it over the C2 channel.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["data_exfiltration", "exfil_c2", "data_theft", "outbound_transfer"],
    },
    "T1048": {
        "name": "Exfiltration Over Alternative Protocol",
        "tactic": "Exfiltration",
        "description": "Adversaries may steal data by exfiltrating over an alternative protocol.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": [
            "dns_exfiltration",
            "icmp_exfiltration",
            "ftp_exfiltration",
            "alternative_protocol_exfil",
        ],
    },
    "T1567": {
        "name": "Exfiltration Over Web Service",
        "tactic": "Exfiltration",
        "description": "Adversaries may use web services to exfiltrate data.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["cloud_exfil", "web_upload", "pastebin_exfil", "cloud_storage_exfil"],
    },
    # --- Impact ---
    "T1486": {
        "name": "Data Encrypted for Impact",
        "tactic": "Impact",
        "description": "Adversaries may encrypt data on targets to interrupt availability.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["ransomware", "file_encryption", "crypto_locker", "ransom_note"],
    },
    "T1498": {
        "name": "Network Denial of Service",
        "tactic": "Impact",
        "description": "Adversaries may perform network denial of service attacks to degrade or block availability.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": [
            "network_dos",
            "ddos",
            "reflection_attack",
            "amplification_attack",
            "flood_attack",
            "bandwidth_exhaustion",
        ],
    },
    "T1499": {
        "name": "Endpoint Denial of Service",
        "tactic": "Impact",
        "description": "Adversaries may perform denial of service attacks on endpoints.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": [
            "ddos",
            "dos_attack",
            "service_disruption",
            "resource_exhaustion",
            "denial_of_service",
            "flood_attack",
        ],
    },
    "T1485": {
        "name": "Data Destruction",
        "tactic": "Impact",
        "description": "Adversaries may destroy data on specific systems or in large numbers.",
        "kill_chain_stage": "actions_on_objectives",
        "indicators": ["data_destruction", "data_wipe", "disk_wipe", "file_deletion_mass"],
    },
}

# Alert type to MITRE technique mapping for quick lookup
ALERT_TYPE_TECHNIQUE_MAP: Dict[str, List[str]] = {
    "malware": ["T1204", "T1059", "T1547", "T1105", "T1071", "T1486"],
    "phishing": ["T1566", "T1566.001", "T1566.002", "T1204", "T1078"],
    "brute_force": ["T1110", "T1110.001", "T1110.003", "T1078"],
    "ddos": ["T1499", "T1498"],
    "data_exfiltration": ["T1041", "T1048", "T1567", "T1005", "T1114"],
    "unauthorized_access": ["T1078", "T1133", "T1021", "T1068"],
    "anomaly": ["T1071", "T1571", "T1573", "T1046"],
    "other": [],
}


# =============================================================================
# Kill Chain Stages
# =============================================================================

KILL_CHAIN_STAGES = {
    "reconnaissance": {
        "order": 1,
        "name": "Reconnaissance",
        "description": "Adversary is gathering information about the target.",
        "typical_techniques": ["T1595", "T1592", "T1589", "T1046", "T1087"],
    },
    "weaponization": {
        "order": 2,
        "name": "Weaponization",
        "description": "Adversary is creating or modifying exploits and payloads.",
        "typical_techniques": ["T1027", "T1587", "T1588"],
    },
    "delivery": {
        "order": 3,
        "name": "Delivery",
        "description": "Adversary is transmitting the weapon to the target environment.",
        "typical_techniques": ["T1566", "T1566.001", "T1566.002", "T1133", "T1027"],
    },
    "exploitation": {
        "order": 4,
        "name": "Exploitation",
        "description": "Adversary is exploiting a vulnerability to gain access.",
        "typical_techniques": ["T1190", "T1203", "T1204", "T1110", "T1078", "T1068"],
    },
    "installation": {
        "order": 5,
        "name": "Installation",
        "description": "Adversary is installing malware or establishing persistence.",
        "typical_techniques": ["T1059", "T1547", "T1053", "T1136", "T1070", "T1562"],
    },
    "command_and_control": {
        "order": 6,
        "name": "Command and Control",
        "description": "Adversary is establishing a C2 channel for remote control.",
        "typical_techniques": ["T1071", "T1571", "T1573", "T1105"],
    },
    "actions_on_objectives": {
        "order": 7,
        "name": "Actions on Objectives",
        "description": "Adversary is accomplishing their goal (data theft, destruction, etc.).",
        "typical_techniques": [
            "T1041",
            "T1048",
            "T1567",
            "T1021",
            "T1570",
            "T1005",
            "T1003",
            "T1486",
            "T1499",
            "T1485",
        ],
    },
}


# =============================================================================
# Kill Chain Stage Classifier
# =============================================================================


def classify_kill_chain_stage(
    alert_type: str,
    description: str,
    iocs: Optional[Dict[str, Any]] = None,
    matched_techniques: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Classify alert into kill chain stage based on alert data.

    Args:
        alert_type: Type of the security alert
        description: Alert description text
        iocs: Indicators of compromise from the alert
        matched_techniques: Already-matched MITRE technique IDs

    Returns:
        Kill chain classification with stage, confidence, and reasoning
    """
    stage_scores: Dict[str, float] = {stage: 0.0 for stage in KILL_CHAIN_STAGES}
    reasons: List[str] = []

    description_lower = description.lower() if description else ""

    # Score based on alert type
    alert_type_stage_map = {
        "malware": {"installation": 0.4, "command_and_control": 0.3, "actions_on_objectives": 0.2},
        "phishing": {"delivery": 0.6, "exploitation": 0.3},
        "brute_force": {"exploitation": 0.6, "reconnaissance": 0.2},
        "ddos": {"actions_on_objectives": 0.7},
        "data_exfiltration": {"actions_on_objectives": 0.7, "command_and_control": 0.2},
        "unauthorized_access": {"exploitation": 0.4, "actions_on_objectives": 0.3},
        "anomaly": {"reconnaissance": 0.3, "command_and_control": 0.3},
    }

    type_scores = alert_type_stage_map.get(alert_type, {})
    for stage, score in type_scores.items():
        stage_scores[stage] += score
        if score > 0.3:
            reasons.append(f"Alert type '{alert_type}' strongly indicates {stage}")

    # Score based on description keywords
    keyword_stage_map = {
        "reconnaissance": ["scan", "enumerat", "discover", "probe", "fingerprint", "recon"],
        "weaponization": ["craft", "payload", "weaponiz", "exploit kit", "obfuscat"],
        "delivery": ["email", "phish", "attachment", "download", "deliver", "dropper"],
        "exploitation": ["exploit", "vulnerab", "brute", "injection", "overflow", "bypass"],
        "installation": [
            "install",
            "persist",
            "backdoor",
            "implant",
            "trojan",
            "rootkit",
            "registry",
            "scheduled task",
            "service creat",
        ],
        "command_and_control": [
            "c2",
            "c&c",
            "command and control",
            "beacon",
            "callback",
            "reverse shell",
            "tunnel",
        ],
        "actions_on_objectives": [
            "exfiltrat",
            "encrypt",
            "ransom",
            "destroy",
            "steal",
            "lateral",
            "dump",
            "credential",
        ],
    }

    for stage, keywords in keyword_stage_map.items():
        for keyword in keywords:
            if keyword in description_lower:
                stage_scores[stage] += 0.15
                reasons.append(f"Keyword '{keyword}' in description suggests {stage}")

    # Score based on matched MITRE techniques
    if matched_techniques:
        for tech_id in matched_techniques:
            tech = MITRE_TECHNIQUES.get(tech_id)
            if tech:
                tech_stage = tech["kill_chain_stage"]
                stage_scores[tech_stage] += 0.25
                reasons.append(f"Technique {tech_id} ({tech['name']}) maps to {tech_stage}")

    # Score based on IOCs
    if iocs:
        if iocs.get("file_hashes") or iocs.get("file_hash"):
            stage_scores["installation"] += 0.1
            stage_scores["delivery"] += 0.1
        if iocs.get("urls") or iocs.get("url"):
            stage_scores["delivery"] += 0.1
            stage_scores["command_and_control"] += 0.1
        if iocs.get("ip_addresses") or iocs.get("source_ip"):
            stage_scores["command_and_control"] += 0.1
            stage_scores["reconnaissance"] += 0.05

    # Determine primary stage
    primary_stage = max(stage_scores, key=stage_scores.get)
    max_score = stage_scores[primary_stage]

    # Calculate confidence based on score distribution
    total_score = sum(stage_scores.values())
    confidence = (max_score / total_score) if total_score > 0 else 0.0
    confidence = min(confidence, 1.0)

    # Determine secondary stages (any stage with > 50% of primary score)
    secondary_stages = [
        stage
        for stage, score in stage_scores.items()
        if stage != primary_stage and score > max_score * 0.5 and score > 0
    ]

    stage_info = KILL_CHAIN_STAGES[primary_stage]

    return {
        "primary_stage": primary_stage,
        "stage_name": stage_info["name"],
        "stage_order": stage_info["order"],
        "stage_description": stage_info["description"],
        "confidence": round(confidence, 3),
        "secondary_stages": secondary_stages,
        "stage_scores": {k: round(v, 3) for k, v in stage_scores.items() if v > 0},
        "reasoning": reasons[:10],  # Limit to top 10 reasons
    }


# =============================================================================
# TTP Extractor
# =============================================================================


def extract_ttps(
    alert_type: str,
    description: str,
    severity: str,
    source_ip: Optional[str] = None,
    target_ip: Optional[str] = None,
    file_hash: Optional[str] = None,
    url: Optional[str] = None,
    additional_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Extract Tactics, Techniques, and Procedures from alert data.

    Args:
        alert_type: Type of the security alert
        description: Alert description text
        severity: Alert severity level
        source_ip: Source IP address
        target_ip: Target IP address
        file_hash: File hash indicator
        url: URL indicator
        additional_data: Additional alert context

    Returns:
        Extracted TTPs with matched techniques and tactics
    """
    matched_techniques: List[Dict[str, Any]] = []
    matched_tactics: set = set()
    description_lower = description.lower() if description else ""

    # Match based on alert type
    type_techniques = ALERT_TYPE_TECHNIQUE_MAP.get(alert_type, [])
    for tech_id in type_techniques:
        if tech_id in MITRE_TECHNIQUES:
            tech = MITRE_TECHNIQUES[tech_id]
            matched_techniques.append(
                {
                    "technique_id": tech_id,
                    "technique_name": tech["name"],
                    "tactic": tech["tactic"],
                    "confidence": 0.7,
                    "match_source": "alert_type",
                }
            )
            matched_tactics.add(tech["tactic"])

    # Match based on description indicator keywords
    for tech_id, tech in MITRE_TECHNIQUES.items():
        # Skip if already matched via alert type
        if any(m["technique_id"] == tech_id for m in matched_techniques):
            continue

        indicator_match_count = 0
        matched_indicators = []
        for indicator in tech["indicators"]:
            # Check if indicator appears in description (handle underscores as spaces too)
            indicator_pattern = indicator.replace("_", "[_ ]")
            if re.search(indicator_pattern, description_lower):
                indicator_match_count += 1
                matched_indicators.append(indicator)

        if indicator_match_count > 0:
            confidence = min(0.5 + (indicator_match_count * 0.15), 0.95)
            matched_techniques.append(
                {
                    "technique_id": tech_id,
                    "technique_name": tech["name"],
                    "tactic": tech["tactic"],
                    "confidence": round(confidence, 3),
                    "match_source": "description_indicators",
                    "matched_indicators": matched_indicators,
                }
            )
            matched_tactics.add(tech["tactic"])

    # Additional matching based on IOC presence
    if file_hash:
        _add_ioc_technique(matched_techniques, matched_tactics, "T1204", "file_hash_present", 0.5)
        _add_ioc_technique(matched_techniques, matched_tactics, "T1105", "file_hash_present", 0.4)

    if url:
        _add_ioc_technique(matched_techniques, matched_tactics, "T1071", "url_present", 0.4)
        if "phish" in description_lower or alert_type == "phishing":
            _add_ioc_technique(
                matched_techniques, matched_tactics, "T1566.002", "url_with_phishing_context", 0.7
            )

    # Sort by confidence descending
    matched_techniques.sort(key=lambda x: x["confidence"], reverse=True)

    # Deduplicate (keep highest confidence)
    seen_ids = set()
    unique_techniques = []
    for tech in matched_techniques:
        if tech["technique_id"] not in seen_ids:
            seen_ids.add(tech["technique_id"])
            unique_techniques.append(tech)

    return {
        "techniques": unique_techniques,
        "tactics": sorted(matched_tactics),
        "technique_count": len(unique_techniques),
        "tactic_count": len(matched_tactics),
        "primary_tactic": unique_techniques[0]["tactic"] if unique_techniques else None,
    }


def _add_ioc_technique(
    matched_techniques: List[Dict[str, Any]],
    matched_tactics: set,
    tech_id: str,
    match_source: str,
    confidence: float,
) -> None:
    """
    Add a technique match from IOC evidence if not already present with higher confidence.

    Args:
        matched_techniques: List to append to
        matched_tactics: Set of matched tactics
        tech_id: Technique ID
        match_source: Source of the match
        confidence: Confidence score
    """
    if tech_id not in MITRE_TECHNIQUES:
        return

    # Check if already matched with higher confidence
    for existing in matched_techniques:
        if existing["technique_id"] == tech_id and existing["confidence"] >= confidence:
            return

    tech = MITRE_TECHNIQUES[tech_id]
    matched_techniques.append(
        {
            "technique_id": tech_id,
            "technique_name": tech["name"],
            "tactic": tech["tactic"],
            "confidence": confidence,
            "match_source": match_source,
        }
    )
    matched_tactics.add(tech["tactic"])


# =============================================================================
# Next Step Predictor
# =============================================================================


# Transition probabilities: from_stage -> [(to_stage, probability, description)]
KILL_CHAIN_TRANSITIONS: Dict[str, List[Tuple[str, float, str]]] = {
    "reconnaissance": [
        ("weaponization", 0.4, "Adversary may develop custom exploits or payloads"),
        ("delivery", 0.35, "Adversary may attempt to deliver initial access payload"),
        ("exploitation", 0.2, "Adversary may directly attempt exploitation of discovered services"),
        ("reconnaissance", 0.05, "Adversary may continue gathering additional information"),
    ],
    "weaponization": [
        ("delivery", 0.7, "Weaponized payload is ready for delivery to target"),
        ("reconnaissance", 0.2, "Adversary may gather more info to refine weapon"),
        ("weaponization", 0.1, "Adversary may refine or create additional payloads"),
    ],
    "delivery": [
        ("exploitation", 0.6, "Delivered payload may trigger vulnerability exploitation"),
        ("installation", 0.2, "Direct installation if delivery bypasses defenses"),
        ("delivery", 0.1, "Adversary may attempt alternative delivery methods"),
        ("reconnaissance", 0.1, "Failed delivery may cause adversary to reassess"),
    ],
    "exploitation": [
        ("installation", 0.5, "Successful exploitation typically leads to persistence setup"),
        ("command_and_control", 0.25, "Adversary may immediately establish C2 channel"),
        (
            "actions_on_objectives",
            0.15,
            "Quick smash-and-grab if objective is immediately accessible",
        ),
        ("exploitation", 0.1, "Adversary may exploit additional vulnerabilities"),
    ],
    "installation": [
        ("command_and_control", 0.5, "Installed implant will establish C2 communications"),
        ("actions_on_objectives", 0.3, "Adversary may begin working toward objectives"),
        ("exploitation", 0.1, "Adversary may seek to escalate privileges"),
        ("installation", 0.1, "Adversary may install additional persistence mechanisms"),
    ],
    "command_and_control": [
        ("actions_on_objectives", 0.6, "C2 channel enables adversary to pursue objectives"),
        ("installation", 0.15, "Adversary may deploy additional tools via C2"),
        ("reconnaissance", 0.15, "Internal reconnaissance via C2 channel"),
        ("command_and_control", 0.1, "Adversary may establish backup C2 channels"),
    ],
    "actions_on_objectives": [
        ("actions_on_objectives", 0.4, "Adversary may pursue additional objectives"),
        ("command_and_control", 0.2, "Adversary may exfiltrate data via C2"),
        ("reconnaissance", 0.2, "Adversary may perform internal recon for lateral movement"),
        ("installation", 0.2, "Adversary may establish persistence on additional systems"),
    ],
}


def predict_next_steps(
    current_stage: str,
    matched_techniques: Optional[List[str]] = None,
    severity: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Predict likely next attack steps based on current kill chain stage.

    Args:
        current_stage: Current kill chain stage identifier
        matched_techniques: Currently matched technique IDs
        severity: Alert severity for urgency assessment

    Returns:
        Prediction with likely next stages, techniques, and recommendations
    """
    transitions = KILL_CHAIN_TRANSITIONS.get(current_stage, [])

    predictions = []
    for next_stage, probability, description in transitions:
        stage_info = KILL_CHAIN_STAGES.get(next_stage, {})
        typical_techniques = stage_info.get("typical_techniques", [])

        # Build technique details
        technique_details = []
        for tech_id in typical_techniques:
            if tech_id in MITRE_TECHNIQUES:
                tech = MITRE_TECHNIQUES[tech_id]
                technique_details.append(
                    {
                        "technique_id": tech_id,
                        "technique_name": tech["name"],
                        "tactic": tech["tactic"],
                    }
                )

        predictions.append(
            {
                "next_stage": next_stage,
                "stage_name": stage_info.get("name", next_stage),
                "probability": probability,
                "description": description,
                "expected_techniques": technique_details[:5],  # Top 5
            }
        )

    # Sort by probability descending
    predictions.sort(key=lambda x: x["probability"], reverse=True)

    # Generate defensive recommendations
    recommendations = _generate_recommendations(current_stage, predictions, severity)

    current_info = KILL_CHAIN_STAGES.get(current_stage, {})

    return {
        "current_stage": current_stage,
        "current_stage_name": current_info.get("name", current_stage),
        "current_stage_order": current_info.get("order", 0),
        "predictions": predictions,
        "most_likely_next": predictions[0] if predictions else None,
        "recommendations": recommendations,
        "urgency": _calculate_urgency(current_stage, severity),
    }


def _generate_recommendations(
    current_stage: str,
    predictions: List[Dict[str, Any]],
    severity: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    Generate defensive recommendations based on predicted next steps.

    Args:
        current_stage: Current kill chain stage
        predictions: Predicted next steps
        severity: Alert severity

    Returns:
        List of defensive recommendations
    """
    recommendations = []

    stage_recommendations = {
        "reconnaissance": [
            {"action": "Monitor network traffic for scanning activity", "priority": "medium"},
            {
                "action": "Review firewall rules for unnecessary exposed services",
                "priority": "high",
            },
            {
                "action": "Enable IDS/IPS signatures for reconnaissance detection",
                "priority": "medium",
            },
        ],
        "weaponization": [
            {
                "action": "Update email filtering rules for malicious attachments",
                "priority": "high",
            },
            {"action": "Ensure endpoint protection signatures are current", "priority": "high"},
            {"action": "Review application whitelisting policies", "priority": "medium"},
        ],
        "delivery": [
            {"action": "Block known malicious sender domains and IPs", "priority": "critical"},
            {"action": "Quarantine suspicious email attachments", "priority": "critical"},
            {"action": "Alert users about phishing campaign indicators", "priority": "high"},
        ],
        "exploitation": [
            {
                "action": "Apply emergency patches for exploited vulnerabilities",
                "priority": "critical",
            },
            {"action": "Isolate affected systems from the network", "priority": "critical"},
            {"action": "Enable enhanced logging on affected systems", "priority": "high"},
            {
                "action": "Lock compromised accounts and force password resets",
                "priority": "critical",
            },
        ],
        "installation": [
            {"action": "Perform full malware scan on affected systems", "priority": "critical"},
            {"action": "Review startup items and scheduled tasks", "priority": "high"},
            {"action": "Check for newly created user accounts", "priority": "high"},
            {"action": "Monitor for persistence mechanisms", "priority": "high"},
        ],
        "command_and_control": [
            {"action": "Block identified C2 domains and IPs at perimeter", "priority": "critical"},
            {"action": "Inspect DNS traffic for tunneling or DGA domains", "priority": "high"},
            {"action": "Review outbound connection patterns for anomalies", "priority": "high"},
            {"action": "Isolate compromised hosts from network", "priority": "critical"},
        ],
        "actions_on_objectives": [
            {"action": "Immediately isolate affected systems", "priority": "critical"},
            {"action": "Preserve forensic evidence before remediation", "priority": "critical"},
            {"action": "Assess data exposure and begin incident response", "priority": "critical"},
            {"action": "Notify CISO and activate incident response plan", "priority": "critical"},
            {
                "action": "Monitor for lateral movement to additional systems",
                "priority": "critical",
            },
        ],
    }

    # Add recommendations for current stage
    current_recs = stage_recommendations.get(current_stage, [])
    recommendations.extend(current_recs)

    # Add recommendations for the most likely next stage
    if predictions:
        next_stage = predictions[0]["next_stage"]
        next_recs = stage_recommendations.get(next_stage, [])
        for rec in next_recs[:2]:  # Top 2 from next stage
            rec_copy = dict(rec)
            rec_copy["action"] = f"[Preemptive] {rec_copy['action']}"
            recommendations.append(rec_copy)

    return recommendations


def _calculate_urgency(current_stage: str, severity: Optional[str] = None) -> str:
    """
    Calculate urgency level based on kill chain stage and severity.

    Args:
        current_stage: Current kill chain stage
        severity: Alert severity

    Returns:
        Urgency level string
    """
    stage_order = KILL_CHAIN_STAGES.get(current_stage, {}).get("order", 0)

    # Later stages are more urgent
    if stage_order >= 6:  # C2 or Actions on Objectives
        return "critical"
    elif stage_order >= 4:  # Exploitation or Installation
        if severity in ("critical", "high"):
            return "critical"
        return "high"
    elif stage_order >= 3:  # Delivery
        if severity == "critical":
            return "high"
        return "medium"
    else:  # Reconnaissance or Weaponization
        return "low"


# =============================================================================
# Alert Analysis Orchestrator
# =============================================================================


async def analyze_alert(alert: SecurityAlert) -> Dict[str, Any]:
    """
    Perform full attack chain analysis on an alert.

    Args:
        alert: SecurityAlert object to analyze

    Returns:
        Complete attack chain analysis result
    """
    logger.info(f"Analyzing attack chain for alert {alert.alert_id}")

    alert_type = (
        alert.alert_type.value if hasattr(alert.alert_type, "value") else str(alert.alert_type)
    )
    severity = alert.severity.value if hasattr(alert.severity, "value") else str(alert.severity)

    # Build IOCs dict from alert
    iocs = {}
    if alert.source_ip:
        iocs["source_ip"] = alert.source_ip
    if alert.target_ip:
        iocs["target_ip"] = alert.target_ip
    if alert.file_hash:
        iocs["file_hash"] = alert.file_hash
    if alert.url:
        iocs["url"] = alert.url

    # Step 1: Extract TTPs
    ttps = extract_ttps(
        alert_type=alert_type,
        description=alert.description,
        severity=severity,
        source_ip=alert.source_ip,
        target_ip=alert.target_ip,
        file_hash=getattr(alert, "file_hash", None),
        url=getattr(alert, "url", None),
    )

    # Step 2: Classify kill chain stage
    matched_technique_ids = [t["technique_id"] for t in ttps["techniques"]]
    kill_chain = classify_kill_chain_stage(
        alert_type=alert_type,
        description=alert.description,
        iocs=iocs,
        matched_techniques=matched_technique_ids,
    )

    # Step 3: Predict next steps
    predictions = predict_next_steps(
        current_stage=kill_chain["primary_stage"],
        matched_techniques=matched_technique_ids,
        severity=severity,
    )

    # Update metrics
    metrics["alerts_analyzed"] += 1
    metrics["techniques_identified"] += ttps["technique_count"]
    metrics["kill_chain_classifications"] += 1
    metrics["predictions_made"] += 1

    analysis_result = {
        "alert_id": alert.alert_id,
        "analyzed_at": datetime.utcnow().isoformat(),
        "alert_type": alert_type,
        "severity": severity,
        "ttps": ttps,
        "kill_chain": kill_chain,
        "predictions": predictions,
        "summary": {
            "primary_tactic": ttps.get("primary_tactic"),
            "technique_count": ttps["technique_count"],
            "kill_chain_stage": kill_chain["stage_name"],
            "kill_chain_confidence": kill_chain["confidence"],
            "urgency": predictions["urgency"],
            "most_likely_next_stage": (
                predictions["most_likely_next"]["stage_name"]
                if predictions.get("most_likely_next")
                else None
            ),
        },
    }

    logger.info(
        f"Attack chain analysis complete for alert {alert.alert_id}: "
        f"stage={kill_chain['stage_name']}, techniques={ttps['technique_count']}, "
        f"urgency={predictions['urgency']}"
    )

    return analysis_result


# =============================================================================
# Database Persistence
# =============================================================================


async def persist_analysis_to_db(alert_id: str, analysis: Dict[str, Any]):
    """
    Persist attack chain analysis to database.

    Args:
        alert_id: Alert identifier
        analysis: Analysis result dictionary
    """
    try:
        async with db_manager.get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO alert_context (alert_id, context_type, context_data, source, confidence_score)
                    VALUES (:alert_id, :context_type, :context_data, :source, :confidence_score)
                """),
                {
                    "alert_id": alert_id,
                    "context_type": "attack_chain",
                    "context_data": json.dumps(analysis),
                    "source": "attack-chain-analyzer",
                    "confidence_score": analysis.get("kill_chain", {}).get("confidence", 0.5),
                },
            )
            await session.commit()
            logger.debug(f"Attack chain analysis persisted for alert {alert_id}")

    except Exception as e:
        logger.error(f"Failed to persist analysis: {e}", exc_info=True)


# =============================================================================
# FastAPI Application
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global db_manager, publisher, consumer

    logger.info("Starting Attack Chain Analyzer Service")

    try:
        # Initialize database
        await init_database(
            database_url=config.database_url,
            pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
            echo=config.debug,
        )
        db_manager = get_database_manager()
        logger.info("Database connected")

        # Initialize message publisher
        publisher = MessagePublisher(config.rabbitmq_url)
        await publisher.connect()
        logger.info("Message publisher connected")

        # Initialize message consumer
        consumer = MessageConsumer(config.rabbitmq_url, "alert.triaged")
        await consumer.connect()
        logger.info("Message consumer connected")

        # Start message consumer task
        asyncio.create_task(consume_triaged_alerts())
        logger.info("Message consumer task started")

        logger.info("Attack Chain Analyzer Service started successfully")

        yield

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise

    finally:
        logger.info("Shutting down Attack Chain Analyzer Service")

        if consumer:
            await consumer.close()
            logger.info("Message consumer closed")

        if publisher:
            await publisher.close()
            logger.info("Message publisher closed")

        await close_database()
        logger.info("Database connection closed")

        logger.info("Attack Chain Analyzer Service stopped")


# Create FastAPI app
app = FastAPI(
    title="Attack Chain Analyzer API",
    description="MITRE ATT&CK mapping, kill chain classification, and attack prediction",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Background Task: Message Consumer
# =============================================================================


async def consume_triaged_alerts():
    """Consume triaged alerts and perform attack chain analysis."""

    async def process_message(message: dict):
        try:
            # Unwrap message envelope if present
            if "data" in message and isinstance(message["data"], dict):
                actual_message = message["data"]
                meta = message.get("_meta", {})
                message_id = meta.get("message_id", message.get("message_id", "unknown"))
            else:
                actual_message = message
                message_id = message.get("message_id", "unknown")

            payload = actual_message.get("payload", actual_message)

            # Handle both single alerts and batch
            alerts_to_process = []

            if isinstance(payload, list):
                logger.info(f"Processing batch message {message_id} with {len(payload)} alerts")
                alerts_to_process = payload
            elif isinstance(payload, dict):
                logger.info(f"Processing single alert message {message_id}")
                # The payload might contain alert data directly or nested under 'alert'
                alert_data = payload.get("alert", payload)
                alerts_to_process = [alert_data]
            else:
                logger.warning(f"Unexpected payload type: {type(payload)}")
                return

            for alert_data in alerts_to_process:
                try:
                    alert = SecurityAlert(**alert_data)

                    # Perform attack chain analysis
                    analysis = await analyze_alert(alert)

                    # Persist to database
                    await persist_analysis_to_db(alert.alert_id, analysis)

                    # Create analyzed message
                    analyzed_message = {
                        "message_id": str(uuid.uuid4()),
                        "message_type": "alert.analyzed",
                        "correlation_id": alert.alert_id,
                        "original_message_id": message_id,
                        "timestamp": datetime.utcnow().isoformat(),
                        "version": "1.0",
                        "payload": {
                            "alert": alert.model_dump(),
                            "attack_chain_analysis": analysis,
                        },
                    }

                    # Publish analyzed alert
                    await publisher.publish("alert.analyzed", analyzed_message)

                    logger.info(
                        f"Alert analyzed and published "
                        f"(message_id: {message_id}, alert_id: {alert.alert_id}, "
                        f"stage: {analysis['kill_chain']['stage_name']})"
                    )

                except Exception as e:
                    logger.error(
                        f"Failed to analyze alert {alert_data.get('alert_id', 'unknown')}: {e}",
                        exc_info=True,
                    )
                    metrics["errors"] += 1
                    continue

        except Exception as e:
            logger.error(f"Attack chain analysis failed: {e}", exc_info=True)
            metrics["errors"] += 1
            raise

    # Start consuming
    await consumer.consume(process_message)


# =============================================================================
# API Endpoints
# =============================================================================


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    try:
        return {
            "status": "healthy",
            "service": "attack-chain-analyzer",
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "database": "connected" if db_manager else "disconnected",
                "message_queue_consumer": "connected" if consumer else "disconnected",
                "message_queue_publisher": "connected" if publisher else "disconnected",
            },
            "mitre_techniques_loaded": len(MITRE_TECHNIQUES),
            "kill_chain_stages_loaded": len(KILL_CHAIN_STAGES),
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "attack-chain-analyzer",
            "error": str(e),
        }


@app.get("/metrics", tags=["Metrics"])
async def get_metrics():
    """Get attack chain analyzer metrics."""
    return {
        "service": "attack-chain-analyzer",
        "timestamp": datetime.utcnow().isoformat(),
        "counters": metrics,
        "mitre_techniques_count": len(MITRE_TECHNIQUES),
        "kill_chain_stages_count": len(KILL_CHAIN_STAGES),
    }


@app.post("/api/v1/analyze/{alert_id}", tags=["Analysis"])
async def analyze_alert_endpoint(alert_id: str, alert: SecurityAlert):
    """
    Analyze an alert for attack chain indicators.

    Performs MITRE ATT&CK mapping, kill chain classification,
    TTP extraction, and next step prediction.

    Args:
        alert_id: Alert identifier (path parameter)
        alert: SecurityAlert to analyze (request body)

    Returns:
        Complete attack chain analysis result
    """
    try:
        if alert.alert_id != alert_id:
            raise HTTPException(
                status_code=400,
                detail="Alert ID in path does not match alert body",
            )

        analysis = await analyze_alert(alert)

        return {
            "success": True,
            "data": analysis,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": str(uuid.uuid4()),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis endpoint failed: {e}", exc_info=True)
        metrics["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.get("/api/v1/mitre/techniques", tags=["MITRE ATT&CK"])
async def list_mitre_techniques(
    tactic: Optional[str] = None,
    kill_chain_stage: Optional[str] = None,
):
    """
    List all loaded MITRE ATT&CK techniques.

    Args:
        tactic: Filter by tactic name (e.g., "Initial Access", "Execution")
        kill_chain_stage: Filter by kill chain stage (e.g., "delivery", "exploitation")

    Returns:
        List of MITRE ATT&CK techniques
    """
    techniques = []

    for tech_id, tech in MITRE_TECHNIQUES.items():
        if tactic and tech["tactic"].lower() != tactic.lower():
            continue
        if kill_chain_stage and tech["kill_chain_stage"] != kill_chain_stage:
            continue

        techniques.append(
            {
                "technique_id": tech_id,
                "name": tech["name"],
                "tactic": tech["tactic"],
                "kill_chain_stage": tech["kill_chain_stage"],
                "description": tech["description"],
            }
        )

    return {
        "success": True,
        "data": {
            "techniques": techniques,
            "total": len(techniques),
        },
        "meta": {
            "timestamp": datetime.utcnow().isoformat(),
            "request_id": str(uuid.uuid4()),
        },
    }


@app.get("/api/v1/killchain/stages", tags=["Kill Chain"])
async def list_kill_chain_stages():
    """
    List all kill chain stages with descriptions and typical techniques.

    Returns:
        List of kill chain stages in order
    """
    stages = []

    for stage_id, stage in sorted(KILL_CHAIN_STAGES.items(), key=lambda x: x[1]["order"]):
        # Resolve technique details
        technique_details = []
        for tech_id in stage["typical_techniques"]:
            if tech_id in MITRE_TECHNIQUES:
                tech = MITRE_TECHNIQUES[tech_id]
                technique_details.append(
                    {
                        "technique_id": tech_id,
                        "name": tech["name"],
                        "tactic": tech["tactic"],
                    }
                )

        stages.append(
            {
                "stage_id": stage_id,
                "order": stage["order"],
                "name": stage["name"],
                "description": stage["description"],
                "typical_techniques": technique_details,
            }
        )

    return {
        "success": True,
        "data": {
            "stages": stages,
            "total": len(stages),
        },
        "meta": {
            "timestamp": datetime.utcnow().isoformat(),
            "request_id": str(uuid.uuid4()),
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level=config.log_level.lower(),
    )
