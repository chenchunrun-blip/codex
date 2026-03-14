-- =============================================================================
-- Security Triage System - Database Initialization (Fixed)
-- =============================================================================
-- Version: 1.0 (Fixed)
-- Date: 2026-01-10
-- Fixes: Removed pg_cron extension, fixed execution order
-- =============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_alert_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.alert_id IS NULL THEN
        NEW.alert_id = 'ALT-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 4);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Tables
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
    role VARCHAR(50) DEFAULT 'analyst' CHECK (role IN ('admin', 'supervisor', 'analyst', 'viewer', 'auditor')),
    department VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id VARCHAR(100) UNIQUE NOT NULL,
    asset_name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(50) NOT NULL CHECK (asset_type IN ('server', 'workstation', 'network', 'mobile', 'cloud', 'application', 'database')),
    ip_address INET,
    mac_address MACADDR,
    os_name VARCHAR(100),
    os_version VARCHAR(50),
    owner VARCHAR(100),
    location VARCHAR(255),
    criticality VARCHAR(20) DEFAULT 'medium' CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
    business_unit VARCHAR(100),
    environment VARCHAR(20) DEFAULT 'production' CHECK (environment IN ('production', 'staging', 'development', 'test')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('malware', 'phishing', 'brute_force', 'data_exfiltration', 'anomaly', 'denial_of_service', 'unauthorized_access', 'policy_violation', 'other')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
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
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'analyzed', 'investigating', 'resolved', 'false_positive', 'suppressed')),
    assigned_to VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS triage_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id VARCHAR(100) UNIQUE NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
    risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level VARCHAR(20) CHECK (risk_level IN ('critical', 'high', 'medium', 'low', 'info')),
    confidence_score DECIMAL(5,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    analysis_result TEXT,
    recommended_actions TEXT,
    requires_human_review BOOLEAN DEFAULT false,
    human_reviewer VARCHAR(100),
    human_review_notes TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_intel (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ioc VARCHAR(1000) NOT NULL,
    ioc_type VARCHAR(50) NOT NULL CHECK (ioc_type IN ('ip', 'domain', 'url', 'hash', 'email', 'certificate')),
    threat_level VARCHAR(20) CHECK (threat_level IN ('critical', 'high', 'medium', 'low', 'info')),
    confidence_score DECIMAL(5,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
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
);

CREATE TABLE IF NOT EXISTS alert_context (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id VARCHAR(100) NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
    context_type VARCHAR(50) NOT NULL CHECK (context_type IN ('network', 'asset', 'user', 'threat_intel', 'historical', 'correlation')),
    context_data JSONB NOT NULL,
    source VARCHAR(100),
    confidence_score DECIMAL(5,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'contained', 'eradicated', 'resolved', 'closed')),
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
);

CREATE TABLE IF NOT EXISTS remediation_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id VARCHAR(100),
    alert_id VARCHAR(100) REFERENCES alerts(alert_id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('containment', 'eradication', 'patching', 'configuration_change', 'access_revocation', 'isolation', 'other')),
    description TEXT NOT NULL,
    priority INTEGER CHECK (priority >= 1 AND priority <= 5),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
    assigned_to VARCHAR(100),
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_alerts_received_at ON alerts(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_alert_type ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_source_ip ON alerts(source_ip);
CREATE INDEX IF NOT EXISTS idx_triage_results_alert_id ON triage_results(alert_id);
CREATE INDEX IF NOT EXISTS idx_triage_results_risk_score ON triage_results(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_threat_intel_ioc ON threat_intel(ioc);
CREATE INDEX IF NOT EXISTS idx_threat_intel_ioc_type ON threat_intel(ioc_type);
CREATE INDEX IF NOT EXISTS idx_threat_intel_threat_level ON threat_intel(threat_level);
CREATE INDEX IF NOT EXISTS idx_alert_context_alert_id ON alert_context(alert_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 5. Triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER generate_alert_id_trigger BEFORE INSERT ON alerts
    FOR EACH ROW EXECUTE FUNCTION generate_alert_id();

CREATE TRIGGER update_triage_results_updated_at BEFORE UPDATE ON triage_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_threat_intel_updated_at BEFORE UPDATE ON threat_intel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_context_updated_at BEFORE UPDATE ON alert_context
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_incidents_updated_at BEFORE UPDATE ON incidents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_remediation_actions_updated_at BEFORE UPDATE ON remediation_actions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Insert initial data (passwords are bcrypt hashes for 'admin123' and 'analyst123')
INSERT INTO users (username, email, full_name, password_hash, role, is_active) VALUES
('admin', 'admin@security.local', 'System Administrator', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5NU7xIXU2bq4e', 'admin', true),
('analyst', 'analyst@security.local', 'Security Analyst', '$2b$12$K2x.NHQzLJ8H9wJz5SHO1eSq6Tmw9tNSxIHIPkEB0mFNJhLyN9MLO', 'analyst', true)
ON CONFLICT (username) DO NOTHING;

INSERT INTO assets (asset_id, asset_name, asset_type, ip_address, criticality, environment) VALUES
('SRV-001', 'Production Web Server', 'server', '10.0.1.10', 'high', 'production'),
('SRV-002', 'Database Server', 'server', '10.0.1.20', 'critical', 'production'),
('WS-001', 'HR Workstation', 'workstation', '10.0.2.50', 'medium', 'production')
ON CONFLICT (asset_id) DO NOTHING;

-- 7. System Configurations Table
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
);

CREATE INDEX IF NOT EXISTS idx_system_configs_key ON system_configs(config_key);
CREATE INDEX IF NOT EXISTS idx_system_configs_category ON system_configs(category);

-- Trigger for system_configs
CREATE TRIGGER update_system_configs_updated_at BEFORE UPDATE ON system_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Workflow Templates Table
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
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_template_id ON workflow_templates(template_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON workflow_templates(category);

-- Trigger for workflow_templates
CREATE TRIGGER update_workflow_templates_updated_at BEFORE UPDATE ON workflow_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default workflow templates
INSERT INTO workflow_templates (template_id, name, description, category, steps, steps_count, estimated_time) VALUES
('isolate-host', 'Isolate Compromised Host', 'Isolate a host from the network when malware is detected', 'containment',
 '[{"id":"step-1","name":"Verify Alert","description":"Confirm malware detection and identify affected host","type":"automated","estimated_time":"30s"},
   {"id":"step-2","name":"Block Network Access","description":"Block all network traffic from compromised host","type":"automated","estimated_time":"1m"},
   {"id":"step-3","name":"Isolate from VLAN","description":"Move host to isolated VLAN segment","type":"automated","estimated_time":"2m"},
   {"id":"step-4","name":"Notify Team","description":"Send alert to security team","type":"automated","estimated_time":"30s"},
   {"id":"step-5","name":"Update Ticket","description":"Create/update incident ticket","type":"automated","estimated_time":"1m"}]',
 5, '5m'),

('block-ip', 'Block Malicious IP', 'Block IP address at firewall level', 'containment',
 '[{"id":"step-1","name":"Verify IP Reputation","description":"Check threat intelligence feeds","type":"automated","estimated_time":"30s"},
   {"id":"step-2","name":"Add to Firewall Blocklist","description":"Push block rule to all firewalls","type":"automated","estimated_time":"2m"},
   {"id":"step-3","name":"Verify Block","description":"Confirm rule is active","type":"automated","estimated_time":"1m"}]',
 3, '3.5m'),

('quarantine-file', 'Quarantine Malicious File', 'Move suspicious file to quarantine and delete from original location', 'remediation',
 '[{"id":"step-1","name":"Identify File Location","description":"Locate file on filesystem","type":"automated","estimated_time":"30s"},
   {"id":"step-2","name":"Copy to Quarantine","description":"Copy file to secure quarantine directory","type":"automated","estimated_time":"1m"},
   {"id":"step-3","name":"Delete Original","description":"Remove file from original location","type":"automated","estimated_time":"30s"},
   {"id":"step-4","name":"Update Scan Results","description":"Mark file as quarantined in scan database","type":"automated","estimated_time":"30s"}]',
 4, '2.5m'),

('create-ticket', 'Create Incident Ticket', 'Create ticket in incident tracking system (ServiceNow, Jira)', 'notification',
 '[{"id":"step-1","name":"Gather Alert Details","description":"Compile alert information and context","type":"automated","estimated_time":"30s"},
   {"id":"step-2","name":"Submit Ticket","description":"Create ticket via API","type":"automated","estimated_time":"1m"}]',
 2, '1.5m'),

('enrich-context', 'Enrich Alert Context', 'Gather additional context about the alert (threat intel, asset info)', 'enrichment',
 '[{"id":"step-1","name":"Query Threat Intel","description":"Check IOCs against threat databases","type":"automated","estimated_time":"2m"},
   {"id":"step-2","name":"Get Asset Info","description":"Retrieve asset details from CMDB","type":"automated","estimated_time":"30s"},
   {"id":"step-3","name":"Check User Context","description":"Get user information and activity","type":"automated","estimated_time":"1m"},
   {"id":"step-4","name":"Query Historical Alerts","description":"Find similar past alerts","type":"automated","estimated_time":"1m"},
   {"id":"step-5","name":"Calculate Risk Score","description":"Compute overall risk assessment","type":"automated","estimated_time":"30s"},
   {"id":"step-6","name":"Update Alert","description":"Enrich alert with gathered context","type":"automated","estimated_time":"30s"}]',
 6, '5.5m'),

('notify-team', 'Notify Security Team', 'Send notifications to security team via multiple channels', 'notification',
 '[{"id":"step-1","name":"Prepare Notification","description":"Format alert message","type":"automated","estimated_time":"30s"},
   {"id":"step-2","name":"Send Email","description":"Email security team","type":"automated","estimated_time":"1m"},
   {"id":"step-3","name":"Send Slack Message","description":"Post to Slack channel","type":"automated","estimated_time":"30s"}]',
 3, '2m')
ON CONFLICT (template_id) DO NOTHING;

-- 11. Notifications Table
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
);

CREATE INDEX IF NOT EXISTS idx_notifications_notification_id ON notifications(notification_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- 12. Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO triage_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO triage_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO triage_user;

-- Database initialization completed successfully
-- Default users: admin/Admin123, analyst/analyst123 (CHANGE THESE IN PRODUCTION!)
