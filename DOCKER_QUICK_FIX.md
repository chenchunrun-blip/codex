# Docker Compose 部署 - 快速修复指南

**目标**: 快速补充缺失的 Dockerfile 和修复配置，使系统可通过 docker-compose 完整启动

---

## 📋 待修复文件清单

### 必须补充 (P0)

1. `services/context_collector/Dockerfile`
2. `services/context_collector/requirements.txt`
3. `services/threat_intel_aggregator/Dockerfile`
4. `services/threat_intel_aggregator/requirements.txt`
5. `services/alert_normalizer/requirements.txt`
6. `services/llm_router/Dockerfile`

### 必须修复 (P0)

7. `docker-compose.yml` - 服务连接配置 (localhost → 服务名)

---

## 🔧 修复步骤

### 步骤 1: 创建 alert_normalizer/requirements.txt

```bash
cd /Users/newmba/security/services/alert_normalizer

# 创建 requirements.txt
cat > requirements.txt << 'EOF'
# FastAPI and Web Framework
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6

# Database
sqlalchemy==2.0.25
asyncpg==0.29.0
aiosqlite==0.19.0
alembic==1.13.0

# Data Validation
pydantic==2.5.3
pydantic-settings==2.1.0

# Messaging
aio-pika==9.3.1

# Logging
loguru==0.7.2

# Utilities
python-dotenv==1.0.0
httpx==0.26.0

# Testing
pytest==7.4.4
pytest-asyncio==0.23.3
pytest-cov==4.1.0
EOF
```

### 步骤 2: 创建 context_collector/Dockerfile

```bash
cd /Users/newmba/security/services/context_collector

cat > Dockerfile << 'EOF'
# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

# Context Collector Service - Dockerfile

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/services/shared:/app/services/context_collector:/app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        curl \
        && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# Copy shared module
COPY ../shared /app/services/shared

# Copy service code
COPY . /app/services/context_collector

# Create non-root user
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run application
CMD ["python", "main.py"]
EOF
```

### 步骤 3: 创建 context_collector/requirements.txt

```bash
cd /Users/newmba/security/services/context_collector

cat > requirements.txt << 'EOF'
# FastAPI and Web Framework
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6

# Database
sqlalchemy==2.0.25
asyncpg==0.29.0
aiosqlite==0.19.0

# Data Validation
pydantic==2.5.3
pydantic-settings==2.1.0

# Messaging
aio-pika==9.3.1

# HTTP Client
httpx==0.26.0
aiohttp==3.9.1

# Logging
loguru==0.7.2

# Utilities
python-dotenv==1.0.0

# Testing
pytest==7.4.4
pytest-asyncio==0.23.3
pytest-cov==4.1.0
EOF
```

### 步骤 4: 创建 threat_intel_aggregator/Dockerfile

```bash
cd /Users/newmba/security/services/threat_intel_aggregator

cat > Dockerfile << 'EOF'
# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");

# Threat Intelligence Aggregator Service - Dockerfile

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/services/shared:/app/services/threat_intel_aggregator:/app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        curl \
        && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# Copy shared module
COPY ../shared /app/services/shared

# Copy service code
COPY . /app/services/threat_intel_aggregator

# Create non-root user
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run application
CMD ["python", "main.py"]
EOF
```

### 步骤 5: 创建 threat_intel_aggregator/requirements.txt

```bash
cd /Users/newmba/security/services/threat_intel_aggregator

cat > requirements.txt << 'EOF'
# FastAPI and Web Framework
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6

# Database
sqlalchemy==2.0.25
asyncpg==0.29.0
aiosqlite==0.19.0

# Data Validation
pydantic==2.5.3
pydantic-settings==2.1.0

# Messaging
aio-pika==9.3.1

# HTTP Client
httpx==0.26.0
aiohttp==3.9.1

# Caching
cachetools==5.3.2

# Logging
loguru==0.7.2

# Utilities
python-dotenv==1.0.0
python-dateutil==2.8.2

# Testing
pytest==7.4.4
pytest-asyncio==0.23.3
pytest-cov==4.1.0
EOF
```

### 步骤 6: 创建 llm_router/Dockerfile

```bash
cd /Users/newmba/security/services/llm_router

cat > Dockerfile << 'EOF'
# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");

# LLM Router Service - Dockerfile

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/services/shared:/app/services/llm_router:/app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        curl \
        && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# Copy shared module
COPY ../shared /app/services/shared

# Copy service code
COPY . /app/services/llm_router

# Create non-root user
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run application
CMD ["python", "main.py"]
EOF
```

---

## 🔧 修复 docker-compose.yml 连接配置

### 方法 1: 手动修改

编辑 `/Users/newmba/security/docker-compose.yml`，批量替换：

**找到所有环境变量中的 localhost 连接**:

```yaml
# 原来的配置 (错误)
DATABASE_URL: postgresql+asyncpg://triage_user:password@localhost:5432/security_triage
RABBITMQ_URL: amqp://admin:password@localhost:5672/
REDIS_URL: redis://:password@localhost:6379/0
```

**替换为 (正确)**:

```yaml
# 修改后的配置 (正确)
DATABASE_URL: postgresql+asyncpg://triage_user:password@postgres:5432/security_triage
RABBITMQ_URL: amqp://admin:password@rabbitmq:5672/
REDIS_URL: redis://:password@redis:6379/0
```

**需要修改的服务**: 所有 15 个应用服务

### 方法 2: 自动替换脚本

