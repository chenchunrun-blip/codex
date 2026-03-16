# 如何推送到 GitHub - slowapi 依赖修复

**日期**: 2026-01-07
**状态**: ⏳ 本地已提交，等待推送
**问题**: 网络 HTTPS 连接不稳定

---

## 📦 当前状态

### 待推送的提交

```
5eadd78  fix: Add slowapi dependency for rate limiting
```

**包含内容**:
- `requirements.txt` - 添加 `slowapi==0.1.9`
- `PENDING_PUSH_SLOWAPI_FIX.md` - 详细说明文档

### 为什么需要推送？

GitHub Actions CI/CD 正在运行，但遇到错误：
```
ModuleNotFoundError: No module named 'slowapi'
from slowapi import Limiter, _rate_limit_exceeded_handler
```

这是因为本地已添加 `slowapi==0.1.9` 到 `requirements.txt`，但还没有推送到 GitHub。

---

## 🚀 推送方法

### 方法 1: 使用推送脚本 (推荐)

```bash
cd /Users/newmba/security
./push_to_github.sh
```

脚本会自动尝试多种推送方法。

### 方法 2: 手动推送

```bash
cd /Users/newmba/security
git push origin main
```

### 方法 3: 切换到 SSH (最稳定)

如果 HTTPS 持续失败，切换到 SSH：

```bash
# 1. 检查是否已配置 SSH
ls ~/.ssh/id_ed25519
# 或
ls ~/.ssh/id_rsa

# 2. 如果没有 SSH 密钥，生成一个
ssh-keygen -t ed25519 -C "your_email@example.com"

# 3. 启动 ssh-agent 并添加密钥
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

# 4. 复制公钥
cat ~/.ssh/id_ed25519.pub

# 5. 在 GitHub 添加 SSH key:
#    - 访问 https://github.com/settings/keys
#    - 点击 "New SSH key"
#    - 粘贴公钥内容
#    - 保存

# 6. 切换远程 URL 到 SSH
git remote set-url origin git@github.com:chenchunrun/security.git

# 7. 推送
git push origin main
```

### 方法 4: 使用 HTTP/1.1 (绕过 HTTP/2 问题)

```bash
cd /Users/newmba/security
git -c http.version=HTTP/1.1 push origin main
```

### 方法 5: GitHub Desktop (图形界面)

1. 打开 GitHub Desktop
2. 选择 `security` 仓库
3. 点击 "Push origin" 按钮
4. 等待完成

---

## 🔍 故障排除

### 检查 1: 网络连接

```bash
# Ping GitHub
ping github.com

# 测试 HTTPS 连接
curl -I https://github.com
```

### 检查 2: Git 配置

```bash
# 查看远程 URL
git remote -v

# 查看当前状态
git status

# 查看待推送提交
git log origin/main..main --oneline
```

### 检查 3: 代理设置

如果你使用代理：

```bash
# 设置代理
export http_proxy=http://proxy.example.com:8080
export https_proxy=http://proxy.example.com:8080

# 推送
git push origin main

# 或者永久配置
git config --global http.proxy http://proxy.example.com:8080
git config --global https.proxy http://proxy.example.com:8080
```

### 检查 4: VPN/防火墙

- 如果使用 VPN，尝试暂时关闭
- 检查防火墙是否阻止 443 端口
- 尝试切换网络（例如切换到手机热点）

---

## ✅ 推送成功后

### 1. 验证文件更新

访问 GitHub 查看文件：
```
https://github.com/chenchunrun/security/blob/main/requirements.txt
```

应该看到第 14 行：
```txt
slowapi==0.1.9
```

### 2. 查看 GitHub Actions

访问：
```
https://github.com/chenchunrun/security/actions
```

**预期结果**:
- ✅ `pip install` 成功安装 slowapi
- ✅ `from slowapi import Limiter` 成功
- ✅ `test_alert_ingestor.py` 收集成功
- ✅ 单元测试开始运行

**不再出现**:
- ❌ `ModuleNotFoundError: No module named 'slowapi'`
- ❌ ERROR collecting test files

---

## 📝 总结

### 问题

```
本地添加 slowapi → 推送失败 → GitHub Actions 用旧 requirements.txt → 导入失败
```

### 解决

```
手动推送 → GitHub 更新 → Actions 安装 slowapi → 测试通过
```

### 最快方法

**选择其一**:
1. 运行 `./push_to_github.sh` (自动尝试多种方法)
2. 运行 `git push origin main` (手动推送)
3. 切换到 SSH 后推送 (最稳定)

---

**创建时间**: 2026-01-07
**待推送提交**: 5eadd78
**关键文件**: requirements.txt (slowapi==0.1.9)

**🎯 请任选一种方法推送，通常 1 分钟内即可完成！**
