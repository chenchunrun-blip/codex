# Alert Ingestor Service - Startup Fixes Summary

**Date**: 2026-01-10
**Status**: ✅ **SERVICE RUNNING SUCCESSFULLY**
**Health Check**: http://localhost:9001/health - ✅ Healthy

---

## ✅ Fixed Issues

### 1. Database Initialization Pattern ✅

**Error**: `RuntimeError: Database not initialized. Call init_database() first.`

**Root Cause**: The lifespan function called `get_database_manager()` without first calling `init_database()`.

**Fix**: Modified `services/alert_ingestor/main.py` (lines 92-136):
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_manager, message_publisher

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

**Files Modified**:
- `services/alert_ingestor/main.py` - Added `init_database()` call, imported `os`, `init_database`, `close_database`

---

### 2. DATABASE_URL Hostname Issue ✅

**Error**: `ConnectionRefusedError: [Errno 111] Connection refused` (to PostgreSQL)

**Root Cause**: The `.env` file had `DATABASE_URL` set to `localhost`, but inside Docker Compose, services need to connect to `postgres` (the service name).

**Fix**: Updated `.env` file (lines 5-15):
```bash
# Before
DATABASE_URL=postgresql+asyncpg://triage_user:${DB_PASSWORD}@localhost:5432/security_triage
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379/0
RABBITMQ_URL=amqp://admin:${RABBITMQ_PASSWORD}@localhost:5672/

# After
DATABASE_URL=postgresql+asyncpg://triage_user:${DB_PASSWORD}@postgres:5432/security_triage
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
RABBITMQ_URL=amqp://admin:${RABBITMQ_PASSWORD}@rabbitmq:5672/
```

**Files Modified**:
- `.env` - Changed localhost to Docker service names (postgres, redis, rabbitmq)

---

### 3. SQLAlchemy 2.0 Raw SQL Execution ✅

**Error**: `sqlalchemy.exc.ObjectNotExecutableError: Not an executable object: 'SELECT 1'`

**Root Cause**: SQLAlchemy 2.0 requires `text()` wrapper for raw SQL strings.

**Fix**: Modified `services/shared/database/base.py`:
```python
# Added import
from sqlalchemy import text

# Fixed line 100 (initialize method)
async with self.engine.connect() as conn:
    await conn.execute(text("SELECT 1"))  # Was: await conn.execute("SELECT 1")

# Fixed line 160 (health_check method)
async with self.engine.connect() as conn:
    await conn.execute(text("SELECT 1"))  # Was: await conn.execute("SELECT 1")
```

**Files Modified**:
- `services/shared/database/base.py` - Added `text` import, wrapped SQL strings with `text()`

---

### 4. aio-pika Publisher Confirms API ✅

**Error**: `AttributeError: 'RobustChannel' object has no attribute 'set_confirm_mode'`

**Root Cause**: The `set_confirm_mode()` method is not available in aio-pika 9.x.

**Fix**: Modified `services/shared/messaging/publisher.py` (lines 80-102):
```python
async def connect(self):
    """Connect to RabbitMQ and setup exchange."""
    try:
        self.connection = await connect_robust(self.amqp_url)
        self.channel = await self.connection.channel()

        # Note: Publisher confirms disabled for compatibility with aio-pika 9.x
        # TODO: Implement proper publisher confirms when needed

        # ... rest of connection setup
```

**Files Modified**:
- `services/shared/messaging/publisher.py` - Removed `set_confirm_mode()` call

---

## 📋 All Modified Files

### Core Application Files
1. **`services/alert_ingestor/main.py`**
   - Added `import os`
   - Added `init_database, close_database` to imports
   - Modified lifespan function to call `init_database()` first
   - Modified cleanup to use `close_database()`

2. **`services/shared/database/base.py`**
   - Added `from sqlalchemy import text`
   - Wrapped raw SQL with `text()` in `initialize()` method
   - Wrapped raw SQL with `text()` in `health_check()` method

3. **`services/shared/messaging/publisher.py`**
   - Removed publisher confirms setup (incompatible with aio-pika 9.x)

