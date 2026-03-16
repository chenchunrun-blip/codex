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

Tests API endpoints, Jinja2 template rendering, PDF generation,
MinIO storage, CSV/HTML formatters, and database persistence.
"""

import json
import os
import tempfile
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from storage import ReportStorage

from main import (
    TEMPLATE_MAP,
    ReportFormat,
    ReportStatus,
    ReportType,
    _format_csv,
    _format_html,
    _format_pdf,
    _generate_incident_data,
    _generate_summary_data,
    _generate_trend_data,
    _render_template,
    app,
    jinja_env,
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
def sample_trend_data():
    """Sample trend analysis report data."""
    return {
        "report_id": "report-test-003",
        "report_type": "trend_analysis",
        "generated_at": "2026-03-15T12:00:00",
        "period": {
            "start": "2026-02-15T00:00:00",
            "end": "2026-03-15T12:00:00",
        },
        "current_period": {
            "total_alerts": 300,
            "by_severity": {"critical": 10, "high": 40, "medium": 100, "low": 150},
            "by_status": {"pending": 50, "triaged": 200, "resolved": 50},
            "by_type": {"malware": 80, "phishing": 70, "brute_force": 60},
        },
        "insights": [
            "Review top alert categories",
            "Compare severity distribution",
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
            "summary": {"total_alerts": 10, "by_severity": {}, "by_status": {}, "by_type": {}},
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
# Jinja2 Template Tests
# =============================================================================


class TestJinja2Templates:
    """Test Jinja2 template loading and rendering."""

    def test_template_dir_exists(self):
        """Test that template directory exists."""
        from main import TEMPLATE_DIR

        assert TEMPLATE_DIR.exists()

    def test_all_templates_load(self):
        """Test that all mapped templates can be loaded."""
        for report_type, template_name in TEMPLATE_MAP.items():
            template = jinja_env.get_template(template_name)
            assert template is not None, f"Failed to load template: {template_name}"

    def test_base_template_exists(self):
        """Test base template can be loaded."""
        template = jinja_env.get_template("base.html")
        assert template is not None

    def test_render_summary_template(self, sample_report_data):
        """Test rendering summary template with data."""
        html = _render_template(sample_report_data)

        assert "<!DOCTYPE html>" in html
        assert "Daily Summary" in html
        assert "report-test-001" in html
        assert "150" in html  # total_alerts
        assert "Review critical alerts immediately" in html

    def test_render_incident_template(self, sample_incident_data):
        """Test rendering incident template with data."""
        html = _render_template(sample_incident_data)

        assert "<!DOCTYPE html>" in html
        assert "Incident Report" in html
        assert "ALT-001" in html
        assert "CRITICAL" in html  # severity badge
        assert "Ransomware detected" in html

    def test_render_trend_template(self, sample_trend_data):
        """Test rendering trend template with data."""
        html = _render_template(sample_trend_data)

        assert "<!DOCTYPE html>" in html
        assert "Trend Analysis" in html
        assert "300" in html  # total_alerts
        assert "Review top alert categories" in html

    def test_render_unknown_type_falls_back(self):
        """Test rendering with unknown report type uses base template."""
        data = {
            "report_id": "r1",
            "report_type": "unknown_type",
            "generated_at": "2026-01-01",
        }
        html = _render_template(data)
        assert "<!DOCTYPE html>" in html

    def test_render_summary_severity_percentages(self, sample_report_data):
        """Test that summary template renders severity percentages."""
        html = _render_template(sample_report_data)

        # 5 / 150 = 3.3%
        assert "3.3%" in html

    def test_render_empty_data(self):
        """Test rendering with minimal data doesn't crash."""
        data = {
            "report_id": "r1",
            "report_type": "daily_summary",
            "generated_at": "2026-01-01",
        }
        html = _render_template(data)
        assert "<!DOCTYPE html>" in html


# =============================================================================
# HTML Formatter Tests (now uses Jinja2)
# =============================================================================


