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
Response models for API Gateway.

Pydantic models for structuring API responses.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# =============================================================================
# Base Response Models
# =============================================================================

class ApiResponse(BaseModel):
    """
    Base API response model.

    Attributes:
        success: Whether the request was successful
        message: Optional message
        data: Response data
        meta: Optional metadata
    """

    success: bool = Field(..., description="Request success status")
    message: Optional[str] = Field(None, description="Response message")
    data: Optional[Any] = Field(None, description="Response data")
    meta: Optional[Dict[str, Any]] = Field(None, description="Response metadata")

    class Config:
        """Pydantic config."""

        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


class PaginatedResponse(ApiResponse):
    """
    Paginated response model.

    Attributes:
        data: List of items
        meta: Pagination metadata
    """

    data: List[Any] = Field(default_factory=list, description="List of items")
    meta: Optional[Dict[str, Any]] = Field(None, description="Pagination metadata")

    @classmethod
    def create(
        cls,
        items: List[Any],
        total: int,
        skip: int,
        limit: int,
        success: bool = True,
        message: Optional[str] = None,
    ) -> "PaginatedResponse":
        """
        Create paginated response.

        Args:
            items: List of items
            total: Total number of items
            skip: Number of items skipped
            limit: Page size
            success: Success status
            message: Optional message

        Returns:
            PaginatedResponse instance
        """
        return cls(
            success=success,
            message=message,
            data=items,
            meta={
                "total": total,
                "skip": skip,
                "limit": limit,
                "has_more": skip + limit < total,
            },
        )


# =============================================================================
# Alert Response Models
# =============================================================================

class AlertResponse(BaseModel):
    """
    Alert response model.

    Attributes:
        alert_id: Alert ID
        timestamp: Alert timestamp
        alert_type: Type of alert
        severity: Severity level
        status: Alert status
        title: Alert title
        description: Alert description
        source_ip: Source IP address
        destination_ip: Destination IP address
        file_hash: File hash
        url: URL
        asset_id: Asset ID
        user_id: User ID
        risk_score: Risk score (0-100)
        confidence: Confidence score
        assigned_to: Assigned user UUID
        source: Alert source
        tags: Alert tags
        created_at: Creation timestamp
        updated_at: Last update timestamp
    """

    alert_id: str
    timestamp: datetime
    alert_type: str
    severity: str
    status: str
    title: str
    description: str

    source_ip: Optional[str] = None
    destination_ip: Optional[str] = None
    file_hash: Optional[str] = None
    url: Optional[str] = None
    asset_id: Optional[str] = None
    user_id: Optional[str] = None

    risk_score: Optional[float] = None
    confidence: Optional[float] = None
    assigned_to: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[List[str]] = None

    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


class AlertDetailResponse(AlertResponse):
    """
    Detailed alert response model.

    Includes triage result and context information.
    """

    triage_result: Optional[Dict[str, Any]] = None
    threat_intel: Optional[Dict[str, Any]] = None
    network_context: Optional[Dict[str, Any]] = None
    asset_context: Optional[Dict[str, Any]] = None
    user_context: Optional[Dict[str, Any]] = None


class AlertStatsResponse(BaseModel):
    """
    Alert statistics response model.

    Attributes:
        total_alerts: Total number of alerts
        by_severity: Count by severity
        by_status: Count by status
        by_type: Count by type
        avg_risk_score: Average risk score
        high_priority_count: High priority alert count
        pending_review_count: Pending human review count
    """

    total_alerts: int
    by_severity: Dict[str, int]
    by_status: Dict[str, int]
    by_type: Dict[str, int]
    avg_risk_score: Optional[float] = None
    high_priority_count: int
    pending_review_count: int


# =============================================================================
# Triage Response Models
# =============================================================================

