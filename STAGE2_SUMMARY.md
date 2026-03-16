# Stage 2: 数据增强服务 - 完成总结

**完成时间**: 2026-01-06
**状态**: ✅ 代码实现完成，待测试验证

---

## 📋 实现概览

Stage 2 实现了安全告警系统的数据增强层，包括三个关键微服务：

1. **Context Collector Service** - 上下文收集服务
2. **Threat Intel Aggregator Service** - 威胁情报聚合服务
3. **LLM Router Service** - LLM 智能路由服务

这三个服务为告警提供丰富的上下文信息、威胁情报数据，并为后续的 AI 分析提供智能路由能力。

---

## 🔧 实现的功能

### 1. Context Collector Service (`services/context_collector/`)

#### 核心功能

**网络上下文收集**:
- 内网/外网 IP 识别（自动检测私有网络）
- 子网信息计算（CIDR 格式）
- IP 声誉评分（0-100）
- GeoIP 信息（预留接口，需集成 MaxMind/IPInfo）
- WHOIS 数据（预留接口）
- 网络类型分类

**资产上下文收集**:
- CMDB 数据查询（预留接口，支持 ServiceNow/BMC）
- 资产类型识别
- 关键级别评估
- 位置和网络区域信息
- 业务单元归属
- 环境分类

**用户上下文收集**:
- 目录服务查询（预留接口，支持 AD/Azure AD/Okta）
- 用户权限级别
- 部门和职位信息
- 账户状态检查
- 最近登录时间
- 用户组信息

**缓存管理**:
- 内存缓存（TTL 1小时）
- 自动过期清理
- 缓存命中率优化

#### 技术亮点

```python
# 内网 IP 检测
INTERNAL_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
]

def is_internal_ip(ip_str: str) -> bool:
    ip = ipaddress.ip_address(ip_str)
    return any(ip in network for network in INTERNAL_NETWORKS)

# 子网计算
def get_subnet(ip: str) -> str:
    # Class C private: /24 (typical)
    return f"{'.'.join(ip.split('.')[:3])}.0/24"

# 缓存管理
async def cleanup_cache():
    """每5分钟清理过期缓存"""
    while True:
        expired_keys = [key for key, (_, expiry) in context_cache.items()
                       if datetime.utcnow().timestamp() >= expiry]
        for key in expired_keys:
            del context_cache[key]
        await asyncio.sleep(300)
```

#### API 端点

- `GET /health` - 健康检查
- `GET /metrics` - 服务指标
- `POST /api/v1/enrich` - 手动增强告警（测试用）

---

### 2. Threat Intel Aggregator Service (`services/threat_intel_aggregator/`)

#### 核心功能

**多源威胁情报查询**:
- **VirusTotal**: IP/Hash/URL 查询（需要 API key）
- **Abuse.ch**: SSLBL/URLhaus 查询（免费 API）
- **AlienVault OTX**: （预留接口）
- **自定义内部黑名单**: IP/Hash/URL 拦截列表

**并发查询**:
- 异步并发查询所有源
- 超时控制（10秒）
- 错误隔离和降级

**结果聚合和评分**:
- 威胁评分计算（0-100，越高越恶意）
- 检测源数量统计
- 指标汇总

**缓存策略**:
- 内存缓存（TTL 24小时）
- 减少 API 调用
- 提升响应速度

#### 技术亮点

```python
class ThreatIntelSource:
    """威胁情报源基类"""
    async def query_ip(self, ip: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

class VirusTotalSource(ThreatIntelSource):
    """VirusTotal 集成"""
    async def query_ip(self, ip: str):
        params = {"ip": ip, "apikey": self.api_key}
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=10) as response:
                return self._parse_ip_response(await response.json())

# 并发查询
async def query_threat_intel(ip=None, file_hash=None, url=None):
    tasks = []
    if ip:
        for source in threat_sources:
            if source.enabled:
                tasks.append(source.query_ip(ip))

    responses = await asyncio.gather(*tasks, return_exceptions=True)

    # 计算威胁评分
    detected_ratio = sources_found / sources_queried
    threat_score = detected_ratio * 100
```

#### 威胁评分

| 检测源占比 | 威胁评分 | 含义 |
|-----------|---------|------|
| 0% | 0 | 所有源均未检测到威胁 |
| 33% | 33 | 少数源检测到威胁 |
| 66% | 66 | 多数源检测到威胁 |
| 100% | 100 | 所有源均检测到威胁 |

#### API 端点

