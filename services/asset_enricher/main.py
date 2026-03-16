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
Asset Enricher Service - Enriches alerts with asset data and vulnerability information.

This service consumes enriched alerts and augments them with:
- CMDB integration (asset lookup by ID/IP)
- Vulnerability data aggregation
- Asset criticality evaluation
- Patch status tracking
"""

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.database.models import Asset
from shared.messaging import MessageConsumer, MessagePublisher
from shared.models import SecurityAlert
from shared.utils import Config, get_logger
from sqlalchemy import select, text

# Initialize logger
logger = get_logger(__name__)

# Initialize config
config = Config()

# Global variables
db_manager: DatabaseManager = None
publisher: MessagePublisher = None
consumer: MessageConsumer = None

# Cache for asset data (in-memory, use Redis in production)
asset_cache: Dict[str, tuple] = {}  # key: (data, expiry_time)
CACHE_TTL_SECONDS = 3600  # 1 hour

# Metrics counters
metrics = {
    "alerts_processed": 0,
    "assets_found": 0,
    "assets_not_found": 0,
    "vulnerabilities_assessed": 0,
    "errors": 0,
}


# =============================================================================
# Criticality Evaluation
# =============================================================================

CRITICALITY_MULTIPLIERS = {
    "critical": 1.0,
    "high": 0.8,
    "medium": 0.5,
    "low": 0.2,
    "unknown": 0.3,
}


def evaluate_criticality(criticality: str) -> Dict[str, Any]:
    """
    Evaluate asset criticality and return numeric multiplier and metadata.

    Args:
        criticality: Criticality level string (critical, high, medium, low)

    Returns:
        Dictionary with criticality evaluation results
    """
    criticality_lower = criticality.lower() if criticality else "unknown"
    multiplier = CRITICALITY_MULTIPLIERS.get(criticality_lower, 0.3)

    return {
        "criticality_level": criticality_lower,
        "criticality_multiplier": multiplier,
        "requires_immediate_attention": criticality_lower in ("critical", "high"),
        "escalation_priority": {
            "critical": 1,
            "high": 2,
            "medium": 3,
            "low": 4,
            "unknown": 5,
        }.get(criticality_lower, 5),
    }


# =============================================================================
# Vulnerability Assessment
# =============================================================================


def calculate_vulnerability_score(vulnerabilities: Dict[str, Any]) -> Dict[str, Any]:
    """
    Aggregate vulnerability counts and calculate a vulnerability score.

    Args:
        vulnerabilities: Dictionary of vulnerability data from asset record

    Returns:
        Vulnerability assessment with score and breakdown
    """
    # Extract vulnerability counts by severity
    critical_count = vulnerabilities.get("critical", 0)
    high_count = vulnerabilities.get("high", 0)
    medium_count = vulnerabilities.get("medium", 0)
    low_count = vulnerabilities.get("low", 0)

    total_count = critical_count + high_count + medium_count + low_count

    # Weighted vulnerability score (0-100)
    # Critical: 10 points each, High: 5, Medium: 2, Low: 0.5
    raw_score = critical_count * 10.0 + high_count * 5.0 + medium_count * 2.0 + low_count * 0.5
    # Cap at 100
    vulnerability_score = min(100.0, raw_score)

    return {
        "vulnerability_score": round(vulnerability_score, 2),
        "total_vulnerabilities": total_count,
        "breakdown": {
            "critical": critical_count,
            "high": high_count,
            "medium": medium_count,
            "low": low_count,
        },
        "risk_level": (
            "critical"
            if vulnerability_score >= 80
            else (
                "high"
                if vulnerability_score >= 50
                else "medium" if vulnerability_score >= 20 else "low"
            )
        ),
        "has_critical_vulnerabilities": critical_count > 0,
    }


# =============================================================================
# Patch Status Tracking
# =============================================================================


def assess_patch_status(asset_attributes: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Assess patch status from asset attributes.

    Args:
        asset_attributes: Asset attributes JSON from database

    Returns:
        Patch status assessment
    """
    if not asset_attributes:
        return {
            "patch_status": "unknown",
            "last_patched": None,
            "pending_patches": 0,
            "patch_compliance": False,
        }

    patch_info = asset_attributes.get("patch_info", {})
    last_patched = patch_info.get("last_patched")
    pending_patches = patch_info.get("pending_patches", 0)

    # Determine patch compliance
    patch_compliant = True
    if pending_patches > 0:
        patch_compliant = False
    if last_patched:
        try:
            last_patched_dt = datetime.fromisoformat(last_patched.replace("Z", "+00:00"))
            days_since_patch = (datetime.utcnow() - last_patched_dt.replace(tzinfo=None)).days
            if days_since_patch > 30:
                patch_compliant = False
        except (ValueError, TypeError):
            patch_compliant = False

    return {
        "patch_status": "compliant" if patch_compliant else "non-compliant",
        "last_patched": last_patched,
        "pending_patches": pending_patches,
        "patch_compliance": patch_compliant,
        "patch_details": patch_info,
    }


