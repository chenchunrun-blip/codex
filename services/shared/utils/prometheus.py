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
Shared Prometheus metrics utilities for FastAPI services.

Provides standard HTTP metrics, service-specific security alert metrics,
and a middleware class that automatically tracks request count and latency.
"""

import time
from typing import Callable

from fastapi import FastAPI, Request, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

# ---------------------------------------------------------------------------
# Standard HTTP metrics
# ---------------------------------------------------------------------------

request_count = Counter(
    "request_count",
    "Total number of HTTP requests",
    ["method", "endpoint", "status"],
)

request_latency_seconds = Histogram(
    "request_latency_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
)

active_connections = Gauge(
    "active_connections",
    "Number of currently active connections",
)

# ---------------------------------------------------------------------------
# Service-specific security alert metrics
# ---------------------------------------------------------------------------

alert_processed_total = Counter(
    "alert_processed_total",
    "Total number of alerts processed",
    ["severity", "alert_type"],
)

triage_duration_seconds = Histogram(
    "triage_duration_seconds",
    "Duration of alert triage processing in seconds",
)

notification_sent_total = Counter(
    "notification_sent_total",
    "Total number of notifications sent",
    ["channel", "status"],
)


# ---------------------------------------------------------------------------
# Prometheus middleware
# ---------------------------------------------------------------------------


class PrometheusMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware that auto-tracks request count and latency."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        method = request.method
        endpoint = request.url.path

        active_connections.inc()
        start_time = time.monotonic()

        try:
            response = await call_next(request)
            status = str(response.status_code)
        except Exception:
            status = "500"
            raise
        finally:
            elapsed = time.monotonic() - start_time
            request_count.labels(method=method, endpoint=endpoint, status=status).inc()
            request_latency_seconds.labels(method=method, endpoint=endpoint).observe(elapsed)
            active_connections.dec()

        return response


# ---------------------------------------------------------------------------
# Setup helper
# ---------------------------------------------------------------------------


def setup_prometheus(app: FastAPI, service_name: str) -> None:
    """
    Add Prometheus metrics integration to a FastAPI application.

    Registers the ``PrometheusMiddleware`` for automatic HTTP metric
    collection and exposes a ``/metrics`` endpoint in Prometheus
    exposition format.

    Args:
        app: The FastAPI application instance.
        service_name: Logical service name (used for logging context).
    """

    app.add_middleware(PrometheusMiddleware)

    @app.get("/metrics/prometheus", tags=["Metrics"], include_in_schema=False)
    async def prometheus_metrics() -> Response:
        """Expose Prometheus metrics."""
        return Response(
            content=generate_latest(),
            media_type=CONTENT_TYPE_LATEST,
        )
