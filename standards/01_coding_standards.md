# 开发规范

**版本**: v1.0
**日期**: 2025-01-05
**适用范围**: 所有开发人员

---

## 1. 代码风格规范

### 1.1 Python代码规范 (PEP 8)

#### 基本规则

```python
# ✓ 正确
from typing import List, Dict, Optional, Any
import asyncio
from datetime import datetime

class AlertService:
    """Alert service class"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.logger = get_logger(__name__)

    async def process_alert(self, alert_id: str) -> Optional[Dict]:
        """
        Process alert by ID

        Args:
            alert_id: Alert identifier

        Returns:
            Processing result or None

        Raises:
            AlertNotFoundError: If alert not found
        """
        if not alert_id:
            raise ValueError("alert_id is required")

        # Implementation
        result = await self._fetch_alert(alert_id)
        return result

    async def _fetch_alert(self, alert_id: str) -> Dict:
        """Private method with underscore prefix"""
        # Implementation
        pass
```

#### 命名约定

```python
# 模块名: 小写，下划线分隔
alert_service.py
threat_intel_aggregator.py

# 类名: 大驼峰
class AlertProcessor:
    pass

# 函数/方法名: 小写，下划线分隔
def process_alert():
    pass

async def fetch_alert_data():
    pass

# 常量: 大写，下划线分隔
MAX_RETRY_COUNT = 3
DEFAULT_TIMEOUT = 30

# 私有成员: 前缀下划线
self._internal_method()
self._private_var

# 变量: 小写，下划线分隔
alert_count = 0
is_processed = True
```

#### 类型注解

```python
# ✓ 推荐: 完整类型注解
from typing import List, Dict, Optional, Union

def get_alerts(
    limit: int = 100,
    offset: int = 0,
    status: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get alerts with pagination"""
    pass

# 异步函数
async def process_alert_async(alert: Dict) -> Dict:
    """Process alert asynchronously"""
    pass

# 复杂类型使用TypeAlias
from typing import TypeAlias

AlertId: TypeAlias = str
RiskScore: TypeAlias = float

def calculate_risk(alert_id: AlertId) -> RiskScore:
    pass
```

#### 文档字符串

```python
# Google风格文档字符串
def process_alert(
    alert_id: str,
    priority: int = 5
) -> Dict[str, Any]:
    """
    Process a security alert with given priority.

    This method performs the following steps:
    1. Validate alert_id format
    2. Fetch alert from database
    3. Enrich with context
    4. Calculate risk score
    5. Generate remediation

    Args:
        alert_id: Unique alert identifier (e.g., "ALT-2025-001")
        priority: Processing priority (1-10, lower is higher priority).
            Defaults to 5.

    Returns:
        A dictionary containing:
            - 'alert_id': Processed alert ID
            - 'risk_score': Calculated risk score (0-100)
            - 'status': Processing status ('success' or 'failed')

    Raises:
        ValueError: If alert_id is empty or invalid format
        AlertNotFoundError: If alert does not exist in database
        ProcessingError: If enrichment or risk calculation fails

    Example:
        >>> result = process_alert("ALT-2025-001", priority=3)
        >>> print(result['risk_score'])
        75.5
    """
    pass
```

### 1.2 代码组织

#### 文件结构

```python
# ✓ 正确的导入顺序
# 1. 标准库
import asyncio
from datetime import datetime
from typing import List, Dict, Optional

# 2. 第三方库
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

# 3. 本地模块
from shared.models.alert import Alert
from shared.database.repositories import AlertRepository
from shared.utils.logger import get_logger

# 常量定义
MAX_RETRY_COUNT = 3
DEFAULT_TIMEOUT = 30

# 类和函数定义
class AlertService:
    pass

def helper_function():
    pass

# if __name__ 主程序
if __name__ == "__main__":
    pass
```

#### 项目结构