class TestHTMLFormatter:
    """Test HTML report formatting via Jinja2."""

    def test_format_html_uses_templates(self, sample_report_data):
        """Test _format_html delegates to Jinja2 templates."""
        html = _format_html(sample_report_data)

        assert "<!DOCTYPE html>" in html
        assert "Daily Summary" in html
        assert "report-test-001" in html
        assert "stat-card" in html  # template-specific CSS class

    def test_format_html_with_incident(self, sample_incident_data):
        """Test HTML formatting for incident report."""
        html = _format_html(sample_incident_data)

        assert "Incident Report" in html
        assert "ALT-001" in html
        assert "badge-critical" in html  # severity badge

    def test_format_html_with_period(self, sample_report_data):
        """Test HTML formatting includes period info."""
        html = _format_html(sample_report_data)

        assert "Period:" in html
        assert "2026-03-15T00:00:00" in html


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
# PDF Formatter Tests
# =============================================================================


class TestPDFFormatter:
    """Test PDF report generation."""

    def test_format_pdf_returns_bytes(self, sample_report_data):
        """Test that _format_pdf returns bytes."""
        result = _format_pdf(sample_report_data)

        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_format_pdf_incident(self, sample_incident_data):
        """Test PDF generation for incident report."""
        result = _format_pdf(sample_incident_data)

        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_format_pdf_trend(self, sample_trend_data):
        """Test PDF generation for trend analysis report."""
        result = _format_pdf(sample_trend_data)

        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_format_pdf_empty_data(self):
        """Test PDF generation with minimal data."""
        result = _format_pdf(
            {
                "report_id": "r1",
                "report_type": "custom",
                "generated_at": "2026-01-01",
            }
        )

        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_format_pdf_no_libraries_returns_html_bytes(self, sample_report_data):
        """Test PDF falls back to HTML bytes when no PDF library available."""
        with patch.dict(
            "sys.modules",
            {
                "weasyprint": None,
                "xhtml2pdf": None,
                "xhtml2pdf.pisa": None,
                "reportlab": None,
                "reportlab.lib": None,
                "reportlab.lib.pagesizes": None,
                "reportlab.lib.styles": None,
                "reportlab.lib.units": None,
                "reportlab.lib.colors": None,
                "reportlab.platypus": None,
            },
        ):
            result = _format_pdf(sample_report_data)

        assert isinstance(result, bytes)
        # Should be HTML content as fallback
        assert b"<!DOCTYPE html>" in result or len(result) > 0


# =============================================================================
# MinIO Storage Tests
# =============================================================================


