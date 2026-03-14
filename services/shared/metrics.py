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
Shared Prometheus Metrics

Provides lightweight counters/gauges that can be scraped from the
existing /metrics endpoint or embedded into /health responses.
No external dependency (prometheus_client) required — uses plain
counters that the monitoring_metrics service can collect via HTTP.

Each service increments counters in this module; the values are
exposed as JSON via the health endpoint and converted to Prometheus
format by the monitoring_metrics collector.
"""

import time
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict


class MetricsCollector:
    """Thread-safe metrics collector for a single service."""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self._counters: Dict[str, int] = defaultdict(int)
        self._gauges: Dict[str, float] = {}
        self._histograms: Dict[str, list] = defaultdict(list)
        self._start_time = time.monotonic()

    # ---- Counters --------------------------------------------------------

    def inc(self, name: str, value: int = 1) -> None:
        """Increment a counter."""
        self._counters[name] += value

    def counter(self, name: str) -> int:
        return self._counters.get(name, 0)

    # ---- Gauges ----------------------------------------------------------

    def set_gauge(self, name: str, value: float) -> None:
        self._gauges[name] = value

    def gauge(self, name: str) -> float:
        return self._gauges.get(name, 0.0)

    # ---- Histograms (simple) ---------------------------------------------

    def observe(self, name: str, value: float) -> None:
        """Record a histogram observation (keeps last 1000 values)."""
        bucket = self._histograms[name]
        bucket.append(value)
        if len(bucket) > 1000:
            self._histograms[name] = bucket[-500:]

    def histogram_avg(self, name: str) -> float:
        bucket = self._histograms.get(name, [])
        return sum(bucket) / len(bucket) if bucket else 0.0

    # ---- Export ----------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """Export all metrics as a JSON-friendly dict."""
        result = {
            "service": self.service_name,
            "uptime_seconds": round(time.monotonic() - self._start_time, 1),
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
        }

        # Add histogram summaries
        histograms = {}
        for name, bucket in self._histograms.items():
            if bucket:
                histograms[name] = {
                    "count": len(bucket),
                    "avg": round(sum(bucket) / len(bucket), 3),
                    "min": round(min(bucket), 3),
                    "max": round(max(bucket), 3),
                }
        if histograms:
            result["histograms"] = histograms

        result["collected_at"] = datetime.utcnow().isoformat()
        return result

    def to_prometheus(self) -> str:
        """Export metrics in Prometheus text exposition format."""
        lines = []
        prefix = self.service_name.replace("-", "_")

        for name, value in self._counters.items():
            metric_name = f"{prefix}_{name}_total"
            lines.append(f"# TYPE {metric_name} counter")
            lines.append(f'{metric_name} {value}')

        for name, value in self._gauges.items():
            metric_name = f"{prefix}_{name}"
            lines.append(f"# TYPE {metric_name} gauge")
            lines.append(f'{metric_name} {value}')

        for name, bucket in self._histograms.items():
            if bucket:
                metric_name = f"{prefix}_{name}"
                avg = sum(bucket) / len(bucket)
                lines.append(f"# TYPE {metric_name}_avg gauge")
                lines.append(f'{metric_name}_avg {avg:.3f}')
                lines.append(f"# TYPE {metric_name}_count counter")
                lines.append(f'{metric_name}_count {len(bucket)}')

        return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Pre-defined metric names (constants for consistency)
# ---------------------------------------------------------------------------

# Alert Ingestor
ALERTS_INGESTED = "alerts_ingested"
ALERTS_DEDUPLICATED = "alerts_deduplicated"
DEDUP_CHECKS = "dedup_checks"

# Similarity Search
SEARCHES_PERFORMED = "searches_performed"
ALERTS_INDEXED = "alerts_indexed"
CLUSTERS_CREATED = "clusters_created"
ALERTS_CLUSTERED = "alerts_clustered"

# Workflow Engine
WORKFLOWS_STARTED = "workflows_started"
WORKFLOWS_COMPLETED = "workflows_completed"
ATTACK_CHAINS_DETECTED = "attack_chains_detected"
CORRELATIONS_PERFORMED = "correlations_performed"
INCIDENT_RESPONSES_TRIGGERED = "incident_responses_triggered"

# AI Triage Agent
TRIAGE_REQUESTS = "triage_requests"
TRIAGE_FAILURES = "triage_failures"
LLM_CALLS = "llm_calls"
LLM_LATENCY_MS = "llm_latency_ms"
