# 安全规范

**版本**: v1.0
**日期**: 2025-01-05
**适用范围**: 所有开发、运维人员

---

## 1. 数据安全规范

### 1.1 敏感数据分类

```
┌────────────────────────────────────────────────────────────────────┐
│  数据分类标准                                                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  🔴 敏感数据 (Classified)                                            │
│     • 用户凭证 (密码、API Key、Token)                               │
│     • 个人身份信息 (PII): 身份证号、手机号、家庭住址                   │
│     • 告警详细内容 (包含漏洞详情、攻击路径)                            │
│     • 威胁情报源配置 (包含API Key)                                    │
│     • 系统架构信息 (网络拓扑、内部IP范围)                             │
│                                                                      │
│  🟡 内部数据 (Internal)                                               │
│     • 告警统计数据                                                 │
│     • 性能指标                                                     │
│     • 系统配置 (非敏感部分)                                          │
│     • 用户行为分析数据                                             │
│                                                                      │
│  🟢 公开数据 (Public)                                                │
│     • 产品功能介绍                                                 │
│     • 使用文档                                                     │
│     • API文档 (公开部分)                                            │
│                                                                      │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 数据加密规范

#### 传输加密

```python
# ✓ 正确: 强制使用HTTPS
from fastapi import Request, Response

@app.middleware("http")
async def enforce_https(request: Request, call_next):
    """强制HTTPS"""

    # 检查X-Forwarded-Proto头 (反向代理)
    proto = request.headers.get("x-forwarded-proto", "http")

    if proto == "http" and not request.url.path.startswith("/health"):
        # 重定向到HTTPS
        url = request.url.replace(scheme="https")
        return Response(
            status_code=307,
            headers={"location": str(url)}
        )

    return await call_next(request)
```

#### 存储加密

```python
from cryptography.fernet import Fernet
import os

# 加密密钥 (从环境变量获取)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("ENCRYPTION_KEY environment variable must be set")

fernet = Fernet(ENCRYPTION_KEY.encode())

def encrypt_sensitive_data(data: str) -> str:
    """加密敏感数据"""
    encrypted = fernet.encrypt(data.encode())
    return encrypted.decode()

def decrypt_sensitive_data(encrypted_data: str) -> str:
    """解密敏感数据"""
    decrypted = fernet.decrypt(encrypted_data.encode())
    return decrypted.decode()

# 使用示例
# 存储时加密
encrypted_api_key = encrypt_sensitive_data(api_key)

# 读取时解密
api_key = decrypt_sensitive_data(encrypted_api_key)
```

#### 字段级加密

```python
from sqlalchemy import TypeDecorator, String
from cryptography.fernet import Fernet

class EncryptedString(TypeDecorator):
    """加密字符串类型"""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """加密后存入数据库"""
        if value is None:
            return value
        return encrypt_sensitive_data(value)

    def process_result_value(self, value, dialect):
        """从数据库读取后解密"""
        if value is None:
            return value
        return decrypt_sensitive_data(value)

# 在模型中使用
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, nullable=False)

    # 加密存储敏感字段
    api_key = Column(EncryptedString)
    secret_token = Column(EncryptedString)
```

### 1.3 数据脱敏规范

```python
import re

def mask_email(email: str) -> str:
    """脱敏邮箱地址"""
    if "@" not in email:
        return email

    local, domain = email.split("@")
    # 保留前2个字符
    masked_local = local[:2] + "***"
    return f"{masked_local}@{domain}"

def mask_ip(ip: str) -> str:
    """脱敏IP地址"""
    parts = ip.split(".")
    return f"{parts[0]}.{parts[1]}.***.***"

def mask_credit_card(card: str) -> str:
    """脱敏信用卡号"""
    return card[:4] + "*" * 8 + card[-4:]

def mask_sensitive_value(value: str, value_type: str) -> str:
    """根据类型脱敏"""
    masks = {
        "email": mask_email,
        "ip": mask_ip,
        "credit_card": mask_credit_card,
        "phone": lambda x: x[:3] + "*" * 4 + x[-4:],
    }

    mask_func = masks.get(value_type, lambda x: "***")
    return mask_func(value)

