# 🔧 LLM API 配置指南 - 支持OpenAI兼容API

## 📋 概述

本系统现已支持**任何OpenAI兼容的API**，包括：
- ✅ 阿里云通义千问 (Qwen)
- ✅ OpenAI官方 (GPT-4, GPT-3.5)
- ✅ DeepSeek
- ✅ 智谱AI (GLM)
- ✅ 月之暗面 (Kimi)
- ✅ 其他OpenAI兼容API

## 🚀 快速配置

### 方法1：通义千问 Qwen（推荐国内用户）

#### 步骤1：获取API密钥

1. 访问阿里云百炼平台: https://bailian.console.aliyun.com/
2. 登录/注册阿里云账号
3. 进入"API-KEY管理"
4. 创建新的API-KEY
5. 复制API密钥（格式：`sk-xxxxxxxxxxxxx`）

#### 步骤2：配置环境变量

```bash
# 创建.env文件
cat > .env << 'EOF'
# 通义千问配置
LLM_API_KEY=sk-your-qwen-api-key-here
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EOF
```

#### 步骤3：更新配置文件（可选）

编辑 `config/config.yaml`:

```yaml
llm:
  model: "qwen-plus"  # 或 qwen-turbo, qwen-max, qwen-max-longcontext
  temperature: 0.0
  max_tokens: 2000
```

#### 步骤4：测试连接

```bash
python3 test_system.py
```

### 方法2：OpenAI官方

```bash
# .env文件
LLM_API_KEY=sk-your-openai-api-key-here
LLM_BASE_URL=
```

配置文件：
```yaml
llm:
  model: "gpt-4"
  temperature: 0.0
```

### 方法3：其他OpenAI兼容API

#### DeepSeek

```bash
# .env文件
LLM_API_KEY=sk-your-deepseek-key
LLM_BASE_URL=https://api.deepseek.com/v1
```

配置：
```yaml
llm:
  model: "deepseek-chat"
```

#### 智谱AI (GLM)

```bash
# .env文件
LLM_API_KEY=your-glm-api-key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
```

配置：
```yaml
llm:
  model: "glm-4"
```

#### 月之暗面 (Kimi)

```bash
# .env文件
LLM_API_KEY=your-kimi-api-key
LLM_BASE_URL=https://api.moonshot.cn/v1
```

配置：
```yaml
llm:
  model: "moonshot-v1-8k"
```

## 📊 支持的模型列表

### 通义千问系列

| 模型名称 | 特点 | 适用场景 |
|---------|------|---------|
| `qwen-turbo` | 速度快、成本低 | 简单任务、快速响应 |
| `qwen-plus` | 性价比高 | **推荐使用** |
| `qwen-max` | 性能最强 | 复杂分析、深度推理 |
| `qwen-max-longcontext` | 长上下文 | 大文本分析 |

### OpenAI系列

| 模型名称 | 特点 |
|---------|------|
| `gpt-4` | 最强性能 |
| `gpt-4-turbo` | 速度快、成本低 |
| `gpt-3.5-turbo` | 经济实惠 |

## ⚙️ 高级配置

### 自定义超时时间

如果使用国内API，可能需要更长的超时时间：

编辑 `config/config.yaml`:

```yaml
agents:
  timeout: 600  # 增加到10分钟
```

### 自定义模型参数

```yaml
llm:
  model: "qwen-plus"
  temperature: 0.0    # 0.0-2.0，越低越确定性
  max_tokens: 2000    # 最大输出token数
  # 可选参数（通过环境变量或代码添加）
  # top_p: 0.9
  # frequency_penalty: 0.0
  # presence_penalty: 0.0
```

## 🔑 API密钥获取指南

### 通义千问

1. **官网**: https://bailian.console.aliyun.com/
2. **定价**:
   - qwen-turbo: ¥0.008/千tokens
   - qwen-plus: ¥0.04/千tokens
   - qwen-max: ¥0.12/千tokens
