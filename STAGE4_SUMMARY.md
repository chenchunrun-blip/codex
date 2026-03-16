# Stage 4: 工作流与自动化 - 完成总结

**完成时间**: 2026-01-06
**状态**: ✅ 代码实现完成，待测试验证

---

## 📋 实现概览

Stage 4 实现了安全告警系统的工作流编排和自动化响应层，包括三个关键微服务：

1. **Workflow Engine Service** - 工作流引擎服务
2. **Automation Orchestrator Service** - 自动化编排服务（SOAR）
3. **Notification Service** - 通知服务

这三个服务为告警提供完整的工作流管理、自动化响应和通知能力。

---

## 🔧 实现的功能

### 1. Workflow Engine Service (`services/workflow_engine/`)

#### 核心功能

**工作流定义管理**:
- 创建和管理工作流定义
- 版本控制支持
- 步骤类型: activity, human_task, decision
- 超时配置
- 动态参数传递

**默认工作流**:

1. **Alert Processing Workflow** (`alert-processing`):
   ```python
   steps = [
       enrich (Context Collector),
       analyze (AI Triage Agent),
       auto_response (Decision: risk_level check),
       human_review (Human Task: security-team)
   ]
   timeout: 3600s (1 hour)
   ```

2. **Incident Response Workflow** (`incident-response`):
   ```python
   steps = [
       assess (Initial assessment),
       contain (Contain threat),
       eradicate (Eradicate threat),
       recover (Recover systems)
   ]
   timeout: 7200s (2 hours)
   ```

**工作流执行引擎**:
- 异步步骤执行
- 状态跟踪 (PENDING, RUNNING, COMPLETED, FAILED, TIMED_OUT, CANCELLED)
- 进度监控 (0.0 - 1.0)
- 错误处理和回滚
- 超时检测和终止

**步骤类型支持**:

1. **Activity** - 服务调用:
   ```python
   {
       "name": "enrich",
       "type": "activity",
       "service": "context_collector"
   }
   ```

2. **Human Task** - 人工任务:
   ```python
   {
       "name": "human_review",
       "type": "human_task",
       "assignee": "security-team",
       "title": "Review critical alert"
   }
   ```

3. **Decision** - 条件分支:
   ```python
   {
       "name": "auto_response",
       "type": "decision",
       "condition": "${risk_level == 'CRITICAL'}"
   }
   ```

**监控和清理**:
- 后台任务监控执行超时
- 自动清理已完成的执行
- 每分钟检查一次

#### API 端点

- `POST /api/v1/workflows/definitions` - 创建工作流定义
- `GET /api/v1/workflows/definitions` - 列出所有工作流
- `GET /api/v1/workflows/definitions/{workflow_id}` - 获取特定工作流
- `POST /api/v1/workflows/execute` - 启动工作流执行
- `GET /api/v1/workflows/executions` - 列出执行实例
- `GET /api/v1/workflows/executions/{execution_id}` - 获取执行详情
- `POST /api/v1/workflows/executions/{execution_id}/cancel` - 取消执行
- `GET /health` - 健康检查

---

### 2. Automation Orchestrator Service (`services/automation_orchestrator/`)

#### 核心功能

**SOAR 剧本管理**:
- 剧本定义和版本控制
- 触发条件配置
- 批准工作流集成
- 超时配置
- 参数化支持

**默认剧本**:

1. **Malware Response Playbook** (`malware-response`):
   ```python
   actions = [
       isolate_host (SSH: iptables block),
       quarantine_file (EDR: quarantine file),
       create_ticket (API: create ticket)
   ]
   approval_required: True
   trigger: {alert_type: "malware", risk_level: ["CRITICAL", "HIGH"]}
   ```

2. **Phishing Response Playbook** (`phishing-response`):
   ```python
   actions = [
       block_sender (Email gateway: block sender),
       delete_emails (Email gateway: delete all instances)
   ]
   approval_required: True
   trigger: {alert_type: "phishing", confidence_threshold: 80}
   ```

**动作执行器**:

1. **SSHCommandExecutor** - SSH 命令执行:
   - 远程主机命令执行
   - 模板参数替换
   - 超时控制
   - 退出码检查

2. **EDRCommandExecutor** - EDR 集成:
   - 文件隔离
   - 进程终止
   - 主机网络隔离

