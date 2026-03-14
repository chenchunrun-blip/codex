# 腾讯云部署完整步骤指南

**目标**: 在腾讯云 CVM 上成功部署 Security Alert Triage System
**方式**: GitHub Actions CI/CD 自动部署
**环境**: Staging (预生产环境)

---

## 📋 前置条件检查清单

在开始之前，请确保您已完成以下准备工作：

- [x] 已申请腾讯云 CVM 实例
- [x] 已配置 GitHub 仓库的 Actions Secrets
- [x] CVM 实例可访问（SSH 连接正常）
- [x] CVM 安全组已开放必要端口
- [x] 本地有 Git 仓库访问权限

---

## 🚀 完整部署流程

### 步骤 1: 初始化腾讯云 CVM

#### 1.1 连接到 CVM

```bash
# 使用 SSH 密钥连接（推荐）
ssh -i /path/to/your/key.pem ubuntu@your-cvm-ip-address

# 或使用密码连接
ssh ubuntu@your-cvm-ip-address
```

#### 1.2 下载并运行初始化脚本

```bash
# 下载初始化脚本
wget https://raw.githubusercontent.com/chenchunrun/security/main/deployment/scripts/init-cvm.sh

# 添加执行权限
chmod +x init-cvm.sh

# 运行初始化（使用 sudo）
sudo ./init-cvm.sh
```

**初始化脚本会自动安装**:
- Docker CE
- Docker Compose
- kubectl (Kubernetes 命令行工具)
- Helm 3
- k3s (可选，轻量级 Kubernetes)
- 配置防火墙规则

**预计时间**: 5-10 分钟

#### 1.3 验证安装

```bash
# 验证 Docker
docker --version
docker ps

# 验证 kubectl
kubectl version --client

# 验证 Helm
helm version --short

# 如果安装了 k3s
kubectl get nodes
```

### 步骤 2: 配置 GitHub Actions Secrets

#### 2.1 生成 kubeconfig 文件

**如果在 CVM 上安装了 k3s**:

```bash
# 在 CVM 上执行
sudo cat /etc/rancher/k3s/k3s.yaml
```

**如果使用其他 Kubernetes 集群**:

```bash
# 在 CVM 上执行
kubectl config view --raw
```

#### 2.2 添加 GitHub Secret

1. 访问 GitHub 仓库设置页面:
   ```
   https://github.com/chenchunrun/security/settings/secrets/actions
   ```

2. 点击 "New repository secret"

3. 添加以下 Secret:

   **Name**: `KUBE_CONFIG_STAGING`
   **Value**: (粘贴步骤 2.1 中获取的 kubeconfig 内容)

4. 重复以上步骤添加 `KUBE_CONFIG_PROD` (生产环境配置)

#### 2.3 其他必要的 Secrets (可选)

- `SLACK_WEBHOOK`: Slack Webhook URL，用于部署通知
- `DOCKER_USERNAME`: Docker Hub 用户名
- `DOCKER_PASSWORD`: Docker Hub 密码

### 步骤 3: 准备代码仓库

#### 3.1 切换到 develop 分支

```bash
# 在本地机器上执行
cd /Users/newmba/security
git checkout develop
```

#### 3.2 查看待提交的更改

```bash
git status
```

#### 3.3 提交所有未提交的更改（如果有）

```bash
git add .
git commit -m "chore: prepare for staging deployment"
```

### 步骤 4: 触发 CI/CD 部署到 Staging

#### 4.1 推送到 develop 分支

```bash
git push origin develop
```

**此操作会自动触发 GitHub Actions 工作流**:
1. 代码质量检查
2. 单元测试
3. 安全扫描
4. 构建 Docker 镜像
5. 推送镜像到 GHCR
6. **自动部署到 Staging 环境**

#### 4.2 监控 CI/CD 流程

1. 访问 GitHub Actions 页面:
   ```
   https://github.com/chenchunrun/security/actions
   ```

2. 查看最新的 workflow 运行状态

3. 点击进入查看详细日志:
   - Quality Check (代码检查)
   - Build Images (构建镜像)
   - Deploy to Staging (部署到 Staging)

**预计时间**: 15-30 分钟

