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

"""Configuration Service - Centralized configuration management."""

import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import ResponseMeta, SuccessResponse
from shared.utils import Config, get_logger
from sqlalchemy import text

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
publisher: MessagePublisher = None

# In-memory configuration storage (use database in production)
config_store: Dict[str, Dict[str, Any]] = {
    "system": {"version": "1.0.0", "environment": "production", "maintenance_mode": False},
    "alerts": {
        "auto_triage_enabled": True,
        "auto_response_threshold": "high",
        "human_review_required": ["critical", "high"],
    },
    "automation": {
        "approval_required": True,
        "timeout_seconds": 600,
        "max_concurrent_executions": 10,
    },
    "notifications": {
        "channels": ["email", "slack"],
        "critical_alerts": ["email", "slack", "sms"],
        "high_alerts": ["email", "slack"],
        "medium_alerts": ["email"],
        "low_alerts": ["in_app"],
    },
    "llm": {
        "default_model": "deepseek-v3",
        "fallback_model": "qwen3-max",
        "temperature": 0.7,
        "max_tokens": 2000,
    },
}

# Configuration change history
config_history: List[Dict[str, Any]] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, publisher

    logger.info("Starting Configuration service...")

    # Initialize database
    import os

    await init_database(
        database_url=config.database_url,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        echo=config.debug,
    )
    db_manager = get_database_manager()

    # Initialize message publisher
    try:
        publisher = MessagePublisher(config.rabbitmq_url)
        await publisher.connect()
        logger.info("Message publisher connected")
    except Exception as e:
        logger.warning(f"Could not connect message publisher: {e}")

    # Load persisted configuration from database
    await _load_config_from_db()

    logger.info("Configuration service started successfully")

    yield

    if publisher:
        await publisher.close()
    await db_manager.close()
    logger.info("Configuration service stopped")


