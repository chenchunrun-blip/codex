"""Unit tests for Alert Normalizer service - processors, field mapping, IOC extraction, dedup."""

import re
from datetime import datetime
from typing import Dict

import pytest
from shared.models import AlertType, SecurityAlert, Severity

# ---------------------------------------------------------------------------
# Splunk Processor
# ---------------------------------------------------------------------------


class TestSplunkProcessor:
    """Test Splunk alert processor."""

    @pytest.fixture
    def processor(self):
        from services.alert_normalizer.processors import SplunkProcessor

        return SplunkProcessor()

    def test_process_basic_alert(self, processor):
        """Process a minimal Splunk alert."""
        raw = {
            "alert_id": "SPL-001",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "high",
            "message": "Malware detected on host",
            "src_ip": "45.33.32.156",
            "dest_ip": "10.0.0.50",
        }

        result = processor.process(raw)

        assert isinstance(result, SecurityAlert)
        assert result.alert_id == "SPL-001"
        assert result.alert_type == AlertType.MALWARE
        assert result.severity == Severity.HIGH
        assert result.source_ip == "45.33.32.156"
        assert result.target_ip == "10.0.0.50"
        assert "Malware detected" in result.description

    def test_severity_mapping_numeric(self, processor):
        """Numeric severity should map correctly."""
        raw = {
            "alert_id": "SPL-002",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "9",
            "message": "Critical alert",
        }

        result = processor.process(raw)
        assert result.severity == Severity.CRITICAL

    def test_severity_mapping_text(self, processor):
        """Text severity should map correctly."""
        for text, expected in [
            ("critical", Severity.CRITICAL),
            ("high", Severity.HIGH),
            ("medium", Severity.MEDIUM),
            ("low", Severity.LOW),
            ("info", Severity.INFO),
            ("informational", Severity.INFO),
        ]:
            raw = {
                "alert_id": f"SPL-SEV-{text}",
                "timestamp": "2026-01-15T10:30:00Z",
                "category": "malware",
                "severity": text,
                "message": "Test",
            }
            result = processor.process(raw)
            assert result.severity == expected, f"Failed for severity={text}"

    def test_alert_type_mapping(self, processor):
        """Alert type strings should map to enums."""
        mappings = {
            "malware": AlertType.MALWARE,
            "phishing": AlertType.PHISHING,
            "brute_force": AlertType.BRUTE_FORCE,
            "ddos": AlertType.DDOS,
            "data_exfiltration": AlertType.DATA_EXFILTRATION,
            "anomaly": AlertType.ANOMALY,
            "unknown_type": AlertType.OTHER,
        }

        for type_str, expected in mappings.items():
            raw = {
                "alert_id": f"SPL-TYPE-{type_str}",
                "timestamp": "2026-01-15T10:30:00Z",
                "category": type_str,
                "severity": "medium",
                "message": "Test",
            }
            result = processor.process(raw)
            assert result.alert_type == expected, f"Failed for type={type_str}"

    def test_extract_file_hash_sha256(self, processor):
        """SHA256 hash should be extracted."""
        sha256 = "a" * 64
        raw = {
            "alert_id": "SPL-HASH",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "high",
            "message": "Malware hash detected",
            "sha256": sha256,
        }

        result = processor.process(raw)
        assert result.file_hash == sha256

    def test_extract_file_hash_md5(self, processor):
        """MD5 hash should be extracted."""
        md5 = "b" * 32
        raw = {
            "alert_id": "SPL-MD5",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "high",
            "message": "Test",
            "md5": md5,
        }

        result = processor.process(raw)
        assert result.file_hash == md5

    def test_missing_timestamp_defaults_to_now(self, processor):
        """Alert without timestamp should default to current time."""
        raw = {
            "alert_id": "SPL-NO-TIME",
            "category": "malware",
            "severity": "low",
            "message": "No timestamp",
        }

        result = processor.process(raw)
        # Should be roughly now (within 5 seconds)
        assert abs((datetime.utcnow() - result.timestamp).total_seconds()) < 5

    def test_auto_generated_alert_id(self, processor):
        """Missing alert_id should be auto-generated."""
        raw = {
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "medium",
            "message": "No ID alert",
        }

        result = processor.process(raw)
        assert result.alert_id.startswith("SPLUNK-")

    def test_ioc_extraction(self, processor):
        """IOCs should be extracted from alert text."""
        raw = {
            "alert_id": "SPL-IOC",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "high",
            "message": "Connection to 192.168.1.1 from https://evil.com/payload",
            "src_ip": "192.168.1.1",
            "url": "https://evil.com/payload",
        }

        result = processor.process(raw)
        iocs = result.normalized_data.get("iocs_extracted", {})
        assert "192.168.1.1" in iocs.get("ip_addresses", [])

    def test_processor_stats_tracking(self, processor):
        """Stats should track processed and error counts."""
        assert processor.processed_count == 0

        raw = {
            "alert_id": "SPL-STATS",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "malware",
            "severity": "high",
            "message": "Test",
        }
        processor.process(raw)
        assert processor.processed_count == 1

        stats = processor.get_stats()
        assert stats["processed_count"] == 1
        assert stats["error_count"] == 0


