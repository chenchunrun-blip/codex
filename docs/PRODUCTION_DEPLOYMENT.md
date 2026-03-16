# Production Deployment Guide

This guide provides step-by-step instructions for deploying the Security Alert Triage System to production Kubernetes environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Configuration](#configuration)
4. [Deployment](#deployment)
5. [Verification](#verification)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

- **Kubernetes Cluster**: v1.25+ (with kubectl configured)
- **Helm 3.x**: For chart deployment
- **Storage Class**: `fast-ssd` configured in your cluster
- **Load Balancer**: For ingress (e.g., NGINX Ingress Controller)
- **TLS Certificate**: cert-manager or manual TLS certificates

### Cluster Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Nodes | 3 | 5+ |
| CPU per Node | 4 cores | 8+ cores |
| Memory per Node | 16 GB | 32+ GB |
| Storage | 200 Gi SSD | 500+ Gi SSD |
| Network | 1 Gbps | 10 Gbps |

---

## Environment Setup

### 1. Create Namespace

```bash
kubectl create namespace security-triage
```

### 2. Create Storage Classes

Ensure your cluster has a `fast-ssd` storage class:

```bash
kubectl get storageclass fast-ssd
```

If not, create one:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
```

```bash
kubectl apply -f k8s/production/storage-class.yaml
```

### 3. Install NGINX Ingress Controller

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.publishService.enabled=true
```

### 4. Install cert-manager (for TLS)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

Create ClusterIssuer for Let's Encrypt:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: security@company.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
```

```bash
kubectl apply -f k8s/production/cluster-issuer.yaml
```

---

## Configuration

### 1. Update Secrets

Edit `k8s/base/00-infrastructure.yaml` and update all `CHANGE_ME` values:

```yaml
stringData:
  DATABASE_URL: "postgresql+asyncpg://postgres:YOUR_DB_PASSWORD@postgres-primary:5432/security_triage"
  REDIS_URL: "redis://:YOUR_REDIS_PASSWORD@redis-cluster:6379/0"
  RABBITMQ_URL: "amqp://admin:YOUR_RABBITMQ_PASSWORD@rabbitmq-ha:5672/"
  ENCRYPTION_KEY: "GENERATE_STRONG_32_CHAR_KEY_HERE"
```

### 2. Configure LLM API Keys

Add your API keys to the secret:

```yaml
stringData:
  ZHIPU_API_KEY: "your-zhipu-api-key"
  DEEPSEEK_API_KEY: "your-deepseek-api-key"
  QWEN_API_KEY: "your-qwen-api-key"
  OPENAI_API_KEY: "your-openai-api-key"
  VIRUSTOTAL_API_KEY: "your-virustotal-api-key"
  OTX_API_KEY: "your-otx-api-key"
```

### 3. Update Ingress Host

Edit `k8s/base/01-web-dashboard.yaml`:

```yaml
spec:
  tls:
  - hosts:
    - security-triage.yourcompany.com  # CHANGE THIS
```

### 4. Configure Helm Values

Copy and customize values:

```bash
cp helm/security-triage/values.yaml helm/security-triage/custom-values.yaml
```

Edit `custom-values.yaml` for your environment.

---

## Deployment

### Option 1: Deploy with kubectl

```bash
# Apply base infrastructure
kubectl apply -f k8s/base/00-infrastructure.yaml

# Deploy PostgreSQL HA
kubectl apply -f k8s/production/postgres-ha.yaml

# Deploy Redis Cluster
kubectl apply -f k8s/production/redis-cluster.yaml

# Deploy RabbitMQ Cluster
kubectl apply -f k8s/production/rabbitmq-cluster.yaml

# Wait for infrastructure to be ready
kubectl wait --for=condition=ready pod -l app=postgres --timeout=300s -n security-triage
kubectl wait --for=condition=ready pod -l app=redis --timeout=300s -n security-triage
kubectl wait --for=condition=ready pod -l app=rabbitmq --timeout=300s -n security-triage

# Deploy services
kubectl apply -f k8s/base/01-web-dashboard.yaml
kubectl apply -f k8s/base/02-alert-ingestor.yaml

# Verify all pods are running
kubectl get pods -n security-triage
```

### Option 2: Deploy with Helm

```bash
# Install with custom values
helm install security-triage ./helm/security-triage \
  -f helm/security-triage/custom-values.yaml \
  -n security-triage \
  --create-namespace

# Or upgrade existing deployment
helm upgrade security-triage ./helm/security-triage \
  -f helm/security-triage/custom-values.yaml \
  -n security-triage
```

### Initialize Redis Cluster

```bash
# Create Redis cluster slots
kubectl exec -it redis-cluster-0 -n security-triage -- redis-cli --cluster create \
  $(kubectl get pods -n security-triage -l app=redis-cluster -o jsonpath='{range .items[*]}{.status.podIP}:6379 '}) \
  --cluster-replicas 1
```

---

## Verification

### 1. Check Pod Status

```bash
kubectl get pods -n security-triage -w
```

Expected output:
```
NAME                                          READY   STATUS    RESTARTS   AGE
alert-ingestor-xxx-yyy                       1/1     Running   0          2m
web-dashboard-xxx-yyy                         1/1     Running   0          2m
postgres-primary-0                             1/1     Running   0          5m
postgres-replica-0                             1/1     Running   0          4m
postgres-replica-1                             1/1     Running   0          4m
redis-cluster-0                                1/1     Running   0          3m
redis-cluster-1                                1/1     Running   0          3m
rabbitmq-ha-0                                  1/1     Running   0          4m
rabbitmq-ha-1                                  1/1     Running   0          3m
rabbitmq-ha-2                                  1/1     Running   0          3m
```

### 2. Check Services

```bash
kubectl get svc -n security-triage
```

### 3. Check Ingress

```bash
kubectl get ingress -n security-triage
```

### 4. Test Application

```bash
# Get ingress URL
export INGRESS_URL=$(kubectl get ingress web-dashboard-ingress -n security-triage -o jsonpath='{.spec.rules[0].host}')

# Test health endpoint
curl https://$INGRESS_URL/api/v1/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "web-dashboard"
}
```

### 5. Check Database Connectivity

```bash
kubectl exec -it postgres-primary-0 -n security-triage -- psql -U postgres -d security_triage -c "SELECT version();"
```

### 6. Check Redis Cluster

```bash
kubectl exec -it redis-cluster-0 -n security-triage -- redis-cli cluster info
```

Expected: `cluster_state:ok`

### 7. Check RabbitMQ Cluster

```bash
kubectl exec -it rabbitmq-ha-0 -n security-triage -- rabbitmqctl cluster_status
```

---

## Monitoring

### Prometheus ServiceMonitors

ServiceMonitors are automatically created. Verify:

```bash
kubectl get servicemonitors -n security-triage
```

### Access Grafana Dashboard

Port-forward to Grafana:

```bash
kubectl port-forward -n monitoring svc/grafana 3000:80
```

Navigate to http://localhost:3000 and import dashboards from `monitoring/grafana/dashboards/`.

### Metrics to Monitor

Key metrics to set up alerts for:

| Metric | Warning | Critical |
|--------|---------|----------|
| Pod CPU Usage | 70% | 90% |
| Pod Memory Usage | 80% | 95% |
| Database Connections | 80% | 95% |
| RabbitMQ Queue Depth | 1000 | 5000 |
| API Response Time | 1s | 3s |
| Error Rate | 5% | 10% |

---

## Troubleshooting

### Pods Not Starting

1. Check pod status:
   ```bash
   kubectl describe pod <pod-name> -n security-triage
   ```

2. Check logs:
   ```bash
   kubectl logs <pod-name> -n security-triage
   ```

3. Check events:
   ```bash
   kubectl get events -n security-triage --sort-by='.lastTimestamp'
   ```

### Database Connection Failures

1. Check PostgreSQL pods:
   ```bash
   kubectl get pods -n security-triage -l app=postgres
   ```

2. Verify database is ready:
   ```bash
   kubectl exec -it postgres-primary-0 -n security-triage -- pg_isready
   ```

3. Check replication status:
   ```bash
   kubectl exec -it postgres-primary-0 -n security-triage -- psql -U postgres -c "\x" -c "SELECT * FROM pg_stat_replication;"
   ```

### Redis Cluster Issues

1. Check cluster state:
   ```bash
   kubectl exec -it redis-cluster-0 -n security-triage -- redis-cli cluster info
   ```

2. Check nodes:
   ```bash
   kubectl exec -it redis-cluster-0 -n security-triage -- redis-cli cluster nodes
   ```

3. Reset cluster (if needed):
   ```bash
   kubectl exec -it redis-cluster-0 -n security-triage -- redis-cli --cluster reset
   ```

### RabbitMQ Cluster Issues

1. Check cluster status:
   ```bash
   kubectl exec -it rabbitmq-ha-0 -n security-triage -- rabbitmqctl cluster_status
   ```

2. Check queues:
   ```bash
   kubectl exec -it rabbitmq-ha-0 -n security-triage -- rabbitmqctl list_queues
   ```

3. Access management UI:
   ```bash
   kubectl port-forward -n security-triage svc/rabbitmq-management 15672:15672
   ```
   Navigate to http://localhost:15672 (user: admin)

---

## Scaling

### Horizontal Pod Autoscaling

HPA is configured for critical services. Check status:

```bash
kubectl get hpa -n security-triage
```

Manual scaling:

```bash
kubectl scale deployment alert-ingestor --replicas=5 -n security-triage
```

### Vertical Scaling

Edit resource limits in values.yaml and upgrade:

```bash
helm upgrade security-triage ./helm/security-triage -f custom-values.yaml -n security-triage
```

---

## Backup and Recovery

### PostgreSQL Backup

```bash
# Create backup
kubectl exec postgres-primary-0 -n security-triage -- pg_dump -U postgres security_triage > backup.sql

# Restore
kubectl exec -i postgres-primary-0 -n security-triage -- psql -U postgres security_triage < backup.sql
```

### Volume Snapshots

Use your cloud provider's snapshot service:

```bash
# AWS EBS
aws ec2 create-snapshot --volume-id $(kubectl get pvc postgres-data -n security-triage -o jsonpath='{.spec.volumeName}')
```

---

## Upgrades

### Rolling Upgrade

```bash
helm upgrade security-triage ./helm/security-triage \
  -f helm/security-triage/custom-values.yaml \
  -n security-triage
```

### Rollback

```bash
helm rollback security-triage -n security-triage
```

---

## Security Hardening

See `docs/04_security_standards.md` for complete security checklist.

Key items:
- [ ] Run containers as non-root
- [ ] Network policies enabled
- [ ] Pod Security Policies enforced
- [ ] Secrets encrypted at rest
- [ ] TLS enabled for all communications
- [ ] RBAC configured
- [ ] Audit logging enabled

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/chenchunrun/security/issues
- Documentation: https://github.com/chenchunrun/security/docs
- Email: security@company.com
