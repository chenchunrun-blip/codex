# Stage 1: 核心接入服务部署文档

**部署阶段**: Stage 1 - 核心接入服务
**依赖阶段**: Stage 0 - 基础设施（必须先完成）
**部署日期**: 2026-01-06
**版本**: 1.0
**维护者**: CCR <chenchunrun@gmail.com>

---

## 📋 部署概述

Stage 1 部署安全告警系统的核心接入层，包括两个关键微服务：
- **Alert Ingestor Service** - 多协议告警接入服务（端口 8001）
- **Alert Normalizer Service** - 告警标准化服务（端口 8002）

这两个服务接收来自各种来源的原始告警，将其转换为标准格式，并发布到消息队列供下游服务处理。

### 部署架构

```
┌───────────────────────────────────────────────────────────────┐
│                    告警来源 (Alert Sources)                     │
│  SIEM Systems, IDS/IPS, Firewalls, Endpoints, Custom Sources  │
└────────────────────────────┬──────────────────────────────────┘
                             │ HTTP POST
                             ▼
┌───────────────────────────────────────────────────────────────┐
│              Alert Ingestor Service (Port 8001)                │
│  - REST API 接入                                               │
│  - 速率限制 (100 req/min)                                      │
│  - 请求验证                                                    │
│  - 发布到 alert.raw 队列                                        │
└────────────────────────────┬──────────────────────────────────┘
                             │ RabbitMQ
                             ▼
                    ┌────────────────┐
                    │  alert.raw     │
                    │  Queue         │
                    └────────┬───────┘
                             │ Consume
                             ▼
┌───────────────────────────────────────────────────────────────┐
│            Alert Normalizer Service (Port 8002)                │
│  - 字段映射 (Splunk, QRadar, default)                          │
│  - IOC 提取 (IP, hash, URL)                                    │
│  - 告警去重 (SHA256 fingerprint)                               │
│  - 发布到 alert.normalized 队列                                 │
└────────────────────────────┬──────────────────────────────────┘
                             │ RabbitMQ
                             ▼
                   ┌────────────────┐
                   │ alert.normalized│
                   │ Queue          │
                   └────────────────┘
```

---

## 🎯 部署目标

### 部署的服务

| 服务 | 版本 | 端口 | 用途 | 依赖 |
|------|------|------|------|------|
| Alert Ingestor | Python 3.11 | 8001 | 告警接入 | Stage 0 所有服务 |
| Alert Normalizer | Python 3.11 | 8002 | 告警标准化 | Stage 0 + Ingestor |

### 验收标准

- [ ] Stage 0 基础设施已部署并验证
- [ ] Alert Ingestor 成功启动并通过健康检查
- [ ] Alert Normalizer 成功启动并通过健康检查
- [ ] 能够通过 REST API 提交告警
- [ ] 告警成功发布到 `alert.raw` 队列
- [ ] 告警成功从 `alert.raw` 消费并标准化
- [ ] 标准化告警发布到 `alert.normalized` 队列
- [ ] 速率限制生效
- [ ] 去重功能正常
- [ ] IOC 提取正确

---

## 🛠️ 前置条件

### 1. Stage 0 必须已完成

```bash
# 验证 Stage 0 服务运行中
docker compose ps postgres redis rabbitmq chromadb

# 预期输出：所有服务显示 "Up (healthy)"
```

### 2. Python 依赖已安装

```bash
# 检查 Python 版本（需要 3.11+）
python3 --version

# 安装 Python 依赖
pip install -r services/requirements.txt
```

**核心依赖**:
- fastapi >= 0.104.0
- uvicorn >= 0.24.0
- pydantic >= 2.5.0
- aiohttp >= 3.9.0
- slowapi >= 0.1.9
- pika >= 1.3.2
- asyncpg >= 0.29.0
- redis >= 5.0.0

### 3. 环境变量已配置

```bash
# 验证 .env 文件存在
cat .env | grep -E "DATABASE_URL|REDIS_URL|RABBITMQ_URL"

# 预期输出应包含配置好的连接字符串
```

---

## 📦 部署步骤

### Step 1: 准备 Docker 镜像

#### 方案 A: 从 Dockerfile 构建（推荐）

```bash
# 进入项目根目录
cd /Users/newmba/security

# 构建 Alert Ingestor 镜像
docker build -f services/alert_ingestor/Dockerfile -t security-triage-alert-ingestor:latest .

# 构建 Alert Normalizer 镜像
docker build -f services/alert_normalizer/Dockerfile -t security-triage-alert-normalizer:latest .

# 验证镜像构建成功
docker images | grep security-triage
```

