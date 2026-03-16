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
Unit tests for SQLAlchemy ORM models.

Tests model definitions, relationships, and table configurations.
"""

import pytest
from sqlalchemy import inspect

from shared.database.models import (
    Alert,
    AlertContext,
    Asset,
    AuditLog,
    Base,
    Incident,
    IncidentAlert,
    Notification,
    RemediationAction,
    Report,
    SystemConfig,
    TriageResult,
    User,
    UserPreference,
    Workflow,
    WorkflowExecution,
    WorkflowTemplate,
)


class TestAlertModel:
    """Tests for the Alert ORM model."""

    def test_tablename(self):
        assert Alert.__tablename__ == "alerts"

    def test_primary_key(self):
        mapper = inspect(Alert)
        pk_cols = [c.name for c in mapper.primary_key]
        assert "alert_id" in pk_cols

    def test_has_fk_fields(self):
        """Test that FK fields are present (not commented out)."""
        mapper = inspect(Alert)
        column_names = [c.key for c in mapper.column_attrs]
        assert "risk_score" in column_names
        assert "confidence" in column_names
        assert "assigned_to" in column_names
        assert "triage_result_id" in column_names
        assert "source" in column_names
        assert "tags" in column_names
        assert "normalized_data" in column_names

    def test_has_relationships(self):
        """Test that relationships are defined."""
        mapper = inspect(Alert)
        rel_names = [r.key for r in mapper.relationships]
        assert "assigned_user" in rel_names
        assert "triage_result" in rel_names
        assert "context_data" in rel_names
        assert "asset" in rel_names
        assert "incident_alerts" in rel_names

    def test_indexes(self):
        """Test that proper indexes are defined."""
        index_names = [idx.name for idx in Alert.__table__.indexes]
        assert "ix_alerts_received_at" in index_names
        assert "ix_alerts_severity" in index_names
        assert "ix_alerts_status" in index_names
        assert "ix_alerts_alert_type" in index_names
        assert "ix_alerts_source_ip" in index_names

    def test_network_fields(self):
        """Test network-related fields exist."""
        mapper = inspect(Alert)
        column_names = [c.key for c in mapper.column_attrs]
        assert "source_ip" in column_names
        assert "source_port" in column_names
        assert "destination_ip" in column_names
        assert "destination_port" in column_names
        assert "protocol" in column_names


class TestUserModel:
    """Tests for the User ORM model."""

    def test_tablename(self):
        assert User.__tablename__ == "users"

    def test_has_mfa_fields(self):
        """Test MFA fields are present."""
        mapper = inspect(User)
        column_names = [c.key for c in mapper.column_attrs]
        assert "mfa_enabled" in column_names
        assert "mfa_secret" in column_names

    def test_has_assigned_alerts_relationship(self):
        """Test that assigned_alerts relationship is active (not commented)."""
        mapper = inspect(User)
        rel_names = [r.key for r in mapper.relationships]
        assert "assigned_alerts" in rel_names
        assert "triage_results" in rel_names


class TestAssetModel:
    """Tests for the Asset ORM model."""

    def test_tablename(self):
        assert Asset.__tablename__ == "assets"

    def test_has_alerts_relationship(self):
        """Test that alerts relationship is active (not commented)."""
        mapper = inspect(Asset)
        rel_names = [r.key for r in mapper.relationships]
        assert "alerts" in rel_names

    def test_criticality_field(self):
        mapper = inspect(Asset)
        column_names = [c.key for c in mapper.column_attrs]
        assert "criticality" in column_names
        assert "asset_type" in column_names


class TestTriageResultModel:
    """Tests for the TriageResult ORM model."""

    def test_tablename(self):
        assert TriageResult.__tablename__ == "triage_results"

    def test_risk_fields(self):
        mapper = inspect(TriageResult)
        column_names = [c.key for c in mapper.column_attrs]
        assert "risk_score" in column_names
        assert "risk_level" in column_names
        assert "confidence" in column_names
        assert "severity_weight" in column_names
        assert "threat_intel_weight" in column_names
        assert "asset_criticality_weight" in column_names
        assert "exploitability_weight" in column_names

    def test_human_review_fields(self):
        mapper = inspect(TriageResult)
        column_names = [c.key for c in mapper.column_attrs]
        assert "requires_human_review" in column_names
        assert "reviewed_by" in column_names
        assert "reviewed_at" in column_names


class TestWorkflowModel:
    """Tests for the Workflow ORM model."""

    def test_tablename(self):
        assert Workflow.__tablename__ == "workflows"

    def test_has_steps_field(self):
        mapper = inspect(Workflow)
        column_names = [c.key for c in mapper.column_attrs]
        assert "steps" in column_names
        assert "trigger_type" in column_names
        assert "status" in column_names


class TestIncidentModel:
    """Tests for the Incident ORM model."""

    def test_tablename(self):
        assert Incident.__tablename__ == "incidents"

    def test_relationships(self):
        mapper = inspect(Incident)
        rel_names = [r.key for r in mapper.relationships]
        assert "creator" in rel_names
        assert "assignee" in rel_names
        assert "alerts" in rel_names
        assert "remediation_actions" in rel_names


class TestAuditLogModel:
    """Tests for the AuditLog ORM model."""

    def test_tablename(self):
        assert AuditLog.__tablename__ == "audit_logs"

    def test_event_fields(self):
        mapper = inspect(AuditLog)
        column_names = [c.key for c in mapper.column_attrs]
        assert "event_type" in column_names
        assert "event_category" in column_names
        assert "action" in column_names
        assert "actor_id" in column_names
        assert "target_type" in column_names
        assert "target_id" in column_names


class TestAllModelsHaveTimestamps:
    """Test that all models have created_at/updated_at timestamps."""

    @pytest.mark.parametrize("model", [
        User, Asset, Alert, AlertContext, TriageResult,
        Incident, RemediationAction, Report, SystemConfig,
        Workflow, WorkflowExecution, Notification,
    ])
    def test_has_created_at(self, model):
        mapper = inspect(model)
        column_names = [c.key for c in mapper.column_attrs]
        assert "created_at" in column_names


class TestBaseClass:
    """Test the declarative base configuration."""

    def test_all_models_extend_base(self):
        """All models should extend the common Base."""
        models = [
            User, Asset, Alert, AlertContext, TriageResult,
            ThreatIntel, Incident, IncidentAlert, RemediationAction,
            AuditLog, Report, SystemConfig, UserPreference,
            Workflow, WorkflowExecution, WorkflowTemplate, Notification,
        ]
        for model in models:
            assert issubclass(model, Base)


# Need ThreatIntel import for TestBaseClass
from shared.database.models import ThreatIntel
