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
Vector search and embedding models.

This module defines models for vector similarity search and embeddings.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class EmbeddingModel(str, Enum):
    """Available embedding models."""

    # Sentence transformers (local)
    MINILM_L6_V2 = "all-MiniLM-L6-v2"  # Fast, good quality
    MPNET_BASE_V2 = "all-mpnet-base-v2"  # Best quality

    # OpenAI (API)
    ADA_002 = "text-embedding-ada-002"  # OpenAI
    SMALL_3 = "text-embedding-3-small"  # Newer, faster
    LARGE_3 = "text-embedding-3-large"  # Newer, best quality


class SimilarAlert(BaseModel):
    """
    A similar alert found through vector search.

    Attributes:
        alert_id: Original alert ID
        similarity_score: Cosine similarity (0-1)
        alert_data: Full alert data
        matched_fields: Which fields matched best
        risk_level: Risk level from original triage
        triage_result: Original triage result
        created_at: When alert was created
    """

    alert_id: str = Field(..., description="Original alert ID")
    similarity_score: float = Field(
        ..., ge=0.0, le=1.0, description="Cosine similarity score (0-1, higher is better)"
    )
    alert_data: Dict[str, Any] = Field(..., description="Full alert data")
    matched_fields: List[str] = Field(
        default_factory=list, description="Fields that contributed to similarity"
    )
    risk_level: Optional[str] = Field(default=None, description="Risk level from original triage")
    triage_result: Optional[Dict[str, Any]] = Field(
        default=None, description="Original triage result"
    )
    created_at: datetime = Field(..., description="When alert was created")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "alert_id": "ALT-123",
                "similarity_score": 0.89,
                "alert_data": {
                    "alert_type": "malware",
                    "description": "Malware detected on endpoint",
                },
                "matched_fields": ["description", "source_ip"],
                "risk_level": "high",
                "triage_result": {"confidence": 85, "reasoning": "Similar to previous incidents"},
                "created_at": "2025-01-05T12:00:00Z",
            }
        }
    )


class VectorSearchRequest(BaseModel):
    """
    Request for vector similarity search.

    Attributes:
        query_text: Text to search for
        alert_data: Alert data to embed and search
        top_k: Number of results to return
        min_similarity: Minimum similarity threshold
        filters: Optional filters for search
    """

    query_text: Optional[str] = Field(default=None, description="Free-text query to search for")
    alert_data: Optional[Dict[str, Any]] = Field(
        default=None, description="Alert data to embed and search"
    )
    top_k: int = Field(default=10, ge=1, le=100, description="Number of results to return")
    min_similarity: float = Field(
        default=0.7, ge=0.0, le=1.0, description="Minimum similarity threshold"
    )
    filters: Optional[Dict[str, Any]] = Field(
        default=None, description="Optional filters (alert_type, severity, etc.)"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query_text": "Malware infection on workstation",
                "alert_data": {
                    "alert_type": "malware",
                    "description": "Suspicious executable detected",
                    "source_ip": "192.168.1.100",
                },
                "top_k": 5,
                "min_similarity": 0.75,
                "filters": {"alert_type": "malware", "severity": "high"},
            }
        }
    )


class VectorSearchResponse(BaseModel):
    """
    Response from vector similarity search.

    Attributes:
        query_embedding: The query vector used
        results: List of similar alerts
        total_results: Total number of matches
        search_time_ms: Time taken for search
    """

    query_embedding: Optional[List[float]] = Field(
        default=None, description="Query vector (optional, for debugging)"
    )
    results: List[SimilarAlert] = Field(
        ..., description="List of similar alerts, ranked by similarity"
    )
    total_results: int = Field(..., ge=0, description="Total number of matches above threshold")
    search_time_ms: float = Field(..., description="Search time in milliseconds")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query_embedding": None,
                "results": [
                    {
                        "alert_id": "ALT-123",
                        "similarity_score": 0.89,
                        "alert_data": {},
                        "matched_fields": ["description"],
                        "risk_level": "high",
                        "created_at": "2025-01-05T12:00:00Z",
                    }
                ],
                "total_results": 15,
                "search_time_ms": 45.2,
            }
        }
    )


class EmbeddingRequest(BaseModel):
    """
    Request to generate embeddings.

    Attributes:
        texts: List of texts to embed
        model: Embedding model to use
    """

    texts: List[str] = Field(..., min_length=1, max_length=100, description="Texts to embed")
    model: EmbeddingModel = Field(
        default=EmbeddingModel.MINILM_L6_V2, description="Embedding model to use"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "texts": ["Malware detected on endpoint", "Suspicious network activity"],
                "model": "all-MiniLM-L6-v2",
            }
        }
    )


class EmbeddingResponse(BaseModel):
    """
    Response containing generated embeddings.

    Attributes:
        embeddings: List of embedding vectors
        model: Model used for generation
        dimension: Dimension of embeddings
    """

    embeddings: List[List[float]] = Field(..., description="List of embedding vectors")
    model: EmbeddingModel = Field(..., description="Model used for generation")
    dimension: int = Field(..., ge=1, description="Dimension of embeddings")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "embeddings": [[0.1, 0.2, -0.3, ...], [0.4, -0.1, 0.5, ...]],
                "model": "all-MiniLM-L6-v2",
                "dimension": 384,
            }
        }
    )


class IndexStats(BaseModel):
    """
    Vector index statistics.

    Attributes:
        total_vectors: Total number of vectors in index
        dimension: Dimension of vectors
        index_type: Type of vector index (HNSW, IVF, etc.)
        last_updated: Last update timestamp
    """

    total_vectors: int = Field(..., ge=0, description="Total vectors in index")
    dimension: int = Field(..., ge=1, description="Vector dimension")
    index_type: str = Field(..., description="Index type (HNSW, IVF, etc.)")
    last_updated: datetime = Field(..., description="Last update timestamp")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "total_vectors": 15000,
                "dimension": 384,
                "index_type": "HNSW",
                "last_updated": "2025-01-05T12:00:00Z",
            }
        }
    )