**预期输出**:
```
security-triage-alert-ingestor    latest    <image-id>    <size>    <time>
security-triage-alert-normalizer  latest    <image-id>    <size>    <time>
```

#### 方案 B: 使用 Docker Compose 自动构建

```bash
# Docker Compose 会自动构建镜像
docker compose build alert-ingestor alert-normalizer
```

### Step 2: 验证服务配置

```bash
# 检查 docker-compose.yml 中的服务配置
docker compose config --services | grep -E "alert-ingestor|alert-normalizer"

# 查看服务配置详情
docker compose config | grep -A 20 "alert-ingestor:"
```

### Step 3: 启动 Alert Ingestor 服务

```bash
# 启动 Alert Ingestor
docker compose up -d alert-ingestor

# 查看启动日志
docker compose logs -f alert-ingestor

# 等待服务健康（约 10-20 秒）
```

**预期日志输出**:
```
alert-ingestor    | INFO:     Started server process [1]
alert-ingestor    | INFO:     Waiting for application startup.
alert-ingestor    | INFO:     Starting Alert Ingestor Service
alert-ingestor    | INFO:     ✓ Database connected
alert-ingestor    | INFO:     ✓ Message publisher connected
alert-ingestor    | INFO:     ✓ Alert Ingestor Service started successfully
alert-ingestor    | INFO:     Application startup complete.
alert-ingestor    | INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 4: 验证 Alert Ingestor 健康状态

```bash
# 检查容器状态
docker compose ps alert-ingestor

# 预期输出: Up (healthy)

# 测试健康检查端点
curl http://localhost:8001/health | python3 -m json.tool
```

**预期响应**:
```json
{
  "status": "healthy",
  "service": "alert-ingestor",
  "timestamp": "2026-01-06T10:00:00.000000",
  "checks": {
    "database": "connected",
    "message_queue": "connected"
  }
}
```

### Step 5: 启动 Alert Normalizer 服务

```bash
# 启动 Alert Normalizer
docker compose up -d alert-normalizer

# 查看启动日志
docker compose logs -f alert-normalizer

# 等待服务健康（约 10-20 秒）
```

**预期日志输出**:
```
alert-normalizer  | INFO:     Started server process [1]
alert-normalizer  | INFO:     Waiting for application startup.
alert-normalizer  | INFO:     Starting Alert Normalizer Service
alert-normalizer  | INFO:     ✓ Database connected
alert-normalizer  | INFO:     ✓ Message publisher connected
alert-normalizer  | INFO:     ✓ Message consumer connected
alert-normalizer  | INFO:     ✓ Alert Normalizer Service started successfully
alert-normalizer  | INFO:     Application startup complete.
alert-normalizer  | INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 6: 验证 Alert Normalizer 健康状态

```bash
# 检查容器状态
docker compose ps alert-normalizer

# 预期输出: Up (healthy)

# 测试健康检查端点
curl http://localhost:8002/health | python3 -m json.tool
```

**预期响应**:
```json
{
  "status": "healthy",
  "service": "alert-normalizer",
  "timestamp": "2026-01-06T10:00:00.000000",
  "checks": {
    "database": "connected",
    "message_queue_consumer": "connected",
    "message_queue_publisher": "connected",
    "cache_size": 0
  }
}
```

### Step 7: 验证服务指标端点

```bash
# Alert Ingestor 指标
curl http://localhost:8001/metrics | python3 -m json.tool

# Alert Normalizer 指标
curl http://localhost:8002/metrics | python3 -m json.tool
```

### Step 8: 测试告警接入

#### 创建测试告警文件

```bash
cat > /tmp/test_alert.json <<'EOF'
{
  "alert_id": "test-2026-001",
  "timestamp": "2026-01-06T10:00:00Z",
  "alert_type": "malware",
  "severity": "high",
  "description": "Test malware alert from EDR system",
  "source_ip": "192.168.1.100",
  "target_ip": "10.0.0.50",
  "file_hash": "5d41402abc4b2a76b9719d911017c592",
  "url": "http://malicious.example.com/payload.exe",
  "asset_id": "SERVER-001",
  "user_id": "admin"
}
EOF
```

#### 提交测试告警

```bash
# 提交告警到 Alert Ingestor
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @/tmp/test_alert.json | python3 -m json.tool
```

