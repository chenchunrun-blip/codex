# Performance Testing Guide

This directory contains performance tests for the Security Triage System using Locust.

## Prerequisites

Install Locust and dependencies:

```bash
pip install locust
```

## Test Scenarios

### 1. Smoke Test (Quick Validation)
Quick test to verify basic functionality.

```bash
locust -f tests/load/locustfile.py --headless -u 1 -t 1m --html smoke_test.html
```

**Expected**: All tests pass, no errors
**Duration**: 1 minute
**Users**: 1

### 2. Load Test (Normal Traffic)
Tests system under normal expected load.

```bash
locust -f tests/load/locustfile.py --headless -u 10 -r 2 -t 5m --html load_test.html
```

**Expected**: System handles 100+ requests/second
**Duration**: 5 minutes
**Users**: 10
**Spawn Rate**: 2 users/second

### 3. Stress Test (High Traffic)
Tests system limits and breaking points.

```bash
locust -f tests/load/locustfile.py --headless -u 50 -r 10 -t 2m --html stress_test.html
```

**Expected**: System degrades gracefully, no crashes
**Duration**: 2 minutes
**Users**: 50
**Spawn Rate**: 10 users/second

### 4. Soak Test (Long Duration)
Tests for memory leaks and stability over time.

```bash
locust -f tests/load/locustfile.py --headless -u 5 -r 1 -t 30m --html soak_test.html
```

**Expected**: No memory leaks, stable performance
**Duration**: 30 minutes
**Users**: 5
**Spawn Rate**: 1 user/second

## Interactive Mode (Web UI)

Launch Locust with web interface for real-time monitoring:

```bash
locust -f tests/load/locustfile.py --host http://localhost:8089
```

Then open http://localhost:8089 in your browser.

## Target Performance Metrics

- **Throughput**: 100+ alerts/second
- **P95 Latency**: < 3000ms (3 seconds)
- **P99 Latency**: < 5000ms (5 seconds)
- **Error Rate**: < 1%
- **Memory**: No leaks in 30-minute test

## Test Users

### SecurityTriageUser
Simulates normal alert processing with realistic wait times (1-3 seconds between tasks).

**Tasks:**
- Process Splunk alerts (weight: 3)
- Process QRadar alerts (weight: 2)
- Process CEF alerts (weight: 1)
- Collect network context (weight: 2)
- AI triage analysis (weight: 1)

### FullPipelineUser
Tests complete alert processing pipeline from normalization to triage.

**Tasks:**
- Full alert pipeline (all stages sequentially)

### StressTestUser
High-intensity testing with minimal wait times (0.1-0.5 seconds).

**Tasks:**
- Rapid alert processing

## Output Files

After each test, Locust generates an HTML report:
- `smoke_test.html`
- `load_test.html`
- `stress_test.html`
- `soak_test.html`

Open these files in a browser to view detailed metrics including:
- Requests per second
- Response times (min, avg, median, P95, P99)
- Error rates
- Response time distribution

## Interpreting Results

### Good Performance ✅
- Requests/sec: > 100
- P95 Latency: < 3000ms
- P99 Latency: < 5000ms
- Error Rate: < 1%

### Acceptable Performance ⚠️
- Requests/sec: 50-100
- P95 Latency: 3000-5000ms
- Error Rate: 1-5%

### Poor Performance ❌
- Requests/sec: < 50
- P95 Latency: > 5000ms
- Error Rate: > 5%

## Troubleshooting

### High Error Rates
- Check service logs in `logs/`
- Verify all services are running
- Check database connections

### Slow Response Times
- Profile slow operations with Python cProfile
- Check database query performance
- Verify cache hit rates

### Memory Issues
- Monitor with `top` or `htop` during tests
- Check for memory leaks with `memory_profiler`
- Review logs for connection pool issues

## Continuous Integration

Add to CI/CD pipeline:

```yaml
performance_test:
  script:
    - pip install locust
    - locust -f tests/load/locustfile.py --headless -u 10 -r 2 -t 2m --html report.html
  artifacts:
    paths:
      - report.html
```

## Test Data

Tests use generated synthetic data that mimics real security alerts:
- Realistic IP addresses
- Valid file hashes (MD5 format)
- Realistic alert signatures
- Applicable severity levels

No real security data is used in tests.
