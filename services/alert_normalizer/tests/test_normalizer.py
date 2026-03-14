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
Unit tests for Alert Normalizer processors.

Tests the normalization of alerts from different SIEM formats.
"""

import pytest
from datetime import datetime

from shared.models.alert import AlertType, Severity
from services.alert_normalizer.processors import SplunkProcessor, QRadarProcessor, CEFProcessor


class TestSplunkProcessor:
    """Test cases for Splunk processor."""

    @pytest.fixture
    def processor(self):
        """Create a Splunk processor instance."""
        return SplunkProcessor()

    @pytest.fixture
    def sample_splunk_alert(self):
        """Sample Splunk alert for testing."""
        return {
            "alert_id": "SPLUNK-12345",
            "_time": "2025-01-08T10:30:00Z",
            "severity": "high",
            "category": "malware",
            "message": "Malware detected on endpoint",
            "src_ip": "45.33.32.156",
            "dest_ip": "10.0.0.50",
            "src_port": 54321,
            "dest_port": 443,
            "protocol": "tcp",
            "host": "endpoint-001",
            "user": "john.doe",
            "file_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
            "search_name": "Malware Detection",
            "app": "Enterprise Security",
            "owner": "admin",
        }

    def test_process_basic_alert(self, processor, sample_splunk_alert):
        """Test basic alert processing."""
        alert = processor.process(sample_splunk_alert)

        assert alert.alert_id == "SPLUNK-12345"
        assert alert.severity == Severity.HIGH
        assert alert.alert_type == AlertType.MALWARE
        assert alert.source_ip == "45.33.32.156"
        assert alert.target_ip == "10.0.0.50"
        assert alert.file_hash == "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"

    def test_severity_mapping(self, processor):
        """Test severity mapping from Splunk format."""
        test_cases = [
            ({"severity": "critical"}, Severity.CRITICAL),
            ({"severity": "high"}, Severity.HIGH),
            ({"severity": "medium"}, Severity.MEDIUM),
            ({"severity": "low"}, Severity.LOW),
            ({"severity": "informational"}, Severity.INFO),
            ({"severity": "10"}, Severity.CRITICAL),
            ({"severity": "5"}, Severity.MEDIUM),
            ({"severity": "1"}, Severity.LOW),
        ]

        for alert_data, expected_severity in test_cases:
            alert = processor.process({**alert_data, "message": "test"})
            assert alert.severity == expected_severity

    def test_ioc_extraction(self, processor, sample_splunk_alert):
        """Test IOC extraction from alert."""
        alert = processor.process(sample_splunk_alert)
        iocs = alert.normalized_data.get("iocs_extracted", {})

        assert "45.33.32.156" in iocs.get("ip_addresses", [])
        assert "10.0.0.50" in iocs.get("ip_addresses", [])
        assert "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8" in iocs.get("file_hashes", [])

    def test_timestamp_parsing(self, processor):
        """Test various timestamp formats."""
        test_cases = [
            {"_time": "2025-01-08T10:30:00Z"},
            {"_time": "2025-01-08T10:30:00.123Z"},
            {"_time": "2025-01-08 10:30:00"},
        ]

        for alert_data in test_cases:
            alert = processor.process({**alert_data, "message": "test"})
            assert isinstance(alert.timestamp, datetime)
            assert alert.timestamp.year == 2025

    def test_missing_optional_fields(self, processor):
        """Test alert with missing optional fields."""
        minimal_alert = {
            "message": "Test alert",
        }

        alert = processor.process(minimal_alert)

        assert alert.description == "Test alert"
        assert alert.source_ip is None
        assert alert.target_ip is None


class TestQRadarProcessor:
    """Test cases for QRadar processor."""

    @pytest.fixture
    def processor(self):
        """Create a QRadar processor instance."""
        return QRadarProcessor()

    @pytest.fixture
    def sample_qradar_alert(self):
        """Sample QRadar alert for testing."""
        return {
            "offense_id": 100234,
            "offense_type": "Malware Detected",
            "description": "Malware detected on endpoint",
            "start_time": 1704700200000,  # Milliseconds since epoch
            "severity": 8,
            "magnitude": "high",
            "source_ip": "45.33.32.156",
            "destination_ip": "10.0.0.50",
            "source_port": 54321,
            "destination_port": 443,
            "protocol": "TCP",
            "host_name": "endpoint-001",
            "user_name": "john.doe",
            "category": "Malware",
        }

    def test_process_basic_alert(self, processor, sample_qradar_alert):
        """Test basic QRadar alert processing."""
        alert = processor.process(sample_qradar_alert)

        assert "QRADAR" in alert.alert_id
        assert alert.severity == Severity.CRITICAL  # High magnitude upgrades to critical
        assert alert.alert_type == AlertType.MALWARE
        assert alert.source_ip == "45.33.32.156"
        assert alert.target_ip == "10.0.0.50"

    def test_severity_with_magnitude(self, processor):
        """Test severity calculation with magnitude."""
        # High magnitude should upgrade medium to high
        alert_data = {
            "severity": 6,
            "magnitude": "high",
            "description": "test",
        }
        alert = processor.process(alert_data)
        assert alert.severity == Severity.HIGH

        # Low magnitude should downgrade medium to low
        alert_data["magnitude"] = "low"
        alert = processor.process(alert_data)
        assert alert.severity == Severity.LOW

    def test_millisecond_timestamp(self, processor, sample_qradar_alert):
        """Test parsing of millisecond timestamps."""
        alert = processor.process(sample_qradar_alert)
        assert isinstance(alert.timestamp, datetime)
        assert alert.timestamp.year >= 2024

    def test_offense_type_mapping(self, processor):
        """Test offense type to alert type mapping."""
        test_cases = [
            ({"offense_type": "Malware Detected"}, AlertType.MALWARE),
            ({"offense_type": "Phishing"}, AlertType.PHISHING),
            ({"offense_type": "Brute Force"}, AlertType.BRUTE_FORCE),
            ({"offense_type": "DDoS Attack"}, AlertType.DDOS),
            ({"offense_type": "Unknown Type"}, AlertType.OTHER),
        ]

        for alert_data, expected_type in test_cases:
            alert = processor.process({**alert_data, "description": "test"})
            assert alert.alert_type == expected_type


class TestCEFProcessor:
    """Test cases for CEF processor."""

    @pytest.fixture
    def processor(self):
        """Create a CEF processor instance."""
        return CEFProcessor()

    @pytest.fixture
    def sample_cef_message(self):
        """Sample CEF message for testing."""
        return "CEF:0|Security|IDS|1.0|100|Malware Detected|10|src=45.33.32.156 dst=10.0.0.50 spt=54321 dpt=443 proto=TCP dhost=endpoint-001 duser=john.doe fileHash=5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"

    def test_process_cef_string(self, processor, sample_cef_message):
        """Test processing CEF string message."""
        alert = processor.process(sample_cef_message)

        assert "CEF" in alert.alert_id
        assert alert.severity == Severity.CRITICAL  # Severity 10
        assert alert.source_ip == "45.33.32.156"
        assert alert.target_ip == "10.0.0.50"
        assert alert.file_hash == "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"

    def test_cef_header_parsing(self, processor):
        """Test CEF header parsing."""
        cef_message = "CEF:0|Vendor|Product|2.0|200|Test Alert|5|"
        alert = processor.process(cef_message)

        assert alert.normalized_data["cef_version"] == "0"
        assert alert.normalized_data["device_vendor"] == "Vendor"
        assert alert.normalized_data["device_product"] == "Product"
        assert alert.normalized_data["device_version"] == "2.0"
        assert alert.normalized_data["signature_id"] == "200"

    def test_extension_parsing(self, processor):
        """Test CEF extension parsing."""
        cef_message = "CEF:0|Security|IDS|1.0|100|Test|5|src=192.168.1.1 dst=10.0.0.1"
        alert = processor.process(cef_message)

        assert alert.source_ip == "192.168.1.1"
        assert alert.target_ip == "10.0.0.1"

    def test_quoted_strings_in_extension(self, processor):
        """Test handling of quoted strings in extensions."""
        cef_message = r'CEF:0|Security|IDS|1.0|100|Test|5|msg="Error with spaces" src=192.168.1.1'
        alert = processor.process(cef_message)

        assert "Error with spaces" in alert.description

    def test_severity_mapping(self, processor):
        """Test CEF severity mapping."""
        test_cases = [
            ("CEF:0|Security|IDS|1.0|100|Test|0|", Severity.INFO),
            ("CEF:0|Security|IDS|1.0|100|Test|3|", Severity.LOW),
            ("CEF:0|Security|IDS|1.0|100|Test|5|", Severity.MEDIUM),
            ("CEF:0|Security|IDS|1.0|100|Test|7|", Severity.HIGH),
            ("CEF:0|Security|IDS|1.0|100|Test|10|", Severity.CRITICAL),
        ]

        for cef_message, expected_severity in test_cases:
            alert = processor.process(cef_message)
            assert alert.severity == expected_severity


class TestProcessorStats:
    """Test processor statistics tracking."""

    def test_splunk_stats(self):
        """Test Splunk processor statistics."""
        processor = SplunkProcessor()

        # Process some alerts
        for i in range(5):
            processor.process({"message": f"Test alert {i}", "severity": "high"})

        # Try processing one invalid alert
        try:
            processor.process({})
        except ValueError:
            pass

        stats = processor.get_stats()
        assert stats["processed_count"] == 5
        assert stats["success_rate"] > 0.8

    def test_qradar_stats(self):
        """Test QRadar processor statistics."""
        processor = QRadarProcessor()

        for i in range(3):
            processor.process({
                "description": f"Test {i}",
                "offense_id": i,
                "severity": 5,
            })

        stats = processor.get_stats()
        assert stats["processed_count"] == 3
        assert stats["error_count"] == 0

    def test_cef_stats(self):
        """Test CEF processor statistics."""
        processor = CEFProcessor()

        for i in range(4):
            processor.process(f"CEF:0|Security|IDS|1.0|{i}|Test|5|")

        stats = processor.get_stats()
        assert stats["processed_count"] == 4
        assert stats["success_rate"] == 1.0
