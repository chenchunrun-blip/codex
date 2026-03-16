# Stage 1: 核心接入服务 - 完成总结

**完成时间**: 2026-01-06
**状态**: ✅ 代码实现完成，待测试验证

---

## 📋 实现概览

Stage 1 实现了安全告警系统的核心接入层，包括两个关键微服务：

1. **Alert Ingestor Service** - 多协议告警接入服务
2. **Alert Normalizer Service** - 告警标准化服务

这两个服务构成了整个系统的入口，负责接收来自各种来源的原始告警，并将其转换为标准格式供下游服务处理。

---

## 🔧 实现的功能

### 1. Alert Ingestor Service (`services/alert_ingestor/`)

#### 核心功能

**REST API 接入**:
- `POST /api/v1/alerts` - 接收单个告警
- `POST /api/v1/alerts/batch` - 批量接收告警（最多100个）
- `GET /api/v1/alerts/{alert_id}` - 查询告警状态
- `GET /health` - 健康检查端点
- `GET /metrics` - 服务指标端点

**请求验证**:
- Pydantic 模型验证 (`SecurityAlert`, `AlertBatch`)
- 必填字段检查（alert_id）
- 数据类型验证
- 自动类型转换

**速率限制**:
- 100 请求/分钟/IP
- 基于 slowapi 的速率限制器
- 内存回退机制（如果 slowapi 不可用）
- 自动清理过期请求记录

**消息发布**:
- 发布到 RabbitMQ `alert.raw` 队列
- 消息格式标准化
- 包含 correlation_id 用于追踪

**错误处理**:
- HTTP 400 - 验证错误
- HTTP 429 - 速率限制超出
- HTTP 500 - 服务器内部错误
- 详细错误日志记录

**生命周期管理**:
- 优雅启动（数据库 → 消息队列）
- 优雅关闭（消息队列 → 数据库）
- 健康检查集成

#### 技术亮点

```python
# 速率限制中间件
limiter = Limiter(key_func=get_remote_address)

# 请求验证
@app.post("/api/v1/alerts", dependencies=[Depends(check_rate_limit)])
async def ingest_alert(request: Request, alert: SecurityAlert):
    # 验证告警ID
    if not alert.alert_id:
        raise HTTPException(status_code=400, detail="alert_id is required")

    # 发布到消息队列
    await message_publisher.publish("alert.raw", message)

    # 详细日志记录
    logger.info("Alert ingested successfully", extra={
        "ingestion_id": ingestion_id,
        "alert_id": alert.alert_id,
        "client_ip": request.client.host,
    })
```

---

### 2. Alert Normalizer Service (`services/alert_normalizer/`)

#### 核心功能

**多源字段映射**:
- **Splunk 格式**: 支持 result_id, _time, src_ip 等
- **QRadar 格式**: 支持 start_time, source_address, dest_address 等
- **默认格式**: 通用字段映射
- 优先级字段查找（尝试多个可能的字段名）

**IOC 提取**:
- IP 地址提取（带范围验证）
- 文件哈希提取（MD5, SHA1, SHA256）
- URL 和域名提取
- 邮箱地址提取
- 去重处理

**告警去重**:
- 基于 SHA256 的指纹生成
- 关键字段：alert_type, source_ip, target_ip, file_hash, url, asset_id, user_id
- 内存缓存（最多 10,000 条记录）
- 自动清理机制

**时间戳解析**:
- 支持 ISO 8601 格式
- 支持带时区的时间戳
- 支持多种日期格式
- 回退到当前时间（如果解析失败）

**严重性映射**:
- critical → Severity.CRITICAL
- high → Severity.HIGH
- medium → Severity.MEDIUM
- low → Severity.LOW
- info → Severity.INFO
- 默认: medium

**数据验证**:
- IP 地址格式验证
- 文件哈希长度验证（32/40/64 字符）
- URL 格式验证
- 必填字段检查

**消息处理**:
- 消费 `alert.raw` 队列
- 发布到 `alert.normalized` 队列
- 错误消息处理（TODO: 死信队列）
- 详细的处理日志

#### 技术亮点

