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

"""Unit tests for the AlertDeduplicator module."""

import asyncio
import time
from datetime import datetime

import pytest

from shared.deduplication import AlertDeduplicator, compute_fingerprint
from shared.models.alert import AlertType, SecurityAlert, Severity


def _make_alert(**overrides) -> SecurityAlert:
    """Helper to create a SecurityAlert with sensible defaults."""
    defaults = {
        "alert_id": "test-001",
        "alert_type": AlertType.MALWARE,
        "severity": Severity.HIGH,
        "description": "Test malware alert",
        "timestamp": datetime.utcnow(),
    }
    defaults.update(overrides)
    return SecurityAlert(**defaults)


class TestComputeFingerprint:
    """Tests for the fingerprint computation function."""

    def test_same_alert_same_fingerprint(self):
        a = _make_alert(source_ip="10.0.0.1", target_ip="10.0.0.2")
        b = _make_alert(
            alert_id="test-002",
            source_ip="10.0.0.1",
            target_ip="10.0.0.2",
        )
        assert compute_fingerprint(a) == compute_fingerprint(b)

    def test_different_type_different_fingerprint(self):
        a = _make_alert(alert_type=AlertType.MALWARE)
        b = _make_alert(alert_type=AlertType.PHISHING)
        assert compute_fingerprint(a) != compute_fingerprint(b)

    def test_different_ip_different_fingerprint(self):
        a = _make_alert(source_ip="10.0.0.1")
        b = _make_alert(source_ip="10.0.0.2")
        assert compute_fingerprint(a) != compute_fingerprint(b)

    def test_fingerprint_is_hex_string(self):
        a = _make_alert()
        fp = compute_fingerprint(a)
        assert isinstance(fp, str)
        assert len(fp) == 64  # SHA-256 hex


class TestAlertDeduplicator:
    """Tests for the in-memory deduplication engine."""

    @pytest.fixture
    def dedup(self):
        return AlertDeduplicator(redis_client=None, time_window_seconds=5)

    @pytest.mark.asyncio
    async def test_first_alert_not_duplicate(self, dedup):
        alert = _make_alert()
        assert await dedup.check_and_register(alert) is False

    @pytest.mark.asyncio
    async def test_same_alert_is_duplicate(self, dedup):
        alert = _make_alert()
        await dedup.check_and_register(alert)
        assert await dedup.check_and_register(alert) is True

    @pytest.mark.asyncio
    async def test_different_alert_not_duplicate(self, dedup):
        a = _make_alert(source_ip="10.0.0.1")
        b = _make_alert(source_ip="10.0.0.2")
        await dedup.check_and_register(a)
        assert await dedup.check_and_register(b) is False

    @pytest.mark.asyncio
    async def test_expired_entry_not_duplicate(self, dedup):
        # TTL is 5 seconds
        dedup.ttl = 1  # Shorten to 1 second for test
        alert = _make_alert()
        await dedup.check_and_register(alert)
        time.sleep(1.1)
        assert await dedup.check_and_register(alert) is False

    @pytest.mark.asyncio
    async def test_stats(self, dedup):
        a = _make_alert(source_ip="10.0.0.1")
        await dedup.check_and_register(a)
        await dedup.check_and_register(a)

        stats = dedup.get_stats()
        assert stats["total_checked"] == 2
        assert stats["duplicates_found"] == 1

    @pytest.mark.asyncio
    async def test_is_duplicate_method(self, dedup):
        alert = _make_alert()
        assert await dedup.is_duplicate(alert) is False
        await dedup.register(alert)
        assert await dedup.is_duplicate(alert) is True
