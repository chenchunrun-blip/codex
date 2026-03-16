# Shared Services 快速参考

**版本**: v1.0
**更新**: 2025-01-05

---

## 🚀 快速导入

```python
# Models
from shared.models import (
    SecurityAlert, AlertType, Severity,
    ThreatIntel, RiskAssessment,
    SuccessResponse, ErrorResponse
)

# Database
from shared.database import DatabaseManager, BaseRepository

# Messaging
from shared.messaging import MessagePublisher, MessageConsumer

# Auth
from shared.auth import (
    create_access_token, verify_token,
    Permission, Role, require_permission
)

# Utils
from shared.utils import get_logger, Config, CacheManager

# Errors
from shared.errors import (
    ValidationError, NotFoundError,
    AuthenticationError, AuthorizationError
)
```

---

## 📦 模块速查

### Models (`shared.models`)

```python
# 创建告警
alert = SecurityAlert(
    alert_id="ALT-001",
    timestamp=datetime.utcnow(),
    alert_type=AlertType.MALWARE,
    severity=Severity.HIGH,
    description="Malware detected",
    source_ip="45.33.32.156"
)

# API响应
response = SuccessResponse(
    data=alert,
    meta=ResponseMeta(
        timestamp=datetime.utcnow(),
        request_id="req-123"
    )
)
```

### Database (`shared.database`)

```python
# 初始化
db_manager = DatabaseManager(
    database_url="postgresql+asyncpg://...",
    pool_size=20
)
await db_manager.initialize()

# 使用会话
async with db_manager.get_session() as session:
    result = await session.execute(query)

# Repository
class AlertRepo(BaseRepository[Alert]):
    async def find_by_alert_id(self, alert_id: str):
        return await self.session.execute(
            select(Alert).where(Alert.alert_id == alert_id)
        )
```

### Messaging (`shared.messaging`)

```python
# 发布消息
publisher = MessagePublisher("amqp://...")
await publisher.publish(
    "alert.raw",
    {"message_id": "msg-123", "payload": {...}}
)

# 消费消息
async def process_message(message: dict):
    print(message)

consumer = MessageConsumer("amqp://...", "alert.raw")
await consumer.consume(process_message)
```

### Auth (`shared.auth`)

```python
# 创建Token
token = create_access_token(
    user_id="user@example.com",
    permissions=["alerts:read"]
)

# 验证Token
payload = verify_token(token)
user_id = payload["sub"]
permissions = payload["permissions"]

# 权限装饰器
@require_permission(Permission.ALERT_WRITE)
async def update_alert():
    ...
```

### Utils (`shared.utils`)

```python
# 日志
logger = get_logger(__name__)
logger.info("Processing", extra={"alert_id": alert_id})

# 配置
config = Config()
db_url = config.database_url

# 缓存
cache = CacheManager("redis://...")
await cache.set("key", value, ttl=3600)
value = await cache.get("key")
```

---

## 🔧 常用模式

### FastAPI依赖注入

```python
from fastapi import Depends

# 数据库依赖
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with db_manager.get_session() as session:
        yield session

# 使用
@router.post("/alerts")
async def create_alert(
    alert: SecurityAlert,
    session: AsyncSession = Depends(get_db)
):
    ...
```

### 错误处理

```python
from shared.errors import ValidationError, NotFoundError

try:
    alert = SecurityAlert(**data)
except ValidationError as e:
    return ErrorResponse(
        error=e.to_dict(),
        meta=ResponseMeta(timestamp=datetime.utcnow(), request_id="...")
    )
```

### 消息处理

```python
# 标准消息格式
message = {
    "message_id": str(uuid.uuid4()),
    "message_type": "alert.raw",
    "payload": alert.model_dump(),
    "timestamp": datetime.utcnow().isoformat()
}

# 发布
await publisher.publish("alert.raw", message)

# 消费
async def handle_alert(message: dict):
    alert = SecurityAlert(**message["payload"])
    await process_alert(alert)
```

---

## 📋 配置清单

### 必需环境变量

```bash
# Database
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/triage

# Redis
REDIS_URL=redis://localhost:6379/0

# RabbitMQ
RABBITMQ_URL=amqp://user:pass@localhost:5672/

# JWT
JWT_SECRET_KEY=your-secret-key

# LLM (at least one)
LLM_API_KEY=sk-...
LLM_BASE_URL=https://...
# OR
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=...
```

---

## 🧪 测试示例

```python
# 测试模型
def test_alert_validation():
    alert = SecurityAlert(
        alert_id="ALT-001",
        timestamp=datetime.utcnow(),
        alert_type=AlertType.MALWARE,
        severity=Severity.HIGH,
        description="Test"
    )
    assert alert.alert_id == "ALT-001"

# 测试异常
def test_invalid_ip():
    with pytest.raises(ValidationError):
        SecurityAlert(
            source_ip="invalid-ip",
            ...
        )
```

---

## 📚 更多文档

- **完整文档**: `services/shared/README.md`
- **Phase 1报告**: `docs/phase1_complete.md`
- **开发规范**: `standards/`
- **架构设计**: `docs/01_architecture_overview.md`
