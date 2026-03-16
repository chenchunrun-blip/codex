# API接口规范

**版本**: v1.0
**日期**: 2025-01-05
**适用范围**: 所有API开发

---

## 1. RESTful API设计原则

### 1.1 URL设计规范

#### 基本规则

```
✓ 正确:
GET    /api/v1/alerts              # 获取告警列表
POST   /api/v1/alerts              # 创建告警
GET    /api/v1/alerts/{id}         # 获取单个告警
PATCH  /api/v1/alerts/{id}         # 更新告警
DELETE /api/v1/alerts/{id}         # 删除告警
GET    /api/v1/alerts/{id}/comments # 获取告警评论

✗ 错误:
GET    /api/v1/getAlerts           # 不要使用动词
GET    /api/v1/alert                # 复数形式
POST   /api/v1/alert               # 使用复数
GET    /api/v1/alert/{id}          # 使用复数
GET    /api/v1/alerts/{alertId}    # 使用snake_case
```

#### 查询参数规范

```
# 分页
GET /api/v1/alerts?page=1&page_size=20

# 过滤
GET /api/v1/alerts?status=new&severity=high

# 排序
GET /api/v1/alerts?sort_by=created_at&sort_order=desc

# 搜索
GET /api/v1/alerts?search=malware&search_fields=description,title

# 字段选择
GET /api/v1/alerts?fields=id,alert_id,severity,status

# 包含关联资源
GET /api/v1/alerts/{id}?include=context,threat_intel
```

### 1.2 HTTP方法使用

| 方法 | 用途 | 幂等性 | 示例 |
|------|------|--------|------|
| GET | 查询资源 | ✓ | GET /api/v1/alerts |
| POST | 创建资源 | ✗ | POST /api/v1/alerts |
| PATCH | 部分更新 | ✓ | PATCH /api/v1/alerts/{id} |
| PUT | 完整更新 | ✓ | PUT /api/v1/alerts/{id} |
| DELETE | 删除资源 | ✓ | DELETE /api/v1/alerts/{id} |
| OPTIONS | 查询支持的方法 | ✓ | OPTIONS /api/v1/alerts |

---

## 2. 请求格式规范

### 2.1 请求头

```http
# 必需请求头
Content-Type: application/json
Accept: application/json
Authorization: Bearer eyJhbGc...

# 可选请求头
X-Request-ID: uuid-unique-id
X-Client-Version: 1.0.0
X-Client-Name: security-triage-ui
```

### 2.2 请求体

#### 创建资源

```json
POST /api/v1/alerts
Content-Type: application/json

{
  "alert_id": "ALT-2025-001",
  "timestamp": "2025-01-05T12:00:00Z",
  "alert_type": "malware",
  "source_ip": "45.33.32.156",
  "target_ip": "10.0.0.50",
  "severity": "high",
  "description": "Malware detected",
  "file_hash": "5e884898...",
  "asset_id": "ASSET-001"
}
```

#### 更新资源

```json
PATCH /api/v1/alerts/ALT-2025-001
Content-Type: application/json

{
  "status": "in_progress",
  "assigned_to": "user@example.com",
  "comment": "开始调查"
}
```

#### 批量操作

```json
POST /api/v1/alerts/batch
Content-Type: application/json

{
  "operation": "update",
  "filters": {
    "severity": "high",
    "status": "new"
  },
  "updates": {
    "status": "assigned",
    "assigned_to": "security-team@example.com"
  }
}
```

### 2.3 请求验证

```python
from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime

class AlertCreate(BaseModel):
    """Alert creation request model"""

    alert_id: str = Field(..., min_length=1, max_length=100)
    timestamp: datetime
    alert_type: str = Field(..., regex="^(malware|phishing|brute_force|ddos|data_exfiltration|anomaly)$")
    source_ip: str = Field(..., regex="^^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$")
    target_ip: Optional[str] = Field(None, regex="^^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$")
    severity: str = Field(..., regex="^(critical|high|medium|low|info)$")
    description: str = Field(..., min_length=1, max_length=1000)
    file_hash: Optional[str] = None
    asset_id: Optional[str] = None
    user_id: Optional[str] = None

    @validator("timestamp")
    def validate_timestamp_not_future(cls, v):
        """Ensure timestamp is not in the future"""
        if v > datetime.utcnow():
            raise ValueError("Timestamp cannot be in the future")
        return v

    @validator("source_ip", "target_ip")
    def validate_ip_not_private(cls, v):
        """External IP should not be private"""
        if v and v.startswith(("10.", "192.168.", "172.16.")):
            raise ValueError("IP address should not be from private range")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "alert_id": "ALT-2025-001",
                "timestamp": "2025-01-05T12:00:00Z",
                "alert_type": "malware",
                "source_ip": "45.33.32.156",
                "severity": "high",
                "description": "Malware detected"
            }
        }
```

