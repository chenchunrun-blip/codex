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
Base repository class with common CRUD operations.

Provides a generic repository pattern for database operations.
"""

from typing import Any, Generic, List, Optional, Type, TypeVar

from pydantic import BaseModel
from shared.utils.logger import get_logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = get_logger(__name__)

# Type variables
ModelType = TypeVar("ModelType", bound=Any)
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


class BaseRepository(Generic[ModelType]):
    """
    Base repository with CRUD operations.

    Provides generic create, read, update, delete operations for any model.

    Attributes:
        model: SQLAlchemy model class
        session: Database session
    """

    def __init__(self, model: Type[ModelType], session: AsyncSession):
        """
        Initialize repository.

        Args:
            model: SQLAlchemy model class
            session: Database session
        """
        self.model = model
        self.session = session

    async def create(self, obj_in: CreateSchemaType) -> ModelType:
        """
        Create a new record.

        Args:
            obj_in: Pydantic schema with creation data

        Returns:
            Created model instance
        """
        obj_dict = obj_in.model_dump() if isinstance(obj_in, BaseModel) else obj_in
        db_obj = self.model(**obj_dict)

        self.session.add(db_obj)
        await self.session.flush()
        await self.session.refresh(db_obj)

        logger.info(
            f"Created {self.model.__name__}",
            extra={"id": getattr(db_obj, "id", "N/A")},
        )

        return db_obj

    async def get(self, id: Any) -> Optional[ModelType]:
        """
        Get record by ID.

        Args:
            id: Record identifier

        Returns:
            Model instance or None
        """
        result = await self.session.execute(
            select(self.model).where(getattr(self.model, "id") == id)
        )
        return result.scalar_one_or_none()

    async def get_multi(
        self,
        skip: int = 0,
        limit: int = 100,
        filters: Optional[dict[str, Any]] = None,
    ) -> List[ModelType]:
        """
        Get multiple records with pagination.

        Args:
            skip: Number of records to skip
            limit: Max number of records to return
            filters: Optional filter criteria

        Returns:
            List of model instances
        """
        query = select(self.model)

        # Apply filters
        if filters:
            for key, value in filters.items():
                if hasattr(self.model, key):
                    query = query.where(getattr(self.model, key) == value)

        query = query.offset(skip).limit(limit)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(
        self,
        id: Any,
        obj_in: UpdateSchemaType,
    ) -> Optional[ModelType]:
        """
        Update a record.

        Args:
            id: Record identifier
            obj_in: Pydantic schema with update data

        Returns:
            Updated model instance or None
        """
        db_obj = await self.get(id)
        if not db_obj:
            return None

        update_data = (
            obj_in.model_dump(exclude_unset=True) if isinstance(obj_in, BaseModel) else obj_in
        )

        await self.session.execute(
            update(self.model).where(getattr(self.model, "id") == id).values(**update_data)
        )

        await self.session.flush()
        await self.session.refresh(db_obj)

        logger.info(
            f"Updated {self.model.__name__}",
            extra={"id": id},
        )

        return db_obj

    async def delete(self, id: Any) -> bool:
        """
        Delete a record.

        Args:
            id: Record identifier

        Returns:
            True if deleted, False if not found
        """
        db_obj = await self.get(id)
        if not db_obj:
            return False

        await self.session.execute(delete(self.model).where(getattr(self.model, "id") == id))

        await self.session.flush()

        logger.info(
            f"Deleted {self.model.__name__}",
            extra={"id": id},
        )

        return True

    async def count(self, filters: Optional[dict[str, Any]] = None) -> int:
        """
        Count records.

        Args:
            filters: Optional filter criteria

        Returns:
            Number of records
        """
        query = select(func.count(getattr(self.model, "id")))

        # Apply filters
        if filters:
            for key, value in filters.items():
                if hasattr(self.model, key):
                    query = query.where(getattr(self.model, key) == value)

        result = await self.session.execute(query)
        return result.scalar()

    async def exists(self, id: Any) -> bool:
        """
        Check if record exists.

        Args:
            id: Record identifier

        Returns:
            True if exists, False otherwise
        """
        result = await self.session.execute(
            select(func.count(getattr(self.model, "id"))).where(getattr(self.model, "id") == id)
        )
        return result.scalar() > 0

    async def bulk_create(self, objects: List[CreateSchemaType]) -> List[ModelType]:
        """
        Bulk create records.

        Args:
            objects: List of Pydantic schemas

        Returns:
            List of created model instances
        """
        db_objects = []
        for obj_in in objects:
            obj_dict = obj_in.model_dump() if isinstance(obj_in, BaseModel) else obj_in
            db_obj = self.model(**obj_dict)
            db_objects.append(db_obj)

        self.session.add_all(db_objects)
        await self.session.flush()

        for db_obj in db_objects:
            await self.session.refresh(db_obj)

        logger.info(
            f"Bulk created {len(db_objects)} {self.model.__name__} records",
        )

        return db_objects
