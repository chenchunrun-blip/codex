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
Unit tests for API Gateway.

Tests FastAPI endpoints, request validation, and response formatting.
"""

import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch

from main import app
from shared.database.models import Alert
from shared.models.alert import AlertStatus, AlertType, Severity


# =============================================================================
# Test Client
# =============================================================================

@pytest.fixture
def test_client():
    """Create test client for FastAPI app."""
    return TestClient(app)


@pytest.fixture
def mock_alert():
    """Create mock alert."""
    return Alert(
        alert_id="test-alert-001",
        timestamp=datetime.utcnow(),
        alert_type="malware",
        severity="high",
        status="new",
        title="Test Malware Alert",
        description="Test malware detected on endpoint",
        source_ip="45.33.32.156",
        destination_ip="10.0.0.50",
        file_hash="5d41402abc4b2a76b9719d911017c592",
        source="splunk",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


# =============================================================================
# Health Check Tests
# =============================================================================

class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_root_endpoint(self, test_client):
        """Test root endpoint."""
        response = test_client.get("/")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Security Triage System API"
        assert data["version"] == "1.0.0"
        assert data["status"] == "operational"

    def test_health_check(self, test_client):
        """Test health check endpoint."""
        with patch('shared.database.base.get_database_manager') as mock_get_db:
            mock_db_manager = MagicMock()
            mock_db_manager.health_check = AsyncMock(return_value={
                "status": "healthy",
                "pool_size": 20,
            })
            mock_get_db.return_value = mock_db_manager

            response = test_client.get("/health")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert "components" in data

    def test_liveness_probe(self, test_client):
        """Test liveness probe."""
        response = test_client.get("/health/live")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "alive"

    def test_readiness_probe(self, test_client):
        """Test readiness probe."""
        with patch('shared.database.base.get_database_manager') as mock_get_db:
            mock_db_manager = MagicMock()
            mock_db_manager.health_check = AsyncMock(return_value={
                "status": "healthy",
            })
            mock_get_db.return_value = mock_db_manager

            response = test_client.get("/health/ready")

            assert response.status_code == 200
            data = response.json()
            assert "ready" in data


# =============================================================================
# Alert API Tests
# =============================================================================

class TestAlertAPI:
    """Test alert API endpoints."""

    def test_list_alerts_default(self, test_client, mock_alert):
        """Test listing alerts with default parameters."""
        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_by_filter = AsyncMock(return_value=([mock_alert], 1))
            mock_repo_class.return_value = mock_repo

            response = test_client.get("/api/v1/alerts/")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "data" in data
            assert "meta" in data
            assert data["meta"]["total"] == 1

    def test_list_alerts_with_filters(self, test_client, mock_alert):
        """Test listing alerts with filter parameters."""
        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_by_filter = AsyncMock(return_value=([mock_alert], 1))
            mock_repo_class.return_value = mock_repo

            response = test_client.get(
                "/api/v1/alerts/",
                params={
                    "alert_type": "malware",
                    "severity": "high",
                    "status": "new",
                    "skip": 0,
                    "limit": 10,
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_alert_by_id(self, test_client, mock_alert):
        """Test getting alert by ID."""
        with patch('routes.alerts.get_alert_with_details') as mock_get:
            mock_get.return_value = {
                "alert": mock_alert,
                "triage_result": None,
            }

            response = test_client.get("/api/v1/alerts/test-alert-001")

            assert response.status_code == 200
            data = response.json()
            assert data["alert_id"] == "test-alert-001"
            assert data["alert_type"] == "malware"

    def test_get_alert_not_found(self, test_client):
        """Test getting non-existent alert."""
        with patch('routes.alerts.get_alert_with_details') as mock_get:
            from fastapi import HTTPException
            mock_get.side_effect = HTTPException(status_code=404, detail="Not found")

            response = test_client.get("/api/v1/alerts/non-existent")

            assert response.status_code == 404

    def test_create_alert(self, test_client):
        """Test creating a new alert."""
        alert_data = {
            "alert_type": "malware",
            "severity": "high",
            "title": "New Malware Alert",
            "description": "Malware detected on endpoint",
            "source_ip": "45.33.32.156",
            "destination_ip": "10.0.0.50",
        }

        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.create_alert = AsyncMock(return_value=mock_alert)
            mock_repo_class.return_value = mock_repo

            response = test_client.post("/api/v1/alerts/", json=alert_data)

            assert response.status_code == 201
            data = response.json()
            assert "alert_id" in data

    def test_create_alert_validation_error(self, test_client):
        """Test creating alert with invalid data."""
        invalid_data = {
            "alert_type": "malware",
            # Missing required fields
        }

        response = test_client.post("/api/v1/alerts/", json=invalid_data)

        assert response.status_code == 422  # Validation error

    def test_update_alert_status(self, test_client, mock_alert):
        """Test updating alert status."""
        status_update = {
            "status": "in_progress",
            "assigned_to": "user-123",
            "comment": "Investigating",
        }

        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.update_alert_status = AsyncMock(return_value=mock_alert)
            mock_repo_class.return_value = mock_repo

            response = test_client.patch(
                "/api/v1/alerts/test-alert-001/status",
                json=status_update,
            )

            assert response.status_code == 200
            data = response.json()
            assert "alert_id" in data

    def test_get_alert_stats(self, test_client):
        """Test getting alert statistics."""
        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_count_by_severity = AsyncMock(return_value={
                "critical": 5,
                "high": 15,
                "medium": 30,
            })
            mock_repo.get_alerts_count_by_status = AsyncMock(return_value={
                "new": 10,
                "in_progress": 5,
            })
            mock_repo.get_alerts_count_by_type = AsyncMock(return_value={
                "malware": 20,
                "phishing": 10,
            })
            mock_repo.get_high_priority_alerts = AsyncMock(return_value=[])
            mock_repo_class.return_value = mock_repo

            with patch('routes.alerts.TriageRepository') as mock_triage_class:
                mock_triage = MagicMock()
                mock_triage.get_pending_review_count = AsyncMock(return_value=3)
                mock_triage.get_average_risk_score = AsyncMock(return_value=65.5)
                mock_triage_class.return_value = mock_triage

                response = test_client.get("/api/v1/alerts/stats/summary")

                assert response.status_code == 200
                data = response.json()
                assert "total_alerts" in data
                assert "by_severity" in data

    def test_get_high_priority_alerts(self, test_client, mock_alert):
        """Test getting high-priority alerts."""
        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_high_priority_alerts = AsyncMock(return_value=[mock_alert])
            mock_repo_class.return_value = mock_repo

            response = test_client.get("/api/v1/alerts/high-priority?min_risk_score=70.0")

            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_bulk_action_close(self, test_client):
        """Test bulk close action."""
        bulk_request = {
            "alert_ids": ["alert-001", "alert-002", "alert-003"],
            "action": "close",
        }

        with patch('routes.alerts.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.close_alert = AsyncMock()
            mock_repo_class.return_value = mock_repo

            response = test_client.post("/api/v1/alerts/bulk", json=bulk_request)

            assert response.status_code == 200
            data = response.json()
            assert data["action"] == "close"
            assert data["total"] == 3


# =============================================================================
# Analytics API Tests
# =============================================================================

class TestAnalyticsAPI:
    """Test analytics API endpoints."""

    def test_get_dashboard_stats(self, test_client):
        """Test getting dashboard statistics."""
        with patch('routes.analytics.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_count_by_severity = AsyncMock(return_value={
                "critical": 2,
                "high": 8,
                "medium": 15,
            })
            mock_repo.get_alerts_count_by_status = AsyncMock(return_value={
                "new": 5,
                "in_progress": 3,
            })
            mock_repo.get_alerts_count_by_type = AsyncMock(return_value={
                "malware": 10,
                "phishing": 5,
            })
            mock_repo.get_alerts_by_date_range = AsyncMock(return_value=[])
            mock_repo_class.return_value = mock_repo

            with patch('routes.analytics.TriageRepository') as mock_triage_class:
                mock_triage = MagicMock()
                mock_triage.get_pending_review_count = AsyncMock(return_value=2)
                mock_triage.get_average_risk_score = AsyncMock(return_value=60.0)
                mock_triage_class.return_value = mock_triage

                response = test_client.get("/api/v1/analytics/dashboard?time_range=24h")

                assert response.status_code == 200
                data = response.json()
                assert "total_alerts" in data
                assert "critical_alerts" in data
                assert "system_health" in data

    def test_get_alert_trends(self, test_client):
        """Test getting alert trends."""
        with patch('routes.analytics.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_by_date_range = AsyncMock(return_value=[])
            mock_repo_class.return_value = mock_repo

            response = test_client.get("/api/v1/analytics/trends/alerts?time_range=24h")

            assert response.status_code == 200
            data = response.json()
            assert "metric" in data
            assert "data_points" in data
            assert "summary" in data

    def test_get_severity_distribution(self, test_client):
        """Test getting severity distribution."""
        with patch('routes.analytics.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_count_by_severity = AsyncMock(return_value={
                "critical": 5,
                "high": 15,
                "medium": 30,
                "low": 20,
            })
            mock_repo_class.return_value = mock_repo

            response = test_client.get("/api/v1/analytics/metrics/severity-distribution")

            assert response.status_code == 200
            data = response.json()
            assert "critical" in data
            assert "high" in data
            assert data["critical"] == 5

    def test_get_status_distribution(self, test_client):
        """Test getting status distribution."""
        with patch('routes.analytics.AlertRepository') as mock_repo_class:
            mock_repo = MagicMock()
            mock_repo.get_alerts_count_by_status = AsyncMock(return_value={
                "new": 10,
                "in_progress": 5,
                "resolved": 20,
            })
            mock_repo_class.return_value = mock_repo

            response = test_client.get("/api/v1/analytics/metrics/status-distribution")

            assert response.status_code == 200
            data = response.json()
            assert "new" in data
            assert "in_progress" in data

    def test_get_performance_metrics(self, test_client):
        """Test getting performance metrics."""
        with patch('routes.analytics.TriageRepository') as mock_triage_class:
            mock_triage = MagicMock()
            mock_triage.get_average_risk_score = AsyncMock(return_value=65.5)
            mock_triage.get_average_processing_time = AsyncMock(return_value=1200.0)
            mock_triage.get_model_usage_stats = AsyncMock(return_value={
                "deepseek": 45,
                "qwen": 32,
            })
            mock_triage.get_risk_level_distribution = AsyncMock(return_value={
                "critical": 5,
                "high": 15,
                "medium": 30,
            })
            mock_triage_class.return_value = mock_triage

            response = test_client.get("/api/v1/analytics/metrics/performance")

            assert response.status_code == 200
            data = response.json()
            assert "average_risk_score" in data
            assert "average_processing_time_ms" in data
            assert data["average_risk_score"] == 65.5


# =============================================================================
# Error Handling Tests
# =============================================================================

class TestErrorHandling:
    """Test error handling."""

    def test_404_error(self, test_client):
        """Test 404 error handling."""
        response = test_client.get("/api/v1/nonexistent")

        assert response.status_code == 404

    def test_validation_error(self, test_client):
        """Test validation error handling."""
        # Invalid limit value
        response = test_client.get("/api/v1/alerts/?limit=2000")

        assert response.status_code == 422

    def test_invalid_date_format(self, test_client):
        """Test invalid date format."""
        response = test_client.get("/api/v1/alerts/?start_date=invalid-date")

        assert response.status_code == 422


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