---

## 3. 响应格式规范

### 3.1 成功响应

#### 标准格式

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "alert_id": "ALT-2025-001",
    "status": "new",
    "created_at": "2025-01-05T12:00:00Z"
  },
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123",
    "version": "1.0.0"
  }
}
```

#### 列表响应

```json
{
  "success": true,
  "data": {
    "total": 1000,
    "page": 1,
    "page_size": 20,
    "total_pages": 50,
    "items": [
      {
        "id": "uuid-1",
        "alert_id": "ALT-001"
      },
      {
        "id": "uuid-2",
        "alert_id": "ALT-002"
      }
    ]
  },
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123"
  }
}
```

#### 创建响应

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "alert_id": "ALT-2025-001",
    "status": "queued",
    "message": "Alert successfully queued for processing"
  },
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123",
    "location": "/api/v1/alerts/ALT-2025-001"
  }
}
```

### 3.2 错误响应

#### 标准错误格式

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "field": "alert_id",
      "reason": "Field is required",
      "value": null
    }
  },
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123"
  }
}
```

#### 错误代码规范

```python
# 错误代码定义
ERROR_CODES = {
    # 通用错误 (1xxx)
    "VALIDATION_ERROR": (1001, "Validation failed"),
    "UNAUTHORIZED": (1002, "Authentication required"),
    "FORBIDDEN": (1003, "Access denied"),
    "NOT_FOUND": (1004, "Resource not found"),
    "CONFLICT": (1005, "Resource conflict"),
    "RATE_LIMIT_EXCEEDED": (1006, "Too many requests"),
    "INTERNAL_ERROR": (1007, "Internal server error"),

    # 业务错误 (2xxx)
    "ALERT_NOT_FOUND": (2001, "Alert not found"),
    "INVALID_ALERT_TYPE": (2002, "Invalid alert type"),
    "ALERT_ALREADY_PROCESSED": (2003, "Alert already processed"),
    "THREAT_INTEL_ERROR": (2004, "Threat intelligence query failed"),
    "ASSET_NOT_FOUND": (2005, "Asset not found"),

    # 服务错误 (3xxx)
    "DATABASE_ERROR": (3001, "Database operation failed"),
    "CACHE_ERROR": (3002, "Cache operation failed"),
    "MESSAGE_QUEUE_ERROR": (3003, "Message queue operation failed"),
    "LLM_API_ERROR": (3004, "LLM API call failed"),
}
```

#### 错误响应示例

```json
# 400 Bad Request - 验证错误
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "errors": [
        {
          "field": "severity",
          "message": "Invalid severity value",
          "allowed_values": ["critical", "high", "medium", "low", "info"]
        }
      ]
    }
  }
}

# 401 Unauthorized
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "details": {
      "www_authenticate": "Bearer"
    }
  }
}

# 403 Forbidden
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied",
    "details": {
      "required_permission": "alerts:write",
      "user_permissions": ["alerts:read"]
    }
  }
}

# 404 Not Found
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "details": {
      "resource_type": "alert",
      "resource_id": "ALT-999999"
    }
  }
}

# 429 Rate Limit Exceeded
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "details": {
      "limit": 100,
      "window": "60s",
      "retry_after": "30s"
    }
  }
}

