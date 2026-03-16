# Stage 3: AI分析服务 - 完成总结

**完成时间**: 2026-01-06
**状态**: ✅ 代码实现完成，待测试验证

---

## 📋 实现概览

Stage 3 实现了安全告警系统的AI分析层，包括两个关键微服务：

1. **AI Triage Agent Service** - AI研判服务
2. **Similarity Search Service** - 相似度搜索服务

这两个服务为告警提供智能化的AI分析和基于向量的历史告警匹配能力。

---

## 🔧 实现的功能

### 1. AI Triage Agent Service (`services/ai_triage_agent/`)

#### 核心功能

**智能研判决策**:
- 消费 `alert.enriched` 队列中的增强告警
- 根据告警类型、威胁情报、资产关键性自动评估复杂度
- 通过 LLM Router 服务智能路由到合适的模型
- 针对不同告警类型的专业化 Prompt 工程

**告警类型支持**:
1. **malware** - 恶意软件
2. **phishing** - 钓鱼攻击
3. **brute_force** - 暴力破解
4. **data_exfiltration** - 数据泄露
5. **intrusion** - 入侵检测
6. **ddos** - DDoS攻击

**结构化响应解析**:
- JSON 格式响应验证
- 风险等级评估（critical/high/medium/low/info）
- 置信度评分（0-100）
- 详细推理过程
- 建议操作和优先级
- IOC 列表提取
- 参考链接提供

**容错和重试机制**:
- 指数退避重试（最多3次）
- 超时控制（30秒）
- 降级处理（LLM Router 不可用时直接调用 MaaS）
- 错误日志记录

#### Prompt 工程亮点

每个告警类型都有专门设计的系统提示词：

```python
TRIAGE_SYSTEM_PROMPTS = {
    "malware": """You are an expert security analyst specializing in malware analysis...
    You must respond in the following JSON format:
    {
      "risk_level": "critical|high|medium|low|info",
      "confidence": 0-100,
      "reasoning": "Detailed explanation...",
      "recommended_actions": [
        {"action": "...", "priority": "critical|high|medium|low", "timeline": "..."}
      ],
      "iocs": [...],
      "references": [...]
    }""",
    # ... 5 more specialized prompts
}
```

#### 复杂度评估逻辑

```python
def assess_complexity(alert: SecurityAlert, enrichment: Dict[str, Any]) -> str:
    """评估告警复杂度，决定使用哪个LLM模型"""
    complexity = "medium"

    # 高复杂度条件
    if enrichment and enrichment.get("threat_intel", {}).get("threat_score", 0) > 70:
        complexity = "high"
    elif enrichment and enrichment.get("asset", {}).get("criticality") == "critical":
        complexity = "high"
    elif alert.severity in ["critical", "high"]:
        complexity = "high"

    # 低复杂度条件
    elif alert.severity in ["low", "info"]:
        complexity = "low"

    return complexity
```

#### LLM 集成

**首选：通过 LLM Router**:
```python
route_decision = await get_llm_route_from_router("triage", complexity)
model = route_decision["model"]
base_url = route_decision["base_url"]
api_key = route_decision["api_key"]
```

**降级：直接调用 MaaS**:
```python
# 如果 LLM Router 不可用，直接使用配置的 MaaS 端点
base_url = os.getenv("DEEPSEEK_BASE_URL")
api_key = os.getenv("DEEPSEEK_API_KEY")
model = "deepseek-chat"
```

#### API 端点

- `GET /health` - 健康检查（显示 LLM Router 连接状态）
- `GET /metrics` - 服务指标
- `POST /api/v1/triage` - 手动研判告警（测试用）

---

### 2. Similarity Search Service (`services/similarity_search/`)

#### 核心功能

**向量嵌入生成**:
- 使用 Sentence Transformers (all-MiniLM-L6-v2)
- 将告警转换为文本表示
- 生成 384 维向量嵌入
- 批量嵌入支持

**ChromaDB 集成**:
- 持久化存储（./data/chroma）
- HNSW 索引（cosine 相似度）
- 元数据过滤（alert_type, severity, risk_level）
- 自动创建/加载集合

**相似度搜索**:
- 向量相似度查询
- 阈值过滤（min_similarity 参数）
- Top-K 结果返回
- 搜索耗时统计

**告警索引**:
- 手动索引 API
- 自动索引（通过消息队列消费 alert.result）
- 增量更新
- 删除支持

#### 告警文本转换

