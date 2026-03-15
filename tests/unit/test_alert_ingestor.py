"""Unit tests for Alert Ingestor service - business logic and helpers."""

import pytest
from datetime import datetime, timedelta
from collections import defaultdict
from unittest.mock import AsyncMock, MagicMock, patch

from shared.models import AlertType, SecurityAlert, Severity


# ---------------------------------------------------------------------------
# Rate Limiting Logic
# ---------------------------------------------------------------------------

class TestRateLimiting:
    """Test the in-memory rate limiting logic."""

    def test_rate_limit_allows_under_threshold(self):
        """Requests under the limit should pass."""
        from services.alert_ingestor.main import (
            rate_limit_tracker,
            RATE_LIMIT_REQUESTS,
            RATE_LIMIT_WINDOW,
        )

        test_ip = "test-rate-limit-under"
        rate_limit_tracker[test_ip] = []

        # Add fewer than limit
        now = datetime.utcnow()
        for i in range(5):
            rate_limit_tracker[test_ip].append(now)

        # Clean and count
        cleaned = [
            ts for ts in rate_limit_tracker[test_ip]
            if (now - ts).total_seconds() < RATE_LIMIT_WINDOW
        ]
        assert len(cleaned) < RATE_LIMIT_REQUESTS

        # Cleanup
        del rate_limit_tracker[test_ip]

    def test_rate_limit_old_entries_expire(self):
        """Old entries should be cleaned during check."""
        from services.alert_ingestor.main import (
            rate_limit_tracker,
            RATE_LIMIT_WINDOW,
        )

        test_ip = "test-rate-limit-expire"
        now = datetime.utcnow()
        old = now - timedelta(seconds=RATE_LIMIT_WINDOW + 10)

        rate_limit_tracker[test_ip] = [old, old, old, now]

        cleaned = [
            ts for ts in rate_limit_tracker[test_ip]
            if (now - ts).total_seconds() < RATE_LIMIT_WINDOW
        ]
        assert len(cleaned) == 1

        # Cleanup
        del rate_limit_tracker[test_ip]


# ---------------------------------------------------------------------------
# Alert Message Construction
# ---------------------------------------------------------------------------

class TestAlertMessageConstruction:
    """Test how alert data is packaged into MQ messages."""

    def test_alert_model_dump_contains_required_fields(self):
        """SecurityAlert.model_dump() should contain all fields needed for MQ message."""
        alert = SecurityAlert(
            alert_id="ALT-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Test malware detected",
            source_ip="192.168.1.100",
            target_ip="10.0.0.50",
        )

        dumped = alert.model_dump()
        assert dumped["alert_id"] == "ALT-001"
        assert dumped["alert_type"] == "malware"
        assert dumped["severity"] == "high"
        assert dumped["source_ip"] == "192.168.1.100"
        assert dumped["target_ip"] == "10.0.0.50"

    def test_alert_model_dump_optional_fields(self):
        """Optional fields should serialize as None when absent."""
        alert = SecurityAlert(
            alert_id="ALT-002",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.ANOMALY,
            severity=Severity.LOW,
            description="Test anomaly",
        )

        dumped = alert.model_dump()
        assert dumped.get("source_ip") is None
        assert dumped.get("file_hash") is None
        assert dumped.get("url") is None

    def test_alert_validation_rejects_invalid_type(self):
        """Invalid alert_type should raise validation error."""
        with pytest.raises(Exception):
            SecurityAlert(
                alert_id="ALT-003",
                timestamp=datetime(2026, 1, 1),
                alert_type="not_a_real_type",
                severity=Severity.HIGH,
                description="Invalid type",
            )

    def test_batch_alert_ids_are_unique(self):
        """Each alert in a batch should have unique IDs."""
        alerts = [
            SecurityAlert(
                alert_id=f"ALT-BATCH-{i}",
                timestamp=datetime(2026, 1, 1),
                alert_type=AlertType.MALWARE,
                severity=Severity.MEDIUM,
                description=f"Batch alert {i}",
            )
            for i in range(5)
        ]

        ids = [a.alert_id for a in alerts]
        assert len(ids) == len(set(ids))


# ---------------------------------------------------------------------------
# Deduplication (via shared module)
# ---------------------------------------------------------------------------

class TestDeduplication:
    """Test alert deduplication logic from shared module."""

    @pytest.mark.asyncio
    async def test_deduplicator_detects_duplicate(self):
        """Same alert submitted twice should be detected as duplicate."""
        from shared.deduplication import AlertDeduplicator

        dedup = AlertDeduplicator(redis_client=None, time_window_seconds=60)

        alert = SecurityAlert(
            alert_id="ALT-DEDUP-001",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="Duplicate test",
            source_ip="1.2.3.4",
        )

        is_dup1 = await dedup.check_and_register(alert)
        assert is_dup1 is False  # First time: not a duplicate

        is_dup2 = await dedup.check_and_register(alert)
        assert is_dup2 is True  # Second time: duplicate

    @pytest.mark.asyncio
    async def test_deduplicator_different_alerts_not_duplicate(self):
        """Different alerts should not be detected as duplicates."""
        from shared.deduplication import AlertDeduplicator

        dedup = AlertDeduplicator(redis_client=None, time_window_seconds=60)

        alert1 = SecurityAlert(
            alert_id="ALT-DEDUP-A",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.MALWARE,
            severity=Severity.HIGH,
            description="First alert",
            source_ip="1.2.3.4",
        )

        alert2 = SecurityAlert(
            alert_id="ALT-DEDUP-B",
            timestamp=datetime(2026, 1, 1),
            alert_type=AlertType.PHISHING,
            severity=Severity.MEDIUM,
            description="Different alert",
            source_ip="5.6.7.8",
        )

        assert await dedup.check_and_register(alert1) is False
        assert await dedup.check_and_register(alert2) is False
