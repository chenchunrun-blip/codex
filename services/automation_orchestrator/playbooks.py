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
SOAR Playbook Definitions for Security Alert Automation.

This module defines production-ready automation playbooks for common
security scenarios including malware, phishing, brute force, and data exfiltration.
"""

from typing import Any, Dict, List
from shared.models import AutomationPlaybook, PlaybookAction


# =============================================================================
# Malware Response Playbooks
# =============================================================================

MALWARE_CONTAINMENT_PLAYBOOK = AutomationPlaybook(
    playbook_id="malware-containment",
    name="Malware Host Containment",
    description="Isolate infected host and prevent lateral movement",
    version="1.0.0",
    actions=[
        PlaybookAction(
            action_id="block-network",
            action_type="firewall_rule",
            name="Block all network traffic from infected host",
            description="Add firewall rule to block all traffic from source IP",
            parameters={
                "rule_template": "block from {source_ip} any to any",
                "duration": "indefinite",
                "rule_comment": "Automated containment for malware alert {alert_id}",
            },
            timeout_seconds=30,
            rollback_action="remove_firewall_rule",
        ),
        PlaybookAction(
            action_id="isolate-vlan",
            action_type="network_change",
            name="Move host to quarantine VLAN",
            description="Move infected host to isolated quarantine network",
            parameters={
                "target_host": "{target_ip}",
                "current_vlan": "get_asset_vlan({target_ip})",
                "quarantine_vlan": "999",
                "vlan_change_reason": "Malware containment - alert {alert_id}",
            },
            timeout_seconds=60,
            rollback_action="restore_original_vlan",
        ),
        PlaybookAction(
            action_id="disable-account",
            action_type="ad_command",
            name="Disable affected user account",
            description="Disable AD account if user is logged in",
            parameters={
                "username": "{user_id}",
                "disable_reason": "Security incident - malware alert {alert_id}",
                "notify_user": True,
            },
            timeout_seconds=30,
            rollback_action="enable_ad_account",
        ),
        PlaybookAction(
            action_id="quarantine-file",
            action_type="edr_command",
            name="Quarantine malicious file via EDR",
            description="Send quarantine command to endpoint detection",
            parameters={
                "file_hash": "{file_hash}",
                "endpoint_ids": "get_endpoints_by_asset({asset_id})",
                "action": "quarantine",
            },
            timeout_seconds=120,
            rollback_action="restore_file",
        ),
        PlaybookAction(
            action_id="create-incident",
            action_type="api_call",
            name="Create security incident ticket",
            description="Create incident in ticketing system (ServiceNow/Jira)",
            parameters={
                "endpoint": "/api/incidents",
                "title": "Malware Incident - {alert_id}",
                "description": "Automated containment executed for malware detection",
                "severity": "high",
                "priority": "P1",
                "assignment_group": "security-operations",
            },
            timeout_seconds=30,
        ),
        PlaybookAction(
            action_id="notify-secops",
            action_type="notification",
            name="Notify security operations team",
            description="Send notification to SecOps team",
            parameters={
                "channels": ["slack", "email"],
                "recipients": ["secops@company.com", "#security-incidents"],
                "message": "Malware containment executed for alert {alert_id}. Host: {target_ip}, User: {user_id}",
                "severity": "high",
            },
            timeout_seconds=15,
        ),
    ],
    approval_required=True,
    timeout_seconds=600,
    trigger_conditions={
        "alert_type": ["malware", "malicious_code"],
        "risk_level": ["critical", "high"],
        "confidence": {"min": 70},
    },
    rollback_actions=[
        "remove_firewall_rule",
        "restore_original_vlan",
        "enable_ad_account",
        "restore_file",
    ],
)


RANSOMWARE_RESPONSE_PLAYBOOK = AutomationPlaybook(
    playbook_id="ransomware-response",
    name="Ransomware Emergency Response",
    description="Critical response for suspected ransomware infections",
    version="1.0.0",
    actions=[
        PlaybookAction(
            action_id="immediate-isolation",
            action_type="firewall_rule",
            name="Immediately isolate all network segments",
            description="Block all traffic to/from affected network segments",
            parameters={
                "isolate_mode": "full_segment",
                "affected_segments": "get_network_segments({target_ip})",
            },
            timeout_seconds=30,
            approval_required=True,
        ),
        PlaybookAction(
            action_id="shutdown-smb",
            action_type="network_change",
            name="Block SMB traffic across network",
            description="Prevent lateral movement via SMB",
            parameters={
                "protocol": "SMB",
                "action": "block",
                "scope": "enterprise",
            },
            timeout_seconds=20,
        ),
        PlaybookAction(
            action_id="snapshot-evidence",
            action_type="forensics",
            name="Preserve forensic evidence",
            description="Create memory/disk snapshots for analysis",
            parameters={
                "target_hosts": ["{target_ip}", "get_related_hosts({target_ip})"],
                "snapshot_type": "full",
                "preserve_artifacts": ["memory", "disk", "registry", "network"],
            },
            timeout_seconds=300,
        ),
        PlaybookAction(
            action_id="page-executive",
            action_type="notification",
            name="Page executive leadership",
            description="Executive notification for critical incident",
            parameters={
                "channels": ["pager", "sms", "phone"],
                "recipients": ["ciso", "cto", "ceo"],
                "urgency": "critical",
            },
            timeout_seconds=5,
        ),
        PlaybookAction(
            action_id="declare-incident",
            action_type="workflow_trigger",
            name="Trigger major incident response",
            description="Initiate major incident response plan",
            parameters={
                "incident_severity": "critical",
                "response_team": "full-incident-response",
                "war_room": True,
            },
            timeout_seconds=30,
        ),
    ],
    approval_required=False,  # Auto-approve for ransomware
    timeout_seconds=1800,  # 30 minutes
    trigger_conditions={
        "alert_type": ["malware", "data_exfiltration"],
        "risk_level": ["critical"],
        "indicators": ["ransomware", "encryption", "file_modification_pattern"],
    },
)


# =============================================================================
# Phishing Response Playbooks
# =============================================================================

PHISHING_EMAIL_CONTAINMENT_PLAYBOOK = AutomationPlaybook(
    playbook_id="phishing-email-containment",
    name="Phishing Email Containment",
    description="Automated response to phishing email detection",
    version="1.0.0",
    actions=[
        PlaybookAction(
            action_id="delete-email",
            action_type="email_action",
            name="Delete phishing emails from mailboxes",
            description="Remove phishing email from all user mailboxes",
            parameters={
                "email_subject": "{email_subject}",
                "email_sender": "{email_sender}",
                "mailboxes": "get_all_recipient_mailboxes({email_message_id})",
                "delete_mode": "soft_delete",
            },
            timeout_seconds=120,
        ),
        PlaybookAction(
            action_id="block-sender",
            action_type="email_filter",
            name="Block sender at email gateway",
            description="Add sender/domain to email blocklist",
            parameters={
                "block_type": "sender_and_domain",
                "sender": "{email_sender}",
                "domain": "extract_domain({email_sender})",
                "block_reason": "Phishing campaign - alert {alert_id}",
            },
            timeout_seconds=30,
            rollback_action="remove_email_filter",
        ),
        PlaybookAction(
            action_id="update-url-filters",
            action_type="security_filter",
            name="Block phishing URLs in web proxy",
            description="Add phishing URLs to web proxy blocklist",
            parameters={
                "urls": "{extracted_urls}",
                "block_reason": "Phishing - alert {alert_id}",
                "category": "phishing",
            },
            timeout_seconds=30,
            rollback_action="remove_url_filter",
        ),
        PlaybookAction(
            action_id="warn-users",
            action_type="notification",
            name="Send warning email to affected users",
            description="Notify users who received phishing email",
            parameters={
                "recipients": "get_affected_users({email_message_id})",
                "template": "phishing_warning",
                "include_email_preview": True,
                "include_security_tips": True,
            },
            timeout_seconds=60,
        ),
        PlaybookAction(
            action_id="report-to-threat-intel",
            action_type="threat_intel_upload",
            name="Submit IoCs to threat intelligence platforms",
            description="Share indicators with threat intel community",
            parameters={
                "iocs": {
                    "emails": ["{email_sender}"],
                    "urls": "{extracted_urls}",
                    "attachments": "{attachment_hashes}",
                },
                "platforms": ["virustotal", "otx", "abuse_ch"],
            },
            timeout_seconds=45,
        ),
    ],
    approval_required=False,  # Auto-approve for phishing containment
    timeout_seconds=300,
    trigger_conditions={
        "alert_type": ["phishing"],
        "confidence": {"min": 70},
    },
)


# =============================================================================
# Brute Force Response Playbooks
# =============================================================================

BRUTE_FORCE_RATE_LIMITING_PLAYBOOK = AutomationPlaybook(
    playbook_id="brute-force-rate-limit",
    name="Brute Force Rate Limiting",
    description="Implement rate limiting for brute force attacks",
    version="1.0.0",
    actions=[
        PlaybookAction(
            action_id="block-source-ip",
            action_type="firewall_rule",
            name="Block attacking IP at firewall",
            description="Add temporary block for source IP",
            parameters={
                "ip": "{source_ip}",
                "duration": 3600,  # 1 hour
                "reason": "Brute force attack - alert {alert_id}",
            },
            timeout_seconds=30,
        ),
        PlaybookAction(
            action_id="rate-limit-auth",
            action_type="rate_limit",
            name="Implement aggressive rate limiting",
            description="Add rate limit rule for authentication",
            parameters={
                "endpoint": "/api/auth",
                "rate_limit": "5 per minute",
                "window": 300,
                "affected_users": "all",
            },
            timeout_seconds=30,
        ),
        PlaybookAction(
            action_id="captcha-enable",
            action_type="security_config",
            name="Enable CAPTCHA for affected users",
            description="Add CAPTCHA requirement for login",
            parameters={
                "scope": "affected_ips",
                "ips": ["{source_ip}"],
                "captcha_type": "recaptcha_v3",
            },
            timeout_seconds=20,
        ),
        PlaybookAction(
            action_id="notify-user",
            action_type="notification",
            name="Notify affected user of attack",
            description="Send security alert to target user",
            parameters={
                "user_id": "{target_user_id}",
                "channels": ["email", "app"],
                "template": "brute_force_warning",
                "include_security_recommendations": True,
            },
            timeout_seconds=30,
        ),
    ],
    approval_required=False,
    timeout_seconds=180,
    trigger_conditions={
        "alert_type": ["brute_force"],
        "failed_attempts": {"min": 10},
        "time_window": 300,  # 5 minutes
    },
)


ACCOUNT_LOCKOUT_ENFORCEMENT_PLAYBOOK = AutomationPlaybook(
    playbook_id="account-lockout-enforcement",
    name="Account Lockout Enforcement",
    description="Lock accounts after excessive failed attempts",
    version="1.0.0",
    actions=[
        PlaybookAction(
            action_id="lock-account",
            action_type="ad_command",
            name="Lock affected user account",
            description="Disable account requiring admin reset",
            parameters={
                "username": "{target_user_id}",
                "lockout_reason": "Excessive failed login attempts - alert {alert_id}",
                "lockout_duration": 1800,  # 30 minutes
            },
            timeout_seconds=30,
            rollback_action="unlock_account",
        ),
        PlaybookAction(
            action_id="reset-password",
            action_type="ad_command",
            name="Force password reset on next login",
            description="Require password change",
            parameters={
                "username": "{target_user_id}",
                "force_change_at_next_login": True,
                "notify_user": True,
            },
            timeout_seconds=30,
        ),
        PlaybookAction(
            action_id="log-security-event",
            action_type="audit_log",
            name="Log security event to SIEM",
            description="Create audit trail of account lockout",
            parameters={
                "event_type": "account_lockout",
                "severity": "warning",
                "details": {
                    "alert_id": "{alert_id}",
                    "source_ip": "{source_ip}",
                    "failed_attempts": "{failed_attempts}",
                },
            },
            timeout_seconds=15,
        ),
    ],
    approval_required=False,
    timeout_seconds=120,
    trigger_conditions={
        "alert_type": ["brute_force"],
        "risk_level": ["high", "critical"],
        "failed_attempts": {"min": 20},
    },
)


# =============================================================================
# Data Exfiltration Response Playbooks
# =============================================================================

DATA_EXFILTRATION_CONTAINMENT_PLAYBOOK = AutomationPlaybook(
    playbook_id="data-exfiltration-containment",
    name="Data Exfiltration Containment",
    description="Contain data exfiltration in progress",
    version="1.0.0",
    actions=[
        PlaybookAction(
            action_id="block-external-access",
            action_type="firewall_rule",
            name="Block all external access from source",
            description="Block all outbound traffic from internal IP",
            parameters={
                "source_ip": "{source_ip}",
                "destination": "any",
                "action": "block",
                "reason": "Data exfiltration detected - alert {alert_id}",
            },
            timeout_seconds=30,
            rollback_action="remove_firewall_rule",
        ),
        PlaybookAction(
            action_id="suspend-user-access",
            action_type="access_control",
            name="Suspend user access immediately",
            description="Revoke all access privileges",
            parameters={
                "user_id": "{user_id}",
                "suspension_reason": "Data exfiltration incident - alert {alert_id}",
                "preserve_sessions": False,
            },
            timeout_seconds=30,
            rollback_action="restore_user_access",
        ),
        PlaybookAction(
            action_id="preserve-logs",
            action_type="log_collection",
            name="Preserve all access logs",
            description="Collect and preserve forensic logs",
            parameters={
                "sources": ["firewall", "proxy", "dns", "file_access", "database"],
                "time_range": "last_24_hours",
                "store_location": "secure_forensic_storage",
            },
            timeout_seconds=300,
        ),
        PlaybookAction(
            action_id="quarantine-files",
            action_type="edr_command",
            name="Quarantine suspicious files",
            description="Isolate files involved in exfiltration",
            parameters={
                "file_hashes": "{file_hashes}",
                "action": "quarantine",
            },
            timeout_seconds=120,
        ),
        PlaybookAction(
            action_id="initiate-forensics",
            action_type="workflow_trigger",
            name="Initiate forensic investigation",
            description="Start forensic workflow",
            parameters={
                "workflow_id": "forensic-investigation",
                "priority": "critical",
                "evidence": {
                    "alert_id": "{alert_id}",
                    "source_ip": "{source_ip}",
                    "user_id": "{user_id}",
                },
            },
            timeout_seconds=30,
        ),
    ],
    approval_required=True,
    timeout_seconds=900,  # 15 minutes
    trigger_conditions={
        "alert_type": ["data_exfiltration"],
        "risk_level": ["critical", "high"],
    },
)


# =============================================================================
# Utility Functions
# =============================================================================

def get_all_playbooks() -> Dict[str, AutomationPlaybook]:
    """Get all available SOAR playbooks."""
    return {
        "malware-containment": MALWARE_CONTAINMENT_PLAYBOOK,
        "ransomware-response": RANSOMWARE_RESPONSE_PLAYBOOK,
        "phishing-email-containment": PHISHING_EMAIL_CONTAINMENT_PLAYBOOK,
        "brute-force-rate-limit": BRUTE_FORCE_RATE_LIMITING_PLAYBOOK,
        "account-lockout-enforcement": ACCOUNT_LOCKOUT_ENFORCEMENT_PLAYBOOK,
        "data-exfiltration-containment": DATA_EXFILTRATION_CONTAINMENT_PLAYBOOK,
    }


def get_playbook_for_alert(alert_type: str, risk_level: str = "medium") -> List[str]:
    """Get applicable playbooks for an alert."""
    playbooks = []

    # Malware alerts
    if alert_type in ["malware", "malicious_code"]:
        playbooks.append("malware-containment")
        if risk_level == "critical":
            playbooks.append("ransomware-response")

    # Phishing alerts
    elif alert_type == "phishing":
        playbooks.append("phishing-email-containment")

    # Brute force alerts
    elif alert_type == "brute_force":
        playbooks.append("brute-force-rate-limit")
        if risk_level in ["high", "critical"]:
            playbooks.append("account-lockout-enforcement")

    # Data exfiltration alerts
    elif alert_type == "data_exfiltration":
        playbooks.append("data-exfiltration-containment")

    return playbooks
