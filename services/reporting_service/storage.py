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
MinIO object storage client for report file persistence.

Handles uploading, downloading, and deleting report files in MinIO.
Falls back to local filesystem when MinIO is unavailable.
"""

import io
import os
from datetime import timedelta
from typing import Optional

from shared.utils import get_logger

logger = get_logger(__name__)

# Default configuration
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "reports")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH", "/tmp/reports")

# Content type mapping
CONTENT_TYPES = {
    "html": "text/html",
    "csv": "text/csv",
    "json": "application/json",
    "pdf": "application/pdf",
}


class ReportStorage:
    """
    Report file storage abstraction.

    Uses MinIO for distributed object storage when available,
    falls back to local filesystem.
    """

    def __init__(self):
        """Initialize storage client."""
        self._minio_client = None
        self._use_minio = False
        self._local_path = LOCAL_STORAGE_PATH

    async def initialize(self) -> None:
        """
        Initialize storage backend.

        Attempts to connect to MinIO. Falls back to local storage
        if MinIO is unavailable.
        """
        try:
            from minio import Minio

            self._minio_client = Minio(
                MINIO_ENDPOINT,
                access_key=MINIO_ACCESS_KEY,
                secret_key=MINIO_SECRET_KEY,
                secure=MINIO_SECURE,
            )

            # Ensure bucket exists
            if not self._minio_client.bucket_exists(MINIO_BUCKET):
                self._minio_client.make_bucket(MINIO_BUCKET)
                logger.info(f"Created MinIO bucket: {MINIO_BUCKET}")

            self._use_minio = True
            logger.info(
                "MinIO storage initialized",
                extra={"endpoint": MINIO_ENDPOINT, "bucket": MINIO_BUCKET},
            )

        except ImportError:
            logger.warning("minio package not installed, using local filesystem storage")
            self._use_minio = False
        except Exception as e:
            logger.warning(f"MinIO unavailable ({e}), using local filesystem storage")
            self._use_minio = False

        if not self._use_minio:
            os.makedirs(self._local_path, exist_ok=True)
            logger.info(f"Using local filesystem storage at {self._local_path}")

    def upload_report(
        self,
        report_id: str,
        content: bytes,
        file_format: str,
    ) -> str:
        """
        Upload report content to storage.

        Args:
            report_id: Report identifier
            content: File content as bytes
            file_format: File format (html, csv, json, pdf)

        Returns:
            Storage path/key for the uploaded file

        Raises:
            RuntimeError: If upload fails
        """
        object_name = f"{report_id}.{file_format}"
        content_type = CONTENT_TYPES.get(file_format, "application/octet-stream")

        if self._use_minio and self._minio_client:
            try:
                data = io.BytesIO(content)
                self._minio_client.put_object(
                    MINIO_BUCKET,
                    object_name,
                    data,
                    length=len(content),
                    content_type=content_type,
                )
                path = f"minio://{MINIO_BUCKET}/{object_name}"
                logger.info(
                    "Report uploaded to MinIO",
                    extra={"report_id": report_id, "path": path, "size": len(content)},
                )
                return path
            except Exception as e:
                logger.error(f"MinIO upload failed, falling back to local: {e}")

        # Local filesystem fallback
        file_path = os.path.join(self._local_path, object_name)
        with open(file_path, "wb") as f:
            f.write(content)

        logger.info(
            "Report saved to local filesystem",
            extra={"report_id": report_id, "path": file_path, "size": len(content)},
        )
        return file_path

    def download_report(self, file_path: str) -> Optional[bytes]:
        """
        Download report content from storage.

        Args:
            file_path: Storage path returned by upload_report

        Returns:
            File content as bytes, or None if not found
        """
        if file_path.startswith("minio://") and self._use_minio and self._minio_client:
            # Parse minio://bucket/object_name
            parts = file_path[len("minio://"):].split("/", 1)
            if len(parts) != 2:
                logger.error(f"Invalid MinIO path: {file_path}")
                return None

            bucket, object_name = parts
            try:
                response = self._minio_client.get_object(bucket, object_name)
                data = response.read()
                response.close()
                response.release_conn()
                return data
            except Exception as e:
                logger.error(f"MinIO download failed: {e}")
                return None
        else:
            # Local filesystem
            local_path = file_path
            if file_path.startswith("minio://"):
                # MinIO unavailable, try local fallback
                parts = file_path[len("minio://"):].split("/", 1)
                object_name = parts[1] if len(parts) == 2 else parts[0]
                local_path = os.path.join(self._local_path, object_name)

            if not os.path.exists(local_path):
                logger.warning(f"Report file not found: {local_path}")
                return None

            with open(local_path, "rb") as f:
                return f.read()

    def delete_report(self, file_path: str) -> bool:
        """
        Delete report file from storage.

        Args:
            file_path: Storage path returned by upload_report

        Returns:
            True if deleted, False otherwise
        """
        if file_path.startswith("minio://") and self._use_minio and self._minio_client:
            parts = file_path[len("minio://"):].split("/", 1)
            if len(parts) != 2:
                return False
            bucket, object_name = parts
            try:
                self._minio_client.remove_object(bucket, object_name)
                logger.info(f"Deleted report from MinIO: {file_path}")
                return True
            except Exception as e:
                logger.error(f"MinIO delete failed: {e}")
                return False
        else:
            local_path = file_path
            if file_path.startswith("minio://"):
                parts = file_path[len("minio://"):].split("/", 1)
                object_name = parts[1] if len(parts) == 2 else parts[0]
                local_path = os.path.join(self._local_path, object_name)

            try:
                if os.path.exists(local_path):
                    os.remove(local_path)
                    logger.info(f"Deleted report from local: {local_path}")
                    return True
                return False
            except Exception as e:
                logger.error(f"Local delete failed: {e}")
                return False

    def get_presigned_url(self, file_path: str, expires: int = 3600) -> Optional[str]:
        """
        Generate a presigned download URL for a report (MinIO only).

        Args:
            file_path: Storage path
            expires: URL expiry in seconds (default 1 hour)

        Returns:
            Presigned URL or None if not using MinIO
        """
        if not (file_path.startswith("minio://") and self._use_minio and self._minio_client):
            return None

        parts = file_path[len("minio://"):].split("/", 1)
        if len(parts) != 2:
            return None

        bucket, object_name = parts
        try:
            url = self._minio_client.presigned_get_object(
                bucket, object_name, expires=timedelta(seconds=expires)
            )
            return url
        except Exception as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            return None

    @property
    def is_minio_available(self) -> bool:
        """Check if MinIO storage is active."""
        return self._use_minio
