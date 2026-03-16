# POC实施方案

**版本**: v1.0
**日期**: 2025-01-05
**周期**: 4-6周

---

## 1. POC目标

### 1.1 核心目标

```
┌────────────────────────────────────────────────────────────────────┐
│  POC验证目标                                                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 技术可行性验证                                                     │
│     ✓ 私有化MaaS (DeepSeek/Qwen3) 集成可行性                          │
│     ✓ 向量检索在安全场景的适用性                                       │
│     ✓ 微服务架构的可运维性                                            │
│                                                                      │
│  2. 性能基准验证                                                      │
│     ✓ 端到端处理延迟 < 3s                                            │
│     ✓ 并发处理能力 100+ 告警/秒                                        │
│     ✓ 向量检索延迟 < 1s                                               │
│                                                                      │
│  3. 功能完整性验证                                                    │
│     ✓ 核心功能可用                                                   │
│     ✓ AI研判准确率 > 70%                                             │
│     ✓ 工作流转正常                                                    │
│                                                                      │
│  4. 成本效益评估                                                      │
│     ✓ 开发工作量评估                                                 │
│     ✓ 运营成本测算                                                   │
│     ✓ ROI分析                                                        │
│                                                                      │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 验证范围

**包含**:
- 告警接入和标准化
- 威胁情报查询 (集成2-3个源)
- AI智能研判 (使用私有化MaaS)
- 向量相似检索
- 基础工作流
- 简单Web UI
- 监控告警

**不包含**:
- 全部告警源接入
- 复杂SOAR编排
- 高级报表
- 多租户
- 全面的权限管理

---

## 2. POC阶段规划

### 2.1 时间线

```
Week 1-2:  基础设施搭建
  ├─ 环境准备
  ├─ 数据库部署
  ├─ 消息队列部署
  ├─ 基础服务开发
  └─ 单元测试

Week 3-4:  核心服务开发
  ├─ 告警接入服务
  ├─ AI研判服务
  ├─ 威胁情报服务
  ├─ 上下文增强服务
  └─ 集成测试

Week 5:    系统集成与优化
  ├─ 服务集成
  ├─ 性能优化
  ├─ 监控接入
  └─ 端到端测试

Week 6:    演示与评估
  ├─ 演示环境准备
  ├─ Demo演示
  ├─ 性能测试
  ├─ 文档整理
  └─ 评估报告
```

---

## 3. Week 1-2: 基础设施搭建

### 3.1 Docker Compose环境

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  # PostgreSQL
  postgres:
    image: postgres:15-alpine
    container_name: sec-triage-db
    environment:
      POSTGRES_DB: security_triage
      POSTGRES_USER: triage
      POSTGRES_PASSWORD: ${DB_PASSWORD:-triage123}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init_db.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U triage"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis
  redis:
    image: redis:7-alpine
    container_name: sec-triage-redis
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # RabbitMQ
  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: sec-triage-mq
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: ${MQ_PASSWORD:-admin123}
    ports:
      - "5672:5672"   # AMQP
      - "15672:15672" # Management UI
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5

  # ChromaDB
  chromadb:
    image: chromadb/chroma:latest
    container_name: sec-triage-vector
    ports:
      - "8001:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - CHROMA_SERVER_AUTH_CREDENTIALS_TRANSPORT=none
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 30s
      timeout: 10s
      retries: 5

  # MinIO
  minio:
    image: minio/minio:latest
    container_name: sec-triage-storage
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD:-minioadmin123}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 10s
      retries: 5

  # Prometheus
  prometheus:
    image: prom/prometheus:latest
    container_name: sec-triage-prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  # Grafana
  grafana:
    image: grafana/grafana:latest
    container_name: sec-triage-grafana
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin123}
      - GF_INSTALL_PLUGINS=

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:
  chroma_data:
  minio_data:
  prometheus_data:
  grafana_data:

networks:
  default:
    name: sec-triage-network
```

**启动脚本**:
```bash
#!/bin/bash
# scripts/start_infrastructure.sh

set -e

echo "🚀 Starting POC infrastructure..."

# 加载环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 启动服务
docker-compose up -d

# 等待服务健康
echo "⏳ Waiting for services to be healthy..."
./scripts/wait_for_services.sh

# 初始化数据库
echo "📊 Initializing database..."
docker-compose exec postgres psql -U triage -d security_triage -f /docker-entrypoint-initdb.d/init.sql

# 创建RabbitMQ队列
echo "📬 Creating message queues..."
./scripts/create_queues.sh

echo "✅ Infrastructure ready!"
echo ""
echo "📝 Service URLs:"
echo "  PostgreSQL:  localhost:5432"
echo "  Redis:       localhost:6379"
echo "  RabbitMQ:    http://localhost:15672 (admin/admin123)"
echo "  ChromaDB:    http://localhost:8001"
echo "  MinIO:       http://localhost:9001 (minioadmin/minioadmin123)"
echo "  Prometheus:  http://localhost:9090"
echo "  Grafana:     http://localhost:3000 (admin/admin123)"
```