# ---------------------------------------------------------------------------
# QRadar Processor
# ---------------------------------------------------------------------------


class TestQRadarProcessor:
    """Test QRadar alert processor."""

    @pytest.fixture
    def processor(self):
        from services.alert_normalizer.processors import QRadarProcessor

        return QRadarProcessor()

    def test_process_qradar_alert(self, processor):
        """Process a QRadar-formatted alert."""
        raw = {
            "alert_id": "QR-001",
            "start_time": "2026-01-15T10:30:00Z",
            "category": "malware",
            "magnitude": "8",
            "description": "QRadar malware offense",
            "source_ip": "10.0.0.1",
            "destination_ip": "10.0.0.2",
        }

        result = processor.process(raw)
        assert isinstance(result, SecurityAlert)
        # QRadar processor may prefix with "QRADAR-"
        assert "QR-001" in result.alert_id


# ---------------------------------------------------------------------------
# CEF Processor
# ---------------------------------------------------------------------------


class TestCEFProcessor:
    """Test CEF alert processor."""

    @pytest.fixture
    def processor(self):
        from services.alert_normalizer.processors import CEFProcessor

        return CEFProcessor()

    def test_process_cef_alert_with_cef_string(self, processor):
        """Process a CEF-formatted alert with proper CEF message."""
        raw = {
            "alert_id": "CEF-001",
            "message": "CEF:0|SecurityVendor|Product|1.0|100|Brute Force|8|src=203.0.113.50 dst=10.0.0.5",
        }

        result = processor.process(raw)
        assert isinstance(result, SecurityAlert)

    def test_process_cef_alert_dict_fallback(self, processor):
        """Process a CEF alert as plain dict (no CEF message string)."""
        raw = {
            "alert_id": "CEF-002",
            "timestamp": "2026-01-15T10:30:00Z",
            "category": "brute_force",
            "severity": "high",
            "src": "203.0.113.50",
            "dst": "10.0.0.5",
        }

        # When no 'message' key, CEF processor uses raw dict directly
        result = processor.process(raw)
        assert isinstance(result, SecurityAlert)


# ---------------------------------------------------------------------------
# Normalizer Logic (field mapping, fingerprinting, aggregation)
# ---------------------------------------------------------------------------


class TestFieldMapping:
    """Test field mapping from raw alert to standard format."""

    def test_map_field_splunk_format(self):
        from services.alert_normalizer.main import map_field

        raw = {"src_ip": "1.2.3.4", "dest_ip": "5.6.7.8"}
        assert map_field(raw, "splunk", "source_ip") == "1.2.3.4"
        assert map_field(raw, "splunk", "target_ip") == "5.6.7.8"

    def test_map_field_default_format(self):
        from services.alert_normalizer.main import map_field

        raw = {"source_ip": "1.2.3.4"}
        assert map_field(raw, "default", "source_ip") == "1.2.3.4"

    def test_map_field_missing_returns_none(self):
        from services.alert_normalizer.main import map_field

        raw = {"unrelated_field": "value"}
        assert map_field(raw, "splunk", "source_ip") is None


class TestAlertFingerprint:
    """Test alert fingerprint generation for dedup."""

    def test_same_alert_same_fingerprint(self):
        from services.alert_normalizer.main import generate_alert_fingerprint

        alert = {
            "alert_type": "malware",
            "source_ip": "1.2.3.4",
            "target_ip": "5.6.7.8",
        }

        fp1 = generate_alert_fingerprint(alert)
        fp2 = generate_alert_fingerprint(alert)
        assert fp1 == fp2

    def test_different_alert_different_fingerprint(self):
        from services.alert_normalizer.main import generate_alert_fingerprint

        alert1 = {"alert_type": "malware", "source_ip": "1.2.3.4"}
        alert2 = {"alert_type": "phishing", "source_ip": "5.6.7.8"}

        assert generate_alert_fingerprint(alert1) != generate_alert_fingerprint(alert2)

    def test_fingerprint_is_sha256(self):
        from services.alert_normalizer.main import generate_alert_fingerprint

        fp = generate_alert_fingerprint({"alert_type": "malware"})
        assert len(fp) == 64
        assert re.match(r"^[a-f0-9]{64}$", fp)


