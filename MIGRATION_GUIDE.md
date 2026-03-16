# ✅ 已更新：支持OpenAI兼容API

## 📋 更新摘要

系统现已完全支持**任何OpenAI兼容的API**，包括通义千问(Qwen)、DeepSeek等。

## 🔄 主要变更

### 1. 配置文件更新

#### ✅ config/config.yaml
```yaml
# 之前：仅支持OpenAI
openai:
  model: "gpt-4"
  api_key_env: "OPENAI_API_KEY"

# 现在：支持任何OpenAI兼容API
llm:
  model: "qwen-plus"  # 默认使用通义千问
  api_key_env: "LLM_API_KEY"
  base_url_env: "LLM_BASE_URL"  # 新增：支持自定义API端点
```

#### ✅ .env.example
```bash
# 之前
OPENAI_API_KEY=your_key

# 现在
LLM_API_KEY=your-key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  # 通义千问
```

### 2. 代码更新

#### ✅ src/utils/config.py
- 新增 `llm_api_key` 属性
- 新增 `llm_base_url` 属性
- 新增 `llm_model` 属性
- 保留向后兼容的 `openai_*` 属性

#### ✅ src/agents/triage_agent.py
```python
# 之前
self.llm = ChatOpenAI(
    model=config.openai_model,
    api_key=config.openai_api_key
)

# 现在
self.llm = ChatOpenAI(
    model=config.llm_model,
    api_key=config.llm_api_key,
    base_url=config.llm_base_url,  # 新增
    timeout=600  # 新增：支持更长超时
)
```

### 3. 新增文件

#### ✅ LLM_API_CONFIG.md
详细的LLM API配置指南，包括：
- 通义千问完整配置
- OpenAI配置
- DeepSeek、GLM、Kimi等配置
- API密钥获取指南
- 故障排除

#### ✅ test_api.py
API连接测试工具，验证配置是否正确

#### ✅ QUICKSTART_QWEN.md
通义千问快速启动指南

## 🚀 快速迁移

### 从OpenAI迁移到通义千问

```bash
# 1. 安装依赖（如果还没安装）
pip3 install -r requirements.txt

# 2. 获取通义千问API密钥
# 访问：https://bailian.console.aliyun.com/

# 3. 更新.env文件
cat > .env << 'EOF'
LLM_API_KEY=sk-your-qwen-api-key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EOF

# 4. 测试连接
python3 test_api.py

# 5. 运行系统
python3 main.py --sample
```

### 配置对比

| 项目 | OpenAI | 通义千问 Qwen |
|------|--------|---------------|
| API密钥获取 | https://platform.openai.com | https://bailian.console.aliyun.com/ |
| BASE_URL | （留空） | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| 推荐模型 | gpt-4 | qwen-plus |
| 成本（每千tokens） | $0.03-0.06 | ¥0.04 |
| 国内访问 | 需要代理 | 直接访问 |

## ✅ 验证更新

### 测试1：语法检查
```bash
python3 -m py_compile src/agents/triage_agent.py src/utils/config.py
```
✅ 通过

### 测试2：API连接测试
```bash
python3 test_api.py
```

预期输出：
```
✅ API Connection Successful!
```

### 测试3：系统测试
```bash
python3 main.py --sample
```

## 📊 支持的LLM提供商

现在系统支持以下所有OpenAI兼容的API：

### 国内API（推荐）
1. **通义千问 Qwen** ⭐
   - 文档：`LLM_API_CONFIG.md`
   - 快速启动：`QUICKSTART_QWEN.md`

2. **DeepSeek**
   - 成本极低：¥1/百万tokens
   - 配置见：`LLM_API_CONFIG.md`

3. **智谱AI GLM**
4. **月之暗面 Kimi**
5. **百川智能**
6. **其他国产模型**

### 国际API
1. **OpenAI官方**
2. **Azure OpenAI**
3. **任何OpenAI兼容的API**

## 🔧 配置灵活性

### 环境变量方式（推荐）
```bash
# .env
LLM_API_KEY=your-key
LLM_BASE_URL=your-endpoint
```

### 配置文件方式
```yaml
# config/config.yaml
llm:
  model: "your-model"
```

### 代码方式
```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="qwen-plus",
    api_key="your-key",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)
```

## ⚙️ 向后兼容性

✅ **完全向后兼容** - 旧的 `OPENAI_API_KEY` 仍然有效

如果你想继续使用OpenAI，只需：
```bash
# .env
LLM_API_KEY=sk-your-openai-key
LLM_BASE_URL=
```

## 📝 更新文件清单

### 修改的文件（4个）
1. `config/config.yaml` - LLM配置部分
2. `.env.example` - 环境变量示例
3. `src/utils/config.py` - 配置读取逻辑
4. `src/agents/triage_agent.py` - Agent初始化
5. `README.md` - 主文档更新

### 新增的文件（3个）
1. `LLM_API_CONFIG.md` - 详细配置指南
2. `test_api.py` - API测试工具
3. `QUICKSTART_QWEN.md` - Qwen快速启动

## 🎯 下一步

1. **选择LLM提供商**：
   - 国内用户：通义千问（推荐）
   - 国际用户：OpenAI
   - 预算有限：DeepSeek

2. **获取API密钥**：
   - 通义千问：https://bailian.console.aliyun.com/
   - OpenAI：https://platform.openai.com/api-keys

3. **配置系统**：
   ```bash
   cp .env.example .env
   nano .env  # 添加API密钥和BASE_URL
   ```

4. **测试运行**：
   ```bash
   python3 test_api.py
   python3 main.py --sample
   ```

## 📚 相关文档

- **[LLM_API_CONFIG.md](LLM_API_CONFIG.md)** - 完整配置指南
- **[QUICKSTART_QWEN.md](QUICKSTART_QWEN.md)** - 通义千问快速开始
- **[README.md](README.md)** - 完整项目文档
- **[INSTALL_GUIDE.md](INSTALL_GUIDE.md)** - 安装指南

---

**更新时间**: 2025-01-04
**状态**: ✅ 完成并测试通过
