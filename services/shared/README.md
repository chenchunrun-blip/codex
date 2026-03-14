# Shared Models Package

**Version**: 1.0.0
**Description**: Common data models and utilities for all microservices

---

## 📦 Overview

This package provides shared Pydantic models, exceptions, and utilities used across all microservices in the security triage system.

## 🚀 Installation

```bash
cd services/shared
pip install -r requirements.txt
```

## 📚 Available Models

### Core Models (`models/`)

#### 1. Common Models (`models/common.py`)
- `SuccessResponse[T]` - Standard success response
- `ErrorResponse` - Standard error response
- `PaginatedResponse[T]` - Generic paginated response
- `HealthStatus` - Health check response

#### 2. Alert Models (`models/alert.py`)
- `SecurityAlert` - Standard security alert model
- `AlertType` - Enum of alert types (malware, phishing, etc.)
- `Severity` - Enum of severity levels
- `AlertStatus` - Enum of alert statuses
- `AlertBatch` - Batch of alerts
- `AlertFilter` - Query filter parameters

#### 3. Threat Intelligence Models (`models/threat_intel.py`)
- `ThreatIntel` - Threat intelligence data
- `AggregatedThreatIntel` - Aggregated intel from multiple sources
- `IOCType` - Indicator types (IP, hash, domain, etc.)
- `ThreatLevel` - Threat classification levels

#### 4. Context Models (`models/context.py`)
- `NetworkContext` - Network-related context
- `AssetContext` - Asset-related context
- `UserContext` - User-related context
- `EnrichedContext` - Complete enriched context

#### 5. Risk Models (`models/risk.py`)
- `RiskAssessment` - Risk assessment results
- `TriageResult` - Complete triage result
- `RemediationAction` - Remediation action model
- `RiskLevel` - Risk level classification

#### 6. Workflow Models (`models/workflow.py`)
- `WorkflowDefinition` - Workflow definition
- `WorkflowExecution` - Workflow execution instance
- `HumanTask` - Human task model
- `AutomationPlaybook` - Automation playbook
- `PlaybookExecution` - Playbook execution instance

### Exceptions (`errors/`)

Custom exception classes for consistent error handling:

- `SecurityTriageError` - Base exception
- `ValidationError` - Input validation errors
- `AuthenticationError` - Authentication failures
- `AuthorizationError` - Permission errors
- `NotFoundError` - Resource not found
- `DatabaseError` - Database operation errors
- `MessageQueueError` - Message queue errors
- `LLMError` - LLM operation errors

## 💻 Usage Examples

### Creating a Security Alert

```python
from shared.models import SecurityAlert, AlertType, Severity
from datetime import datetime

alert = SecurityAlert(
    alert_id="ALT-2025-001",
    timestamp=datetime.utcnow(),
    alert_type=AlertType.MALWARE,
    severity=Severity.HIGH,
    description="Malware detected on endpoint",
    source_ip="45.33.32.156",
    target_ip="10.0.0.50",
    file_hash="5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
)

# Access fields
print(alert.alert_id)  # ALT-2025-001
print(alert.severity.to_weight())  # 4

# Serialize to JSON
alert_json = alert.model_dump_json()
```

### Creating an API Response

```python
from shared.models import SuccessResponse, ResponseMeta
from shared.models.alert import SecurityAlert

# Create success response
response = SuccessResponse[SecurityAlert](
    data=alert,
    meta=ResponseMeta(
        timestamp=datetime.utcnow(),
        request_id="req-abc-123"
    )
)

# Convert to dict for FastAPI response
response_dict = response.model_dump()
```

### Handling Errors

```python
from shared.errors import ValidationError, NotFoundError

# Validation error
raise ValidationError(
    message="Invalid alert ID format",
    field="alert_id"
)

# Not found error
raise NotFoundError(
    message="Alert not found",
    resource_type="alert",
    resource_id="ALT-999"
)

# Convert to API error response
error_dict = error.to_dict()
```

### Risk Assessment

```python
from shared.models import RiskAssessment, RiskLevel, RemediationAction

risk = RiskAssessment(
    risk_score=75.5,
    risk_level=RiskLevel.HIGH,
    confidence=0.85,
    severity_score=80.0,
    threat_intel_score=70.0,
    asset_criticality_score=75.0,
    exploitability_score=75.0,
    key_factors=["High severity", "Malicious IP"],
    requires_human_review=True
)

action = RemediationAction(
    action_type="isolate_host",
    priority="immediate",
    title="Isolate host from network",
    description="Disconnect host to prevent lateral movement",
    is_automated=True
)
```

## 🧪 Testing

Run tests:

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=shared --cov-report=html

# Run specific test file
pytest tests/test_models.py -v
```

## 📏 Code Quality

```bash
# Format code
black shared/ isort shared/

# Type checking
mypy shared/

# Linting
pylint shared/
```

## 🔧 Validation Features

All models include comprehensive validation:

### IP Address Validation
```python
# Valid
SecurityAlert(source_ip="192.168.1.1")  # ✓
SecurityAlert(source_ip="45.33.32.156")  # ✓

# Invalid
SecurityAlert(source_ip="invalid-ip")  # ✗ Raises ValueError
```

### File Hash Validation
```python
# Valid (MD5, SHA1, SHA256)
SecurityAlert(file_hash="5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8")  # ✓

# Invalid
SecurityAlert(file_hash="not-a-hash")  # ✗ Raises ValueError
```

### Timestamp Validation
```python
# Valid (current or past)
SecurityAlert(timestamp=datetime.utcnow())  # ✓

# Invalid (future)
SecurityAlert(timestamp=datetime(2050, 1, 1))  # ✗ Raises ValueError
```

## 📋 Model Features

### 1. Type Hints
All models have complete type annotations for IDE support and mypy checking.

### 2. Field Validators
Custom validators for complex validation logic (IPs, hashes, timestamps).

### 3. Documentation
All fields have descriptions, and models have comprehensive docstrings.

### 4. Examples
All models include JSON schema examples for documentation.

### 5. Enum Helper Methods
Enums provide helper methods:
```python
# Convert score to severity
severity = Severity.from_score(75)  # Returns Severity.HIGH

# Convert severity to weight
weight = severity.to_weight()  # Returns 4
```

## 🔄 Version Compatibility

- Python: 3.11+
- Pydantic: 2.5+

## 📝 Contributing

When adding new models:

1. Follow the existing structure and style
2. Include complete type hints
3. Add field validators for custom logic
4. Include JSON schema examples
5. Write unit tests
6. Update `__init__.py` exports

## 📄 License

Apache License 2.0 - See project root LICENSE file for details.