---

### 3.2 数据库初始化

**scripts/init_db.sql**:
```sql
-- 创建扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 创建触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 这里创建POC阶段的核心表
-- (详见数据库设计文档)
```

---

## 4. Week 3-4: 核心服务开发

### 4.1 项目结构

```
security-triage-poc/
├── docker-compose.yml
├── scripts/
│   ├── start_infrastructure.sh
│   ├── wait_for_services.sh
│   └── create_queues.sh
├── services/
│   ├── alert-ingestor/
│   │   ├── Dockerfile
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   └── config.py
│   ├── threat-intel-service/
│   │   ├── Dockerfile
│   │   ├── main.py
│   │   ├── virustotal.py
│   │   └── otx.py
│   ├── triage-agent/
│   │   ├── Dockerfile
│   │   ├── main.py
│   │   ├── agent.py
│   │   └── prompts.py
│   └── workflow-engine/
│       ├── Dockerfile
│       ├── main.py
│       └── workflows.py
├── shared/
│   ├── models/
│   │   ├── alert.py
│   │   └── triage.py
│   ├── database/
│   │   ├── base.py
│   │   └── repositories.py
│   ├── messaging/
│   │   ├── publisher.py
│   │   └── consumer.py
│   └── utils/
│       ├── logger.py
│       └── config.py
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
│       └── locustfile.py
├── frontend/
│   └── (简单React UI)
└── README.md
```

### 4.2 Alert Ingestor服务

**services/alert-ingestor/main.py**:
```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from shared.messaging.publisher import publish_message
from shared.models.alert import AlertInput
from shared.utils.logger import get_logger
import uuid

app = FastAPI(title="Security Alert Ingestion API")
logger = get_logger(__name__)

@app.post("/api/v1/alerts")
async def ingest_alert(alert: AlertInput):
    """接收安全告警"""
    try:
        logger.info(f"Received alert: {alert.alert_id}")

        # 添加元数据
        alert_dict = alert.model_dump()
        alert_dict["ingestion_id"] = str(uuid.uuid4())
        alert_dict["ingested_at"] = datetime.utcnow().isoformat()

        # 发布到消息队列
        await publish_message("alert.raw", alert_dict)

        return {
            "success": True,
            "ingestion_id": alert_dict["ingestion_id"],
            "status": "queued"
        }
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "healthy"}
```

### 4.3 Triage Agent服务

**services/triage-agent/agent.py**:
```python
from langchain_openai import ChatOpenAI
from shared.utils.config import get_maas_config

class ProductionTriageAgent:
    """生产级Triage Agent"""

    def __init__(self):
        # 获取私有化MaaS配置
        maas_config = get_maas_config()

        # DeepSeek-V3 (复杂分析)
        self.deepseek_llm = ChatOpenAI(
            model="deepseek-v3",
            base_url=maas_config["deepseek"]["base_url"],
            api_key=maas_config["deepseek"]["api_key"],
            temperature=0.0,
            streaming=False
        )

        # Qwen3 (快速响应)
        self.qwen_llm = ChatOpenAI(
            model="qwen3",
            base_url=maas_config["qwen"]["base_url"],
            api_key=maas_config["qwen"]["api_key"],
            temperature=0.0,
            streaming=False
        )

    async def process_alert(self, alert: dict, context: dict, threat_intel: list):
        """处理告警"""

        # 1. 相似告警检索
        similar_alerts = await self._find_similar_alerts(alert)

        # 2. LLM分析 (根据复杂度路由)
        complexity = self._assess_complexity(alert, threat_intel)
        llm = self.deepseek_llm if complexity == "high" else self.qwen_llm

        analysis = await self._llm_analyze(llm, alert, context, threat_intel, similar_alerts)

        # 3. 风险评分
        risk_assessment = self._calculate_risk(alert, context, threat_intel, analysis)

        # 4. 生成处置建议
        remediation = self._generate_remediation(risk_assessment, alert)

        return {
            "risk_assessment": risk_assessment,
            "remediation": remediation,
            "analysis": analysis,
            "similar_alerts": similar_alerts
        }
```

### 4.4 私有化MaaS配置

**shared/utils/config.py**:
```python
import os
from typing import Dict

def get_maas_config() -> Dict:
    """
    获取私有化MaaS服务配置
    """
    return {
        "deepseek": {
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "http://internal-maas.deepseek/v1"),
            "api_key": os.getenv("DEEPSEEK_API_KEY", "internal-key-123"),
            "model": "deepseek-v3"
        },
        "qwen": {
            "base_url": os.getenv("QWEN_BASE_URL", "http://internal-maas.qwen/v1"),
            "api_key": os.getenv("QWEN_API_KEY", "internal-key-456"),
            "model": "qwen3"
        }
    }

def route_llm_task(complexity: str) -> str:
    """LLM路由策略"""
    return "deepseek" if complexity == "high" else "qwen"
```

---

## 5. Week 5: 系统集成与优化

### 5.1 集成测试