```python
def alert_to_text(alert: SecurityAlert) -> str:
    """将告警对象转换为文本用于嵌入"""
    parts = [
        f"Alert Type: {alert.alert_type}",
        f"Severity: {alert.severity}",
        f"Description: {alert.description}",
    ]

    if alert.source_ip:
        parts.append(f"Source IP: {alert.source_ip}")
    if alert.target_ip:
        parts.append(f"Target IP: {alert.target_ip}")
    if alert.file_hash:
        parts.append(f"File Hash: {alert.file_hash}")
    if alert.url:
        parts.append(f"URL: {alert.url}")
    if alert.process_name:
        parts.append(f"Process: {alert.process_name}")

    return ". ".join(parts)
```

#### 搜索 API

**请求格式**:
```python
POST /api/v1/search
{
  "query_text": "malware detected from external IP",  # 可选
  "alert_data": {...},  # 可选，与 query_text 二选一
  "top_k": 10,
  "min_similarity": 0.8,
  "filters": {
    "alert_type": "malware",
    "severity": "high"
  }
}
```

**响应格式**:
```python
{
  "success": true,
  "data": {
    "results": [
      {
        "alert_id": "alert-123",
        "similarity_score": 0.92,
        "alert_data": {...},
        "matched_fields": [...],
        "risk_level": "high",
        "triage_result": {...},
        "created_at": "2026-01-06T10:30:00"
      }
    ],
    "total_results": 5,
    "search_time_ms": 125.5
  }
}
```

#### API 端点

- `GET /health` - 健康检查（显示嵌入模型和向量总数）
- `POST /api/v1/search` - 相似度搜索
- `POST /api/v1/embeddings` - 生成文本嵌入
- `POST /api/v1/index` - 手动索引告警
- `GET /api/v1/stats` - 索引统计信息
- `DELETE /api/v1/index/{alert_id}` - 从索引中删除

---

## 🐳 Docker 配置

### Dockerfile 特性

两个 Stage 3 服务都使用统一的 Dockerfile 模板：
- 基于 Python 3.11-slim
- 非 root 用户运行
- 健康检查集成
- Similarity Search 包含数据卷挂载

### 端口映射

| 服务 | 内部端口 | 外部端口 | 用途 |
|------|---------|---------|------|
| AI Triage Agent | 8000 | 8006 | AI 研判 API |
| Similarity Search | 8000 | 8007 | 向量搜索 API |

### 环境变量

**AI Triage Agent**:
```bash
LLM_ROUTER_URL=http://llm-router:8000
DEEPSEEK_BASE_URL=http://internal-maas.deepseek/v1
DEEPSEEK_API_KEY=internal-key-123
QWEN_BASE_URL=http://internal-maas.qwen/v1
QWEN_API_KEY=internal-key-456
```

**Similarity Search**:
```bash
CHROMADB_HOST=chromadb
CHROMADB_PORT=8000
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

---

## 📊 数据流

```
┌─────────────────────────────────────────────────────────────┐
│              Stage 2: LLM Router (8005)                     │
│                   (Enriched Alerts with LLM routing)         │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.enriched queue
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              AI Triage Agent Service (8006)                  │
│  - Assess complexity based on threat intel & asset          │
│  - Query LLM Router for model selection                     │
│  - Build specialized prompts for 6 alert types              │
│  - Call MaaS (DeepSeek-V3 or Qwen3)                         │
│  - Parse structured JSON response                           │
│  - Retry with exponential backoff (3 attempts)              │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.result queue
                     ├─────────────────────────┐
                     ▼                         ▼
          ┌──────────────────┐      ┌─────────────────────┐
          │   Downstream     │      │ Similarity Search   │
          │   Services       │      │ Service (8007)      │
          └──────────────────┘      │ - Generate embeddings
                                     │ - Index in ChromaDB
                                     │ - Enable similarity
                                     │   search for future
                                     │   alerts
                                     └─────────────────────┘