```python
# 字段映射函数
def map_field(raw_alert: dict, source_type: str, target_field: str) -> Any:
    """从原始告警映射字段到标准格式"""
    mappings = FIELD_MAPPINGS.get(source_type, FIELD_MAPPINGS["default"])
    possible_fields = mappings.get(target_field, [target_field])

    for field in possible_fields:
        if field in raw_alert and raw_alert[field] is not None:
            return raw_alert[field]
    return None

# IOC 提取
def extract_iocs(raw_alert: dict) -> Dict[str, List[str]]:
    """提取威胁指标（IPs, hashes, URLs）"""
    iocs = {
        "ip_addresses": [],
        "file_hashes": [],
        "urls": [],
        "domains": [],
        "email_addresses": [],
    }

    # IP 地址提取
    ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
    ip_matches = re.findall(ip_pattern, alert_text)
    # 验证 IP 范围
    if all(0 <= int(part) <= 255 for part in ip.split('.')):
        iocs["ip_addresses"].append(ip)

    # 文件哈希提取（MD5, SHA1, SHA256）
    md5_pattern = r'\b[a-fA-F0-9]{32}\b'
    sha1_pattern = r'\b[a-fA-F0-9]{40}\b'
    sha256_pattern = r'\b[a-fA-F0-9]{64}\b'

    return iocs

# 去重逻辑
def generate_alert_fingerprint(alert: dict) -> str:
    """生成告警指纹用于去重"""
    key_fields = [
        alert.get("alert_type", ""),
        alert.get("source_ip", ""),
        alert.get("target_ip", ""),
        alert.get("file_hash", ""),
        alert.get("url", ""),
        alert.get("asset_id", ""),
        alert.get("user_id", ""),
    ]
    fingerprint_str = "|".join(str(f) for f in key_fields if f)
    return hashlib.sha256(fingerprint_str.encode()).hexdigest()
```

---

## 🐳 Docker 配置

### Dockerfile 特性

**Alert Ingestor Dockerfile** (`services/alert_ingestor/Dockerfile`):
- 基于 Python 3.11-slim
- 多阶段构建优化
- 非 root 用户运行（appuser:1001）
- 健康检查集成
- 环境变量优化
- 依赖缓存优化

**Alert Normalizer Dockerfile** (`services/alert_normalizer/Dockerfile`):
- 相同的基础镜像和配置
- 服务特定的 PYTHONPATH 设置
- 内部端口 8000，外部端口 8002

### Docker Compose 配置

**服务依赖**:
```yaml
alert-ingestor:
  depends_on:
    postgres: {condition: service_healthy}
    redis: {condition: service_healthy}
    rabbitmq: {condition: service_healthy}

alert-normalizer:
  depends_on:
    postgres: {condition: service_healthy}
    redis: {condition: service_healthy}
    rabbitmq: {condition: service_healthy}
    alert-ingestor: {condition: service_healthy}
```

**端口映射**:
- Alert Ingestor: `8001:8000` (主机:容器)
- Alert Normalizer: `8002:8000` (主机:容器)

**环境变量**:
- 数据库连接: `DATABASE_URL`
- Redis 连接: `REDIS_URL`
- RabbitMQ 连接: `RABBITMQ_URL`
- 应用配置: `HOST`, `PORT`, `LOG_LEVEL`

**健康检查**:
- HTTP GET `/health` 端点
- 10 秒间隔
- 5 秒超时
- 5 次重试
- 10 秒启动期

---

## 📊 消息流

```
┌─────────────────┐
│ Alert Source    │
│ (SIEM/IDS/etc)  │
└────────┬────────┘
         │ HTTP POST
         ▼
┌─────────────────────────────┐
│  Alert Ingestor Service     │
│  - Port 8001                │
│  - Rate Limiting            │
│  - Validation               │
└────────┬────────────────────┘
         │ Publish
         ▼
┌─────────────────────────────┐
│  RabbitMQ: alert.raw        │
└────────┬────────────────────┘
         │ Consume
         ▼
┌─────────────────────────────┐
│  Alert Normalizer Service   │
│  - Port 8002                │
│  - Field Mapping            │
│  - IOC Extraction           │
│  - Deduplication            │
└────────┬────────────────────┘
         │ Publish
         ▼
┌─────────────────────────────┐
│  RabbitMQ: alert.normalized │
└─────────────────────────────┘
```

---

## 🧪 测试策略

### 单元测试（待实现）

**Alert Ingestor** (`tests/unit/test_alert_ingestor.py`):
- [ ] 测试速率限制逻辑
- [ ] 测试请求验证
- [ ] 测试消息序列化
- [ ] 测试错误处理
- [ ] 测试健康检查

**Alert Normalizer** (`tests/unit/test_alert_normalizer.py`):
- [ ] 测试字段映射函数（Splunk, QRadar, default）
- [ ] 测试 IOC 提取（IPs, hashes, URLs）
- [ ] 测试指纹生成
- [ ] 测试去重逻辑
- [ ] 测试时间戳解析
- [ ] 测试严重性映射
- [ ] 测试数据验证

**目标覆盖率**: > 85%

### 集成测试（待实现）

**文件**: `tests/integration/test_ingestion_pipeline.py`

