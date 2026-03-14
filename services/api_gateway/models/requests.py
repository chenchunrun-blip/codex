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
Request models for API Gateway.

Pydantic models for validating incoming API requests.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


# =============================================================================
# Base Request Models
# =============================================================================

class BaseRequest(BaseModel):
    """Base model for all requests."""

    class Config:
        """Pydantic config."""

        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


# =============================================================================
# Alert Request Models
# =============================================================================

class AlertFilterRequest(BaseRequest):
    """
    Request model for alert filtering.

    Attributes:
        alert_id: Filter by specific alert ID
        alert_type: Filter by alert type
        severity: Filter by severity level
        status: Filter by alert status
        source_ip: Filter by source IP address
        target_ip: Filter by destination IP address
        asset_id: Filter by asset ID
        user_id: Filter by user ID
        source: Filter by alert source
        start_date: Filter by start date (ISO format)
        end_date: Filter by end date (ISO format)
        search: Text search in title and description
        skip: Number of records to skip (pagination)
        limit: Max number of records to return
        sort_by: Field to sort by
        sort_order: Sort order (asc or desc)
    """

    alert_id: Optional[str] = Field(None, description="Filter by alert ID")
    alert_type: Optional[str] = Field(None, description="Filter by alert type")
    severity: Optional[str] = Field(None, description="Filter by severity")
    status: Optional[str] = Field(None, description="Filter by status")
    source_ip: Optional[str] = Field(None, description="Filter by source IP")
    target_ip: Optional[str] = Field(None, description="Filter by destination IP")
    asset_id: Optional[str] = Field(None, description="Filter by asset ID")
    user_id: Optional[str] = Field(None, description="Filter by user ID")
    source: Optional[str] = Field(None, description="Filter by source")
    start_date: Optional[str] = Field(None, description="Start date (ISO format)")
    end_date: Optional[str] = Field(None, description="End date (ISO format)")
    search: Optional[str] = Field(None, description="Text search")

    skip: int = Field(0, ge=0, description="Number of records to skip")
    limit: int = Field(100, ge=1, le=1000, description="Max records to return")
    sort_by: str = Field("timestamp", description="Field to sort by")
    sort_order: str = Field("desc", pattern="^(asc|desc)$", description="Sort order")

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def parse_dates(cls, v: Optional[str]) -> Optional[datetime]:
        """Parse date strings to datetime objects."""
        if v is None:
            return None
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"Invalid datetime format: {v}")


class AlertStatusUpdateRequest(BaseRequest):
    """
    Request model for updating alert status.

    Attributes:
        status: New status
        assigned_to: User UUID to assign alert to
        comment: Optional comment for the update
    """

    status: str = Field(..., description="New status")
    assigned_to: Optional[str] = Field(None, description="User UUID to assign to")
    comment: Optional[str] = Field(None, description="Update comment")


class AlertBulkActionRequest(BaseRequest):
    """
    Request model for bulk alert actions.

    Attributes:
        alert_ids: List of alert IDs to perform action on
        action: Action to perform (assign, close, resolve, etc.)
        params: Optional parameters for the action
    """

    alert_ids: List[str] = Field(..., min_length=1, description="Alert IDs")
    action: str = Field(..., description="Action to perform")
    params: Optional[dict] = Field(None, description="Action parameters")


class AlertCreateRequest(BaseRequest):
    """
    Request model for creating a new alert.

    Attributes:
        alert_type: Type of alert
        severity: Severity level
        title: Alert title
        description: Alert description
        source_ip: Source IP address
        destination_ip: Destination IP address
        file_hash: File hash (if applicable)
        url: URL (if applicable)
        asset_id: Asset ID
        user_id: User ID
        source: Alert source
        raw_data: Raw alert data
    """

    alert_type: str = Field(..., description="Alert type")
    severity: str = Field(..., description="Severity level")
    title: str = Field(..., min_length=1, max_length=500, description="Alert title")
    description: str = Field(..., min_length=1, description="Alert description")

    source_ip: Optional[str] = Field(None, description="Source IP address")
    destination_ip: Optional[str] = Field(None, description="Destination IP address")
    file_hash: Optional[str] = Field(None, description="File hash")
    url: Optional[str] = Field(None, description="URL")
    asset_id: Optional[str] = Field(None, description="Asset ID")
    user_id: Optional[str] = Field(None, description="User ID")
    source: Optional[str] = Field(None, description="Alert source")
    raw_data: Optional[dict] = Field(None, description="Raw alert data")


