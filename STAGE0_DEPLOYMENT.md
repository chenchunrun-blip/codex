# Stage 0: 基础设施部署文档

**部署阶段**: Stage 0 - 基础设施层
**部署日期**: 2026-01-06
**版本**: 1.0
**维护者**: CCR <chenchunrun@gmail.com>

---

## 📋 部署概述

Stage 0 部署安全告警系统的所有基础设施组件，包括数据库、缓存、消息队列、向量数据库和监控系统。这些基础设施是后续所有微服务的依赖。

### 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose 环境                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PostgreSQL   │  │    Redis     │  │   RabbitMQ   │      │
│  │   :5432      │  │    :6379     │  │  :5672/:15672│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  ChromaDB    │  │  Prometheus  │  │   Grafana    │      │
│  │   :8001      │  │    :9090     │  │    :3000     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 部署目标

### 部署的服务

| 服务 | 版本 | 端口 | 用途 | 数据持久化 |
|------|------|------|------|-----------|
| PostgreSQL | 15-alpine | 5432 | 主数据库 | ✅ postgres_data |
| Redis | 7-alpine | 6379 | 缓存和会话 | ✅ redis_data |
| RabbitMQ | 3.12-management | 5672, 15672 | 消息队列 | ✅ rabbitmq_data |
| ChromaDB | latest | 8001 | 向量数据库 | ✅ chroma_data |
| Prometheus | latest | 9090 | 指标收集 | ✅ prometheus_data |
| Grafana | latest | 3000 | 可视化 | ✅ grafana_data |

### 验收标准

- [ ] 所有 6 个服务成功启动
- [ ] 所有服务健康检查通过
- [ ] 数据库表结构创建成功
- [ ] 消息队列和交换机创建完成
- [ ] 数据持久化验证（重启后数据保留）
- [ ] 集成测试通过（15 个测试）

---

## 🛠️ 环境准备

### 1. 系统要求

**操作系统**:
- Linux (Ubuntu 20.04+, CentOS 7+)
- macOS 11+ (Big Sur or later)
- Windows 10/11 with WSL2

**硬件要求**:
- CPU: 4 核心或以上
- 内存: 8 GB 或以上（推荐 16 GB）
- 磁盘: 20 GB 可用空间

**软件要求**:
- Docker Engine: 20.10+
- Docker Compose: 2.0+
- Python: 3.11+ (用于运行初始化脚本)
- Git: 任意版本

### 2. 安装 Docker

**Linux (Ubuntu)**:
```bash
# 更新包索引
sudo apt-get update

# 安装 Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 安装 Docker Compose
sudo apt-get install docker-compose-plugin

# 验证安装
docker --version
docker compose version
```

**macOS**:
```bash
# 使用 Homebrew 安装
brew install --cask docker

# 或下载 Docker Desktop
# https://www.docker.com/products/docker-desktop
```

**Windows**:
```bash
# 下载并安装 Docker Desktop for Windows
# https://www.docker.com/products/docker-desktop
# 确保启用 WSL2 后端
```

### 3. 配置 Docker 镜像加速器（可选，中国大陆推荐）

**创建或编辑 `/etc/docker/daemon.json`**:
```json
{
  "registry-mirrors": [
    "https://docker.nju.edu.cn",
    "https://docker.m.daocloud.io",
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

**重启 Docker**:
```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

---

## 📦 部署步骤

### Step 1: 获取代码

```bash
# 克隆仓库（如果还没有）
git clone <repository-url>
cd security

# 或如果已经在项目目录
cd /Users/newmba/security
```

### Step 2: 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，修改密码（重要！）
vim .env
```

**必须修改的密码**:
```bash
# 数据库密码
DB_PASSWORD=your_secure_password_here

# Redis 密码
REDIS_PASSWORD=your_redis_password_here

# RabbitMQ 密码
RABBITMQ_PASSWORD=your_rabbitmq_password_here

