# 模块化开发计划

**版本**: v1.0
**日期**: 2025-01-05
**状态**: 开发计划
**基于文档**: 架构设计 (/docs/01-06.md) + 开发规范 (/standards/01-04.md)

---

## 📋 目录

- [1. 开发策略概述](#1-开发策略概述)
- [2. 模块划分与依赖关系](#2-模块划分与依赖关系)
- [3. Phase 1: 共享基础设施](#3-phase-1-共享基础设施)
- [4. Phase 2: 核心处理服务](#4-phase-2-核心处理服务)
- [5. Phase 3: AI分析服务](#5-phase-3-ai分析服务)
- [6. Phase 4: 工作流与自动化](#6-phase-4-工作流与自动化)
- [7. 开发验收标准](#7-开发验收标准)
- [8. 进度跟踪](#8-进度跟踪)

---

## 1. 开发策略概述

### 1.1 开发原则

```
┌─────────────────────────────────────────────────────────────────┐
│                     开发策略原则                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 自底向上 (Bottom-Up)                                        │
│     • 先开发共享基础设施                                        │
│     • 再开发核心业务服务                                        │
│     • 最后开发高级功能                                          │
│                                                                  │
│  2. 独立可测 (Independently Testable)                          │
│     • 每个模块可独立运行和测试                                  │
│     • 通过mock依赖进行单元测试                                  │
│     • 集成测试验证模块间协作                                    │
│                                                                  │
│  3. 增量交付 (Incremental Delivery)                            │
│     • 每个Phase都有可运行的系统                                 │
│     • 每个模块完成后立即可用                                     │
│     • 持续集成和部署                                            │
│                                                                  │
│  4. 规范先行 (Standards First)                                 │
│     • 严格遵循 /standards/ 中的开发规范                         │
│     • 代码审查确保合规性                                        │
│     • 自动化工具检查规范                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈确认

**开发环境**:
- Python 3.11+
- FastAPI 0.104+
- Pydantic v2
- LangChain 0.1+
- PostgreSQL 15+
- Redis 7+
- RabbitMQ 3.12+

**开发工具**:
- Docker & Docker Compose
- pytest (测试)
- black (格式化)
- isort (导入排序)
- mypy (类型检查)
- pylint (代码质量)

---

## 2. 模块划分与依赖关系

### 2.1 模块依赖图

```
┌─────────────────────────────────────────────────────────────────┐
│                        模块依赖关系图                             │
└─────────────────────────────────────────────────────────────────┘

Phase 1: 共享基础设施 (P0 - 基础)
├── M0.1: Shared Models (数据模型)
├── M0.2: Shared Database (数据库层)
├── M0.3: Shared Messaging (消息队列)
├── M0.4: Shared Auth (认证授权)
└── M0.5: Shared Utils (工具函数)

Phase 2: 核心处理服务 (P0 - 核心)
├── M1.1: Alert Ingestor (告警接入) [依赖: M0.1-M0.3, M0.5]
├── M1.2: Alert Normalizer (告警标准化) [依赖: M0.1-M0.3]
├── M1.3: Context Collector (上下文收集) [依赖: M0.1-M0.3, M0.5]
└── M1.4: Threat Intel Aggregator (威胁情报) [依赖: M0.1-M0.3, M0.5]

Phase 3: AI分析服务 (P0 - 智能核心)
├── M2.1: LLM Router (LLM路由) [依赖: M0.1, M0.5]
├── M2.2: AI Triage Agent (AI研判) [依赖: M0.1-M0.3, M2.1]
└── M2.3: Similarity Search (相似度搜索) [依赖: M0.1-M0.3]

Phase 4: 工作流与自动化 (P1 - 高级功能)
├── M3.1: Workflow Engine (工作流引擎) [依赖: M0.1-M0.3]
├── M3.2: Automation Engine (自动化引擎) [依赖: M0.1-M0.3, M3.1]
└── M3.3: API Gateway (API网关) [依赖: M0.1, M0.4]

Phase 5: 数据与支持服务 (P1 - 辅助功能)
├── M4.1: Notification Service (通知服务) [依赖: M0.1-M0.3]
├── M4.2: User Management (用户管理) [依赖: M0.1-M0.4]
├── M4.3: Reporting Service (报表服务) [依赖: M0.1-M0.3]
└── M4.4: Audit Logger (审计日志) [依赖: M0.1-M0.3]

Phase 6: 前端与监控 (P2 - UI与运维)
├── M5.1: Web Dashboard (Web仪表板) [依赖: 所有后端API]
└── M5.2: Monitoring Stack (监控栈) [依赖: 所有服务]
```

### 2.2 开发优先级

**P0 - MVP核心 (必须)**:
- Phase 1: 共享基础设施
- Phase 2: 核心处理服务
- Phase 3: AI分析服务

**P1 - 生产增强 (重要)**:
- Phase 4: 工作流与自动化
- Phase 5: 数据与支持服务

**P2 - 完善功能 (可选)**:
- Phase 6: 前端与监控

---

## 3. Phase 1: 共享基础设施

**目标**: 建立所有服务共享的基础组件
**工期**: Week 1-2
**优先级**: P0 (必须)

### M0.1: Shared Models (共享数据模型)

**描述**: 定义系统中使用的所有Pydantic模型

**文件结构**:
```
services/shared/
├── __init__.py
├── models/
│   ├── __init__.py
│   ├── alert.py              # 告警相关模型
│   ├── threat_intel.py       # 威胁情报模型
│   ├── context.py            # 上下文模型
│   ├── risk.py               # 风险评估模型
│   ├── workflow.py           # 工作流模型
│   └── common.py             # 通用模型（分页、错误响应等）
└── errors/
    ├── __init__.py
    └── exceptions.py         # 自定义异常
```

**核心模型**:
```python
# services/shared/models/alert.py
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from datetime import datetime
from enum import Enum

class AlertType(str, Enum):
    MALWARE = "malware"
    PHISHING = "phishing"
    BRUTE_FORCE = "brute_force"
    DDOS = "ddos"
    DATA_EXFILTRATION = "data_exfiltration"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    ANOMALY = "anomaly"
    OTHER = "other"

class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

class AlertStatus(str, Enum):
    NEW = "new"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"

class SecurityAlert(BaseModel):
    """标准告警模型"""

    alert_id: str = Field(..., min_length=1, max_length=100)
    timestamp: datetime
    alert_type: AlertType
    severity: Severity
    source_ip: Optional[str] = None
    target_ip: Optional[str] = None
    description: str = Field(..., min_length=1, max_length=2000)
    file_hash: Optional[str] = None
    asset_id: Optional[str] = None
    user_id: Optional[str] = None

    # 附加信息（JSON字段）
    raw_data: Optional[dict] = None
    normalized_data: Optional[dict] = None

    @field_validator('source_ip', 'target_ip')
    @classmethod
    def validate_ip_address(cls, v: Optional[str]) -> Optional[str]:
        if v and not is_valid_ip(v):
            raise ValueError(f"Invalid IP address: {v}")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "alert_id": "ALT-2025-001",
                "timestamp": "2025-01-05T12:00:00Z",
                "alert_type": "malware",
                "severity": "high",
                "source_ip": "45.33.32.156",
                "target_ip": "10.0.0.50",
                "description": "Malware detected"
            }
        }
```

**验收标准**:
- [ ] 所有模型包含完整的类型注解
- [ ] 所有模型包含field validators
- [ ] 所有模型包含docstrings
- [ ] 所有模型包含JSON schema examples
- [ ] 通过mypy类型检查
- [ ] 通过pylint质量检查

---

### M0.2: Shared Database (共享数据库层)

**描述**: 数据库连接、会话管理、Repository基类

**文件结构**:
```
services/shared/database/
├── __init__.py
├── base.py                # 数据库引擎和会话
├── repositories/
│   ├── __init__.py
│   ├── base.py            # Repository基类
│   ├── alert_repository.py
│   ├── threat_intel_repository.py
│   └── context_repository.py
└── migrations/
    ├── __init__.py
    └── alembic/           # Alembic迁移文件
```

**核心实现**:
```python
# services/shared/database/base.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from typing import AsyncGenerator
from shared.utils.logger import get_logger

logger = get_logger(__name__)

class DatabaseManager:
    """数据库管理器"""

    def __init__(self, database_url: str):
        self.engine = create_async_engine(
            database_url,
            pool_size=20,
            max_overflow=40,
            pool_timeout=30,
            pool_recycle=3600,
            pool_pre_ping=True,
            echo=False
        )

        self.SessionLocal = sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False
        )

    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """获取数据库会话（依赖注入）"""
        async with self.SessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    async def close(self):
        """关闭数据库连接"""
        await self.engine.dispose()

# 全局数据库管理器实例
db_manager: DatabaseManager = None

def init_database(database_url: str):
    """初始化数据库"""
    global db_manager
    db_manager = DatabaseManager(database_url)
    logger.info("Database initialized")

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI依赖注入：获取数据库会话"""
    if not db_manager:
        raise RuntimeError("Database not initialized")
    async for session in db_manager.get_session():
        yield session
```

**验收标准**:
- [ ] 数据库连接池配置正确
- [ ] 支持异步会话管理
- [ ] Repository基类包含CRUD方法
- [ ] 集成Alembic迁移
- [ ] 包含健康检查方法
- [ ] 连接失败时有降级处理

---

### M0.3: Shared Messaging (共享消息队列)

**描述**: RabbitMQ封装，消息发布/订阅工具

**文件结构**:
```
services/shared/messaging/
├── __init__.py
├── connection.py           # RabbitMQ连接管理
├── publisher.py            # 消息发布者
├── consumer.py             # 消息消费者
└── events.py               # 事件定义
```

**核心实现**:
```python
# services/shared/messaging/publisher.py
from aio_pika import connect_robust, Message
from aio_pika.abc import AbstractChannel
from typing import Dict, Any, Optional
import json
from shared.utils.logger import get_logger

logger = get_logger(__name__)

class MessagePublisher:
    """消息发布者"""

    def __init__(self, amqp_url: str):
        self.amqp_url = amqp_url
        self.connection: Optional[AbstractChannel] = None

    async def connect(self):
        """连接到RabbitMQ"""
        self.connection = await connect_robust(self.amqp_url)
        logger.info(f"Connected to RabbitMQ: {self.amqp_url}")

    async def publish(
        self,
        queue_name: str,
        message: Dict[str, Any],
        persistent: bool = True
    ) -> None:
        """发布消息到队列"""
        if not self.connection:
            await self.connect()

        channel = await self.connection.channel()
        await channel.declare_queue(queue_name, durable=True)

        message_body = json.dumps(message).encode()
        msg = Message(message_body, delivery_mode=2 if persistent else 1)

        await channel.default_exchange.publish(
            msg,
            routing_key=queue_name
        )

        logger.info(f"Published message to {queue_name}", extra={
            "queue": queue_name,
            "message_id": message.get("message_id")
        })

    async def close(self):
        """关闭连接"""
        if self.connection:
            await self.connection.close()
```

**验收标准**:
- [ ] 支持消息持久化
- [ ] 支持消息确认机制
- [ ] 连接断开后自动重连
- [ ] 包含消息格式验证
- [ ] 支持死信队列

---

### M0.4: Shared Auth (共享认证授权)

**描述**: JWT认证、RBAC权限管理

**文件结构**:
```
services/shared/auth/
├── __init__.py
├── jwt.py                  # JWT Token生成和验证
├── rbac.py                 # RBAC权限模型
└── dependencies.py         # FastAPI依赖注入
```

**核心实现**:
```python
# services/shared/auth/jwt.py
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import jwt
from shared.errors.exceptions import AuthenticationError

SECRET_KEY = "your-secret-key-here"  # 从环境变量读取
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 7

def create_access_token(
    user_id: str,
    permissions: list[str],
    expires_delta: Optional[timedelta] = None
) -> str:
    """创建访问令牌"""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": user_id,
        "type": "access",
        "permissions": permissions,
        "exp": expire,
        "iat": datetime.utcnow()
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str) -> Dict[str, Any]:
    """验证JWT令牌"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired")
    except jwt.InvalidTokenError:
        raise AuthenticationError("Invalid token")
```

**验收标准**:
- [ ] JWT token生成和验证
- [ ] Access token和Refresh token
- [ ] RBAC权限模型
- [ ] FastAPI依赖注入
- [ ] Token刷新机制

---

### M0.5: Shared Utils (共享工具函数)

**描述**: 日志、配置、缓存、监控等工具

**文件结构**:
```
services/shared/utils/
├── __init__.py
├── logger.py              # 结构化日志
├── config.py              # 配置管理
├── cache.py               # Redis缓存
└── metrics.py             # Prometheus指标
```

**验收标准**:
- [ ] 结构化日志（JSON格式）
- [ ] 分级日志（DEBUG/INFO/WARNING/ERROR/CRITICAL）
- [ ] Redis缓存工具
- [ ] Prometheus指标导出
- [ ] 配置管理（环境变量+YAML）

---

## 4. Phase 2: 核心处理服务

**目标**: 实现告警接入、标准化、上下文收集和威胁情报
**工期**: Week 3-4
**优先级**: P0 (必须)

### M1.1: Alert Ingestor (告警接入服务)

**描述**: 多协议告警接入（REST API、Webhook、Syslog）

**文件结构**:
```
services/alert_ingestor/
├── main.py                 # FastAPI应用入口
├── config.py               # 服务配置
├── api/
│   ├── __init__.py
│   ├── routes.py           # API路由
│   └── validators.py       # 请求验证
├── processors/
│   ├── __init__.py
│   ├── rest_processor.py   # REST API处理
│   ├── webhook_processor.py # Webhook处理
│   └── syslog_processor.py  # Syslog处理
└── tests/
    ├── __init__.py
    └── test_ingestor.py
```

**API端点**:
```python
# POST /api/v1/alerts - 接收单个告警
# POST /api/v1/alerts/batch - 批量接收告警
# GET /health - 健康检查
# GET /metrics - Prometheus指标
```

**核心逻辑**:
```python
@router.post("/api/v1/alerts")
async def ingest_alert(
    alert: SecurityAlert,
    publisher: MessagePublisher = Depends(get_publisher)
) -> dict:
    """接收告警并发布到消息队列"""

    # 1. 生成ingestion_id
    ingestion_id = str(uuid.uuid4())

    # 2. 验证告警
    if not validate_alert(alert):
        raise HTTPException(400, "Invalid alert")

    # 3. 发布到消息队列
    message = {
        "message_id": ingestion_id,
        "message_type": "alert.raw",
        "payload": alert.model_dump(),
        "timestamp": datetime.utcnow().isoformat()
    }

    await publisher.publish("alert.raw", message)

    # 4. 记录日志
    logger.info("Alert ingested", extra={
        "ingestion_id": ingestion_id,
        "alert_id": alert.alert_id
    })

    # 5. 返回响应
    return {
        "success": True,
        "data": {
            "ingestion_id": ingestion_id,
            "alert_id": alert.alert_id,
            "status": "queued"
        },
        "meta": {
            "timestamp": datetime.utcnow().isoformat(),
            "request_id": ingestion_id
        }
    }
```

**验收标准**:
- [ ] 支持REST API接收告警
- [ ] 支持Webhook接收（Splunk、QRadar等）
- [ ] 支持Syslog接收
- [ ] 告警验证和格式转换
- [ ] 发布到消息队列
- [ ] API文档（Swagger/OpenAPI）
- [ ] 单元测试覆盖率 > 80%

---

### M1.2: Alert Normalizer (告警标准化服务)

**描述**: 将不同格式的告警转换为标准格式

**文件结构**:
```
services/alert_normalizer/
├── main.py
├── normalizers/
│   ├── splunk_normalizer.py
│   ├── qradar_normalizer.py
│   ├── elastic_normalizer.py
│   └── generic_normalizer.py
└── tests/
```

**核心逻辑**:
```python
class AlertNormalizer:
    """告警标准化器"""

    async def normalize(
        self,
        raw_alert: Dict[str, Any],
        source_type: str
    ) -> SecurityAlert:
        """标准化告警"""

        # 1. 根据源类型选择标准化器
        normalizer = self.get_normalizer(source_type)

        # 2. 执行标准化
        normalized = await normalizer.normalize(raw_alert)

        # 3. 验证结果
        alert = SecurityAlert(**normalized)

        return alert
```

**验收标准**:
- [ ] 支持至少3种常见SIEM格式
- [ ] 字段映射配置化
- [ ] 异常处理和日志记录
- [ ] 单元测试

---

### M1.3: Context Collector (上下文收集服务)

**描述**: 收集网络、资产、用户上下文信息

**文件结构**:
```
services/context_collector/
├── main.py
├── collectors/
│   ├── network_collector.py   # 网络上下文
│   ├── asset_collector.py     # 资产上下文
│   └── user_collector.py      # 用户上下文
└── integrations/
    ├── cmdb_client.py         # CMDB集成
    ├── directory_client.py    # 目录服务集成
    └── geoip_client.py        # GeoIP集成
```

**验收标准**:
- [ ] 网络上下文收集（IP地理位置、Whois）
- [ ] 资产上下文收集（CMDB查询）
- [ ] 用户上下文收集（目录服务查询）
- [ ] 缓存机制（减少API调用）
- [ ] 降级处理（API失败时返回默认值）

---

### M1.4: Threat Intel Aggregator (威胁情报聚合服务)

**描述**: 从多个源查询威胁情报

**文件结构**:
```
services/threat_intel_aggregator/
├── main.py
├── sources/
│   ├── virustotal_source.py
│   ├── abusech_source.py
│   ├── misp_source.py
│   └── alienvault_source.py
└── aggregator.py              # 聚合逻辑
```

**验收标准**:
- [ ] 集成至少2个威胁情报源
- [ ] 支持IP、Hash、URL查询
- [ ] 威胁评分聚合算法
- [ ] 缓存机制
- [ ] 限流保护

---

## 5. Phase 3: AI分析服务

**目标**: 实现AI研判和相似度搜索
**工期**: Week 4-5
**优先级**: P0 (必须)

### M2.1: LLM Router (LLM路由服务)

**描述**: 根据任务复杂度智能路由到不同LLM

**文件结构**:
```
services/llm_router/
├── main.py
├── router.py                # 路由逻辑
├── clients/
│   ├── deepseek_client.py   # DeepSeek-V3客户端
│   └── qwen_client.py       # Qwen3客户端
└── config.py                # 路由规则配置
```

**核心逻辑**:
```python
class LLMRouter:
    """LLM智能路由"""

    def __init__(self):
        self.deepseek_client = DeepSeekClient()
        self.qwen_client = QwenClient()

    async def route(
        self,
        task_type: str,
        complexity: str,
        prompt: str
    ) -> str:
        """根据任务类型和复杂度路由"""

        # 简单任务 -> Qwen3（快速响应）
        if complexity == "low":
            return await self.qwen_client.generate(prompt)

        # 复杂任务 -> DeepSeek-V3（深度推理）
        elif complexity == "high":
            return await self.deepseek_client.generate(prompt)

        # 中等任务 -> 根据负载动态选择
        else:
            return await self._route_by_load(prompt)
```

**验收标准**:
- [ ] 支持DeepSeek-V3和Qwen3
- [ ] 智能路由策略
- [ ] 负载均衡
- [ ] 失败重试
- [ ] 性能监控

---

### M2.2: AI Triage Agent (AI研判服务)

**描述**: 使用LangChain进行智能研判（增强原型Agent）

**文件结构**:
```
services/ai_triage_agent/
├── main.py
├── agent/
│   ├── triage_agent.py     # LangChain Agent
│   ├── tools/
│   │   ├── context_tools.py
│   │   ├── threat_intel_tools.py
│   │   └── risk_tools.py
│   └── prompts/
│       ├── analysis_prompt.py
│       └── risk_prompt.py
└── vector_store/
    └── chromadb_client.py   # ChromaDB客户端
```

**核心逻辑**:
```python
from langchain.agents import AgentExecutor, create_openai_agent
from langchain.tools import Tool
from langchain_openai import ChatOpenAI

class AITriageAgent:
    """AI研判Agent"""

    def __init__(self, llm_router: LLMRouter):
        self.llm_router = llm_router
        self.agent = self._create_agent()

    def _create_agent(self):
        """创建LangChain Agent"""

        # 定义工具
        tools = [
            Tool(
                name="collect_context",
                func=self.collect_context,
                description="收集网络、资产、用户上下文"
            ),
            Tool(
                name="query_threat_intel",
                func=self.query_threat_intel,
                description="查询威胁情报"
            ),
            Tool(
                name="calculate_risk",
                func=self.calculate_risk,
                description="计算风险评分"
            )
        ]

        # 创建Agent
        llm = ChatOpenAI(
            base_url=os.getenv("LLM_BASE_URL"),
            api_key=os.getenv("LLM_API_KEY"),
            model="qwen-plus",
            temperature=0.0
        )

        agent = create_openai_agent(llm, tools)
        return AgentExecutor(agent=agent, tools=tools)

    async def analyze_alert(self, alert: SecurityAlert) -> TriageResult:
        """分析告警"""

        # 执行Agent
        result = await self.agent.ainvoke({
            "input": f"分析告警: {alert.json()}"
        })

        return TriageResult(**result)
```

**验收标准**:
- [ ] 基于LangChain的Agent
- [ ] 集成上下文收集工具
- [ ] 集成威胁情报查询工具
- [ ] 集成风险计算工具
- [ ] 支持私有MaaS（DeepSeek + Qwen）
- [ ] 端到端测试

---

### M2.3: Similarity Search (相似度搜索服务)

**描述**: 使用ChromaDB进行相似告警检索

**文件结构**:
```
services/similarity_search/
├── main.py
├── embeddings/
│   └── embedding_generator.py  # 向量生成
└── vector_store/
    └── chromadb_store.py       # ChromaDB封装
```

**验收标准**:
- [ ] 向量化告警描述
- [ ] ChromaDB集成
- [ ] 相似度搜索API
- [ ] 返回历史处置建议
- [ ] 性能测试（< 1s）

---

## 6. Phase 4: 工作流与自动化

**目标**: 实现工作流编排和自动化响应
**工期**: Week 6
**优先级**: P1 (重要)

### M3.1: Workflow Engine (工作流引擎)

**描述**: 使用Temporal编排工作流

**文件结构**:
```
services/workflow_engine/
├── main.py
├── workflows/
│   ├── alert_workflow.py   # 告警处理工作流
│   └── escalation_workflow.py # 升级工作流
└── activities/
    ├── assign_activity.py
    ├── notify_activity.py
    └── escalate_activity.py
```

**验收标准**:
- [ ] Temporal集成
- [ ] 告警处理工作流定义
- [ ] 人工任务支持
- [ ] SLA监控
- [ ] 工作流可视化

---

### M3.2: Automation Engine (自动化引擎)

**描述**: SOAR Playbook执行引擎

**文件结构**:
```
services/automation_engine/
├── main.py
├── playbooks/
│   ├── isolate_host_playbook.py
│   ├── block_ip_playbook.py
│   └── disable_user_playbook.py
└── actions/
    ├── ssh_action.py
    ├── api_action.py
    └── script_action.py
```

**验收标准**:
- [ ] Playbook定义格式
- [ ] 常见响应Playbook
- [ ] 审批流程
- [ ] 执行日志

---

## 7. 开发验收标准

### 7.1 代码质量标准

所有代码必须满足：
- [ ] 通过`black`格式化检查
- [ ] 通过`isort`导入排序检查
- [ ] 通过`mypy`类型检查（100%覆盖）
- [ ] 通过`pylint`质量检查（评分 > 8.0）
- [ ] 单元测试覆盖率 > 80%
- [ ] 所有公共函数有docstrings

### 7.2 API标准

所有API必须满足：
- [ ] OpenAPI 3.0规范
- [ ] 标准响应格式（success/data/meta）
- [ ] 标准错误响应（error code/message/details）
- [ ] JWT认证
- [ ] RBAC权限检查
- [ ] 速率限制
- [ ] 请求验证（Pydantic）
- [ ] API文档（Swagger UI）

### 7.3 安全标准

所有服务必须满足：
- [ ] 敏感数据加密
- [ ] SQL注入防护
- [ ] XSS防护
- [ ] CSRF防护
- [ ] 审计日志
- [ ] 健康检查端点

### 7.4 性能标准

- [ ] API响应时间 < 500ms (P95)
- [ ] 消息处理延迟 < 1s
- [ ] 数据库查询优化（使用索引）
- [ ] 缓存命中率 > 70%
- [ ] 内存使用稳定（无内存泄漏）

---

## 8. 进度跟踪

### 8.1 Phase 1 里程碑

**Week 1**:
- [ ] M0.1: Shared Models完成
- [ ] M0.2: Shared Database完成
- [ ] M0.3: Shared Messaging完成

**Week 2**:
- [ ] M0.4: Shared Auth完成
- [ ] M0.5: Shared Utils完成
- [ ] Phase 1集成测试通过

### 8.2 Phase 2 里程碑

**Week 3**:
- [ ] M1.1: Alert Ingestor完成
- [ ] M1.2: Alert Normalizer完成

**Week 4**:
- [ ] M1.3: Context Collector完成
- [ ] M1.4: Threat Intel Aggregator完成
- [ ] Phase 2集成测试通过

### 8.3 Phase 3 里程碑

**Week 4-5**:
- [ ] M2.1: LLM Router完成
- [ ] M2.2: AI Triage Agent完成
- [ ] M2.3: Similarity Search完成
- [ ] Phase 3端到端测试通过

### 8.4 Phase 4 里程碑

**Week 6**:
- [ ] M3.1: Workflow Engine完成
- [ ] M3.2: Automation Engine完成
- [ ] 完整系统演示

---

## 9. 下一步行动

### 立即开始

1. **创建服务目录结构**:
```bash
mkdir -p services/{shared,alert_ingestor,alert_normalizer,context_collector,threat_intel_aggregator,llm_router,ai_triage_agent,similarity_search}
```

2. **初始化共享模块**:
   - 创建`services/shared/models/alert.py`
   - 实现核心Pydantic模型
   - 编写单元测试

3. **选择第一个模块开发**:
   - 建议从M0.1 (Shared Models)开始
   - 完成后再开发M0.2 (Shared Database)
   - 依此类推

### 开发建议

- **严格遵循规范**: 参考 `/standards/` 中的所有开发规范
- **增量开发**: 每个模块完成后立即测试
- **代码审查**: 每个Phase完成后进行代码审查
- **文档更新**: 及时更新API文档和架构文档
- **持续集成**: 设置GitHub Actions自动化测试

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
**维护者**: 开发团队