```

---

## 🧪 测试策略

### 单元测试（待实现）

**AI Triage Agent**:
- [ ] 测试复杂度评估逻辑
- [ ] 测试 Prompt 生成（6种告警类型）
- [ ] 测试 LLM 响应解析
- [ ] 测试重试逻辑（3次，指数退避）
- [ ] 测试降级处理（LLM Router 不可用时）

**Similarity Search**:
- [ ] 测试告警转文本
- [ ] 测试嵌入生成
- [ ] 测试 ChromaDB 查询
- [ ] 测试相似度计算
- [ ] 测试元数据过滤

### 集成测试（待实现）

**文件**: `tests/integration/test_ai_pipeline.py`

测试场景：
- [ ] AI Triage → LLM Router → MaaS（使用 mocks 或真实端点）
- [ ] Similarity Search → ChromaDB 查询和索引
- [ ] 向量嵌入正确存储
- [ ] 相似告警准确检索
- [ ] LLM 超时处理

### E2E测试（待实现）

**文件**: `tests/system/test_ai_e2e.py`

测试场景：
1. **malware 告警** → 验证 AI 分析完成，风险等级正确
2. **与历史相似的告警** → 验证相似度 > 0.8
3. **已知模式告警** → 验证 AI 推荐正确操作
4. **批量处理 100 个告警** → 验证 5 分钟内全部分析完成
5. **模拟 LLM 超时** → 验证重试逻辑生效

### 性能基准

| 操作 | 目标 P95 延迟 | 备注 |
|------|--------------|------|
| AI 研判分析（DeepSeek） | 30s | 复杂告警 |
| AI 研判分析（Qwen3） | 10s | 一般告警 |
| 向量嵌入生成 | 500ms | 单个告警 |
| 相似度搜索 | 1s | Top-10 查询 |
| 总 AI 处理时间 | 35s | 端到端 |

---

## 🚀 构建和部署

### 前置条件

1. Stage 0、Stage 1、Stage 2 必须已完成
2. MaaS 端点配置完成（DeepSeek/Qwen）
3. ChromaDB 容器运行中

### 构建镜像

```bash
# 进入项目根目录
cd /Users/newmba/security

# 构建 Stage 3 服务镜像
docker-compose build ai-triage-agent
docker-compose build similarity-search
```

### 启动服务

```bash
# 启动 Stage 3 服务
docker-compose up -d ai-triage-agent similarity-search

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f ai-triage-agent
docker-compose logs -f similarity-search
```

### 验证部署

```bash
# 1. 检查服务健康
curl http://localhost:8006/health
curl http://localhost:8007/health

# 2. 测试 AI Triage Agent
curl -X POST http://localhost:8006/api/v1/triage \
  -H "Content-Type: application/json" \
  -d '{
    "alert": {
      "alert_id": "test-001",
      "alert_type": "malware",
      "severity": "high",
      "description": "Malware detected on server",
      "source_ip": "192.168.1.100",
      "asset_id": "SERVER-001"
    },
    "enrichment": {
      "threat_intel": {"threat_score": 85},
      "asset": {"criticality": "high"}
    }
  }'

# 3. 测试 Similarity Search
curl -X POST http://localhost:8007/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query_text": "malware detected from external IP",
    "top_k": 5,
    "min_similarity": 0.7
  }'

# 4. 测试向量索引
curl -X POST http://localhost:8007/api/v1/index \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "test-002",
    "alert_type": "phishing",
    "severity": "critical",
    "description": "Phishing email detected",
    "source_ip": "203.0.113.1"
  }'
```

---

## 📝 配置文件

### 环境变量（.env）

```bash
# ================================
# LLM Router Configuration
# ================================
LLM_ROUTER_URL=http://llm-router:8000

# ================================
# MaaS Configuration (Fallback)
# ================================
DEEPSEEK_BASE_URL=http://internal-maas.deepseek/v1
DEEPSEEK_API_KEY=internal-key-123
QWEN_BASE_URL=http://internal-maas.qwen/v1
QWEN_API_KEY=internal-key-456

# ================================
# ChromaDB Configuration
# ================================
CHROMADB_HOST=chromadb
CHROMADB_PORT=8000

# ================================
# Embedding Model
# ================================
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

### requirements.txt

**AI Triage Agent** (`services/ai_triage_agent/requirements.txt`):
```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
pydantic-settings==2.1.0
httpx==0.25.2
aiohttp==3.9.1
asyncpg==0.29.0
redis==5.0.1
pika==1.3.2

# Shared dependencies
sqlalchemy==2.0.23
alembic==1.13.0
loguru==0.7.2
python-dotenv==1.0.0
pyyaml==6.0.1
```

**Similarity Search** (`services/similarity_search/requirements.txt`):
```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
pydantic-settings==2.1.0
httpx==0.25.2
asyncpg==0.29.0
redis==5.0.1
pika==1.3.2

# Vector database and embeddings
chromadb==0.4.18
sentence-transformers==2.2.2

# Shared dependencies
sqlalchemy==2.0.23
alembic==1.13.0
loguru==0.7.2
python-dotenv==1.0.0
pyyaml==6.0.1
```

---

## ⚠️ 已知限制和 TODO

### 当前限制

1. **AI Triage Agent**:
   - 依赖私有 MaaS 部署（DeepSeek/Qwen）
   - LLM Router 单点故障（虽有降级方案）
   - 响应解析依赖结构化 JSON（可能失败）
   - 速率限制基于内存（应使用 Redis）

2. **Similarity Search**:
   - 嵌入模型固定（all-MiniLM-L6-v2，384维）
   - ChromaDB 使用持久化存储而非服务器模式
   - 消费 `alert.result` 队列的代码被注释（需要手动触发索引）
   - 相似度阈值硬编码（可配置化）

