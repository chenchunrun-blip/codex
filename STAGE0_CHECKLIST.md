# Stage 0 基础设施验证检查清单

## 📋 验证概览

本文档提供了 Stage 0 基础设施层的完整验证步骤和验收标准。

---

## ✅ 已完成的准备工作

- [x] 修复 `threat_intel_aggregator` FastAPI app 初始化 bug
- [x] 创建 `docker-compose.yml` 配置文件
- [x] 创建 `scripts/init_db.sql` 数据库初始化脚本
- [x] 创建 `scripts/create_queues.py` RabbitMQ 队列设置脚本
- [x] 创建 `tests/integration/test_infrastructure.py` 集成测试
- [x] 更新 `.env.example` 环境变量模板
- [x] 创建 `.env` 配置文件
- [x] 安装 Python 依赖 (pytest, psycopg2, redis, pika, chromadb)
- [x] 配置 Docker 镜像加速器

---

## 🚀 完整验证步骤

### 前置条件检查

```bash
# 1. 检查 Docker 是否运行
docker ps

# 2. 检查 Docker 镜像加速器配置
docker info | grep -A 5 "Registry Mirrors"

# 3. 检查 Python 依赖
pip3 list | grep -E "(pytest|psycopg2|redis|pika|chromadb)"

# 4. 检查配置文件
ls -la .env docker-compose.yml scripts/
```

### 步骤 1: 拉取 Docker 镜像

**如果网络较慢，可以分步拉取**：

```bash
# 方案 A: 使用 docker compose（推荐）
docker compose pull

# 方案 B: 单独拉取每个镜像
docker pull postgres:15-alpine
docker pull redis:7-alpine
docker pull rabbitmq:3.12-management-alpine
docker pull chromadb/chroma:latest

# 方案 C: 如果上述方法都失败，手动指定镜像源
docker pull docker.m.daocloud.io/library/postgres:15-alpine
docker tag docker.m.daocloud.io/library/postgres:15-alpine postgres:15-alpine
```

### 步骤 2: 启动基础设施服务

```bash
# 启动所有核心服务
docker compose up -d postgres redis rabbitmq chromadb

# 查看启动状态
docker compose ps

# 查看日志（如果有问题）
docker compose logs postgres
docker compose logs redis
docker compose logs rabbitmq
docker compose logs chromadb
```

**预期输出**：
```
NAME                               STATUS    PORTS
security-triage-postgres           Up        0.0.0.0:5432->5432/tcp
security-triage-redis              Up        0.0.0.0:6379->6379/tcp
security-triage-rabbitmq           Up        0.0.0.0:5672->5672/tcp, 0.0.0.0:15672->15672/tcp
security-triage-chromadb           Up        0.0.0.0:8001->8000/tcp
```

### 步骤 3: 验证服务健康

```bash
# PostgreSQL 健康检查
docker exec security-triage-postgres pg_isready -U triage_user

# Redis 健康检查
docker exec security-triage-redis redis-cli ping

# RabbitMQ 健康检查
curl -u admin:$(grep RABBITMQ_PASSWORD .env | cut -d= -f2) http://localhost:15672/api/healthchecks/alive

# ChromaDB 健康检查
curl http://localhost:8001/api/v1/heartbeat
```

**预期结果**：所有命令返回成功状态。

### 步骤 4: 验证数据库初始化

```bash
# 检查数据库表是否创建
docker exec security-triage-postgres psql -U triage_user -d security_triage -c "\dt"

# 检查示例数据
docker exec security-triage-postgres psql -U triage_user -d security_triage -c "SELECT COUNT(*) FROM alerts;"
```

**预期结果**：
- 看到所有 6 个表（alerts, triage_results, remediation_actions, threat_intelligence, context_info, audit_logs）
- alerts 表至少有 4 条示例数据

### 步骤 5: 创建 RabbitMQ 队列

```bash
# 安装 pika（如果尚未安装）
pip3 install pika

# 运行队列创建脚本
cd /Users/newmba/security
python3 scripts/create_queues.py
```

**预期输出**：
```
🚀 Security Triage System - RabbitMQ Queue Setup
======================================================================
✅ RabbitMQ setup completed successfully!

📊 Summary:
  - Exchanges: 3
  - Queues: 6
  - Bindings: 6
  - Dead Letter Queues: 4
```

### 步骤 6: 运行集成测试

```bash
# 确保在项目根目录
cd /Users/newmba/security

# 运行完整的基础设施集成测试
pytest tests/integration/test_infrastructure.py -v
```

**预期结果**：15 个测试全部通过