# 日志中使用
logger.info(f"User login", extra={
    "email": mask_email(user.email),  # 脱敏
    "ip": mask_ip(request.remote_addr),
    "user_id": user.id  # ID不需要脱敏
})
```

---

## 2. 认证授权规范

### 2.1 密码策略

```python
from passlib.context import CryptContext
import re

# 密码哈希
pwd_context = CryptContext(
    schemes=["bcrypt"],  # 使用bcrypt
    deprecated="auto"
)

def hash_password(password: str) -> str:
    """哈希密码"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)

# 密码强度验证
def validate_password_strength(password: str) -> tuple[bool, list[str]]:
    """
    验证密码强度

    要求:
    - 最少12个字符
    - 包含大小写字母
    - 包含数字
    - 包含特殊字符
    """

    errors = []

    if len(password) < 12:
        errors.append("Password must be at least 12 characters")

    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter")

    if not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter")

    if not re.search(r"\d", password):
        errors.append("Password must contain at least one digit")

    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        errors.append("Password must contain at least one special character")

    return len(errors) == 0, errors
```

### 2.2 JWT Token规范

```python
from datetime import datetime, timedelta
import jwt
from typing import Dict, Any

class TokenManager:
    """JWT Token管理器"""

    def __init__(self, secret_key: str):
        self.secret_key = secret_key
        self.algorithm = "HS256"

    def create_access_token(
        self,
        user_id: str,
        permissions: list,
        expires_delta: timedelta = None
    ) -> str:
        """创建访问令牌"""

        if expires_delta is None:
            expires_delta = timedelta(hours=1)

        payload = {
            "sub": user_id,
            "type": "access",
            "permissions": permissions,
            "exp": datetime.utcnow() + expires_delta,
            "iat": datetime.utcnow(),
            "jti": str(uuid.uuid4())  # Token ID
        }

        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def create_refresh_token(self, user_id: str) -> str:
        """创建刷新令牌"""

        payload = {
            "sub": user_id,
            "type": "refresh",
            "exp": datetime.utcnow() + timedelta(days=7),
            "iat": datetime.utcnow(),
            "jti": str(uuid.uuid4())
        }

        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def decode_token(self, token: str) -> Dict[str, Any]:
        """解码并验证令牌"""

        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=[self.algorithm]
            )
            return payload
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("Token has expired")
        except jwt.InvalidTokenError:
            raise AuthenticationError("Invalid token")
```

### 2.3 MFA (多因素认证)

```python
import pyotp

class MFAService:
    """多因素认证服务"""

    @staticmethod
    def generate_secret() -> str:
        """生成MFA密钥"""
        return pyotp.random_base32()

    @staticmethod
    def generate_qr_code(secret: str, email: str) -> str:
        """生成QR码"""
        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(
            name=email,
            issuer_name="Security Triage"
        )
        return provisioning_uri

    @staticmethod
    def verify_code(secret: str, code: str) -> bool:
        """验证MFA码"""
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)  # 允许时间窗口误差
```

---

## 3. 权限控制规范

### 3.1 RBAC模型

```python
from enum import Enum
from typing import List

class Permission(str, Enum):
    """权限定义"""

    # 告警权限
    ALERT_READ = "alerts:read"
    ALERT_WRITE = "alerts:write"
    ALERT_DELETE = "alerts:delete"
    ALERT_ASSIGN = "alerts:assign"

    # 事件权限
    INCIDENT_READ = "incidents:read"
    INCIDENT_WRITE = "incidents:write"
    INCIDENT_DELETE = "incidents:delete"

    # 系统权限
    USERS_MANAGE = "users:manage"
    CONFIG_MANAGE = "config:manage"
    AUDIT_LOGS_READ = "audit_logs:read"

class Role(str, Enum):
    """角色定义"""

    ADMIN = "admin"
    SUPERVISOR = "supervisor"
    ANALYST = "analyst"
    VIEWER = "viewer"
    AUDITOR = "auditor"

# 角色权限映射
ROLE_PERMISSIONS: dict[Role, List[Permission]] = {
    Role.ADMIN: [
        Permission.ALERT_READ,
        Permission.ALERT_WRITE,
        Permission.ALERT_DELETE,
        Permission.ALERT_ASSIGN,
        Permission.INCIDENT_READ,
        Permission.INCIDENT_WRITE,
        Permission.INCIDENT_DELETE,
        Permission.USERS_MANAGE,
        Permission.CONFIG_MANAGE,
        Permission.AUDIT_LOGS_READ,
    ],

    Role.SUPERVISOR: [
        Permission.ALERT_READ,
        Permission.ALERT_WRITE,
        Permission.ALERT_ASSIGN,
        Permission.INCIDENT_READ,
        Permission.INCIDENT_WRITE,
        Permission.USERS_MANAGE,
    ],

    Role.ANALYST: [
        Permission.ALERT_READ,
        Permission.ALERT_WRITE,
        Permission.INCIDENT_READ,
    ],

    Role.VIEWER: [
        Permission.ALERT_READ,
        Permission.INCIDENT_READ,
    ],

    Role.AUDITOR: [
        Permission.AUDIT_LOGS_READ,
        Permission.ALERT_READ,
        Permission.INCIDENT_READ,
    ],
}

def has_permission(user: User, required_permission: Permission) -> bool:
    """检查用户是否具有权限"""
    user_permissions = ROLE_PERMISSIONS.get(Role(user.role), [])
    return required_permission in user_permissions
```

### 3.2 权限检查装饰器

```python
from functools import wraps
from fastapi import HTTPException, Depends

def require_permission(permission: Permission):
    """权限检查装饰器"""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, current_user: User = Depends(get_current_user), **kwargs):
            if not has_permission(current_user, permission):
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "INSUFFICIENT_PERMISSIONS",
                        "required_permission": permission.value,
                        "user_role": current_user.role
                    }
                )
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator

# 使用示例
@app.delete("/api/v1/alerts/{alert_id}")
@require_permission(Permission.ALERT_DELETE)
async def delete_alert(alert_id: str, current_user: User = Depends(get_current_user)):
    """删除告警 (需要删除权限)"""
    pass
```

---

## 4. API安全规范

### 4.1 输入验证

```python
from pydantic import BaseModel, Field, validator
import html

class SafeBaseModel(BaseModel):
    """安全的基础模型"""

    @validator("*", pre=True)
    def sanitize_strings(cls, v):
        """清理所有字符串输入"""
        if isinstance(v, str):
            # 移除危险字符
            v = html.escape(v)
            # 移除SQL注入模式
            dangerous_patterns = [
                r"(';--|';|'\\|'OR|'AND|'XOR)",
                r"\b(DROP|DELETE|INSERT|UPDATE|EXEC|UNION)\s",
                r"<script[^>]*>.*?</script>",
            ]
            for pattern in dangerous_patterns:
                v = re.sub(pattern, "", v, flags=re.IGNORECASE)
        return v

class AlertCreate(SafeBaseModel):
    """安全的告警创建模型"""

    alert_id: str = Field(
        ...,
        min_length=1,
        max_length=100,
        # 只允许字母数字和连字符
        pattern=r"^[A-Za-z0-9\-]+$"
    )

    source_ip: str = Field(
        ...,
        # IP地址格式验证
        pattern=r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"
    )

    description: str = Field(
        ...,
        min_length=1,
        max_length=1000
        # 长度限制
    )

    @validator("description")
    def sanitize_description(cls, v):
        """清理描述字段"""
        # 移除潜在的XSS载荷
        if "<script>" in v.lower():
            raise ValueError("Invalid characters in description")
        return v
```

### 4.2 速率限制

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

limiter = Limiter(key_func=get_remote_address)

# 全局限流
@app.post("/api/v1/alerts")
@limiter.limit("100/minute")  # 每分钟100次
async def create_alert(request: Request):
    """创建告警（限流）"""
    pass

# 用户级别限流
@app.post("/api/v1/alerts")
@limiter.limit("1000/minute", key_func=lambda r: r.state.user.id)
async def create_alert(request: Request):
    """每个用户每分钟1000次"""
    pass

# IP级别限流
@app.post("/api/v1/alerts")
@limiter.limit("10/second", key_func=get_remote_address)
async def create_alert(request: Request):
    """每个IP每秒10次"""
    pass
```

### 4.3 SQL注入防护

```python
# ✓ 正确: 使用参数化查询
from sqlalchemy import text

async def get_alert_by_id(session: AsyncSession, alert_id: str):
    """参数化查询，防止SQL注入"""

    # 方法1: 使用ORM (推荐)
    result = await session.execute(
        select(Alert).where(Alert.alert_id == alert_id)
    )

    # 方法2: 使用text() + 参数
    query = text("SELECT * FROM alerts WHERE alert_id = :alert_id")
    result = await session.execute(query, {"alert_id": alert_id})

    return result.scalar_one_or_none()

# ✗ 错误: 字符串拼接
async def get_alert_bad(session: AsyncSession, alert_id: str):
    """❌ SQL注入风险!"""

    query = f"SELECT * FROM alerts WHERE alert_id = '{alert_id}'"
    result = await session.execute(query)  # 危险!
    return result.scalar_one_or_none()
```

---

## 5. 审计日志规范

### 5.1 审计事件定义

```python
from enum import Enum

class AuditEventType(str, Enum):
    """审计事件类型"""

    # 认证事件
    LOGIN = "auth.login"
    LOGOUT = "auth.logout"
    LOGIN_FAILED = "auth.login_failed"
    MFA_ENABLED = "auth.mfa_enabled"
    MFA_DISABLED = "auth.mfa_disabled"

    # 授权事件
    PERMISSION_GRANTED = "auth.permission_granted"
    PERMISSION_DENIED = "auth.permission_denied"
    ROLE_CHANGED = "auth.role_changed"

    # 数据访问事件
    DATA_ACCESSED = "data.accessed"
    DATA_EXPORTED = "data.exported"
    SENSITIVE_DATA_ACCESSED = "data.sensitive_accessed"

    # 数据变更事件
    ALERT_CREATED = "alert.created"
    ALERT_UPDATED = "alert.updated"
    ALERT_DELETED = "alert.deleted"
    ALERT_STATUS_CHANGED = "alert.status_changed"

    # 配置变更事件
    CONFIG_UPDATED = "config.updated"
    CONFIG_RELOADED = "config.reloaded"

    # 系统事件
    SERVICE_STARTED = "system.service_started"
    SERVICE_STOPPED = "system.service_stopped"
    ERROR_OCCURRED = "system.error"
```

### 5.2 审计日志记录

```python
from shared.utils.logger import get_audit_logger

audit_logger = get_audit_logger()

async def log_audit_event(
    event_type: AuditEventType,
    user_id: str,
    resource_type: str,
    resource_id: str,
    details: dict = None,
    ip_address: str = None,
    user_agent: str = None,
    success: bool = True,
    error_message: str = None
):
    """记录审计事件"""

    audit_log = {
        "timestamp": datetime.utcnow().isoformat(),
        "event_type": event_type.value,
        "user_id": user_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "details": details or {},
        "ip_address": ip_address,
        "user_agent": user_agent,
        "success": success,
        "error_message": error_message
    }

    audit_logger.info("AUDIT_EVENT", extra=audit_log)

    # 同时写入数据库审计日志表
    await save_audit_log_to_db(audit_log)

# 使用示例
await log_audit_event(
    event_type=AuditEventType.ALERT_DELETED,
    user_id=current_user.id,
    resource_type="alert",
    resource_id=alert_id,
    details={
        "old_status": alert.status,
        "severity": alert.severity
    },
    ip_address=request.remote_addr,
    user_agent=request.headers.get("user-agent"),
    success=True
)
```

### 5.3 审计日志查询

```python
from sqlalchemy import select, and_

async def query_audit_logs(
    session: AsyncSession,
    user_id: str = None,
    event_type: AuditEventType = None,
    start_date: datetime = None,
    end_date: datetime = None,
    limit: int = 100
) -> list[AuditLog]:
    """查询审计日志"""

    query = select(AuditLog)

    # 构建过滤条件
    conditions = []

    if user_id:
        conditions.append(AuditLog.user_id == user_id)

    if event_type:
        conditions.append(AuditLog.event_type == event_type.value)

    if start_date:
        conditions.append(AuditLog.created_at >= start_date)

    if end_date:
        conditions.append(AuditLog.created_at <= end_date)

    if conditions:
        query = query.where(and_(*conditions))

    query = query.order_by(AuditLog.created_at.desc()).limit(limit)

    result = await session.execute(query)
    return result.scalars().all()
```

---

## 6. 网络安全规范

### 6.1 CORS配置

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    # 生产环境: 只允许可信域名
    allow_origins=[
        "https://security-triage.example.com",
        "https://triage-ui.example.com"
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Request-ID"
    ],
    expose_headers=["X-Request-ID"],
    max_age=3600,
)
```

### 6.2 安全头

```python
from fastapi import Response

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """添加安全响应头"""

    response = await call_next(request)

    # 安全头
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"

    return response
```

### 6.3 API网关安全

```python
# Kong网关安全配置示例
KONG_SECURITY_PLUGINS = {
    # 认证插件
    "jwt": {
        "key_claim_name": "sub",
        "secret_is_base64": False
    },

    # 速率限制
    "rate-limiting": {
        "minute": 100,
        "hour": 1000,
        "policy": "local"
    },

    # IP白名单
    "ip-restriction": {
        "whitelist": [
            "10.0.0.0/8",  # 内网
            "192.168.0.0/16"  # VPN
        ]
    },

    # 请求大小限制
    "request-size-limiting": {
        "allowed_payload_size": 10  # MB
    },

    # 响应限流
    "response-ratelimiting": {
        "limit": 100,
        "window_size": 60,
        "policy": "local"
    }
}
```

---

## 7. 密钥管理规范

### 7.1 密钥存储

```bash
# ✓ 正确: 使用环境变量或密钥管理服务
export DEEPSEEK_API_KEY="internal-key-123"
export QWEN_API_KEY="internal-key-456"
export DATABASE_PASSWORD="encrypted-password"

# ✗ 错误: 密钥硬编码在代码中
# API_KEY = "sk-1234567890abcdef"  # ❌ 危险!
```

### 7.2 密钥轮换

```python
import secrets
import string

def generate_api_key(length: int = 32) -> str:
    """生成安全的API密钥"""

    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def generate_secret_key(length: int = 64) -> str:
    """生成加密密钥"""

    return secrets.token_urlsafe(length)

# 定期轮换密钥
async def rotate_api_keys():
    """定期轮换API密钥"""

    old_key = os.getenv("DEEPSEEK_API_KEY")
    new_key = generate_api_key()

    # 更新配置
    # 1. 生成新密钥
    # 2. 更新服务配置
    # 3. 验证新密钥
    # 4. 废弃旧密钥
    pass
```

---

## 8. 安全检查清单

### 8.1 开发阶段

- [ ] 所有输入都经过验证和清理
- [ ] 使用参数化查询防止SQL注入
- [ ] 敏感数据加密存储
- [ ] 密码使用bcrypt哈希
- [ ] API密钥不硬编码
- [ ] 错误信息不泄露敏感信息
- [ ] 实施速率限制
- [ ] 启用CORS保护

### 8.2 部署阶段

- [ ] 强制HTTPS
- [ ] 启用安全头
- [ ] 配置防火墙规则
- [ ] 启用WAF (Web Application Firewall)
- [ ] 配置DDoS保护
- [ ] 启用审计日志
- [ ] 配置备份加密
- [ ] 实施网络隔离

### 8.3 运营阶段

- [ ] 定期更新依赖
- [ ] 定期安全扫描
- [ ] 定期渗透测试
- [ ] 监控异常访问
- [ ] 定期审计日志审查
- [ ] 定期密钥轮换
- [ ] 应急响应预案

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
