# Project Review Slash Command

## 概述

这是一个私有斜线命令（slash command），用于自动化软件项目的回顾和总结。它会全面分析项目状态、识别问题、提供优化建议。

## 使用方法

### 方式1: 直接对话
直接说以下任一短语即可触发：
```
- "请做一个项目回顾"
- "总结一下今天的工作"
- "review the project"
- "what's the current status"
- "回顾一下完成情况"
- "项目进展如何"
```

### 方式2: 明确调用
```
/projectreview
```

## 功能特性

### 1. 自动信息收集 📊
- 项目结构分析
- Git提交历史
- 服务健康状态
- 构建和测试状态
- 代码质量指标

### 2. 多维度分析 🔍
- ✅ **已完成工作**: 新功能、Bug修复、基础设施改进
- ⚠️ **问题识别**: P0（关键）、P1（重要）、P2（可选）分级
- 💡 **时间优化**: 识别浪费时间的地方，提供改进建议
- 📈 **指标量化**: 测试覆盖率、服务健康度、技术债务评分

### 3. 可操作建议 📋
- **立即行动**: 今天/本周需要完成的任务
- **短期规划**: 未来2周的计划
- **长期优化**: 下个月的改进方向

### 4. 针对性分析 🎯
针对不同项目类型提供专项分析：
- **安全项目**: 漏洞扫描、认证授权、日志审计
- **微服务**: 服务健康、消息队列、数据库连接
- **ML/AI项目**: 模型性能、推理延迟、API限流

## 输出示例

```markdown
# Project Review: Security Triage System
**Date**: 2026-01-10
**Review Period**: Recent session
**Reviewer**: Claude Code

---

## 📊 Executive Summary

Successfully enabled database persistence across all core services (context-collector, threat-intel-aggregator, ai-triage-agent). Fixed critical logging errors and message format issues. End-to-end message pipeline now fully functional.

---

## ✅ Completed Work

### Features Implemented
1. **Database Persistence** - Complete pipeline persistence
   - Status: ✅ Complete
   - Files: 4 services modified
   - Impact: Alerts, context, threat intel all persisting correctly

### Bug Fixes
1. **Logging Configuration Error** - Replaced loguru with standard logging
   - Root cause: loguru incompatibility with extra parameters
   - Solution: Standard Python logging with RotatingFileHandler
   - Files: shared/utils/logger.py + 5 service files
2. **Message Format Issue** - Publisher envelope unwrapping
   - Root cause: Publisher wraps messages in {_meta, data} structure
   - Solution: Added envelope unwrapping in all consumers
3. **Alert ID Preservation** - Foreign key constraint fix
   - Root cause: Processor generating new alert_id
   - Solution: Modified processor to preserve existing alert_id
4. **JSON Serialization** - Database type errors
   - Root cause: Python dicts passed to SQL expecting JSON
   - Solution: Added json.dumps() for all complex fields

---

## ⚠️ Issues Found

### P0 - Critical (Blockers)
*None - All critical issues resolved*

### P1 - Important
1. **AI Triage Agent Config Errors** (FIXED)
   - Location: ai_triage_agent/main.py:557-569
   - Issue: config.get() on Pydantic object
   - Fix: Changed to getattr(config, "attr", default)

### P2 - Nice to Have
1. **Deduplication Cache** - Current cache.clear() could drop valid alerts
2. **LLM Service** - Triage fails without real LLM endpoint (expected)

---

## 💡 Time Saving Opportunities

### Issues Found
| Issue | Time Lost | Better Approach | Time Saved |
|-------|-----------|----------------|------------|
| Debugging message format | 45 min | Read publisher code first | -30 min |
| Multiple rebuilds | 20 min | Parallel builds + cache | -10 min |
| Debug logging issues | 20 min | Early detailed logs | -10 min |

### Recommendations for Future
1. **Read before coding**: Always check existing code patterns before implementing
2. **Parallel builds**: Use `docker-compose build s1 s2 s3` instead of serial
3. **Use layer caching**: Only --no-cache when absolutely necessary
4. **Early debugging**: Add detailed logging immediately when investigating

**Total Potential Time Savings**: ~50 minutes per debugging session

---

## 📋 Next Steps

### Immediate (Today)
1. [x] Remove debug print statements - Code cleanup
2. [x] Fix AI Triage Agent Config errors - Use getattr()
3. [x] Improve error handling - Add re-raise for retries

### This Week
1. [ ] Optimize Docker build caching
2. [ ] Improve deduplication cache (LRU/FIFO)
3. [ ] Add integration tests for message flow

### Backlog
- [ ] Refactor publisher envelope design
- [ ] Add Prometheus metrics
- [ ] Implement DLQ monitoring alerts

---

## 📈 Metrics

- **Test Coverage**: Not measured yet
- **Services Healthy**: 5/5 core services healthy
- **Open Issues**: 0 P0, 0 P1, 2 P2
- **Technical Debt Score**: Low (major issues resolved)

---

## 🎯 Key Insights

1. **Message Envelope Design**: The publisher's {_meta, data} wrapper caused confusion. Consider either documenting it clearly or refactoring to use RabbitMQ's native metadata.
2. **Error Handling Pattern**: Catching exceptions without re-raising disables the consumer's retry mechanism. Always re-raise after logging when using consumer callbacks.
3. **Config Object Access**: Pydantic Config objects use attribute access (config.attr), not dict-style (config.get()). Use getattr() for defaults.

---

**Report Generated**: 2026-01-10 20:20
**Review Depth**: Comprehensive
**Next Review**: After next major feature completion
```

## 自定义配置

如果需要调整回顾的深度或范围，可以在对话中说明：

```
请做快速回顾 - 只看P0问题
请做全面回顾 - 包括所有优先级
请重点关注错误处理
请重点分析性能问题
```

## 最佳实践

1. **定期回顾**: 建议每次完成主要功能后运行
2. **及时修复**: P0问题应立即处理
3. **文档记录**: 将重要决策记录到项目文档
4. **持续改进**: 根据建议优化开发流程

## 技术细节

### Skill文件位置
```
~/.claude/skills/project-review.skill
```

### 重新定义
如需修改回顾内容，直接编辑上述文件。

### 禁用
如需临时禁用，在对话中明确说明"不要使用project-review"。

---

**Created**: 2026-01-10
**Version**: 1.0
**Last Updated**: 2026-01-10