### 步骤 5: 验证部署

#### 5.1 下载验证脚本

在 CVM 上执行:

```bash
# 下载验证脚本
cd ~
wget https://raw.githubusercontent.com/chenchunrun/security/main/deployment/scripts/verify-deployment.sh

# 添加执行权限
chmod +x verify-deployment.sh
```

#### 5.2 运行验证测试

```bash
# 验证 Staging 环境
./verify-deployment.sh staging http://localhost
```

**验证脚本会检查**:
- ✓ Kong Gateway 健康状态
- ✓ PostgreSQL 连接
- ✓ Redis 连接
- ✓ RabbitMQ 连接
- ✓ 15 个微服务健康状态
- ✓ 告警创建 API
- ✓ 告警查询 API
- ✓ API 响应时间
- ✓ Kubernetes Pods 状态

**预期输出**:
```
==========================================
  测试结果汇总
==========================================

总测试数: 25
通过: 25
通过率: 100%

部署验证通过！✓
```

#### 5.3 手动验证关键服务

```bash
# 1. 检查 Kubernetes Pods
kubectl get pods -n security-triage-staging

# 2. 检查 Services
kubectl get services -n security-triage-staging

# 3. 查看 Kong 日志
kubectl logs -n security-triage-staging deployment/kong

# 4. 测试 API 端点
curl http://localhost:8000/health

# 5. 测试告警提交
curl -X POST http://localhost:8000/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "test-001",
    "alert_type": "malware",
    "severity": "high",
    "title": "Test Alert",
    "description": "Testing deployment"
  }'
```

### 步骤 6: 访问 Web Dashboard

#### 6.1 端口转发到本地

在本地机器上执行:

```bash
# 获取 CVM IP
CVM_IP="your-cvm-ip"

# 端口转发 Web Dashboard (端口 9015)
ssh -L 9015:localhost:9015 ubuntu@$CVM_IP -N
```

#### 6.2 访问 Dashboard

在浏览器中打开:
```
http://localhost:9015
```

您应该看到 Security Alert Triage System 的 Web Dashboard。

#### 6.3 登录测试

使用测试账户登录（如果配置了认证）:
- 用户名: `admin`
- 密码: (查看 Kubernetes Secret)

```bash
# 获取 admin 密码
kubectl get secret -n security-triage-staging auth-secret \
  -o jsonpath='{.data.admin-password}' | base64 -d
```

### 步骤 7: 功能测试

#### 7.1 提交测试告警

```bash
curl -X POST http://your-cvm-ip:8000/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": "test-tencent-cloud-001",
    "alert_type": "malware",
    "severity": "high",
    "title": "Tencent Cloud Test Alert",
    "description": "Testing alert processing on Tencent Cloud",
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

#### 7.2 查询告警处理结果

```bash
# 查询告警列表
curl http://your-cvm-ip:8000/api/v1/alerts

# 查询特定告警
curl http://your-cvm-ip:8000/api/v1/alerts/test-tencent-cloud-001
```

#### 7.3 查看日志

```bash
# 查看所有服务日志
kubectl logs -n security-triage-staging -l app=security-triage --all-containers=true

# 查看特定服务日志
kubectl logs -n security-triage-staging deployment/alert-ingestor -f

# 查看 Alert Ingestor 日志
kubectl logs -n security-triage-staging -l app=alert-ingestor --tail=50 -f
```

---

## 🔧 故障排除

### 问题 1: GitHub Actions 失败

**症状**: CI/CD workflow 在某一步失败

**解决方案**:

1. 检查 GitHub Actions 日志，找出失败步骤
2. 常见问题:
   - **测试失败**: 检查单元测试是否通过
   - **镜像构建失败**: 检查 Dockerfile 语法
   - **部署失败**: 检查 kubeconfig 是否正确配置

```bash
# 本地运行测试
pytest tests/unit/ -v

# 本地构建镜像测试
docker build -t test-image ./services/alert-ingestor
```

### 问题 2: Pod 无法启动

**症状**: `kubectl get pods` 显示 Pod 状态为 `CrashLoopBackOff` 或 `Error`

**解决方案**:

```bash
# 查看 Pod 详情
kubectl describe pod <pod-name> -n security-triage-staging