**预期响应**:
```json
{
  "success": true,
  "data": {
    "ingestion_id": "<uuid>",
    "alert_id": "test-2026-001",
    "status": "queued",
    "message": "Alert queued for processing"
  },
  "meta": {
    "timestamp": "2026-01-06T10:00:00.000000",
    "request_id": "<uuid>"
  }
}
```

### Step 9: 验证消息队列

```bash
# 检查 alert.raw 队列消息数（应该 > 0）
curl -u admin:${RABBITMQ_PASSWORD} \
  http://localhost:15672/api/queues/%2F/alert.raw | python3 -m json.tool | grep messages

# 预期: 消息数 > 0（Alert Ingestor 已发布）

# 等待 5 秒后检查 alert.normalized 队列（应该 > 0）
sleep 5
curl -u admin:${RABBITMQ_PASSWORD} \
  http://localhost:15672/api/queues/%2F/alert.normalized | python3 -m json.tool | grep messages

# 预期: 消息数 > 0（Alert Normalizer 已消费并发布标准化告警）
```

### Step 10: 查看处理日志

```bash
# 查看 Alert Ingestor 日志
docker compose logs alert-ingestor | grep "test-2026-001"

# 查看 Alert Normalizer 日志
docker compose logs alert-normalizer | grep "test-2026-001"

# 预期: 看到处理成功的日志记录
```

### Step 11: 测试批量告警接入

```bash
# 创建批量告警文件
cat > /tmp/test_batch.json <<'EOF'
{
  "batch_id": "BATCH-TEST-001",
  "alerts": [
    {
      "alert_id": "batch-001",
      "timestamp": "2026-01-06T10:01:00Z",
      "alert_type": "phishing",
      "severity": "medium",
      "description": "Phishing email detected",
      "source_ip": "203.0.113.10",
      "url": "http://phishing.example.com"
    },
    {
      "alert_id": "batch-002",
      "timestamp": "2026-01-06T10:02:00Z",
      "alert_type": "brute_force",
      "severity": "high",
      "description": "SSH brute force attack",
      "source_ip": "198.51.100.20",
      "target_ip": "10.0.0.10",
      "asset_id": "SERVER-002"
    }
  ]
}
EOF

# 提交批量告警
curl -X POST http://localhost:8001/api/v1/alerts/batch \
  -H "Content-Type: application/json" \
  -d @/tmp/test_batch.json | python3 -m json.tool
```

**预期响应**:
```json
{
  "success": true,
  "data": {
    "batch_id": "BATCH-TEST-001",
    "total": 2,
    "successful": 2,
    "failed": 0,
    "ingestion_ids": ["<uuid1>", "<uuid2>"],
    "errors": null
  }
}
```

### Step 12: 测试速率限制

```bash
# 快速提交 101 个请求（测试速率限制）
for i in {1..101}; do
  curl -s -X POST http://localhost:8001/api/v1/alerts \
    -H "Content-Type: application/json" \
    -d "{\"alert_id\":\"rate-test-$i\",\"alert_type\":\"malware\",\"severity\":\"low\",\"description\":\"Rate limit test\"}" &
done
wait

# 检查响应，预期第 101 个请求返回 429 (Too Many Requests)
```

### Step 13: 测试告警去重

```bash
# 提交相同告警两次
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @/tmp/test_alert.json

sleep 2

curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @/tmp/test_alert.json

# 检查 Alert Normalizer 日志
docker compose logs alert-normalizer | grep "Duplicate alert"

# 预期: 第二个告警被标记为重复并跳过
```

### Step 14: 测试字段映射

```bash
# 测试 Splunk 格式告警
cat > /tmp/test_splunk.json <<'EOF'
{
  "result_id": "splunk-001",
  "_time": "2026-01-06T10:05:00Z",
  "category": "data_exfiltration",
  "severity": "critical",
  "message": "Large data transfer detected",
  "src_ip": "192.168.1.200",
  "dest_ip": "203.0.113.50",
  "user": "jdoe",
  "source_type": "splunk"
}
EOF

# 提交 Splunk 格式告警
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @/tmp/test_splunk.json

# 检查 Alert Normalizer 日志，验证字段映射成功
docker compose logs alert-normalizer | grep "splunk-001"
```

### Step 15: 运行集成测试