# Grafana 密码
GRAFANA_PASSWORD=your_grafana_password_here
```

**完整环境变量列表**:
```bash
# ================================
# Database Configuration
# ================================
DATABASE_URL=postgresql+asyncpg://triage_user:${DB_PASSWORD}@localhost:5432/security_triage
DB_PASSWORD=triage_password_change_me  # ⚠️ 修改为强密码

# ================================
# Redis Configuration
# ================================
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379/0
REDIS_PASSWORD=redis_password_change_me  # ⚠️ 修改为强密码

# ================================
# RabbitMQ Configuration
# ================================
RABBITMQ_URL=amqp://admin:${RABBITMQ_PASSWORD}@localhost:5672/
RABBITMQ_PASSWORD=rabbitmq_password_change_me  # ⚠️ 修改为强密码

# ================================
# ChromaDB Configuration
# ================================
CHROMADB_HOST=localhost
CHROMADB_PORT=8001

# ================================
# Monitoring Configuration
# ================================
GRAFANA_PASSWORD=grafana_password_change_me  # ⚠️ 修改为强密码
GRAFANA_ADMIN_USER=admin

# ================================
# Application Configuration
# ================================
HOST=0.0.0.0
PORT=8000
LOG_LEVEL=INFO
DEBUG=false

# ================================
# MaaS Configuration (Stage 2+)
# ================================
DEEPSEEK_BASE_URL=http://internal-maas.deepseek/v1
DEEPSEEK_API_KEY=internal-key-123
QWEN_BASE_URL=http://internal-maas.qwen/v1
QWEN_API_KEY=internal-key-456

# ================================
# Threat Intelligence API Keys (Stage 2+)
# ================================
VIRUSTOTAL_API_KEY=your_vt_key
ABUSECH_API_KEY=your_abusech_key
```

### Step 3: 创建必要的目录

```bash
# 创建数据和日志目录
mkdir -p logs
mkdir -p monitoring/prometheus
mkdir -p monitoring/grafana/dashboards
mkdir -p monitoring/grafana/datasources

# 设置权限
chmod 755 logs monitoring
```

### Step 4: 验证 Docker Compose 配置

```bash
# 验证 docker-compose.yml 语法
docker compose config

# 查看将要启动的服务
docker compose config --services
```

**预期输出**:
```
postgres
redis
rabbitmq
chromadb
prometheus
grafana
```

### Step 5: 启动基础设施服务

```bash
# 启动所有 Stage 0 基础设施服务
docker compose up -d postgres redis rabbitmq chromadb

# 或者启动包含监控的完整基础设施
docker compose --profile monitoring up -d
```

**参数说明**:
- `-d`: 后台运行（detached mode）
- `--profile monitoring`: 包含 Prometheus 和 Grafana

### Step 6: 等待服务健康就绪

```bash
# 查看服务状态
docker compose ps

# 持续监控健康状态
watch -n 2 'docker compose ps'
```

**预期状态**（所有服务显示 "healthy"）:
```
NAME                           STATUS          PORTS
security-triage-postgres       Up (healthy)    0.0.0.0:5432->5432/tcp
security-triage-redis          Up (healthy)    0.0.0.0:6379->6379/tcp
security-triage-rabbitmq       Up (healthy)    0.0.0.0:5672->5672/tcp, 0.0.0.0:15672->15672/tcp
security-triage-chromadb       Up (healthy)    0.0.0.0:8001->8000/tcp
```

**等待时间**:
- PostgreSQL: ~30 秒
- Redis: ~10 秒
- RabbitMQ: ~30 秒
- ChromaDB: ~30 秒

### Step 7: 验证服务连接

```bash
# PostgreSQL 健康检查
docker exec security-triage-postgres pg_isready -U triage_user -d security_triage

# Redis 健康检查
docker exec security-triage-redis redis-cli ping

# RabbitMQ 健康检查
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/healthchecks

# ChromaDB 健康检查
curl http://localhost:8001/api/v1/heartbeat
```

**预期输出**:
```
# PostgreSQL
security_triage - accepting connections

# Redis
PONG

# RabbitMQ
{"status":"ok",...}

# ChromaDB
{"nanosecond heartbeat":...}
```

### Step 8: 初始化数据库

```bash
# 运行数据库初始化脚本
docker exec -i security-triage-postgres psql -U triage_user -d security_triage < scripts/init_db.sql