```bash
cd /Users/newmba/security

# 备份原文件
cp docker-compose.yml docker-compose.yml.backup

# 批量替换
sed -i.bak 's/@localhost:5432/@postgres:5432/g' docker-compose.yml
sed -i.bak 's/@localhost:5672/@rabbitmq:5672/g' docker-compose.yml
sed -i.bak 's/@localhost:6379/@redis:6379/g' docker-compose.yml
sed -i.bak 's/@localhost:8000/@llm-router:8000/g' docker-compose.yml

# 检查修改
diff docker-compose.yml.backup docker-compose.yml
```

---

## ✅ 验证修复结果

### 1. 检查文件创建

```bash
cd /Users/newmba/security

echo "=== 检查 Dockerfile ==="
ls -l services/context_collector/Dockerfile
ls -l services/threat_intel_aggregator/Dockerfile
ls -l services/llm_router/Dockerfile

echo ""
echo "=== 检查 requirements.txt ==="
ls -l services/alert_normalizer/requirements.txt
ls -l services/context_collector/requirements.txt
ls -l services/threat_intel_aggregator/requirements.txt

echo ""
echo "=== 检查 docker-compose.yml ==="
grep -c "@postgres:" docker-compose.yml
grep -c "@rabbitmq:" docker-compose.yml
grep -c "@redis:" docker-compose.yml
```

### 2. 测试构建

```bash
# 构建缺失的服务镜像
docker-compose build context_collector
docker-compose build threat_intel_aggregator
docker-compose build llm_router

# 验证构建成功
docker images | grep security-triage
```

### 3. 测试启动

```bash
# 启动基础设施
docker-compose up -d postgres redis rabbitmq

# 等待基础设施就绪
sleep 10

# 启动核心流水线
docker-compose up -d \
    alert-ingestor \
    alert-normalizer \
    context-collector \
    threat-intel-aggregator \
    ai-triage-agent

# 检查服务状态
docker-compose ps

# 验证健康检查
curl http://localhost:9001/health  # alert-ingestor
curl http://localhost:9002/health  # alert-normalizer
curl http://localhost:9003/health  # context-collector
curl http://localhost:9004/health  # threat-intel-aggregator
curl http://localhost:9006/health  # ai-triage-agent
```

---

## 🎯 完整启动命令

### 启动所有服务

```bash
cd /Users/newmba/security

# 1. 启动基础设施和监控
docker-compose up -d postgres redis rabbitmq chromadb

# 2. 启动 Stage 1: 告警接入
docker-compose up -d alert-ingestor

# 3. 启动 Stage 2: 数据增强
docker-compose up -d alert-normalizer context-collector threat-intel-aggregator

# 4. 启动 Stage 2: LLM 路由
docker-compose up -d llm-router

# 5. 启动 Stage 3: AI 分析
docker-compose up -d ai-triage-agent similarity-search

# 6. 启动 Stage 4: 工作流
docker-compose up -d workflow-engine automation-orchestrator notification-service

# 7. 启动 Stage 5: 支持服务
docker-compose up -d data-analytics reporting-service configuration-service monitoring-metrics

# 8. 启动 API Gateway 和 Web Dashboard
docker-compose up -d kong

# 检查所有服务
docker-compose ps
```

### 一键启动 (修复后)

```bash
# 修复并启动所有服务
cd /Users/newmba/security
docker-compose up -d
```

---

## 📊 修复完成度检查表

- [ ] 创建 `services/alert_normalizer/requirements.txt`
- [ ] 创建 `services/context_collector/Dockerfile`
- [ ] 创建 `services/context_collector/requirements.txt`
- [ ] 创建 `services/threat_intel_aggregator/Dockerfile`
- [ ] 创建 `services/threat_intel_aggregator/requirements.txt`
- [ ] 创建 `services/llm_router/Dockerfile`
- [ ] 修复 `docker-compose.yml` 连接配置 (localhost → 服务名)
- [ ] 验证基础设施启动
- [ ] 验证核心服务启动
- [ ] 验证服务健康检查
- [ ] 验证完整流水线

---

## 🚨 故障排查

### 问题 1: 构建失败

**症状**: `docker-compose build` 失败

**解决方案**:
```bash
# 查看详细错误
docker-compose build context_collector --no-cache

# 检查 Dockerfile 语法
cat services/context_collector/Dockerfile

# 检查 requirements.txt
cat services/context_collector/requirements.txt
```

### 问题 2: 服务无法启动

**症状**: 容器启动后立即退出

**解决方案**:
```bash
# 查看日志
docker-compose logs context_collector

# 检查健康检查
docker-compose ps

# 进入容器调试
docker-compose run --rm context_collector /bin/sh
```

### 问题 3: 服务无法连接数据库

**症状**: 服务日志显示 "connection refused"

**解决方案**:
```bash
# 确认数据库服务已启动
docker-compose ps postgres

# 确认环境变量
docker-compose exec context_collector env | grep DATABASE_URL

# 测试数据库连接
docker-compose exec context_collector python -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
async def test():
    engine = create_async_engine('postgresql+asyncpg://triage_user:password@postgres:5432/security_triage')
    async with engine.begin() as conn:
        await conn.execute('SELECT 1')
    print('Database connection successful')
asyncio.run(test())
"
```

---

## 📝 总结

**修复时间**: 30-60分钟

**修复后状态**:
- ✅ 所有服务都有 Dockerfile
- ✅ 所有服务都有 requirements.txt
- ✅ 服务连接配置正确
- ✅ 可通过 `docker-compose up -d` 一键启动

**预期结果**:
- 15个应用服务全部容器化
- 完整的告警处理流水线
- 生产级的 Docker Compose 部署

---

**文档版本**: v1.0
**最后更新**: 2025-01-09
