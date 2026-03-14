# 腾讯云 CVM 部署指南

**平台**: 腾讯云 CVM (Cloud Virtual Machine)
**项目**: Security Alert Triage System
**日期**: 2026-01-06

---

## 📋 目录

1. [环境准备](#环境准备)
2. [GitHub Actions 配置](#github-actions-配置)
3. [CVM 初始化](#cvm-初始化)
4. [手动部署测试](#手动部署测试)
5. [CI/CD 自动部署](#cicd-自动部署)
6. [验证部署](#验证部署)
7. [故障排除](#故障排除)

---

## 🚀 环境准备

### 腾讯云 CVM 配置建议

**最低配置** (测试/开发):
- CPU: 4 核
- 内存: 8 GB
- 硬盘: 100 GB SSD
- 带宽: 5 Mbps
- 操作系统: Ubuntu 22.04 LTS

**推荐配置** (生产):
- CPU: 8 核
- 内存: 16 GB
- 硬盘: 200 GB SSD
- 带宽: 10 Mbps
- 操作系统: Ubuntu 22.04 LTS

### 安全组配置

**入站规则** (允许访问的端口):

| 协议 | 端口 | 来源 | 说明 |
|------|------|------|------|
| TCP | 22 | 0.0.0.0/0 | SSH |
| TCP | 80 | 0.0.0.0 | HTTP |
| TCP | 443 | 0.0.0.0 | HTTPS |
| TCP | 8000-8015 | 0.0.0.0 | 微服务端口 |
| TCP | 3000 | 0.0.0.0 | Grafana |
| TCP | 9090 | 0.0.0.0 | Prometheus |

---

## 🔐 GitHub Actions 配置

### 步骤 1: 配置 GitHub Secrets

访问您的 GitHub 仓库:
```
https://github.com/chenchunrun/security/settings/secrets/actions
```

点击 "New repository secret" 添加以下 secrets:

#### 1. Kubernetes 配置 Secret

**Name**: `KUBE_CONFIG_STAGING` 或 `KUBE_CONFIG_PROD`

**Value**: kubeconfig 文件内容

**获取方式**:

```bash
# 方法 A: 从腾讯云 TKE 集群获取
# 如果使用腾讯云 TKE (Kubernetes)，在 TKE 控制台获取 kubeconfig

# 方法 B: 如果在 CVM 上运行 k3s 或单节点 Kubernetes
ssh root@your-cvm-ip
kubectl config view --raw > kubeconfig.yaml

# 复制整个文件内容，粘贴到 GitHub Secret
```

#### 2. Slack Webhook (可选)

**Name**: `SLACK_WEBHOOK`

**Value**: 您的 Slack Webhook URL

用于部署成功通知。

#### 3. 其他 Secrets (如果需要)

```yaml
DOCKER_USERNAME: Docker Hub 用户名
DOCKER_PASSWORD: Docker Hub 密码
```

---

## 💻 CVM 初始化

### 连接到 CVM

```bash
# 使用 SSH 密钥连接
ssh -i /path/to/your/key.pem root@your-cvm-ip

# 或使用密码连接
ssh root@your-cvm-ip
```

### 运行初始化脚本

创建 `deployment/scripts/init-cvm.sh`:

```bash
#!/bin/bash

# 腾讯云 CVM 初始化脚本
# 适用于 Ubuntu 22.04 LTS

set -euo pipefail

echo "=========================================="
echo "  腾讯云 CVM 初始化"
echo "=========================================="
echo ""

# 更新系统
echo "[1/7] 更新系统包..."
apt-get update && apt-get upgrade -y

# 安装基础工具
echo "[2/7] 安装基础工具..."
apt-get install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    net-tools \
    unzip \
    jq \
    software-properties-common

# 安装 Docker
echo "[3/7] 安装 Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker ubuntu

# 安装 Docker Compose
echo "[4/7] 安装 Docker Compose..."
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-uname -m" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# 安装 kubectl (Kubernetes 命令行工具)
echo "[5/7] 安装 kubectl..."
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
mv kubectl /usr/local/bin/

# 安装 Helm
echo "[6/7] 安装 Helm..."
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 配置防火墙
echo "[7/7] 配置防火墙..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000:8015/tcp
ufw allow 3000/tcp
ufw allow 9090/tcp
ufw --force enable

echo ""
echo "=========================================="
echo "  初始化完成！"
echo "=========================================="
echo ""
echo "已安装的工具:"
echo "  - Docker: $(docker --version)"
echo "  - Docker Compose: $(docker-compose --version)"
echo "  - kubectl: $(kubectl version --client --short)"
echo "  - Helm: $(helm version --short)"
echo ""
echo "请重新登录以使 docker 组权限生效:"
echo "  ssh root@$(hostname -I | awk '{print $1}')"
echo ""
```

### 运行初始化

```bash
# 下载并运行初始化脚本
curl -fsSL https://raw.githubusercontent.com/chenchunrun/security/main/deployment/scripts/init-cvm.sh -o init-cvm.sh
chmod +x init-cvm.sh
sudo ./init-cvm.sh
```

或手动执行:

```bash
# 更新系统
sudo apt-get update && sudo apt-get upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# 安装 Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

## 🧪 手动部署测试 (推荐先执行)

在触发 CI/CD 前，建议先手动部署测试，确保环境正常。

### 方案 A: 使用 Docker Compose (最简单)

```bash
# 1. 连接到 CVM
ssh root@your-cvm-ip

# 2. 克隆代码
git clone https://github.com/chenchunrun/security.git
cd security

# 3. 配置环境变量
cp .env.example .env
vim .env  # 修改必要的配置（数据库密码等）

# 4. 启动所有服务
docker-compose up -d

# 5. 查看服务状态
docker-compose ps

# 6. 查看日志
docker-compose logs -f

# 7. 测试访问
curl http://localhost:8000/health  # Kong Gateway
curl http://localhost:9015/health  # Web Dashboard
```

### 方案 B: 使用 Kubernetes (生产级)

#### 步骤 1: 安装 Kubernetes

**选项 1: 使用 k3s (轻量级，推荐)**

```bash
# 在 CVM 上安装 k3s
curl -sfL https://get.k3s.io | sh -

# 验证安装
kubectl get nodes

# 查看 kubeconfig
cat /etc/rancher/k3s/k3s.yaml
```

**选项 2: 使用 MicroK8s**

```bash
# 安装 MicroK8s
curl -sfL https://microk8s.io/install.sh | bash

# 启动
microk8s start

# 验证
microk8s status
kubectl get nodes
```

#### 步骤 2: 部署应用

```bash
# 1. 克隆代码
git clone https://github.com/chenchunrun/security.git
cd security

# 2. 创建命名空间
kubectl create namespace security-triage

# 3. 使用 Helm 部署
helm install security-triage deployment/helm/security-triage \
  --namespace security-triage \
  --values deployment/helm/security-triage/values.yaml

# 4. 查看部署状态
kubectl get pods -n security-triage
kubectl get services -n security-triage

# 5. 等待 Pod 就绪
kubectl wait --for=condition=ready pod -l app=security-triage -n security-triage --timeout=300s
```

#### 步骤 3: 配置 Ingress (可选)

如果需要域名访问，配置 Ingress:

```bash
# 安装 NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

# 创建 Ingress 规则
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: security-triage-ingress
  namespace: security-triage
spec:
  rules:
  - host: security-triage.your-domain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: kong
            port:
              number: 8000
EOF
```

---

## 🔄 CI/CD 自动部署

### 触发 GitHub Actions

#### 方法 1: 推送到 develop 分支 (部署到 Staging)

```bash
# 在您的本地机器
git checkout develop
git pull origin develop

# 做一些修改...
git add .
git commit -m "test: trigger CI/CD"
git push origin develop
```

**CI/CD 流程**:
1. 代码质量检查
2. 构建镜像并推送到 GHCR
3. 自动部署到 Staging 环境
4. 运行 Smoke Tests

#### 方法 2: 创建 Release (部署到 Production)

```bash
# 在您的本地机器
git checkout main
git pull origin main

# 创建 release 分支
git checkout -b release/v1.0.0

# 更新版本号
# 编辑 Chart.yaml 中的版本

git add .
git commit -m "chore: bump version to v1.0.0"
git push origin release/v1.0.0

# 创建 Pull Request 并合并

# 创建 Git Tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin main --tags
```

**CI/CD 流程**:
1. 代码质量检查
2. 构建镜像并推送
3. **生产环境数据库备份**
4. 部署到 Production
5. 运行 E2E Tests
6. 创建 GitHub Release

---

## ✅ 验证部署

### 基础验证

```bash
# 1. 检查 Pod 状态
kubectl get pods -n security-triage

# 应该看到所有 Pod 都在 Running 状态

# 2. 检查服务
kubectl get services -n security-triage

# 3. 检查日志
kubectl logs -n security-triage -l app=kong

# 4. 端口转发到本地 (测试用)
kubectl port-forward -n security-triage svc/kong 8000:8000

# 5. 访问服务
curl http://localhost:8000/health
```

### Web 界面访问

#### 如果配置了 LoadBalancer 或 Ingress:

```bash
# 查看 Kong 外网 IP
kubectl get svc kong -n security-triage

# 或查看 CVM 公网 IP
curl ifconfig.me
```

访问:
```
http://your-cvm-ip:8000    # Kong Gateway
http://your-cvm-ip:9015    # Web Dashboard
http://your-cvm-ip:3000    # Grafana
```

---

## 🧪 功能测试

### 1. 健康检查

```bash
# Kong Gateway
curl http://your-cvm-ip:8000/health

# Web Dashboard
curl http://your-cvm-ip:9015/health

# 各个微服务
for port in 9001 9002 9003 9004 9005 9006 9007 9008 9009 9010 9011 9012 9013 9014 9015; do
  echo "Testing port $port..."
  curl http://your-cvm-ip:$port/health
done
```

### 2. 提交测试告警

```bash
# 提交测试告警
curl -X POST http://your-cvm-ip:8000/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "test-001",
    "alert_type": "malware",
    "severity": "high",
    "title": "Test Alert from Tencent Cloud",
    "description": "Testing deployment on Tencent Cloud CVM",
    "source_ip": "192.168.1.100",
    "destination_ip": "10.0.0.1",
    "iocs": [
      {"type": "ip", "value": "192.168.1.100"},
      {"type": "hash", "value": "5d41402abc4b2a76b9719d911017c592"}
    ],
    "timestamp": "2026-01-06T15:30:00Z",
    "tags": ["test", "tencent-cloud"]
  }'
```

### 3. 查看处理结果

```bash
# 查看告警列表
curl http://your-cvm-ip:8000/api/v1/alerts

# 查看 Kafka 消息队列
# docker-compose exec -T rabbitmq rabbitmqctl list_queues
```

---

## 📊 监控和日志

### Grafana 访问

```bash
# 端口转发
kubectl port-forward -n security-triage svc/grafana 3000:80

# 访问
http://localhost:3000

# 默认凭据
Username: admin
Password: (查看 Secret)
kubectl get secret grafana -n security-triage -o jsonpath='{.data.admin-password}' | base64 -d
```

### Prometheus 访问

```bash
# 端口转发
kubectl port-forward -n security-triage svc/prometheus 9090:9090

# 访问
http://localhost:9090
```

### 查看日志

```bash
# 所有 Pod 日志
kubectl logs -n security-triage -l app=security-triage --all-containers=true

# 特定服务日志
kubectl logs -n security-triage deployment/alert-ingestor

# 实时查看日志
kubectl logs -n security-triage deployment/alert-ingestor -f

# 查看 Docker Compose 日志
docker-compose logs -f
```

---

## 🔧 常见问题

### 1. 端口被占用

```bash
# 查看端口占用
sudo netstat -tlnp | grep <port>

# 如果是 80/443 端口
sudo systemctl stop nginx  # 或其他服务
```

### 2. 内存不足

```bash
# 查看内存使用
free -h

# 增加 swap 空间
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### 3. Docker 镜像拉取慢

```bash
# 配置腾讯云镜像加速
sudo tee /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF

sudo systemctl restart docker
```

### 4. Pod 无法启动

```bash
# 查看 Pod 详情
kubectl describe pod <pod-name> -n security-triage

# 查看 Pod 日志
kubectl logs <pod-name> -n security-triage

# 进入容器调试
kubectl exec -it <pod-name> -n security-triage -- bash
```

### 5. 连接 GitHub 失败

```bash
# 检查网络
ping github.com
curl -I https://github.com

# 如果被墙，配置代理
export https_proxy=http://proxy-server:port
export http_proxy=http://proxy-server:port
```

---

## 🎯 快速开始清单

### 第一次部署（推荐）

```bash
# [ ] 1. 连接到 CVM
ssh root@your-cvm-ip

# [ ] 2. 更新系统并安装 Docker
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu

# 重新登录以使 docker 组权限生效
exit
ssh root@your-cvm-ip

# [ ] 3. 克隆代码
git clone https://github.com/chenchunrun/security.git
cd security

# [ ] 4. 启动服务 (Docker Compose)
docker-compose up -d

# [ ] 5. 验证部署
docker-compose ps
docker-compose logs

# [ ] 6. 测试访问
curl http://localhost:8000/health
```

### 使用 CI/CD 部署

```bash
# [ ] 1. 配置 GitHub Actions Secrets
# 访问: https://github.com/chenchunrun/security/settings/secrets/actions

# [ ] 2. 准备 kubeconfig
# 在 CVM 上运行: kubectl config view > kubeconfig.yaml
# 将内容添加到 GitHub Secret: KUBE_CONFIG_PROD

# [ ] 3. 触发部署
git push origin develop  # 部署到 Staging
# 或
git tag -a v1.0.0 && git push origin main --tags  # 部署到 Production
```

---

## 📝 下一步

1. ✅ **手动部署测试** - 先用 Docker Compose 测试
2. ✅ **配置 GitHub Actions** - 添加必要的 Secrets
3. ✅ **触发 CI/CD** - 推送代码触发自动部署
4. ✅ **验证部署** - 检查服务和功能
5. ✅ **配置域名** - 设置 DNS 和 SSL 证书
6. ✅ **启用监控** - 配置 Prometheus + Grafana
7. ✅ **性能优化** - 根据负载调整资源

---

## 🆘 获取帮助

### 文档资源

- **完整部署指南**: `PRODUCTION_DEPLOYMENT.md`
- **CI/CD 总结**: `PRODUCTION_CI_CD_SUMMARY.md`
- **推送指南**: `PUSH_INSTRUCTIONS.md`

### GitHub Issues

如果遇到问题，请在 GitHub 创建 Issue:
```
https://github.com/chenchunrun/security/issues
```

---

**创建时间**: 2026-01-06
**平台**: 腾讯云 CVM
**状态**: 准备就绪
