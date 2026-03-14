-- Create reports table
-- This migration adds the reports table for storing generated security reports

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    report_type VARCHAR(50) NOT NULL,
    format VARCHAR(20) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    filters JSON,
    file_path VARCHAR(500),
    file_size INTEGER,
    created_by VARCHAR(255) NOT NULL DEFAULT 'system',
    schedule_frequency VARCHAR(20),
    schedule_time VARCHAR(10),
    schedule_recipients TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS ix_reports_report_id ON reports(report_id);
CREATE INDEX IF NOT EXISTS ix_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS ix_reports_report_type ON reports(report_type);
CREATE INDEX IF NOT EXISTS ix_reports_created_at ON reports(created_at);

-- Add comments for documentation
COMMENT ON TABLE reports IS 'Stores generated security reports and their metadata';
COMMENT ON COLUMN reports.report_id IS 'Unique human-readable report identifier (e.g., RPT-ALERTS-abc123)';
COMMENT ON COLUMN reports.report_type IS 'Type of report: alerts, metrics, trends, custom';
COMMENT ON COLUMN reports.format IS 'File format: pdf, csv, json, excel';
COMMENT ON COLUMN reports.status IS 'Generation status: pending, generating, completed, failed';
COMMENT ON COLUMN reports.filters IS 'Report filters and parameters stored as JSON';
COMMENT ON COLUMN reports.schedule_frequency IS 'For recurring reports: daily, weekly, monthly';
COMMENT ON COLUMN reports.schedule_time IS 'Scheduled time in HH:MM format';
COMMENT ON COLUMN reports.schedule_recipients IS 'Email addresses for scheduled report delivery';
