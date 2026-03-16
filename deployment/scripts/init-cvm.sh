#!/bin/bash

# 腾讯云 CVM 初始化脚本
# 适用于 Ubuntu 22.04 LTS
# 安装 Docker, kubectl, Helm, Docker Compose

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo "=========================================="
echo "  腾讯云 CVM 初始化"
echo "=========================================="
echo ""

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    log_error "请使用 sudo 运行此脚本"
    exit 1
fi

# 1. 更新系统
log_info "[1/7] 更新系统包..."
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get upgrade -y

# 2. 安装基础工具
log_info "[2/7] 安装基础工具..."
apt-get install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    net-tools \
    unzip \
    jq \
    software-properties-common \
    ca-certificates \
    gnupg \
    lsb-release

# 3. 安装 Docker
log_info "[3/7] 安装 Docker..."

# 添加 Docker 官方 GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# 设置 Docker 仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动 Docker
systemctl start docker
systemctl enable docker

# 添加当前用户到 docker 组（如果存在 ubuntu 用户）
if id "ubuntu" &>/dev/null; then
    usermod -aG docker ubuntu
    log_info "用户 ubuntu 已添加到 docker 组"
fi

# 配置腾讯云镜像加速（可选）
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl restart docker

# 4. 安装 Docker Compose (standalone)
log_info "[4/7] 安装 Docker Compose..."
DOCKER_COMPOSE_VERSION="v2.24.5"
curl -SL "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# 5. 安装 kubectl (Kubernetes 命令行工具)
log_info "[5/7] 安装 kubectl..."
KUBECTL_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt)
curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
chmod +x kubectl
mv kubectl /usr/local/bin/

# 6. 安装 Helm
log_info "[6/7] 安装 Helm..."
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 7. 安装 k3s (轻量级 Kubernetes，可选)
log_warn "[7/7] 是否安装 k3s (轻量级 Kubernetes)?"
read -p "安装 k3s? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "安装 k3s..."
    curl -sfL https://get.k3s.io | sh -

    # 等待 k3s 启动
    sleep 10

    # 验证安装
    if command -v kubectl &> /dev/null; then
        log_info "k3s 安装成功！"
        kubectl get nodes
        kubectl get pods --all-namespaces
    else
        log_error "k3s 安装失败"
    fi
else
    log_info "跳过 k3s 安装"
fi

# 8. 配置防火墙
log_info "配置防火墙..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 8000:8015/tcp
    ufw allow 3000/tcp
    ufw allow 9090/tcp
    ufw --force enable
    log_info "防火墙规则已配置"
else
    log_warn "ufw 未安装，跳过防火墙配置"
fi

# 9. 验证安装
echo ""
echo "=========================================="
echo "  验证安装"
echo "=========================================="
echo ""

log_info "Docker:"
docker --version
docker info | grep "Server Version" || true

echo ""
log_info "Docker Compose:"
docker-compose --version

echo ""
log_info "kubectl:"
kubectl version --client --short

echo ""
log_info "Helm:"
helm version --short

# 如果安装了 k3s
if command -v k3s &> /dev/null; then
    echo ""
    log_info "k3s:"
    k3s --version
fi

echo ""
echo "=========================================="
echo "  初始化完成！"
echo "=========================================="
echo ""

# 显示后续步骤
log_info "后续步骤:"
echo ""
echo "1. 如果安装了 k3s，kubeconfig 位于: /etc/rancher/k3s/k3s.yaml"
echo "   复制命令: sudo cat /etc/rancher/k3s/k3s.yaml"
echo ""
echo "2. 如果添加了 ubuntu 用户到 docker 组，请重新登录:"
echo "   ssh ubuntu@$(hostname -I | awk '{print $1}')"
echo ""
echo "3. 克隆项目代码:"
echo "   git clone https://github.com/chenchunrun/security.git"
echo "   cd security"
echo ""
echo "4. 测试 Docker Compose 部署:"
echo "   docker-compose up -d"
echo ""
echo "5. 测试 Kubernetes 部署 (如果安装了 k3s):"
echo "   kubectl create namespace security-triage"
echo "   helm install security-triage deployment/helm/security-triage \\"
echo "     --namespace security-triage \\"
echo "     --values deployment/helm/security-triage/values.yaml"
echo ""
echo "✅ CVM 初始化完成！"