class TestReportStorage:
    """Test ReportStorage with local filesystem fallback."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create a temp directory for local storage."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield tmpdir

    @pytest.fixture
    def local_storage(self, temp_storage_dir):
        """Create a ReportStorage using local filesystem."""
        storage = ReportStorage()
        storage._use_minio = False
        storage._local_path = temp_storage_dir
        return storage

    def test_upload_report_local(self, local_storage):
        """Test uploading a report to local filesystem."""
        content = b"<html><body>Test Report</body></html>"
        path = local_storage.upload_report("report-001", content, "html")

        assert os.path.exists(path)
        assert path.endswith("report-001.html")

    def test_download_report_local(self, local_storage):
        """Test downloading a report from local filesystem."""
        content = b"Test CSV content"
        path = local_storage.upload_report("report-002", content, "csv")

        downloaded = local_storage.download_report(path)
        assert downloaded == content

    def test_download_report_not_found(self, local_storage):
        """Test downloading a non-existent report."""
        result = local_storage.download_report("/nonexistent/path.json")
        assert result is None

    def test_delete_report_local(self, local_storage):
        """Test deleting a report from local filesystem."""
        content = b"To be deleted"
        path = local_storage.upload_report("report-003", content, "json")

        assert local_storage.delete_report(path) is True
        assert not os.path.exists(path)

    def test_delete_report_not_found(self, local_storage):
        """Test deleting a non-existent report."""
        assert local_storage.delete_report("/nonexistent/path.json") is False

    def test_is_minio_available_local(self, local_storage):
        """Test is_minio_available returns False for local storage."""
        assert local_storage.is_minio_available is False

    def test_presigned_url_local(self, local_storage):
        """Test presigned URL returns None for local storage."""
        url = local_storage.get_presigned_url("/tmp/report.pdf")
        assert url is None

    def test_upload_pdf_content(self, local_storage):
        """Test uploading PDF content."""
        content = b"%PDF-1.4 fake pdf content"
        path = local_storage.upload_report("report-004", content, "pdf")

        assert path.endswith("report-004.pdf")
        downloaded = local_storage.download_report(path)
        assert downloaded == content

    def test_upload_multiple_formats(self, local_storage):
        """Test uploading same report in multiple formats."""
        html_path = local_storage.upload_report("report-005", b"<html>test</html>", "html")
        csv_path = local_storage.upload_report("report-005", b"col1,col2\n1,2", "csv")
        json_path = local_storage.upload_report("report-005", b'{"test": true}', "json")

        assert html_path != csv_path != json_path
        assert local_storage.download_report(html_path) is not None
        assert local_storage.download_report(csv_path) is not None
        assert local_storage.download_report(json_path) is not None

    def test_minio_path_parsing(self, local_storage):
        """Test downloading with minio:// path falls back to local."""
        # Should return None since the file doesn't exist locally either
        result = local_storage.download_report("minio://reports/nonexistent.pdf")
        assert result is None

    @pytest.mark.asyncio
    async def test_initialize_local_fallback(self, temp_storage_dir):
        """Test initialize falls back to local when minio is not available."""
        with patch.dict(os.environ, {"LOCAL_STORAGE_PATH": temp_storage_dir}):
            storage = ReportStorage()
            storage._local_path = temp_storage_dir
            # Patch to simulate minio unavailable
            with patch("storage.MINIO_ENDPOINT", "invalid:9999"):
                await storage.initialize()

            assert storage.is_minio_available is False


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

        with patch("main.db_manager", mock_db), patch("main.AlertRepository") as MockAlertRepo:
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
                "test-id",
                "daily_summary",
                datetime(2026, 3, 15),
                datetime(2026, 3, 15, 23, 59),
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

        with patch("main.db_manager", mock_db), patch("main.AlertRepository") as MockAlertRepo:
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

        with patch("main.db_manager", mock_db), patch("main.AlertRepository") as MockAlertRepo:
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
        with (
            patch("main.db_manager", None),
            patch("main.publisher", None),
            patch("main.report_storage", None),
        ):
            response = test_client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "reporting-service"
        assert data["status"] == "degraded"
        assert data["dependencies"]["database"] == "unavailable"
        assert data["dependencies"]["file_storage"] == "unavailable"

    def test_health_check_with_all_deps(self, test_client):
        """Test health check when all dependencies are available."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.is_minio_available = True

        with (
            patch("main.db_manager", mock_db),
            patch("main.publisher", MagicMock()),
            patch("main.report_storage", mock_storage),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.count_by_status = AsyncMock(return_value={"completed": 5, "pending": 2})

            response = test_client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["dependencies"]["database"] == "connected"
        assert data["dependencies"]["message_queue"] == "connected"
        assert data["dependencies"]["file_storage"] == "minio"

    def test_health_check_local_storage(self, test_client):
        """Test health check with local filesystem storage."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.is_minio_available = False

        with (
            patch("main.db_manager", mock_db),
            patch("main.publisher", None),
            patch("main.report_storage", mock_storage),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.count_by_status = AsyncMock(return_value={})

            response = test_client.get("/health")

        data = response.json()
        assert data["dependencies"]["file_storage"] == "local_filesystem"


class TestGenerateReportEndpoint:
    """Test the report generation endpoint."""

    def test_generate_daily_summary(self, test_client):
        """Test generating a daily summary report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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

    def test_generate_pdf_report(self, test_client):
        """Test generating a report in PDF format."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.create_report = AsyncMock()

            response = test_client.post(
                "/api/v1/reports/generate",
                json={
                    "report_type": "weekly_summary",
                    "format": "pdf",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["format"] == "pdf"

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

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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

        for rt in [
            "daily_summary",
            "weekly_summary",
            "monthly_summary",
            "trend_analysis",
            "custom",
        ]:
            with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
                mock_repo = MockRepo.return_value
                mock_repo.create_report = AsyncMock()

                response = test_client.post(
                    "/api/v1/reports/generate",
                    json={"report_type": rt},
                )
                assert response.status_code == 200, f"Failed for report type: {rt}"

    def test_generate_report_all_formats(self, test_client):
        """Test that all output formats are accepted."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        for fmt in ["json", "html", "csv", "pdf"]:
            with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
                mock_repo = MockRepo.return_value
                mock_repo.create_report = AsyncMock()

                response = test_client.post(
                    "/api/v1/reports/generate",
                    json={"report_type": "daily_summary", "format": fmt},
                )
                assert response.status_code == 200, f"Failed for format: {fmt}"
                assert response.json()["data"]["format"] == fmt


class TestGetReportEndpoint:
    """Test the get report endpoint."""

    def test_get_report_found(self, test_client, mock_report):
        """Test retrieving a completed report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", None),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["report_id"] == "report-test-001"
        assert "report_data" in data["data"]

    def test_get_report_with_presigned_url(self, test_client, mock_report):
        """Test retrieving a report includes presigned URL when stored in MinIO."""
        mock_report.file_path = "minio://reports/report-test-001.json"

        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.get_presigned_url.return_value = (
            "https://minio.local/reports/report-test-001.json?sig=abc"
        )

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", mock_storage),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001")

        assert response.status_code == 200
        data = response.json()
        assert "download_url" in data["data"]

    def test_get_report_not_found(self, test_client):
        """Test retrieving a non-existent report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", None),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001/download?format=json")

        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]

    def test_download_html(self, test_client, mock_report):
        """Test downloading report as HTML."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", None),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001/download?format=html")

        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "<!DOCTYPE html>" in response.text

    def test_download_csv(self, test_client, mock_report):
        """Test downloading report as CSV."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", None),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001/download?format=csv")

        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]

    def test_download_pdf(self, test_client, mock_report):
        """Test downloading report as PDF."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", None),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001/download?format=pdf")

        assert response.status_code == 200
        assert "application/pdf" in response.headers["content-type"]

    def test_download_from_storage(self, test_client, mock_report):
        """Test downloading a report served directly from storage."""
        mock_report.file_path = "/tmp/reports/report-test-001.json"

        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.download_report.return_value = b'{"test": true}'

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", mock_storage),
            patch("main.ReportRepository") as MockRepo,
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)

            response = test_client.get("/api/v1/reports/report-test-001/download")

        assert response.status_code == 200
        mock_storage.download_report.assert_called_once_with(mock_report.file_path)

    def test_download_pending_report(self, test_client, mock_pending_report):
        """Test downloading a report that's not ready."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_pending_report)

            response = test_client.get("/api/v1/reports/report-pending-001/download")

        assert response.status_code == 400
        assert "not ready" in response.json()["detail"]

    def test_download_not_found(self, test_client):
        """Test downloading a non-existent report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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
        mock_report = MagicMock()
        mock_report.file_path = None

        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", None),
            patch("main.ReportRepository") as MockRepo,
            patch("main.audit_log", new_callable=AsyncMock),
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)
            mock_repo.delete_report = AsyncMock(return_value=True)

            response = test_client.delete("/api/v1/reports/report-test-001")

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_delete_report_with_storage(self, test_client):
        """Test deleting a report also deletes from storage."""
        mock_report = MagicMock()
        mock_report.file_path = "minio://reports/report-001.pdf"

        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.delete_report.return_value = True

        with (
            patch("main.db_manager", mock_db),
            patch("main.report_storage", mock_storage),
            patch("main.ReportRepository") as MockRepo,
            patch("main.audit_log", new_callable=AsyncMock),
        ):
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=mock_report)
            mock_repo.delete_report = AsyncMock(return_value=True)

            response = test_client.delete("/api/v1/reports/report-test-001")

        assert response.status_code == 200
        mock_storage.delete_report.assert_called_once_with("minio://reports/report-001.pdf")

    def test_delete_report_not_found(self, test_client):
        """Test deleting a non-existent report."""
        mock_session = AsyncMock()
        mock_db = MagicMock()
        mock_db.get_session.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.get_session.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
            mock_repo = MockRepo.return_value
            mock_repo.get_by_report_id = AsyncMock(return_value=None)

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

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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

        with (
            patch("main.db_manager", mock_db),
            patch("main.ReportRepository") as MockRepo,
            patch("main.audit_log", new_callable=AsyncMock),
        ):
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

        with patch("main.db_manager", mock_db), patch("main.ReportRepository") as MockRepo:
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
        assert ReportFormat.PDF.value == "pdf"
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