class TriageResultResponse(BaseModel):
    """
    Triage result response model.

    Attributes:
        id: Triage result ID
        alert_id: Associated alert ID
        risk_score: Risk score (0-100)
        risk_level: Risk level
        confidence: Confidence score
        analysis: AI analysis text
        key_findings: Key findings
        iocs_identified: IOCs identified
        threat_intel_summary: Threat intel summary
        requires_human_review: Whether human review is required
        reviewed_by: Reviewer user UUID
        reviewed_at: Review timestamp
        reviewer_comments: Reviewer comments
        model_used: AI model used
        processing_time_ms: Processing time in milliseconds
        created_at: Creation timestamp
    """

    id: str
    alert_id: str
    risk_score: float
    risk_level: str
    confidence: float
    analysis: str
    key_findings: List[str]
    iocs_identified: Dict[str, List[str]]

    threat_intel_summary: Optional[str] = None
    requires_human_review: bool = False
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    reviewer_comments: Optional[str] = None
    model_used: str = "deepseek"
    processing_time_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""

        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


# =============================================================================
# Analytics Response Models
# =============================================================================

class AnalyticsMetricResponse(BaseModel):
    """
    Analytics metric response model.

    Attributes:
        metric_type: Type of metric
        value: Metric value
        trend: Trend data (if available)
        timestamp: Metric timestamp
    """

    metric_type: str
    value: Any
    trend: Optional[List[Dict[str, Any]]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DashboardStatsResponse(BaseModel):
    """
    Dashboard statistics response model.

    Attributes:
        total_alerts: Total alerts
        critical_alerts: Critical alert count
        high_risk_alerts: High risk alert count
        pending_triage: Pending triage count
        avg_response_time: Average response time
        alerts_today: Alerts in last 24 hours
        threats_blocked: Threats blocked count
        system_health: System health status
        trends: Trend data
    """

    total_alerts: int
    critical_alerts: int
    high_risk_alerts: int
    pending_triage: int
    avg_response_time: Optional[float] = None
    alerts_today: int
    threats_blocked: int
    system_health: str
    trends: Optional[Dict[str, List[Dict[str, Any]]]] = None


class TrendDataPoint(BaseModel):
    """
    Trend data point model.

    Attributes:
        timestamp: Data point timestamp
        value: Data point value
        label: Optional label
    """

    timestamp: datetime
    value: float
    label: Optional[str] = None


class TrendResponse(BaseModel):
    """
    Trend response model.

    Attributes:
        metric: Metric name
        time_range: Time range
        data_points: List of data points
        summary: Trend summary (increasing, decreasing, stable)
    """

    metric: str
    time_range: str
    data_points: List[TrendDataPoint]
    summary: str


# =============================================================================
# Authentication Response Models
# =============================================================================

class LoginResponse(BaseModel):
    """
    Login response model.

    Attributes:
        access_token: JWT access token
        refresh_token: JWT refresh token
        token_type: Token type (Bearer)
        expires_in: Expiration time in seconds
        user: User information
    """

    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: Dict[str, Any]


class UserResponse(BaseModel):
    """
    User response model.

    Attributes:
        id: User UUID
        username: Username
        email: Email address
        full_name: Full name
        role: User role
        is_active: Whether user is active
        last_login: Last login timestamp
        created_at: Creation timestamp
    """

    id: str
    username: str
    email: str
    full_name: Optional[str] = None
    role: str
    is_active: bool
    last_login: Optional[datetime] = None
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


# =============================================================================
# Error Response Models
# =============================================================================

class ErrorResponse(BaseModel):
    """
    Error response model.

    Attributes:
        success: Always false for errors
        error: Error code
        message: Error message
        detail: Optional error details
        path: Request path
        timestamp: Error timestamp
    """

    success: bool = False
    error: str
    message: str
    detail: Optional[Any] = None
    path: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ValidationErrorResponse(ErrorResponse):
    """
    Validation error response model.

    Attributes:
        errors: List of validation errors
    """

    errors: List[Dict[str, Any]] = Field(default_factory=list)


# =============================================================================
# Health Response Models
# =============================================================================

class HealthResponse(BaseModel):
    """
    Health check response model.

    Attributes:
        status: Health status (healthy, degraded, unhealthy)
        components: Component health status
        timestamp: Check timestamp
    """

    status: str
    components: Dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# =============================================================================
# Bulk Action Response Models
# =============================================================================

class BulkActionResponse(BaseModel):
    """
    Bulk action response model.

    Attributes:
        action: Action performed
        total: Total items
        success_count: Number of successful actions
        failure_count: Number of failed actions
        errors: List of errors
    """

    action: str
    total: int
    success_count: int
    failure_count: int
    errors: List[Dict[str, Any]] = Field(default_factory=list)
