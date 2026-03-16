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
Shared database layer for all microservices.

This package provides database connectivity, session management,
and repository base classes used across all services.
"""

from .base import DatabaseManager, close_database, get_database_manager, init_database
from .models import (
    Alert,
    AlertContext,
    Asset,
    AuditLog,
    Incident,
    IncidentAlert,
    RemediationAction,
    ThreatIntel,
    TriageResult,
    User,
)

__version__ = "1.0.0"

__all__ = [
    # Database management
    "DatabaseManager",
    "get_database_manager",
    "init_database",
    "close_database",
    # Models
    "User",
    "Asset",
    "Alert",
    "AlertContext",
    "TriageResult",
    "ThreatIntel",
    "Incident",
    "IncidentAlert",
    "RemediationAction",
    "AuditLog",
]