app = FastAPI(
    title="Configuration Service",
    description="Centralized configuration management",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def publish_config_change(key: str, old_value: Any, new_value: Any, changed_by: str):
    """Publish configuration change event to message queue."""
    if not publisher:
        logger.debug("No publisher available, skipping config change notification")
        return
    try:
        event = {
            "message_id": str(uuid.uuid4()),
            "message_type": "config.changed",
            "timestamp": datetime.utcnow().isoformat(),
            "payload": {
                "key": key,
                "old_value": old_value,
                "new_value": new_value,
                "changed_by": changed_by,
            },
        }
        await publisher.publish("config.changed", event)
        logger.info(f"Config change event published for key: {key}")
    except Exception as e:
        logger.error(f"Failed to publish config change event: {e}")


async def _persist_config(key: str, value: Any, changed_by: str = "system"):
    """Persist a configuration value to the service_config database table.

    Args:
        key: Configuration key name
        value: Configuration value (will be JSON-serialized)
        changed_by: Identity of the actor making the change
    """
    if not db_manager:
        logger.debug("No database manager available, skipping config persistence")
        return

    try:
        async with db_manager.get_session() as session:
            # Upsert: try update first, insert if not exists
            result = await session.execute(
                text("""
                    UPDATE service_config
                    SET config_value = :value, updated_by = :changed_by, updated_at = NOW()
                    WHERE config_key = :key
                """),
                {
                    "key": key,
                    "value": json.dumps(value),
                    "changed_by": changed_by,
                },
            )

            if result.rowcount == 0:
                await session.execute(
                    text("""
                        INSERT INTO service_config (id, config_key, config_value, updated_by, created_at, updated_at)
                        VALUES (:id, :key, :value, :changed_by, NOW(), NOW())
                    """),
                    {
                        "id": str(uuid.uuid4()),
                        "key": key,
                        "value": json.dumps(value),
                        "changed_by": changed_by,
                    },
                )

            await session.commit()
            logger.info(f"Configuration persisted to database: {key}")

    except Exception as e:
        logger.error(f"Failed to persist configuration to database: {e}", exc_info=True)


async def _persist_config_history(key: str, old_value: Any, new_value: Any, changed_by: str):
    """Persist a configuration change history record to the database.

    Args:
        key: Configuration key name
        old_value: Previous configuration value
        new_value: New configuration value
        changed_by: Identity of the actor making the change
    """
    if not db_manager:
        return

    try:
        async with db_manager.get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO service_config_history
                        (id, config_key, old_value, new_value, changed_by, changed_at)
                    VALUES (:id, :key, :old_value, :new_value, :changed_by, NOW())
                """),
                {
                    "id": str(uuid.uuid4()),
                    "key": key,
                    "old_value": json.dumps(old_value),
                    "new_value": json.dumps(new_value),
                    "changed_by": changed_by,
                },
            )
            await session.commit()
            logger.debug(f"Configuration change history persisted for key: {key}")

    except Exception as e:
        logger.error(f"Failed to persist config change history: {e}", exc_info=True)


async def _load_config_from_db():
    """Load all configuration from the database into the in-memory config store.

    Called on startup to restore persisted configuration values.
    """
    if not db_manager:
        logger.debug("No database manager available, using default config")
        return

    try:
        async with db_manager.get_session() as session:
            result = await session.execute(
                text("SELECT config_key, config_value FROM service_config")
            )
            rows = result.fetchall()

            loaded_count = 0
            for row in rows:
                key = row[0]
                try:
                    value = json.loads(row[1])
                    config_store[key] = value
                    loaded_count += 1
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(f"Failed to parse config value for key '{key}': {e}")

            logger.info(f"Loaded {loaded_count} configuration entries from database")

    except Exception as e:
        logger.warning(f"Failed to load config from database, using defaults: {e}")


def record_config_change(key: str, old_value: Any, new_value: Any, changed_by: str):
    """Record configuration change in history."""
    config_history.append(
        {
            "timestamp": datetime.utcnow().isoformat(),
            "key": key,
            "old_value": old_value,
            "new_value": new_value,
            "changed_by": changed_by,
        }
    )


# API Endpoints


@app.get("/api/v1/config", response_model=Dict[str, Any])
async def get_all_config():
    """Get all configuration."""
    return {
        "success": True,
        "data": config_store.copy(),
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.get("/api/v1/config/{key}", response_model=Dict[str, Any])
async def get_config(key: str):
    """Get specific configuration by key."""
    if key not in config_store:
        raise HTTPException(status_code=404, detail=f"Configuration key not found: {key}")

    return {
        "success": True,
        "data": {"key": key, "value": config_store[key]},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


@app.put("/api/v1/config/{key}", response_model=Dict[str, Any])
async def update_config(key: str, value: Dict[str, Any], changed_by: str = "system"):
    """Update configuration."""
    try:
        if key not in config_store:
            raise HTTPException(status_code=404, detail=f"Configuration key not found: {key}")

        old_value = config_store[key].copy()

        # Update configuration
        config_store[key] = value

        # Persist to database
        await _persist_config(key, value, changed_by)

        # Record change in memory and database
        record_config_change(key, old_value, value, changed_by)
        await _persist_config_history(key, old_value, value, changed_by)

        # Publish configuration change event
        await publish_config_change(key, old_value, value, changed_by)

        logger.info(f"Configuration updated: {key} by {changed_by}")

        return {
            "success": True,
            "data": {"key": key, "value": value, "old_value": old_value},
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update configuration: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update configuration: {str(e)}")


@app.post("/api/v1/config/{key}/reset", response_model=Dict[str, Any])
async def reset_config(key: str, changed_by: str = "system"):
    """Reset configuration to default value."""
    try:
        defaults = {
            "system": {"version": "1.0.0", "environment": "production", "maintenance_mode": False},
            "alerts": {
                "auto_triage_enabled": True,
                "auto_response_threshold": "high",
                "human_review_required": ["critical", "high"],
            },
            "automation": {
                "approval_required": True,
                "timeout_seconds": 600,
                "max_concurrent_executions": 10,
            },
            "notifications": {
                "channels": ["email", "slack"],
                "critical_alerts": ["email", "slack", "sms"],
                "high_alerts": ["email", "slack"],
                "medium_alerts": ["email"],
                "low_alerts": ["in_app"],
            },
            "llm": {
                "default_model": "deepseek-v3",
                "fallback_model": "qwen3-max",
                "temperature": 0.7,
                "max_tokens": 2000,
            },
        }

        if key not in defaults:
            raise HTTPException(
                status_code=400, detail=f"No default configuration defined for: {key}"
            )

        old_value = config_store.get(key, {}).copy()
        new_value = defaults[key].copy()

        config_store[key] = new_value

        # Persist reset value to database
        await _persist_config(key, new_value, changed_by)

        # Record change in memory and database
        record_config_change(key, old_value, new_value, changed_by)
        await _persist_config_history(key, old_value, new_value, changed_by)

        await publish_config_change(key, old_value, new_value, changed_by)

        logger.info(f"Configuration reset to default: {key}")

        return {
            "success": True,
            "data": {"key": key, "value": new_value, "reset": True},
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reset configuration: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to reset configuration: {str(e)}")


@app.get("/api/v1/config/{key}/history", response_model=Dict[str, Any])
async def get_config_history(key: str, limit: int = 50):
    """Get configuration change history from database, falling back to in-memory."""
    # Try database first
    db_history = await _query_config_history_from_db(key, limit)
    if db_history is not None:
        history = db_history
    else:
        # Fall back to in-memory history
        history = [h for h in config_history if h["key"] == key]
        history = sorted(history, key=lambda x: x["timestamp"], reverse=True)
        history = history[:limit]

    return {
        "success": True,
        "data": {"key": key, "history": history, "total": len(history)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


async def _query_config_history_from_db(
    key: str, limit: int = 50
) -> Optional[List[Dict[str, Any]]]:
    """Query configuration change history from the database.

    Args:
        key: Configuration key to query history for
        limit: Maximum number of history entries to return

    Returns:
        List of history entries, or None if database is unavailable
    """
    if not db_manager:
        return None

    try:
        async with db_manager.get_session() as session:
            result = await session.execute(
                text("""
                    SELECT config_key, old_value, new_value, changed_by, changed_at
                    FROM service_config_history
                    WHERE config_key = :key
                    ORDER BY changed_at DESC
                    LIMIT :limit
                """),
                {"key": key, "limit": limit},
            )
            rows = result.fetchall()
            return [
                {
                    "key": row[0],
                    "old_value": json.loads(row[1]) if row[1] else None,
                    "new_value": json.loads(row[2]) if row[2] else None,
                    "changed_by": row[3],
                    "timestamp": row[4].isoformat() if row[4] else None,
                }
                for row in rows
            ]

    except Exception as e:
        logger.warning(f"Failed to query config history from database: {e}")
        return None


@app.post("/api/v1/config/export", response_model=Dict[str, Any])
async def export_config(format: str = "json"):
    """Export all configuration."""
    try:
        if format == "json":
            content = json.dumps(config_store, indent=2)
            content_type = "application/json"
            filename = f"config_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"

        elif format == "yaml":
            content = yaml.dump(config_store, default_flow_style=False)
            content_type = "application/x-yaml"
            filename = f"config_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.yaml"

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported format: {format}. Use 'json' or 'yaml'"
            )

        return {
            "success": True,
            "data": {
                "content": content,
                "format": format,
                "filename": filename,
                "content_type": content_type,
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to export configuration: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to export configuration: {str(e)}")


@app.post("/api/v1/config/import", response_model=Dict[str, Any])
async def import_config(
    content: str, format: str = "json", merge: bool = True, changed_by: str = "import"
):
    """Import configuration."""
    try:
        if format == "json":
            imported_config = json.loads(content)
        elif format == "yaml":
            imported_config = yaml.safe_load(content)
        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported format: {format}. Use 'json' or 'yaml'"
            )

        if not isinstance(imported_config, dict):
            raise HTTPException(status_code=400, detail="Invalid configuration format")

        # Validate imported configuration
        for key, value in imported_config.items():
            if key in config_store and not isinstance(value, dict):
                raise HTTPException(status_code=400, detail=f"Invalid configuration for key: {key}")

        # Apply configuration
        imported_keys = []
        for key, value in imported_config.items():
            if key in config_store:
                old_value = config_store[key].copy()

                if merge and isinstance(value, dict) and isinstance(old_value, dict):
                    # Merge dictionaries
                    merged = {**old_value, **value}
                    config_store[key] = merged
                    record_config_change(key, old_value, merged, changed_by)
                    await _persist_config(key, merged, changed_by)
                    await _persist_config_history(key, old_value, merged, changed_by)
                else:
                    # Replace entirely
                    config_store[key] = value
                    record_config_change(key, old_value, value, changed_by)
                    await _persist_config(key, value, changed_by)
                    await _persist_config_history(key, old_value, value, changed_by)

                imported_keys.append(key)

        logger.info(f"Configuration imported: {len(imported_keys)} keys updated by {changed_by}")

        return {
            "success": True,
            "data": {"imported_keys": imported_keys, "total": len(imported_keys)},
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to import configuration: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to import configuration: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "configuration-service",
        "timestamp": datetime.utcnow().isoformat(),
        "config_keys": len(config_store),
        "history_entries": len(config_history),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