3. **EmailCommandExecutor** - 邮件网关:
   - 阻止发送者
   - 删除邮件
   - 标记钓鱼邮件

4. **APICallExecutor** - HTTP API 调用:
   - 支持 GET, POST, PUT, DELETE
   - 自定义 headers
   - JSON body
   - 响应解析

**执行引擎**:
- 顺序执行动作
- 条件评估
- 错误处理和停止
- 执行历史记录
- 批准状态检查

**批准工作流**:
```python
if playbook.approval_required and execution.approval_status != "approved":
    execution.status = WorkflowStatus.PENDING
    # Wait for approval
```

#### API 端点

- `POST /api/v1/playbooks` - 创建剧本
- `GET /api/v1/playbooks` - 列出所有剧本
- `GET /api/v1/playbooks/{playbook_id}` - 获取特定剧本
- `POST /api/v1/playbooks/execute` - 启动剧本执行
- `GET /api/v1/executions` - 列出执行实例
- `GET /api/v1/executions/{execution_id}` - 获取执行详情
- `POST /api/v1/executions/{execution_id}/approve` - 批准执行
- `POST /api/v1/executions/{execution_id}/cancel` - 取消执行
- `GET /health` - 健康检查

---

### 3. Notification Service (`services/notification_service/`)

#### 核心功能

**多渠道通知**:

1. **Email** - 邮件通知:
   - SMTP 集成
   - HTML 支持
   - 主题和正文
   - 附件支持 (预留)

2. **Slack** - Slack 集成:
   - Webhook 发送
   - 自定义 channel
   - 自定义 username
   - 格式化消息

3. **Webhook** - 自定义 Webhook:
   - HTTP POST 请求
   - 自定义 headers
   - JSON payload
   - 状态码检查

4. **SMS** - 短信通知 (预留):
   - Twilio 集成 (预留)
   - AWS SNS 集成 (预留)

5. **In-App** - 应用内通知 (预留):
   - 数据库存储
   - 用户通知中心

**通知优先级**:
- `LOW` - 低优先级
- `NORMAL` - 普通优先级
- `HIGH` - 高优先级
- `URGENT` - 紧急

**批量发送**:
- 支持广播通知
- 批量收件人
- 结果汇总 (成功/失败统计)
- 错误隔离

#### API 端点

- `POST /api/v1/notifications/send` - 发送单个通知
- `POST /api/v1/notifications/broadcast` - 广播通知
- `GET /health` - 健康检查

#### 通知格式

**Email**:
```python
{
    "channel": "email",
    "recipient": "user@example.com",
    "subject": "Critical Alert: Malware Detected",
    "message": "Malware detected on server...",
    "priority": "urgent"
}
```

**Slack**:
```python
{
    "channel": "slack",
    "recipient": "https://hooks.slack.com/services/...",
    "message": "🚨 Critical alert triggered",
    "priority": "urgent",
    "data": {
        "channel": "#security-alerts",
        "username": "Security Bot"
    }
}
```

**Webhook**:
```python
{
    "channel": "webhook",
    "recipient": "https://your-webhook-endpoint.com/alerts",
    "subject": "Security Alert",
    "message": "Alert details...",
    "data": {
        "headers": {"Authorization": "Bearer token"},
        "payload": {"custom": "data"}
    }
}
```

---

## 🐳 Docker 配置

### Dockerfile 特性

所有 Stage 4 服务使用统一的 Dockerfile 模板：
- 基于 Python 3.11-slim
- 非 root 用户运行
- 健康检查集成
- 系统依赖（gcc, g++, curl）

### 端口映射

| 服务 | 内部端口 | 外部端口 | 用途 |
|------|---------|---------|------|
| Workflow Engine | 8000 | 8008 | 工作流管理 API |
| Automation Orchestrator | 8000 | 8009 | SOAR 剧本 API |
| Notification Service | 8000 | 8010 | 通知发送 API |

### 环境变量

**Workflow Engine**:
```bash
# Standard config
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...
```

**Automation Orchestrator**:
```bash
# Standard config
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...
```

