# 架构规范

**版本**: v1.0
**日期**: 2025-01-05
**适用范围**: 架构设计、技术选型、系统部署

---

## 1. 微服务架构规范

### 1.1 服务划分原则

#### 服务边界

```
✓ 正确的服务划分:
- Alert Ingestor: 告警接入
- Triage Agent: AI研判
- Threat Intel: 威胁情报
- Workflow: 工作流管理

✗ 错误的服务划分:
- AlertService: 包含所有告警相关功能（太庞大）
- DatabaseService: 仅仅作为数据库访问层（过度拆分）
```

#### 服务通信模式

```python
# 1. 同步通信 (HTTP/REST)
# 用于: 简单查询、用户请求
async def get_alert(alert_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"http://alert-service/api/v1/alerts/{alert_id}")
        return response.json()

# 2. 异步通信 (Message Queue)
# 用于: 长时间处理、事件驱动
from shared.messaging.publisher import publish_message

async def submit_alert(alert: dict):
    await publish_message("alert.raw", alert)
    # 立即返回，后台处理

# 3. 事件驱动 (Event Bus)
# 用于: 状态变更、通知
from shared.messaging.events import emit_event

await emit_event("alert.resolved", {
    "alert_id": alert_id,
    "resolved_by": user_id,
    "resolution_time": datetime.now()
})
```

### 1.2 服务发现

```python
# 服务注册
from servicelib import ServiceRegistry

registry = ServiceRegistry()

# 注册服务
await registry.register(
    service_name="alert-ingestor",
    service_id="alert-ingestor-1",
    host="alert-ingestor.default.svc.cluster.local",
    port=8000,
    tags=["ingestion", "api"],
    metadata={"version": "1.0.0"}
)

# 服务发现
async def call_triage_agent():
    # 自动发现健康的服务实例
    instances = await registry.discover(
        service_name="triage-agent",
        tags=["analysis"],
        healthy=True
    )

    if not instances:
        raise ServiceUnavailableError("No healthy triage-agent instances")

    # 负载均衡
    instance = instances[0]  # 或使用轮询/随机

    # 调用服务
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"http://{instance.host}:{instance.port}/api/v1/analyze",
            json={"alert_id": "ALT-001"}
        )
        return response.json()
```

### 1.3 服务治理

#### 断路器模式

```python
from circuitbreaker import circuit

@circuit(failure_threshold=5, recovery_timeout=60)
async def call_external_api(url: str):
    """带断路器的外部API调用"""

    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()

# 使用
try:
    result = await call_external_api("https://example.com/api")
except CircuitBreakerError:
    # 断路器打开，使用降级策略
    result = await get_fallback_data()
```

#### 重试策略

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True
)
async def fetch_with_retry(url: str):
    """带重试的HTTP请求"""
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
```

#### 超时控制

```python
import asyncio

async def with_timeout(coro, timeout: float = 5.0):
    """带超时的异步操作"""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        raise TimeoutError(f"Operation timed out after {timeout}s")

# 使用
result = await with_timeout(
    fetch_alert(alert_id),
    timeout=3.0
)
```

---

## 2. 数据库架构规范

### 2.1 连接池管理

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# 创建引擎
engine = create_async_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,          # 连接池大小
    max_overflow=settings.db_max_overflow,   # 最大溢出连接数
    pool_timeout=30,                          # 获取连接超时
    pool_recycle=3600,                        # 连接回收时间
    pool_pre_ping=True,                       # 连接前ping测试
    echo=settings.debug,                       # SQL日志
)

# 创建会话工厂
AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# 依赖注入
async def get_db() -> AsyncSession:
    """Database session dependency"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

### 2.2 查询优化

#### 索引策略

```sql
-- 单列索引
CREATE INDEX idx_alerts_alert_id ON alerts(alert_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);

-- 复合索引 (根据查询模式设计)
CREATE INDEX idx_alerts_status_created ON alerts(status, created_at DESC);
CREATE INDEX idx_alerts_severity_risk ON alerts(severity, risk_score DESC);

-- 部分索引 (只索引常用条件)
CREATE INDEX idx_alerts_new ON alerts(alert_id) WHERE status = 'new';

-- 表达式索引
CREATE INDEX idx_alerts_date_trunc ON alerts(date_trunc('day', created_at));

-- GIN索引 (JSONB字段)
CREATE INDEX idx_alerts_normalized_json ON alerts USING GIN (normalized_json);
```

#### 查询优化

```python
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