```bash
# 安装测试依赖
pip install pytest pytest-asyncio pytest-cov httpx

# 运行 Stage 1 集成测试（如果已实现）
PYTHONPATH=/Users/newmba/security/services/shared python3 -m pytest \
  tests/integration/test_ingestion_pipeline.py -v --tb=short

# 或者运行所有测试
PYTHONPATH=/Users/newmba/security/services/shared python3 -m pytest \
  tests/ -k "stage1" -v
```

---

## ✅ 部署验证

### 完整验证清单

```bash
# 1. 检查所有服务状态
docker compose ps

# 预期: 所有服务显示 "Up (healthy)"

# 2. 检查服务日志（无错误）
docker compose logs alert-ingestor | tail -50
docker compose logs alert-normalizer | tail -50

# 3. 测试告警接入端到端流程
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert_id":"verify-001","alert_type":"malware","severity":"high","description":"Verification test"}'

# 4. 验证消息流
sleep 3
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/queues/%2F/alert.raw
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/queues/%2F/alert.normalized

# 5. 测试健康检查
curl http://localhost:8001/health
curl http://localhost:8002/health

# 6. 检查服务指标
curl http://localhost:8001/metrics
curl http://localhost:8002/metrics
```

### 性能验证

```bash
# 使用 ab (Apache Bench) 进行性能测试
# 测试 100 个并发请求，共 1000 个请求
ab -n 1000 -c 100 -T application/json -p /tmp/test_alert.json \
  http://localhost:8001/api/v1/alerts

# 预期结果:
# - 成功率: > 99%
# - P95 延迟: < 100ms
# - 吞吐量: > 100 告警/秒
```

---

## 🔧 服务管理

### 查看服务状态

```bash
# 查看所有服务
docker compose ps

# 查看特定服务
docker compose ps alert-ingestor
docker compose ps alert-normalizer

# 查看服务资源使用
docker stats alert-ingestor alert-normalizer
```

### 查看日志

```bash
# 实时日志
docker compose logs -f alert-ingestor
docker compose logs -f alert-normalizer

# 最近 100 行日志
docker compose logs --tail=100 alert-ingestor

# 查看特定时间范围的日志
docker compose logs --since 2026-01-06T10:00:00 alert-ingestor
```

### 重启服务

```bash
# 重启单个服务
docker compose restart alert-ingestor

# 重启所有 Stage 1 服务
docker compose restart alert-ingestor alert-normalizer

# 重启并查看日志
docker compose restart alert-ingestor && docker compose logs -f alert-ingestor
```

### 停止服务

```bash
# 停止服务（保留容器）
docker compose stop alert-ingestor alert-normalizer

# 停止并删除容器
docker compose down alert-ingestor alert-normalizer

# 停止所有服务（包括 Stage 0）
docker compose down
```

### 更新服务

```bash
# 重新构建镜像
docker compose build alert-ingestor alert-normalizer

# 重启服务使用新镜像
docker compose up -d alert-ingestor alert-normalizer

# 查看更新后的日志
docker compose logs -f alert-ingestor alert-normalizer
```

---

## 🔍 监控和调试

### 查看 RabbitMQ 队列状态

```bash
# 通过 Management UI
# 打开浏览器: http://localhost:15672
# 用户名: admin
# 密码: (见 .env)

# 或通过 API
curl -u admin:${RABBITMQ_PASSWORD} \
  http://localhost:15672/api/queues/%2F | python3 -m json.tool
```

### 监控消息流量

```bash
# 实时监控队列消息数
watch -n 2 'curl -s -u admin:${RABBITMQ_PASSWORD} \
  http://localhost:15672/api/queues/%2F/alert.raw | python3 -m json.tool | grep messages'

# 获取消息速率
curl -u admin:${RABBITMQ_PASSWORD} \
  http://localhost:15672/api/queues/%2F/alert.raw | \
  python3 -m json.tool | grep -E "messages_unacknowledged|messages_ready"
```

### 查看数据库中的告警（如果已启用持久化）

```bash
# 连接到 PostgreSQL
docker exec -it security-triage-postgres psql -U triage_user -d security_triage

# 查询告警表
SELECT alert_id, alert_type, severity, timestamp FROM alerts ORDER BY timestamp DESC LIMIT 10;

# 查询告警总数
SELECT COUNT(*) FROM alerts;

# 退出
\q
```

### 性能分析

```bash
# 使用 py-spy 进行性能分析（需要在容器内安装）
# 安装
docker exec alert-ingestor pip install py-spy

# 运行 30 秒的性能分析
docker exec alert-ingestor py-spy top --pid 1 --duration 30

# 生成火焰图
docker exec alert-ingestor py-spy record --pid 1 --duration 30 --output /tmp/profile.svg
docker cp alert-ingestor:/tmp/profile.svg ./profile.svg
```