**Notification Service**:
```bash
# Standard config
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...

# Email channel
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Slack channel
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

---

## 📊 数据流

```
┌─────────────────────────────────────────────────────────────┐
│              Stage 3: AI Triage Agent (8006)                │
│                   (Triage Results)                          │
└────────────────────┬────────────────────────────────────────┘
                     │ alert.result queue
                     ├──────────────────────────────┐
                     ▼                              ▼
          ┌──────────────────┐           ┌─────────────────────┐
          │ Workflow Engine  │           │ Similarity Search   │
          │   (8008)         │           │    (8007)           │
          └────────┬─────────┘           └─────────────────────┘
                   │
                   │ workflow.completed queue
                   ├──────────────────────────────┐
                   ▼                              ▼
    ┌─────────────────────┐         ┌─────────────────────────┐
    │   Downstream        │         │ Automation Orchestrator │
    │   Services          │         │       (8009)            │
    └─────────────────────┘         │ - Execute playbooks     │
                                    │ - Run actions           │
                                    │ - Approval workflow     │
                                    └────────┬────────────────┘
                                             │
                                             │ automation.completed
                                             ├─────────────┐
                                             ▼             ▼
                                  ┌──────────────────┐  ┌─────────────────┐
                                  │   Downstream     │  │ Notification    │
                                  │   Services       │  │   Service (8010)│
                                  └──────────────────┘  │ - Email         │
                                                         │ - Slack         │
                                                         │ - Webhook       │
                                                         └─────────────────┘
```

---

## 🧪 测试策略

### 单元测试（待实现）

**Workflow Engine**:
- [ ] 测试工作流定义创建
- [ ] 测试步骤执行（activity, human_task, decision）
- [ ] 测试条件评估逻辑
- [ ] 测试超时检测
- [ ] 测试取消执行

**Automation Orchestrator**:
- [ ] 测试剧本创建和版本控制
- [ ] 测试动作执行器（SSH, EDR, Email, API）
- [ ] 测试参数模板替换
- [ ] 测试批准工作流
- [ ] 测试错误处理和回滚

**Notification Service**:
- [ ] 测试 Email 发送（mock）
- [ ] 测试 Slack webhook
- [ ] 测试通用 webhook
- [ ] 测试批量发送
- [ ] 测试优先级路由

### 集成测试（待实现）

**文件**: `tests/integration/test_workflow_pipeline.py`

测试场景：
- [ ] Workflow Engine → 触发工作流执行
- [ ] Automation Orchestrator → 执行 SOAR 剧本（使用 mocks）
- [ ] Notification Service → 发送通知（使用 mocks）
- [ ] 工作流故障时回滚
- [ ] 批准工作流集成

### E2E测试（待实现）

**文件**: `tests/system/test_workflow_e2e.py`

测试场景：
1. **关键告警触发工作流** → 验证人工任务创建
2. **高风险告警触发自动化** → 验证剧本执行
3. **告警需要通知** → 验证 Email/Slack 发送
4. **工作流失败** → 验证回滚和通知
5. **批量告警** → 验证工作流并行执行

### 性能基准

| 操作 | 目标 P95 延迟 | 备注 |
|------|--------------|------|
| 工作流执行启动 | 1s | 创建执行实例 |
| 剧本执行（单动作） | 30s | 包含外部 API 调用 |
| 通知投递（Email） | 5s | SMTP 发送 |
| 通知投递（Slack） | 1s | Webhook |
| 工作流状态更新 | 500ms | 数据库写入 |

---

## 🚀 构建和部署

### 前置条件

1. Stage 0, Stage 1, Stage 2, Stage 3 必须已完成
2. SMTP 服务器配置（用于 Email 通知，可选）
3. Slack Webhook URL（用于 Slack 通知，可选）

### 构建镜像

```bash
# 进入项目根目录
cd /Users/newmba/security

# 构建 Stage 4 服务镜像
docker-compose build workflow-engine
docker-compose build automation-orchestrator
docker-compose build notification-service
```

### 启动服务

```bash
# 启动 Stage 4 服务
docker-compose up -d workflow-engine automation-orchestrator notification-service

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f workflow-engine
docker-compose logs -f automation-orchestrator
docker-compose logs -f notification-service
```

### 验证部署

```bash
# 1. 检查服务健康
curl http://localhost:8008/health
curl http://localhost:8009/health
curl http://localhost:8010/health

