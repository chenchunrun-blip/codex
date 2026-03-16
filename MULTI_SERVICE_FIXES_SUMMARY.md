# Multi-Service Database Initialization Fixes

**Date**: 2026-01-10
**Status**: ✅ **Alert-Ingestor & Alert-Normalizer RUNNING**
**Services Fixed**: alert-ingestor, alert-normalizer, context-collector, threat-intel-aggregator, ai-triage-agent

---

## Overview

Applied database initialization fixes to 5 core services that use the database connection pool. All services had the same issue of calling `get_database_manager()` without first calling `init_database()`.

---

## ✅ Fixed Services

### 1. Alert Ingestor ✅ (Running)
- Status: Healthy
- Port: 9001
- Health: http://localhost:9001/health

### 2. Alert Normalizer ✅ (Running)
- Status: Healthy
- Port: 9002
- Health: http://localhost:9002/health
- Consumer: Connected to `alert.raw` queue
- Publisher: Publishing to `alert.normalized` queue

### 3. Context Collector ⚠️ (Fixed, Not Started)
- Port: 9003
- Consumer: `alert.normalized`
- Publisher: `alert.enriched`

### 4. Threat Intel Aggregator ⚠️ (Fixed, Not Started)
- Port: 9004
- Consumer: `alert.enriched`
- Publisher: `alert.contextualized`

### 5. AI Triage Agent ⚠️ (Fixed, Not Started)
- Port: 9006
- Consumer: `alert.contextualized`
- Publisher: `alert.result`

---

## 🔧 Fixes Applied

### Fix 1: Database Initialization Pattern

**Files Modified** (5 services):
- `services/alert_ingestor/main.py`
- `services/alert_normalizer/main.py`
- `services/context_collector/main.py`
- `services/threat_intel_aggregator/main.py`
- `services/ai_triage_agent/main.py`

**Changes**:

1. **Added imports**:
```python
import os
from shared.database import DatabaseManager, close_database, get_database_manager, init_database
```

2. **Updated lifespan function**:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_manager, publisher, consumer

    try:
        # Initialize database FIRST before getting manager
        await init_database(
            database_url=config.database_url,
            pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
            echo=config.debug,
        )
        db_manager = get_database_manager()
        logger.info("✓ Database connected")

        # ... rest of initialization
```

3. **Updated cleanup**:
```python
    finally:
        # ... cleanup other resources

        # Close database using the close_database function
        await close_database()
        logger.info("✓ Database connection closed")
```

---

### Fix 2: JWT_SECRET_KEY Environment Variable

**File Modified**: `docker-compose.yml`

**Services Updated** (4 services):
- alert-normalizer
- context-collector
- threat-intel-aggregator
- ai-triage-agent

**Change**:
```yaml
environment:
  # Security
  JWT_SECRET_KEY: ${JWT_SECRET_KEY:-change-this-to-a-random-secret-key-in-production}
  # ... other environment variables
```

---

### Fix 3: Health Check - Replace curl with Python

**File Modified**: `docker-compose.yml`

**Services Updated**: All 15 Python services

**Change**:
```yaml
# Before
healthcheck:
  test: curl -f http://localhost:8000/health || exit 1

# After
healthcheck:
  test: python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
```

**Reason**: Python containers don't have `curl` installed by default.

---

### Fix 4: Missing Redis Dependency

**File Modified**: `services/alert_normalizer/requirements.txt`

**Change**:
```txt
# Redis
redis[hiredis]==4.6.0
```

**Reason**: The shared module's cache.py requires redis, but it wasn't in alert-normalizer's requirements.

---

### Fix 5: Config Object Usage Error

**File Modified**: `services/alert_normalizer/main.py`

**Change**:
```python
# Before (line 509-510)
aggregator = AlertAggregator(
    window_seconds=int(config.get("aggregation_window_seconds", 30)),
    max_batch_size=int(config.get("aggregation_max_size", 100)),
)