# 验证表创建
docker exec -it security-triage-postgres psql -U triage_user -d security_triage -c "\dt"
```

**预期输出**:
```
           List of relations
 Schema |     Name      | Type  |    Owner
--------+---------------+-------+-------------
 public | alerts        | table | triage_user
 public | audit_logs    | table | triage_user
 public | context_info  | table | triage_user
 public | remediation_actions | table | triage_user
 public | threat_intelligence | table | triage_user
 public | triage_results | table | triage_user
```

### Step 9: 创建消息队列

```bash
# 安装 Python 依赖（如果还没有）
pip install pika

# 运行队列创建脚本
python3 scripts/create_queues.py
```

**预期输出**:
```
✓ Connected to RabbitMQ
✓ Created queue: alert.raw
✓ Created queue: alert.normalized
✓ Created queue: alert.enriched
✓ Created queue: alert.result
✓ Created queue: workflow.tasks
✓ Created queue: notification.pending
✓ Created exchange: alerts (topic)
✓ Created exchange: workflows (direct)
✓ Created exchange: notifications (fanout)
✓ Created dead letter queue: alert.raw.dlq
✓ Created dead letter queue: alert.normalized.dlq
✓ Created dead letter queue: alert.enriched.dlq
✓ Created dead letter queue: alert.result.dlq
✓ All queues and exchanges created successfully
```

### Step 10: 验证消息队列

```bash
# 通过 RabbitMQ API 查看队列
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/queues/%2F | python3 -m json.tool
```

**预期看到**:
- alert.raw
- alert.normalized
- alert.enriched
- alert.result
- workflow.tasks
- notification.pending
- 死信队列 (xxx.dlq)

### Step 11: 运行集成测试

```bash
# 安装测试依赖
pip install pytest pytest-asyncio pytest-cov

# 运行基础设施集成测试
PYTHONPATH=/Users/newmba/security/services/shared python3 -m pytest tests/integration/test_infrastructure.py -v
```

**预期结果**: 15 个测试全部通过

### Step 12: 配置 Prometheus（可选）

```bash
# 创建 Prometheus 配置文件
cat > monitoring/prometheus.yml <<EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'rabbitmq'
    static_configs:
      - targets: ['rabbitmq:15692']
EOF

# 重启 Prometheus
docker compose restart prometheus
```

### Step 13: 访问管理界面

**RabbitMQ Management UI**:
- URL: http://localhost:15672
- 用户名: admin
- 密码: (见 .env 中的 RABBITMQ_PASSWORD)

**Grafana Dashboard**:
- URL: http://localhost:3000
- 用户名: admin
- 密码: (见 .env 中的 GRAFANA_PASSWORD)
- 首次登录后需要更改密码

**Prometheus**:
- URL: http://localhost:9090

---

## ✅ 部署验证

### 完整验证清单

```bash
# 1. 检查所有容器状态
docker compose ps

# 2. 检查容器日志（无错误）
docker compose logs postgres | tail -20
docker compose logs redis | tail -20
docker compose logs rabbitmq | tail -20
docker compose logs chromadb | tail -20

# 3. 验证数据库连接
docker exec -it security-triage-postgres psql -U triage_user -d security_triage -c "SELECT version();"

# 4. 验证 Redis 连接
docker exec security-triage-redis redis-cli INFO server

# 5. 验证 RabbitMQ 队列
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/queues/%2F/alert.raw | python3 -m json.tool

# 6. 验证 ChromaDB
curl http://localhost:8001/api/v1/heartbeat

# 7. 运行集成测试
PYTHONPATH=/Users/newmba/security/services/shared python3 -m pytest tests/integration/test_infrastructure.py -v --tb=short
```

### 性能基准测试

```bash
# PostgreSQL 查询性能
docker exec -it security-triage-postgres psql -U triage_user -d security_triage -c "EXPLAIN ANALYZE SELECT * FROM alerts LIMIT 10;"

# Redis 性能测试
docker exec security-triage-redis redis-cli --latency

