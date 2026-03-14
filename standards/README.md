# 开发规范索引

**版本**: v1.0
**日期**: 2025-01-05
**状态**: 规范完成

---

## 📚 规范文档导航

本文档集为安全告警研判系统提供完整的开发规范。

### 核心规范文档

| 文档 | 说明 | 优先级 |
|------|------|--------|
| **[01_coding_standards.md](./01_coding_standards.md)** | Python代码风格、项目结构、测试规范 | ⭐⭐⭐ |
| **[02_api_standards.md](./02_api_standards.md)** | RESTful API设计、请求/响应格式、错误处理 | ⭐⭐⭐ |
| **[03_architecture_standards.md](./03_architecture_standards.md)** | 微服务架构、数据库架构、部署规范 | ⭐⭐⭐ |
| **[04_security_standards.md](./04_security_standards.md)** | 数据安全、认证授权、审计日志 | ⭐⭐⭐ |

---

## 🎯 快速导航

### 新手入门 (必读)

1. **开发规范** ([01_coding_standards.md](./01_coding_standards.md))
   - 代码风格 (PEP 8)
   - 项目结构规范
   - 命名约定
   - 文档字符串

2. **接口规范** ([02_api_standards.md](./02_api_standards.md))
   - RESTful设计原则
   - 请求/响应格式
   - 错误处理标准
   - 分页规范

3. **安全规范** ([04_security_standards.md](./04_security_standards.md))
   - 敏感数据分类
   - 认证授权
   - 审计日志
   - 密钥管理

### 进阶参考

4. **架构规范** ([03_architecture_standards.md](./03_architecture_standards.md))
   - 微服务划分
   - 服务发现
   - 缓存策略
   - 监控追踪

---

## 🔑 核心要点总结

### 开发规范核心要点

```python
# ✅ 代码风格: PEP 8 + 类型注解
async def process_alert(alert_id: str, priority: int = 5) -> Dict[str, Any]:
    """处理告警 (带完整类型注解和文档字符串)"""
    pass

# ✅ 异常处理: 分层异常处理
try:
    result = await process_alert(alert_id)
except AlertNotFoundError:
    logger.warning(f"Alert not found: {alert_id}")
    raise
except Exception as e:
    logger.exception(f"Unexpected error")
    raise ProcessingError("Failed to process alert") from e

# ✅ 日志: 结构化日志
logger.info("Alert processed", extra={
    "alert_id": alert_id,
    "risk_score": result["risk_score"],
    "processing_time_ms": processing_time
})
```

### API规范核心要点

```json
// ✅ 成功响应格式
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123"
  }
}

// ✅ 错误响应格式
{
  "success": false,
  "error": {
    "code": "ALERT_NOT_FOUND",
    "message": "Alert not found",
    "details": { ... }
  },
  "meta": { ... }
}
```

### 安全规范核心要点

```
✅ 敏感数据处理:
   - 传输: HTTPS + TLS 1.3
   - 存储: AES-256加密
   - 日志: 脱敏处理

✅ 认证授权:
   - JWT Token认证
   - RBAC权限模型
   - MFA多因素认证

✅ 审计日志:
   - 完整的操作日志
   - 不可篡改
   - 定期审计
```

---

## 📋 使用指南

### 开发前必读

**1. 环境准备**
```bash
# 安装开发工具
pip install black isort mypy pylint

# 安装pre-commit钩子
pre-commit install
```

**2. 代码检查**
```bash
# 代码格式化
black services/
isort services/

# 类型检查
mypy services/

# 代码质量检查
pylint services/
```

**3. 运行测试**
```bash
# 单元测试
pytest tests/unit/

# 集成测试
pytest tests/integration/

# 覆盖率检查
pytest --cov=services --cov-report=html
```

### API开发流程

**1. 设计API** (参考API规范)
- 定义URL路径
- 定义请求/响应格式
- 定义错误代码

**2. 实现API**
```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter()

class AlertCreate(BaseModel):
    """遵循Pydantic验证"""
    alert_id: str
    severity: str

@router.post("/api/v1/alerts")
async def create_alert(
    alert: AlertCreate,
    current_user: User = Depends(get_current_user)
):
    """实现业务逻辑"""
    pass
```

**3. 文档化API**
- 添加docstring
- 使用OpenAPI注解
- 生成Swagger文档

### 安全开发流程

**1. 输入验证**
```python
# ✅ 所有输入必须验证
alert = AlertCreate(**data)  # Pydantic自动验证
```

**2. 权限检查**
```python
# ✅ 操作前检查权限
@require_permission(Permission.ALERT_WRITE)
async def update_alert():
    pass
```

**3. 审计日志**
```python
# ✅ 重要操作记录审计日志
await log_audit_event(
    event_type=AuditEventType.ALERT_DELETED,
    user_id=current_user.id,
    resource_id=alert_id
)
```

---

## 🔧 工具配置

### VSCode配置