```
service_name/
├── __init__.py              # 包初始化
├── main.py                  # 服务入口
├── config.py                # 配置管理
├── models/
│   ├── __init__.py
│   ├── alert.py             # 数据模型
│   └── schemas.py           # API Schema
├── services/
│   ├── __init__.py
│   ├── alert_service.py     # 业务逻辑
│   └── notification_service.py
├── repositories/
│   ├── __init__.py
│   └── alert_repository.py  # 数据访问
├── api/
│   ├── __init__.py
│   └── v1/
│       ├── __init__.py
│       └── endpoints.py     # API端点
├── utils/
│   ├── __init__.py
│   ├── logger.py
│   └── helpers.py
└── tests/
    ├── __init__.py
    ├── unit/
    └── integration/
```

---

## 2. 异步编程规范

### 2.1 异步函数定义

```python
# ✓ 正确: 所有IO操作使用async/await
async def fetch_alert_from_db(alert_id: str) -> Dict:
    """异步从数据库获取告警"""
    query = "SELECT * FROM alerts WHERE alert_id = $1"
    result = await db.fetch_one(query, alert_id)
    return dict(result)

# ✓ 正确: 并发执行多个异步任务
async def process_alert_with_context(alert_id: str):
    """并发获取多个上下文"""
    # 并发执行
    results = await asyncio.gather(
        fetch_network_context(alert_id),
        fetch_asset_context(alert_id),
        fetch_user_context(alert_id),
        return_exceptions=True  # 捕获异常
    )

    network_ctx, asset_ctx, user_ctx = results

    # 处理异常
    if isinstance(network_ctx, Exception):
        network_ctx = {}

    return {
        "network": network_ctx,
        "asset": asset_ctx,
        "user": user_ctx
    }
```

### 2.2 异步上下文管理器

```python
# ✓ 正确: 使用异步上下文管理器
async def process_with_database(alert_id: str):
    """使用异步数据库连接"""
    async with get_db_session() as session:
        result = await session.execute(
            select(Alert).where(Alert.alert_id == alert_id)
        )
        return result.scalar_one_or_none()
```

### 2.3 错误处理

```python
# ✓ 正确: 完善的异步错误处理
async def safe_process_alert(alert_id: str) -> Dict:
    """安全处理告警，捕获所有异常"""
    try:
        result = await process_alert(alert_id)
        return {"status": "success", "data": result}
    except ValueError as e:
        logger.error(f"Invalid input: {e}")
        return {"status": "error", "message": str(e)}
    except Exception as e:
        logger.exception(f"Unexpected error processing alert {alert_id}")
        return {"status": "error", "message": "Internal error"}
    finally:
        # 清理资源
        await cleanup_resources()
```

---

## 3. 错误处理规范

### 3.1 异常定义

```python
# 自定义异常基类
class SecurityTriageError(Exception):
    """Base exception for security triage system"""

    def __init__(self, message: str, code: str = None):
        self.message = message
        self.code = code
        super().__init__(self.message)

# 具体异常类
class AlertNotFoundError(SecurityTriageError):
    """Raised when alert is not found"""

    def __init__(self, alert_id: str):
        self.alert_id = alert_id
        super().__init__(
            f"Alert not found: {alert_id}",
            code="ALERT_NOT_FOUND"
        )

class ThreatIntelError(SecurityTriageError):
    """Raised when threat intelligence query fails"""
    pass

class ValidationError(SecurityTriageError):
    """Raised when input validation fails"""
    pass
```

### 3.2 异常处理模式

```python
# ✓ 正确: 分层异常处理
async def process_alert(alert_id: str):
    try:
        # 业务逻辑
        alert = await fetch_alert(alert_id)
        if not alert:
            raise AlertNotFoundError(alert_id)

        result = await analyze_alert(alert)
        return result

    except AlertNotFoundError:
        # 已知异常，记录并重新抛出
        logger.warning(f"Alert not found: {alert_id}")
        raise

    except ThreatIntelError as e:
        # 可恢复异常，使用降级策略
        logger.error(f"Threat intel error: {e}, using fallback")
        return await analyze_with_fallback(alert)

    except Exception as e:
        # 未知异常，记录完整堆栈
        logger.exception(f"Unexpected error processing alert {alert_id}")
        raise ProcessingError(f"Failed to process alert: {str(e)}") from e
```

---

## 4. 日志规范

### 4.1 日志级别使用

