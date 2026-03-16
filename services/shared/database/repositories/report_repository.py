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
Report repository for database operations.

This module provides all database operations for generated reports,
including CRUD operations, filtering, and scheduled report management.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from shared.database.models import Report
from shared.database.repositories.base import BaseRepository
from shared.utils.logger import get_logger
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = get_logger(__name__)


class ReportRepository(BaseRepository[Report]):
    """
    Repository for Report model operations.

    Provides specialized methods for report queries,
    status management, and scheduled report lookup.
    """

    def __init__(self, session: AsyncSession):
        """
        Initialize report repository.

        Args:
            session: Database session
        """
        super().__init__(Report, session)

    async def create_report(self, report_data: Dict[str, Any]) -> Report:
        """
        Create a new report record.

        Args:
            report_data: Report data dictionary

        Returns:
            Created report instance
        """
        report = Report(**report_data)
        self.session.add(report)
        await self.session.flush()
        await self.session.refresh(report)

        logger.info(
            "Report created",
            extra={
                "report_id": report.report_id,
                "report_type": report.report_type,
            },
        )
        return report

    async def get_by_report_id(self, report_id: str) -> Optional[Report]:
        """
        Get report by report_id string.

        Args:
            report_id: Report identifier

        Returns:
            Report instance or None
        """
        result = await self.session.execute(select(Report).where(Report.report_id == report_id))
        return result.scalar_one_or_none()

    async def update_status(
        self,
        report_id: str,
        status: str,
        error_message: Optional[str] = None,
        file_path: Optional[str] = None,
        file_size: Optional[int] = None,
    ) -> Optional[Report]:
        """
        Update report status and optional file info.

        Args:
            report_id: Report identifier
            status: New status
            error_message: Optional error message if failed
            file_path: Optional path to generated file
            file_size: Optional file size in bytes

        Returns:
            Updated report or None
        """
        report = await self.get_by_report_id(report_id)
        if not report:
            return None

        values: Dict[str, Any] = {"status": status}
        if error_message is not None:
            values["error_message"] = error_message
        if file_path is not None:
            values["file_path"] = file_path
        if file_size is not None:
            values["file_size"] = file_size
        if status == "completed":
            values["completed_at"] = datetime.utcnow()

        await self.session.execute(
            update(Report).where(Report.report_id == report_id).values(**values)
        )
        await self.session.flush()
        await self.session.refresh(report)

        logger.info(
            "Report status updated",
            extra={"report_id": report_id, "status": status},
        )
        return report

    async def list_reports(
        self,
        status: Optional[str] = None,
        report_type: Optional[str] = None,
        created_by: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Report], int]:
        """
        List reports with filters and pagination.

        Args:
            status: Filter by status
            report_type: Filter by report type
            created_by: Filter by creator
            offset: Pagination offset
            limit: Max results

        Returns:
            Tuple of (reports list, total count)
        """
        query = select(Report)
        count_query = select(func.count(Report.report_id))

        conditions = []
        if status:
            conditions.append(Report.status == status)
        if report_type:
            conditions.append(Report.report_type == report_type)
        if created_by:
            conditions.append(Report.created_by == created_by)

        if conditions:
            query = query.where(and_(*conditions))
            count_query = count_query.where(and_(*conditions))

        count_result = await self.session.execute(count_query)
        total = count_result.scalar() or 0

        query = query.order_by(Report.created_at.desc()).offset(offset).limit(limit)
        result = await self.session.execute(query)
        reports = list(result.scalars().all())

        return reports, total

    async def get_scheduled_reports(self, frequency: Optional[str] = None) -> List[Report]:
        """
        Get reports that have a schedule configured.

        Args:
            frequency: Optional filter by frequency (daily, weekly, monthly)

        Returns:
            List of scheduled reports
        """
        query = select(Report).where(Report.schedule_frequency.isnot(None))
        if frequency:
            query = query.where(Report.schedule_frequency == frequency)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def delete_report(self, report_id: str) -> bool:
        """
        Delete a report by report_id.

        Args:
            report_id: Report identifier

        Returns:
            True if deleted, False if not found
        """
        report = await self.get_by_report_id(report_id)
        if not report:
            return False

        await self.session.delete(report)
        await self.session.flush()

        logger.info("Report deleted", extra={"report_id": report_id})
        return True

    async def count_by_status(self) -> Dict[str, int]:
        """
        Get report counts grouped by status.

        Returns:
            Dictionary mapping status to count
        """
        result = await self.session.execute(
            select(Report.status, func.count(Report.report_id)).group_by(Report.status)
        )
        return {status: count for status, count in result.all()}

    async def count_by_type(self) -> Dict[str, int]:
        """
        Get report counts grouped by report type.

        Returns:
            Dictionary mapping report_type to count
        """
        result = await self.session.execute(
            select(Report.report_type, func.count(Report.report_id)).group_by(Report.report_type)
        )
        return {rtype: count for rtype, count in result.all()}
