# Testing Guide

**Last Updated**: 2026-01-06

---

## 📋 Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Coverage](#coverage)
- [CI/CD Integration](#cicd-integration)

---

## Overview

This project uses a comprehensive testing strategy with three levels:

1. **Unit Tests** (`tests/unit/`) - Test individual components in isolation
2. **Integration Tests** (`tests/integration/`) - Test service interactions
3. **E2E Tests** (`tests/e2e/`) - Test complete workflows

### Test Coverage Goals

- **Unit Tests**: >85% coverage per service
- **Integration Tests**: >70% coverage of critical paths
- **E2E Tests**: All major workflows and user journeys

---

## Test Structure

```
tests/
├── conftest.py                 # Pytest configuration and fixtures
├── helpers.py                  # Test helper functions
├── pytest.ini                  # Pytest settings
├── run_tests.py               # Test runner script
│
├── unit/                       # Unit tests
│   ├── stage1/                # Stage 1 service tests
│   │   ├── test_alert_ingestor.py
│   │   └── test_alert_normalizer.py
│   ├── stage2/                # Stage 2 service tests
│   │   ├── test_context_collector.py
│   │   ├── test_threat_intel_aggregator.py
│   │   └── test_llm_router.py
│   ├── stage3/                # Stage 3 service tests
│   │   ├── test_ai_triage_agent.py
│   │   └── test_similarity_search.py
│   └── stage4/                # Stage 4 service tests
│       ├── test_workflow_engine.py
│       ├── test_automation_orchestrator.py
│       └── test_notification_service.py
│
├── integration/                # Integration tests
│   ├── test_alert_processing_pipeline.py
│   ├── test_enrichment_pipeline.py
│   ├── test_ai_pipeline.py
│   └── test_workflow_pipeline.py
│
└── e2e/                        # End-to-end tests
    └── test_full_pipeline_e2e.py
```

---

## Running Tests

### Quick Start

```bash
# Run all tests
./tests/run_tests.py

# Run unit tests only
./tests/run_tests.py unit

# Run integration tests
./tests/run_tests.py integration

# Run E2E tests
./tests/run_tests.py e2e

# Run tests for specific stage
./tests/run_tests.py --stage stage1

# With coverage report
./tests/run_tests.py --cov

# Generate HTML report
./tests/run_tests.py --html

# Verbose output
./tests/run_tests.py --verbose

# Parallel execution (requires pytest-xdist)
./tests/run_tests.py -n 4
```

### Using pytest directly

```bash
# Run all tests
pytest tests/

# Run specific test file
pytest tests/unit/stage1/test_alert_ingestor.py

# Run specific test class
pytest tests/unit/stage1/test_alert_ingestor.py::TestAlertIngestor

# Run specific test method
pytest tests/unit/stage1/test_alert_ingestor.py::TestAlertIngestor::test_health_check

# Run tests matching pattern
pytest tests/ -k "malware"

# Run with markers
pytest tests/ -m unit
pytest tests/ -m integration
pytest tests/ -m e2e

# Stop on first failure
pytest tests/ -x

# Run last failed tests
pytest tests/ --lf

# Run verbose
pytest tests/ -v
```

---

## Writing Tests

### Test Structure

```python
# Copyright 2026 CCR <chenchunrun@gmail.com>
# Licensed under the Apache License, Version 2.0

"""
Unit tests for Service Name.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch

from shared.models import SecurityAlert


@pytest.mark.unit
class TestServiceName:
    """Test ServiceName functionality."""

    @pytest.fixture
    def client(self):
        """Test client."""
        from services.service_name.main import app
        from fastapi.testclient import TestClient
        return TestClient(app)

    @pytest.fixture
    def sample_data(self):
        """Sample data for testing."""
        return {
            "field1": "value1",
            "field2": "value2"
        }

    def test_feature_success(self, client, sample_data):
        """Test successful operation."""
        response = client.post("/api/v1/endpoint", json=sample_data)
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True

    def test_feature_failure(self, client, sample_data):
        """Test failure handling."""
        # Modify data to trigger failure
        sample_data["field1"] = None

        response = client.post("/api/v1/endpoint", json=sample_data)
        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async async def test_async_feature(self, client):
        """Test async feature."""
        # Test code here
        pass
```

### Using Fixtures

```python
def test_with_sample_alert(sample_alert):
    """Test using sample alert fixture."""
    assert sample_alert.alert_id is not None
    assert sample_alert.severity in ["critical", "high", "medium", "low", "info"]

def test_with_mock_db(mock_db):
    """Test using mock database."""
    # Use mock_db for database operations
    pass
```

### Testing with Mocks

```python
def test_with_mocks(mock_publisher, mock_consumer):
    """Test using mocked services."""
    # Mock publisher
    mock_publisher.publish.return_value = True

    # Test code that calls publisher
    # ...

    # Assert mock was called
    assert mock_publisher.publish.called
    mock_publisher.publish.assert_called_once_with("queue.name", ANY)
```

### Parametrized Tests

```python
@pytest.mark.parametrize("alert_type,severity,expected_risk", [
    ("malware", "critical", "critical"),
    ("malware", "high", "high"),
    ("phishing", "medium", "medium"),
])
def test_risk_assessment(alert_type, severity, expected_risk):
    """Test risk assessment for various combinations."""
    result = assess_risk(alert_type, severity)
    assert result["risk_level"] == expected_risk
```

---

## Coverage

### Generating Coverage Reports

```bash
# Generate terminal coverage
pytest --cov=services --cov-report=term-missing

# Generate HTML coverage report
pytest --cov=services --cov-report=html

# Open coverage report
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

### Coverage Goals

| Component | Target Coverage | Priority |
|-----------|----------------|----------|
| Alert Ingestor | >90% | P0 |
| Alert Normalizer | >90% | P0 |
| Context Collector | >85% | P0 |
| Threat Intel Aggregator | >85% | P0 |
| AI Triage Agent | >85% | P0 |
| LLM Router | >85% | P0 |
| Similarity Search | >80% | P1 |
| Workflow Engine | >85% | P0 |
| Automation Orchestrator | >85% | P0 |
| Notification Service | >85% | P0 |

### Viewing Coverage

Coverage reports are generated in:
- **HTML**: `htmlcov/index.html` - Interactive HTML coverage report
- **Terminal**: Console output with line-by-line coverage
- **XML**: `coverage.xml` - For CI/CD integration

---

## CI/CD Integration

### Pre-Commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash
echo "Running pre-commit tests..."

# Run unit tests
pytest tests/unit/ -q --maxfail=3

if [ $? -ne 0 ]; then
    echo "❌ Pre-commit tests failed"
    exit 1
fi

echo "✅ Pre-commit tests passed"
exit 0
```

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov pytest-asyncio pytest-xdist

      - name: Run unit tests
        run: pytest tests/unit/ -v --cov=services --cov-report=xml

      - name: Run integration tests
        run: pytest tests/integration/ -v

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml
```

### GitLab CI

```yaml
# .gitlab-ci.yml
test:
  stage: test
  image: python:3.11

  before_script:
    - pip install -r requirements.txt
    - pip install pytest pytest-cov

  script:
    - pytest tests/unit/ -v --cov=services --cov-report=xml

  coverage: '/TOTAL.*\s+(\d+%)$/'

  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
```

---

## Test Markers

Use pytest markers to categorize tests:

```python
@pytest.mark.unit
def test_unit_feature():
    """Unit test - runs quickly, no external dependencies."""
    pass

@pytest.mark.integration
def test_integration_feature():
    """Integration test - tests service interactions."""
    pass

@pytest.mark.e2e
def test_e2e_workflow():
    """E2E test - tests complete user workflow."""
    pass

@pytest.mark.slow
def test_slow_operation():
    """Slow test - runs separately."""
    pass

@pytest.mark.requires_network
def test_external_api():
    """Test requiring network access."""
    pass
```

Run marked tests:
```bash
pytest tests/ -m unit          # Unit tests only
pytest tests/ -m "not slow"     # All except slow
pytest tests/ -m "unit and requires_network"  # Specific combination
```

---

## Performance Testing

### Benchmark Tests

```python
@pytest.mark.benchmark
def test_alert_ingestion_performance(benchmark):
    """Benchmark alert ingestion."""
    alert_data = create_mock_alert()

    def ingest():
        client.post("/api/v1/alerts", json=alert_data)

    # Run 100 iterations
    result = benchmark(ingest, iterations=100)

    # Assert performance target
    assert result.mean < 0.1  # < 100ms
```

Run benchmarks:
```bash
pytest tests/ --benchmark-only
```

---

## Troubleshooting

### Common Issues

**Issue**: Tests fail with import errors
```bash
# Solution: Ensure PYTHONPATH includes project root
export PYTHONPATH=/Users/newmba/security:$PYTHONPATH
pytest tests/
```

**Issue**: Async tests hang or timeout
```bash
# Solution: Use pytest-asyncio with proper event loop
pytest tests/ --asyncio-mode=auto
```

**Issue**: Database tests fail
```bash
# Solution: Use test database
export DATABASE_URL="postgresql://test:test@localhost/test_db"
pytest tests/ -m requires_database
```

**Issue**: Tests run slowly
```bash
# Solution: Use pytest-xdist for parallel execution
pip install pytest-xdist
pytest tests/ -n auto  # Auto-detect CPU count
```

---

## Best Practices

1. **Arrange-Act-Assert (AAA) Pattern**
   ```python
   def test_something():
       # Arrange: Set up test data
       alert = create_alert()

       # Act: Execute function under test
       result = process_alert(alert)

       # Assert: Verify expected outcome
       assert result["status"] == "success"
   ```

2. **Test One Thing**
   - Each test should verify a single behavior
   - Use descriptive test names

3. **Use Fixtures**
   - Share setup code through fixtures
   - Keep tests DRY (Don't Repeat Yourself)

4. **Mock External Dependencies**
   - Mock databases, APIs, message queues
   - Focus on testing your code, not external services

5. **Test Edge Cases**
   - Empty inputs
   - Null/None values
   - Invalid data types
   - Boundary conditions

6. **Keep Tests Independent**
   - Tests should not depend on each other
   - Each test should clean up after itself

---

## Resources

- **Pytest Documentation**: https://docs.pytest.org/
- **pytest-asyncio**: https://pytest-asyncio.readthedocs.io/
- **pytest-cov**: https://pytest-cov.readthedocs.io/
- **pytest-xdist**: https://pytest-xdist.readthedocs.io/

---

**Last Updated**: 2026-01-06
**Maintainer**: CCR <chenchunrun@gmail.com>