---

## 🐛 故障排查

### 常见问题

#### 1. 服务无法启动

**症状**:
```
alert-ingestor | Error: Database connection failed
```

**解决方案**:
```bash
# 检查 Stage 0 服务是否运行
docker compose ps postgres redis rabbitmq

# 验证数据库连接字符串
echo $DATABASE_URL

# 测试数据库连接
docker exec -it security-triage-postgres psql -U triage_user -d security_triage -c "SELECT 1;"

# 检查服务日志
docker compose logs alert-ingestor
```

#### 2. 告警未发布到消息队列

**症状**: RabbitMQ 队列消息数为 0

**解决方案**:
```bash
# 检查 RabbitMQ 连接
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/connections

# 检查服务日志中的错误
docker compose logs alert-ingestor | grep ERROR

# 验证环境变量
docker compose exec alert-ingestor env | grep RABBITMQ

# 重启服务
docker compose restart alert-ingestor
```

#### 3. Alert Normalizer 未消费消息

**症状**: `alert.raw` 队列消息堆积

**解决方案**:
```bash
# 检查 consumer 状态
curl -u admin:${RABBITMQ_PASSWORD} http://localhost:15672/api/queues/%2F/alert.raw | \
  python3 -m json.tool | grep consumers

# 查看服务日志
docker compose logs alert-normalizer | grep ERROR

# 检查消息格式
curl -u admin:${RABBITMQ_PASSWORD} \
  http://localhost:15672/api/queues/%2F/alert.raw/get | python3 -m json.tool

# 重启服务
docker compose restart alert-normalizer
```

#### 4. 去重不生效

**症状**: 重复告警被处理多次

**解决方案**:
```bash
# 检查缓存大小
curl http://localhost:8002/metrics | python3 -m json.tool | grep cache_size

# 查看去重日志
docker compose logs alert-normalizer | grep -i duplicate

# 如果缓存为 0，检查代码中的去重逻辑
docker compose exec alert-normalizer python -c "from main import processed_alerts_cache; print(len(processed_alerts_cache))"
```

#### 5. 速率限制不生效

**症状**: 能提交超过 100 req/min 的请求

**解决方案**:
```bash
# 检查 slowapi 是否正确配置
docker compose logs alert-ingestor | grep "Rate limiter"

# 手动测试速率限制
for i in {1..105}; do
  echo "Request $i:"
  curl -s -X POST http://localhost:8001/api/v1/alerts \
    -H "Content-Type: application/json" \
    -d '{"alert_id":"limit-'$i'","alert_type":"test","severity":"low","description":"test"}' | grep -i rate
done

# 预期: 第 101+ 个请求返回 429 错误
```

#### 6. 端口冲突

**症状**: `port is already allocated`

**解决方案**:
```bash
# 查看端口占用
sudo lsof -i :8001
sudo lsof -i :8002

# 停止占用端口的服务或修改 docker-compose.yml 中的端口映射
vim docker-compose.yml
# 修改 "8001:8000" 为 "8011:8000"

# 重启服务
docker compose up -d alert-ingestor alert-normalizer
```

---

## 📝 配置调优

### 性能调优

**Alert Ingestor**:
```yaml
# 在 docker-compose.yml 中添加资源限制
alert-ingestor:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 1G
      reservations:
        cpus: '0.5'
        memory: 512M
  environment:
    - WORKERS=4  # Uvicorn worker 数量
    - LOG_LEVEL=WARNING  # 减少日志输出
```

**Alert Normalizer**:
```yaml
alert-normalizer:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 1G
  environment:
    - CACHE_MAX_SIZE=50000  # 增加去重缓存大小
    - LOG_LEVEL=WARNING
```

### 缓存策略

**Redis 去重缓存** (生产环境推荐):
```python
# 修改 services/alert_normalizer/main.py
# 将内存缓存替换为 Redis 缓存

# 当前: 内存缓存
processed_alerts_cache: Set[str] = set()

# 改为: Redis 缓存
from shared.cache import RedisCache
cache = RedisCache(config.redis_url)

async def is_duplicate_alert(alert: dict) -> bool:
    fingerprint = generate_alert_fingerprint(alert)
    return await cache.exists(f"alert:{fingerprint}")
```

---

## 📊 监控和告警

### Prometheus 指标

服务暴露以下指标：

