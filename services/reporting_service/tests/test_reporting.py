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
Unit tests for the Reporting Service.

Tests API endpoints, report generation logic, formatters,
and database persistence.
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import (
    ReportFormat,
    ReportStatus,
    ReportType,
    _format_csv,
    _format_html,
    _generate_incident_data,
    _generate_summary_data,
    _generate_trend_data,
    app,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def test_client():
    """Create test client for FastAPI app."""
    return TestClient(app)


@pytest.fixture
def sample_report_data():
    """Sample report data for formatter tests."""
    return {
        "report_id": "report-test-001",
        "report_type": "daily_summary",
        "generated_at": "2026-03-15T12:00:00",
        "period": {
            "start": "2026-03-15T00:00:00",
            "end": "2026-03-15T12:00:00",
        },
        "summary": {
            "total_alerts": 150,
            "by_severity": {"critical": 5, "high": 20, "medium": 45, "low": 80},
            "by_status": {"pending": 30, "triaged": 100, "resolved": 20},
            "by_type": {"malware": 40, "phishing": 35, "brute_force": 30},
        },
        "recommendations": [
            "Review critical alerts immediately",
            "Update firewall rules",
        ],
    }


@pytest.fixture
def sample_incident_data():
    """Sample incident report data."""
    return {
        "report_id": "report-test-002",
        "report_type": "incident_report",
        "alert_id": "ALT-001",
        "generated_at": "2026-03-15T12:00:00",
        "incident_details": {
            "alert_id": "ALT-001",
            "type": "malware",
            "severity": "critical",
            "status": "triaged",
            "title": "Ransomware detected",
            "description": "Ransomware infection on server-001",
            "source_ip": "45.33.32.156",
            "destination_ip": "10.0.0.50",
            "asset_id": "server-001",
            "created_at": "2026-03-15T10:00:00",
        },
        "recommendations": [
            "Investigate affected assets",
            "Review network logs",
        ],
    }


@pytest.fixture
def mock_report():
    """Create a mock Report ORM object."""
    report = MagicMock()
    report.report_id = "report-test-001"
    report.name = "Test Daily Summary"
    report.description = "Test report"
    report.report_type = "daily_summary"
    report.format = "json"
    report.status = "completed"
    report.filters = {
        "_report_data": {
            "report_id": "report-test-001",
            "report_type": "daily_summary",
            "generated_at": "2026-03-15T12:00:00",
            "summary": {"total_alerts": 10},
            "recommendations": [],
        }
    }
    report.file_path = None
    report.file_size = 256
    report.created_by = "api"
    report.schedule_frequency = None
    report.schedule_time = None
    report.schedule_recipients = None
    report.created_at = datetime(2026, 3, 15, 12, 0, 0)
    report.updated_at = datetime(2026, 3, 15, 12, 0, 0)
    report.completed_at = datetime(2026, 3, 15, 12, 0, 1)
    report.error_message = None
    return report


@pytest.fixture
def mock_pending_report():
    """Create a mock Report ORM object with pending status."""
    report = MagicMock()
    report.report_id = "report-pending-001"
    report.name = "Pending Report"
    report.description = None
    report.report_type = "daily_summary"
    report.format = "json"
    report.status = "pending"
    report.filters = None
    report.file_path = None
    report.file_size = None
    report.created_by = "api"
    report.schedule_frequency = None
    report.schedule_time = None
    report.schedule_recipients = None
    report.created_at = datetime(2026, 3, 15, 12, 0, 0)
    report.updated_at = datetime(2026, 3, 15, 12, 0, 0)
    report.completed_at = None
    report.error_message = None
    return report


# =============================================================================
# HTML Formatter Tests
# =============================================================================


class TestHTMLFormatter:
    """Test HTML report formatting."""

    def test_format_html_with_summary(self, sample_report_data):
        """Test HTML formatting includes summary table."""
        html = _format_html(sample_report_data)

        assert "<!DOCTYPE html>" in html
        assert "Daily Summary" in html
        assert "report-test-001" in html
        assert "Total Alerts" in html
        assert "150" in html
        assert "Recommendations" in html
        assert "Review critical alerts immediately" in html

    def test_format_html_with_incident(self, sample_incident_data):
        """Test HTML formatting for incident report."""
        html = _format_html(sample_incident_data)

        assert "Incident Report" in html
        assert "ALT-001" in html
        assert "Incident Details" in html
        assert "malware" in html

    def test_format_html_with_period(self, sample_report_data):
        """Test HTML formatting includes period info."""
        html = _format_html(sample_report_data)

        assert "Period:" in html
        assert "2026-03-15T00:00:00" in html

    def test_format_html_empty_data(self):
        """Test HTML formatting with minimal data."""
        html = _format_html({"report_type": "custom", "report_id": "r1"})

        assert "<!DOCTYPE html>" in html
        assert "Custom" in html

    def test_format_html_no_recommendations(self):
        """Test HTML formatting without recommendations."""
        html = _format_html({
            "report_type": "custom",
            "report_id": "r1",
            "generated_at": "2026-01-01",
        })
        assert "<!DOCTYPE html>" in html


# =============================================================================
# CSV Formatter Tests
# =============================================================================


class TestCSVFormatter:
    """Test CSV report formatting."""

    def test_format_csv_with_summary(self, sample_report_data):
        """Test CSV formatting includes summary rows."""
        csv_str = _format_csv(sample_report_data)

        assert "report-test-001" in csv_str
        assert "daily_summary" in csv_str
        assert "Total Alerts" in csv_str
        assert "150" in csv_str

    def test_format_csv_with_incident(self, sample_incident_data):
        """Test CSV formatting for incident report."""
        csv_str = _format_csv(sample_incident_data)

        assert "ALT-001" in csv_str
        assert "Incident Field" in csv_str
        assert "malware" in csv_str

    def test_format_csv_with_recommendations(self, sample_report_data):
        """Test CSV formatting includes recommendations."""
        csv_str = _format_csv(sample_report_data)

        assert "Recommendations" in csv_str
        assert "Review critical alerts immediately" in csv_str

    def test_format_csv_nested_dict(self, sample_report_data):
        """Test CSV formatting handles nested dicts (by_severity etc)."""
        csv_str = _format_csv(sample_report_data)

        assert "critical" in csv_str
        assert "5" in csv_str

    def test_format_csv_empty_data(self):
        """Test CSV formatting with minimal data."""
        csv_str = _format_csv({"report_id": "r1", "report_type": "custom"})

        assert "r1" in csv_str
        assert "custom" in csv_str


# =============================================================================
# Report Data Generation Tests
# =============================================================================


class TestReportDataGeneration:
    """Test report data generation functions."""

    @pytest.mark.asyncio
    async def test_generate_summary_data_no_db(self):
        """Test summary generation falls back when DB is unavailable."""
        with patch("main.db_manager", None):
            data = await _generate_summary_data(
                "test-id",
                "daily_summary",
                datetime(2026, 3, 15),
                datetime(2026, 3, 15, 23, 59, 59),
            )

        assert data["report_id"] == "test-id"
        assert data["report_type"] == "daily_summary"
        assert "summary" in data
        assert data["summary"]["total_alerts"] == 0
        assert "recommendations" in data

    @pytest.mark.asyncio
    async def test_generate_summary_data_with_db(self):
        """Test summary generation queries DB when available."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.AlertRepository") as MockAlertRepo:
            mock_repo = MockAlertRepo.return_value
            mock_repo.get_alerts_count_by_severity = AsyncMock(
                return_value={"critical": 2, "high": 5}
            )
            mock_repo.get_alerts_count_by_status = AsyncMock(
                return_value={"pending": 3, "triaged": 4}
            )
            mock_repo.get_alerts_count_by_type = AsyncMock(
                return_value={"malware": 4, "phishing": 3}
            )

            data = await _generate_summary_data(
                "test-id", "daily_summary",
                datetime(2026, 3, 15), datetime(2026, 3, 15, 23, 59),
            )

        assert data["summary"]["total_alerts"] == 7
        assert data["summary"]["by_severity"] == {"critical": 2, "high": 5}

    @pytest.mark.asyncio
    async def test_generate_incident_data_no_db(self):
        """Test incident generation without DB."""
        with patch("main.db_manager", None):
            data = await _generate_incident_data("test-id", "ALT-001")

        assert data["report_id"] == "test-id"
        assert data["alert_id"] == "ALT-001"
        assert "note" in data["incident_details"]

    @pytest.mark.asyncio
    async def test_generate_incident_data_alert_found(self):
        """Test incident generation when alert is found in DB."""
        mock_alert = MagicMock()
        mock_alert.alert_id = "ALT-001"
        mock_alert.alert_type = "malware"
        mock_alert.severity = "critical"
        mock_alert.status = "triaged"
        mock_alert.title = "Ransomware detected"
        mock_alert.description = "Ransomware on server"
        mock_alert.source_ip = "1.2.3.4"
        mock_alert.destination_ip = "10.0.0.1"
        mock_alert.asset_id = "srv-001"
        mock_alert.created_at = datetime(2026, 3, 15, 10, 0)

        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.AlertRepository") as MockAlertRepo:
            mock_repo = MockAlertRepo.return_value
            mock_repo.get_alert_by_id = AsyncMock(return_value=mock_alert)

            data = await _generate_incident_data("test-id", "ALT-001")

        assert data["incident_details"]["alert_id"] == "ALT-001"
        assert data["incident_details"]["severity"] == "critical"

    @pytest.mark.asyncio
    async def test_generate_incident_data_alert_not_found(self):
        """Test incident generation when alert is not in DB."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.AlertRepository") as MockAlertRepo:
            mock_repo = MockAlertRepo.return_value
            mock_repo.get_alert_by_id = AsyncMock(return_value=None)

            data = await _generate_incident_data("test-id", "MISSING")

        assert "error" in data["incident_details"]

    @pytest.mark.asyncio
    async def test_generate_trend_data_no_db(self):
        """Test trend generation without DB."""
        with patch("main.db_manager", None):
            data = await _generate_trend_data(
                "test-id", datetime(2026, 2, 15), datetime(2026, 3, 15)
            )

        assert data["report_type"] == "trend_analysis"
        assert data["current_period"]["total_alerts"] == 0
        assert "insights" in data


