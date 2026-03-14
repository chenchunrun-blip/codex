# 功能需求清单

**版本**: v1.0
**日期**: 2025-01-05
**状态**: 详细设计阶段

---

## 📋 目录

- [1. 功能优先级说明](#1-功能优先级说明)
- [2. M1 - 告警接入模块](#2-m1---告警接入模块)
- [3. M2 - 威胁情报模块](#3-m2---威胁情报模块)
- [4. M3 - 上下文增强模块](#4-m3---上下文增强模块)
- [5. M4 - AI研判模块](#5-m4---ai研判模块)
- [6. M5 - 工作流管理模块](#6-m5---工作流管理模块)
- [7. M6 - 自动响应模块](#7-m6---自动响应模块)
- [8. M7 - 通知告警模块](#8-m7---通知告警模块)
- [9. M8 - 可视化与报表](#9-m8---可视化与报表)
- [10. M9 - 系统管理模块](#10-m9---系统管理模块)
- [11. M10 - 监控运维模块](#11-m10---监控运维模块)

---

## 1. 功能优先级说明

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 优先级定义                                                            ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                                      ┃
┃  🔴 P0 (MVP必备)                                                       ┃
┃     • 系统核心功能，必须有                                             ┃
┃     • 影响基本可用性                                                  ┃
┃     • 缺少则无法上线                                                  ┃
┃                                                                      ┃
┃  🟡 P1 (重要)                                                          ┃
┃     • 显著提升用户体验                                                ┃
┃     • 生产环境强烈建议                                                ┃
┃     • v1.0版本应包含                                                  ┃
┃                                                                      ┃
┃  🟢 P2 (可选)                                                          ┃
┃     • 锦上添花的功能                                                  ┃
┃     • 可在后续版本实现                                                ┃
┃     • v2.0+版本考虑                                                   ┃
┃                                                                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## 2. M1 - 告警接入模块

### 2.1 M1.1 多协议接入 (P0)

**功能描述**: 支持多种标准协议接入告警数据

**详细需求**:

| 协议 | 优先级 | 描述 | 实现要点 |
|------|--------|------|----------|
| REST API | P0 | JSON格式告警提交 | FastAPI实现，支持批量 |
| Syslog | P1 | RFC5424/RFC5425标准 | syslog-ng转发 |
| CEF | P1 | Common Event Format | ArcSight兼容 |
| LEAF | P2 | Log Event Archive Format | 可选协议 |
| MQTT | P2 | IoT设备告警 | EMQX Broker |
| WebSocket | P2 | 实时告警流 | 双向通信 |

**API端点**:
```
POST /api/v1/alerts              # 单个告警
POST /api/v1/alerts/batch        # 批量告警
GET  /api/v1/alerts/health       # 健康检查
```

**验收标准**:
- ✓ 接收延迟 < 100ms (P50)
- ✓ 支持并发100请求/秒
- ✓ 请求验证和错误处理
- ✓ API文档自动生成

---

### 2.2 M1.2 告警格式标准化 (P0)

**功能描述**: 将不同设备格式的告警映射到统一Schema

**详细需求**:

```
标准告警Schema (基于OCSF):
{
  "alert_id": "string",           // 唯一标识
  "timestamp": "ISO8601",         // 告警时间(UTC)
  "event_type": "string",         // 事件类型
  "severity": "critical|high|medium|low|info",
  "source": {
    "ip": "string",
    "port": int,
    "geo_location": {
      "country": "string",
      "city": "string",
      "coordinates": [lat, lon]
    }
  },
  "target": {
    "ip": "string",
    "port": int,
    "asset": {
      "id": "string",
      "type": "string",
      "name": "string"
    }
  },
  "description": "string",
  "iocs": [                       // 提取的IOCs
    {
      "type": "ip|domain|hash|url|email",
      "value": "string"
    }
  ],
  "raw_data": {}                  // 原始数据
}
```

**设备类型映射**:
- 防火墙 (Palo Alto, Fortinet, Checkpoint)
- IDS/IPS (Snort, Suricata)
- EDR (CrowdStrike, SentinelOne)
- WAF (ModSecurity, AWS WAF)
- SIEM (Splunk, QRadar, ELK)

**验收标准**:
- ✓ 支持10+种常见安全设备
- ✓ IOC自动提取准确率 > 90%
- ✓ 时区自动转换为UTC
- ✓ 字段映射可配置

---

### 2.3 M1.3 告警聚合 (P1)

**功能描述**: 对相似告警进行时间窗口聚合

**聚合策略**:

| 策略 | 描述 | 时间窗口 |
|------|------|----------|
| 时间聚合 | 相同类型+相同源IP | 1/5/15分钟 |
| 特征聚合 | 相同关键特征组合 | 可配置 |
| 批量聚合 | 批量攻击模式 | 动态 |
| 抑制聚合 | 重复告警抑制 | 可配置 |

**聚合输出**:
```json
{
  "aggregation_id": "string",
  "alert_count": 10,
  "time_window": "5m",
  "first_seen": "timestamp",
  "last_seen": "timestamp",
  "alerts": ["alert_id1", "alert_id2", ...],
  "aggregation_key": "type+source_ip",
  "summary": {
    "source_ips": ["ip1", "ip2"],
    "target_ips": ["ip1"],
    "attack_pattern": "brute_force"
  }
}
```

**验收标准**:
- ✓ 聚合延迟 < 1s
- ✓ 聚合准确率 > 95%
- ✓ 支持自定义聚合规则

---

## 3. M2 - 威胁情报模块

### 3.1 M2.1 多源情报聚合 (P0)

**功能描述**: 集成多个威胁情报源，聚合IOC信息

**支持的情报源**:

| 情报源 | 类型 | 覆盖范围 | 优先级 |
|--------|------|----------|--------|
| VirusTotal | 文件/URL/IP | 全球 | P0 |
| AlienVault OTX | 威胁指标 | 全球 | P0 |
| Abuse.ch | 恶意域名/IP | 全球 | P1 |
| CIRCL | 被动DNS | 欧洲 | P2 |
| 微步在线 | 威胁情报 | 中国 | P1 |
| 360威胁情报 | 威胁情报 | 中国 | P1 |
| 内部情报库 | 自定义IOCs | 内部 | P0 |

**API集成示例**:
```python
# VirusTotal API
GET https://www.virusscan.com/vtapi/v2/file/report
Parameters: apikey, resource

# AlienVault OTX
GET https://otx.alienvault.com/api/v1/indicators/IPv4/{ip}/general

# Abuse.ch
GET https://feodotracker.abuse.ch/browse/host/{ip}/
```

**聚合结果格式**:
```json
{
  "ioc": "45.33.32.156",
  "ioc_type": "ip",
  "sources": [
    {
      "name": "VirusTotal",
      "detection_rate": 45,
      "last_seen": "2025-01-04",
      "classification": "malicious"
    },
    {
      "name": "OTX",
      "pulse_count": 12,
      "reputation": "malicious"
    }
  ],
  "aggregate_score": 8.5,
  "threat_level": "critical",
  "confidence": 0.92,
  "tags": ["botnet", "c2"],
  "first_seen": "2024-12-01",
  "last_seen": "2025-01-04"
}
```

**验收标准**:
- ✓ 支持5+个情报源
- ✓ 查询响应时间 < 2s (单个IOC)
- ✓ 情报源失败不影响整体

---

### 3.2 M2.2 情报缓存策略 (P0)

**功能描述**: 多级缓存减少API调用，提升性能

**缓存架构**:
```
┌──────────────────────────────────────────────┐
│  L1: 内存缓存 (进程内)                       │
│  • 容量: 10K IOCs                           │
│  • TTL: 5分钟                               │
│  • 命中率目标: 60%                          │
├──────────────────────────────────────────────┤
│  L2: Redis缓存                              │
│  • 容量: 1M IOCs                            │
│  • TTL: 1h/24h/7d (分级)                   │
│  • 命中率目标: 30%                          │
├──────────────────────────────────────────────┤
│  L3: API调用                                 │
│  • 剩余10%请求                              │
│  • 缓存回填                                │
└──────────────────────────────────────────────┘
```

**缓存策略**:
- **热数据**: 最近1天查询的IOCs，TTL=1h
- **温数据**: 最近7天查询的IOCs，TTL=24h
- **冷数据**: 历史IOCs，TTL=7d
- **预加载**: 高频IOCs预加载到内存

**缓存更新**:
```python
# Cache-Aside Pattern
async def get_threat_intel(ioc: str):
    # L1: Memory Cache
    if intel := memory_cache.get(ioc):
        return intel

    # L2: Redis
    if intel := await redis_cache.get(ioc):
        memory_cache.set(ioc, intel, ttl=300)
        return intel

    # L3: API
    intel = await query_threat_intel_apis(ioc)

    # 回填缓存
    await redis_cache.set(ioc, intel, ttl=3600)
    memory_cache.set(ioc, intel, ttl=300)

    return intel
```

**验收标准**:
- ✓ 缓存命中率 > 85%
- ✓ 缓存更新延迟 < 100ms
- ✓ 支持缓存预热

---

### 3.3 M2.3 情报评分 (P1)

**功能描述**: 多源情报综合评分算法

**评分模型**:
```python
def calculate_threat_score(sources: List[Source]) -> float:
    """
    威胁评分 = Σ(源权重 × 源分数 × 新鲜度因子)
    """
    score = 0.0
    for source in sources:
        # 源权重
        weight = SOURCE_WEIGHTS[source.name]

        # 源分数 (0-10)
        source_score = source.malicious_score

        # 新鲜度因子
        days_since_last_seen = (now - source.last_seen).days
        freshness = max(0.3, 1.0 - (days_since_last_seen / 30))

        score += weight * source_score * freshness

    # 归一化到0-10
    return min(10.0, score / len(sources))
```

**源权重配置**:
```yaml
threat_intel:
  source_weights:
    virustotal: 0.3
    otx: 0.25
    abuse_ch: 0.2
    internal: 0.15
    other: 0.1
```

**验收标准**:
- ✓ 评分算法可配置
- ✓ 支持误报率调整
- ✓ 评分结果可解释

---

## 4. M3 - 上下文增强模块

### 4.1 M3.1 网络上下文 (P0)

**功能描述**: 收集IP相关的网络上下文信息

**上下文要素**:
```json
{
  "network_context": {
    "source_ip": "45.33.32.156",
    "is_internal": false,
    "is_proxy": false,
    "is_vpn": false,
    "geo_location": {
      "country": "US",
      "country_code": "US",
      "region": "California",
      "city": "San Francisco",
      "coordinates": [37.7749, -122.4194],
      "asn": 15169,
      "isp": "Google LLC"
    },
    "reputation": {
      "score": 2.3,
      "is_known_malicious": false,
      "is_tor_exit_node": false,
      "abuse_confidence": 15
    },
    "port_scan": {
      "common_ports": [22, 80, 443],
      "service_detection": ["ssh", "http", "https"]
    }
  }
}
```

**数据源**:
- MaxMind GeoIP2 (地理位置)
- AbuseIPDB (信誉评分)
- Shodan (端口扫描)

**验收标准**:
- ✓ 网络上下文查询 < 500ms
- ✓ 支持100K+ IP查询/天

---

### 4.2 M3.2 资产上下文 (P0)

**功能描述**: 从CMDB查询资产信息

**上下文要素**:
```json
{
  "asset_context": {
    "asset_id": "ASSET-001",
    "asset_name": "prod-web-01",
    "asset_type": "server",
    "criticality": "high",
    "owner": "team-platform",
    "business_unit": "engineering",
    "environment": "production",
    "os": {
      "name": "Ubuntu",
      "version": "22.04 LTS"
    },
    "vulnerabilities": {
      "critical": 2,
      "high": 5,
      "medium": 12,
      "low": 8,
      "patch_status": "partial"
    },
    "recent_incidents": 3,
    "last_scan": "2025-01-03"
  }
}
```

**CMDB集成**:
- REST API查询
- 资产自动发现
- 变更通知

**验收标准**:
- ✓ CMDB查询 < 200ms
- ✓ 资产信息实时同步

---

### 4.3 M3.3 用户上下文 (P1)

**功能描述**: 从IAM系统查询用户信息

**上下文要素**:
```json
{
  "user_context": {
    "user_id": "user@example.com",
    "username": "john.doe",
    "department": "engineering",
    "role": "developer",
    "access_level": "standard",
    "manager": "manager@example.com",
    "location": "Beijing",
    "login_history": {
      "last_login": "2025-01-05T09:30:00Z",
      "last_location": "Beijing",
      "last_ip": "192.168.1.100",
      "unusual_login": false
    },
    "behavior_profile": {
      "typical_hours": ["09:00-18:00"],
      "typical_locations": ["Beijing", "Shanghai"],
      "anomaly_score": 0.15
    }
  }
}
```

**IAM集成**:
- LDAP/AD查询
- SSO集成
- 行为基线分析

**验收标准**:
- ✓ 用户查询 < 300ms
- ✓ 异常检测准确率 > 85%

---

## 5. M4 - AI研判模块

### 5.1 M4.1 风险评估 (P0)

**功能描述**: 多维度风险评分

**评分维度**:
```python
def calculate_risk_score(alert: Alert, context: Context, intel: List) -> RiskAssessment:
    """
    风险评分 = Σ(维度权重 × 维度分数)

    维度:
    1. 告警严重度 (30%)
    2. 威胁情报评分 (30%)
    3. 资产重要性 (20%)
    4. 可利用性 (20%)
    """

    # 1. 告警严重度 (0-10)
    severity_score = SEVERITY_MAP[alert.severity]  # critical=10, high=7, ...

    # 2. 威胁情报评分 (0-10)
    threat_score = aggregate_threat_intel_score(intel)

    # 3. 资产重要性 (0-10)
    asset_multiplier = ASSET_CRITICALITY_MAP[context.asset.criticality]

    # 4. 可利用性 (0-10)
    exploit_multiplier = EXPLOITABILITY_MAP[context.vulnerabilities]

    # 加权计算
    risk_score = (
        severity_score * 0.3 +
        threat_score * 10 * 0.3 +
        asset_multiplier * 20 * 0.2 +
        exploit_multiplier * 20 * 0.2
    )

    # 风险级别
    risk_level = score_to_level(risk_score)  # >90=critical, >70=high, ...

    return RiskAssessment(
        risk_score=round(risk_score, 2),
        risk_level=risk_level,
        confidence=calculate_confidence(context, intel),
        key_factors=extract_key_factors(alert, context, intel)
    )
```

**风险级别映射**:
```
Critical: 90-100 (立即处理)
High:     70-89  (1小时内)
Medium:   40-69  (24小时内)
Low:      20-39  (观察)
Info:     0-19   (记录)
```

**验收标准**:
- ✓ 风险评分准确率 > 85% (人工验证)
- ✓ 评分延迟 < 500ms
- ✓ 支持评分算法调优

---

### 5.2 M4.2 相似告警检索 (P1)

**功能描述**: 基于向量检索相似历史告警

**技术实现**:
```python
async def find_similar_alerts(alert: Alert, top_k: int = 5) -> List[SimilarAlert]:
    """
    1. 生成告警嵌入向量
    2. ChromaDB向量检索
    3. 返回最相似的k个告警
    """

    # 构建查询文本
    query_text = f"""
    Alert Type: {alert.alert_type}
    Description: {alert.description}
    Source IP: {alert.source_ip}
    Target IP: {alert.target_ip}
    Severity: {alert.severity}
    IOCs: {alert.iocs}
    """

    # 向量嵌入
    embedding = await embedding_fn.embed(query_text)

    # ChromaDB检索
    results = chroma_collection.query(
        query_embeddings=[embedding],
        n_results=top_k,
        where={
            "resolved": True,
            "false_positive": False
        }
    )

    # 返回相似告警
    similar_alerts = []
    for i, (doc, metadata, distance) in enumerate(zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0]
    )):
        similar_alerts.append(SimilarAlert(
            alert_id=metadata["alert_id"],
            similarity=1 - distance,  # 余弦相似度
            description=doc,
            resolution=metadata["resolution"],
            risk_score=metadata["risk_score"]
        ))

    return similar_alerts
```

**验收标准**:
- ✓ 检索延迟 < 1s
- ✓ 相似度准确率 > 80% (人工评估)
- ✓ 支持百万级向量库

---

### 5.3 M4.3 攻击链分析 (P2)

**功能描述**: 识别攻击链和MITRE ATT&CK技术

**攻击链映射**:
```json
{
  "attack_chain_analysis": {
    "kill_chain_stage": "exploitation",
    "mitre_techniques": [
      {
        "technique_id": "T1190",
        "technique_name": "Exploit Public-Facing Application",
        "tactics": ["initial_access"],
        "confidence": 0.85
      },
      {
        "technique_id": "T1078",
        "technique_name": "Valid Accounts",
        "tactics": ["defense_evasion", "persistence"],
        "confidence": 0.72
      }
    ],
    "attack_pattern": "credential_stuffing",
    "next Likely_steps": [
      "lateral_movement",
      "data_exfiltration"
    ]
  }
}
```

**验收标准**:
- ✓ MITRE映射覆盖率 > 70%
- ✓ 攻击阶段识别准确率 > 75%

---

### 5.4 M4.4 LLM智能分析 (P0)

**功能描述**: 使用DeepSeek/Qwen3进行深度分析

**分析类型**:

1. **告警描述生成** (P0)
2. **处置建议生成** (P0)
3. **自然语言查询** (P1)
4. **报告自动生成** (P1)

**LLM路由策略**:
```python
def route_llm_task(task_type: str, complexity: str) -> str:
    """
    智能路由到合适的模型
    """

    # 简单任务 → Qwen3 (快速、低成本)
    if task_type in ["description_generation", "simple_query"]:
        if complexity == "low":
            return "qwen3"

    # 复杂任务 → DeepSeek-V3 (深度推理)
    if task_type in ["deep_analysis", "attack_chain"]:
        return "deepseek"

    # 默认
    return "qwen3"
```

**Prompt设计示例**:
```python
TRIAGE_ANALYSIS_PROMPT = """
你是一个网络安全专家，正在分析一个安全告警。

## 告警信息
- 类型: {alert_type}
- 描述: {description}
- 严重度: {severity}
- 源IP: {source_ip}
- 目标IP: {target_ip}

## 上下文信息
- 网络: {network_context}
- 资产: {asset_context}
- 用户: {user_context}

## 威胁情报
{threat_intel_summary}

## 相似历史告警
{similar_alerts_summary}

请提供:
1. 告警严重性评估 (0-10分)
2. 攻击意图分析
3. 建议的立即行动
4. 关键风险因素

请以JSON格式回答。
"""
```

**验收标准**:
- ✓ LLM分析延迟 < 5s (P95)
- ✓ 分析质量评分 > 4.0/5.0 (人工评估)
- ✓ 模型切换透明

---

## 6. M5 - 工作流管理模块

### 6.1 M5.1 状态管理 (P0)

**功能描述**: 告警生命周期状态机

**状态定义**:
```
new → assigned → in_progress → resolved → closed
  ↓                                              ↑
rejected ────────────────────────────────────────┘
```

**状态转换规则**:
```yaml
state_transitions:
  new:
    - to: assigned
      condition: has_assignee
    - to: rejected
      condition: is_false_positive
      permission: analyst

  assigned:
    - to: in_progress
      condition: acknowledged
    - to: new
      condition: unassigned

  in_progress:
    - to: resolved
      condition: remediation_completed
      permission: analyst
    - to: new
      condition: reassigned

  resolved:
    - to: closed
      condition: confirmed
      timeout: 24h
      auto_close: true
    - to: in_progress
      condition: reopened

  closed:
    - to: in_progress
      condition: new_evidence
      permission: supervisor
```

**验收标准**:
- ✓ 状态转换100%可追溯
- ✓ 支持状态恢复

---

### 6.2 M5.2 任务分配 (P0)

**功能描述**: 自动或手动分配告警

**分配策略**:

| 策略 | 描述 | 优先级 |
|------|------|--------|
| 基于技能 | 根据告警类型和分析师专长 | P0 |
| 基于负载 | 均衡分配工作负载 | P0 |
| 基于值班 | 按值班表自动分配 | P1 |
| 手动指定 | 分析师主动认领 | P0 |
| 升级分配 | SLA超时自动升级 | P1 |

**负载均衡算法**:
```python
def assign_alert(alert: Alert) -> User:
    """
    基于多因素分配
    """

    # 1. 筛选具备技能的分析师
    qualified_analysts = get_users_with_skill(alert.alert_type)

    # 2. 计算当前负载
    for analyst in qualified_analysts:
        analyst.load = count_active_alerts(analyst)

    # 3. 选择负载最低的
    assigned_analyst = min(qualified_analysts, key=lambda a: a.load)

    return assigned_analyst
```

**验收标准**:
- ✓ 自动分配准确率 > 80%
- ✓ 分配延迟 < 1s

---

### 6.3 M5.3 SLA管理 (P1)

**功能描述**: 服务级别协议管理

**SLA定义**:
```yaml
slas:
  critical:
    response_time: 5m     # 5分钟内响应
    resolve_time: 30m     # 30分钟内解决
  high:
    response_time: 15m
    resolve_time: 2h
  medium:
    response_time: 1h
    resolve_time: 24h
  low:
    response_time: 4h
    resolve_time: 7d
```

**SLA监控**:
```python
def check_sla_compliance(alert: Alert):
    """
    检查SLA合规性
    """

    sla = get_sla(alert.severity)

    # 响应时间
    if alert.status == "new":
        time_since_creation = now() - alert.created_at
        if time_since_creation > sla.response_time:
            trigger_sla_breach_alert(alert, "response")

    # 解决时间
    if alert.status in ["new", "assigned", "in_progress"]:
        time_since_creation = now() - alert.created_at
        if time_since_creation > sla.resolve_time:
            trigger_sla_breach_alert(alert, "resolution")
```

**验收标准**:
- ✓ SLA违规自动告警
- ✓ SLA合规率 > 95%

---

### 6.4 M5.4 协作功能 (P1)

**功能描述**: 团队协作和知识共享

**功能列表**:
- 评论/备注
- @提及通知
- 文件附件
- 标签管理
- 相关告警关联
- 知识库链接

**验收标准**:
- ✓ 协作操作延迟 < 200ms
- ✓ 支持实时通知

---

## 7. M6 - 自动响应模块

### 7.1 M6.1 SOAR集成 (P1)

**功能描述**: 自动化响应编排

**Playbook类型**:
```yaml
playbooks:
  block_ip:
    description: "阻断恶意IP"
    actions:
      - firewall_block
      - siem_add_to_blacklist
    approval: required

  isolate_host:
    description: "隔离受感染主机"
    actions:
      - edr_isolate
      - network_quarantine
    approval: required

  disable_account:
    description: "禁用受损账户"
    actions:
      - iam_disable_user
      - revoke_sessions
    approval: required

  collect_evidence:
    description: "收集取证信息"
    actions:
      - capture_memory_dump
      - collect_disk_image
      - preserve_logs
    approval: not_required
```

**验收标准**:
- ✓ Playbook执行成功率 > 95%
- ✓ 执行延迟 < 10s

---

### 7.2 M6.2 审批流程 (P0)

**功能描述**: 高危动作审批

**审批级别**:
```yaml
approval_levels:
  low_risk:
    - auto_response
    - notification
    requires_approval: false

  medium_risk:
    - block_ip
    - enhanced_monitoring
    requires_approval: team_lead

  high_risk:
    - isolate_host
    - disable_account
    - shutdown_service
    requires_approval: manager

  critical_risk:
    - shutdown_datacenter
    - block_subnet
    requires_approval: director
```

**验收标准**:
- ✓ 审批流程可追溯
- ✓ 支持移动端审批

---

## 8. M7 - 通知告警模块

### 8.1 M7.1 多渠道通知 (P0)

**通知渠道**:

| 渠道 | 类型 | 优先级 | 用途 |
|------|------|--------|------|
| Email | 异步 | P0 | 正式通知、报告 |
| SMS | 实时 | P1 | 紧急告警 |
| 即时通讯 | 实时 | P0 | 团队协作 |
| Webhook | 异步 | P1 | 集成第三方 |
| PagerDuty | 实时 | P2 | 值班管理 |

**通知模板**:
```python
CRITICAL_ALERT_TEMPLATE = """
🚨 CRITICAL SECURITY ALERT

Alert ID: {alert_id}
Severity: CRITICAL
Risk Score: {risk_score}/100

Description:
{description}

Immediate Actions Required:
{actions}

Assignee: {assignee}
View Details: {link}
"""
```

**验收标准**:
- ✓ 通知发送延迟 < 5s
- ✓ 通知到达率 > 99%

---

### 8.2 M7.2 智能路由 (P1)

**功能描述**: 基于规则的通知路由

**路由规则**:
```yaml
notification_routes:
  - name: "Critical to On-call"
    condition:
      severity: critical
    channels:
      - sms
      - pagerduty
    escalation:
      after: 5m
      to: manager

  - name: "High to Team"
    condition:
      severity: high
      team: platform
    channels:
      - slack
      - email
    routing:
      by: skill
      fallback: on_call

  - name: "Batch Notification"
    condition:
      aggregation: true
      count: >10
    channels:
      - email
      - slack
    throttle: 15m
```

**验收标准**:
- ✓ 路由准确率 > 98%
- ✓ 支持路由规则热更新

---

## 9. M8 - 可视化与报表

### 9.1 M8.1 实时仪表板 (P0)

**仪表板组件**:
- 告警趋势图 (时间序列)
- 高危告警Top10
- 处理效率统计
- 资产风险热力图
- 威胁情报命中率
- SLA合规率

**验收标准**:
- ✓ 仪表板刷新 < 3s
- ✓ 支持自定义布局

---

### 9.2 M8.2 报表生成 (P1)

**报表类型**:
- 日报/周报/月报
- 自定义时间范围
- 执行摘要
- 详细分析

**输出格式**:
- PDF
- Excel
- CSV
- HTML

**验收标准**:
- ✓ 报表生成 < 30s
- ✓ 支持定时生成

---

## 10. M9 - 系统管理模块

### 10.1 M9.1 用户权限 (P0)

**RBAC模型**:
```yaml
roles:
  admin:
    permissions: ["*"]

  analyst:
    permissions:
      - alerts:read
      - alerts:update
      - alerts:assign
      - comments:create

  viewer:
    permissions:
      - alerts:read
      - reports:read

  auditor:
    permissions:
      - audit_logs:read
      - reports:read
```

**验收标准**:
- ✓ 权限检查 < 10ms
- ✓ 支持权限继承

---

### 10.2 M9.2 系统配置 (P0)

**配置项**:
- 风险评分参数
- 工作流规则
- 通知策略
- 告警源配置
- 威胁情报源配置

**验收标准**:
- ✓ 配置实时生效
- ✓ 支持配置版本管理

---

## 11. M10 - 监控运维模块

### 11.1 M10.1 系统监控 (P0)

**监控指标**:
```yaml
metrics:
  service_health:
    - uptime
    - error_rate
    - request_rate

  performance:
    - p50_latency
    - p95_latency
    - p99_latency

  resources:
    - cpu_usage
    - memory_usage
    - disk_usage
    - network_io

  business:
    - alerts_per_minute
    - triage_rate
    - sla_compliance
```

**验收标准**:
- ✓ 监控数据延迟 < 1s
- ✓ 支持1000+指标

---

### 11.2 M10.2 告警监控 (P0)

**告警规则**:
```yaml
alerts:
  - name: "Alert Backlog"
    condition: queue_depth > 1000
    severity: critical
    notification: pagerduty

  - name: "Processing Latency High"
    condition: p95_latency > 5s
    severity: warning
    notification: slack

  - name: "API Error Rate High"
    condition: error_rate > 1%
    severity: critical
    notification: slack + email
```

**验收标准**:
- ✓ 告警触发准确率 > 95%
- ✓ 告警发送延迟 < 10s

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
**下一步**: 查看[组件清单文档](./03_components_inventory.md)
