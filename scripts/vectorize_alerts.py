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
Vectorize historical alerts for similarity search.

This script loads historical alerts from the database and creates
vector embeddings for similarity search using ChromaDB.
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime
from typing import List

# Add services directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_database_manager
from shared.models import SecurityAlert
from shared.utils import get_logger


logger = get_logger(__name__)


class AlertVectorizer:
    """Vectorize historical alerts for similarity search."""

    def __init__(
        self,
        embedding_model: str = "all-MiniLM-L6-v2",
        chroma_path: str = "./data/chroma",
        collection_name: str = "security_alerts",
    ):
        """
        Initialize the vectorizer.

        Args:
            embedding_model: Name of the sentence transformer model
            chroma_path: Path to ChromaDB storage
            collection_name: Name of the ChromaDB collection
        """
        self.embedding_model_name = embedding_model
        self.chroma_path = chroma_path
        self.collection_name = collection_name

        # Initialize components
        self.model = None
        self.chroma_client = None
        self.collection = None
        self.db_manager = None

    def initialize(self):
        """Initialize model and database connections."""
        logger.info("Initializing Alert Vectorizer...")

        # Load embedding model
        logger.info(f"Loading embedding model: {self.embedding_model_name}")
        self.model = SentenceTransformer(self.embedding_model_name)
        logger.info(f"Model loaded. Dimension: {self.model.get_sentence_embedding_dimension()}")

        # Initialize ChromaDB
        logger.info(f"Connecting to ChromaDB at: {self.chroma_path}")
        self.chroma_client = chromadb.PersistentClient(
            path=self.chroma_path,
            settings=Settings(anonymized_telemetry=False),
        )

        # Get or create collection
        try:
            self.collection = self.chroma_client.get_collection(name=self.collection_name)
            logger.info(f"Loaded existing collection: {self.collection_name}")
            logger.info(f"Current count: {self.collection.count()}")
        except Exception:
            self.collection = self.chroma_client.create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
            logger.info(f"Created new collection: {self.collection_name}")

        logger.info("Alert Vectorizer initialized successfully")

    def alert_to_text(self, alert: SecurityAlert) -> str:
        """
        Convert alert to text for embedding.

        Args:
            alert: SecurityAlert object

        Returns:
            Text representation of the alert
        """
        parts = [
            f"Alert Type: {alert.alert_type}",
            f"Severity: {alert.severity}",
            f"Description: {alert.description or 'No description'}",
        ]

        if alert.source_ip:
            parts.append(f"Source IP: {alert.source_ip}")

        if alert.target_ip or alert.destination_ip:
            parts.append(f"Target IP: {alert.target_ip or alert.destination_ip}")

        if alert.file_hash:
            parts.append(f"File Hash: {alert.file_hash}")

        if alert.url:
            parts.append(f"URL: {alert.url}")

        if alert.process_name:
            parts.append(f"Process: {alert.process_name}")

        if alert.user_id:
            parts.append(f"User: {alert.user_id}")

        if alert.asset_id:
            parts.append(f"Asset: {alert.asset_id}")

        return ". ".join(parts)

    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for text.

        Args:
            text: Input text

        Returns:
            Embedding vector
        """
        embedding = self.model.encode(text, convert_to_numpy=True)
        return embedding.tolist()

    def index_alert(self, alert: SecurityAlert, triage_result: dict = None) -> bool:
        """
        Index a single alert in ChromaDB.

        Args:
            alert: SecurityAlert to index
            triage_result: Optional triage result

        Returns:
            True if successful
        """
        try:
            # Convert alert to text
            text = self.alert_to_text(alert)

            # Generate embedding
            embedding = self.generate_embedding(text)

            # Prepare metadata
            metadata = {
                "alert_id": alert.alert_id,
                "alert_type": alert.alert_type.value,
                "severity": alert.severity.value,
                "description": alert.description or "",
                "created_at": alert.timestamp.isoformat() if alert.timestamp else datetime.utcnow().isoformat(),
                "alert_data": alert.model_dump(),
            }

            if triage_result:
                metadata["risk_level"] = triage_result.get("risk_level")
                metadata["triage_result"] = triage_result

            # Check if already exists
            try:
                self.collection.get(ids=[alert.alert_id])
                # Update existing
                self.collection.update(
                    ids=[alert.alert_id],
                    embeddings=[embedding],
                    metadatas=[metadata],
                )
                logger.debug(f"Updated existing alert: {alert.alert_id}")
            except Exception:
                # Add new
                self.collection.add(
                    embeddings=[embedding],
                    ids=[alert.alert_id],
                    metadatas=[metadata],
                )
                logger.debug(f"Indexed new alert: {alert.alert_id}")

            return True

        except Exception as e:
            logger.error(f"Failed to index alert {alert.alert_id}: {e}")
            return False

    async def vectorize_historical_alerts(
        self,
        limit: int = None,
        batch_size: int = 100,
        alert_type: str = None,
    ):
        """
        Vectorize historical alerts from database.

        Args:
            limit: Maximum number of alerts to process
            batch_size: Batch size for processing
            alert_type: Filter by alert type (optional)
        """
        logger.info("Starting historical alert vectorization...")

        # Initialize database
        self.db_manager = get_database_manager()
        await self.db_manager.initialize()

        indexed_count = 0
        failed_count = 0
        skip_count = 0

        try:
            async with self.db_manager.get_session() as session:
                # Build query
                query = select(SecurityAlert).order_by(SecurityAlert.timestamp.desc())

                if alert_type:
                    query = query.where(SecurityAlert.alert_type == alert_type)

                if limit:
                    query = query.limit(limit)

                # Execute query
                result = await session.execute(query)
                alerts = result.scalars().all()

                total = len(alerts)
                logger.info(f"Found {total} alerts to process")

                # Process alerts in batches
                for i, alert in enumerate(alerts, 1):
                    try:
                        # Check if already indexed
                        try:
                            self.collection.get(ids=[alert.alert_id])
                            skip_count += 1
                            logger.debug(f"Skipping already indexed alert: {alert.alert_id}")
                            continue
                        except Exception:
                            pass  # Not indexed, proceed

                        # Index the alert
                        if self.index_alert(alert):
                            indexed_count += 1
                        else:
                            failed_count += 1

                        # Progress update
                        if i % batch_size == 0 or i == total:
                            logger.info(
                                f"Progress: {i}/{total} | "
                                f"Indexed: {indexed_count} | "
                                f"Skipped: {skip_count} | "
                                f"Failed: {failed_count}"
                            )

                    except Exception as e:
                        logger.error(f"Error processing alert {alert.alert_id}: {e}")
                        failed_count += 1

        finally:
            await self.db_manager.close()

        # Final summary
        logger.info("=" * 60)
        logger.info("Vectorization Complete!")
        logger.info(f"Total alerts processed: {total}")
        logger.info(f"Successfully indexed: {indexed_count}")
        logger.info(f"Skipped (already indexed): {skip_count}")
        logger.info(f"Failed: {failed_count}")
        logger.info(f"Total vectors in collection: {self.collection.count()}")
        logger.info("=" * 60)

    async def reindex_all(self):
        """Reindex all alerts (clear existing and rebuild)."""
        logger.warning("Reindexing all alerts - this will clear existing index!")

        # Confirm
        # response = input("Are you sure? (yes/no): ")
        # if response.lower() != "yes":
        #     logger.info("Reindex cancelled")
        #     return

        # Delete and recreate collection
        try:
            self.chroma_client.delete_collection(name=self.collection_name)
            logger.info(f"Deleted collection: {self.collection_name}")
        except Exception:
            pass

        self.collection = self.chroma_client.create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(f"Created new collection: {self.collection_name}")

        # Vectorize all alerts
        await self.vectorize_historical_alerts()


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Vectorize historical alerts for similarity search"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Maximum number of alerts to process (default: all)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Batch size for progress updates (default: 100)",
    )
    parser.add_argument(
        "--alert-type",
        type=str,
        help="Filter by alert type (e.g., malware, phishing)",
    )
    parser.add_argument(
        "--reindex",
        action="store_true",
        help="Reindex all alerts (clears existing index)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="all-MiniLM-L6-v2",
        help="Embedding model to use (default: all-MiniLM-L6-v2)",
    )
    parser.add_argument(
        "--chroma-path",
        type=str,
        default="./data/chroma",
        help="Path to ChromaDB storage (default: ./data/chroma)",
    )

    args = parser.parse_args()

    # Initialize vectorizer
    vectorizer = AlertVectorizer(
        embedding_model=args.model,
        chroma_path=args.chroma_path,
    )
    vectorizer.initialize()

    # Run vectorization
    if args.reindex:
        await vectorizer.reindex_all()
    else:
        await vectorizer.vectorize_historical_alerts(
            limit=args.limit,
            batch_size=args.batch_size,
            alert_type=args.alert_type,
        )

    logger.info("Done!")


if __name__ == "__main__":
    asyncio.run(main())