# =============================================================================
# API Endpoint Tests
# =============================================================================


class TestHealthEndpoint:
    """Test the health check endpoint."""

    def test_health_check_no_db(self, test_client):
        """Test health check when DB is unavailable."""
        with patch("main.db_manager", None), \
             patch("main.publisher", None):
            response = test_client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "reporting-service"
        assert data["status"] == "degraded"
        assert data["dependencies"]["database"] == "unavailable"

    def test_health_check_with_db(self, test_client):
        """Test health check when DB is available."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.publisher", MagicMock()), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.count_by_status = AsyncMock(return_value={"completed": 5, "pending": 2})

            response = test_client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["dependencies"]["database"] == "connected"
        assert data["dependencies"]["message_queue"] == "connected"


class TestGenerateReportEndpoint:
    """Test the report generation endpoint."""

    def test_generate_daily_summary(self, test_client):
        """Test generating a daily summary report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.create_report = AsyncMock()

            response = test_client.post(
                "/api/v1/reports/generate",
                json={
                    "report_type": "daily_summary",
                    "name": "My Daily Report",
                    "format": "json",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["report_type"] == "daily_summary"
        assert data["data"]["name"] == "My Daily Report"
        assert "report_id" in data["data"]

    def test_generate_incident_report_missing_alert_id(self, test_client):
        """Test incident report requires alert_id."""
        with patch("main.db_manager", MagicMock()):
            response = test_client.post(
                "/api/v1/reports/generate",
                json={"report_type": "incident_report"},
            )

        assert response.status_code == 400
        assert "alert_id" in response.json()["detail"]

    def test_generate_incident_report_with_alert_id(self, test_client):
        """Test generating an incident report with alert_id."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.create_report = AsyncMock()

            response = test_client.post(
                "/api/v1/reports/generate",
                json={
                    "report_type": "incident_report",
                    "alert_id": "ALT-001",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["report_type"] == "incident_report"

    def test_generate_report_all_types(self, test_client):
        """Test that all report types are accepted."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        for rt in ["daily_summary", "weekly_summary", "monthly_summary", "trend_analysis", "custom"]:
            with patch("main.db_manager", mock_db), \
                 patch("main.ReportRepository") as MockRepo:
                mock_repo = MockRepo.return_value
                mock_repo.create_report = AsyncMock()

                response = test_client.post(
                    "/api/v1/reports/generate",
                    json={"report_type": rt},
                )
                assert response.status_code == 200, f"Failed for report type: {rt}"


class TestGetReportEndpoint:
    """Test the get report endpoint."""

    def test_get_report_found(self, test_client, mock_report):
        """Test retrieving a completed report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["report_id"] == "report-test-001"
        assert "report_data" in data["data"]

    def test_get_report_not_found(self, test_client):
        """Test retrieving a non-existent report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=None)

            response = test_client.get("/api/v1/reports/nonexistent")

        assert response.status_code == 404

    def test_get_report_no_db(self, test_client):
        """Test retrieving report when DB is unavailable."""
        with patch("main.db_manager", None):
            response = test_client.get("/api/v1/reports/report-test-001")

        assert response.status_code == 503


class TestDownloadReportEndpoint:
    """Test the download report endpoint."""

    def test_download_json(self, test_client, mock_report):
        """Test downloading report as JSON."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get(
                "/api/v1/reports/report-test-001/download?format=json"
            )

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]

    def test_download_html(self, test_client, mock_report):
        """Test downloading report as HTML."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get(
                "/api/v1/reports/report-test-001/download?format=html"
            )

        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "<!DOCTYPE html>" in response.text

    def test_download_csv(self, test_client, mock_report):
        """Test downloading report as CSV."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get(
                "/api/v1/reports/report-test-001/download?format=csv"
            )

        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]

    def test_download_pending_report(self, test_client, mock_pending_report):
        """Test downloading a report that's not ready."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_pending_report)

            response = test_client.get(
                "/api/v1/reports/report-pending-001/download"
            )

        assert response.status_code == 400
        assert "not ready" in response.json()["detail"]

    def test_download_not_found(self, test_client):
        """Test downloading a non-existent report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=None)

            response = test_client.get("/api/v1/reports/nope/download")

        assert response.status_code == 404


class TestListReportsEndpoint:
    """Test the list reports endpoint."""

    def test_list_reports(self, test_client, mock_report):
        """Test listing reports."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.list_reports = AsyncMock(return_value=([mock_report], 1))

            response = test_client.get("/api/v1/reports")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert len(data["data"]["reports"]) == 1

    def test_list_reports_with_filters(self, test_client, mock_report):
        """Test listing reports with status and type filters."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.list_reports = AsyncMock(return_value=([mock_report], 1))

            response = test_client.get(
                "/api/v1/reports?status=completed&report_type=daily_summary&offset=0&limit=10"
            )

        assert response.status_code == 200

    def test_list_reports_no_db(self, test_client):
        """Test listing reports when DB is unavailable."""
        with patch("main.db_manager", None):
            response = test_client.get("/api/v1/reports")
        assert response.status_code == 503


class TestDeleteReportEndpoint:
    """Test the delete report endpoint."""

    def test_delete_report(self, test_client):
        """Test deleting a report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo, \
             patch("main.audit_log", new_callable=AsyncMock):
            mock_repo = MockRepo.return_value
            mock_repo.delete_report = AsyncMock(return_value=True)

            response = test_client.delete("/api/v1/reports/report-test-001")

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_delete_report_not_found(self, test_client):
        """Test deleting a non-existent report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.delete_report = AsyncMock(return_value=False)

            response = test_client.delete("/api/v1/reports/nonexistent")

        assert response.status_code == 404


class TestReportStatsEndpoint:
    """Test the report stats endpoint."""

    def test_get_report_stats(self, test_client):
        """Test getting report statistics."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.count_by_status = AsyncMock(
                return_value={"completed": 10, "failed": 2, "pending": 1}
            )
            mock_repo.count_by_type = AsyncMock(
                return_value={"daily_summary": 8, "incident_report": 5}
            )

            response = test_client.get("/api/v1/reports/stats/summary")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total_reports"] == 13
        assert data["data"]["by_status"]["completed"] == 10