# =============================================================================
# Asset Lookup (CMDB Integration)
# =============================================================================


async def lookup_asset_by_id(asset_id: str) -> Optional[Dict[str, Any]]:
    """
    Look up asset from database by asset_id.

    Args:
        asset_id: Asset identifier string

    Returns:
        Asset data dictionary or None if not found
    """
    # Check cache
    cache_key = f"asset_id:{asset_id}"
    if cache_key in asset_cache:
        data, expiry = asset_cache[cache_key]
        if datetime.utcnow().timestamp() < expiry:
            logger.debug(f"Asset cache hit for {asset_id}")
            return data

    try:
        async with db_manager.get_session() as session:
            result = await session.execute(select(Asset).where(Asset.asset_id == asset_id))
            asset = result.scalar_one_or_none()

            if asset:
                asset_data = {
                    "asset_id": asset.asset_id,
                    "name": asset.name,
                    "asset_type": asset.asset_type,
                    "ip_address": asset.ip_address,
                    "mac_address": asset.mac_address,
                    "os": asset.os,
                    "owner": asset.owner,
                    "location": asset.location,
                    "criticality": asset.criticality,
                    "is_active": asset.is_active,
                    "attributes": asset.attributes,
                    "created_at": asset.created_at.isoformat() if asset.created_at else None,
                    "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
                }

                # Cache result
                expiry_time = datetime.utcnow().timestamp() + CACHE_TTL_SECONDS
                asset_cache[cache_key] = (asset_data, expiry_time)

                return asset_data

            return None

    except Exception as e:
        logger.error(f"Failed to look up asset by ID {asset_id}: {e}")
        return None


async def lookup_asset_by_ip(ip_address: str) -> Optional[Dict[str, Any]]:
    """
    Look up asset from database by IP address.

    Args:
        ip_address: IP address string

    Returns:
        Asset data dictionary or None if not found
    """
    # Check cache
    cache_key = f"asset_ip:{ip_address}"
    if cache_key in asset_cache:
        data, expiry = asset_cache[cache_key]
        if datetime.utcnow().timestamp() < expiry:
            logger.debug(f"Asset cache hit for IP {ip_address}")
            return data

    try:
        async with db_manager.get_session() as session:
            result = await session.execute(select(Asset).where(Asset.ip_address == ip_address))
            asset = result.scalar_one_or_none()

            if asset:
                asset_data = {
                    "asset_id": asset.asset_id,
                    "name": asset.name,
                    "asset_type": asset.asset_type,
                    "ip_address": asset.ip_address,
                    "mac_address": asset.mac_address,
                    "os": asset.os,
                    "owner": asset.owner,
                    "location": asset.location,
                    "criticality": asset.criticality,
                    "is_active": asset.is_active,
                    "attributes": asset.attributes,
                    "created_at": asset.created_at.isoformat() if asset.created_at else None,
                    "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
                }

                # Cache result
                expiry_time = datetime.utcnow().timestamp() + CACHE_TTL_SECONDS
                asset_cache[cache_key] = (asset_data, expiry_time)

                return asset_data

            return None

    except Exception as e:
        logger.error(f"Failed to look up asset by IP {ip_address}: {e}")
        return None


# =============================================================================
# Asset Enrichment Pipeline
# =============================================================================


