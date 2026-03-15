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

"""User repository for user and authentication management."""

from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.models import User


class UserRepository:
    """Repository for user management operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, user_id: str) -> Optional[User]:
        """Get user by primary key UUID (as string)."""
        result = await self.session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> Optional[User]:
        """Get user by username."""
        result = await self.session.execute(
            select(User).where(User.username == username)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> Optional[User]:
        """Get user by email."""
        result = await self.session.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def get_by_username_or_email(self, identifier: str) -> Optional[User]:
        """Get user by username or email."""
        result = await self.session.execute(
            select(User).where(
                (User.username == identifier) | (User.email == identifier)
            )
        )
        return result.scalar_one_or_none()

    async def list_users(
        self,
        role: Optional[str] = None,
        is_active: Optional[bool] = None,
        department: Optional[str] = None,
        search: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[List[User], int]:
        """
        List users with filters and pagination.

        Returns:
            Tuple of (users, total_count)
        """
        query = select(User)
        count_query = select(func.count()).select_from(User)

        if role:
            query = query.where(User.role == role)
            count_query = count_query.where(User.role == role)
        if is_active is not None:
            query = query.where(User.is_active == is_active)
            count_query = count_query.where(User.is_active == is_active)
        if department:
            query = query.where(User.department == department)
            count_query = count_query.where(User.department == department)
        if search:
            pattern = f"%{search}%"
            search_filter = (
                User.username.ilike(pattern)
                | User.email.ilike(pattern)
                | User.full_name.ilike(pattern)
            )
            query = query.where(search_filter)
            count_query = count_query.where(search_filter)

        total_result = await self.session.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(User.created_at.desc()).offset(offset).limit(limit)
        result = await self.session.execute(query)
        users = list(result.scalars().all())

        return users, total

    async def create_user(
        self,
        username: str,
        email: str,
        password_hash: str,
        role: str = "viewer",
        full_name: Optional[str] = None,
        phone: Optional[str] = None,
        department: Optional[str] = None,
    ) -> User:
        """Create a new user."""
        user = User(
            username=username,
            email=email,
            password_hash=password_hash,
            role=role,
            full_name=full_name,
            phone=phone,
            department=department,
            is_active=True,
            is_verified=False,
        )
        self.session.add(user)
        await self.session.flush()
        return user

    async def update_user(self, user_id: str, **updates) -> Optional[User]:
        """Update user fields."""
        user = await self.get_by_id(user_id)
        if user:
            for key, value in updates.items():
                if hasattr(user, key) and value is not None:
                    setattr(user, key, value)
            await self.session.flush()
        return user

    async def delete_user(self, user_id: str) -> bool:
        """Delete a user (hard delete)."""
        user = await self.get_by_id(user_id)
        if user:
            await self.session.delete(user)
            await self.session.flush()
            return True
        return False

    async def deactivate_user(self, user_id: str) -> Optional[User]:
        """Soft-deactivate a user."""
        return await self.update_user(user_id, is_active=False)

    async def activate_user(self, user_id: str) -> Optional[User]:
        """Reactivate a user."""
        return await self.update_user(user_id, is_active=True)

    async def update_last_login(self, user_id: str) -> Optional[User]:
        """Update user's last login timestamp."""
        from datetime import datetime
        return await self.update_user(user_id, last_login_at=datetime.utcnow())

    async def change_password(self, user_id: str, new_password_hash: str) -> bool:
        """Change user's password hash."""
        user = await self.update_user(user_id, password_hash=new_password_hash)
        return user is not None

    async def change_role(self, user_id: str, new_role: str) -> Optional[User]:
        """Change user's role."""
        return await self.update_user(user_id, role=new_role)

    async def count_by_role(self) -> Dict[str, int]:
        """Count users grouped by role."""
        result = await self.session.execute(
            select(User.role, func.count()).group_by(User.role)
        )
        return {row[0]: row[1] for row in result.all()}
