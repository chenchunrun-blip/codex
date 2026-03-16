# 生产级安全告警研判系统 - 架构设计文档

**版本**: v1.0
**日期**: 2025-01-05
**状态**: 架构设计完成

---

## 📚 文档导航

本文档集包含完整的生产级安全告警研判系统架构设计方案。

### 核心文档

| 文档 | 说明 | 优先级 |
|------|------|--------|
| **[01_architecture_overview.md](./01_architecture_overview.md)** | 架构总览、技术栈选型、设计原则 | ⭐⭐⭐ |
| **[02_functional_requirements.md](./02_functional_requirements.md)** | 详细功能需求清单（10大模块） | ⭐⭐⭐ |
| **[03_components_inventory.md](./03_components_inventory.md)** | 组件清单、资源配置 | ⭐⭐ |
| **[04_database_design.md](./04_database_design.md)** | 数据库Schema设计 | ⭐⭐⭐ |
| **[05_api_design.md](./05_api_design.md)** | RESTful API接口设计 | ⭐⭐ |
| **[06_poc_implementation.md](./06_poc_implementation.md)** | POC实施方案（4-6周计划） | ⭐⭐⭐ |

---

## 🎯 快速开始

### 1. 架构概览

首先阅读 **[架构总览](./01_architecture_overview.md)**，了解：

- 系统整体架构
- 技术栈选型（为什么选FastAPI、RabbitMQ、ChromaDB等）
- 私有化MaaS服务集成（DeepSeek + Qwen3）
- 设计原则和最佳实践

### 2. 功能需求

查看 **[功能需求](./02_functional_requirements.md)**，了解：

- 10大功能模块详细设计
- 每个功能的优先级（P0/P1/P2）
- 验收标准
- API端点定义

### 3. 数据库设计

参考 **[数据库设计](./04_database_design.md)**，包含：

- 完整的PostgreSQL表结构
- 索引和触发器定义
- 分区策略
- 数据迁移脚本

### 4. POC实施

按照 **[POC方案](./06_poc_implementation.md)** 执行：

- Week 1-2: 基础设施搭建
- Week 3-4: 核心服务开发
- Week 5: 系统集成
- Week 6: 演示评估

---

## 🏗️ 架构亮点

### 1. 私有化MaaS服务集成

```
DeepSeek-V3  ← 复杂分析（深度推理）
     ↓
Qwen3        ← 快速响应（通用分析）
```

- **优势**: 零外部API成本、数据安全可控、无限流限制
- **智能路由**: 根据任务复杂度自动选择合适的模型

### 2. 微服务架构

- **Alert Ingestor**: 告警接入
- **Context Collector**: 上下文收集
- **Threat Intel Aggregator**: 威胁情报聚合
- **AI Triage Agent**: AI研判（LangChain）
- **Workflow Engine**: 工作流编排（Temporal）

### 3. 向量检索能力

- **技术**: ChromaDB + pgvector
- **用途**: 相似告警检索、历史处置推荐
- **性能**: < 1s检索延迟（百万级向量）

### 4. 异步消息驱动

- **消息队列**: RabbitMQ 3节点集群
- **解耦服务**: 提升并发处理能力
- **可靠传递**: 镜像队列保证高可用

---

## 📊 技术栈总结

### 后端

- **语言**: Python 3.11+
- **框架**: FastAPI (高性能异步API)
- **AI编排**: LangChain
- **工作流**: Temporal
- **数据验证**: Pydantic v2

### LLM服务（私有化MaaS）

- **DeepSeek-V3**: 复杂推理分析
- **Qwen3**: 通用快速响应
- **智能路由**: 根据复杂度自动选择

### 数据存储

- **PostgreSQL 15+**: 主数据库（3节点HA）
- **Redis 7**: 缓存层（6节点Cluster）
- **RabbitMQ 3.12**: 消息队列（3节点集群）
- **ChromaDB**: 向量数据库（2节点）
- **Elasticsearch 8.x**: 日志检索（3节点集群）

### 前端

- **React 18**: UI框架
- **TypeScript**: 类型安全
- **Tailwind CSS**: 样式框架
- **Recharts**: 数据可视化

### DevOps

- **Kubernetes**: 容器编排
- **Prometheus**: 指标监控
- **Grafana**: 可视化仪表板
- **Jaeger**: 链路追踪
- **ELK Stack**: 日志聚合

---

## 🚀 实施路线图

### Phase 1: MVP (Q1 2025)

```
✓ 告警接入和标准化
✓ 基础AI研判（Qwen3）
✓ 威胁情报集成（2-3个源）
✓ 简单Web UI
✓ 基础监控

规模: 100告警/天 | 单节点部署
```

### Phase 2: 生产版 (Q2 2025)

```
✓ 高可用部署
✓ 工作流引擎
✓ 向量相似检索
✓ 自动响应（SOAR）
✓ 多渠道通知
✓ 用户权限管理

规模: 1000告警/天 | K8s集群
```