- `GET /health` - 健康检查（显示启用的威胁情报源）
- `GET /metrics` - 服务指标
- `POST /api/v1/query` - 手动查询威胁情报

---

### 3. LLM Router Service (`services/llm_router/`)

#### 核心功能

**智能路由决策**:
- 根据任务复杂度路由到合适的模型
- DeepSeek-V3: 复杂分析（深度推理）
- Qwen3-Max/Plus: 一般分析
- Qwen3-Turbo: 快速分类/摘要

**模型能力注册表**:
- 最大上下文长度
- 流式输出支持
- 成本（每1k tokens）
- 速度评分（1-10）
- 推理质量评分（1-10）
- 适用任务类型

**健康检查和故障切换**:
- 模型可用性检测
- 自动故障切换
- 降级策略

**速率限制**:
- 每个模型独立的速率限制
- 请求队列管理
- 优先级调度

#### 模型对比

| 模型 | 上下文 | 速度 | 推理质量 | 最佳场景 | 成本 |
|------|--------|------|----------|----------|------|
| DeepSeek-V3 | 32k | 8/10 | 9/10 | 深度分析、研判 | 低 |
| DeepSeek-Coder | 16k | 9/10 | 7/10 | 代码审查、分类 | 极低 |
| Qwen3-Max | 32k | 7/10 | 10/10 | 复杂分析、研判 | 中 |
| Qwen3-Plus | 32k | 8/10 | 8/10 | 研判、摘要 | 低 |
| Qwen3-Turbo | 8k | 10/10 | 6/10 | 分类、快速响应 | 极低 |

#### 路由逻辑

```python
def route_task(task_type: TaskType, complexity: str) -> LLMModel:
    """
    智能路由决策

    Args:
        task_type: 任务类型（TRIAGE, ANALYSIS, CLASSIFICATION, etc）
        complexity: 复杂度（high, medium, low）

    Returns:
        推荐的 LLM 模型
    """
    if complexity == "high":
        if task_type in [TaskType.TRIAGE, TaskType.ANALYSIS]:
            return LLMModel.DEEPSEEK_V3  # 深度推理
        else:
            return LLMModel.QWEN3_MAX

    elif complexity == "medium":
        if task_type == TaskType.CLASSIFICATION:
            return LLMModel.QWEN3_TURBO  # 快速分类
        else:
            return LLMModel.QWEN3_PLUS

    else:  # low
        return LLMModel.QWEN3_TURBO  # 最快速
```

#### API 端点

- `GET /health` - 健康检查
- `POST /api/v1/route` - 获取路由决策
- `POST /api/v1/complete` - 路由并完成 LLM 请求
- `GET /api/v1/models` - 列出所有可用模型
- `GET /metrics` - 服务指标

---

## 🐳 Docker 配置

### Dockerfile 特性

所有 Stage 2 服务使用统一的 Dockerfile 模板：
- 基于 Python 3.11-slim
- 非 root 用户运行
- 健康检查集成
- 环境变量优化

### 端口映射

| 服务 | 内部端口 | 外部端口 | 用途 |
|------|---------|---------|------|
| Context Collector | 8000 | 8003 | 上下文收集 API |
| Threat Intel Aggregator | 8000 | 8004 | 威胁情报查询 API |
| LLM Router | 8000 | 8005 | LLM 路由 API |

---

## 📊 数据流

```
┌─────────────────────────────────────────────────────────────┐
│              Stage 1: Alert Normalizer                      │
│                   (Normalized Alerts)                       │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.normalized queue
                     ▼
┌─────────────────────────────────────────────────────────────┐
│             Context Collector Service (8003)                │
│  - Network Context (GeoIP, Subnet)                           │
│  - Asset Context (CMDB, Criticality)                         │
│  - User Context (Directory, Roles)                           │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.enriched queue
                     ▼
┌─────────────────────────────────────────────────────────────┐
│        Threat Intel Aggregator Service (8004)               │
│  - VirusTotal (IPs, Hashes, URLs)                            │
│  - Abuse.ch (Malware Feeds)                                  │
│  - Custom Blocklist                                          │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.enriched queue (with TI)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 LLM Router Service (8005)                   │
│  - Analyze Task Complexity                                   │
│  - Route to DeepSeek (Deep Analysis)                        │
│  - Route to Qwen3 (Fast Analysis)                           │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.enriched queue (with LLM routing)
                     ▼
              Stage 3: AI Triage Agent
```

---

## 🧪 测试策略

### 单元测试（待实现）

**Context Collector**:
- [ ] 测试内网 IP 检测
- [ ] 测试子网计算
- [ ] 测试缓存读写
- [ ] 测试缓存过期清理

