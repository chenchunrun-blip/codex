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

"""Initial schema - all tables for Security Triage System.

Revision ID: 001
Revises: (none)
Create Date: 2026-03-16
"""

from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create all tables, indexes, triggers, and seed data."""
    # Extensions
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # Helper functions
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION generate_alert_id()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.alert_id IS NULL THEN
                NEW.alert_id = 'ALT-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-'
                    || substr(md5(random()::text), 1, 4);
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)

    # ---- Core tables ----

    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            username VARCHAR(100) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            full_name VARCHAR(255),
            phone VARCHAR(20),
            password_hash VARCHAR(255) NOT NULL,
            mfa_enabled BOOLEAN DEFAULT false,
            mfa_secret VARCHAR(255),
            is_active BOOLEAN DEFAULT true,
            is_verified BOOLEAN DEFAULT false,
            role VARCHAR(50) DEFAULT 'analyst'
                CHECK (role IN ('admin','supervisor','analyst','viewer','auditor')),
            department VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            last_login_at TIMESTAMP WITH TIME ZONE
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            asset_id VARCHAR(100) UNIQUE NOT NULL,
            asset_name VARCHAR(255) NOT NULL,
            asset_type VARCHAR(50) NOT NULL
                CHECK (asset_type IN ('server','workstation','network','mobile','cloud','application','database')),
            ip_address INET,
            mac_address MACADDR,
            os_name VARCHAR(100),
            os_version VARCHAR(50),
            owner VARCHAR(100),
            location VARCHAR(255),
            criticality VARCHAR(20) DEFAULT 'medium'
                CHECK (criticality IN ('critical','high','medium','low')),
            business_unit VARCHAR(100),
            environment VARCHAR(20) DEFAULT 'production'
                CHECK (environment IN ('production','staging','development','test')),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            alert_id VARCHAR(100) UNIQUE NOT NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL,
            alert_type VARCHAR(50) NOT NULL
                CHECK (alert_type IN ('malware','phishing','brute_force','data_exfiltration',
                    'anomaly','denial_of_service','unauthorized_access','policy_violation','other')),
            severity VARCHAR(20) NOT NULL
                CHECK (severity IN ('critical','high','medium','low','info')),
            title VARCHAR(500),
            description TEXT,
            source_ip INET,
            destination_ip INET,
            source_port INTEGER,
            destination_port INTEGER,
            protocol VARCHAR(20),
            user_name VARCHAR(100),
            asset_id VARCHAR(100),
            file_hash VARCHAR(100),
            file_name VARCHAR(255),
            url VARCHAR(1000),
            dns_query VARCHAR(500),
            raw_data JSONB,
            status VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','analyzing','analyzed','investigating',
                    'resolved','false_positive','suppressed')),
            assigned_to VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS triage_results (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            alert_id VARCHAR(100) UNIQUE NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
            risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
            risk_level VARCHAR(20)
                CHECK (risk_level IN ('critical','high','medium','low','info')),
            confidence_score DECIMAL(5,2)
                CHECK (confidence_score >= 0 AND confidence_score <= 1),
            analysis_result TEXT,
            recommended_actions TEXT,
            requires_human_review BOOLEAN DEFAULT false,
            human_reviewer VARCHAR(100),
            human_review_notes TEXT,
            reviewed_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS threat_intel (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ioc VARCHAR(1000) NOT NULL,
            ioc_type VARCHAR(50) NOT NULL
                CHECK (ioc_type IN ('ip','domain','url','hash','email','certificate')),
            threat_level VARCHAR(20)
                CHECK (threat_level IN ('critical','high','medium','low','info')),
            confidence_score DECIMAL(5,2)
                CHECK (confidence_score >= 0 AND confidence_score <= 1),
            source VARCHAR(100),
            description TEXT,
            first_seen TIMESTAMP WITH TIME ZONE,
            last_seen TIMESTAMP WITH TIME ZONE,
            detection_rate DECIMAL(5,2),
            positives INTEGER,
            total INTEGER,
            tags TEXT[],
            raw_data JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(ioc, ioc_type)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS alert_context (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            alert_id VARCHAR(100) NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
            context_type VARCHAR(50) NOT NULL
                CHECK (context_type IN ('network','asset','user','threat_intel','historical','correlation')),
            context_data JSONB NOT NULL,
            source VARCHAR(100),
            confidence_score DECIMAL(5,2)
                CHECK (confidence_score >= 0 AND confidence_score <= 1),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            incident_id VARCHAR(100) UNIQUE NOT NULL,
            title VARCHAR(500) NOT NULL,
            description TEXT,
            severity VARCHAR(20) NOT NULL
                CHECK (severity IN ('critical','high','medium','low')),
            status VARCHAR(20) DEFAULT 'open'
                CHECK (status IN ('open','investigating','contained','eradicated','resolved','closed')),
            assigned_to VARCHAR(100),
            detection_date TIMESTAMP WITH TIME ZONE NOT NULL,
            containment_date TIMESTAMP WITH TIME ZONE,
            eradication_date TIMESTAMP WITH TIME ZONE,
            resolution_date TIMESTAMP WITH TIME ZONE,
            root_cause TEXT,
            impact_assessment TEXT,
            lessons_learned TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS remediation_actions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            incident_id VARCHAR(100),
            alert_id VARCHAR(100) REFERENCES alerts(alert_id) ON DELETE SET NULL,
            action_type VARCHAR(50) NOT NULL
                CHECK (action_type IN ('containment','eradication','patching',
                    'configuration_change','access_revocation','isolation','other')),
            description TEXT NOT NULL,
            priority INTEGER CHECK (priority >= 1 AND priority <= 5),
            status VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','completed','skipped','failed')),
            assigned_to VARCHAR(100),
            due_date TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            event_type VARCHAR(50) NOT NULL,
            actor VARCHAR(100) NOT NULL,
            action VARCHAR(100) NOT NULL,
            target_type VARCHAR(50),
            target_id VARCHAR(100),
            old_values JSONB,
            new_values JSONB,
            ip_address INET,
            user_agent TEXT,
            success BOOLEAN DEFAULT true,
            error_message TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS system_configs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            config_key VARCHAR(255) UNIQUE NOT NULL,
            config_value JSONB NOT NULL,
            description TEXT,
            category VARCHAR(100),
            is_sensitive BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_by VARCHAR(100)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS workflow_templates (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            template_id VARCHAR(100) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            category VARCHAR(50) NOT NULL,
            steps JSONB NOT NULL,
            steps_count INTEGER NOT NULL,
            estimated_time VARCHAR(50),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            created_by VARCHAR(100)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            notification_id VARCHAR(255) UNIQUE NOT NULL,
            title VARCHAR(500) NOT NULL,
            message TEXT,
            type VARCHAR(50) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            is_read BOOLEAN DEFAULT false,
            is_deleted BOOLEAN DEFAULT false,
            link VARCHAR(500),
            user_id VARCHAR(100) DEFAULT 'default',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            read_at TIMESTAMP WITH TIME ZONE
        )
    """)

    # ---- New tables for enhanced services ----

    op.execute("""
        CREATE TABLE IF NOT EXISTS service_config (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            config_key VARCHAR(255) NOT NULL,
            config_value JSONB NOT NULL,
            changed_by VARCHAR(100) DEFAULT 'system',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS config_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            config_key VARCHAR(255) NOT NULL,
            old_value JSONB,
            new_value JSONB,
            changed_by VARCHAR(100) DEFAULT 'system',
            changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS analytics_trends (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            metric_type VARCHAR(100) NOT NULL,
            metric_value DECIMAL(10,4) NOT NULL,
            metadata JSONB,
            recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS attack_chain_analysis (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            alert_id VARCHAR(100) REFERENCES alerts(alert_id) ON DELETE CASCADE,
            kill_chain_stage VARCHAR(50) NOT NULL,
            techniques JSONB NOT NULL,
            tactics TEXT[],
            confidence DECIMAL(5,2),
            predictions JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS decision_records (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            alert_id VARCHAR(100) REFERENCES alerts(alert_id) ON DELETE CASCADE,
            risk_score INTEGER,
            decision VARCHAR(50) NOT NULL,
            priority VARCHAR(20),
            assigned_to VARCHAR(100),
            requires_human_review BOOLEAN DEFAULT false,
            approval_level VARCHAR(50),
            sla_deadline TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)

    # ---- Indexes ----
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_received_at ON alerts(received_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_alert_type ON alerts(alert_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_source_ip ON alerts(source_ip)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_triage_results_alert_id ON triage_results(alert_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_triage_results_risk_score ON triage_results(risk_score DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_threat_intel_ioc ON threat_intel(ioc)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_threat_intel_ioc_type ON threat_intel(ioc_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_threat_intel_threat_level ON threat_intel(threat_level)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alert_context_alert_id ON alert_context(alert_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_system_configs_key ON system_configs(config_key)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_system_configs_category ON system_configs(category)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_workflow_templates_template_id ON workflow_templates(template_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_notification_id ON notifications(notification_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_analytics_trends_metric ON analytics_trends(metric_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_analytics_trends_recorded ON analytics_trends(recorded_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_attack_chain_alert ON attack_chain_analysis(alert_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_decision_records_alert ON decision_records(alert_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_service_config_key ON service_config(config_key)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_config_history_key ON config_history(config_key)")

    # ---- Triggers ----
    for table in ["users", "assets", "alerts", "triage_results", "threat_intel",
                   "alert_context", "incidents", "remediation_actions", "system_configs"]:
        op.execute(f"""
            CREATE TRIGGER update_{table}_updated_at BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        """)

    op.execute("""
        CREATE TRIGGER generate_alert_id_trigger BEFORE INSERT ON alerts
        FOR EACH ROW EXECUTE FUNCTION generate_alert_id()
    """)


def downgrade() -> None:
    """Drop all tables in reverse dependency order."""
    tables = [
        "decision_records", "attack_chain_analysis", "analytics_trends",
        "config_history", "service_config", "notifications",
        "workflow_templates", "system_configs", "audit_logs",
        "remediation_actions", "incidents", "alert_context",
        "threat_intel", "triage_results", "alerts", "assets", "users",
    ]
    for table in tables:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    op.execute("DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE")
    op.execute("DROP FUNCTION IF EXISTS generate_alert_id() CASCADE")