# 2. 测试 Workflow Engine
# 创建工作流定义
curl -X POST http://localhost:8008/api/v1/workflows/definitions \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "test-workflow",
    "name": "Test Workflow",
    "description": "Test workflow for validation",
    "version": "1.0.0",
    "steps": [
      {
        "name": "test-step",
        "type": "activity",
        "description": "Test activity"
      }
    ],
    "timeout_seconds": 300
  }'

# 启动工作流执行
curl -X POST "http://localhost:8008/api/v1/workflows/execute?workflow_id=test-workflow" \
  -H "Content-Type: application/json" \
  -d '{"test_param": "test_value"}'

# 3. 测试 Automation Orchestrator
# 创建剧本
curl -X POST http://localhost:8009/api/v1/playbooks \
  -H "Content-Type: application/json" \
  -d '{
    "playbook_id": "test-playbook",
    "name": "Test Playbook",
    "description": "Test playbook for validation",
    "version": "1.0.0",
    "actions": [
      {
        "action_id": "test-action",
        "action_type": "api_call",
        "name": "Test API Call",
        "parameters": {
          "endpoint": "test",
          "method": "GET"
        },
        "timeout_seconds": 30
      }
    ],
    "approval_required": false,
    "timeout_seconds": 300
  }'

# 执行剧本
curl -X POST "http://localhost:8009/api/v1/playbooks/execute?playbook_id=test-playbook&alert_id=test-001" \
  -H "Content-Type: application/json" \
  -d '{"test_param": "test_value"}'

# 4. 测试 Notification Service
# 发送 Email 通知（mock）
curl -X POST http://localhost:8010/api/v1/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "email",
    "recipient": "test@example.com",
    "subject": "Test Notification",
    "message": "This is a test notification",
    "priority": "normal"
  }'

# 发送 Slack 通知（需要真实 webhook URL）
curl -X POST http://localhost:8010/api/v1/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "slack",
    "recipient": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    "subject": "Test Alert",
    "message": "🚨 Test notification from Security Triage System",
    "priority": "high"
  }'
```

---

## 📝 配置文件

### 环境变量（.env）

```bash
# ================================
# Email Notification (SMTP)
# ================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# ================================
# Slack Notification
# ================================
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### requirements.txt

**Workflow Engine** (`services/workflow_engine/requirements.txt`):
```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
pydantic-settings==2.1.0
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

**Automation Orchestrator** (`services/automation_orchestrator/requirements.txt`):
```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
pydantic-settings==2.1.0
httpx==0.25.2
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