# =============================================================================
# Analytics Request Models
# =============================================================================

class AnalyticsQueryRequest(BaseRequest):
    """
    Request model for analytics queries.

    Attributes:
        metric_type: Type of metric to retrieve
        start_date: Start date for query
        end_date: End date for query
        group_by: Field to group by
        filters: Additional filters
    """

    metric_type: str = Field(..., description="Metric type")
    start_date: Optional[str] = Field(None, description="Start date (ISO format)")
    end_date: Optional[str] = Field(None, description="End date (ISO format)")
    group_by: Optional[str] = Field(None, description="Group by field")
    filters: Optional[dict] = Field(None, description="Additional filters")

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def parse_dates(cls, v: Optional[str]) -> Optional[datetime]:
        """Parse date strings to datetime objects."""
        if v is None:
            return None
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"Invalid datetime format: {v}")


class DashboardStatsRequest(BaseRequest):
    """
    Request model for dashboard statistics.

    Attributes:
        time_range: Time range for stats (1h, 24h, 7d, 30d)
        include_trends: Whether to include trend data
    """

    time_range: str = Field("24h", pattern="^(1h|24h|7d|30d)$", description="Time range")
    include_trends: bool = Field(True, description="Include trends")


# =============================================================================
# Triage Request Models
# =============================================================================

class TriageReviewRequest(BaseRequest):
    """
    Request model for submitting triage review.

    Attributes:
        alert_id: Alert ID being reviewed
        reviewer_comments: Reviewer's comments
        action: Action taken (approve, reject, escalate)
        new_risk_score: Optional new risk score
        new_risk_level: Optional new risk level
    """

    alert_id: str = Field(..., description="Alert ID")
    reviewer_comments: Optional[str] = Field(None, description="Review comments")
    action: str = Field(..., description="Action taken")
    new_risk_score: Optional[float] = Field(None, ge=0, le=100, description="New risk score")
    new_risk_level: Optional[str] = Field(None, description="New risk level")


# =============================================================================
# Authentication Request Models
# =============================================================================

class LoginRequest(BaseRequest):
    """
    Request model for user login.

    Attributes:
        username: Username or email
        password: User password
    """

    username: str = Field(..., min_length=1, description="Username or email")
    password: str = Field(..., min_length=1, description="Password")


class TokenRefreshRequest(BaseRequest):
    """
    Request model for token refresh.

    Attributes:
        refresh_token: Refresh token
    """

    refresh_token: str = Field(..., description="Refresh token")


# =============================================================================
# User Request Models
# =============================================================================

class UserCreateRequest(BaseRequest):
    """
    Request model for creating a new user.

    Attributes:
        username: Username (unique)
        email: Email address (unique)
        full_name: Full name
        password: Password
        role: User role
    """

    username: str = Field(..., min_length=3, max_length=100, description="Username")
    email: str = Field(..., pattern=r"^[^@]+@[^@]+\.[^@]+$", description="Email address")
    full_name: str = Field(..., min_length=1, max_length=255, description="Full name")
    password: str = Field(..., min_length=8, description="Password (min 8 chars)")
    role: str = Field("analyst", description="User role")


class UserUpdateRequest(BaseRequest):
    """
    Request model for updating a user.

    Attributes:
        full_name: Full name
        email: Email address
        role: User role
        is_active: Whether user is active
    """

    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[str] = Field(None, pattern=r"^[^@]+@[^@]+\.[^@]+$")
    role: Optional[str] = None
    is_active: Optional[bool] = None
