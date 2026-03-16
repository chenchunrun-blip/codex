# 🚀 快速启动 - 通义千问版

## 3步开始使用（Qwen）

### 第1步：获取通义千问API密钥

1. 访问阿里云百炼: https://bailian.console.aliyun.com/
2. 登录/注册阿里云账号
3. 进入"API-KEY管理" → 创建新API-KEY
4. 复制密钥（格式：sk-xxxxxxxxxxxxx）

### 第2步：配置系统

```bash
cd /Users/newmba/Downloads/CCWorker/security_triage

# 安装依赖
pip3 install -r requirements.txt

# 创建配置文件
cat > .env << 'EOF'
LLM_API_KEY=sk-your-qwen-api-key-here
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EOF

# 编辑.env，替换API密钥
nano .env
```

### 第3步：测试并运行

```bash
# 测试API连接
python3 test_api.py

# 运行示例告警
python3 main.py --sample
```

## ✅ 成功标志

如果看到以下输出，说明配置成功：

```
================================================================================
✅ API Connection Successful!
================================================================================

📥 Response:
   你好！我是通义千问...
```

## 🎯 模型选择

编辑 `config/config.yaml`:

```yaml
llm:
  model: "qwen-plus"  # 推荐：性价比高
```

可选模型：
- `qwen-turbo` - 最快、最便宜
- `qwen-plus` - **推荐使用**
- `qwen-max` - 最强性能
- `qwen-max-longcontext` - 超长上下文(128K)

## 💰 成本说明

通义千问定价（每千tokens）：
- qwen-turbo: ¥0.008
- qwen-plus: ¥0.04
- qwen-max: ¥0.12

**新用户有免费试用额度！**

## 🔧 快速切换到其他API

### OpenAI
```bash
LLM_API_KEY=sk-your-openai-key
LLM_BASE_URL=
```

### DeepSeek
```bash
LLM_API_KEY=sk-your-deepseek-key
LLM_BASE_URL=https://api.deepseek.com/v1
```

详细配置: **[LLM_API_CONFIG.md](LLM_API_CONFIG.md)**

## ❓ 常见问题

### Q: 提示连接超时？
A: 增加超时时间，编辑 `config/config.yaml`:
```yaml
agents:
  timeout: 600  # 10分钟
```

### Q: API密钥无效？
A: 检查：
1. 密钥格式是否正确（以sk-开头）
2. 账户是否有余额
3. 密钥是否已激活

### Q: 想用其他模型？
A: 查看 **[LLM_API_CONFIG.md](LLM_API_CONFIG.md)** 支持的完整列表

## 📚 更多信息

- **[LLM_API_CONFIG.md](LLM_API_CONFIG.md)** - 详细配置指南
- **[README.md](README.md)** - 完整文档
- **[INSTALL_GUIDE.md](INSTALL_GUIDE.md)** - 安装指南
