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
Settings repository for system configuration and user preferences.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.models import SystemConfig, UserPreference


class SettingsRepository:
    """Repository for system configuration and user preference management."""

    def __init__(self, session: AsyncSession):
        """
        Initialize repository.

        Args:
            session: Database session
        """
        self.session = session

    async def get_all_configs(self) -> Dict[str, Dict[str, Any]]:
        """
        Get all system configurations.

        Returns:
            Dictionary of config_key -> {"value": config_value, "category": category}
        """
        result = await self.session.execute(select(SystemConfig))
        configs = result.scalars().all()
        return {
            config.config_key: {
                "value": config.config_value,
                "category": config.category
            }
            for config in configs
        }

    async def get_config(self, config_key: str) -> Optional[SystemConfig]:
        """
        Get a single system configuration by key.

        Args:
            config_key: Configuration key

        Returns:
            SystemConfig object or None
        """
        result = await self.session.execute(
            select(SystemConfig).where(SystemConfig.config_key == config_key)
        )
        return result.scalar_one_or_none()

    async def create_config(
        self,
        config_key: str,
        config_value: Dict[str, Any],
        description: Optional[str] = None,
        category: Optional[str] = None,
        is_sensitive: bool = False,
        updated_by: str = "system",
    ) -> SystemConfig:
        """
        Create a new system configuration.

        Args:
            config_key: Configuration key
            config_value: Configuration value (must be JSON-serializable)
            description: Optional description
            category: Optional category
            is_sensitive: Whether this is sensitive data
            updated_by: User who created this config

        Returns:
            Created SystemConfig object
        """
        config = SystemConfig(
            config_key=config_key,
            config_value=config_value,
            description=description,
            category=category,
            is_sensitive=is_sensitive,
            updated_by=updated_by,
        )
        self.session.add(config)
        await self.session.flush()
        return config

    async def update_config(
        self,
        config_key: str,
        config_value: Dict[str, Any],
        updated_by: str = "system",
    ) -> Optional[SystemConfig]:
        """
        Update an existing system configuration.

        Args:
            config_key: Configuration key
            config_value: New configuration value
            updated_by: User who updated this config

        Returns:
            Updated SystemConfig object or None
        """
        config = await self.get_config(config_key)
        if config:
            config.config_value = config_value
            config.updated_by = updated_by
            await self.session.flush()
        return config

    async def get_user_preferences(self, user_id: str) -> Dict[str, Any]:
        """
        Get all preferences for a user.

        Args:
            user_id: User ID

        Returns:
            Dictionary of preference_key -> preference_value
        """
        result = await self.session.execute(
            select(UserPreference).where(UserPreference.user_id == user_id)
        )
        preferences = result.scalars().all()
        return {pref.preference_key: pref.preference_value for pref in preferences}

    async def get_user_preference(
        self, user_id: str, preference_key: str
    ) -> Optional[UserPreference]:
        """
        Get a single user preference.

        Args:
            user_id: User ID
            preference_key: Preference key

        Returns:
            UserPreference object or None
        """
        result = await self.session.execute(
            select(UserPreference).where(
                UserPreference.user_id == user_id,
                UserPreference.preference_key == preference_key,
            )
        )
        return result.scalar_one_or_none()

    async def update_user_preferences(
        self, user_id: str, preferences: Dict[str, Any]
    ) -> None:
        """
        Update multiple user preferences (deep merge).

        Args:
            user_id: User ID
            preferences: Dictionary of preferences to update
        """
        for key, value in preferences.items():
            pref = await self.get_user_preference(user_id, key)
            if pref:
                # Deep merge the value
                if isinstance(pref.preference_value, dict) and isinstance(value, dict):
                    pref.preference_value = {**pref.preference_value, **value}
                else:
                    pref.preference_value = value
            else:
                # Create new preference
                pref = UserPreference(
                    user_id=user_id,
                    preference_key=key,
                    preference_value=value,
                )
                self.session.add(pref)
        await self.session.flush()

    async def set_user_preference(
        self, user_id: str, preference_key: str, preference_value: Any
    ) -> UserPreference:
        """
        Set a single user preference (create or update).

        Args:
            user_id: User ID
            preference_key: Preference key
            preference_value: Preference value

        Returns:
            Created or updated UserPreference object
        """
        pref = await self.get_user_preference(user_id, preference_key)
        if pref:
            pref.preference_value = preference_value
        else:
            pref = UserPreference(
                user_id=user_id,
                preference_key=preference_key,
                preference_value=preference_value,
            )
            self.session.add(pref)
        await self.session.flush()
        return pref