### Configuration Files
4. **`.env`**
   - Changed `DATABASE_URL` from `localhost` to `postgres`
   - Changed `REDIS_URL` from `localhost` to `redis`
   - Changed `RABBITMQ_URL` from `localhost` to `rabbitmq`

---

## 🧪 Verification

### Service Status
```bash
$ docker-compose ps alert-ingestor
NAME                             STATUS
security-triage-alert-ingestor   Up 15 seconds (healthy)

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

### Startup Logs
```
✓ Rate limiter initialized
✓ Database initialized
✓ Database connected
✓ Publisher connected to RabbitMQ
✓ Message publisher connected
✓ Alert Ingestor Service started successfully
Uvicorn running on http://0.0.0.0:8000
```

---

## 🎯 Key Learnings

### Docker Compose Networking
- Services must use Docker service names (e.g., `postgres`, not `localhost`)
- Environment variables in `.env` file override docker-compose.yml defaults
- Check actual container environment with `docker-compose run <service> printenv`

### SQLAlchemy 2.0 Changes
- Raw SQL strings must be wrapped with `text()`
- This applies to both async and sync engines
- Error message: `ObjectNotExecutableError` indicates missing `text()` wrapper

### Database Initialization Pattern
```python
# Correct pattern for SQLAlchemy 2.0 async
await init_database(
    database_url=config.database_url,
    pool_size=10,
    max_overflow=20,
    echo=False,
)
db_manager = get_database_manager()

# NOT: db_manager = get_database_manager() directly
```

### aio-pika 9.x Compatibility
- Publisher confirms API changed in version 9.x
- `set_confirm_mode()` method no longer exists
- Can be disabled for basic functionality

---

## 📝 Previous Fixes (From Earlier Session)

The following fixes were already completed in the previous session:

1. **Dockerfile CMD paths** - Fixed from `/app/main.py` to `services/alert_ingestor/main.py`
2. **PYTHONPATH configuration** - Changed to `/app/services:/app`
3. **SQLAlchemy reserved word** - Renamed `metadata` to `alert_metadata` in models.py
4. **Missing slowapi package** - Added to requirements.txt
5. **Missing JWT_SECRET_KEY** - Added to docker-compose.yml
6. **China Debian mirrors** - Added to all Dockerfiles for faster builds

See `SERVICE_STARTUP_ISSUES.md` for details on these earlier fixes.

---

## 🚀 Next Steps

### Recommended Actions

1. **Test Alert Submission**
   ```bash
   curl -X POST http://localhost:9001/api/v1/alerts \
     -H "Content-Type: application/json" \
     -d '{
       "alert_id": "test-001",
       "timestamp": "2026-01-10T00:00:00Z",
       "alert_type": "malware",
       "severity": "high",
       "description": "Test alert"
     }'
   ```

2. **Apply Similar Fixes to Other Services**
   All services using the database likely need similar initialization fixes:
   - alert-normalizer
   - context-collector
   - threat-intel-aggregator
   - ai-triage-agent
   - (any service importing `get_database_manager()`)

3. **Re-enable Publisher Confirms** (Optional)
   Implement proper aio-pika 9.x publisher confirms when message durability is critical.

4. **Monitor Service Health**
   ```bash
   watch -n 5 'curl -s http://localhost:9001/health | jq .'
   ```

---

## 📊 Timeline

- **10:50** - Rebuilt container with database initialization fix
- **10:51** - Discovered DATABASE_URL hostname issue
- **10:52** - Fixed .env file to use Docker service names
- **10:53** - Fixed SQLAlchemy text() wrapper issue
- **10:54** - Fixed aio-pika publisher confirms issue
- **10:54** - **Service started successfully** ✅

---

## ✅ Success Criteria Met

- [x] Service starts without errors
- [x] Database connection pool initialized
- [x] Health check returns 200 OK
- [x] Message queue (RabbitMQ) connected
- [x] All startup log messages show success
- [x] Container status shows "healthy"

---

**Report Generated**: 2026-01-10 08:54
**Service**: Alert Ingestor (alert-ingestor)
**Status**: 🟢 **OPERATIONAL**