# ✓ 正确: 使用索引字段
async def get_alerts_by_status(status: str):
    query = (
        select(Alert)
        .where(Alert.status == status)
        .order_by(Alert.created_at.desc())
        .limit(100)
    )
    result = await session.execute(query)
    return result.scalars().all()

# ✓ 正确: 预加载关联数据
async def get_alert_with_context(alert_id: str):
    query = (
        select(Alert)
        .options(
            selectinload(Alert.context),
            selectinload(Alert.threat_intel)
        )
        .where(Alert.alert_id == alert_id)
    )
    result = await session.execute(query)
    return result.scalar_one_or_none()

# ✓ 正确: 分页查询
async def get_alerts_paginated(page: int, page_size: int):
    offset = (page - 1) * page_size
    query = (
        select(Alert)
        .order_by(Alert.created_at.desc())
        .limit(page_size)
        .offset(offset)
    )
    result = await session.execute(query)
    return result.scalars().all()

# ✗ 错误: N+1查询
async def get_alerts_bad():
    alerts = await session.execute(select(Alert)).scalars().all()
    for alert in alerts:
        # 每次循环都查询数据库
        context = await session.execute(
            select(AlertContext).where(AlertContext.alert_id == alert.id)
        ).scalar_one()
    # N+1查询问题!
```

### 2.3 数据库事务

```python
from sqlalchemy.ext.asyncio import AsyncSession

async def update_alert_with_transaction(session: AsyncSession, alert_id: str, updates: dict):
    """在事务中更新告警"""

    try:
        # 开始事务
        async with session.begin():
            # 1. 获取告警
            alert = await session.get(Alert, alert_id)
            if not alert:
                raise AlertNotFoundError(alert_id)

            # 2. 更新字段
            for key, value in updates.items():
                setattr(alert, key, value)

            # 3. 记录审计日志
            audit_log = AuditLog(
                action="alert.updated",
                resource_type="alert",
                resource_id=alert.id,
                old_values={"status": alert.status},
                new_values=updates,
                user_id=updates.get("user_id")
            )
            session.add(audit_log)

            # 4. 发送事件
            await emit_event("alert.updated", {"alert_id": alert_id})

        # 事务自动提交
        return alert

    except Exception as e:
        # 事务自动回滚
        logger.error(f"Transaction failed: {e}")
        raise
```

---

## 3. 缓存架构规范

### 3.1 多级缓存策略

```python
from typing import Optional
import json

class CacheManager:
    """多级缓存管理器"""

    def __init__(self, redis_client):
        self.redis = redis_client
        self.memory_cache = {}  # 简单内存缓存

    async def get(self, key: str, level: str = "l1") -> Optional[dict]:
        """
        多级缓存获取

        Args:
            key: 缓存键
            level: 缓存级别 (l1=内存, l2=Redis, l3=DB)
        """

        # L1: 内存缓存 (最快)
        if level == "l1" and key in self.memory_cache:
            return self.memory_cache[key]

        # L2: Redis缓存
        cached = await self.redis.get(key)
        if cached:
            data = json.loads(cached)
            # 回填L1
            self.memory_cache[key] = data
            return data

        # L3: 缓存未命中，返回None
        return None

    async def set(
        self,
        key: str,
        value: dict,
        ttl: int = 3600,
        l1_ttl: int = 300
    ):
        """
        设置多级缓存

        Args:
            key: 缓存键
            value: 缓存值
            ttl: Redis TTL (秒)
            l1_ttl: 内存缓存 TTL (秒)
        """

        # L1: 内存缓存
        self.memory_cache[key] = value

        # L2: Redis缓存
        await self.redis.setex(
            key,
            ttl,
            json.dumps(value)
        )
```

### 3.2 缓存键命名规范

```python
class CacheKeys:
    """缓存键命名规范"""

    # 格式: {service}:{entity}:{identifier}:{optional}

    # 告警缓存
    ALERT = "alerts:alert:{alert_id}"
    ALERT_LIST = "alerts:list:{filters_hash}"
    ALERT_STATS = "alerts:stats:daily:{date}"

    # 威胁情报缓存
    THREAT_INTEL = "threatintel:{ioc_type}:{ioc_value}"
    THREAT_INTEL_AGGREGATE = "threatintel:aggregate:{ioc_value}"

    # 用户缓存
    USER = "users:user:{user_id}"
    USER_PERMISSIONS = "users:permissions:{user_id}"
    USER_SESSION = "users:session:{session_id}"

    # 资产缓存
    ASSET = "assets:asset:{asset_id}"
    ASSET_VULNS = "assets:vulnerabilities:{asset_id}"

    @staticmethod
    def build(key: str, **kwargs) -> str:
        """构建缓存键"""
        return key.format(**kwargs)