测试场景：
- [ ] Alert Ingestor → RabbitMQ 消息发布
- [ ] Alert Normalizer 消费 `alert.raw`
- [ ] 字段映射端到端（Splunk, QRadar, default）
- [ ] IOC 提取准确性
- [ ] 去重逻辑验证
- [ ] 错误处理（格式错误的告警）
- [ ] 消息持久化（RabbitMQ 重启）

### E2E 测试（待实现）

**文件**: `tests/system/test_ingestion_e2e.py`

测试场景：
1. **单个告警处理**:
   - 提交告警 → 验证在 `alert.normalized` 队列中
2. **批量告警处理**:
   - 提交 100 个告警 → 验证全部处理成功
3. **格式错误告警**:
   - 提交无效 JSON → 验证返回 400 错误
4. **重复告警**:
   - 提交相同告警 2 次 → 验证去重生效
5. **速率限制**:
   - 快速提交 101 个请求 → 验证第 101 个被限流

### 性能基准（待验证）

**目标指标**:
- 单个告警接入延迟: < 100ms P95
- 批量告警接入（100 个）: < 2s P95
- 消息队列吞吐量: > 100 告警/秒
- 标准化延迟: < 50ms/告警

---

## 🚀 构建和部署

### 前置条件

1. 确保已完成 Stage 0 基础设施设置
2. Docker 和 Docker Compose 已安装
3. `.env` 文件已配置

### 构建镜像

```bash
# 进入项目根目录
cd /Users/newmba/security

# 构建 Stage 1 服务镜像
docker-compose build alert-ingestor alert-normalizer

# 或构建所有服务（包括 Stage 0 基础设施）
docker-compose build
```

### 启动服务

```bash
# 启动 Stage 0 基础设施（如果尚未运行）
docker-compose up -d postgres redis rabbitmq

# 等待基础设施健康
docker-compose ps

# 启动 Stage 1 服务
docker-compose up -d alert-ingestor alert-normalizer

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f alert-ingestor
docker-compose logs -f alert-normalizer
```

### 验证部署

```bash
# 1. 检查服务健康
curl http://localhost:8001/health
curl http://localhost:8002/health

# 预期输出:
# {"status":"healthy","service":"alert-ingestor",...}
# {"status":"healthy","service":"alert-normalizer",...}

# 2. 检查服务指标
curl http://localhost:8001/metrics
curl http://localhost:8002/metrics

# 3. 提交测试告警
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "test-001",
    "timestamp": "2026-01-06T10:00:00Z",
    "alert_type": "malware",
    "severity": "high",
    "description": "Test alert",
    "source_ip": "192.168.1.100",
    "target_ip": "10.0.0.1"
  }'

# 4. 检查 RabbitMQ 队列
curl -u admin:password http://localhost:15672/api/queues/%2F/alert.raw
curl -u admin:password http://localhost:15672/api/queues/%2F/alert.normalized
```

---

## 📝 配置文件

### 环境变量（.env）

```bash
# Database
DATABASE_URL=postgresql+asyncpg://triage_user:triage_password_change_me@localhost:5432/security_triage
DB_PASSWORD=triage_password_change_me

# Redis
REDIS_URL=redis://:redis_password_change_me@localhost:6379/0
REDIS_PASSWORD=redis_password_change_me

# RabbitMQ
RABBITMQ_URL=amqp://admin:rabbitmq_password_change_me@localhost:5672/
RABBITMQ_PASSWORD=rabbitmq_password_change_me

# Application
HOST=0.0.0.0
PORT=8000
LOG_LEVEL=INFO
DEBUG=false
```

### 日志配置

服务使用结构化 JSON 日志，包含以下字段：
- `timestamp` - ISO 8601 时间戳
- `level` - 日志级别（DEBUG, INFO, WARNING, ERROR, CRITICAL）
- `message` - 日志消息
- `logger` - 日志记录器名称
- `extra` - 上下文数据（alert_id, ingestion_id, client_ip 等）

---

## ⚠️ 已知限制和 TODO

### 当前限制

1. **数据库持久化未启用**:
   - Alert Ingestor 中的数据库插入代码已注释（line 220-243）
   - 待数据库表结构完全验证后启用

2. **去重使用内存缓存**:
   - 当前使用 Python `set` 存储指纹
   - 服务重启后会丢失缓存
   - 生产环境应使用 Redis

3. **死信队列未实现**:
   - 处理失败的告警未发送到死信队列
   - Alert Normalizer line 503, 506 标记了 TODO

4. **Webhook 接收未实现**:
   - 仅支持 REST API 接入
   - Webhook 端点计划在 Stage 2 实现

5. **Syslog 接收未实现**:
   - Syslog 服务器未实现
   - 优先级：P2（非关键）

### 下一步改进

**Stage 1 完善任务**:
1. 启用数据库持久化
2. 实现死信队列处理
3. 添加 Redis 去重缓存
4. 实现单元测试（覆盖率 > 85%）
5. 实现集成测试
6. 实现 E2E 测试
7. 性能基准测试和优化