**Notification Service** (`services/notification_service/requirements.txt`):
```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
pydantic-settings==2.1.0
httpx==0.25.2
asyncpg==0.29.0
redis==5.0.1
pika==1.3.2

# Email (optional)
aiosmtplib==3.0.1
email-validator==2.1.0

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

1. **Workflow Engine**:
   - 使用内存存储执行实例（应使用数据库）
   - Temporal 集成未实现（使用简化版工作流引擎）
   - 条件评估逻辑简单（需使用表达式引擎）
   - 人工任务通知未发送
   - 工作流恢复机制未实现

2. **Automation Orchestrator**:
   - SSH 执行为 mock（需集成 asyncssh）
   - EDR 集成为 mock（需集成真实 EDR API）
   - Email 网关为 mock（需集成真实 API）
   - 回滚机制未实现
   - 动作条件评估未完成

3. **Notification Service**:
   - Email 发送为 mock（需集成 SMTP）
   - SMS 通知未实现（需集成 Twilio/AWS SNS）
   - In-App 通知未实现（需数据库存储）
   - 通知模板系统未实现
   - 通知去重和聚合逻辑简单

### 下一步改进

**Stage 4 完善任务**:
1. 实现单元测试（覆盖率 > 85%）
2. 实现集成测试
3. 实现 E2E 测试
4. 性能基准测试和优化
5. Workflow Engine 集成 Temporal
6. Automation Orchestrator 集成真实外部系统
7. Notification Service 集成真实 Email/Slack
8. 实现通知模板系统
9. 实现工作流可视化
10. 实现剧本编辑器

---

## 📈 监控指标

### 关键指标

**Workflow Engine**:
- `workflow_executions_total` - 工作流执行总数
- `workflow_executions_active` - 活跃执行数
- `workflow_steps_total` - 步骤执行总数
- `workflow_duration_seconds` - 工作流执行时长
- `workflow_timeout_total` - 超时次数
- `human_tasks_total` - 人工任务总数
- `human_tasks_pending` - 待处理人工任务数

**Automation Orchestrator**:
- `playbook_executions_total` - 剧本执行总数
- `playbook_actions_total` - 动作执行总数
- `playbook_duration_seconds` - 剧本执行时长
- `playbook_approvals_total` - 批准请求总数
- `playbook_approvals_pending` - 待批准请求数
- `action_failures_total` - 动作失败次数
- `rollback_executions_total` - 回滚执行次数

**Notification Service**:
- `notifications_sent_total` - 通知发送总数
- `notifications_failed_total` - 通知失败总数
- `notifications_duration_seconds` - 通知发送时长
- `notifications_by_channel` - 按渠道统计通知数
- `notifications_by_priority` - 按优先级统计通知数

---

## 🎯 下一步：Stage 5 - 支持服务与前端

Stage 5 将实现以下服务：

1. **Data Analytics Service** - 数据分析服务
   - 指标计算和聚合
   - 趋势分析
   - 异常检测

2. **Reporting Service** - 报表服务
   - BI 报表生成
   - 自定义仪表板
   - PDF/Excel 导出

3. **Configuration Service** - 配置服务
   - 功能开关
   - 设置管理
   - 配置版本控制

4. **Monitoring Metrics Service** - 监控指标服务
   - Prometheus 集成
   - 自定义指标
   - 告警规则

5. **Web Dashboard** - Web 前端
   - React + TypeScript
   - 实时更新（WebSocket）
   - 主要页面：告警列表、详情、仪表板、报表

6. **API Gateway** - API 网关
   - Kong 配置
   - JWT 认证
   - 速率限制

### Stage 5 依赖

Stage 5 依赖 Stage 4 完成：
- ✅ 工作流执行数据可用
- ✅ 自动化操作记录可用
- ✅ 通知发送历史可用

---

## 📚 相关文档

- **Stage 0 部署文档**: `/Users/newmba/security/STAGE0_DEPLOYMENT.md`
- **Stage 1 部署文档**: `/Users/newmba/security/STAGE1_DEPLOYMENT.md`
- **Stage 1 功能总结**: `/Users/newmba/security/STAGE1_SUMMARY.md`
- **Stage 2 功能总结**: `/Users/newmba/security/STAGE2_SUMMARY.md`
- **Stage 3 功能总结**: `/Users/newmba/security/STAGE3_SUMMARY.md`
- **API 对接指南**: `/Users/newmba/security/API_INTEGRATION_GUIDE.md`
- **架构概览**: `/Users/newmba/security/docs/README.md`

---

## ✅ 验收标准

- [ ] Workflow Engine 成功执行工作流
- [ ] Automation Orchestrator 执行 SOAR 剧本
- [ ] Notification Service 发送多渠道通知
- [ ] 人工任务可分配和完成
- [ ] 批准工作流正常工作
- [ ] 失败工作流触发回滚
- [ ] 单元测试覆盖率 > 85%
- [ ] 集成测试包含外部系统 mock
- [ ] E2E 测试成功处理告警通过完整工作流
- [ ] 性能基准达标
- [ ] Docker 镜像构建成功
- [ ] 服务启动和运行正常

---

## 🔄 回滚计划

如果 Stage 4 验证失败，可以：

1. **检查日志**:
   ```bash
   docker-compose logs workflow-engine
   docker-compose logs automation-orchestrator
   docker-compose logs notification-service
   ```

2. **验证依赖**:
   - 确认 Stage 3 服务运行正常
   - 检查 `alert.result` 队列有消息
   - 检查数据库连接

3. **常见问题**:
   - **工作流未创建**: 检查工作流定义，修复验证逻辑
   - **剧本失败**: 检查动作执行器，修复外部系统集成
   - **通知未发送**: 检查 API 凭据，修复路由逻辑
   - **回滚失败**: 改进错误处理，添加补偿逻辑

4. **服务重启**:
   ```bash
   docker-compose restart workflow-engine automation-orchestrator notification-service
   ```

---

**Stage 4 状态**: 🟡 代码实现完成，待测试验证
**预计完成时间**: 2026-01-06（代码），2026-01-07（测试）
**下一里程碑**: Stage 5 - 支持服务与前端

---

**最后更新**: 2026-01-06
**文档版本**: 1.0
**维护者**: CCR <chenchunrun@gmail.com>