# 使用示例
cache_key = CacheKeys.build(
    CacheKeys.ALERT,
    alert_id="ALT-001"
)
# => "alerts:alert:ALT-001"
```

### 3.3 缓存失效策略

```python
async def invalidate_alert_cache(alert_id: str):
    """失效告警相关缓存"""

    cache_keys = [
        CacheKeys.build(CacheKeys.ALERT, alert_id=alert_id),
        # 失效列表缓存
        CacheKeys.build(CacheKeys.ALERT_LIST, filters_hash="*"),
    ]

    await cache_manager.delete_many(*cache_keys)

# 监听数据库变更，自动失效缓存
@event.listens_for(Alert, "after_update")
def on_alert_update(mapper, connection, target):
    """告警更新后失效缓存"""
    asyncio.create_task(
        invalidate_alert_cache(target.alert_id)
    )
```

---

## 4. 消息队列架构规范

### 4.1 队列设计

```python
# 队列命名规范
QUEUES = {
    # 原始告警队列
    "alert.raw": {
        "type": "direct",
        "durable": True,
        "routing_key": "alert.raw"
    },

    # 标准化告警队列
    "alert.normalized": {
        "type": "direct",
        "durable": True,
        "routing_key": "alert.normalized"
    },

    # 研判结果队列
    "alert.result": {
        "type": "direct",
        "durable": True,
        "routing_key": "alert.result"
    },

    # 通知队列
    "notifications": {
        "type": "fanout",
        "durable": True
    },

    # 死信队列
    "alert.dlq": {
        "type": "direct",
        "durable": True
    }
}
```

### 4.2 消息格式

```python
from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import datetime
import uuid

class QueueMessage(BaseModel):
    """标准消息格式"""

    # 消息元数据
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    correlation_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str = "1.0"

    # 消息类型和内容
    message_type: str
    payload: Dict[str, Any]

    # 重试信息
    retry_count: int = 0
    max_retries: int = 3

    class Config:
        json_schema_extra = {
            "example": {
                "message_id": "msg-abc-123",
                "message_type": "alert.created",
                "payload": {
                    "alert_id": "ALT-001",
                    "severity": "high"
                },
                "retry_count": 0,
                "max_retries": 3
            }
        }
```

### 4.3 消息生产者

```python
from shared.messaging.publisher import publish_message

async def submit_alert(alert: dict):
    """提交告警到队列"""

    message = QueueMessage(
        message_type="alert.raw",
        payload=alert,
        correlation_id=alert.get("alert_id")
    )

    await publish_message(
        queue="alert.raw",
        message=message.model_dump(),
        persistent=True,  # 持久化
        mandatory=True  # 必须有队列接收
    )
```

### 4.4 消息消费者

```python
import asyncio
from shared.messaging.consumer import Consumer

class AlertProcessor:
    """告警处理消费者"""

    def __init__(self):
        self.consumer = Consumer(
            queue_name="alert.raw",
            auto_ack=False,  # 手动确认
            prefetch_count=10  # 预取数量
        )

    async def start(self):
        """启动消费者"""
        await self.consumer.consume(self.process_message)

    async def process_message(self, message: dict):
        """处理消息"""

        try:
            # 解析消息
            queue_msg = QueueMessage(**message)

            # 处理业务逻辑
            result = await self.handle_alert(queue_msg.payload)

            # 确认消息
            await self.consumer.ack(message)

        except Exception as e:
            logger.error(f"Failed to process message: {e}")

            # 重试逻辑
            if message.get("retry_count", 0) < message.get("max_retries", 3):
                # 重新入队
                await self.consumer.nack(message, requeue=True)
            else:
                # 超过最大重试次数，发送到死信队列
                await self.consumer.send_to_dlq(message)
                await self.consumer.ack(message)
```

---

## 5. 监控与可观测性规范

### 5.1 指标定义

```python
from prometheus_client import Counter, Histogram, Gauge
from prometheus_client.fastapi import Instrumentator

# 业务指标
alerts_received = Counter(
    "alerts_received_total",
    "Total number of alerts received",
    ["severity", "type"]
)

alerts_processed = Counter(
    "alerts_processed_total",
    "Total number of alerts processed",
    ["status"]
)

processing_duration = Histogram(
    "alert_processing_duration_seconds",
    "Alert processing duration",
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0]
)

risk_score_distribution = Histogram(
    "alert_risk_score",
    "Alert risk score distribution",
    buckets=[0, 20, 40, 60, 80, 100]
)