### Phase 3: 企业版 (Q3 2025)

```
✓ 高级分析（攻击链、MITRE）
✓ BI报表
✓ 审计合规
✓ SSO/LDAP集成
✓ 多租户支持

规模: 10000+告警/天 | 多集群
```

### Phase 4: 智能版 (Q4 2025+)

```
✓ 自定义模型微调
✓ 预测性分析
✓ 自动化编排增强
✓ 跨租户威胁情报共享

规模: 100000+告警/天 | 多地域分布式
```

---

## 💡 关键决策记录

### 为什么选择FastAPI？

- ✅ 高性能（可媲美NodeJS和Go）
- ✅ 原生异步支持
- ✅ 自动生成OpenAPI文档
- ✅ Pydantic类型安全

### 为什么选择RabbitMQ而不是Kafka？

- ✅ 协议丰富（AMQP, MQTT, STOMP）
- ✅ 消息确认机制可靠
- ✅ 管理界面友好
- ✅ 适合当前规模（10000+告警/天）

### 为什么选择ChromaDB？

- ✅ 轻量级，部署简单
- ✅ Python原生支持
- ✅ 成本可控（开源）
- ✅ 性能足够（百万级向量）

### 为什么选择Temporal而不是Celery？

- ✅ 工作流状态持久化
- ✅ 内置可视化界面
- ✅ 支持复杂长时间运行工作流
- ✅ 确定性执行保证

---

## 📖 阅读顺序建议

### 方案1: 快速了解（1小时）

1. 本文档（5分钟）
2. [架构总览](./01_architecture_overview.md)（30分钟）
3. [POC方案](./06_poc_implementation.md)（25分钟）

### 方案2: 深入理解（半天）

1. 本文档
2. [架构总览](./01_architecture_overview.md)
3. [功能需求](./02_functional_requirements.md)
4. [数据库设计](./04_database_design.md)
5. [API设计](./05_api_design.md)
6. [POC方案](./06_poc_implementation.md)

### 方案3: 完整研究（1天）

按顺序阅读所有6个文档，并：
- 对比原型系统识别改进点
- 在POC方案中找到可快速验证的内容
- 评估团队技能匹配度

---

## 🔗 相关资源

### 原型系统

- **位置**: `/Users/newmba/Downloads/CCWorker/security_triage`
- **原型CLAUDE.md**: `CLAUDE.md`
- **运行命令**: `python main.py --sample`

### 技术文档

- **FastAPI**: https://fastapi.tiangolo.com/
- **LangChain**: https://python.langchain.com/
- **Temporal**: https://temporal.io/
- **ChromaDB**: https://www.trychroma.com/
- **PostgreSQL**: https://www.postgresql.org/docs/

### 架构最佳实践

- **微服务架构**: https://microservices.io/patterns/
- **DDD领域驱动设计**: https://martinfowler.com/tags/domain%20driven%20design.html
- **RESTful API**: https://restfulapi.net/

---

## ❓ 常见问题

### Q1: 为什么不使用Kafka？

**A**: 当前规模（10000+告警/天）RabbitMQ完全够用，且运维成本更低。如果未来扩展到百万级/天，可以考虑迁移到Kafka。

### Q2: ChromaDB能支撑多大规模？

**A**: ChromaDB在单机上可以支撑百万级向量，性能满足当前需求。如果需要更大规模，可以：
1. 使用ChromaDB分布式模式
2. 或者迁移到Milvus/Pinecone等企业级方案

### Q3: 私有化MaaS如何保证性能？

**A**:
1. 部署充足的GPU资源
2. 使用智能路由策略（简单任务用Qwen3，复杂任务用DeepSeek）
3. 实施缓存策略减少API调用
4. 监控性能指标，动态调整

### Q4: POC成功后多久可以上线？

**A**:
- **MVP版本**: 2-3个月（POC成功后）
- **生产版本**: 4-6个月（包含完整测试和安全加固）
- **企业版本**: 6-12个月（包含高级功能）

---

## 📝 更新日志

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0 | 2025-01-05 | 初始版本，完整架构设计 |

---

**维护者**: 架构团队
**联系方式**: security-triage@example.com
**项目状态**: 🟢 设计阶段，准备启动POC

---

## 🎉 总结

本架构设计提供了一个**完整的、生产级的、可落地的**安全告警研判系统方案。

**核心优势**:
- ✅ 使用私有化MaaS（DeepSeek + Qwen3），零外部API成本
- ✅ 微服务架构，可独立扩展和部署
- ✅ 完整的功能设计，覆盖从接入到响应的全流程
- ✅ 详细的POC方案，4-6周可验证可行性

**下一步行动**:
1. 评审本架构设计文档
2. 确认资源和团队配置
3. 启动POC实施（参考POC方案）
4. 根据POC结果调整生产环境计划

**祝项目成功！** 🚀
