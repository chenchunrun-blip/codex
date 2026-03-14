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

"""Data Analytics Service - Provides analytics and metrics for security alerts."""

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
from shared.database.repositories.base import BaseRepository
from shared.messaging import MessageConsumer
from shared.models import (
    AlertMetric,
    AnalyticsQuery,
    AnalyticsResponse,
    AutomationMetric,
    DashboardData,
    ResponseMeta,
    SecurityAlert,
    SuccessResponse,
    TimeRange,
    TrendData,
    TriageMetric,
    TriageResult,
)
from shared.utils import Config, get_logger

logger = get_logger(__name__)
config = Config()

db_manager: DatabaseManager = None
consumer: MessageConsumer = None

# In-memory metrics cache (use database + time-series DB in production)
metrics_cache: Dict[str, Any] = {
    "alerts": {
        "total": 0,
        "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0},
        "by_type": {},
        "triaged": 0,
        "auto_closed": 0,
        "human_reviewed": 0,
    },
    "triage": {
        "total_triage_time": 0.0,
        "triage_count": 0,
        "ai_triaged": 0,
        "human_triaged": 0,
        "accurate": 0,
        "false_positives": 0,
    },
    "automation": {
        "playbooks_executed": 0,
        "actions_executed": 0,
        "successful": 0,
        "total_time": 0.0,
    },
}