async def enrich_alert_with_asset(
    alert_data: Dict[str, Any], enrichment: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Enrich alert with asset data, vulnerability assessment, criticality evaluation,
    and patch status.

    Args:
        alert_data: Alert payload dictionary
        enrichment: Existing enrichment data from upstream services

    Returns:
        Asset enrichment data dictionary
    """
    asset_enrichment = {
        "enriched_at": datetime.utcnow().isoformat(),
        "source": "asset-enricher",
        "asset_data": None,
        "criticality_evaluation": None,
        "vulnerability_assessment": None,
        "patch_status": None,
    }

    # Determine asset lookup strategy
    asset_id = alert_data.get("asset_id")
    source_ip = alert_data.get("source_ip")
    target_ip = alert_data.get("target_ip")

    asset_data = None

    # Try lookup by asset_id first
    if asset_id:
        logger.info(f"Looking up asset by ID: {asset_id}")
        asset_data = await lookup_asset_by_id(asset_id)

    # Fall back to IP lookup if asset_id lookup failed
    if not asset_data and target_ip:
        logger.info(f"Looking up asset by target IP: {target_ip}")
        asset_data = await lookup_asset_by_ip(target_ip)

    if not asset_data and source_ip:
        logger.info(f"Looking up asset by source IP: {source_ip}")
        asset_data = await lookup_asset_by_ip(source_ip)

    if asset_data:
        metrics["assets_found"] += 1
        asset_enrichment["asset_data"] = asset_data

        # Evaluate criticality
        asset_enrichment["criticality_evaluation"] = evaluate_criticality(
            asset_data.get("criticality", "unknown")
        )

        # Assess vulnerabilities from asset attributes
        vuln_data = {}
        if asset_data.get("attributes") and isinstance(asset_data["attributes"], dict):
            vuln_data = asset_data["attributes"].get("vulnerabilities", {})
        asset_enrichment["vulnerability_assessment"] = calculate_vulnerability_score(vuln_data)
        metrics["vulnerabilities_assessed"] += 1

        # Assess patch status
        asset_enrichment["patch_status"] = assess_patch_status(asset_data.get("attributes"))

        logger.info(
            f"Asset enrichment complete for {asset_id or source_ip or target_ip}: "
            f"criticality={asset_enrichment['criticality_evaluation']['criticality_level']}, "
            f"vuln_score={asset_enrichment['vulnerability_assessment']['vulnerability_score']}"
        )
    else:
        metrics["assets_not_found"] += 1
        logger.warning(
            f"Asset not found for alert (asset_id={asset_id}, "
            f"source_ip={source_ip}, target_ip={target_ip})"
        )
        # Provide default evaluations when asset is not found
        asset_enrichment["criticality_evaluation"] = evaluate_criticality("unknown")
        asset_enrichment["vulnerability_assessment"] = calculate_vulnerability_score({})
        asset_enrichment["patch_status"] = assess_patch_status(None)

    return asset_enrichment


# =============================================================================
# Cache Management
# =============================================================================


async def cleanup_cache():
    """
    Periodic cache cleanup task.
    Removes expired entries from cache.
    """
    while True:
        try:
            now = datetime.utcnow().timestamp()
            expired_keys = [key for key, (_, expiry) in asset_cache.items() if now >= expiry]

            for key in expired_keys:
                del asset_cache[key]

            if expired_keys:
                logger.debug(f"Cleaned up {len(expired_keys)} expired cache entries")

            # Sleep for 5 minutes
            await asyncio.sleep(300)

        except Exception as e:
            logger.error(f"Cache cleanup failed: {e}")
            await asyncio.sleep(60)


# =============================================================================
# FastAPI Application
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global db_manager, publisher, consumer

    logger.info("Starting Asset Enricher Service")

    try:
        # Initialize database FIRST before getting manager
        await init_database(
            database_url=config.database_url,
            pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
            echo=config.debug,
        )
        db_manager = get_database_manager()
        logger.info("Database connected")

        # Initialize message publisher
        publisher = MessagePublisher(config.rabbitmq_url)
        await publisher.connect()
        logger.info("Message publisher connected")

        # Initialize message consumer
        consumer = MessageConsumer(config.rabbitmq_url, "alert.enriched")
        await consumer.connect()
        logger.info("Message consumer connected")

        # Start message consumer task
        asyncio.create_task(consume_alerts())
        logger.info("Message consumer task started")

        # Start cache cleanup task
        asyncio.create_task(cleanup_cache())
        logger.info("Cache cleanup task started")

        logger.info("Asset Enricher Service started successfully")

        yield

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise

    finally:
        logger.info("Shutting down Asset Enricher Service")

        if consumer:
            await consumer.close()
            logger.info("Message consumer closed")

        if publisher:
            await publisher.close()
            logger.info("Message publisher closed")

        # Close database using the close_database function
        await close_database()
        logger.info("Database connection closed")

        logger.info("Asset Enricher Service stopped")


# Create FastAPI app
app = FastAPI(
    title="Asset Enricher API",
    description="Enriches alerts with CMDB asset data, vulnerability assessment, and patch status",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Background Task: Message Consumer
# =============================================================================


async def persist_asset_context_to_db(alert_id: str, asset_enrichment: Dict[str, Any]):
    """
    Persist asset enrichment data to database.

    Args:
        alert_id: Alert identifier
        asset_enrichment: Asset enrichment data dictionary
    """
    try:
        async with db_manager.get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO alert_context (alert_id, context_type, context_data, source, confidence_score)
                    VALUES (:alert_id, :context_type, :context_data, :source, :confidence_score)
                """),
                {
                    "alert_id": alert_id,
                    "context_type": "asset_enrichment",
                    "context_data": json.dumps(asset_enrichment),
                    "source": "asset-enricher",
                    "confidence_score": 0.9,
                },
            )
            await session.commit()
            logger.debug(f"Asset enrichment persisted for alert {alert_id}")

    except Exception as e:
        logger.error(f"Failed to persist asset enrichment: {e}", exc_info=True)