**tests/integration/test_alert_flow.py**:
```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_alert_flow():
    """测试完整告警处理流程"""

    # 1. 提交告警
    async with AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/api/v1/alerts",
            json={
                "alert_id": "TEST-001",
                "timestamp": "2025-01-05T12:00:00Z",
                "alert_type": "malware",
                "source_ip": "45.33.32.156",
                "severity": "high",
                "description": "Test malware alert",
                "file_hash": "5e884898..."
            }
        )
        assert response.status_code == 201
        ingestion_id = response.json()["ingestion_id"]

    # 2. 等待处理完成
    await asyncio.sleep(10)

    # 3. 查询研判结果
    async with AsyncClient() as client:
        response = await client.get(f"http://localhost:8000/api/v1/alerts/TEST-001")
        assert response.status_code == 200

        result = response.json()["data"]
        assert result["risk_assessment"]["risk_score"] > 0
        assert result["triage_result"] is not None
```

### 5.2 性能测试

**tests/load/locustfile.py**:
```python
from locust import HttpUser, task, between
import random
import time

class AlertUser(HttpUser):
    wait_time = between(0.5, 2.0)

    @task
    def send_alert(self):
        alert = {
            "alert_id": f"LOAD-{int(time.time() * 1000)}-{random.randint(1000, 9999)}",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "alert_type": random.choice(["malware", "brute_force", "anomaly"]),
            "source_ip": f"{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}",
            "severity": random.choice(["low", "medium", "high"]),
            "description": "Load test alert"
        }

        self.client.post("/api/v1/alerts", json=alert)
```

---

## 6. Week 6: 演示与评估

### 6.1 演示脚本

**demo/demo_scenario.sh**:
```bash
#!/bin/bash

echo "=== POC演示脚本 ==="

# 场景1: 正常告警
echo "场景1: 提交正常告警..."
curl -X POST http://localhost:8000/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @demo/alerts/normal_alert.json
sleep 5

# 场景2: 恶意软件告警
echo "场景2: 提交恶意软件告警..."
curl -X POST http://localhost:8000/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @demo/alerts/malware_alert.json
sleep 5

# 场景3: 批量告警
echo "场景3: 批量提交100条告警..."
for i in {1..100}; do
  curl -s -X POST http://localhost:8000/api/v1/alerts \
    -H "Content-Type: application/json" \
    -d @demo/alerts/batch_$i.json &
done
wait

echo "=== 演示完成 ==="
echo "查看Grafana仪表板: http://localhost:3000"
```

### 6.2 POC评估清单

**技术可行性评估**:
- [ ] 告警接收正常
- [ ] 标准化流程正常
- [ ] 威胁情报查询正常
- [ ] AI研判功能正常 (DeepSeek/Qwen3)
- [ ] 向量检索准确
- [ ] 工作流转正常
- [ ] 通知发送正常

**性能指标评估**:
- [ ] 端到端延迟 < 3s (达成率: __%)
- [ ] 并发处理能力: __ req/s
- [ ] 向量检索延迟 < 1s
- [ ] 系统资源使用正常

**业务价值评估**:
- [ ] AI研判准确率: __%
- [ ] 误报率降低: __%
- [ ] 处理效率提升: __%

**改进建议**:
- [ ] _____________________________________________________
- [ ] _____________________________________________________
- [ ] _____________________________________________________

---

## 7. 成功标准

### 7.1 必须达成 (P0)

- ✓ 所有核心功能可用
- ✓ 端到端延迟P95 < 5s
- ✓ 系统可用性 > 95%
- ✓ AI研判准确率 > 60%

### 7.2 期望达成 (P1)

- ✓ 端到端延迟P95 < 3s
- ✓ 系统可用性 > 99%
- ✓ AI研判准确率 > 70%
- ✓ 向量检索准确率 > 75%

### 7.3 加分项 (P2)

- ✓ AI研判准确率 > 80%
- ✓ 向量检索准确率 > 85%
- ✓ 提前完成POC
- ✓ 额外功能实现

---

## 8. 下一步计划

### 8.1 POC成功后

**立即行动 (1周内)**:
1. 汇报POC成果
2. 收集反馈意见
3. 制定生产环境计划
4. 组建开发团队

**短期计划 (1-2月)**:
1. 生产环境搭建
2. 全功能开发
3. 性能优化
4. 安全加固

**中期计划 (3-6月)**:
1. 灰度发布
2. 用户培训
3. 持续优化
4. 功能扩展

### 8.2 资源需求

**团队配置**:
- 后端开发: 2人
- 前端开发: 1人
- DevOps: 1人
- 测试: 1人
- 产品: 1人

**基础设施**:
- 开发环境: 本地Docker
- 测试环境: 小型K8s集群
- 生产环境: 中型K8s集群

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
**相关文档**:
- [架构总览](./01_architecture_overview.md)
- [功能需求](./02_functional_requirements.md)
- [组件清单](./03_components_inventory.md)
- [数据库设计](./04_database_design.md)
- [API设计](./05_api_design.md)
