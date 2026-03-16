# 服务启动问题诊断报告

**日期**: 2026-01-09
**状态**: 🔧 已修复多个问题，但服务仍无法启动

---

## ✅ 已修复的问题

### 1. Dockerfile CMD 路径错误 ✅
- **问题**: CMD 尝试运行 `/app/main.py`，但文件在 `/app/services/alert_ingestor/main.py`
- **修复**: 更新所有 15 个 Dockerfile 的 CMD 为正确路径
- **状态**: ✅ 完成

### 2. PYTHONPATH 配置错误 ✅
- **问题**: `import shared` 无法找到 shared 模块
- **修复**: 修改所有 Dockerfile 的 PYTHONPATH 从 `/app/services/shared:...` 改为 `/app/services:/app`
- **状态**: ✅ 完成

### 3. SQLAlchemy 模型错误 ✅
- **问题**: `metadata` 是 SQLAlchemy 保留字
- **修复**: 重命名字段为 `alert_metadata`
- **文件**: `services/shared/database/models.py:394`
- **状态**: ✅ 完成

### 4. 缺少依赖包 ✅
- **问题**: `slowapi` 包缺失
- **修复**: 添加 `slowapi>=0.1.9` 到 requirements.txt
- **文件**: `services/alert_ingestor/requirements.txt`
- **状态**: ✅ 完成

### 5. JWT_SECRET_KEY 环境变量缺失 ✅
- **问题**: Pydantic 验证错误，缺少 jwt_secret_key
- **修复**: 添加 JWT_SECRET_KEY 到 docker-compose.yml 的 alert-ingestor 环境
- **状态**: ✅ 完成

---

## ⚠️ 当前问题（待修复）

### 问题：数据库未初始化

**错误信息**:
```
RuntimeError: Database not initialized. Call init_database() first.
```

**位置**: `services/alert_ingestor/main.py:102`

**原因**:
服务在启动时调用了 `get_database_manager()`，但数据库连接池尚未初始化。

**解决方案**:
需要在 `lifespan()` 函数中先调用 `init_database()` 再调用 `get_database_manager()`。

---

## 📊 问题序列

服务启动过程中遇到的问题序列：

1. ✅ **ModuleNotFoundError: No module named 'shared'**
   → 修复: 更新 PYTHONPATH

2. ✅ **FileNotFoundError: /app/main.py**
   → 修复: 更新 CMD 路径

3. ✅ **SQLAlchemy InvalidRequestError: metadata is reserved**
   → 修复: 重命名字段为 alert_metadata

4. ✅ **ModuleNotFoundError: No module named 'slowapi'**
   → 修复: 添加 slowapi 到 requirements.txt

5. ✅ **Pydantic ValidationError: jwt_secret_key required**
   → 修复: 添加 JWT_SECRET_KEY 环境变量

6. ⚠️ **RuntimeError: Database not initialized**
   → 待修复: 需要在启动时初始化数据库

---

## 🔧 下一步修复建议

### 选项 A：修复服务启动代码 ⭐ 推荐

修改 `services/alert_ingestor/main.py` 的 `lifespan()` 函数：

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database first
    await init_database(
        database_url=os.getenv("DATABASE_URL"),
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20"))
    )

    # Then get database manager
    db_manager = get_database_manager()

    yield

    # Cleanup
    await close_database()
```

### 选项 B：简化服务以进行测试

暂时注释掉数据库依赖，使用 mock 数据进行测试。

### 选项 C：检查其他服务的类似问题

所有使用 `get_database_manager()` 的服务可能都有相同问题，需要逐个修复。

---

## 📝 需要修复的服务清单

以下服务可能都需要类似的修复：

1. ⚠️ **alert-ingestor** - 确认需要修复
2. ❓ **alert-normalizer** - 可能需要检查
3. ❓ **context-collector** - 可能需要检查
4. ❓ **threat-intel-aggregator** - 可能需要检查
5. ❓ **ai-triage-agent** - 可能需要检查
6. ❓ **其他服务** - 需要逐个检查

---

## 🎯 快速验证

### 修复单个服务测试流程：

1. 修改服务代码（如 main.py）
2. 重新构建镜像：`docker-compose build <service>`
3. 重启服务：`docker-compose up -d <service>`
4. 查看日志：`docker-compose logs -f <service>`
5. 检查健康：`curl http://localhost:9001/health`

---

## 💡 临时测试方案

如果想要快速测试容器能否运行（不考虑功能）：

### 创建最小化健康检查端点

修改服务的 `main.py`，添加一个简单的健康检查端点：

```python
@app.get("/health")
async def health_check():
    """Simple health check that doesn't depend on database"""
    return {
        "status": "healthy",
        "service": "alert-ingestor"
    }
```

这样可以验证：
- ✅ 容器能够启动
- ✅ FastAPI 能够运行
- ✅ 端口可以访问
- ❌ 但实际功能不可用（数据库未连接）

---

## 📚 相关文件

### 需要修改的文件：
1. `services/alert_ingestor/main.py` - lifespan 函数
2. `services/alert_normalizer/main.py` - 检查是否有类似问题
3. `services/context_collector/main.py` - 检查是否有类似问题
4. 等等...

### 已修改的文件：
1. `services/alert_ingestor/Dockerfile` - CMD 路径、PYTHONPATH
2. `services/alert_ingestor/requirements.txt` - 添加 slowapi
3. `services/shared/database/models.py` - 重命名 metadata 字段
4. `docker-compose.yml` - 添加 JWT_SECRET_KEY
5. 所有其他服务的 Dockerfile - CMD 路径和 PYTHONPATH

---

## ⏱️ 预计修复时间

- **单个服务**: 15-30 分钟（修改 + 测试）
- **所有服务**: 2-3 小时（逐个修复 + 测试）

---

## 🎯 总结

### 进度
- ✅ 基础设施配置问题：已全部修复
- ⚠️ 服务启动逻辑：需要继续修复

### 建议
**优先修复 alert-ingestor**，作为其他服务的模板。修复后可以快速复制到其他服务。

---

**报告生成时间**: 2026-01-09
**下一步**: 修复 alert-ingestor 的数据库初始化问题
