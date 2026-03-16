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
Elasticsearch full-text search manager for security alerts.

Provides async indexing and search capabilities with graceful degradation
when Elasticsearch is unavailable.
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from shared.utils.logger import get_logger

logger = get_logger(__name__)

try:
    from elasticsearch import AsyncElasticsearch, NotFoundError

    _ES_AVAILABLE = True
except ImportError:
    _ES_AVAILABLE = False
    AsyncElasticsearch = None  # type: ignore[assignment, misc]
    NotFoundError = None  # type: ignore[assignment, misc]
    logger.warning(
        "elasticsearch[async] package not installed. "
        "ElasticsearchManager will return empty results. "
        "Install with: pip install elasticsearch[async]"
    )

# Index name for security alerts
INDEX_NAME = "security_alerts"

# Mapping definition for the security_alerts index
INDEX_MAPPING = {
    "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 1,
        "analysis": {
            "analyzer": {
                "alert_analyzer": {
                    "type": "standard",
                    "stopwords": "_english_",
                }
            }
        },
    },
    "mappings": {
        "properties": {
            "title": {
                "type": "text",
                "analyzer": "alert_analyzer",
            },
            "description": {
                "type": "text",
                "analyzer": "alert_analyzer",
            },
            "alert_type": {
                "type": "keyword",
            },
            "severity": {
                "type": "keyword",
            },
            "status": {
                "type": "keyword",
            },
            "source_ip": {
                "type": "keyword",
            },
            "destination_ip": {
                "type": "keyword",
            },
            "source_port": {
                "type": "integer",
            },
            "destination_port": {
                "type": "integer",
            },
            "protocol": {
                "type": "keyword",
            },
            "hostname": {
                "type": "keyword",
            },
            "username": {
                "type": "keyword",
            },
            "rule_name": {
                "type": "keyword",
            },
            "mitre_tactic": {
                "type": "keyword",
            },
            "mitre_technique": {
                "type": "keyword",
            },
            "risk_score": {
                "type": "float",
            },
            "raw_log": {
                "type": "text",
                "index": False,
            },
            "tags": {
                "type": "keyword",
            },
            "created_at": {
                "type": "date",
            },
            "updated_at": {
                "type": "date",
            },
            "ingested_at": {
                "type": "date",
            },
        }
    },
}