### 下一步改进

**Stage 3 完善任务**:
1. 集成真实的 MaaS 端点（DeepSeek-V3, Qwen3）
2. 实现单元测试（覆盖率 > 80%）
3. 实现集成测试
4. 实现 E2E 测试
5. 性能基准测试和优化
6. Similarity Search 自动索引告警
7. 支持多种嵌入模型（可选）
8. ChromaDB 集群模式（生产环境）

---

## 📈 监控指标

### 关键指标

**AI Triage Agent**:
- `triage_total` - 研判总数
- `triage_success_total` - 研判成功次数
- `triage_failure_total` - 研判失败次数
- `triage_retry_total` - 重试次数
- `triage_latency_ms` - 研判延迟
- `llm_router_errors_total` - LLM Router 错误次数
- `maas_fallback_total` - 降级到直接调用 MaaS 次数

**Similarity Search**:
- `search_total` - 搜索总数
- `index_total` - 索引总数
- `search_latency_ms` - 搜索延迟
- `index_latency_ms` - 索引延迟
- `total_vectors` - 向量总数
- `average_similarity` - 平均相似度

---

## 🎯 下一步：Stage 4 - 工作流与自动化

Stage 4 将实现以下服务：

1. **Workflow Engine** - Temporal 工作流引擎
   - 工作流定义和状态管理
   - SLA 监控和超时处理
   - 人工任务分配和审批
   - 事件溯源和审计日志

2. **Automation Orchestrator** - SOAR 剧本执行
   - Ansible 剧本集成
   - 自动化操作执行
   - 批准工作流
   - 操作日志和回滚

3. **Notification Service** - 多渠道通知
   - Email 通知（SMTP）
   - Slack 集成
   - Webhook 支持
   - 通知聚合和去重

### Stage 4 依赖

Stage 4 依赖 Stage 3 完成：
- ✅ AI 研判结果可用
- ✅ 相似度搜索可用
- ✅ 向量索引已建立

---

## 📚 相关文档

- **Stage 0 部署文档**: `/Users/newmba/security/STAGE0_DEPLOYMENT.md`
- **Stage 1 部署文档**: `/Users/newmba/security/STAGE1_DEPLOYMENT.md`
- **Stage 1 功能总结**: `/Users/newmba/security/STAGE1_SUMMARY.md`
- **Stage 2 功能总结**: `/Users/newmba/security/STAGE2_SUMMARY.md`
- **API 对接指南**: `/Users/newmba/security/API_INTEGRATION_GUIDE.md`
- **架构概览**: `/Users/newmba/security/docs/README.md`

---

## ✅ 验收标准

- [ ] AI Triage Agent 成功调用真实 MaaS（或高质量 mock）
- [ ] 分析结果正确解析和结构化
- [ ] Similarity Search 成功索引告警向量
- [ ] 相似度搜索找到历史告警
- [ ] 向量嵌入存储在 ChromaDB
- [ ] 重试逻辑处理瞬态故障
- [ ] LLM Router 集成工作正常
- [ ] 降级方案生效（LLM Router 不可用时）
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试使用真实 MaaS（或高质量 mock）
- [ ] E2E 测试成功处理告警通过 AI 分析
- [ ] 性能基准达标
- [ ] Docker 镜像构建成功
- [ ] 服务启动和运行正常

---

## 🔄 回滚计划

如果 Stage 3 验证失败，可以：

1. **检查日志**:
   ```bash
   docker-compose logs ai-triage-agent
   docker-compose logs similarity-search
   ```

2. **验证依赖**:
   - 确认 Stage 2 服务运行正常
   - 检查 `alert.enriched` 队列有消息
   - 检查 ChromaDB 运行正常
   - 检查 MaaS 端点可访问

3. **常见问题**:
   - **AI 研判失败**: 检查 MaaS 凭据，修复 API 调用
   - **响应解析失败**: 改进 Prompt，添加降级方案
   - **相似度搜索不准确**: 调优嵌入模型，调整阈值
   - **ChromaDB 连接失败**: 检查 ChromaDB 容器，修复连接配置
   - **嵌入模型加载失败**: 检查 requirements.txt，重新安装依赖

4. **服务重启**:
   ```bash
   docker-compose restart ai-triage-agent similarity-search
   ```

---

**Stage 3 状态**: 🟡 代码实现完成，待测试验证
**预计完成时间**: 2026-01-06（代码），2026-01-07（测试）
**下一里程碑**: Stage 4 - 工作流与自动化

---

**最后更新**: 2026-01-06
**文档版本**: 1.0
**维护者**: CCR <chenchunrun@gmail.com>