# RabbitMQ 性能测试
# (需要使用 perf-test 工具，可选)
```

---

## 📊 监控和维护

### 日志管理

```bash
# 查看实时日志
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f rabbitmq

# 查看最近 100 行日志
docker compose logs --tail=100 postgres

# 导出日志
docker compose logs > logs/stage0-infrastructure.log
```

### 数据备份

**PostgreSQL 备份**:
```bash
# 创建备份目录
mkdir -p backups/$(date +%Y%m%d)

# 备份数据库
docker exec security-trriage-postgres pg_dump -U triage_user security_triage | gzip > backups/$(date +%Y%m%d)/postgres_backup.sql.gz

# 验证备份
zcat backups/$(date +%Y%m%d)/postgres_backup.sql.gz | head -20
```

**Redis 备份**:
```bash
# 触发 Redis 持久化
docker exec security-triage-redis redis-cli BGSAVE

# 复制 RDB 文件
docker cp security-triage-redis:/data/dump.rdb backups/$(date +%Y%m%d)/redis_dump.rdb
```

**RabbitMQ 备份**:
```bash
# 备份队列定义
docker exec security-triage-rabbitmq rabbitmqctl list_queues > backups/$(date +%Y%m%d)/rabbitmq_queues.txt

# 备份数据目录
docker cp security-triage-rabbitmq:/var/lib/rabbitmq backups/$(date +%Y%m%d)/rabbitmq_data
```

### 数据恢复

**PostgreSQL 恢复**:
```bash
# 停止服务
docker compose stop postgres

# 删除旧数据卷（危险操作！）
docker volume rm security_postgres_data

# 启动新容器
docker compose up -d postgres

# 等待启动
sleep 30

# 恢复数据
zcat backups/20260106/postgres_backup.sql.gz | docker exec -i security-triage-postgres psql -U triage_user -d security_triage
```

---

## 🔧 故障排查

### 常见问题

#### 1. PostgreSQL 无法启动

**症状**:
```
security-triage-postgres | Error: Database is not accepting connections
```

**解决方案**:
```bash
# 查看详细日志
docker compose logs postgres

# 检查数据卷权限
docker volume inspect security_postgres_data

# 重新创建容器（数据会保留）
docker compose down postgres
docker compose up -d postgres
```

#### 2. Redis 连接超时

**症状**:
```
Error: Connection refused to redis:6379
```

**解决方案**:
```bash
# 检查 Redis 状态
docker compose ps redis

# 重启 Redis
docker compose restart redis

# 测试连接
docker exec security-triage-redis redis-cli ping
```

#### 3. RabbitMQ 无法访问管理界面

**症状**: http://localhost:15672 无法打开

**解决方案**:
```bash
# 检查端口映射
docker compose ps rabbitmq

# 检查防火墙
sudo ufw allow 15672/tcp

# 重启 RabbitMQ
docker compose restart rabbitmq
```

#### 4. ChromaDB 内存不足

**症状**: 容器反复重启

**解决方案**:
```bash
# 增加内存限制（编辑 docker-compose.yml）
# 在 chromadb 服务下添加:
# mem_limit: 2g
# memswap_limit: 2g

# 重启服务
docker compose up -d chromadb
```

#### 5. 端口冲突

**症状**: `port is already allocated`

**解决方案**:
```bash
# 查看占用端口的进程
sudo lsof -i :5432  # PostgreSQL
sudo lsof -i :6379  # Redis
sudo lsof -i :5672  # RabbitMQ
sudo lsof -i :15672 # RabbitMQ UI

# 停止冲突的服务或修改 docker-compose.yml 中的端口映射
```

---

## 🔄 服务管理

### 启动服务

```bash
# 启动所有基础设施
docker compose up -d postgres redis rabbitmq chromadb

# 启动包含监控的完整基础设施
docker compose --profile monitoring up -d

# 启动特定服务
docker compose up -d postgres
```

### 停止服务

```bash
# 停止所有服务（保留数据）
docker compose stop

# 停止并删除容器（保留数据卷）
docker compose down