**Threat Intel Aggregator**:
- [ ] 测试 VirusTotal 查询（mock）
- [ ] 测试 Abuse.ch 查询（mock）
- [ ] 测试并发查询
- [ ] 测试威胁评分计算

**LLM Router**:
- [ ] 测试路由决策逻辑
- [ ] 测试健康检查
- [ ] 测试故障切换
- [ ] 测试速率限制

### 集成测试（待实现）

**文件**: `tests/integration/test_enrichment_pipeline.py`

测试场景：
- [ ] Context Collector → 增强告警
- [ ] Threat Intel → 查询外部 API（使用 mocks）
- [ ] LLM Router → 路由决策
- [ ] 缓存读写操作
- [ ] 超时和重试逻辑

### E2E 测试（待实现）

**文件**: `tests/system/test_enrichment_e2e.py`

测试场景：
1. **内网 IP 告警** → 验证上下文收集成功（子网、内网标识）
2. **已知恶意 IP 告警** → 验证威胁情报找到（如果有 API key）
3. **高复杂度告警** → 验证路由到 DeepSeek
4. **缓存命中场景** → 验证响应 < 100ms
5. **MaaS 故障模拟** → 验证故障切换生效

### 性能基准

| 操作 | 目标 P95 延迟 | 缓存命中 P95 |
|------|--------------|-------------|
| 上下文收集 | 500ms | 50ms |
| 威胁情报查询 | 2000ms | 50ms |
| LLM 路由决策 | 10ms | 10ms |
| 总增强时间 | 3000ms | - |

---

## 🚀 构建和部署

### 前置条件

1. Stage 0 和 Stage 1 必须已完成
2. 威胁情报 API keys（可选，用于 VirusTotal）
3. MaaS 端点配置（DeepSeek/Qwen）

### 构建镜像

```bash
# 进入项目根目录
cd /Users/newmba/security

# 构建 Stage 2 服务镜像
docker-compose build context-collector
docker-compose build threat-intel-aggregator
docker-compose build llm-router
```

### 启动服务

```bash
# 启动 Stage 2 服务
docker-compose up -d context-collector threat-intel-aggregator llm-router

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f context-collector
docker-compose logs -f threat-intel-aggregator
docker-compose logs -f llm-router
```

### 验证部署

```bash
# 1. 检查服务健康
curl http://localhost:8003/health
curl http://localhost:8004/health
curl http://localhost:8005/health

# 2. 测试 Context Collector
curl -X POST http://localhost:8003/api/v1/enrich \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "test-001",
    "alert_type": "malware",
    "severity": "high",
    "description": "Test alert",
    "source_ip": "192.168.1.100",
    "asset_id": "SERVER-001",
    "user_id": "admin"
  }'

# 3. 测试 Threat Intel Aggregator
curl -X POST "http://localhost:8004/api/v1/query?ip=8.8.8.8"

# 4. 测试 LLM Router
curl -X POST http://localhost:8005/api/v1/route \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "triage",
    "complexity": "high",
    "estimated_tokens": 1000
  }'
```

---

## 📝 配置文件

### 环境变量（.env）

```bash
# ================================
# MaaS Configuration
# ================================
DEEPSEEK_BASE_URL=http://internal-maas.deepseek/v1
DEEPSEEK_API_KEY=internal-key-123
QWEN_BASE_URL=http://internal-maas.qwen/v1
QWEN_API_KEY=internal-key-456

# ================================
# Threat Intelligence API Keys
# ================================
VIRUSTOTAL_API_KEY=your_vt_key_here
ABUSECH_API_KEY=your_abusech_key_here
```

### MaaS 端点

**DeepSeek-V3**:
- Base URL: `http://internal-maas.deepseek/v1`
- Model: `deepseek-chat`
- 特点: 深度推理能力强

**Qwen3**:
- Base URL: `http://internal-maas.qwen/v1`
- Models: `qwen-max`, `qwen-plus`, `qwen-turbo`
- 特点: 速度快，成本低

---

## ⚠️ 已知限制和 TODO

### 当前限制

1. **Context Collector**:
   - GeoIP 数据为模拟数据（需集成 MaxMind/IPInfo）
   - CMDB 查询为模拟数据（需集成 ServiceNow/BMC）
   - 用户目录查询为模拟数据（需集成 AD/Azure AD）
   - 使用内存缓存（生产环境应使用 Redis）