```python
from shared.utils.logger import get_logger

logger = get_logger(__name__)

# DEBUG: 详细的调试信息
logger.debug(f"Processing alert with context: {context}")

# INFO: 一般信息
logger.info(f"Alert {alert_id} processed successfully")

# WARNING: 警告信息（不影响功能）
logger.warning(f"Cache miss for IOC: {ioc}, querying API")

# ERROR: 错误信息（影响功能但不崩溃）
logger.error(f"Failed to fetch threat intel: {str(e)}")

# CRITICAL: 严重错误（可能导致服务不可用）
logger.critical(f"Database connection lost: {str(e)}")
```

### 4.2 结构化日志

```python
# ✓ 正确: 使用结构化日志
logger.info(
    "Alert processing completed",
    extra={
        "alert_id": alert_id,
        "risk_score": result["risk_score"],
        "processing_time_ms": processing_time,
        "user_id": user_id
    }
)

# 输出JSON格式
{
    "timestamp": "2025-01-05T12:00:00Z",
    "level": "INFO",
    "logger": "services.alert_service",
    "message": "Alert processing completed",
    "alert_id": "ALT-001",
    "risk_score": 75.5,
    "processing_time_ms": 234,
    "user_id": "user@example.com"
}
```

### 4.3 敏感信息处理

```python
# ✓ 正确: 脱敏处理敏感信息
logger.info(f"User login successful", extra={
    "user_id": hash_email(user.email),  # 脱敏
    "ip_address": mask_ip(request.remote_addr),
    "user_agent": request.headers.get("user-agent")
})

def mask_ip(ip: str) -> str:
    """掩码IP地址"""
    parts = ip.split(".")
    return f"{parts[0]}.{parts[1]}.***.***"
```

---

## 5. 配置管理规范

### 5.1 配置文件结构

```python
# config.py
from typing import Dict, Any
import os
from pydantic import BaseSettings

class Settings(BaseSettings):
    """应用配置"""

    # 应用信息
    app_name: str = "Security Alert Triage"
    app_version: str = "1.0.0"
    debug: bool = False

    # 服务器配置
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 4

    # 数据库配置
    database_url: str
    db_pool_size: int = 20
    db_max_overflow: int = 40

    # Redis配置
    redis_url: str
    redis_pool_size: int = 10

    # RabbitMQ配置
    rabbitmq_url: str

    # 私有化MaaS配置
    deepseek_base_url: str
    deepseek_api_key: str
    qwen_base_url: str
    qwen_api_key: str

    # 日志配置
    log_level: str = "INFO"
    log_file: str = "/var/log/triage/app.log"

    # 监控配置
    enable_metrics: bool = True
    metrics_port: int = 9090

    class Config:
        env_file = ".env"
        case_sensitive = False

# 全局配置实例
settings = Settings()
```

### 5.2 环境变量

```bash
# .env.example
APP_NAME=security-triage
APP_VERSION=1.0.0
DEBUG=false

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/triage
DB_POOL_SIZE=20

# Redis
REDIS_URL=redis://localhost:6379/0

# RabbitMQ
RABBITMQ_URL=amqp://admin:password@localhost:5672/

# MaaS
DEEPSEEK_BASE_URL=http://internal-maas.deepseek/v1
DEEPSEEK_API_KEY=internal-key-123
QWEN_BASE_URL=http://internal-maas.qwen/v1
QWEN_API_KEY=internal-key-456

# Logging
LOG_LEVEL=INFO
LOG_FILE=/var/log/triage/app.log
```

---

## 6. 测试规范

### 6.1 单元测试

```python
# tests/unit/test_alert_service.py
import pytest
from unittest.mock import AsyncMock, patch
from services.alert_service import AlertService

class TestAlertService:
    """Alert service unit tests"""

    @pytest.fixture
    def service(self):
        """Create service instance"""
        config = {"database_url": "sqlite:///:memory:"}
        return AlertService(config)

    @pytest.mark.asyncio
    async def test_process_alert_success(self, service):
        """Test successful alert processing"""
        # Arrange
        alert_id = "ALT-001"
        mock_result = {"alert_id": alert_id, "risk_score": 75.5}

        with patch.object(
            service,
            "_fetch_alert",
            new=AsyncMock(return_value=mock_result)
        ):
            # Act
            result = await service.process_alert(alert_id)

            # Assert
            assert result["alert_id"] == alert_id
            assert result["risk_score"] == 75.5

    @pytest.mark.asyncio
    async def test_process_alert_not_found(self, service):
        """Test alert not found error"""
        # Arrange
        alert_id = "INVALID"

        with patch.object(
            service,
            "_fetch_alert",
            new=AsyncMock(return_value=None)
        ):
            # Act & Assert
            with pytest.raises(AlertNotFoundError):
                await service.process_alert(alert_id)
```