```json
// .vscode/settings.json
{
  "python.linting.enabled": true,
  "python.linting.pylintEnabled": true,
  "python.formatting.provider": "black",
  "python.linting.mypyEnabled": true,
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports": true
  }
}
```

### Pre-commit配置

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/psf/black
    rev: 23.12.0
    hooks:
      - id: black
        language_version: python3.11

  - repo: https://github.com/pycqa/isort
    rev: 5.13.0
    hooks:
      - id: isort

  - repo: https://github.com/pycqa/flake8
    rev: 7.0.0
    hooks:
      - id: flake8

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.8.0
    hooks:
      - id: mypy
        additional_dependencies: [types-all]
```

---

## 📖 最佳实践

### DO's (应该做)

✅ **使用类型注解**
```python
def calculate_risk(alert: Alert, context: Context) -> RiskScore:
    pass
```

✅ **使用异步IO**
```python
async def fetch_alert(alert_id: str) -> dict:
    return await db.fetch_one(alert_id)
```

✅ **完整的文档字符串**
```python
def process_alert(alert_id: str) -> dict:
    """
    Process alert and return risk assessment

    Args:
        alert_id: Alert identifier

    Returns:
        Risk assessment result
    """
    pass
```

✅ **结构化日志**
```python
logger.info("Alert processed", extra={
    "alert_id": alert_id,
    "risk_score": risk_score
})
```

✅ **异常处理**
```python
try:
    result = await process()
except SpecificError as e:
    logger.error(f"Specific error: {e}")
    raise
except Exception as e:
    logger.exception(f"Unexpected error")
    raise
```

### DON'Ts (不应该做)

❌ **不要硬编码配置**
```python
# ✗ 错误
API_KEY = "sk-1234567890"

# ✓ 正确
API_KEY = os.getenv("API_KEY")
```

❌ **不要忽略异常**
```python
# ✗ 错误
try:
    result = await process()
except:
    pass  # 静默忽略

# ✓ 正确
try:
    result = await process()
except Exception as e:
    logger.error(f"Error: {e}")
    raise
```

❌ **不要在循环中查询数据库**
```python
# ✗ 错误: N+1查询
for alert in alerts:
    context = await db.get_context(alert.id)

# ✓ 正确: 批量查询
alert_ids = [a.id for a in alerts]
contexts = await db.get_contexts_batch(alert_ids)
```

❌ **不要返回敏感信息**
```python
# ✗ 错误
return {
    "user": user,
    "password": user.password  # 泄露密码!
}

# ✓ 正确
return {
    "user": {
        "id": user.id,
        "username": user.username
    }
}
```

---

## 📚 相关资源

### 开发工具

- **Black**: https://black.readthedocs.io/
- **isort**: https://pycqa.github.io/isort/
- **mypy**: https://mypy.readthedocs.io/
- **pylint**: https://pylint.pycqa.org/

### Python规范

- **PEP 8**: https://pep8.org/
- **PEP 257**: https://peps.python.org/pep-0257/
- **Google Python Style Guide**: https://google.github.io/styleguide/pyguide.html

### 安全资源

- **OWASP Top 10**: https://owasp.org/www-project-top-ten/
- **OWASP Cheat Sheet Series**: https://cheatsheetseries.owasp.org/
- **CWE Top 25**: https://cwe.mitre.org/top25/

---

## 🎓 培训建议

### 新人培训 (第1周)

1. **开发规范培训**
   - 代码风格
   - 项目结构
   - Git工作流

2. **安全规范培训**
   - 敏感数据处理
   - 权限管理
   - 审计日志

3. **工具使用培训**
   - VSCode配置
   - Pre-commit使用
   - 测试运行

### 进阶培训 (第2-4周)

1. **API设计实战**
   - RESTful设计原则
   - 错误处理模式
   - API文档生成

2. **架构设计实战**
   - 微服务划分
   - 服务通信
   - 数据库设计

3. **安全开发实战**
   - 威胁建模
   - 代码审计
   - 渗透测试

---

## 📝 更新日志

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0 | 2025-01-05 | 初始版本，包含所有核心规范 |

---

**维护者**: 架构团队
**联系方式**: architecture@example.com
**下次更新**: 根据项目演进更新规范

---

## ✅ 合规检查清单

在提交代码前，请确认：

### 代码质量
- [ ] 代码符合PEP 8规范
- [ ] 所有函数有类型注解
- [ ] 所有公共方法有文档字符串
- [ ] 通过black/isort格式化
- [ ] 通过mypy类型检查
- [ ] 通过pylint质量检查

### 测试覆盖
- [ ] 单元测试覆盖率 > 80%
- [ ] 关键路径有集成测试
- [ ] 所有测试通过

### 安全检查
- [ ] 无硬编码密钥/密码
- [ ] 输入验证完整
- [ ] SQL注入防护
- [ ] XSS防护
- [ ] 权限检查正确
- [ ] 敏感数据加密
- [ ] 审计日志完整

### 文档更新
- [ ] API文档已更新
- [ ] README已更新
- [ ] 变更日志已记录

---

**祝开发顺利！** 🚀