class TestScheduleEndpoints:
    """Test schedule-related endpoints."""

    def test_update_schedule(self, test_client, mock_report):
        """Test updating a report's schedule."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo, \
             patch("main.audit_log", new_callable=AsyncMock):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.put(
                "/api/v1/reports/report-test-001/schedule",
                json={
                    "schedule_frequency": "daily",
                    "schedule_time": "08:00",
                    "schedule_recipients": ["admin@example.com"],
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    def test_update_schedule_invalid_frequency(self, test_client):
        """Test updating schedule with invalid frequency."""
        with patch("main.db_manager", MagicMock()):
            response = test_client.put(
                "/api/v1/reports/report-test-001/schedule",
                json={"schedule_frequency": "biweekly"},
            )

        assert response.status_code == 400

    def test_list_scheduled_reports(self, test_client, mock_report):
        """Test listing scheduled reports."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), \
             patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_scheduled_reports = AsyncMock(return_value=[mock_report])

            response = test_client.get("/api/v1/reports/scheduled/list")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["total"] == 1


# =============================================================================
# Enum Tests
# =============================================================================


class TestEnums:
    """Test enum definitions."""

    def test_report_format_values(self):
        """Test ReportFormat enum values."""
        assert ReportFormat.HTML.value == "html"
        assert ReportFormat.CSV.value == "csv"
        assert ReportFormat.JSON.value == "json"

    def test_report_type_values(self):
        """Test ReportType enum values."""
        assert ReportType.DAILY_SUMMARY.value == "daily_summary"
        assert ReportType.WEEKLY_SUMMARY.value == "weekly_summary"
        assert ReportType.MONTHLY_SUMMARY.value == "monthly_summary"
        assert ReportType.INCIDENT_REPORT.value == "incident_report"
        assert ReportType.TREND_ANALYSIS.value == "trend_analysis"
        assert ReportType.CUSTOM.value == "custom"

    def test_report_status_values(self):
        """Test ReportStatus enum values."""
        assert ReportStatus.PENDING.value == "pending"
        assert ReportStatus.GENERATING.value == "generating"
        assert ReportStatus.COMPLETED.value == "completed"
        assert ReportStatus.FAILED.value == "failed"