# 停止并删除容器和数据卷（⚠️ 数据会丢失）
docker compose down -v
```

### 重启服务

```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart postgres
docker compose restart redis
docker compose restart rabbitmq
```

### 更新服务

```bash
# 拉取最新镜像
docker compose pull

# 重新构建并启动
docker compose up -d --build

# 查看更新状态
docker compose ps
```

---

## 🔐 安全加固

### 1. 修改默认密码

```bash
# 生成强密码
openssl rand -base64 32

# 更新 .env 文件中的所有密码
vim .env

# 重启服务
docker compose down
docker compose up -d
```

### 2. 配置防火墙

```bash
# 只允许本地访问数据库端口
sudo ufw deny 5432
sudo ufw deny 6379
sudo ufw deny 5672

# 允许管理界面访问（限制 IP）
sudo ufw allow from 192.168.1.0/24 to any port 15672
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

### 3. 启用 TLS（生产环境）

**PostgreSQL TLS**:
```yaml
# 在 docker-compose.yml 中添加
postgres:
  command:
    - postgres
    - -c
    - ssl=on
    - -c
    - ssl_cert_file=/var/lib/postgresql/server.crt
    - -c
    - ssl_key_file=/var/lib/postgresql/server.key
  volumes:
    - ./certs/postgres.crt:/var/lib/postgresql/server.crt:ro
    - ./certs/postgres.key:/var/lib/postgresql/server.key:ro
```

---

## 📈 性能优化

### PostgreSQL 调优

```sql
-- 连接到数据库
docker exec -it security-triage-postgres psql -U triage_user -d security_triage

-- 调整配置（需要编辑 postgresql.conf）
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- 重启配置
SELECT pg_reload_conf();
```

### Redis 调优

```bash
# 编辑 redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000

# 重启 Redis
docker compose restart redis
```

---

## 📝 附录

### A. 端口映射表

| 服务 | 内部端口 | 外部端口 | 协议 | 用途 |
|------|---------|---------|------|------|
| PostgreSQL | 5432 | 5432 | TCP | 数据库连接 |
| Redis | 6379 | 6379 | TCP | 缓存连接 |
| RabbitMQ (AMQP) | 5672 | 5672 | TCP | 消息队列 |
| RabbitMQ (Management) | 15672 | 15672 | HTTP | Web UI |
| ChromaDB | 8000 | 8001 | HTTP | 向量搜索 API |
| Prometheus | 9090 | 9090 | HTTP | 指标查询 |
| Grafana | 3000 | 3000 | HTTP | 仪表板 |

### B. 数据卷位置

```bash
# 查看所有数据卷
docker volume ls | grep security

# 查看卷详情
docker volume inspect security_postgres_data
docker volume inspect security_redis_data
docker volume inspect security_rabbitmq_data
docker volume inspect security_chroma_data
```

### C. 网络配置

```bash
# 查看网络
docker network ls | grep security

# 查看网络详情
docker network inspect security-security-triage-network
```

### D. 配置文件路径

| 服务 | 配置文件路径 |
|------|-------------|
| PostgreSQL | `/var/lib/postgresql/data/postgresql.conf` |
| Redis | `/usr/local/etc/redis/redis.conf` |
| RabbitMQ | `/etc/rabbitmq/rabbitmq.conf` |
| Prometheus | `/etc/prometheus/prometheus.yml` |
| Grafana | `/etc/grafana/grafana.ini` |

---

## 📚 相关文档

- **Stage 0 快速指南**: `/Users/newmba/security/STAGE0_GUIDE.md`
- **Stage 0 验证清单**: `/Users/newmba/security/STAGE0_CHECKLIST.md`
- **数据库设计**: `/Users/newmba/security/docs/04_database_design.md`
- **架构概览**: `/Users/newmba/security/docs/README.md`

---

## 🆘 支持和联系

**问题反馈**: CCR <chenchunrun@gmail.com>
**文档版本**: 1.0
**最后更新**: 2026-01-06

---

**部署状态**: ⚠️ 待部署
**下一阶段**: Stage 1 - 核心接入服务部署