**Alert Ingestor**:
- `alerts_ingested_total` - 接入告警总数
- `alerts_ingested_rate` - 接入速率
- `validation_errors_total` - 验证错误数
- `rate_limit_violations_total` - 速率限制违规数

**Alert Normalizer**:
- `alerts_normalized_total` - 标准化告警总数
- `alerts_deduplicated_total` - 去重告警数
- `iocs_extracted_total` - 提取的 IOC 总数
- `processing_errors_total` - 处理错误数

### Grafana 仪表板

```bash
# 导入预配置的仪表板（如果已创建）
curl -X POST http://localhost:3000/api/dashboards/import \
  -u admin:${GRAFANA_PASSWORD} \
  -H "Content-Type: application/json" \
  -d @monitoring/grafana/dashboards/stage1-dashboard.json
```

---

## 🔄 更新和维护

### 滚动更新

```bash
# 更新镜像
docker compose build alert-ingestor alert-normalizer

# 滚动更新（先更新 alert-normalizer，因为 alert-ingestor 优先级更高）
docker compose up -d --no-deps alert-normalizer
sleep 10
docker compose up -d --no-deps alert-ingestor

# 验证更新
docker compose ps
curl http://localhost:8001/health
curl http://localhost:8002/health
```

### 回滚

```bash
# 如果更新失败，回滚到上一个版本
docker compose down alert-ingestor alert-normalizer

# 使用之前的镜像
docker compose up -d alert-ingestor alert-normalizer

# 或指定镜像版本
docker compose up -d --scale alert-ingestor=0
docker compose up -d --scale alert-ingestor=1 --image security-triage-alert-ingestor:previous-version
```

---

## 📚 API 接口文档

详细的 API 对接文档请参考：
- **API Integration Guide**: `/Users/newmba/security/API_INTEGRATION_GUIDE.md` (见下文)

### 快速参考

**提交单个告警**:
```bash
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "unique-id",
    "timestamp": "2026-01-06T10:00:00Z",
    "alert_type": "malware",
    "severity": "high",
    "description": "Alert description",
    "source_ip": "192.168.1.100",
    "target_ip": "10.0.0.1"
  }'
```

**提交批量告警**:
```bash
curl -X POST http://localhost:8001/api/v1/alerts/batch \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "BATCH-001",
    "alerts": [...]
  }'
```

**查询告警状态**:
```bash
curl http://localhost:8001/api/v1/alerts/{alert_id}
```

---

## 📈 性能基准

### 目标性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 单个告警接入延迟 | < 100ms P95 | ab 压测 |
| 批量告警接入（100个） | < 2s P95 | 批量 API 测试 |
| 消息队列吞吐量 | > 100 告警/秒 | RabbitMQ 统计 |
| 标准化延迟 | < 50ms/告警 | 服务日志时间戳 |
| 速率限制准确性 | 100 req/min | 速率测试脚本 |

### 性能测试脚本

```bash
#!/bin/bash
# performance_test.sh

echo "=== Stage 1 Performance Test ==="

# 1. 单个告警延迟测试
echo "Testing single alert latency..."
for i in {1..100}; do
  start=$(date +%s%N)
  curl -s -X POST http://localhost:8001/api/v1/alerts \
    -H "Content-Type: application/json" \
    -d "{\"alert_id\":\"perf-$i\",\"alert_type\":\"test\",\"severity\":\"low\",\"description\":\"test\"}" > /dev/null
  end=$(date +%s%N)
  latency=$((($end - $start) / 1000000))
  echo "Request $i: ${latency}ms"
done

# 2. 吞吐量测试
echo "Testing throughput..."
ab -n 10000 -c 100 -T application/json \
  -p /tmp/test_alert.json \
  http://localhost:8001/api/v1/alerts

echo "=== Performance Test Complete ==="
```

---

## 📚 相关文档

- **Stage 0 部署文档**: `/Users/newmba/security/STAGE0_DEPLOYMENT.md`
- **Stage 1 功能总结**: `/Users/newmba/security/STAGE1_SUMMARY.md`
- **API 对接指南**: `/Users/newmba/security/API_INTEGRATION_GUIDE.md`
- **架构设计**: `/Users/newmba/security/docs/README.md`

---

## 🆘 支持和联系

**问题反馈**: CCR <chenchunrun@gmail.com>
**文档版本**: 1.0
**最后更新**: 2026-01-06

---

**部署状态**: ⚠️ 待部署
**下一阶段**: Stage 2 - 数据增强服务部署