# After
aggregator = AlertAggregator(
    window_seconds=30,  # Default 30-second aggregation window
    max_batch_size=100,  # Default max batch size
)
```

**Reason**: Config is a Pydantic model, not a dictionary, so `.get()` method doesn't exist.

---

### Fix 6: Disk Space Cleanup

**Action**:
```bash
docker system prune -f
```

**Result**: Freed ~4GB of disk space (was at 100% capacity)

---

## 📋 All Modified Files Summary

### Service Main Files (5)
1. `services/alert_ingestor/main.py` - Database initialization + imports
2. `services/alert_normalizer/main.py` - Database initialization + imports + config fix
3. `services/context_collector/main.py` - Database initialization + imports
4. `services/threat_intel_aggregator/main.py` - Database initialization + imports
5. `services/ai_triage_agent/main.py` - Database initialization + imports

### Configuration Files (2)
6. `docker-compose.yml` - Health checks + JWT_SECRET_KEY for 4 services
7. `services/alert_normalizer/requirements.txt` - Added redis dependency

### Previously Fixed Files (from alert-ingestor session)
8. `services/shared/database/base.py` - SQLAlchemy text() wrapper
9. `services/shared/messaging/publisher.py` - Removed aio-pika publisher confirms
10. `.env` - Fixed DATABASE_URL hostnames (localhost → service names)

---

## 🧪 Verification

### Alert Ingestor
```bash
$ docker-compose ps alert-ingestor
NAME: security-triage-alert-ingestor
STATUS: Up 15 minutes (healthy)

$ curl http://localhost:9001/health
{
    "status": "healthy",
    "service": "alert-ingestor",
    "checks": {
        "database": {"status": "healthy"},
        "message_queue": "connected"
    }
}
```

### Alert Normalizer
```bash
$ docker-compose ps alert-normalizer
NAME: security-triage-alert-normalizer
STATUS: Up 5 minutes (healthy)

$ curl http://localhost:9002/health
# Returns 200 OK
```

### Startup Logs (Alert Normalizer)
```
✓ Starting Alert Normalizer Service
✓ Database initialized
✓ Database connected
✓ Publisher connected to RabbitMQ
✓ Message publisher connected
✓ Message consumer connected
✓ Alert Normalizer Service started successfully
Uvicorn running on http://0.0.0.0:8000
```

---

## 🚀 Starting the Remaining Services

To start the other fixed services:

```bash
# Context Collector
docker-compose up -d context-collector

# Threat Intel Aggregator
docker-compose up -d threat-intel-aggregator

# AI Triage Agent
docker-compose up -d ai-triage-agent

# Check all services
docker-compose ps
```

**Note**: Each service may need additional dependencies added to their requirements.txt files (e.g., `redis` package).

---

## 📊 Progress Summary

| Service | Code Fixed | JWT Secret | Health Check | Redis Dep | Built | Running |
|---------|-----------|------------|--------------|-----------|-------|---------|
| alert-ingestor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| alert-normalizer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| context-collector | ✅ | ✅ | ✅ | ❓ | ❓ | ⚠️ |
| threat-intel-aggregator | ✅ | ✅ | ✅ | ❓ | ❓ | ⚠️ |
| ai-triage-agent | ✅ | ✅ | ✅ | ❓ | ❓ | ⚠️ |

**Legend**:
- ✅ Complete
- ❓ Need to verify
- ⚠️ Fixed but not started/tested

---

## ⚠️ Known Issues & TODOs

### 1. Missing Dependencies
Other services may also be missing the `redis` package. Check if needed:
```bash
# For each service, check requirements.txt
grep -r "import redis" services/*/main.py
```

### 2. Config Field Additions
Consider adding aggregation config fields to the shared Config class:
```python
# In services/shared/utils/config.py
aggregation_window_seconds: int = 30
aggregation_max_size: int = 100
```

### 3. Service Dependencies
The services depend on each other in this order:
1. alert-ingestor (no service dependencies)
2. alert-normalizer (depends on: alert-ingestor)
3. context-collector (depends on: alert-normalizer)
4. threat-intel-aggregator (depends on: context-collector)
5. ai-triage-agent (depends on: context-collector)

Start them in order for proper testing.

---

## 🎯 Next Steps

1. **Verify remaining services** - Start context-collector, threat-intel-aggregator, ai-triage-agent
2. **Test message flow** - Submit a test alert and watch it flow through the pipeline
3. **Add redis to other services** - If needed, add `redis[hiredis]==4.6.0` to requirements.txt
4. **Create startup script** - Script to start all services in correct order
5. **Monitor logs** - Use `docker-compose logs -f` to watch the pipeline

---

## 📚 Related Documentation

- `ALERT_INGESTOR_FIXES_SUMMARY.md` - Details on initial alert-ingestor fixes
- `SERVICE_STARTUP_ISSUES.md` - Earlier session issues
- `CLAUDE.md` - Project overview and architecture

---

**Report Generated**: 2026-01-10 09:09
**Services Fixed**: 5
**Services Running**: 2
**Status**: 🟢 **ON TRACK** - Core pipeline services operational