### 6.2 集成测试

```python
# tests/integration/test_alert_flow.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_alert_processing_flow():
    """Test complete alert processing flow"""

    async with AsyncClient(app=app, base_url="http://test") as client:

        # 1. Submit alert
        response = await client.post(
            "/api/v1/alerts",
            json={
                "alert_id": "TEST-001",
                "alert_type": "malware",
                "severity": "high",
                "source_ip": "45.33.32.156"
            }
        )
        assert response.status_code == 201
        data = response.json()
        ingestion_id = data["ingestion_id"]

        # 2. Wait for processing
        await asyncio.sleep(5)

        # 3. Get result
        response = await client.get(f"/api/v1/alerts/TEST-001")
        assert response.status_code == 200
        result = response.json()["data"]

        # 4. Verify results
        assert result["risk_assessment"]["risk_score"] > 0
        assert result["triage_result"] is not None
```

### 6.3 测试命名约定

```python
# ✓ 正确的测试命名
class TestAlertService:
    def test_process_alert_success(self):
        """Test successful processing"""
        pass

    def test_process_alert_not_found_error(self):
        """Test alert not found error handling"""
        pass

    def test_process_alert_with_invalid_input_raises_error(self):
        """Test error with invalid input"""
        pass

# 异步测试
@pytest.mark.asyncio
async def test_async_function():
    """Test async function"""
    pass

# 参数化测试
@pytest.mark.parametrize("severity,expected_risk", [
    ("critical", 90),
    ("high", 70),
    ("medium", 40),
])
def test_risk_calculation(severity, expected_risk):
    """Test risk score calculation"""
    pass
```

---

## 7. 文档规范

### 7.1 代码注释

```python
# ✓ 单行注释: 解释为什么，而不是做什么
# Using exponential backoff to avoid overwhelming the API
retry_delay = 2 ** attempt

# ✓ 块注释: 复杂逻辑说明
"""
Risk score calculation algorithm:

1. Normalize severity to 0-10 scale
2. Apply threat intelligence multiplier
3. Adjust for asset criticality
4. Final score = weighted sum of all components

See: https://docs.example.com/risk-scoring
"""
risk_score = (
    severity_score * 0.3 +
    threat_score * 0.3 +
    asset_score * 0.2 +
    exploit_score * 0.2
)
```

### 7.2 README

```markdown
# Service Name

Brief description of the service.

## Features

- Feature 1
- Feature 2

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```python
from service import process_alert

result = process_alert("ALT-001")
```

## Development

```bash
# Run tests
pytest

# Run linting
black .
isort .

# Type checking
mypy service
```

## Configuration

See `.env.example` for configuration options.
```

---

## 8. 代码审查清单

### 8.1 提交前检查

- [ ] 代码符合PEP 8规范
- [ ] 所有函数有类型注解
- [ ] 所有公共方法有文档字符串
- [ ] 异常处理完善
- [ ] 日志记录适当
- [ ] 单元测试覆盖率 > 80%
- [ ] 无硬编码配置
- [ ] 无敏感信息泄露
- [ ] 通过所有测试
- [ ] 文档已更新

### 8.2 代码审查要点

**功能性**:
- 是否实现了需求？
- 边界情况是否处理？
- 错误处理是否完善？

**性能**:
- 是否有不必要的循环？
- 是否使用了缓存？
- 数据库查询是否优化？

**安全性**:
- 输入是否验证？
- SQL注入风险？
- 敏感信息是否脱敏？

**可维护性**:
- 代码是否清晰易懂？
- 是否过度设计？
- 命名是否准确？

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
