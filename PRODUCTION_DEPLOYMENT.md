# 生产环境部署与 CI/CD 方案

**项目**: Security Alert Triage System
**版本**: 1.0.0
**日期**: 2026-01-06

---

## 📋 目录

1. [生产环境架构概述](#生产环境架构概述)
2. [Kubernetes 部署方案](#kubernetes-部署方案)
3. [CI/CD 流水线设计](#cicd-流水线设计)
4. [环境管理策略](#环境管理策略)
5. [监控和日志](#监控和日志)
6. [安全加固](#安全加固)
7. [备份和灾难恢复](#备份和灾难恢复)
8. [部署流程](#部署流程)

---

## 🏗️ 生产环境架构概述

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      用户/客户端                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   负载均衡器 (LB)                             │
│              HAProxy / NGINX / AWS ALB                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Kong Gateway (API Gateway)                       │
│              3 replicas, JWT Auth, Rate Limiting             │
└──────┬───────────────┬───────────────┬──────────────────────┘
       │               │               │
       ▼               ▼               ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│ Ingress  │    │ Services │    │ Services │
│ Services │    │ (15)     │    │ (15)     │
│  - Stage1│    │          │    │          │
│  - Stage2│    │ ───────  │    │ ───────  │
│  - Stage3│    │  Pods    │    │  Pods    │
│  - Stage4│    │          │    │          │
│  - Stage5│    └────┬─────┘    └────┬─────┘
└─────┬─────────┘        │              │
      │                 │              │
      └─────────────────┴──────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │     服务网格 (可选)            │
        │   Istio / Linkerd            │
        └───────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    数据层                                   │
│  PostgreSQL (主从)  Redis Cluster  RabbitMQ Cluster        │
└─────────────────────────────────────────────────────────────┘
```

### 基础设施组件

#### 1. Kubernetes 集群
- **版本**: 1.28+
- **节点**: 3-5 个节点（根据负载调整）
- **规格**: 4 cores, 16GB RAM 每节点
- **提供商**: AWS EKS / GCP GKE / Azure AKS / 自托管

#### 2. 存储层
- **PostgreSQL**: 15 (主从复制, 读写分离)
- **Redis Cluster**: 7 (3 主 + 3 从 + 1 sentinel)
- **RabbitMQ**: 3.12 (集群模式, 3 节点)
- **ChromaDB**: 持久化存储
- **对象存储**: S3 / MinIO (报表、日志)

#### 3. 监控和可观测性
- **Prometheus**: 指标收集
- **Grafana**: 可视化仪表板
- **Jaeger**: 分布式追踪
- **Loki**: 日志聚合
- **AlertManager**: 告警管理

---

## 🎯 Kubernetes 部署方案

### 目录结构

```
deployment/
├── k8s/                          # Kubernetes 配置
│   ├── base/                     # 基础配置
│   │   ├── namespace.yaml
│   │   ├── configmaps.yaml
│   │   ├── secrets.yaml
│   │   └── storage.yaml
│   ├── services/                 # 微服务配置
│   │   ├── stage1/
│   │   ├── stage2/
│   │   ├── stage3/
│   │   ├── stage4/
│   │   └── stage5/
│   ├── infrastructure/           # 基础设施服务
│   │   ├── postgres/
│   │   ├── redis/
│   │   ├── rabbitmq/
│   │   └── chromadb/
│   ├── monitoring/               # 监控组件
│   │   ├── prometheus/
│   │   ├── grafana/
│   │   └── jaeger/
│   └── ingress/                  # 入口配置
│       ├── kong/
│       └── certificate.yaml
├── helm/                         # Helm Charts
│   └── security-triage/
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── values-dev.yaml
│       ├── values-staging.yaml
│       └── values-prod.yaml
└── scripts/                      # 部署脚本
    ├── deploy.sh
    ├── rollback.sh
    └── scale.sh
```

### 部署清单示例

#### PostgreSQL StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: security-triage
spec:
  serviceName: postgres
  replicas: 2
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        env:
        - name: POSTGRES_DB
          value: security_triage
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: password
        ports:
        - containerPort: 5432
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - triage_user
            - -d
            - security_triage
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - triage_user
            - -d
            - security_triage
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 100Gi
```

#### 微服务 Deployment 模板

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: alert-ingestor
  namespace: security-triage
  labels:
    app: alert-ingestor
    stage: "1"
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: alert-ingestor
  template:
    metadata:
      labels:
        app: alert-ingestor
        version: v1.0.0
    spec:
      containers:
      - name: alert-ingestor
        image: security-triage/alert-ingestor:v1.0.0
        ports:
        - containerPort: 8000
          name: http
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-secret
              key: url
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: redis-config
              key: url
        - name: RABBITMQ_URL
          valueFrom:
            secretKeyRef:
              name: rabbitmq-secret
              key: url
        - name: LOG_LEVEL
          value: "INFO"
        - name: ENVIRONMENT
          value: "production"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        volumeMounts:
        - name: config
          mountPath: /app/config
          readOnly: true
      volumes:
      - name: config
        configMap:
          name: app-config
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - alert-ingestor
              topologyKey: kubernetes.io/hostname
```

---

## 🔄 CI/CD 流水线设计

### GitHub Actions 工作流

#### `.github/workflows/ci-cd.yml`

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  release:
    types: [created]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: security-triage

jobs:
  # ========================================
  # Job 1: 代码质量检查
  # ========================================
  lint-and-test:
    name: Lint & Test
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'
        cache: 'pip'

    - name: Install dependencies
      run: |
        pip install -r requirements.txt
        pip install black isort mypy pylint pytest pytest-cov

    - name: Run linting
      run: |
        black --check services/ tests/
        isort --check-only services/ tests/
        pylint services/
        mypy services/

    - name: Run unit tests
      run: |
        pytest tests/unit/ -v --cov=services --cov-report=xml --cov-report=html

    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage.xml
        flags: unittests
        name: codecov-umbrella

    - name: Security scan
      run: |
        pip install bandit safety
        bandit -r services/ -f json -o bandit-report.json
        safety check --json --output safety-report.json

    - name: Upload security reports
      uses: actions/upload-artifact@v3
      with:
        name: security-reports
        path: |
          bandit-report.json
          safety-report.json

  # ========================================
  # Job 2: 构建和推送镜像
  # ========================================
  build-and-push:
    name: Build & Push Docker Images
    runs-on: ubuntu-latest
    needs: lint-and-test
    if: github.event_name == 'push' || github.event_name == 'release'

    strategy:
      matrix:
        service:
          - alert-ingestor
          - alert-normalizer
          - context-collector
          - threat-intel-aggregator
          - llm-router
          - ai-triage-agent
          - similarity-search
          - workflow-engine
          - automation-orchestrator
          - notification-service
          - data-analytics
          - reporting-service
          - configuration-service
          - monitoring-metrics
          - web-dashboard

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Login to GitHub Container Registry
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v5
      with:
        images: ghcr.io/${{ github.repository }}/${{ matrix.service }}
        tags: |
          type=ref,event=branch
          type=ref,event=pr
          type=semver,pattern={{version}}
          type=semver,pattern={{major}}.{{minor}}
          type=sha,prefix={{branch}}-
          type=raw,value=latest,enable={{is_default_branch}}

    - name: Build and push Docker image
      uses: docker/build-push-action@v5
      with:
        context: ./services/${{ matrix.service }}
        file: ./services/${{ matrix.service }}/Dockerfile
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
        build-args: |
          BUILD_DATE=${{ github.event.repository.updated_at }}
          VCS_REF=${{ github.sha }}
          VERSION=${{ steps.meta.outputs.version }}

  # ========================================
  # Job 3: 部署到 Staging
  # ========================================
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: build-and-push
    if: github.ref == 'refs/heads/develop' && github.event_name == 'push'
    environment:
      name: staging
      url: https://staging.security-triage.example.com

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Configure kubectl
      uses: azure/k8s-set-context@v3
      with:
        method: kubeconfig
        kubeconfig: ${{ secrets.KUBE_CONFIG_STAGING }}

    - name: Deploy with Helm
      run: |
        helm upgrade --install security-triage-staging ./helm/security-triage \
          --namespace security-triage-staging \
          --create-namespace \
          --values ./helm/security-triage/values-staging.yaml \
          --set image.tag=${{ github.sha }} \
          --wait \
          --timeout 10m

    - name: Verify deployment
      run: |
        kubectl rollout status deployment -n security-triage-staging
        kubectl get pods -n security-triage-staging

    - name: Run smoke tests
      run: |
        ./scripts/smoke-tests.sh https://staging.security-triage.example.com

  # ========================================
  # Job 4: 部署到 Production
  # ========================================
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: build-and-push
    if: github.event_name == 'release' && github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://security-triage.example.com

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Configure kubectl
      uses: azure/k8s-set-context@v3
      with:
        method: kubeconfig
        kubeconfig: ${{ secrets.KUBE_CONFIG_PROD }}

    - name: Create backup before deployment
      run: |
        kubectl exec -n security-triage postgres-0 -- pg_dump \
          -U triage_user security_triage > backup-$(date +%Y%m%d-%H%M%S).sql

    - name: Deploy with Helm (Blue-Green)
      run: |
        helm upgrade --install security-triage-prod ./helm/security-triage \
          --namespace security-triage-prod \
          --create-namespace \
          --values ./helm/security-triage/values-prod.yaml \
          --set image.tag=${{ github.ref_name }} \
          --wait \
          --timeout 15m \
          --atomic

    - name: Verify deployment
      run: |
        kubectl rollout status deployment -n security-triage-prod
        kubectl get pods -n security-triage-prod

    - name: Run E2E tests
      run: |
        ./scripts/e2e-tests.sh https://security-triage.example.com

    - name: Notify on success
      if: success()
      uses: 8398a7/action-slack@v3
      with:
        status: ${{ job.status }}
        text: '✅ Production deployment successful!'
        webhook_url: ${{ secrets.SLACK_WEBHOOK }}

    - name: Rollback on failure
      if: failure()
      run: |
        helm rollback security-triage-prod -n security-triage-prod
```

---

## 🌍 环境管理策略

### 环境分层

```
┌─────────────────────────────────────────────────────────────┐
│                      Development                            │
│  用途: 开发和快速迭代                                         │
│  部署: Docker Compose (本地)                                │
│  数据: Mock 数据 + 本地 PostgreSQL                          │
│  URL: http://localhost:8000                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ 推送到 develop 分支
┌─────────────────────────────────────────────────────────────┐
│                       Staging                                │
│  用途: 预生产测试、集成测试、性能测试                          │
│  部署: Kubernetes (小型集群)                                 │
│  数据: 真实数据子集 + 生产数据快照                            │
│  URL: https://staging.security-triage.example.com            │
│  更新: 自动 (每次 develop 分支推送)                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ 人工审批 + Release
┌─────────────────────────────────────────────────────────────┐
│                      Production                              │
│  用途: 生产环境                                              │
│  部署: Kubernetes (高可用集群)                               │
│  数据: 生产数据                                              │
│  URL: https://security-triage.example.com                    │
│  更新: 手动触发 (蓝绿部署或金丝雀发布)                        │
└─────────────────────────────────────────────────────────────┘
```

### 配置管理

#### `helm/security-triage/values-dev.yaml`

```yaml
# 开发环境配置
environment: development
replicaCount: 1

image:
  pullPolicy: IfNotPresent

resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "200m"

autoscaling:
  enabled: false

database:
  host: postgres-postgresql
  port: 5432
  name: security_triage_dev
  sslMode: disable

redis:
  host: redis-master
  port: 6379

rabbitmq:
  host: rabbitmq
  port: 5672

logLevel: DEBUG

# 功能开关
features:
  enableMaaS: false
  enableThreatIntel: false
  enableWorkflow: false
```

#### `helm/security-triage/values-prod.yaml`

```yaml
# 生产环境配置
environment: production
replicaCount: 3

image:
  pullPolicy: Always

resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1000m"

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

podDisruptionBudget:
  minAvailable: 2

database:
  host: postgres-prod.postgres.database.com
  port: 5432
  name: security_triage
  sslMode: require
  maxConnections: 100
  poolSize: 20

redis:
  host: redis-prod.redis.cluster.com
  port: 6379
  tlsEnabled: true

rabbitmq:
  host: rabbitmq-prod.rabbitmq.cluster.com
  port: 5672
  tlsEnabled: true

logLevel: INFO
enableMetrics: true
enableTracing: true

# 生产环境功能开关
features:
  enableMaaS: true
  enableThreatIntel: true
  enableWorkflow: true

# 高可用配置
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchExpressions:
        - key: app
          operator: In
          values:
          - security-triage
      topologyKey: kubernetes.io/zone

tolerations:
- key: "workload"
  operator: "Equal"
  value: "production"
  effect: "NoSchedule"
```

---

## 📊 监控和日志

### Prometheus 监控配置

#### `monitoring/prometheus-rules.yaml`

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: security-triage-alerts
  namespace: security-triage
spec:
  groups:
  - name: api_alerts
    rules:
    - alert: HighErrorRate
      expr: |
        (sum(rate(http_requests_total{status=~"5.."}[5m]))
        / sum(rate(http_requests_total[5m]))) > 0.05
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "API error rate too high"
        description: "Error rate is {{ $value | humanizePercentage }} for the last 5 minutes"

    - alert: HighLatency
      expr: |
        histogram_quantile(0.99,
          sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
        ) > 1
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "API latency too high"
        description: "P99 latency is {{ $value }}s"

    - alert: ServiceDown
      expr: up{job="security-triage"} == 0
      for: 2m
      labels:
        severity: critical
      annotations:
        summary: "Service is down"
        description: "{{ $labels.instance }} service is down"

  - name: business_alerts
    rules:
    - alert: AlertBacklog
      expr: |
        rabbitmq_queue_messages{queue="alert.raw"} > 10000
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "Alert backlog growing"
        description: "{{ $value }} alerts in backlog"

    - alert: HighRiskAlerts
      expr: |
        sum(increase(alerts_total{severity="critical"}[1h])) > 100
      labels:
        severity: warning
      annotations:
        summary: "High volume of critical alerts"
        description: "{{ $value }} critical alerts in the last hour"
```

### Grafana 仪表板

#### 关键指标仪表板

1. **系统概览仪表板**
   - 总告警数 (按严重程度)
   - API 请求量
   - 错误率
   - P50/P95/P99 延迟
   - 服务健康状态

2. **业务指标仪表板**
   - MTTA (Mean Time To Acknowledge)
   - MTTR (Mean Time To Resolve)
   - 告警处理率
   - 自动化执行率
   - 假阳性率

3. **基础设施仪表板**
   - CPU/内存使用率
   - 网络流量
   - 磁盘 I/O
   - 数据库连接池
   - 消息队列深度

### 日志聚合 (Loki)

#### `monitoring/loki-config.yaml`

```yaml
server:
  http_listen_port: 3100

ingester:
  lifecycler:
    ring:
      kvstore:
        store: inmemory
      replication_factor: 1

schema_config:
  configs:
  - from: 2024-01-01
    store: boltdb
    object_store: filesystem
    schema: v11
    index:
      prefix: index_
      period: 24h

storage_config:
  boltdb:
    directory: /loki/index
  filesystem:
    directory: /loki/chunks

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h

chunk_store_config:
  max_look_back_period: 168h

table_manager:
  retention_deletes_enabled: false
  retention_period: 0s
```

---

## 🔒 安全加固

### Kubernetes 安全最佳实践

#### 1. Pod 安全策略

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod-template
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    capabilities:
      drop:
      - ALL
      add:
      - NET_BIND_SERVICE
  containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL
```

#### 2. 网络策略

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: security-triage-netpol
  namespace: security-triage
spec:
  podSelector:
    matchLabels:
      app: security-triage
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 8000
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: database
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - namespaceSelector:
        matchLabels:
          name: cache
    ports:
    - protocol: TCP
      port: 6379
```

#### 3. Secret 管理

```yaml
# 使用 External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-credentials
  namespace: security-triage
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: database-credentials
    creationPolicy: Owner
  data:
  - secretKey: username
    remoteRef:
      key: prod/security-triage/database
      property: username
  - secretKey: password
    remoteRef:
      key: prod/security-triage/database
      property: password
```

### 容器安全扫描

#### Trivy 扫描集成

```yaml
# .github/workflows/security-scan.yml
name: Container Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Build image
      run: |
        docker build -t test-image:${{ github.sha }} .

    - name: Run Trivy vulnerability scanner
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: test-image:${{ github.sha }}
        format: 'sarif'
        output: 'trivy-results.sarif'
        severity: 'CRITICAL,HIGH'

    - name: Upload Trivy results to GitHub Security
      uses: github/codeql-action/upload-sarif@v2
      with:
        sarif_file: 'trivy-results.sarif'
```

---

## 💾 备份和灾难恢复

### 备份策略

#### 1. 数据库备份

```bash
#!/bin/bash
# scripts/backup-database.sh

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backups/postgres"
RETENTION_DAYS=30

# 全量备份
pg_dump -h postgres-prod \
  -U triage_user \
  -d security_triage \
  -F c \
  -f "${BACKUP_DIR}/security-triage-${DATE}.dump"

# 上传到 S3
aws s3 cp "${BACKUP_DIR}/security-triage-${DATE}.dump" \
  s3://security-triage-backups/database/

# 清理旧备份
find ${BACKUP_DIR} -name "*.dump" -mtime +${RETENTION_DAYS} -delete

echo "Backup completed: security-triage-${DATE}.dump"
```

#### 2. CronJob 定时备份

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: security-triage
spec:
  schedule: "0 2 * * *"  # 每天凌晨 2 点
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15-alpine
            command:
            - /bin/bash
            - -c
            - |
              pg_dump -h postgres \
                -U triage_user \
                -d security_triage \
                -F c \
                > /backup/$(date +%Y%m%d-%H%M%S).sql
            volumeMounts:
            - name: backup-volume
              mountPath: /backup
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: password
          volumes:
          - name: backup-volume
            persistentVolumeClaim:
              claimName: backup-pvc
          restartPolicy: OnFailure
```

### 灾难恢复流程

#### 恢复脚本

```bash
#!/bin/bash
# scripts/restore-database.sh

BACKUP_FILE=$1
TARGET_ENV=${2:-staging}

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file> [target-env]"
  exit 1
fi

echo "Restoring database from: $BACKUP_FILE"
echo "Target environment: $TARGET_ENV"

# 确认
read -p "This will replace all data in ${TARGET_ENV}. Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled"
  exit 0
fi

# 执行恢复
pg_restore -h postgres-${TARGET_ENV} \
  -U triage_user \
  -d security_triage \
  -j 4 \
  --clean \
  --if-exists \
  "$BACKUP_FILE"

echo "Restore completed successfully"
```

---

## 🚀 部署流程

### 日常发布流程

#### 1. Feature 开发流程

```bash
# 1. 创建功能分支
git checkout -b feature/new-analytics

# 2. 开发和测试
npm run build
npm test

# 3. 提交代码
git add .
git commit -m "feat: add new analytics feature"

# 4. 推送到远程
git push origin feature/new-analytics

# 5. 创建 Pull Request
gh pr create --title "Add new analytics feature" --body "Description..."

# 6. CI 自动运行测试
# 7. 代码审查通过后合并到 develop
```

#### 2. 发布流程

```bash
# 1. 从 develop 创建 release 分支
git checkout develop
git pull origin develop
git checkout -b release/v1.0.0

# 2. 更新版本号
# Edit version in package.json, Chart.yaml, etc.
git add .
git commit -m "chore: bump version to v1.0.0"

# 3. 推送到远程
git push origin release/v1.0.0

# 4. 部署到 Staging 进行验证
# CI 自动部署到 staging

# 5. 在 Staging 进行测试
./scripts/smoke-tests.sh https://staging.security-triage.example.com

# 6. 如果测试通过，合并到 main 并打 tag
git checkout main
git merge release/v1.0.0
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin main --tags

# 7. CI 自动部署到 Production
```

### 紧急回滚流程

```bash
# 方法 1: Helm 回滚
helm rollback security-triage-prod -n security-triage-prod

# 方法 2: Git 回滚
git revert <commit-hash>
git push origin main

# 方法 3: 切换到之前的版本
helm upgrade --install security-triage-prod ./helm/security-triage \
  --namespace security-triage-prod \
  --set image.tag=v0.9.9 \
  --wait
```

---

## 📝 检查清单

### 部署前检查

- [ ] 所有测试通过 (单元、集成、E2E)
- [ ] 代码审查完成
- [ ] 安全扫描无高危漏洞
- [ ] 性能测试满足基准
- [ ] 文档已更新
- [ ] 数据库迁移脚本已准备
- [ ] 回滚计划已确认
- [ ] 监控和告警已配置
- [ ] 备份已完成

### 部署后验证

- [ ] 所有 Pod 运行正常
- [ ] 健康检查通过
- [ ] 日志无异常错误
- [ ] API 端点响应正常
- [ ] 数据库连接正常
- [ ] 消息队列工作正常
- [ ] 监控指标正常
- [ ] E2E 测试通过
- [ ] 性能指标达标

---

## 🎯 下一步行动

1. ✅ 创建 Kubernetes 配置文件
2. ✅ 编写 Helm Charts
3. ✅ 配置 GitHub Actions CI/CD
4. ⏳ 设置监控和告警
5. ⏳ 配置日志聚合
6. ⏳ 实施安全加固
7. ⏳ 测试备份和恢复流程
8. ⏳ 执行灾难恢复演练

---

**创建时间**: 2026-01-06
**作者**: CCR <chenchunrun@gmail.com>
**许可证**: Apache 2.0
