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
from shared.messaging import MessageConsumer
from shared.models import ResponseMeta, SuccessResponse
from shared.utils import Config, get_logger

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None

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
    global db_manager

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

    logger.info("Configuration service started successfully")

    yield

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

        # Record change
        record_config_change(key, old_value, value, changed_by)

        # Publish configuration change event
        # TODO: Send to message queue for other services to update

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
        # TODO: Define default configurations
        defaults = {
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
        }

        if key not in defaults:
            raise HTTPException(
                status_code=400, detail=f"No default configuration defined for: {key}"
            )

        old_value = config_store.get(key, {}).copy()
        new_value = defaults[key].copy()

        config_store[key] = new_value

        record_config_change(key, old_value, new_value, changed_by)

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
    """Get configuration change history."""
    history = [h for h in config_history if h["key"] == key]

    # Sort by timestamp descending
    history = sorted(history, key=lambda x: x["timestamp"], reverse=True)

    # Limit results
    history = history[:limit]

    return {
        "success": True,
        "data": {"key": key, "history": history, "total": len(history)},
        "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
    }


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
                else:
                    # Replace entirely
                    config_store[key] = value
                    record_config_change(key, old_value, value, changed_by)

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
