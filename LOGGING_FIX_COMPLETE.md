# Logging Error Fix - Summary Report

**Date**: 2026-01-10
**Issue**: "Replacement index 0 out of range for positional args tuple"
**Status**: ✅ RESOLVED

---

## Problem Description

The Security Triage System was experiencing a critical logging error that prevented message processing:

```
ERROR: Replacement index 0 out of range for positional args tuple
Location: shared/messaging/consumer.py:209
```

This error caused:
- Messages to be consumed but not processed
- No context enrichment to be persisted
- No threat intelligence to be aggregated
- No triage results to be saved
- End-to-end alert pipeline completely blocked

---

## Root Cause Analysis

### Primary Issue: Incompatible Logging Configuration

The project used **loguru** logging library, but had incompatible logger calls:

1. **Extra Parameter Issue**: Multiple services used `extra={...}` parameter in logger calls, which loguru doesn't support the same way as standard Python logging
2. **Handler Management**: The `get_logger()` function called `_logger.remove()` on every invocation, causing handler conflicts
3. **Missing Directory**: File logger tried to write to non-existent `logs/` directory

### Files Affected

- `services/shared/messaging/consumer.py` (7 logger calls with `extra=`)
- `services/context_collector/main.py` (1 logger call with `extra=`)
- `services/threat_intel_aggregator/main.py` (1 logger call with `extra=`)
- `services/ai_triage_agent/main.py` (3 logger calls with `extra=`)
- `services/alert_normalizer/main.py` (3 logger calls with `extra=`)
- `services/shared/utils/logger.py` (incompatible loguru configuration)

---

## Solution Implemented

### 1. Replaced loguru with Standard Python Logging

**File**: `services/shared/utils/logger.py`

**Before** (loguru):
```python
from loguru import logger as _logger

def get_logger(name: str) -> Any:
    _logger.remove()  # Removes all handlers every time
    _logger.add(sys.stderr, format="...", level="INFO")
    _logger.add("logs/triage.log", ...)
    return _logger
```

**After** (standard Python logging):
```python
import logging
import os

_handlers_configured = False
_logger = None

def get_logger(name: str) -> Any:
    global _handlers_configured, _logger

    if not _handlers_configured:
        _logger = logging.getLogger("security_triage")
        _logger.setLevel(logging.DEBUG)

        # Console handler
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setFormatter(logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s'
        ))
        _logger.addHandler(console_handler)

        # File handler with directory creation
        try:
            os.makedirs("logs", exist_ok=True)
            from logging.handlers import RotatingFileHandler
            file_handler = RotatingFileHandler(
                "logs/triage.log",
                maxBytes=100*1024*1024,  # 100 MB
                backupCount=30
            )
            file_handler.setFormatter(...)
            _logger.addHandler(file_handler)
        except Exception as e:
            _logger.warning(f"Could not create file handler: {e}")

        _handlers_configured = True

    return _logger.getChild(name)
```

### 2. Removed All `extra=` Parameters

Converted all logger calls from:
```python
logger.info("Message", extra={"key": "value"})
```

To:
```python
logger.info(f"Message (key: {value})")
```

**Files Modified**:
- `services/shared/messaging/consumer.py` - 7 locations
- `services/context_collector/main.py` - 1 location
- `services/threat_intel_aggregator/main.py` - 1 location
- `services/ai_triage_agent/main.py` - 3 locations
- `services/alert_normalizer/main.py` - 3 locations

### 3. Rebuilt All Affected Services

```bash
docker-compose build --no-cache \
  context-collector \
  alert-normalizer \
  threat-intel-aggregator \
  ai-triage-agent

docker-compose up -d \
  context-collector \
  alert-normalizer \
  threat-intel-aggregator \
  ai-triage-agent
```

---

## Results

### Before Fix
```
ERROR: Replacement index 0 out of range for positional args tuple
Location: shared.messaging.consumer:_process_message:209
```
- ❌ Messages consumed but not processed
- ❌ No error details visible
- ❌ Recursive logging failures
- ❌ Complete pipeline blockage

### After Fix
```
2026-01-10 03:51:03 | ERROR | security_triage.main:process_message:605 - Context enrichment failed: 5 validation errors for SecurityAlert
```
- ✅ Clean, informative error messages
- ✅ No logging crashes
- ✅ Services stable and healthy
- ✅ Actual errors visible and debuggable

---

## Verification

### 1. Services are Healthy
```bash
docker-compose ps | grep -E "(context-collector|threat-intel-aggregator|ai-triage-agent|alert-normalizer)"
# All services show "healthy" status
```

### 2. Logging Works Correctly
```bash
docker-compose logs --tail=50 context-collector
# Shows clean log output with proper timestamps and levels
# No more "Replacement index" errors
```

### 3. Alerts Persisting
```sql
SELECT COUNT(*) FROM alerts;
# Result: Alerts are being persisted successfully
```

---

## Remaining Work

The logging fix is complete, but there's a **separate message format issue**:

**Problem**: alert-normalizer publishes messages with empty `payload: {}`, causing Pydantic validation errors in context-collector.

**Impact**: Although logging works, the message pipeline still has a format mismatch that prevents end-to-end processing.

**Next Steps**:
1. Fix message format in alert-normalizer's `publish_single_alert()` function
2. Ensure payload structure matches SecurityAlert model expectations
3. Test end-to-end persistence flow

---

## Files Changed

| File | Changes | Lines Modified |
|------|---------|----------------|
| `services/shared/utils/logger.py` | Replaced loguru with standard logging | ~80 lines |
| `services/shared/messaging/consumer.py` | Removed `extra=` parameters, added error handling | ~15 lines |
| `services/context_collector/main.py` | Removed `extra=` parameter | 1 line |
| `services/threat_intel_aggregator/main.py` | Removed `extra=` parameter | 1 line |
| `services/ai_triage_agent/main.py` | Removed `extra=` parameters | 3 lines |
| `services/alert_normalizer/main.py` | Removed `extra=` parameters | 3 lines |

**Total**: ~103 lines modified across 6 files

---

## Technical Notes

### Why Standard Python Logging?

1. **Compatibility**: Standard library, no external dependencies
2. **Stability**: Well-tested, predictable behavior
3. **Simplicity**: No complex format string issues
4. **Maintainability**: Standard patterns, easier debugging

### Logger Configuration Improvements

1. **Singleton Pattern**: Handlers only added once
2. **Error Handling**: Graceful degradation if file logging fails
3. **Directory Creation**: Automatic log directory creation
4. **Child Loggers**: Proper hierarchy with `getLogger().getChild()`

---

**Report Generated**: 2026-01-10
**Task**: Fix logging error blocking message processing
**Status**: ✅ COMPLETED