3. **免费额度**: 新用户有免费试用额度

### OpenAI

1. **官网**: https://platform.openai.com/
2. **定价**:
   - GPT-4: $0.03-0.06/千tokens
   - GPT-3.5: $0.001-0.002/千tokens
3. **注意事项**: 需要国外支付方式

### DeepSeek

1. **官网**: https://platform.deepseek.com/
2. **定价**: ¥1/百万tokens（输入）
3. **特点**: 性价比极高

## 🧪 测试配置

### 测试脚本

创建 `test_api.py`:

```python
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

# 测试API连接
llm = ChatOpenAI(
    model=os.getenv("LLM_MODEL", "qwen-plus"),
    api_key=os.getenv("LLM_API_KEY"),
    base_url=os.getenv("LLM_BASE_URL")
)

try:
    response = llm.invoke("你好，请简单介绍一下你自己。")
    print("✅ API连接成功！")
    print(f"响应: {response.content}")
except Exception as e:
    print(f"❌ API连接失败: {e}")
```

运行测试：
```bash
python3 test_api.py
```

## 🔍 故障排除

### 问题1：连接超时

**症状**: `Timeout error` 或 `Read timeout`

**解决方案**:
1. 增加超时时间：
```yaml
agents:
  timeout: 600  # 10分钟
```

2. 检查网络连接：
```bash
curl -I https://dashscope.aliyuncs.com
```

### 问题2：API密钥无效

**症状**: `401 Unauthorized` 或 `Invalid API key`

**解决方案**:
1. 确认API密钥格式正确（以`sk-`开头）
2. 检查API密钥是否已激活
3. 确认账户有余额

### 问题3：模型不存在

**症状**: `Model not found` 或 `Invalid model`

**解决方案**:
1. 检查模型名称拼写
2. 确认该模型在你的API提供商处可用
3. 尝试使用更通用的模型名称

### 问题4：ImportError

**症状**: `No module named 'langchain_openai'`

**解决方案**:
```bash
pip3 install langchain-openai
```

## 📝 配置示例文件

### 完整的.env文件

```bash
# 通义千问配置（推荐国内用户）
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 日志配置
LOG_LEVEL=INFO
```

### 快速切换API

创建多个配置文件：

```bash
# .env.qwen
LLM_API_KEY=sk-qwen-key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# .env.openai
LLM_API_KEY=sk-openai-key
LLM_BASE_URL=

# .env.deepseek
LLM_API_KEY=sk-deepseek-key
LLM_BASE_URL=https://api.deepseek.com/v1
```

切换使用：
```bash
# 使用通义千问
cp .env.qwen .env

# 使用OpenAI
cp .env.openai .env
```

## 🎯 推荐配置

### 国内用户（首选）

```yaml
# config/config.yaml
llm:
  model: "qwen-plus"
  temperature: 0.0
```

```bash
# .env
LLM_API_KEY=sk-your-qwen-key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 国际用户

```yaml
# config/config.yaml
llm:
  model: "gpt-4"
  temperature: 0.0
```

```bash
# .env
LLM_API_KEY=sk-your-openai-key
LLM_BASE_URL=
```

### 预算有限

```yaml
# config/config.yaml
llm:
  model: "qwen-turbo"  # 或 deepseek-chat
  temperature: 0.0
```

## ✅ 验证配置

运行完整测试：

```bash
# 1. 测试API连接
python3 test_api.py

# 2. 测试系统组件
python3 test_system.py

# 3. 运行完整系统
python3 main.py --sample
```

## 📚 相关资源

- [通义千问文档](https://help.aliyun.com/zh/dashscope/)
- [OpenAI文档](https://platform.openai.com/docs)
- [DeepSeek文档](https://platform.deepseek.com/docs)
- [LangChain文档](https://python.langchain.com/)

---

**需要帮助？** 查看 `INSTALL_GUIDE.md` 或检查 `logs/triage.log` 获取详细错误信息。