```
======================== test session starts =========================
collected 15 items

test_infrastructure.py::TestPostgreSQL::test_database_connection PASSED
test_infrastructure.py::TestPostgreSQL::test_database_tables_exist PASSED
test_infrastructure.py::TestPostgreSQL::test_database_indexes_exist PASSED
test_infrastructure.py::TestPostgreSQL::test_sample_data_exists PASSED
test_infrastructure.py::TestPostgreSQL::test_database_insert_and_query PASSED

test_infrastructure.py::TestRedis::test_redis_connection PASSED
test_infrastructure.py::TestRedis::test_redis_set_and_get PASSED
test_infrastructure.py::TestRedis::test_redis_cache_expiration PASSED
test_infrastructure.py::TestRedis::test_redis_list_operations PASSED

test_infrastructure.py::TestRabbitMQ::test_rabbitmq_connection PASSED
test_infrastructure.py::TestRabbitMQ::test_rabbitmq_queues_exist PASSED
test_infrastructure.py::TestRabbitMQ::test_rabbitmq_publish_and_consume PASSED
test_infrastructure.py::TestRabbitMQ::test_rabbitmq_exchanges_exist PASSED

test_infrastructure.py::TestChromaDB::test_chromadb_connection PASSED
test_infrastructure.py::TestChromaDB::test_chromadb_create_collection PASSED
test_infrastructure.py::TestChromaDB::test_chromadb_insert_and_query PASSED

========================= 15 passed in 5.23s =========================
```

### 步骤 7: 验证性能基准

性能测试会自动在集成测试中运行，检查：

- ✅ PostgreSQL 查询延迟 < 50ms P95
- ✅ Redis GET/SET < 5ms P95
- ✅ RabbitMQ 消息延迟 < 10ms P95
- ✅ ChromaDB 向量插入 < 100ms P95

---

## 📊 验收标准检查清单

### 核心功能

- [ ] 单个命令启动所有基础设施: `docker compose up -d`
- [ ] 所有 4 个核心服务健康检查通过
- [ ] 数据库 schema 创建成功，所有表存在
- [ ] 消息队列创建完成并可访问
- [ ] 集成测试通过（15/15 tests passed）

### 性能基准

- [ ] PostgreSQL 查询延迟 < 50ms P95
- [ ] Redis GET/SET < 5ms P95
- [ ] RabbitMQ 消息延迟 < 10ms P95
- [ ] ChromaDB 向量插入 < 100ms P95

### 文档完整性

- [ ] docker-compose.yml 配置正确
- [ ] .env 文件已创建并配置
- [ ] 所有脚本可执行且有执行权限
- [ ] 验证文档完整

---

## 🔧 常见问题排查

### 问题 1: Docker 镜像拉取超时

**症状**：`Error response from daemon: context deadline exceeded`

**解决方案**：

1. **检查镜像加速器配置**：
   ```bash
   docker info | grep -A 5 "Registry Mirrors"
   ```

2. **如果配置了仍然超时，尝试手动拉取**：
   ```bash
   # 使用镜像源前缀
   docker pull docker.m.daocloud.io/library/postgres:15-alpine
   docker tag docker.m.daocloud.io/library/postgres:15-alpine postgres:15-alpine
   ```

3. **增加 Docker 超时时间**：
   - Docker Desktop → Settings → Resources → Proxies
   - 或者编辑 `~/.docker/daemon.json`

### 问题 2: 服务启动失败

**症状**：`docker compose ps` 显示服务状态为 `Exited`

**解决方案**：

```bash
# 查看服务日志
docker compose logs postgres
docker compose logs redis
docker compose logs rabbitmq
docker compose logs chromadb

# 重启失败的服务
docker compose restart postgres

# 如果端口冲突，检查端口占用
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis
lsof -i :5672  # RabbitMQ
lsof -i :15672  # RabbitMQ Management UI
lsof -i :8001  # ChromaDB
```

### 问题 3: 测试失败

**症状**：`pytest` 报告连接错误

**解决方案**：

```bash
# 1. 确认所有服务都在运行
docker compose ps

# 2. 确认环境变量正确
cat .env | grep -E "(DB_|REDIS_|RABBITMQ_)"

# 3. 手动测试连接
docker exec security-triage-postgres psql -U triage_user -d security_triage -c "SELECT 1"
docker exec security-triage-redis redis-cli ping
curl -u admin:$(grep RABBITMQ_PASSWORD .env | cut -d= -f2) http://localhost:15672/api/overview
curl http://localhost:8001/api/v1/heartbeat
```

### 问题 4: 队列创建脚本失败

**症状**：`pika.exceptions.AMQPConnectionError`

**解决方案**：

```bash
# 1. 确认 RabbitMQ 正在运行
docker compose ps rabbitmq

# 2. 确认 RabbitMQ 管理插件已启用
docker exec security-triage-rabbitmq rabbitmq-plugins enable rabbitmq_management

# 3. 检查 RabbitMQ 日志
docker compose logs rabbitmq | tail -50

# 4. 手动测试连接
curl -u admin:$(grep RABBITMQ_PASSWORD .env | cut -d= -f2) http://localhost:15672/api/overview
```

---

## 📝 验证完成后的标记

当所有验收标准通过后，请更新此文档：

```markdown
## ✅ 验证完成

**验证日期**: 2026-01-06
**验证人**: [你的名字]
**环境**: macOS with Docker Desktop

### 通过的测试
- [x] 所有基础设施服务启动成功
- [x] 15/15 集成测试通过
- [x] 性能基准全部达标

### 备注
[任何特殊说明或遇到的问题]
```

---

## 🎯 下一步

验证完成后，继续执行 **Stage 1: 核心接入服务**

参考文档：`/Users/newmba/.claude/plans/floofy-crafting-pie.md`

---

**最后更新**: 2026-01-06
**维护者**: CCR <chenchunrun@gmail.com>