# 系统指标
active_connections = Gauge(
    "active_db_connections",
    "Number of active database connections"
)

queue_depth = Gauge(
    "queue_depth",
    "Current queue depth",
    ["queue_name"]
)
```

### 5.2 分布式追踪

```python
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# 初始化追踪
tracer = trace.get_tracer(__name__)

@app.post("/api/v1/alerts")
async def create_alert(alert: AlertCreate):
    """创建告警（带追踪）"""

    with tracer.start_as_current_span("process_alert") as span:
        # 设置span属性
        span.set_attribute("alert.id", alert.alert_id)
        span.set_attribute("alert.severity", alert.severity)

        # 业务逻辑
        result = await process_alert(alert)

        span.set_attribute("result.risk_score", result["risk_score"])

        return result
```

### 5.3 健康检查

```python
from fastapi import Response

class HealthCheck:
    """健康检查服务"""

    def __init__(self, db, redis, rabbitmq):
        self.db = db
        self.redis = redis
        self.rabbitmq = rabbitmq

    async def check(self) -> dict:
        """执行健康检查"""

        status = {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {}
        }

        # 检查数据库
        try:
            await self.db.execute("SELECT 1")
            status["checks"]["database"] = {"status": "healthy"}
        except Exception as e:
            status["checks"]["database"] = {
                "status": "unhealthy",
                "error": str(e)
            }
            status["status"] = "unhealthy"

        # 检查Redis
        try:
            await self.redis.ping()
            status["checks"]["redis"] = {"status": "healthy"}
        except Exception as e:
            status["checks"]["redis"] = {
                "status": "unhealthy",
                "error": str(e)
            }
            status["status"] = "unhealthy"

        # 检查RabbitMQ
        try:
            await self.rabbitmq.is_alive()
            status["checks"]["rabbitmq"] = {"status": "healthy"}
        except Exception as e:
            status["checks"]["rabbitmq"] = {
                "status": "unhealthy",
                "error": str(e)
            }
            status["status"] = "unhealthy"

        return status
```

---

## 6. 部署架构规范

### 6.1 容器化规范

```dockerfile
# Dockerfile多阶段构建
FROM python:3.11-slim as builder

# 安装依赖
WORKDIR /app
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# 运行时镜像
FROM python:3.11-slim

# 创建非root用户
RUN groupadd -r appuser && useradd -r -g appuser appuser

# 复制依赖
COPY --from=builder /root/.local /root/.local

# 复制代码
WORKDIR /app
COPY --chown=appuser:appuser . .

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# 切换用户
USER appuser

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 6.2 Kubernetes部署

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: alert-ingestor
  namespace: security-triage
spec:
  replicas: 3
  selector:
    matchLabels:
      app: alert-ingestor
  template:
    metadata:
      labels:
        app: alert-ingestor
        version: v1.0.0
    spec:
      containers:
      - name: alert-ingestor
        image: registry.example.com/alert-ingestor:v1.0.0
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: alert-ingestor
  namespace: security-triage
spec:
  selector:
    app: alert-ingestor
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8000
  type: ClusterIP

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: alert-ingestor-hpa
  namespace: security-triage
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: alert-ingestor
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 7. 配置管理规范

### 7.1 配置分层

```python
# 1. 默认配置 (代码中)
DEFAULT_CONFIG = {
    "retry_count": 3,
    "timeout": 30
}

# 2. 文件配置 (config.yaml)
config_file = load_yaml("config.yaml")

# 3. 环境变量配置
env_config = {
    "database_url": os.getenv("DATABASE_URL"),
    "api_key": os.getenv("API_KEY")
}

# 4. 运行时配置 (数据库)
runtime_config = load_config_from_db()

# 合并配置 (优先级从低到高)
final_config = {
    **DEFAULT_CONFIG,
    **config_file,
    **env_config,
    **runtime_config
}
```

### 7.2 配置验证

```python
from pydantic import BaseModel, validator

class AppConfig(BaseModel):
    """应用配置模型"""

    database_url: str
    redis_url: str
    debug: bool = False

    @validator("database_url")
    def validate_database_url(cls, v):
        if not v.startswith(("postgresql://", "postgresql+asyncpg://")):
            raise ValueError("Database URL must use PostgreSQL")
        return v

    @validator("debug")
    def validate_debug_in_production(cls, v):
        if v and os.getenv("ENVIRONMENT") == "production":
            raise ValueError("Debug mode must be disabled in production")
        return v
```

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