2. **Threat Intel Aggregator**:
   - VirusTotal 需要 API key 才能工作
   - AlienVault OTX 未实现
   - MISP 集成未实现
   - 使用内存缓存（生产环境应使用 Redis）

3. **LLM Router**:
   - 依赖私有 MaaS 部署
   - 故障切换逻辑需在真实环境中测试
   - 速率限制基于内存（应使用 Redis）

### 下一步改进

**Stage 2 完善任务**:
1. 集成真实的 GeoIP 服务（MaxMind GeoLite2）
2. 集成真实的 CMDB 系统
3. 集成真实的目录服务（AD LDAP）
4. 实现单元测试（覆盖率 > 85%）
5. 实现集成测试
6. 实现 E2E 测试
7. 性能基准测试和优化
8. 替换内存缓存为 Redis

---

## 📈 监控指标

### 关键指标

**Context Collector**:
- `context_collections_total` - 上下文收集总数
- `cache_hits_total` - 缓存命中次数
- `cache_misses_total` - 缓存未命中次数
- `enrichment_latency_ms` - 增强延迟

**Threat Intel Aggregator**:
- `threat_queries_total` - 威胁情报查询总数
- `threat_detections_total` - 检测到威胁的次数
- `avg_threat_score` - 平均威胁评分
- `sources_queried_total` - 查询的情报源总数

**LLM Router**:
- `routing_decisions_total` - 路由决策总数
- `model_usage_total` - 各模型使用次数
- `failover_total` - 故障切换次数
- `routing_latency_ms` - 路由延迟

---

## 🎯 下一步：Stage 3 - AI分析服务

Stage 3 将实现以下服务：

1. **AI Triage Agent** - AI研判服务
   - 真实MaaS集成（DeepSeek-V3, Qwen3）
   - 针对不同告警类型的Prompt工程
   - 响应解析和结构化
   - 指数退避的重试逻辑

2. **Similarity Search** - 相似度搜索服务
   - 向量嵌入生成
   - ChromaDB集成
   - 历史告警匹配
   - 相似度阈值过滤

### Stage 3 依赖

Stage 3 依赖 Stage 2 完成：
- ✅ 增强的告警数据可用
- ✅ 威胁情报已附加
- ✅ LLM 路由决策可用

---

## 📚 相关文档

- **Stage 0 部署文档**: `/Users/newmba/security/STAGE0_DEPLOYMENT.md`
- **Stage 1 部署文档**: `/Users/newmba/security/STAGE1_DEPLOYMENT.md`
- **Stage 1 功能总结**: `/Users/newmba/security/STAGE1_SUMMARY.md`
- **API 对接指南**: `/Users/newmba/security/API_INTEGRATION_GUIDE.md`
- **架构概览**: `/Users/newmba/security/docs/README.md`

---

## ✅ 验收标准

- [ ] Context Collector 实现上下文收集（网络/资产/用户）
- [ ] Threat Intel Aggregator 查询 2+ 个源
- [ ] LLM Router 根据任务复杂度路由
- [ ] 缓存命中率 > 70%（重复查询）
- [ ] 主 MaaS 故障时故障切换生效
- [ ] 单元测试覆盖率 > 85%
- [ ] 集成测试包含外部 API mock
- [ ] E2E 测试成功处理增强告警
- [ ] 性能基准达标
- [ ] Docker 镜像构建成功
- [ ] 服务启动和运行正常

---

## 🔄 回滚计划

如果 Stage 2 验证失败，可以：

1. **检查日志**:
   ```bash
   docker-compose logs context-collector
   docker-compose logs threat-intel-aggregator
   docker-compose logs llm-router
   ```

2. **验证依赖**:
   - 确认 Stage 1 服务运行正常
   - 检查 `alert.normalized` 队列有消息
   - 检查数据库连接

3. **常见问题**:
   - **上下文收集失败**: 检查网络连接，修复查询逻辑
   - **威胁情报API失败**: 检查API密钥，修复速率限制
   - **LLM路由失败**: 检查MaaS端点，修复健康检查
   - **缓存不工作**: 检查Redis连接（如果启用），修复缓存逻辑

4. **服务重启**:
   ```bash
   docker-compose restart context-collector threat-intel-aggregator llm-router
   ```

---

**Stage 2 状态**: 🟡 代码实现完成，待测试验证
**预计完成时间**: 2026-01-06（代码），2026-01-07（测试）
**下一里程碑**: Stage 3 - AI分析服务

---

**最后更新**: 2026-01-06
**文档版本**: 1.0
**维护者**: CCR <chenchunrun@gmail.com>
