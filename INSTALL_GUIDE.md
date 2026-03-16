# 📦 安装和测试指南

## 问题：缩进错误已修复 ✅

之前的缩进错误已经修复。现在需要安装依赖。

## 方法1：使用自动安装脚本（推荐）

```bash
cd /Users/newmba/Downloads/CCWorker/security_triage
./setup.sh
```

这会自动：
1. 检查Python版本
2. 安装所有依赖
3. 创建配置文件
4. 运行测试

## 方法2：手动安装

### 步骤1：安装Python依赖

```bash
cd /Users/newmba/Downloads/CCWorker/security_triage
pip3 install -r requirements.txt
```

**如果遇到版本冲突**，尝试：
```bash
pip3 install --upgrade pip
pip3 install -r requirements.txt --upgrade
```

### 步骤2：创建.env文件

```bash
cp .env.example .env
```

然后编辑.env文件，添加你的OpenAI API密钥：
```bash
nano .env
# 或使用任何文本编辑器
```

### 步骤3：测试系统（无需API密钥）

```bash
python3 test_system.py
```

这会测试基本功能，不需要API密钥。

### 步骤4：运行完整系统（需要API密钥）

```bash
# 使用示例数据测试
python3 main.py --sample

# 或使用交互式模式
python3 main.py --interactive
```

## 🔍 故障排除

### 问题1：pip install失败

**解决方案**：
```bash
# 使用虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 问题2：Python版本太旧

**检查版本**：
```bash
python3 --version
```

**需要Python 3.8+**，如果版本过低，安装新版本：
```bash
# macOS
brew install python@3.11

# 验证安装
python3.11 --version
```

### 问题3：权限错误

**解决方案**：
```bash
# 使用用户安装
pip3 install --user -r requirements.txt
```

### 问题4：ImportError

**解决方案**：
```bash
# 确保在项目根目录
cd /Users/newmba/Downloads/CCWorker/security_triage

# 检查模块是否安装
pip3 list | grep langchain

# 如果没有，重新安装
pip3 install langchain langchain-openai langchain-community
```

## ✅ 验证安装

运行这个命令检查所有依赖：

```bash
python3 -c "
import sys
print('Python version:', sys.version)

try:
    import langchain
    print('✅ LangChain:', langchain.__version__)
except ImportError:
    print('❌ LangChain not installed')

try:
    import openai
    print('✅ OpenAI:', openai.__version__)
except ImportError:
    print('❌ OpenAI not installed')

try:
    import pydantic
    print('✅ Pydantic:', pydantic.__version__)
except ImportError:
    print('❌ Pydantic not installed')
"
```

## 🚀 快速开始（3个命令）

```bash
cd /Users/newmba/Downloads/CCWorker/security_triage

pip3 install -r requirements.txt

python3 test_system.py
```

如果测试通过，你就准备好运行完整系统了！

## 📝 预期输出

成功安装后，`python3 test_system.py` 应该输出：

```
================================================================================
🔒 Security Alert Triage System - Quick Test
================================================================================

Test 1: Importing modules...
✅ All modules imported successfully

Test 2: Creating alert model...
✅ Alert created: TEST-001

Test 3: Testing context collection tools...
✅ Context collected: ['source_ip', 'is_internal_source', 'source_geolocation', ...]

Test 4: Testing threat intelligence tools...
✅ Malware check completed: trojan

Test 5: Testing risk assessment tools...
✅ Risk score calculated: 75.5/100 (high)

================================================================================
✅ All tests passed!
================================================================================
```

## 🆘 需要帮助？

如果遇到问题，请：
1. 检查Python版本 >= 3.8
2. 确保在项目根目录
3. 尝试使用虚拟环境
4. 查看 `logs/triage.log` 获取详细错误信息