class ElasticsearchManager:
    """
    Async Elasticsearch manager for indexing and searching security alerts.

    Handles connection lifecycle, index management, and provides full-text
    search with optional structured filters. Degrades gracefully when
    Elasticsearch is not available or not reachable.

    Usage::

        es = ElasticsearchManager()
        await es.connect()

        await es.index_alert("alert-001", {
            "title": "Malware detected",
            "description": "Trojan found on endpoint",
            "severity": "high",
            "alert_type": "malware",
            "status": "open",
            "source_ip": "10.0.0.5",
            "created_at": "2026-03-15T10:00:00Z",
        })

        results = await es.search_alerts("malware trojan", filters={"severity": "high"})

        await es.close()
    """

    def __init__(self, elasticsearch_url: Optional[str] = None):
        """
        Initialize ElasticsearchManager.

        Args:
            elasticsearch_url: Elasticsearch URL. Falls back to
                ``ELASTICSEARCH_URL`` env var, then ``http://elasticsearch:9200``.
        """
        self.url = elasticsearch_url or os.environ.get(
            "ELASTICSEARCH_URL", "http://elasticsearch:9200"
        )
        self.client: Optional[Any] = None
        self._available = _ES_AVAILABLE

    async def connect(self) -> None:
        """
        Initialize the async Elasticsearch client and ensure the index exists.

        If the ``elasticsearch[async]`` package is not installed or the cluster
        is unreachable, the manager logs a warning and continues in degraded
        mode (all queries return empty results).
        """
        if not self._available:
            logger.warning("Elasticsearch client library not available; running in degraded mode")
            return

        try:
            self.client = AsyncElasticsearch(
                hosts=[self.url],
                request_timeout=10,
                retry_on_timeout=True,
                max_retries=3,
            )
            # Verify connectivity
            info = await self.client.info()
            logger.info(
                "Connected to Elasticsearch",
                extra={
                    "cluster_name": info["cluster_name"],
                    "version": info["version"]["number"],
                },
            )
            await self._ensure_index()
        except Exception as e:
            logger.warning(
                f"Failed to connect to Elasticsearch at {self.url}: {e}. "
                "Running in degraded mode."
            )
            self.client = None

    async def close(self) -> None:
        """Close the Elasticsearch connection."""
        if self.client:
            await self.client.close()
            logger.info("Elasticsearch connection closed")
            self.client = None

    async def index_alert(self, alert_id: str, data: dict) -> bool:
        """
        Index a security alert document.

        Args:
            alert_id: Unique alert identifier (used as the document ``_id``).
            data: Alert data to index. Should conform to the index mapping
                (title, description, severity, alert_type, status, etc.).

        Returns:
            True if the document was indexed successfully, False otherwise.
        """
        if not self.client:
            logger.warning("Elasticsearch not available; skipping index_alert")
            return False

        try:
            # Add ingestion timestamp if not present
            if "ingested_at" not in data:
                data["ingested_at"] = datetime.utcnow().isoformat() + "Z"

            await self.client.index(
                index=INDEX_NAME,
                id=alert_id,
                document=data,
                refresh="wait_for",
            )
            logger.debug(f"Indexed alert {alert_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to index alert {alert_id}: {e}")
            return False

    async def search_alerts(
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        size: int = 20,
        from_: int = 0,
    ) -> dict:
        """
        Full-text search across security alerts with optional filters.

        Args:
            query: Free-text search query matched against title and description.
            filters: Optional structured filters. Supported keys:
                - ``severity`` (str): Filter by severity level.
                - ``status`` (str): Filter by alert status.
                - ``alert_type`` (str): Filter by alert type.
                - ``date_from`` (str): ISO date string, lower bound for ``created_at``.
                - ``date_to`` (str): ISO date string, upper bound for ``created_at``.
            size: Maximum number of results to return (default 20).
            from_: Result offset for pagination (default 0).

        Returns:
            Dict with ``total`` (int), ``hits`` (list of dicts with ``id``,
            ``score``, and ``source``), and ``took_ms`` (int).
        """
        empty_result: Dict[str, Any] = {"total": 0, "hits": [], "took_ms": 0}

        if not self.client:
            logger.warning("Elasticsearch not available; returning empty results")
            return empty_result

        try:
            must_clauses: List[dict] = []
            filter_clauses: List[dict] = []

            # Full-text query across title and description
            if query and query.strip():
                must_clauses.append(
                    {
                        "multi_match": {
                            "query": query,
                            "fields": ["title^2", "description"],
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                        }
                    }
                )
            else:
                must_clauses.append({"match_all": {}})

            # Apply structured filters
            if filters:
                for field in ("severity", "status", "alert_type"):
                    value = filters.get(field)
                    if value:
                        filter_clauses.append({"term": {field: value}})

                date_range: Dict[str, str] = {}
                if filters.get("date_from"):
                    date_range["gte"] = filters["date_from"]
                if filters.get("date_to"):
                    date_range["lte"] = filters["date_to"]
                if date_range:
                    filter_clauses.append({"range": {"created_at": date_range}})

            es_query: Dict[str, Any] = {
                "bool": {
                    "must": must_clauses,
                }
            }
            if filter_clauses:
                es_query["bool"]["filter"] = filter_clauses

            response = await self.client.search(
                index=INDEX_NAME,
                query=es_query,
                size=size,
                from_=from_,
                sort=[{"_score": "desc"}, {"created_at": "desc"}],
            )

            hits = []
            for hit in response["hits"]["hits"]:
                hits.append(
                    {
                        "id": hit["_id"],
                        "score": hit["_score"],
                        "source": hit["_source"],
                    }
                )

            total_value = response["hits"]["total"]
            total = total_value["value"] if isinstance(total_value, dict) else total_value

            return {
                "total": total,
                "hits": hits,
                "took_ms": response.get("took", 0),
            }
        except Exception as e:
            logger.error(f"Elasticsearch search failed: {e}")
            return empty_result

    async def delete_alert(self, alert_id: str) -> bool:
        """
        Delete an alert document from the index.

        Args:
            alert_id: Alert identifier to delete.

        Returns:
            True if deleted successfully, False otherwise.
        """
        if not self.client:
            logger.warning("Elasticsearch not available; skipping delete_alert")
            return False

        try:
            await self.client.delete(
                index=INDEX_NAME,
                id=alert_id,
                refresh="wait_for",
            )
            logger.debug(f"Deleted alert {alert_id} from index")
            return True
        except Exception as e:
            if NotFoundError and isinstance(e, NotFoundError):
                logger.warning(f"Alert {alert_id} not found in index")
                return False
            logger.error(f"Failed to delete alert {alert_id}: {e}")
            return False

    async def health_check(self) -> dict:
        """
        Check Elasticsearch cluster health.

        Returns:
            Dict with ``available`` (bool) and cluster health details when
            available. Returns ``{"available": False}`` on failure.
        """
        if not self.client:
            return {"available": False, "reason": "client not connected"}

        try:
            health = await self.client.cluster.health()
            return {
                "available": True,
                "cluster_name": health.get("cluster_name"),
                "status": health.get("status"),
                "number_of_nodes": health.get("number_of_nodes"),
                "active_shards": health.get("active_shards"),
            }
        except Exception as e:
            logger.error(f"Elasticsearch health check failed: {e}")
            return {"available": False, "reason": str(e)}

    async def _ensure_index(self) -> None:
        """Create the security_alerts index if it does not exist."""
        if not self.client:
            return

        try:
            exists = await self.client.indices.exists(index=INDEX_NAME)
            if not exists:
                await self.client.indices.create(
                    index=INDEX_NAME,
                    body=INDEX_MAPPING,
                )
                logger.info(f"Created Elasticsearch index: {INDEX_NAME}")
            else:
                logger.debug(f"Elasticsearch index already exists: {INDEX_NAME}")
        except Exception as e:
            logger.error(f"Failed to ensure index {INDEX_NAME}: {e}")
