# Stage 0 基础设施层 - 快速启动指南

## 📋 概述

本指南将帮助你启动和验证所有基础设施服务（PostgreSQL, Redis, RabbitMQ, ChromaDB, Prometheus, Grafana）。

---

## ✅ 已完成

1. ✅ 修复 `threat_intel_aggregator` 的 FastAPI app 初始化 bug
2. ✅ 创建 `docker-compose.yml` - 包含所有6个基础设施服务
3. ✅ 创建 `scripts/init_db.sql` - 数据库初始化脚本
4. ✅ 创建 `scripts/create_queues.py` - RabbitMQ 队列设置脚本
5. ✅ 创建 `tests/integration/test_infrastructure.py` - 基础设施集成测试
6. ✅ 更新 `.env.example` - 添加所有必需的环境变量

---

## 🚀 快速开始

### 1. 准备环境

```bash
# 复制环境变量配置
cp .env.example .env

# 编辑 .env 文件，修改密码（生产环境必须修改！）
nano .env
```

### 2. 启动基础设施

```bash
# 启动所有核心基础设施服务
docker-compose up -d postgres redis rabbitmq chromadb

# 等待服务启动（大约30秒）
sleep 30

# 查看服务状态
docker-compose ps
```

预期输出：
```
NAME                               STATUS    PORTS
security-triage-postgres           Up        0.0.0.0:5432->5432/tcp
security-triage-redis              Up        0.0.0.0:6379->6379/tcp
security-triage-rabbitmq           Up        0.0.0.0:5672->5672/tcp, 0.0.0.0:15672->15672/tcp
security-triage-chromadb           Up        0.0.0.0:8001->8000/tcp
```

### 3. 验证服务健康

```bash
# PostgreSQL 健康检查
docker exec security-triage-postgres pg_isready -U triage_user

# Redis 健康检查
docker exec security-triage-redis redis-cli ping

# RabbitMQ 健康检查（通过 Management API）
curl -u admin:rabbitmq_password_change_me http://localhost:15672/api/healthchecks/alive

# ChromaDB 健康检查
curl http://localhost:8001/api/v1/heartbeat
```

### 4. 创建 RabbitMQ 队列

```bash
# 安装 Python 依赖
pip install pika

# 运行队列创建脚本
python3 scripts/create_queues.py
```

预期输出：
```
🚀 Security Triage System - RabbitMQ Queue Setup
...
✅ RabbitMQ setup completed successfully!

📊 Summary:
  - Exchanges: 3
  - Queues: 6
  - Bindings: 6
  - Dead Letter Queues: 4
```

### 5. 运行集成测试

```bash
# 安装测试依赖
pip install pytest psycopg2-binary redis pika requests chromadb

# 运行基础设施集成测试
pytest tests/integration/test_infrastructure.py -v
```

预期输出：
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

### 6. （可选）启动监控服务

```bash
# 启动 Prometheus 和 Grafana
docker-compose --profile monitoring up -d prometheus grafana

# 访问 Grafana
# URL: http://localhost:3000
# 用户名: admin
# 密码: grafana_password_change_me
```

---

## 📊 验收标准检查清单

- [ ] 单个命令启动所有基础设施: `docker-compose up -d`
- [ ] 所有4个核心服务健康检查通过
- [ ] 数据库schema创建成功，所有表存在
- [ ] 消息队列创建完成并可访问
- [ ] 集成测试通过（15/15 tests passed）
- [ ] 性能基准达标:
  - [ ] PostgreSQL 查询延迟 < 50ms
  - [ ] Redis GET/SET < 5ms
  - [ ] RabbitMQ 消息延迟 < 10ms
  - [ ] ChromaDB 向量插入 < 100ms

---

## 🔧 常见问题

### 问题 1: Docker Compose 启动失败

**错误**: `docker-compose: command not found`

**解决**:
```bash
# 安装 Docker Compose v2
# macOS: brew install docker-compose
# Linux: sudo apt-get install docker-compose-plugin

# 或使用 docker compose（无连字符）
docker compose up -d
```

### 问题 2: PostgreSQL 连接失败

**错误**: `connection refused` 或 `FATAL: password authentication failed`

**解决**:
```bash
# 检查服务是否运行
docker-compose ps postgres

# 查看日志
docker-compose logs postgres

# 等待服务完全启动（最多30秒）
sleep 30

# 验证密码
docker exec security-triage-postgres psql -U triage_user -d security_triage -c "SELECT 1"
```

### 问题 3: RabbitMQ 连接失败

**错误**: `pika.exceptions.AMQPConnectionError`

**解决**:
```bash
# 等待 RabbitMQ 完全启动（需要时间较长）
docker-compose logs rabbitmq | grep "Server startup complete"

# 手动测试连接
curl -u admin:rabbitmq_password_change_me http://localhost:15672/api/overview
```

### 问题 4: 测试失败

**错误**: `pytest: command not found`

**解决**:
```bash
# 安装测试依赖
pip install -r requirements.txt

# 如果没有 requirements.txt，手动安装：
pip install pytest psycopg2-binary redis pika requests chromadb
```

---

## 📝 下一步

一旦所有验收标准通过，你就可以继续 **Stage 1: 核心接入服务**。

**查看完整计划**:
```bash
cat /Users/newmba/.claude/plans/floofy-crafting-pie.md
```

---

## 🛠️ 维护命令

### 查看服务状态
```bash
docker-compose ps
```

### 查看服务日志
```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f postgres
docker-compose logs -f redis
docker-compose logs -f rabbitmq
docker-compose logs -f chromadb
```

### 重启服务
```bash
# 重启所有服务
docker-compose restart

# 重启特定服务
docker-compose restart postgres
```

### 停止服务
```bash
# 停止所有服务
docker-compose down

# 停止并删除数据卷（⚠️ 会删除所有数据！）
docker-compose down -v
```

### 进入容器
```bash
# PostgreSQL
docker exec -it security-triage-postgres psql -U triage_user -d security_triage

# Redis
docker exec -it security-triage-redis redis-cli

# RabbitMQ
docker exec -it security-triage-rabbitmq rabbitmqctl list_queues
```

---

## 📖 更多信息

- **PostgreSQL 文档**: https://www.postgresql.org/docs/15/
- **Redis 文档**: https://redis.io/docs/
- **RabbitMQ 文档**: https://www.rabbitmq.com/docs/
- **ChromaDB 文档**: https://docs.trychroma.com/

---

**Stage 0 完成后，你将拥有一个完整的基础设施环境，为后续的微服务部署做好准备！** 🎉
