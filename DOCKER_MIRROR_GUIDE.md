# Docker Hub 连接问题解决方案

**错误**: `net/http: TLS handshake timeout` when pulling RabbitMQ image

**原因**: Docker Hub (registry-1.docker.io) 在中国大陆访问不稳定

---

## 🚀 快速解决方案（按推荐顺序）

### 方案 1：配置 Docker 镜像加速器 ⭐⭐⭐ 最推荐

1. **打开 Docker Desktop**
   - 点击菜单栏的 Docker Desktop 图标
   - 选择 **Settings** (设置)

2. **配置 Docker Engine**
   - 点击左侧菜单的 **Docker Engine**
   - 在 JSON 配置中添加以下内容：

```json
{
  "registry-mirrors": [
    "https://kfp63jnj.mirror.aliyuncs.com",
    "https://2lqq34jg.mirror.aliyuncs.com",
    "https://pee6w651.mirror.aliyuncs.com",
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ],
  "dns": ["8.8.8.8", "114.114.114.114"]
}
```

3. **应用并重启**
   - 点击 **Apply & Restart**
   - 等待 Docker 重启完成

4. **验证配置**
   ```bash
   docker info | grep -A 10 "Registry Mirrors"
   ```

5. **重新拉取镜像**
   ```bash
   ./pull_infrastructure_images.sh
   ```

---

### 方案 2：使用阿里云镜像加速器

访问阿里云容器镜像服务获取专属加速地址：
https://cr.console.aliyun.com/cn-hangzhou/instances/mirrors

或者使用通用配置（见方案1）

---

### 方案 3：使用脚本重试拉取

我已经创建了重试脚本：

```bash
./pull_infrastructure_images.sh
```

这个脚本会：
- 自动重试 3 次
- 每次失败后等待 10 秒
- 显示详细的进度信息

---

### 方案 4：手动拉取单个镜像

如果只需要测试部分功能，可以只拉取必要的镜像：

```bash
# 最小化：只拉取数据库
docker pull postgres:15-alpine

# 基础设施：数据库 + 缓存
docker pull postgres:15-alpine
docker pull redis:7-alpine

# 完整基础设施
docker pull postgres:15-alpine
docker pull redis:7-alpine
docker pull rabbitmq:3.12-management-alpine
```

---

### 方案 5：使用代理

如果您有代理服务器：

1. **Docker Desktop 设置代理**：
   - Settings → Resources → Proxies
   - 启用 Manual proxy configuration
   - 输入代理地址和端口

2. **或者在 ~/.docker/config.json 中配置**：
   ```json
   {
     "proxies": {
       "default": {
         "httpProxy": "http://proxy.example.com:8080",
         "httpsProxy": "http://proxy.example.com:8080"
       }
     }
   }
   ```

---

## 🔧 验证配置

### 检查镜像加速器是否生效

```bash
docker info | grep -A 5 "Registry Mirrors"
```

应该看到：
```
Registry Mirrors:
  https://kfp63jnj.mirror.aliyuncs.com
  https://2lqq34jg.mirror.aliyuncs.com
  ...
```

### 测试拉取速度

```bash
time docker pull redis:7-alpine
```

应该快速完成（几秒到几十秒）

---

## 📊 当前状态

### ✅ 已构建的服务（7个）
- alert-ingestor
- alert-normalizer
- context-collector
- threat-intel-aggregator
- llm-router
- ai-triage-agent
- web-dashboard

### ⏳ 需要拉取的基础设施镜像
- postgres:15-alpine
- redis:7-alpine
- rabbitmq:3.12-management-alpine
- chromadb/chroma:latest

---

## 🎯 推荐操作步骤

1. **立即操作**：配置 Docker 镜像加速器（方案1）
2. **验证**：检查 `docker info` 确认配置生效
3. **拉取镜像**：运行 `./pull_infrastructure_images.sh`
4. **启动系统**：`docker-compose up -d`

---

## 🆘 如果所有方案都失败

### 选项 A：使用 SQLite 替代 PostgreSQL

部分服务支持 SQLite 作为开发数据库：
- 修改 `.env` 文件中的 `DATABASE_URL`
- 使用 `sqlite:///./data/triage.db` 替代 PostgreSQL 连接

### 选项 B：在无基础设施环境下测试

只测试已构建的服务（但会有连接错误）：

```bash
# 启动服务（会失败，但可以看到服务启动）
docker-compose up alert-ingestor alert-normalizer

# 查看日志确认服务代码运行
docker-compose logs alert-normalizer
```

### 选项 C：稍后重试

Docker Hub 的连接问题通常是临时的，可以：
- 等待几小时后重试
- 在网络状况好的时候（如凌晨）重试
- 使用不同的网络环境（如手机热点）

---

## 📞 需要帮助？

如果问题持续存在，请提供以下信息：

1. Docker Desktop 版本：`docker version`
2. 网络连接测试：`ping registry-1.docker.io`
3. 镜像拉取日志：`docker pull rabbitmq:3.12-management-alpine 2>&1 | tee pull.log`

**生成日期**: 2026-01-09