---

## 📈 监控指标

### 关键指标

**Alert Ingestor**:
- `alerts_ingested_total` - 接入告警总数
- `alerts_ingested_rate` - 接入速率（告警/秒）
- `validation_errors_total` - 验证错误数
- `rate_limit_violations_total` - 速率限制违规数
- `processing_latency_ms` - 处理延迟（毫秒）

**Alert Normalizer**:
- `alerts_normalized_total` - 标准化告警总数
- `alerts_deduplicated_total` - 去重告警数
- `iocs_extracted_total` - 提取的 IOC 总数
- `processing_errors_total` - 处理错误数
- `processing_latency_ms` - 处理延迟（毫秒）

### Prometheus 集成

服务暴露 `/metrics` 端点供 Prometheus 抓取：
```bash
curl http://localhost:8001/metrics
curl http://localhost:8002/metrics
```

---

## 🎯 下一步：Stage 2 - 数据增强服务

Stage 2 将实现以下服务：

1. **Context Collector** - 上下文收集服务
   - GeoIP 查询
   - CMDB 资产查询
   - 用户目录查询
   - 缓存策略（Redis，TTL 1小时）

2. **Threat Intel Aggregator** - 威胁情报聚合服务
   - VirusTotal API
   - Abuse.ch API
   - 结果聚合和评分
   - 缓存管理（Redis，TTL 24小时）

3. **LLM Router** - LLM 路由服务
   - 根据任务复杂度路由 MaaS
   - DeepSeek-V3（复杂分析）
   - Qwen3（一般分析）
   - 健康检查和故障切换

### Stage 2 依赖

Stage 2 依赖 Stage 1 完成：
- ✅ `alert.normalized` 队列存在
- ✅ 标准化告警格式可用
- ✅ IOC 已提取并附加

---

## 📚 相关文档

- **Stage 0 指南**: `/Users/newmba/security/STAGE0_GUIDE.md`
- **Stage 0 检查清单**: `/Users/newmba/security/STAGE0_CHECKLIST.md`
- **架构概览**: `/Users/newmba/security/docs/README.md`
- **API 规范**: `/Users/newmba/security/docs/05_api_design.md`
- **编码标准**: `/Users/newmba/security/standards/01_coding_standards.md`

---

## ✅ 验收标准

- [x] Alert Ingestor 实现 REST API 接入
- [x] Alert Ingestor 实现速率限制（100 req/min）
- [x] Alert Ingestor 实现请求验证
- [x] Alert Ingestor 发布消息到 `alert.raw` 队列
- [x] Alert Normalizer 消费 `alert.raw` 队列
- [x] Alert Normalizer 实现字段映射（Splunk, QRadar, default）
- [x] Alert Normalizer 实现 IOC 提取
- [x] Alert Normalizer 实现去重逻辑
- [x] Alert Normalizer 发布到 `alert.normalized` 队列
- [x] 两个服务都创建了 Dockerfile
- [x] 两个服务已添加到 docker-compose.yml
- [x] 健康检查端点实现
- [x] 结构化日志记录
- [x] 优雅启动和关闭
- [ ] 单元测试实现（覆盖率 > 85%）
- [ ] 集成测试实现
- [ ] E2E 测试实现
- [ ] 性能基准验证
- [ ] Docker 镜像构建成功
- [ ] 服务启动和运行正常

---

## 🔄 回滚计划

如果 Stage 1 验证失败，可以：

1. **检查日志**:
   ```bash
   docker-compose logs alert-ingestor
   docker-compose logs alert-normalizer
   ```

2. **验证依赖**:
   - 确认 Stage 0 基础设施运行正常
   - 检查数据库连接
   - 检查 RabbitMQ 连接
   - 检查 Redis 连接

3. **常见问题**:
   - **告警未发布**: 检查 RabbitMQ 连接配置
   - **标准化失败**: 检查字段映射逻辑
   - **性能问题**: 启用数据库查询优化
   - **内存泄漏**: 检查去重缓存清理逻辑

4. **服务重启**:
   ```bash
   docker-compose restart alert-ingestor alert-normalizer
   ```

5. **完全清理**:
   ```bash
   docker-compose down alert-ingestor alert-normalizer
   docker-compose up -d alert-ingestor alert-normalizer
   ```

---

**Stage 1 状态**: 🟡 代码实现完成，待测试验证
**预计完成时间**: 2026-01-06（代码），2026-01-07（测试）
**下一里程碑**: Stage 2 - 数据增强服务

---

**最后更新**: 2026-01-06
**文档版本**: 1.0
**维护者**: CCR <chenchunrun@gmail.com>
