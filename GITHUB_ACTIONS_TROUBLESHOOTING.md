# GitHub Actions Docker Build Error - Troubleshooting

## 错误信息

```
ERROR: failed to calculate checksum of ref: "/shared": not found
Service: reporting_service
```

## 问题分析

### 本地代码状态 ✅

所有Dockerfile已正确修复（commit 1870e3b）:
```dockerfile
COPY requirements.txt /app/
COPY ../shared /app/services/shared
COPY . /app/services/reporting_service
```

### 可能的原因

1. **GitHub Actions使用了旧的commit**
   - Workflow可能在commit 1870e3b之前触发
   - 需要确认GitHub Actions运行的是哪个commit

2. **Docker BuildKit缓存问题**
   - GitHub Actions缓存了旧的Docker层
   - 需要清除缓存或禁用缓存

3. **网络同步延迟**
   - GitHub可能还没有同步到最新的commit

---

## 解决方案

### 方案1: 检查GitHub Actions状态

访问GitHub Actions页面，查看：
- Workflow运行使用的commit SHA
- 是否是 `f57bf47` 或 `1870e3b`

**URL**: https://github.com/chenchunrun/security/actions

如果不是最新的commit，需要：
- 等待当前workflow完成
- 新的workflow会自动触发（使用最新commit）

### 方案2: 清除Docker缓存

修改CI配置，暂时禁用缓存：

```yaml
# .github/workflows/ci-cd.yml (line 147-148)
cache-from: type=gha
cache-to: type=gha,mode=max
```

改为：
```yaml
# 暂时禁用缓存以强制重新构建
cache-from:
cache-to:
```

提交这个修改会触发新的workflow运行，不使用缓存。

### 方案3: 手动触发新的Workflow

在GitHub上手动触发workflow：
1. 访问 https://github.com/chenchunrun/security/actions
2. 点击 "Run workflow"
3. 选择 `main` 分支
4. 点击 "Run workflow" 按钮

这会使用最新的commit重新运行。

### 方案4: 检查远程分支

运行以下命令确认远程分支状态：

```bash
# 检查远程分支的commit
git log origin/main --oneline -5

# 应该看到：
# f57bf47 fix: Use relative paths in web_dashboard Dockerfile for build context
# 1870e3b fix: Use relative COPY paths in Dockerfiles matching build context
```

---

## 验证修复

等待新的workflow运行完成后，检查：

1. **Build and push** 步骤应该成功 ✅
2. 所有12个服务的镜像应该构建成功 ✅
3. 镜像应该推送到 `ghcr.io/chenchunrun/security/` ✅

---

## 临时禁用缓存的完整配置

如果需要立即修复，创建一个临时commit：

```bash
# 编辑 .github/workflows/ci-cd.yml
# 将第147-148行改为：
#         cache-from:
#         cache-to:

git add .github/workflows/ci-cd.yml
git commit -m "ci: Temporarily disable Docker cache to force rebuild"
git push origin main
```

这会触发一个新的workflow，不使用任何缓存，确保使用最新的代码。

---

## Commit历史

修复应该包含的commits（按时间顺序）：

1. `c3af46f` - 修复notification_service和similarity_search
2. `7dff93c` - 标准化所有Python服务Dockerfile（但路径仍有问题）
3. `1870e3b` - **关键修复**：所有Python服务使用相对路径 ✅
4. `f57bf47` - 修复web_dashboard服务 ✅

如果GitHub Actions运行的commit早于 `1870e3b`，就会出现这个错误。

---

## 推荐操作

**最简单的方法**：等待当前GitHub Actions workflow完成，然后检查结果。

如果仍然失败，使用**方案2**（禁用缓存）来强制重新构建。

---

**创建时间**: 2026-01-08
**相关Commit**: 1870e3b, f57bf47
**相关服务**: reporting_service