# Trend data storage
trends_cache: Dict[str, List[TrendData]] = {
    "alert_volume": [],
    "triage_accuracy": [],
    "automation_rate": [],
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global db_manager, consumer

    logger.info("Starting Data Analytics service...")

    # Initialize database
    import os
    await init_database(
        database_url=config.database_url,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        echo=config.debug,
    )
    db_manager = get_database_manager()

    # Initialize message consumer (optional, for real-time metrics)
    try:
        consumer = MessageConsumer(config.rabbitmq_url, "analytics.events")
        await consumer.connect()
        asyncio.create_task(consume_analytics_events())
    except Exception as e:
        logger.warning(f"Could not connect to message queue: {e}")

    # Start background task to update trends
    asyncio.create_task(update_trends_periodically())

    logger.info("Data Analytics service started successfully")

    yield

    # Cleanup
    if consumer:
        await consumer.close()
    await db_manager.close()
    logger.info("Data Analytics service stopped")


app = FastAPI(
    title="Data Analytics Service",
    description="Provides analytics and metrics for security operations",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def consume_analytics_events():
    """Consume analytics events from message queue."""

    async def process_message(message: dict):
        try:
            event_type = message.get("event_type")
            payload = message.get("payload", {})

            if event_type == "alert_created":
                metrics_cache["alerts"]["total"] += 1
                severity = payload.get("severity", "unknown").lower()
                if severity in metrics_cache["alerts"]["by_severity"]:
                    metrics_cache["alerts"]["by_severity"][severity] += 1

                alert_type = payload.get("alert_type", "unknown")
                metrics_cache["alerts"]["by_type"][alert_type] = (
                    metrics_cache["alerts"]["by_type"].get(alert_type, 0) + 1
                )

            elif event_type == "alert_triaged":
                metrics_cache["alerts"]["triaged"] += 1

                triage_time = payload.get("triage_time_seconds", 0)
                metrics_cache["triage"]["total_triage_time"] += triage_time
                metrics_cache["triage"]["triage_count"] += 1

                triaged_by = payload.get("triaged_by", "unknown")
                if triaged_by == "ai-agent":
                    metrics_cache["triage"]["ai_triaged"] += 1
                else:
                    metrics_cache["triage"]["human_triaged"] += 1

            elif event_type == "automation_executed":
                metrics_cache["automation"]["playbooks_executed"] += 1
                actions_count = payload.get("actions_count", 0)
                metrics_cache["automation"]["actions_executed"] += actions_count

                if payload.get("success"):
                    metrics_cache["automation"]["successful"] += 1

                execution_time = payload.get("execution_time_seconds", 0)
                metrics_cache["automation"]["total_time"] += execution_time

        except Exception as e:
            logger.error(f"Failed to process analytics event: {e}", exc_info=True)

    await consumer.consume(process_message)


async def update_trends_periodically():
    """Update trend data periodically."""
    while True:
        try:
            await asyncio.sleep(300)  # Update every 5 minutes

            # Add new data point
            now = datetime.utcnow()

            # Alert volume trend
            alert_volume = metrics_cache["alerts"]["total"]
            trends_cache["alert_volume"].append(
                TrendData(timestamp=now, value=alert_volume, label=now.strftime("%H:%M"))
            )

            # Keep only last 24 hours of data
            cutoff = now - timedelta(hours=24)
            trends_cache["alert_volume"] = [
                t for t in trends_cache["alert_volume"] if t.timestamp > cutoff
            ]

            # Triage accuracy trend
            if metrics_cache["triage"]["triage_count"] > 0:
                accuracy = (
                    metrics_cache["triage"]["accurate"] / metrics_cache["triage"]["triage_count"]
                )
                trends_cache["triage_accuracy"].append(
                    TrendData(
                        timestamp=now,
                        value=accuracy * 100,  # Convert to percentage
                        label=now.strftime("%H:%M"),
                    )
                )

                trends_cache["triage_accuracy"] = [
                    t for t in trends_cache["triage_accuracy"] if t.timestamp > cutoff
                ]

            logger.debug("Trends updated successfully")

        except Exception as e:
            logger.error(f"Failed to update trends: {e}", exc_info=True)


def calculate_time_range(time_range: TimeRange) -> tuple[datetime, datetime]:
    """Calculate start and end dates for time range."""
    end_date = datetime.utcnow()

    if time_range == TimeRange.LAST_HOUR:
        start_date = end_date - timedelta(hours=1)
    elif time_range == TimeRange.LAST_24H:
        start_date = end_date - timedelta(days=1)
    elif time_range == TimeRange.LAST_7D:
        start_date = end_date - timedelta(days=7)
    elif time_range == TimeRange.LAST_30D:
        start_date = end_date - timedelta(days=30)
    else:  # CUSTOM - should be provided in query
        start_date = end_date - timedelta(days=1)

    return start_date, end_date


# API Endpoints


@app.get("/api/v1/dashboard", response_model=Dict[str, Any])
async def get_dashboard():
    """Get complete dashboard data."""
    try:
        # Calculate metrics from cache
        alert_metrics = AlertMetric(
            total_alerts=metrics_cache["alerts"]["total"],
            by_severity=metrics_cache["alerts"]["by_severity"].copy(),
            by_type=metrics_cache["alerts"]["by_type"].copy(),
            triaged=metrics_cache["alerts"]["triaged"],
            auto_closed=metrics_cache["alerts"]["triaged"]
            - metrics_cache["alerts"]["human_reviewed"],
            human_reviewed=metrics_cache["triage"]["human_triaged"],
        )

        # Calculate triage metrics
        triage_count = metrics_cache["triage"]["triage_count"]
        if triage_count > 0:
            avg_triage_time = metrics_cache["triage"]["total_triage_time"] / triage_count
            accuracy = metrics_cache["triage"]["accurate"] / triage_count
        else:
            avg_triage_time = 0.0
            accuracy = 0.0

        triage_metrics = TriageMetric(
            avg_triage_time_seconds=avg_triage_time,
            triaged_by_ai=metrics_cache["triage"]["ai_triaged"],
            triaged_by_human=metrics_cache["triage"]["human_triaged"],
            accuracy_score=accuracy,
            false_positive_rate=metrics_cache["triage"]["false_positives"] / max(triage_count, 1),
        )

        # Calculate automation metrics
        playbook_count = metrics_cache["automation"]["playbooks_executed"]
        if playbook_count > 0:
            success_rate = metrics_cache["automation"]["successful"] / playbook_count
            avg_execution_time = metrics_cache["automation"]["total_time"] / playbook_count
        else:
            success_rate = 0.0
            avg_execution_time = 0.0

        automation_metrics = AutomationMetric(
            playbooks_executed=playbook_count,
            actions_executed=metrics_cache["automation"]["actions_executed"],
            success_rate=success_rate,
            avg_execution_time_seconds=avg_execution_time,
            time_saved_hours=metrics_cache["automation"]["actions_executed"]
            * 0.5,  # Estimate: 30 min per action
        )

        # Get trends
        trends = {
            "alert_volume": trends_cache["alert_volume"][-24:],  # Last 24 data points
            "triage_accuracy": trends_cache["triage_accuracy"][-24:],
            "automation_rate": trends_cache["automation_rate"][-24:],
        }

        dashboard = DashboardData(
            alert_metrics=alert_metrics,
            triage_metrics=triage_metrics,
            automation_metrics=automation_metrics,
            trends=trends,
            top_alerts=[],  # TODO: Implement top alerts query
        )

        return {
            "success": True,
            "data": dashboard.model_dump(),
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to generate dashboard: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate dashboard: {str(e)}")


@app.get("/api/v1/metrics/alerts", response_model=Dict[str, Any])
async def get_alert_metrics(time_range: TimeRange = Query(TimeRange.LAST_24H)):
    """Get alert metrics."""
    try:
        start_date, end_date = calculate_time_range(time_range)

        # TODO: Query actual data from database
        # For now, return cached metrics
        metrics = AlertMetric(
            total_alerts=metrics_cache["alerts"]["total"],
            by_severity=metrics_cache["alerts"]["by_severity"].copy(),
            by_type=metrics_cache["alerts"]["by_type"].copy(),
            triaged=metrics_cache["alerts"]["triaged"],
            auto_closed=metrics_cache["alerts"]["triaged"]
            - metrics_cache["triage"]["human_triaged"],
            human_reviewed=metrics_cache["triage"]["human_triaged"],
        )

        return {
            "success": True,
            "data": metrics.model_dump(),
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": str(uuid.uuid4()),
                "time_range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
            },
        }

    except Exception as e:
        logger.error(f"Failed to get alert metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get alert metrics: {str(e)}")


@app.get("/api/v1/metrics/triage", response_model=Dict[str, Any])
async def get_triage_metrics(time_range: TimeRange = Query(TimeRange.LAST_24H)):
    """Get triage performance metrics."""
    try:
        start_date, end_date = calculate_time_range(time_range)

        triage_count = metrics_cache["triage"]["triage_count"]
        if triage_count > 0:
            avg_time = metrics_cache["triage"]["total_triage_time"] / triage_count
            accuracy = metrics_cache["triage"]["accurate"] / triage_count
        else:
            avg_time = 0.0
            accuracy = 0.0

        metrics = TriageMetric(
            avg_triage_time_seconds=avg_time,
            triaged_by_ai=metrics_cache["triage"]["ai_triaged"],
            triaged_by_human=metrics_cache["triage"]["human_triaged"],
            accuracy_score=accuracy,
            false_positive_rate=metrics_cache["triage"]["false_positives"] / max(triage_count, 1),
        )

        return {
            "success": True,
            "data": metrics.model_dump(),
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": str(uuid.uuid4()),
                "time_range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
            },
        }

    except Exception as e:
        logger.error(f"Failed to get triage metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get triage metrics: {str(e)}")


@app.get("/api/v1/metrics/automation", response_model=Dict[str, Any])
async def get_automation_metrics(time_range: TimeRange = Query(TimeRange.LAST_24H)):
    """Get automation metrics."""
    try:
        start_date, end_date = calculate_time_range(time_range)

        playbook_count = metrics_cache["automation"]["playbooks_executed"]
        if playbook_count > 0:
            success_rate = metrics_cache["automation"]["successful"] / playbook_count
            avg_time = metrics_cache["automation"]["total_time"] / playbook_count
        else:
            success_rate = 0.0
            avg_time = 0.0

        metrics = AutomationMetric(
            playbooks_executed=playbook_count,
            actions_executed=metrics_cache["automation"]["actions_executed"],
            success_rate=success_rate,
            avg_execution_time_seconds=avg_time,
            time_saved_hours=metrics_cache["automation"]["actions_executed"] * 0.5,
        )

        return {
            "success": True,
            "data": metrics.model_dump(),
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": str(uuid.uuid4()),
                "time_range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
            },
        }

    except Exception as e:
        logger.error(f"Failed to get automation metrics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get automation metrics: {str(e)}")


@app.get("/api/v1/trends/{metric_type}", response_model=Dict[str, Any])
async def get_trends(metric_type: str, time_range: TimeRange = Query(TimeRange.LAST_24H)):
    """Get trend data for a specific metric."""
    try:
        start_date, end_date = calculate_time_range(time_range)

        # Filter trends by time range
        trends = trends_cache.get(metric_type, [])
        filtered_trends = [t for t in trends if start_date <= t.timestamp <= end_date]

        return {
            "success": True,
            "data": {
                "metric_type": metric_type,
                "time_range": time_range.value,
                "trends": [t.model_dump() for t in filtered_trends],
            },
            "meta": {"timestamp": datetime.utcnow().isoformat(), "request_id": str(uuid.uuid4())},
        }

    except Exception as e:
        logger.error(f"Failed to get trends: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get trends: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "data-analytics",
        "timestamp": datetime.utcnow().isoformat(),
        "metrics": {
            "total_alerts": metrics_cache["alerts"]["total"],
            "trend_series": len(trends_cache),
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.host, port=config.port)