async def consume_alerts():
    """Consume enriched alerts and augment with asset data."""

    async def process_message(message: dict):
        try:
            # Unwrap message envelope if present (publisher wraps with _meta and data)
            if "data" in message and isinstance(message["data"], dict):
                actual_message = message["data"]
                meta = message.get("_meta", {})
                message_id = meta.get("message_id", message.get("message_id", "unknown"))
            else:
                actual_message = message
                message_id = message.get("message_id", "unknown")

            payload = actual_message.get("payload", actual_message)

            # The payload from context_collector contains alert and enrichment
            alert_data = payload.get("alert", payload)
            existing_enrichment = payload.get("enrichment", {})

            alert_id = alert_data.get("alert_id", "unknown")
            logger.info(f"Processing alert {alert_id} (message_id: {message_id})")

            # Enrich with asset data
            asset_enrichment = await enrich_alert_with_asset(alert_data, existing_enrichment)

            # Persist to database
            await persist_asset_context_to_db(alert_id, asset_enrichment)

            # Merge enrichments
            merged_enrichment = {**existing_enrichment}
            merged_enrichment["asset_enrichment"] = asset_enrichment
            merged_enrichment["enrichment_sources"] = existing_enrichment.get(
                "enrichment_sources", []
            ) + ["asset_enricher"]

            # Create enriched message for downstream
            enriched_message = {
                "message_id": str(uuid.uuid4()),
                "message_type": "alert.asset_enriched",
                "correlation_id": alert_id,
                "original_message_id": message_id,
                "timestamp": datetime.utcnow().isoformat(),
                "version": "1.0",
                "payload": {
                    "alert": alert_data,
                    "enrichment": merged_enrichment,
                },
            }

            # Publish asset-enriched alert
            await publisher.publish("alert.asset_enriched", enriched_message)

            metrics["alerts_processed"] += 1
            logger.info(
                f"Alert asset-enriched successfully (message_id: {message_id}, alert_id: {alert_id})"
            )

        except Exception as e:
            metrics["errors"] += 1
            logger.error(f"Asset enrichment failed: {e}", exc_info=True)
            # Re-raise to let consumer handle retries and DLQ
            raise

    # Start consuming
    await consumer.consume(process_message)


# =============================================================================
# API Endpoints
# =============================================================================


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    try:
        return {
            "status": "healthy",
            "service": "asset-enricher",
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "database": "connected" if db_manager else "disconnected",
                "message_queue_consumer": "connected" if consumer else "disconnected",
                "message_queue_publisher": "connected" if publisher else "disconnected",
                "cache_size": len(asset_cache),
            },
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "asset-enricher",
            "error": str(e),
        }


@app.get("/metrics", tags=["Metrics"])
async def get_metrics():
    """Get asset enrichment metrics."""
    return {
        "service": "asset-enricher",
        "cache_size": len(asset_cache),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "alerts_processed": metrics["alerts_processed"],
        "assets_found": metrics["assets_found"],
        "assets_not_found": metrics["assets_not_found"],
        "vulnerabilities_assessed": metrics["vulnerabilities_assessed"],
        "errors": metrics["errors"],
    }


@app.get("/api/v1/assets/{asset_id}", tags=["Assets"])
async def get_asset(asset_id: str):
    """
    Look up asset by asset ID from CMDB.

    Args:
        asset_id: Asset identifier

    Returns:
        Asset data with criticality evaluation
    """
    try:
        asset_data = await lookup_asset_by_id(asset_id)

        if not asset_data:
            raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")

        criticality_eval = evaluate_criticality(asset_data.get("criticality", "unknown"))
        patch_status = assess_patch_status(asset_data.get("attributes"))

        return {
            "success": True,
            "data": {
                "asset": asset_data,
                "criticality_evaluation": criticality_eval,
                "patch_status": patch_status,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Asset lookup failed for {asset_id}: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@app.get("/api/v1/assets/{asset_id}/vulnerabilities", tags=["Assets"])
async def get_asset_vulnerabilities(asset_id: str):
    """
    Get vulnerability assessment for an asset.

    Args:
        asset_id: Asset identifier

    Returns:
        Vulnerability assessment data
    """
    try:
        asset_data = await lookup_asset_by_id(asset_id)

        if not asset_data:
            raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")

        # Extract vulnerability data from attributes
        vuln_data = {}
        if asset_data.get("attributes") and isinstance(asset_data["attributes"], dict):
            vuln_data = asset_data["attributes"].get("vulnerabilities", {})

        vulnerability_assessment = calculate_vulnerability_score(vuln_data)

        return {
            "success": True,
            "data": {
                "asset_id": asset_id,
                "asset_name": asset_data.get("name"),
                "vulnerability_assessment": vulnerability_assessment,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Vulnerability lookup failed for {asset_id}: {e}")
        return {
            "success": False,
            "error": str(e),
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level=config.log_level.lower(),
    )