# 500 Internal Server Error
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "details": {
      "request_id": "req_abc123",
      "support_contact": "support@example.com"
    }
  }
}
```

---

## 4. 状态码使用规范

### 4.1 成功状态码

| 状态码 | 说明 | 使用场景 |
|--------|------|----------|
| 200 OK | 请求成功 | GET, PATCH, DELETE |
| 201 Created | 创建成功 | POST |
| 204 No Content | 成功但无返回内容 | DELETE |
| 202 Accepted | 已接受，异步处理 | POST (长时间操作) |

### 4.2 客户端错误状态码

| 状态码 | 说明 | 使用场景 |
|--------|------|----------|
| 400 Bad Request | 请求参数错误 | 验证失败 |
| 401 Unauthorized | 未认证 | 缺少或无效token |
| 403 Forbidden | 无权限 | 权限不足 |
| 404 Not Found | 资源不存在 | 查询不到资源 |
| 409 Conflict | 资源冲突 | 资源已存在 |
| 422 Unprocessable Entity | 无法处理 | 业务逻辑错误 |
| 429 Too Many Requests | 超出限制 | 速率限制 |

### 4.3 服务端错误状态码

| 状态码 | 说明 | 使用场景 |
|--------|------|----------|
| 500 Internal Server Error | 服务器错误 | 未预期的错误 |
| 502 Bad Gateway | 网关错误 | 上游服务错误 |
| 503 Service Unavailable | 服务不可用 | 维护模式 |
| 504 Gateway Timeout | 网关超时 | 上游服务超时 |

---

## 5. 分页规范

### 5.1 分页参数

```python
from typing import Generic, TypeVar, List
from pydantic import BaseModel, Field

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response"""

    total: int = Field(..., description="Total number of items")
    page: int = Field(..., ge=1, description="Current page number")
    page_size: int = Field(..., ge=1, le=100, description="Items per page")
    total_pages: int = Field(..., description="Total number of pages")
    items: List[T] = Field(..., description="List of items")

    class Config:
        json_schema_extra = {
            "example": {
                "total": 1000,
                "page": 1,
                "page_size": 20,
                "total_pages": 50,
                "items": []
            }
        }
```

### 5.2 分页实现

```python
from fastapi import Query, params
from typing import Optional

@app.get("/api/v1/alerts")
async def get_alerts(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", regex="^(asc|desc)$"),
) -> PaginatedResponse[AlertSchema]:
    """Get paginated list of alerts"""

    # 计算偏移量
    offset = (page - 1) * page_size

    # 查询数据库
    total = await alert_repository.count()
    items = await alert_repository.find_many(
        skip=offset,
        limit=page_size,
        sort_by=sort_by,
        sort_order=sort_order
    )

    # 计算总页数
    total_pages = (total + page_size - 1) // page_size

    return PaginatedResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=[AlertSchema.model_validate(item) for item in items]
    )
```

---

## 6. 版本控制规范

### 6.1 API版本策略

```
# URL版本化 (推荐)
/api/v1/alerts
/api/v2/alerts

# 请求头版本化
GET /api/alerts
Accept: application/vnd.security-triage.v1+json

# 查询参数版本化
GET /api/alerts?version=1
```

### 6.2 版本兼容性

```python
# v1 API
@app.get("/api/v1/alerts")
async def get_alerts_v1():
    """V1 API - 返回基本字段"""
    pass

# v2 API (保持v1兼容)
@app.get("/api/v2/alerts")
async def get_alerts_v2():
    """V2 API - 返回扩展字段"""
    pass

# 废弃旧版本
@app.get("/api/v1/old-endpoint")
async def old_endpoint():
    """Deprecated: Use /api/v2/new-endpoint instead"""
    warnings.warn("This endpoint is deprecated", DeprecationWarning)
```

---

## 7. 速率限制规范

### 7.1 限制策略

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

limiter = Limiter(key_func=get_remote_address)

@app.post("/api/v1/alerts")
@limiter.limit("100/minute")  # 每分钟100次
async def create_alert(request: Request):
    """Create alert with rate limiting"""
    pass

@app.get("/api/v1/alerts/{alert_id}")
@limiter.limit("1000/minute")  # 每分钟1000次
async def get_alert(request: Request):
    """Get alert with rate limiting"""
    pass
```

### 7.2 分层限制

```python
# 全局限制
@limiter.limit("10000/minute")

# 用户级别限制
@limiter.limit("100/minute", key_func=lambda: request.state.user.id)

# IP级别限制
@limiter.limit("10/second", key_func=get_remote_address)
```

---

## 8. 认证授权规范

### 8.1 JWT Token格式

```json
# Header
{
  "alg": "HS256",
  "typ": "JWT"
}

# Payload
{
  "sub": "user@example.com",
  "user_id": "uuid",
  "role": "analyst",
  "permissions": ["alerts:read", "alerts:write"],
  "exp": 1704499200,
  "iat": 1704495600
}
```

### 8.2 认证流程

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> User:
    """Validate JWT token and return current user"""

    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")

        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        user = await user_repository.get(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )

        return user

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
```

### 8.3 权限检查

```python
from functools import wraps

def require_permission(permission: str):
    """Decorator to check user permission"""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, current_user: User = Depends(get_current_user), **kwargs):
            if permission not in current_user.permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: {permission} required"
                )
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator

# 使用
@app.delete("/api/v1/alerts/{alert_id}")
@require_permission("alerts:delete")
async def delete_alert(alert_id: str, current_user: User = Depends(get_current_user)):
    """Delete alert (requires delete permission)"""
    pass
```

---

## 9. OpenAPI文档规范

### 9.1 自动生成文档

```python
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

app = FastAPI(
    title="Security Alert Triage API",
    description="AI-powered security alert triage system",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="Security Alert Triage API",
        version="1.0.0",
        routes=app.routes,
    )

    # 自定义信息
    openapi_schema["info"]["x-logo"] = {
        "url": "https://example.com/logo.png",
        "altText": "Security Triage Logo"
    }

    openapi_schema["servers"] = [
        {"url": "https://api.security-triage.com/v1", "description": "Production"},
        {"url": "https://staging-api.security-triage.com/v1", "description": "Staging"},
        {"url": "http://localhost:8000/v1", "description": "Local"},
    ]

    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi
```

### 9.2 标注示例

```python
from fastapi import Query
from typing import List

@app.get(
    "/api/v1/alerts",
    summary="List alerts",
    description="Retrieve a paginated list of security alerts with filtering and sorting options",
    response_description="Paginated list of alerts",
    responses={
        200: {"description": "Success"},
        401: {"description": "Unauthorized"},
        429: {"description": "Rate limit exceeded"}
    },
    tags=["alerts"]
)
async def get_alerts(
    page: int = Query(1, ge=1, description="Page number", example=1),
    page_size: int = Query(20, ge=1, le=100, description="Items per page", example=20),
    status: str = Query(None, description="Filter by status", example="new"),
) -> PaginatedResponse[AlertSchema]:
    """
    Retrieve a paginated list of security alerts.

    ## Filtering
    - **status**: Filter by alert status (new, assigned, in_progress, resolved, closed)
    - **severity**: Filter by severity (critical, high, medium, low, info)

    ## Sorting
    - **sort_by**: Field to sort by (created_at, updated_at, risk_score)
    - **sort_order**: Sort direction (asc, desc)

    ## Example
    ```
    GET /api/v1/alerts?page=1&page_size=20&status=new&sort_by=created_at&sort_order=desc
    ```
    """
    pass
```

---

## 10. API安全最佳实践

### 10.1 输入验证

```python
from pydantic import BaseModel, Field, validator
import re

class AlertCreate(BaseModel):
    alert_id: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r'^[A-Za-z0-9\-]+$'
    )
    source_ip: str = Field(
        ...,
        pattern=r'^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$'
    )

    @validator("alert_id")
    def validate_alert_id(cls, v):
        # 防止SQL注入
        if any(char in v for char in ["'", ";", "--", "/*", "*/"]):
            raise ValueError("Invalid characters in alert_id")
        return v
```

### 10.2 输出过滤

```python
def remove_sensitive_data(alert: dict) -> dict:
    """Remove sensitive data before returning"""
    sensitive_fields = ["password", "api_key", "token", "secret"]

    for field in sensitive_fields:
        if field in alert:
            del alert[field]

    return alert
```

### 10.3 HTTPS强制

```python
from fastapi import Request, Response

@app.middleware("http")
async def https_redirect_middleware(request: Request, call_next):
    """Redirect HTTP to HTTPS"""
    if request.headers.get("x-forwarded-proto") == "http":
        url = request.url.replace("http://", "https://")
        return Response(status_code=307, headers={"location": str(url)})
    return await call_next(request)
```

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
