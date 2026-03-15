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
Palo Alto Networks alert processor for normalizing PAN-OS firewall/NGFW alerts.

This module handles parsing and normalization of alerts from Palo Alto Networks
firewalls and Panorama, including threat logs, traffic logs, and WildFire
submissions. Supports PAN-OS syslog format and REST API JSON payloads.
"""

import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from shared.models.alert import AlertType, SecurityAlert, Severity
from shared.utils.logger import get_logger

logger = get_logger(__name__)


class PaloAltoProcessor:
    """
    Processor for Palo Alto Networks PAN-OS alerts.

    Handles threat logs, traffic logs, URL filtering logs, WildFire submissions,
    and GlobalProtect events from Palo Alto firewalls and Panorama.
    """

    # PAN-OS severity mappings
    SEVERITY_MAP = {
        "critical": Severity.CRITICAL,
        "high": Severity.HIGH,
        "medium": Severity.MEDIUM,
        "low": Severity.LOW,
        "informational": Severity.INFO,
        "info": Severity.INFO,
        # Numeric PAN-OS severity (1-5)
        "5": Severity.CRITICAL,
        "4": Severity.HIGH,
        "3": Severity.MEDIUM,
        "2": Severity.LOW,
        "1": Severity.INFO,
    }

    # PAN-OS threat type to alert type mappings
    ALERT_TYPE_MAP = {
        "virus": AlertType.MALWARE,
        "wildfire-virus": AlertType.MALWARE,
        "wildfire": AlertType.MALWARE,
        "spyware": AlertType.MALWARE,
        "vulnerability": AlertType.UNAUTHORIZED_ACCESS,
        "url-filtering": AlertType.PHISHING,
        "flood": AlertType.DDOS,
        "scan": AlertType.UNAUTHORIZED_ACCESS,
        "brute-force": AlertType.BRUTE_FORCE,
        "data-filtering": AlertType.DATA_EXFILTRATION,
        "file-blocking": AlertType.MALWARE,
        "phishing": AlertType.PHISHING,
        "dns-security": AlertType.MALWARE,
    }

    # PAN-OS field mappings to standard fields
    FIELD_MAP = {
        "src": "source_ip",
        "srcaddr": "source_ip",
        "source_ip": "source_ip",
        "srcip": "source_ip",
        "dst": "target_ip",
        "dstaddr": "target_ip",
        "destination_ip": "target_ip",
        "dstip": "target_ip",
        "sport": "source_port",
        "srcport": "source_port",
        "dport": "destination_port",
        "dstport": "destination_port",
        "proto": "protocol",
        "protocol": "protocol",
        "app": "application",
        "application": "application",
        "rule": "rule_name",
        "rule_name": "rule_name",
        "action": "action",
        "dstuser": "user_id",
        "srcuser": "source_user",
        "device_name": "device_name",
        "serial": "serial_number",
        "threatid": "threat_id",
        "threat_id": "threat_id",
        "threat/content-type": "threat_content_type",
        "threat_content_type": "threat_content_type",
        "filedigest": "file_hash",
        "file_hash": "file_hash",
        "misc": "url",
        "url": "url",
    }

    # PAN-OS action mappings for determining alert significance
    ACTION_SEVERITY_BOOST = {
        "alert": 0,
        "allow": -1,
        "deny": 1,
        "drop": 1,
        "reset-client": 1,
        "reset-server": 1,
        "reset-both": 2,
        "block-url": 1,
        "block-ip": 1,
        "sinkhole": 2,
    }

    def __init__(self):
        """Initialize Palo Alto processor."""
        self.processed_count = 0
        self.error_count = 0

    def process(self, raw_alert: Dict[str, Any]) -> SecurityAlert:
        """
        Process a Palo Alto Networks alert and convert to standard SecurityAlert format.

        Args:
            raw_alert: Raw PAN-OS alert data (threat log, traffic log, etc.)

        Returns:
            Normalized SecurityAlert

        Raises:
            ValueError: If required fields are missing or invalid
        """
        try:
            # Extract core fields
            alert_id = self._extract_alert_id(raw_alert)
            timestamp = self._extract_timestamp(raw_alert)
            alert_type = self._extract_alert_type(raw_alert)
            severity = self._extract_severity(raw_alert)
            description = self._extract_description(raw_alert)

            # Extract network information
            source_ip = self._extract_field(raw_alert, ["src", "srcaddr", "source_ip", "srcip"])
            target_ip = self._extract_field(raw_alert, ["dst", "dstaddr", "destination_ip", "dstip"])
            source_port = self._extract_port(raw_alert, ["sport", "srcport", "source_port"])
            destination_port = self._extract_port(raw_alert, ["dport", "dstport", "destination_port"])
            protocol = self._extract_field(raw_alert, ["proto", "protocol", "ip_protocol"])

            # Extract entity references
            asset_id = self._extract_field(raw_alert, ["device_name", "hostname", "dsthost"])
            user_id = self._extract_field(raw_alert, ["dstuser", "srcuser", "user"])

            # Extract threat-specific fields
            file_hash = self._extract_file_hash(raw_alert)
            url = self._extract_field(raw_alert, ["misc", "url", "uri"])
            application = self._extract_field(raw_alert, ["app", "application"])

            # Extract PAN-OS-specific metadata
            action = self._extract_field(raw_alert, ["action"])
            threat_id = self._extract_field(raw_alert, ["threatid", "threat_id"])
            rule_name = self._extract_field(raw_alert, ["rule", "rule_name"])
            serial = self._extract_field(raw_alert, ["serial", "serial_number"])
            log_type = self._extract_field(raw_alert, ["type", "log_type"])

            # Build source reference
            source_ref = f"PAN-{serial or 'unknown'}/{threat_id or rule_name or ''}"

            # Extract IOCs
            iocs = self._extract_iocs(raw_alert)

            # Create normalized alert
            normalized_alert = SecurityAlert(
                alert_id=alert_id,
                timestamp=timestamp,
                alert_type=alert_type,
                severity=severity,
                description=description,
                source_ip=source_ip,
                target_ip=target_ip,
                file_hash=file_hash,
                url=url,
                asset_id=asset_id,
                user_id=user_id,
                source="paloalto",
                source_ref=source_ref,
                raw_data=raw_alert,
                normalized_data={
                    "source_type": "paloalto",
                    "normalized_at": datetime.utcnow().isoformat(),
                    "panos_action": action,
                    "panos_threat_id": threat_id,
                    "panos_rule": rule_name,
                    "panos_application": application,
                    "panos_log_type": log_type,
                    "panos_serial": serial,
                    "iocs_extracted": iocs,
                },
            )

            self.processed_count += 1

            logger.info(
                "Palo Alto alert processed",
                extra={
                    "alert_id": alert_id,
                    "alert_type": alert_type.value,
                    "severity": severity.value,
                    "action": action,
                    "threat_id": threat_id,
                },
            )

            return normalized_alert

        except Exception as e:
            self.error_count += 1
            logger.error(f"Failed to process Palo Alto alert: {e}", exc_info=True)
            raise ValueError(f"Palo Alto alert processing failed: {str(e)}")

    def _extract_alert_id(self, raw_alert: Dict[str, Any]) -> str:
        """Extract alert ID from PAN-OS alert."""
        if "alert_id" in raw_alert and raw_alert["alert_id"]:
            return str(raw_alert["alert_id"])

        alert_id = (
            raw_alert.get("log_id")
            or raw_alert.get("seqno")
            or raw_alert.get("sessionid")
        )

        if alert_id:
            return f"PAN-{alert_id}"

        threat_id = raw_alert.get("threatid", raw_alert.get("threat_id", ""))
        if threat_id:
            return f"PAN-THREAT-{threat_id}"

        return f"PAN-{uuid.uuid4()}"

    def _extract_timestamp(self, raw_alert: Dict[str, Any]) -> datetime:
        """Extract and parse timestamp from PAN-OS alert."""
        timestamp_fields = [
            "receive_time", "generated_time", "time_generated",
            "timestamp", "cef_timestamp", "start",
        ]

        for field in timestamp_fields:
            if field in raw_alert and raw_alert[field]:
                timestamp_str = raw_alert[field]

                if isinstance(timestamp_str, datetime):
                    return timestamp_str

                if isinstance(timestamp_str, str):
                    formats = [
                        "%Y/%m/%d %H:%M:%S",      # PAN-OS default
                        "%Y-%m-%dT%H:%M:%S.%fZ",
                        "%Y-%m-%dT%H:%M:%SZ",
                        "%Y-%m-%dT%H:%M:%S",
                        "%Y-%m-%d %H:%M:%S",
                        "%b %d %H:%M:%S",          # Syslog format
                    ]

                    for fmt in formats:
                        try:
                            return datetime.strptime(timestamp_str, fmt)
                        except ValueError:
                            continue

        return datetime.utcnow()

    def _extract_alert_type(self, raw_alert: Dict[str, Any]) -> AlertType:
        """Extract and map alert type from PAN-OS alert."""
        # Check threat/content-type field (primary indicator)
        threat_type = (
            raw_alert.get("threat/content-type")
            or raw_alert.get("threat_content_type")
            or raw_alert.get("subtype")
            or raw_alert.get("threattype")
            or raw_alert.get("type")
        )

        if threat_type:
            threat_str = str(threat_type).lower().strip()
            if threat_str in self.ALERT_TYPE_MAP:
                return self.ALERT_TYPE_MAP[threat_str]

        # Keyword-based fallback from description/threat name
        description = str(raw_alert.get("threat_name", "") or raw_alert.get("misc", "")).lower()
        keywords = {
            "malware": AlertType.MALWARE,
            "virus": AlertType.MALWARE,
            "trojan": AlertType.MALWARE,
            "ransomware": AlertType.MALWARE,
            "phishing": AlertType.PHISHING,
            "brute": AlertType.BRUTE_FORCE,
            "flood": AlertType.DDOS,
            "exfiltrat": AlertType.DATA_EXFILTRATION,
            "exploit": AlertType.UNAUTHORIZED_ACCESS,
            "scan": AlertType.UNAUTHORIZED_ACCESS,
        }

        for keyword, atype in keywords.items():
            if keyword in description:
                return atype

        return AlertType.OTHER

    def _extract_severity(self, raw_alert: Dict[str, Any]) -> Severity:
        """Extract and map severity from PAN-OS alert."""
        severity_value = (
            raw_alert.get("severity")
            or raw_alert.get("risk-of-compromise")
            or raw_alert.get("threat_severity")
        )

        if severity_value:
            severity_str = str(severity_value).lower().strip()
            return self.SEVERITY_MAP.get(severity_str, Severity.MEDIUM)

        return Severity.MEDIUM

    def _extract_description(self, raw_alert: Dict[str, Any]) -> str:
        """Extract description from PAN-OS alert."""
        description = (
            raw_alert.get("threat_name")
            or raw_alert.get("description")
            or raw_alert.get("misc")
            or raw_alert.get("rule")
        )

        if description:
            return str(description)[:2000]

        action = raw_alert.get("action", "detected")
        app = raw_alert.get("app", "unknown")
        return f"Palo Alto firewall {action} on application {app}"

    def _extract_field(self, raw_alert: Dict[str, Any], field_names: List[str]) -> Optional[str]:
        """Extract field value trying multiple possible field names."""
        for field_name in field_names:
            if field_name in raw_alert and raw_alert[field_name]:
                value = raw_alert[field_name]
                if value and str(value) not in ("-", "N/A", "none", "unknown"):
                    return str(value)
        return None

    def _extract_port(self, raw_alert: Dict[str, Any], field_names: List[str]) -> Optional[int]:
        """Extract port number and convert to integer."""
        for field_name in field_names:
            if field_name in raw_alert and raw_alert[field_name]:
                try:
                    port = int(raw_alert[field_name])
                    if 0 <= port <= 65535:
                        return port
                except (ValueError, TypeError):
                    continue
        return None

    def _extract_file_hash(self, raw_alert: Dict[str, Any]) -> Optional[str]:
        """Extract and validate file hash from PAN-OS WildFire data."""
        hash_fields = ["filedigest", "file_hash", "sha256", "md5", "hash"]

        for field in hash_fields:
            if field in raw_alert and raw_alert[field]:
                hash_value = str(raw_alert[field]).strip().lower()
                if re.match(r"^[a-f0-9]{32}$", hash_value):
                    return hash_value
                elif re.match(r"^[a-f0-9]{40}$", hash_value):
                    return hash_value
                elif re.match(r"^[a-f0-9]{64}$", hash_value):
                    return hash_value

        return None

    def _extract_iocs(self, raw_alert: Dict[str, Any]) -> Dict[str, List[str]]:
        """
        Extract Indicators of Compromise from PAN-OS alert.

        Args:
            raw_alert: Raw PAN-OS alert data

        Returns:
            Dictionary of IOC type to list of values
        """
        iocs = {
            "ip_addresses": [],
            "file_hashes": [],
            "urls": [],
            "domains": [],
            "email_addresses": [],
        }

        alert_text = str(raw_alert)

        # Extract IP addresses
        ip_pattern = r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b"
        iocs["ip_addresses"] = list(set(re.findall(ip_pattern, alert_text)))

        # Extract file hashes
        md5_matches = re.findall(r"\b[a-fA-F0-9]{32}\b", alert_text)
        sha1_matches = re.findall(r"\b[a-fA-F0-9]{40}\b", alert_text)
        sha256_matches = re.findall(r"\b[a-fA-F0-9]{64}\b", alert_text)
        iocs["file_hashes"] = list(set(md5_matches + sha1_matches + sha256_matches))

        # Extract URLs
        url_pattern = r"https?://[^\s<>\"]+"
        iocs["urls"] = list(set(re.findall(url_pattern, alert_text)))

        # Extract domains
        domain_pattern = r"\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+\b"
        domain_matches = re.findall(domain_pattern, alert_text)
        tlds = [".com", ".org", ".net", ".edu", ".gov", ".mil", ".io", ".co", ".uk", ".ru", ".cn"]
        iocs["domains"] = [d for d in domain_matches if any(tld in d.lower() for tld in tlds)]

        # Extract email addresses
        email_pattern = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
        iocs["email_addresses"] = list(set(re.findall(email_pattern, alert_text)))

        return iocs

    def get_stats(self) -> Dict[str, int]:
        """
        Get processing statistics.

        Returns:
            Dictionary with processing stats
        """
        return {
            "processed_count": self.processed_count,
            "error_count": self.error_count,
            "success_rate": (
                (self.processed_count - self.error_count) / self.processed_count
                if self.processed_count > 0
                else 0
            ),
        }
