#!/usr/bin/env python3
"""
Initialize new database tables for Settings and Workflows.

This script creates the following tables:
- system_configs
- user_preferences
- workflows
- workflow_executions
"""

import asyncio
import os
from sqlalchemy import select

from shared.database.base import get_database_manager, init_database
from shared.database.models import SystemConfig, UserPreference, Workflow, WorkflowExecution


async def create_tables():
    """Create new database tables."""
    from shared.database.models import Base

    db_manager = get_database_manager()

    async with db_manager.engine.begin() as conn:
        # Create all tables from Base metadata
        await conn.run_sync(lambda connection: Base.metadata.create_all(connection, checkfirst=True))

    print("✓ Tables created successfully")


async def seed_initial_data():
    """Seed initial data for testing."""
    db_manager = get_database_manager()

    async with db_manager.get_session() as session:
        # Check if data already exists
        result = await session.execute(select(SystemConfig).limit(1))
        if result.scalar_one_or_none():
            print("✓ Initial data already exists, skipping seed")
            return

        # Seed system configs
        configs = [
            SystemConfig(
                config_key="risk_thresholds",
                config_value={
                    "critical": 90,
                    "high": 70,
                    "medium": 40,
                    "low": 20,
                },
                description="Risk score thresholds for alert classification",
                category="triage",
                updated_by="system",
            ),
            SystemConfig(
                config_key="triage_weights",
                config_value={
                    "severity": 0.3,
                    "threat_intel": 0.3,
                    "asset_criticality": 0.2,
                    "exploitability": 0.2,
                },
                description="Weight factors for risk score calculation",
                category="triage",
                updated_by="system",
            ),
            SystemConfig(
                config_key="notification_settings",
                config_value={
                    "email_enabled": True,
                    "slack_enabled": True,
                    "webhook_enabled": False,
                },
                description="System-wide notification settings",
                category="notifications",
                updated_by="system",
            ),
        ]

        # Seed user preferences
        preferences = [
            UserPreference(
                user_id="default",
                preference_key="ui_settings",
                preference_value={
                    "theme": "light",
                    "language": "en",
                    "timezone": "UTC",
                    "items_per_page": 20,
                },
            ),
            UserPreference(
                user_id="default",
                preference_key="alert_filters",
                preference_value={
                    "default_severity": ["critical", "high", "medium"],
                    "default_status": ["pending", "analyzing", "triaged"],
                },
            ),
        ]

        # Seed workflows
        workflows = [
            Workflow(
                workflow_id="isolate-host",
                name="Isolate Compromised Host",
                description="Isolate a host from the network when malware is detected",
                category="containment",
                trigger_type="manual",
                status="active",
                priority="high",
                steps=[
                    {
                        "id": "step-1",
                        "name": "Verify Alert",
                        "description": "Confirm malware detection and identify affected host",
                        "type": "automated",
                        "estimated_time": "30s",
                    },
                    {
                        "id": "step-2",
                        "name": "Block Network Access",
                        "description": "Block all network traffic from infected host",
                        "type": "automated",
                        "estimated_time": "1m",
                    },
                    {
                        "id": "step-3",
                        "name": "Isolate from VLAN",
                        "description": "Move host to isolated VLAN segment",
                        "type": "automated",
                        "estimated_time": "2m",
                    },
                    {
                        "id": "step-4",
                        "name": "Notify Team",
                        "description": "Send alert to security team",
                        "type": "automated",
                        "estimated_time": "30s",
                    },
                    {
                        "id": "step-5",
                        "name": "Update Ticket",
                        "description": "Create or update incident ticket",
                        "type": "automated",
                        "estimated_time": "1m",
                    },
                ],
                created_by="system",
            ),
            Workflow(
                workflow_id="block-ip",
                name="Block Malicious IP",
                description="Block malicious IP addresses at the firewall",
                category="containment",
                trigger_type="manual",
                status="active",
                priority="high",
                steps=[
                    {
                        "id": "step-1",
                        "name": "Verify IP Reputation",
                        "description": "Check threat intelligence sources",
                        "type": "automated",
                        "estimated_time": "30s",
                    },
                    {
                        "id": "step-2",
                        "name": "Add to Firewall Blocklist",
                        "description": "Push block rule to all firewalls",
                        "type": "automated",
                        "estimated_time": "2m",
                    },
                    {
                        "id": "step-3",
                        "name": "Verify Block",
                        "description": "Confirm rule is active",
                        "type": "automated",
                        "estimated_time": "1m",
                    },
                ],
                created_by="system",
            ),
            Workflow(
                workflow_id="quarantine-file",
                name="Quarantine Malicious File",
                description="Quarantine malicious files on endpoints",
                category="containment",
                trigger_type="manual",
                status="active",
                priority="high",
                steps=[
                    {
                        "id": "step-1",
                        "name": "Identify File Location",
                        "description": "Locate file on filesystem",
                        "type": "automated",
                        "estimated_time": "30s",
                    },
                    {
                        "id": "step-2",
                        "name": "Copy to Quarantine",
                        "description": "Copy file to secure quarantine directory",
                        "type": "automated",
                        "estimated_time": "1m",
                    },
                    {
                        "id": "step-3",
                        "name": "Delete Original",
                        "description": "Remove file from original location",
                        "type": "automated",
                        "estimated_time": "30s",
                    },
                    {
                        "id": "step-4",
                        "name": "Update Scan Results",
                        "description": "Mark file as quarantined in scan database",
                        "type": "automated",
                        "estimated_time": "30s",
                    },
                ],
                created_by="system",
            ),
        ]

        session.add_all(configs)
        session.add_all(preferences)
        session.add_all(workflows)
        await session.commit()

        print(f"✓ Seeded {len(configs)} system configs")
        print(f"✓ Seeded {len(preferences)} user preferences")
        print(f"✓ Seeded {len(workflows)} workflows")


async def main():
    """Main initialization function."""
    print("=" * 60)
    print("Database Initialization: Settings & Workflows")
    print("=" * 60)

    try:
        # Initialize database manager
        database_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@postgres:5432/security_triage")
        await init_database(database_url)

        await create_tables()
        await seed_initial_data()

        print("\n" + "=" * 60)
        print("✓ Initialization complete!")
        print("=" * 60)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