class TestDuplicateDetection:
    """Test in-memory duplicate detection."""

    def test_first_alert_not_duplicate(self):
        from services.alert_normalizer.main import is_duplicate_alert, processed_alerts_cache

        # Clear cache for test isolation
        processed_alerts_cache.clear()

        alert = {
            "alert_type": "test_dedup_first",
            "source_ip": "unique-ip-1",
        }
        assert is_duplicate_alert(alert) is False

    def test_second_identical_alert_is_duplicate(self):
        from services.alert_normalizer.main import is_duplicate_alert, processed_alerts_cache

        processed_alerts_cache.clear()

        alert = {
            "alert_type": "test_dedup_second",
            "source_ip": "unique-ip-2",
        }
        assert is_duplicate_alert(alert) is False
        assert is_duplicate_alert(alert) is True


class TestAlertAggregator:
    """Test time-window aggregation."""

    def test_single_alert_not_batched(self):
        from services.alert_normalizer.main import AlertAggregator

        agg = AlertAggregator(window_seconds=30, max_batch_size=10)

        alert = SecurityAlert(
            alert_id="AGG-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Test",
        )

        batch = agg.add_alert(alert)
        # Window hasn't expired and batch not full -> None
        assert batch is None

    def test_batch_full_triggers_publish(self):
        from services.alert_normalizer.main import AlertAggregator

        agg = AlertAggregator(window_seconds=300, max_batch_size=3)

        for i in range(3):
            alert = SecurityAlert(
                alert_id=f"AGG-FULL-{i}",
                timestamp=datetime(2026, 1, 1),
                alert_type=AlertType.MALWARE,
                severity=Severity.HIGH,
                description="Test",
                source_ip="1.2.3.4",
                target_ip="5.6.7.8",
            )
            result = agg.add_alert(alert)

        # Third alert should trigger batch
        assert result is not None
        assert len(result) == 3

    def test_flush_returns_all_pending(self):
        from services.alert_normalizer.main import AlertAggregator

        agg = AlertAggregator(window_seconds=300, max_batch_size=100)

        for i in range(5):
            alert = SecurityAlert(
                alert_id=f"AGG-FLUSH-{i}",
                timestamp=datetime(2026, 1, 1),
                alert_type=AlertType.MALWARE,
                severity=Severity.HIGH,
                description="Test",
            )
            agg.add_alert(alert)

        batches = agg.flush_all()
        total = sum(len(b) for b in batches)
        assert total == 5

    def test_stats(self):
        from services.alert_normalizer.main import AlertAggregator

        agg = AlertAggregator(window_seconds=30, max_batch_size=100)
        stats = agg.get_stats()
        assert stats["active_batches"] == 0
        assert stats["total_alerts_buffered"] == 0


# ---------------------------------------------------------------------------
# IOC Extraction (module-level function)
# ---------------------------------------------------------------------------


class TestIOCExtraction:
    """Test IOC extraction from raw alert data."""

    def test_extract_ip_addresses(self):
        from services.alert_normalizer.main import extract_iocs

        raw = {"message": "Connection from 192.168.1.1 to 10.0.0.5"}
        iocs = extract_iocs(raw)
        assert "192.168.1.1" in iocs["ip_addresses"]
        assert "10.0.0.5" in iocs["ip_addresses"]

    def test_extract_file_hashes(self):
        from services.alert_normalizer.main import extract_iocs

        sha256 = "a" * 64
        raw = {"file_hash": sha256}
        iocs = extract_iocs(raw)
        assert sha256 in iocs["file_hashes"]

    def test_invalid_ip_filtered_out(self):
        from services.alert_normalizer.main import extract_iocs

        raw = {"message": "Version 999.999.999.999 is invalid"}
        iocs = extract_iocs(raw)
        assert "999.999.999.999" not in iocs["ip_addresses"]

    def test_empty_alert_returns_empty_iocs(self):
        from services.alert_normalizer.main import extract_iocs

        iocs = extract_iocs({})
        assert all(len(v) == 0 for v in iocs.values())
