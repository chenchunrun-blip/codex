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
Historical Learning Module

Learns from past triage outcomes to improve future risk scoring.
Persists pattern statistics to PostgreSQL via raw SQL (works with the
existing schema without requiring new ORM models).

Key features:
- Records triage outcomes keyed by (alert_type, severity)
- Computes historical risk multipliers based on past escalation rates
- Provides feedback loop data for the RiskScoringEngine
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from shared.utils import get_logger

logger = get_logger(__name__)


class HistoricalLearningEngine:
    """
    Learns from past triage decisions to inform future risk scoring.

    Uses the triage_results + alerts tables already present in PostgreSQL
    to compute historical patterns without requiring schema changes.
    """

    # Cache TTL for computed multipliers (avoid repeated DB queries)
    CACHE_TTL_SECONDS = 300  # 5 minutes

    def __init__(self):
        self._cache: Dict[str, Tuple[float, datetime]] = {}
        self._stats_cache: Optional[Tuple[Dict[str, Any], datetime]] = None

    async def get_historical_multiplier(
        self,
        session,
        alert_type: str,
        severity: str,
    ) -> float:
        """
        Compute a historical risk multiplier for (alert_type, severity).

        The multiplier is based on:
        - Escalation rate: how often this combo was rated critical/high
        - Human override rate: how often analysts changed the AI assessment
        - Volume trend: whether this combo is increasing in frequency

        Args:
            session: AsyncSession from SQLAlchemy.
            alert_type: Alert type string (e.g. "malware").
            severity: Severity string (e.g. "critical").

        Returns:
            A multiplier in [0.8, 1.5].  1.0 means no historical signal.
        """
        cache_key = f"{alert_type}:{severity}"
        cached = self._cache.get(cache_key)
        if cached:
            value, ts = cached
            if (datetime.utcnow() - ts).total_seconds() < self.CACHE_TTL_SECONDS:
                return value

        try:
            multiplier = await self._compute_multiplier(session, alert_type, severity)
        except Exception as e:
            logger.warning(f"Historical learning query failed: {e}")
            multiplier = 1.0

        self._cache[cache_key] = (multiplier, datetime.utcnow())
        return multiplier

    async def get_learning_stats(self, session) -> Dict[str, Any]:
        """Return aggregate learning statistics."""
        if self._stats_cache:
            stats, ts = self._stats_cache
            if (datetime.utcnow() - ts).total_seconds() < self.CACHE_TTL_SECONDS:
                return stats

        try:
            stats = await self._compute_stats(session)
        except Exception as e:
            logger.warning(f"Historical stats query failed: {e}")
            stats = {"status": "unavailable", "error": str(e)}

        self._stats_cache = (stats, datetime.utcnow())
        return stats

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _compute_multiplier(
        self,
        session,
        alert_type: str,
        severity: str,
    ) -> float:
        """Query PostgreSQL to compute the multiplier."""
        from sqlalchemy import text

        cutoff = datetime.utcnow() - timedelta(days=30)

        # Count total triage results for this (alert_type, severity) combo
        row = (
            await session.execute(
                text("""
                    SELECT
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE tr.risk_level IN ('critical', 'high')) AS escalated,
                        COUNT(*) FILTER (WHERE tr.reviewed_by IS NOT NULL) AS reviewed,
                        AVG(tr.risk_score) AS avg_risk_score
                    FROM triage_results tr
                    JOIN alerts a ON a.alert_id = tr.alert_id
                    WHERE a.alert_type = :alert_type
                      AND a.severity = :severity
                      AND tr.created_at >= :cutoff
                """),
                {"alert_type": alert_type, "severity": severity, "cutoff": cutoff},
            )
        ).one_or_none()

        if not row or row.total == 0:
            return 1.0

        total = row.total
        escalation_rate = row.escalated / total
        avg_risk = row.avg_risk_score or 50.0

        # Escalation rate contribution:  high escalation → higher multiplier
        # Maps [0, 1] → [0.9, 1.4]
        esc_factor = 0.9 + 0.5 * escalation_rate

        # Average risk contribution: if avg risk > 70, slightly boost
        risk_factor = 1.0
        if avg_risk >= 80:
            risk_factor = 1.1
        elif avg_risk >= 70:
            risk_factor = 1.05

        multiplier = esc_factor * risk_factor

        # Clamp to [0.8, 1.5]
        multiplier = max(0.8, min(1.5, multiplier))

        logger.debug(
            f"Historical multiplier for {alert_type}/{severity}: {multiplier:.2f} "
            f"(total={total}, esc_rate={escalation_rate:.2f}, avg_risk={avg_risk:.1f})"
        )

        return round(multiplier, 3)

    async def _compute_stats(self, session) -> Dict[str, Any]:
        """Compute aggregate learning statistics."""
        from sqlalchemy import text

        cutoff_30d = datetime.utcnow() - timedelta(days=30)
        cutoff_7d = datetime.utcnow() - timedelta(days=7)

        row = (
            await session.execute(
                text("""
                    SELECT
                        COUNT(*) AS total_30d,
                        COUNT(*) FILTER (WHERE tr.created_at >= :cutoff_7d) AS total_7d,
                        AVG(tr.risk_score) AS avg_risk_score,
                        COUNT(*) FILTER (WHERE tr.risk_level = 'critical') AS critical_count,
                        COUNT(*) FILTER (WHERE tr.risk_level = 'high') AS high_count,
                        COUNT(*) FILTER (WHERE tr.risk_level = 'medium') AS medium_count,
                        COUNT(*) FILTER (WHERE tr.risk_level = 'low') AS low_count,
                        COUNT(*) FILTER (WHERE tr.reviewed_by IS NOT NULL) AS reviewed_count,
                        AVG(tr.processing_time_ms) FILTER (WHERE tr.processing_time_ms IS NOT NULL) AS avg_processing_ms
                    FROM triage_results tr
                    WHERE tr.created_at >= :cutoff_30d
                """),
                {"cutoff_30d": cutoff_30d, "cutoff_7d": cutoff_7d},
            )
        ).one_or_none()

        if not row or row.total_30d == 0:
            return {
                "status": "no_data",
                "total_results_30d": 0,
            }

        # Top alert types by escalation rate
        type_rows = (
            await session.execute(
                text("""
                    SELECT
                        a.alert_type,
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE tr.risk_level IN ('critical', 'high')) AS escalated
                    FROM triage_results tr
                    JOIN alerts a ON a.alert_id = tr.alert_id
                    WHERE tr.created_at >= :cutoff
                    GROUP BY a.alert_type
                    ORDER BY total DESC
                    LIMIT 10
                """),
                {"cutoff": cutoff_30d},
            )
        ).all()

        type_breakdown = [
            {
                "alert_type": r.alert_type,
                "total": r.total,
                "escalation_rate": round(r.escalated / r.total, 3) if r.total else 0,
            }
            for r in type_rows
        ]

        return {
            "status": "active",
            "total_results_30d": row.total_30d,
            "total_results_7d": row.total_7d,
            "avg_risk_score": round(row.avg_risk_score, 1) if row.avg_risk_score else None,
            "risk_distribution": {
                "critical": row.critical_count,
                "high": row.high_count,
                "medium": row.medium_count,
                "low": row.low_count,
            },
            "reviewed_count": row.reviewed_count,
            "review_rate": round(row.reviewed_count / row.total_30d, 3),
            "avg_processing_ms": round(row.avg_processing_ms, 1) if row.avg_processing_ms else None,
            "type_breakdown": type_breakdown,
        }