# 查看 Pod 日志
kubectl logs <pod-name> -n security-triage-staging

# 常见原因:
# - 镜像拉取失败: 检查镜像名称和标签
# - 配置错误: 检查 ConfigMap 和 Secret
# - 资源不足: 检查 CVM 内存和 CPU
```

### 问题 3: 服务无法访问

**症状**: 无法访问 API 或 Web Dashboard

**解决方案**:

```bash
# 1. 检查 Service 是否存在
kubectl get services -n security-triage-staging

# 2. 检查端口是否开放
sudo ufw status
sudo netstat -tlnp | grep <port>

# 3. 检查 Kong 配置
kubectl logs -n security-triage-staging deployment/kong

# 4. 测试内部服务连通性
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://alert-ingestor:8000/health
```

### 问题 4: 数据库连接失败

**症状**: 服务日志显示数据库连接错误

**解决方案**:

```bash
# 1. 检查 PostgreSQL 是否运行
kubectl get pods -n security-triage-staging -l app=postgres

# 2. 测试数据库连接
kubectl exec -it -n security-triage-staging postgres-0 -- \
  psql -U triage_user -d security_triage

# 3. 检查数据库 Secret
kubectl get secret -n security-triage-staging database-credentials \
  -o jsonpath='{.data}' | jq .

# 4. 更新 Secret (如果密码错误)
kubectl create secret generic database-credentials \
  --from-literal=password=new_password \
  -n security-triage-staging --dry-run=client -o yaml | kubectl apply -f -
```

---

## 📊 部署后验证清单

完成部署后，请确认以下所有项目:

- [ ] GitHub Actions workflow 成功完成
- [ ] 所有 Kubernetes Pods 状态为 `Running`
- [ ] 所有 Services 正常创建
- [ ] Kong Gateway 健康检查通过
- [ ] 数据库连接正常
- [ ] Redis 连接正常
- [ ] RabbitMQ 连接正常
- [ ] 15 个微服务健康检查通过
- [ ] 可成功提交测试告警
- [ ] 可查询告警列表
- [ ] Web Dashboard 可访问
- [ ] 验证脚本测试通过率 ≥ 90%
- [ ] API 响应时间 < 1s
- [ ] 日志正常输出，无错误信息

---

## 🎯 下一步: 部署到生产环境

如果 Staging 环境测试通过，可以继续部署到生产环境:

### 方法 1: 创建 Release (推荐)

```bash
# 1. 切换到 main 分支
git checkout main
git pull origin main

# 2. 合并 develop 分支
git merge develop

# 3. 创建版本标签
git tag -a v1.0.0 -m "Release version 1.0.0"

# 4. 推送标签到 GitHub
git push origin main --tags
```

**此操作会自动触发 Production 部署**:
- 数据库自动备份
- 蓝绿部署
- E2E 测试
- 创建 GitHub Release

### 方法 2: 手动部署

```bash
# 使用部署脚本
./deployment/scripts/deploy.sh production v1.0.0
```

---

## 📝 资源链接

- **完整部署指南**: `PRODUCTION_DEPLOYMENT.md`
- **CI/CD 总结**: `PRODUCTION_CI_CD_SUMMARY.md`
- **腾讯云部署指南**: `TENCENT_CLOUD_DEPLOYMENT.md`
- **GitHub Actions**: https://github.com/chenchunrun/security/actions
- **GitHub Issues**: https://github.com/chenchunrun/security/issues

---

## ✅ 成功标准

部署被认为成功，如果:

1. **CI/CD 流程**: GitHub Actions 全部通过
2. **服务健康**: 所有 Pods 状态为 `Running`，健康检查通过
3. **功能正常**:
   - 可提交告警
   - 可查询告警
   - AI 分析正常工作
   - Web Dashboard 可访问
4. **性能达标**:
   - API 响应时间 < 1s P95
   - 告警处理时间 < 45s P95
5. **验证通过**: 验证脚本测试通过率 ≥ 90%

---

**创建时间**: 2026-01-06
**平台**: 腾讯云 CVM
**部署方式**: GitHub Actions CI/CD
**状态**: 准备就绪

**🎉 祝您部署成功！**
