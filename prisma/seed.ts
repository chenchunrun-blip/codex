import "dotenv/config"
import { PrismaClient, TemplateCategory } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pkg from 'pg'
const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })

const templates = [
  {
    name: 'Problem Definition',
    category: TemplateCategory.PROBLEM_DEFINITION,
    content: `# 问题定义文档

## 📋 文档信息
- **项目名称**: [填写项目名称]
- **创建日期**: {YYYY-MM-DD}
- **负责人**: [@负责人姓名]
- **文档版本**: v1.0

---

## 1. 背景说明

### 1.1 业务背景
<!-- 描述当前业务环境和上下文 -->
**示例**:
- 当前业务流程：[描述现状]
- 触发条件：[什么情况下会碰到这个问题]
- 影响用户群体：[具体用户群体]

### 1.2 问题起源
<!-- 这个问题是如何被发现的？ -->
- 发现渠道：[用户反馈/数据分析/内部review]
- 首次发现时间：[日期]
- 问题频次：[偶发/经常/持续发生]

---

## 2. 问题陈述

### 2.1 核心问题
<!-- 用一句话清晰定义问题 -->
**模板**: [系统/产品]在[场景]下，导致[用户影响]，表现为[具体现象]。

**示例**:
用户在移动端弱网环境下上传图片时，成功率仅60%，导致用户需要多次重试，严重影响用户体验。

### 2.2 问题描述
<!-- 详细描述问题的表现和症状 -->
- **现状**: [当前的具体表现]
- **期望**: [期望的理想状态]
- **差距**: [现状与期望之间的差距]

---

## 3. 影响分析

### 3.1 用户影响
- 受影响用户数：[具体数字或比例]
- 用户投诉率：[数据]
- 用户流失风险：[高/中/低]

### 3.2 业务影响
- **收入影响**: [预计损失金额]
- **运营成本**: [增加的工作量或成本]
- **品牌声誉**: [潜在影响]

### 3.3 技术影响
- 系统稳定性：[是否影响系统稳定性]
- 资源占用：[CPU/内存/存储等]
- 扩展性：[是否影响未来扩展]

---

## 4. 问题边界

### 4.1 包含范围
<!-- 明确哪些在问题范围内 -->
- ✅ [明确包含的内容1]
- ✅ [明确包含的内容2]

### 4.2 不包含范围
<!-- 明确哪些不在本次解决范围内 -->
- ❌ [暂不处理的内容1]
- ❌ [暂不处理的内容2]

**理由**: [说明为什么不包含这些内容]

---

## 5. 约束条件

### 5.1 技术约束
- 技术栈限制：[例如：必须使用现有框架]
- 兼容性要求：[例如：需要支持IE11]
- 性能要求：[例如：响应时间<500ms]

### 5.2 资源约束
- **人力**: [可用开发人数和时间]
- **预算**: [可用预算范围]
- **时间**: [期望完成时间]

### 5.3 业务约束
- 合规要求：[例如：GDPR、数据安全]
- 业务规则：[必须遵守的业务规则]
- 依赖关系：[依赖的其他系统或团队]

---

## 6. 成功标准

### 6.1 定量指标
| 指标名称 | 当前值 | 目标值 | 衡量方式 |
|---------|--------|--------|----------|
| [指标1] | [XX] | [YY] | [如何统计] |
| [指标2] | [XX] | [YY] | [如何统计] |

**示例**:
| 指标名称 | 当前值 | 目标值 | 衡量方式 |
|---------|--------|--------|----------|
| 上传成功率 | 60% | ≥95% | 埋点统计 |
| 平均上传时长 | 30秒 | ≤10秒 | 埋点统计 |
| 用户投诉率 | 15% | ≤2% | 客服工单 |

### 6.2 定性标准
- ✅ [可验收的用户体验标准1]
- ✅ [可验收的用户体验标准2]

### 6.3 验收方式
- 测试场景：[具体的测试步骤]
- 验收人员：[谁是验收决策者]
- 验收时间：[什么时候进行验收]

---

## 7. 附录

### 7.1 相关文档
- [相关需求文档链接]
- [数据分析报告链接]
- [用户反馈链接]

### 7.2 参考资料
- [技术方案文档]
- [行业最佳实践]

### 7.3 变更记录
| 版本 | 日期 | 修改人 | 修改内容 |
|------|------|--------|----------|
| v1.0 | YYYY-MM-DD | [姓名] | 初始版本 |

---

**文档结束**
`,
    isBuiltIn: true,
    aiPrompt: '基于{projectName}项目，生成详细的问题定义文档。文档应包含：1)业务背景和问题起源，2)清晰的问题陈述，3)用户、业务和技术影响分析，4)明确的问题边界，5)技术、资源和业务约束，6)可量化的成功指标表格。使用专业markdown格式，包含表格、列表和emoji图标。',
  },
  {
    name: 'Solution Design',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# 方案设计文档

## 📋 文档信息
- **项目名称**: [填写项目名称]
- **方案版本**: v1.0
- **创建日期**: {YYYY-MM-DD}
- **设计负责人**: [@负责人姓名]
- **评审状态**: 待评审/已评审/已批准

---

## 1. 核心方案

### 1.1 方案概述
<!-- 用一段话概括解决方案的核心思路 -->
**模板**: 通过[核心技术/方法]，解决[具体问题]，实现[预期效果]。关键创新点在于[独特优势]。

### 1.2 设计原则
- **简单性**: [如何保持方案简单]
- **可扩展性**: [如何支持未来扩展]
- **兼容性**: [如何保证兼容性]
- **性能**: [性能优化策略]

---

## 2. 整体架构

### 2.1 系统架构图
\`\`\`
[在此处绘制架构图或使用文字描述]

示例：
┌─────────────┐
│  用户界面   │
└──────┬──────┘
       │
┌──────▼──────────┐
│   应用层API     │
└──────┬──────────┘
       │
┌──────▼──────────┐
│   业务逻辑层    │
└──────┬──────────┘
       │
┌──────▼──────────┐
│   数据存储层    │
└─────────────────┘
\`\`\`

### 2.2 核心模块

#### 模块1: [模块名称]
- **功能**: [模块的核心功能]
- **输入**: [模块接收什么数据]
- **输出**: [模块输出什么结果]
- **技术选型**: [使用的技术栈]

#### 模块2: [模块名称]
- **功能**: [模块的核心功能]
- **输入**: [模块接收什么数据]
- **输出**: [模块输出什么结果]
- **技术选型**: [使用的技术栈]

### 2.3 数据流设计
\`\`\`
[描述数据在各模块间的流动]

示例：
用户请求 → API网关 → 业务逻辑处理 → 数据库查询 → 结果返回
\`\`\`

---

## 3. 详细设计

### 3.1 接口设计

#### API接口1: [接口名称]
- **请求方式**: POST/GET/PUT/DELETE
- **请求路径**: /api/[资源]
- **请求参数**:
  | 参数名 | 类型 | 必填 | 说明 |
  |--------|------|------|------|
  | param1 | string | 是 | [说明] |
  | param2 | number | 否 | [说明] |
- **响应格式**:
  \`\`\`json
{
  "code": 200,
  "message": "success",
  "data": {
    "field1": "value1",
    "field2": "value2"
  }
}
  \`\`\`

### 3.2 数据模型设计

#### 数据表1: [表名称]
| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| id | string | 是 | 主键 | 唯一标识 |
| field1 | string | 是 | - | [说明] |
| field2 | number | 否 | 索引 | [说明] |

### 3.3 关键算法

#### 算法1: [算法名称]
- **问题**: [解决什么问题]
- **思路**: [核心思路]
- **复杂度**: 时间O(n)，空间O(1)
- **伪代码**:
  \`\`\`
  1. 初始化变量
  2. 遍历数据
  3. 处理逻辑
  4. 返回结果
  \`\`\`

---

## 4. 实施计划

### 4.1 开发阶段

#### 阶段1: 基础架构搭建
- **负责人**: [@负责人姓名]
- **开始时间**: YYYY-MM-DD
- **结束时间**: YYYY-MM-DD
- **交付物**:
  - ✅ [交付物1]
  - ✅ [交付物2]
- **详细任务**:
  1. [任务1] - 预计X天
  2. [任务2] - 预计X天
  3. [任务3] - 预计X天

#### 阶段2: 核心功能开发
- **负责人**: [@负责人姓名]
- **开始时间**: YYYY-MM-DD
- **结束时间**: YYYY-MM-DD
- **交付物**:
  - ✅ [交付物1]
  - ✅ [交付物2]
- **详细任务**:
  1. [任务1] - 预计X天
  2. [任务2] - 预计X天

#### 阶段3: 联调测试
- **负责人**: [@负责人姓名]
- **开始时间**: YYYY-MM-DD
- **结束时间**: YYYY-MM-DD
- **交付物**:
  - ✅ 测试报告
  - ✅ Bug修复记录

### 4.2 里程碑时间表
| 里程碑 | 目标日期 | 负责人 | 状态 |
|---------|----------|--------|------|
| M1: 架构评审完成 | YYYY-MM-DD | [@姓名] | 未开始 |
| M2: 核心功能完成 | YYYY-MM-DD | [@姓名] | 未开始 |
| M3: 测试通过 | YYYY-MM-DD | [@姓名] | 未开始 |
| M4: 上线发布 | YYYY-MM-DD | [@姓名] | 未开始 |

---

## 5. 质量保证

### 5.1 测试策略
- **单元测试**: [覆盖率要求，例如≥80%]
- **集成测试**: [关键流程测试]
- **性能测试**: [性能指标]
- **安全测试**: [安全检查项]

### 5.2 验收标准
- ✅ [功能验收标准1]
- ✅ [功能验收标准2]
- ✅ [性能验收标准]
- ✅ [安全验收标准]
- ✅ [用户体验标准]

---

## 6. 风险管理

### 6.1 技术风险
| 风险 | 可能性 | 影响度 | 应对措施 | 负责人 |
|------|--------|--------|----------|--------|
| [风险1] | 高/中/低 | 高/中/低 | [具体应对方案] | [@姓名] |
| [风险2] | 高/中/低 | 高/中/低 | [具体应对方案] | [@姓名] |

### 6.2 业务风险
- [风险1]: [描述和应对]
- [风险2]: [描述和应对]

### 6.3 资源风险
- [人力资源风险]: [应对措施]
- [时间风险]: [应对措施]
- [预算风险]: [应对措施]

---

## 7. 监控与运维

### 7.1 监控指标
- **性能指标**: [响应时间、吞吐量等]
- **业务指标**: [成功率、错误率等]
- **系统指标**: [CPU、内存、磁盘等]

### 7.2 告警策略
- [告警规则1]: [触发条件] → [通知方式]
- [告警规则2]: [触发条件] → [通知方式]

### 7.3 应急预案
- [故障场景1]: [应急处理步骤]
- [故障场景2]: [应急处理步骤]

---

## 8. 附录

### 8.1 技术选型对比
| 方案 | 优势 | 劣势 | 选择理由 |
|------|------|------|----------|
| [方案A] | [优势] | [劣势] | [为何选择/不选] |
| [方案B] | [优势] | [劣势] | [为何选择/不选] |

### 8.2 参考文档
- [相关技术文档链接]
- [行业标准或最佳实践]

### 8.3 变更记录
| 版本 | 日期 | 修改人 | 修改内容 | 评审人 |
|------|------|--------|----------|--------|
| v1.0 | YYYY-MM-DD | [姓名] | 初始版本 | [评审人] |

---

**文档结束**
`,
    isBuiltIn: true,
    aiPrompt: '基于{projectName}项目，生成详细的方案设计文档。文档应包含：1)核心方案概述和设计原则，2)系统架构图和核心模块设计，3)详细的API接口和数据模型设计表格，4)分阶段的实施计划表格，5)质量保证策略和验收标准，6)风险管理表格和应对措施，7)监控运维方案。使用专业markdown格式，包含代码块、表格和清晰的章节结构。',
  },
  {
    name: 'Execution Tracking',
    category: TemplateCategory.EXECUTION_TRACKING,
    content: `# 执行跟踪日报

## 📋 基本信息
- **项目名称**: [填写项目名称]
- **日期**: {YYYY-MM-DD}
- **记录人**: [@你的姓名]
- **汇报周期**: 日报/周报

---

## 1. 今日完成 ✅

### 1.1 主要成果
<!-- 列出今天完成的主要工作和成果 -->
- ✅ **[任务1]** - [完成内容描述]
  - 产出：[具体交付物]
  - 耗时：[X小时]
  - 进度：100%

- ✅ **[任务2]** - [完成内容描述]
  - 产出：[具体交付物]
  - 耗时：[X小时]
  - 进度：100%

### 1.2 关键数据
<!-- 更新项目关键指标 -->
| 指标名称 | 目标值 | 当前进度 | 完成率 |
|---------|--------|----------|--------|
| [指标1] | [XX] | [YY] | [ZZ%] |
| [指标2] | [XX] | [YY] | [ZZ%] |
| [指标3] | [XX] | [YY] | [ZZ%] |

---

## 2. 待办事项 📝

### 2.1 高优先级 (P0)
<!-- 紧急且重要 -->
- [ ] **[任务1]** - 截止: [日期] - 负责人: [@姓名]
  - 描述：[任务详细说明]
  - 预计工时：[X小时]

- [ ] **[任务2]** - 截止: [日期] - 负责人: [@姓名]
  - 描述：[任务详细说明]
  - 预计工时：[X小时]

### 2.2 中优先级 (P1)
<!-- 重要但不紧急 -->
- [ ] **[任务1]** - 截止: [日期] - 负责人: [@姓名]
  - 描述：[任务详细说明]
  - 预计工时：[X小时]

### 2.3 低优先级 (P2)
<!-- 不太重要 -->
- [ ] **[任务1]** - 截止: [日期] - 负责人: [@姓名]
  - 描述：[任务详细说明]

---

## 3. 阻塞问题 🚧

### 3.1 当前阻塞
<!-- 遇到的阻碍项目进展的问题 -->
| 问题 | 影响程度 | 需要支持 | 状态 | 预计解决时间 |
|------|----------|----------|------|--------------|
| [问题描述] | 高/中/低 | [@支持人] | 处理中/待处理 | [日期] |

### 3.2 问题描述
**问题1**: [具体问题描述]
- **影响**: [对项目的影响]
- **已尝试的方案**: [已经尝试过的解决方法]
- **需要的帮助**: [具体需要什么支持]
- **跟进人**: [@负责人姓名]

---

## 4. 明日计划 📅

### 4.1 重点任务
1. **[任务1]** - 负责人: [@姓名]
   - 目标：[预期完成什么]
   - 预计工时：[X小时]

2. **[任务2]** - 负责人: [@姓名]
   - 目标：[预期完成什么]
   - 预计工时：[X小时]

### 4.2 协作事项
- 需要与[@某人/某团队]协调：[具体事项]
- 需要评审：[待评审内容]

---

## 5. 风险提示 ⚠️

<!-- 可能影响项目的风险 -->
- **风险1**: [风险描述] - 可能性: 高/中/低 - 应对: [应对措施]
- **风险2**: [风险描述] - 可能性: 高/中/低 - 应对: [应对措施]

---

## 6. 数据同步 📊

### 6.1 进度对比
<!-- 与计划进度的对比 -->
| 里程碑 | 计划日期 | 当前状态 | 进度偏差 | 原因分析 |
|--------|----------|----------|----------|----------|
| M1 | YYYY-MM-DD | ✅已完成/进行中/延期 | [提前/延期X天] | [原因] |
| M2 | YYYY-MM-DD | ⏳未开始/进行中 | [-] | [-] |

### 6.2 资源消耗
- **人力投入**: [实际投入] 人日 vs 计划 [X] 人日
- **预算使用**: [已使用] / [总预算] ([X%])
- **时间进度**: [已完成] / [总工期] ([X%])

---

## 7. 重要备注 📌

### 7.1 决策记录
<!-- 重要的项目决策 -->
- **[决策1]**: [决策内容] - 决策人: [@姓名] - 日期: YYYY-MM-DD
  - 理由：[为什么这样决策]
  - 影响：[对项目的影响]

### 7.2 经验总结
<!-- 今日值得记录的经验 -->
- **好的经验**:
  - [经验1]: [具体描述]
  - [经验2]: [具体描述]

- **需要改进**:
  - [改进点1]: [具体描述和改进建议]

### 7.3 其他信息
- [需要记录的其他重要信息]

---

## 8. 工时统计

### 8.1 今日工时分布
| 任务类别 | 工时 | 占比 |
|---------|------|------|
| [类别1] | X小时 | XX% |
| [类别2] | X小时 | XX% |
| [类别3] | X小时 | XX% |
| **总计** | **X小时** | **100%** |

### 8.2 累计工时
- **本周累计**: [X] 人日
- **项目累计**: [X] 人日
- **剩余预算**: [X] 人日

---

**日报结束**

---
*备注：本日报由MarqDex系统生成，支持实时协作和历史追溯*
`,
    isBuiltIn: true,
    aiPrompt: '基于{projectName}项目，生成执行跟踪日报模板。文档应包含：1)今日完成任务列表，2)优先级分明的待办事项表格，3)阻塞问题列表和跟进状态，4)明日计划和协作事项，5)风险提示，6)进度对比和数据统计表格，7)工时统计。使用专业markdown格式，包含复选框、表格和emoji图标。',
  },
  {
    name: 'Retrospective Summary',
    category: TemplateCategory.RETROSPECTIVE_SUMMARY,
    content: `# 项目复盘总结

## 📋 项目信息
- **项目名称**: [填写项目名称]
- **项目周期**: [开始日期] ~ [结束日期]
- **项目负责人**: [@负责人姓名]
- **复盘日期**: {YYYY-MM-DD}
- **参与人员**: [@成员1], [@成员2], [@成员3]

---

## 1. 项目概述

### 1.1 项目目标
<!-- 项目最初设定的目标 -->
**主要目标**:
- [目标1]: [具体描述]
- [目标2]: [具体描述]
- [目标3]: [具体描述]

### 1.2 项目范围
- **包含内容**: [项目覆盖的范围]
- **不包含内容**: [明确排除的内容]
- **调整说明**: [范围变更历史]

---

## 2. 结果对比分析

### 2.1 目标达成情况
| 核心指标 | 目标值 | 实际值 | 达成率 | 评价 |
|---------|--------|--------|--------|------|
| [指标1] | [目标] | [实际] | [XX%] | 🟢达成/🟡部分达成/🔴未达成 |
| [指标2] | [目标] | [实际] | [XX%] | 🟢达成/🟡部分达成/🔴未达成 |
| [指标3] | [目标] | [实际] | [XX%] | 🟢达成/🟡部分达成/🔴未达成 |
| [指标4] | [目标] | [实际] | [XX%] | 🟢达成/🟡部分达成/🔴未达成 |

### 2.2 时间进度
| 里程碑 | 计划时间 | 实际时间 | 偏差 | 原因分析 |
|--------|----------|----------|------|----------|
| M1: [里程碑1] | YYYY-MM-DD | YYYY-MM-DD | ±X天 | [延期/提前原因] |
| M2: [里程碑2] | YYYY-MM-DD | YYYY-MM-DD | ±X天 | [延期/提前原因] |
| M3: [里程碑3] | YYYY-MM-DD | YYYY-MM-DD | ±X天 | [延期/提前原因] |

### 2.3 资源消耗
| 资源类型 | 计划 | 实际 | 偏差率 | 说明 |
|---------|------|------|--------|------|
| 人力(人日) | [X] | [Y] | [±XX%] | [原因] |
| 预算(万元) | [X] | [Y] | [±XX%] | [原因] |
| 其他资源 | [X] | [Y] | [±XX%] | [原因] |

---

## 3. 成功经验 ✨

### 3.1 做得好的方面
<!-- 值得肯定和复用的经验 -->

#### 经验1: [经验标题]
- **具体做法**: [详细描述是如何做的]
- **为什么成功**: [分析成功原因]
- **可复用性**: [如何应用到其他项目]
- **相关数据**: [支持数据或证据]

**示例**:
- **具体做法**: 采用每日站会制度，及时发现和解决问题
- **为什么成功**: 提高了团队沟通效率，问题解决时间缩短50%
- **可复用性**: 可推广到所有敏捷开发项目
- **相关数据**: 平均问题解决时间从2天降至1天

#### 经验2: [经验标题]
- **具体做法**: [详细描述]
- **为什么成功**: [分析原因]
- **可复用性**: [应用建议]
- **相关数据**: [数据支撑]

### 3.2 亮点成果
<!-- 项目中的突出成果 -->
- 🏆 **[亮点1]**: [描述和意义]
- 🏆 **[亮点2]**: [描述和意义]
- 🏆 **[亮点3]**: [描述和意义]

---

## 4. 问题和教训 ⚠️

### 4.1 主要问题
<!-- 项目中遇到的主要问题 -->

#### 问题1: [问题标题]
- **问题描述**: [详细描述问题现象]
- **影响程度**: 高/中/低
- **发生阶段**: [在项目哪个阶段发生]
- **根本原因**: [深入分析根本原因]
- **如何解决**: [最终解决方案]
- **经验教训**: [从中学到什么]
- **预防措施**: [未来如何避免]

**示例**:
- **问题描述**: 需求变更频繁，导致开发返工
- **影响程度**: 高
- **发生阶段**: 开发中期
- **根本原因**: 需求评审不充分，缺乏用户调研
- **如何解决**: 增加原型评审环节，用户确认后再开发
- **经验教训**: 需求阶段必须投入足够时间
- **预防措施**: 建立标准需求评审流程，用户签字确认

#### 问题2: [问题标题]
- **问题描述**: [详细描述]
- **影响程度**: [高/中/低]
- **发生阶段**: [阶段]
- **根本原因**: [分析]
- **如何解决**: [方案]
- **经验教训**: [教训]
- **预防措施**: [预防]

### 4.2 应该改进的地方
- **改进点1**: [具体描述和改进建议]
- **改进点2**: [具体描述和改进建议]
- **改进点3**: [具体描述和改进建议]

---

## 5. 遗留问题 🔍

### 5.1 未解决问题
<!-- 项目结束后仍未解决的问题 -->
| 问题 | 优先级 | 负责人 | 计划解决时间 | 备注 |
|------|--------|--------|--------------|------|
| [问题1] | 高/中/低 | [@姓名] | YYYY-MM-DD | [说明] |
| [问题2] | 高/中/低 | [@姓名] | YYYY-MM-DD | [说明] |

### 5.2 需要后续跟进的事项
- **跟进事项1**: [描述和责任人]
- **跟进事项2**: [描述和责任人]
- **跟进事项3**: [描述和责任人]

---

## 6. 资产沉淀 📦

### 6.1 可复用资产
<!-- 项目产出的有价值的资产 -->

#### 技术资产
- **[资产1]**: [描述] - [价值] - [复用场景]
- **[资产2]**: [描述] - [价值] - [复用场景]

#### 文档资产
- **[文档1]**: [链接] - [描述和用途]
- **[文档2]**: [链接] - [描述和用途]

#### 工具和方法
- **[工具1]**: [名称] - [用途] - [获取方式]
- **[方法1]**: [名称] - [适用场景] - [使用指南]

### 6.2 知识沉淀
<!-- 项目中积累的知识和经验 -->

#### 技术知识
- [知识点1]: [具体说明]
- [知识点2]: [具体说明]

#### 业务知识
- [知识点1]: [具体说明]
- [知识点2]: [具体说明]

---

## 7. 团队表现 👥

### 7.1 团队协作
- **协作亮点**: [团队协作中做得好的地方]
- **沟通效率**: [沟通是否顺畅，有无改进空间]
- **分工合理性**: [任务分配是否合理]

### 7.2 个人成长
| 成员 | 成长点 | 待提升 | 建议 |
|------|--------|--------|------|
| [@成员1] | [进步的地方] | [需要提升] | [具体建议] |
| [@成员2] | [进步的地方] | [需要提升] | [具体建议] |

---

## 8. 下一步计划 🎯

### 8.1 短期计划（1-3个月）
- **计划1**: [具体行动] - 负责人: [@姓名] - 时间: [日期]
- **计划2**: [具体行动] - 负责人: [@姓名] - 时间: [日期]

### 8.2 中期规划（3-6个月）
- **规划1**: [具体内容] - 预期成果: [描述]
- **规划2**: [具体内容] - 预期成果: [描述]

### 8.3 长期展望（6个月以上）
- **愿景1**: [长期目标] - 实现路径: [如何达成]
- **愿景2**: [长期目标] - 实现路径: [如何达成]

---

## 9. 总结评价

### 9.1 项目评价
- **整体评分**: 🌟🌟🌟🌟🌟 (1-5星)
- **成功度**: [非常成功/成功/基本成功/部分成功/未成功]
- **一句话总结**: [用一句话总结这个项目]

### 9.2 给未来项目的建议
- **建议1**: [具体建议]
- **建议2**: [具体建议]
- **建议3**: [具体建议]

### 9.3 感谢与致意
感谢以下人员和团队的支持：
- [@人员/团队]: [感谢原因]
- [@人员/团队]: [感谢原因]
- [@人员/团队]: [感谢原因]

---

## 10. 附录

### 10.1 相关文档
- [项目需求文档]
- [技术设计文档]
- [测试报告]

### 10.2 数据统计图表
<!-- 可以插入关键数据的图表 -->

### 10.3 会议记录
- [关键会议纪要链接]

---

**复盘结束**

---
*本复盘文档由MarqDex系统生成，记录于{YYYY-MM-DD}*
*文档版本: v1.0 | 最后更新: {YYYY-MM-DD}*
`,
    isBuiltIn: true,
    aiPrompt: '基于{projectName}项目，生成详细的复盘总结文档。文档应包含：1)项目目标和概述，2)详细的目标达成对比表格（包含指标、时间、资源），3)成功经验分析（具体做法、原因、复用性），4)问题和教训（根本原因分析、预防措施），5)遗留问题和跟进事项表格，6)资产沉淀清单，7)团队表现评价，8)短期和长期行动计划。使用专业markdown格式，包含表格、emoji和清晰的章节结构。',
  },
  {
    name: 'Project Charter (PM)',
    description: 'Project management charter for scope, timeline, budget, governance, and risks.',
    category: TemplateCategory.PROBLEM_DEFINITION,
    content: `# Project Charter

## 1. Project Overview
- Project Name:
- Sponsor:
- Project Manager:
- Start Date:
- Target End Date:

## 2. Problem / Opportunity
- Current situation:
- Why now:
- Expected business impact:

## 3. Objectives and Success Metrics
| Objective | KPI | Baseline | Target | Due Date |
|---|---|---|---|---|
|  |  |  |  |  |

## 4. Scope
### In Scope
- 
### Out of Scope
- 

## 5. Deliverables
- 

## 6. Timeline and Milestones
| Milestone | Owner | Planned Date | Exit Criteria |
|---|---|---|---|
|  |  |  |  |

## 7. Budget and Resources
- Budget:
- Team capacity:
- External dependencies:

## 8. Governance and Communication
- Steering cadence:
- Weekly sync:
- Reporting format:

## 9. Risks and Assumptions
| Risk/Assumption | Impact | Probability | Mitigation | Owner |
|---|---|---|---|---|
|  |  |  |  |  |

## 10. Sign-off
- Sponsor:
- Product:
- Engineering:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a concise project charter for {projectName}, including scope, milestones, budget, risks, and clear success KPIs.'
  },
  {
    name: 'Technical Design Document (IT R&D)',
    description: 'Engineering design template covering architecture, APIs, data model, rollout, and observability.',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# Technical Design Document

## 1. Context
- Related problem statement:
- Stakeholders:
- Constraints:

## 2. Goals / Non-goals
### Goals
- 
### Non-goals
- 

## 3. Proposed Architecture
- High-level design:
- Components and responsibilities:
- Data flow:

## 4. API and Contract Changes
| Interface | Change Type | Backward Compatible | Notes |
|---|---|---|---|
|  |  |  |  |

## 5. Data Model
- New entities:
- Schema changes:
- Migration strategy:

## 6. Performance and Scalability
- SLO / SLA targets:
- Throughput expectations:
- Capacity plan:

## 7. Security and Compliance
- AuthN/AuthZ:
- Data classification:
- Audit logging:

## 8. Rollout Plan
- Environments:
- Feature flags:
- Rollback plan:

## 9. Testing Strategy
- Unit:
- Integration:
- E2E:
- Load / resilience:

## 10. Observability
- Metrics:
- Logs:
- Alerts:

## 11. Open Questions
- 
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a practical engineering design doc for {projectName} with architecture, contracts, migration, rollout, testing, and observability.'
  },
  {
    name: 'API Specification (Backend)',
    description: 'API-first backend template for endpoint contracts, error codes, and idempotency/retry policies.',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# API Specification

## 1. API Overview
- Service name:
- Owner:
- Version:
- Base URL:

## 2. Endpoints
### Endpoint: [METHOD] /path
- Purpose:
- Auth required:
- Idempotency:

#### Request
\`\`\`json
{}
\`\`\`

#### Response
\`\`\`json
{}
\`\`\`

#### Errors
| HTTP | Code | Meaning | Retryable |
|---|---|---|---|
|  |  |  |  |

## 3. Pagination / Filtering / Sorting
- 

## 4. Rate Limit and Quotas
- 

## 5. Backward Compatibility
- Deprecation policy:
- Versioning policy:

## 6. Monitoring
- Key latency metrics:
- Error budget:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate an API specification for {projectName} with request/response examples, error model, idempotency, and compatibility policy.'
  },
  {
    name: 'Sprint Plan & Execution Board',
    description: 'Sprint planning and delivery tracking for software teams.',
    category: TemplateCategory.EXECUTION_TRACKING,
    content: `# Sprint Plan & Execution Board

## 1. Sprint Metadata
- Sprint:
- Date range:
- Team:
- Sprint goal:

## 2. Capacity
| Member | Capacity (days) | Planned Allocation |
|---|---|---|
|  |  |  |

## 3. Backlog for Sprint
| Work Item | Type | Owner | Estimate | Priority | Status |
|---|---|---|---|---|---|
|  |  |  |  |  | Todo |

## 4. Daily Tracking
| Date | Planned | Done | Blockers | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

## 5. Risks and Dependencies
| Item | Impact | Mitigation | Owner |
|---|---|---|---|
|  |  |  |  |

## 6. End-of-Sprint Summary
- Completed:
- Carry-over:
- Lessons:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a sprint plan for {projectName} with capacity, prioritized backlog, daily tracking, and risk/dependency control.'
  },
  {
    name: 'Release Readiness Checklist',
    description: 'Pre-release and go-live checklist for IT delivery.',
    category: TemplateCategory.EXECUTION_TRACKING,
    content: `# Release Readiness Checklist

## 1. Release Info
- Release name:
- Planned date/time:
- Release owner:
- Change window:

## 2. Quality Gates
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass
- [ ] Security checks pass
- [ ] Performance checks pass

## 3. Operational Readiness
- [ ] Monitoring dashboard updated
- [ ] Alerts configured
- [ ] Runbook updated
- [ ] On-call informed

## 4. Deployment Plan
| Step | Owner | ETA | Validation |
|---|---|---|---|
|  |  |  |  |

## 5. Rollback Plan
- Trigger criteria:
- Rollback steps:
- Communication plan:

## 6. Sign-off
- Engineering:
- QA:
- Product:
- Operations:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a release readiness checklist for {projectName} with quality gates, deployment steps, rollback criteria, and sign-off.'
  },
  {
    name: 'Incident Postmortem (IT Ops)',
    description: 'Structured incident analysis template for outages and production issues.',
    category: TemplateCategory.RETROSPECTIVE_SUMMARY,
    content: `# Incident Postmortem

## 1. Incident Summary
- Incident ID:
- Severity:
- Start time:
- End time:
- Impacted services:

## 2. Customer / Business Impact
- User impact:
- Business impact:
- Duration:

## 3. Timeline
| Time | Event | Owner |
|---|---|---|
|  |  |  |

## 4. Root Cause Analysis
- Direct cause:
- Contributing factors:
- Why this was not prevented:

## 5. Detection and Response Review
- Detection method:
- Response effectiveness:
- Communication effectiveness:

## 6. Corrective Actions
| Action | Type (Immediate/Preventive) | Owner | Due Date | Status |
|---|---|---|---|---|
|  |  |  |  |  |

## 7. Follow-up
- Process changes:
- Tooling changes:
- Training needs:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a blameless incident postmortem for {projectName} with timeline, root causes, and actionable corrective actions.'
  },
  {
    name: 'Product Requirement Document (PRD)',
    description: 'Product requirement template for software delivery teams, aligned with goal, scope, and acceptance criteria.',
    category: TemplateCategory.PROBLEM_DEFINITION,
    content: `# Product Requirement Document

## 1. Background
- Business context:
- Current pain points:
- Why now:

## 2. Problem Statement
- Target users:
- Core problem:
- Impact of not solving:

## 3. Goals and Success Metrics
| Goal | Metric | Baseline | Target | Owner |
|---|---|---|---|---|
|  |  |  |  |  |

## 4. Scope
### In Scope
- 
### Out of Scope
- 

## 5. User Stories
| Persona | User Story | Priority | Notes |
|---|---|---|---|
|  |  | P0/P1/P2 |  |

## 6. Functional Requirements
| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR- |  |  |  |

## 7. Non-functional Requirements
- Performance:
- Security:
- Reliability:
- Compliance:

## 8. Dependencies and Risks
| Item | Type (Dependency/Risk) | Impact | Mitigation | Owner |
|---|---|---|---|---|
|  |  |  |  |  |

## 9. Milestones
| Milestone | Date | Exit Criteria |
|---|---|---|
|  |  |  |
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a complete PRD for {projectName}, including scope, measurable goals, user stories, requirements, and acceptance criteria.'
  },
  {
    name: 'QA Test Plan (IT Delivery)',
    description: 'Quality assurance template covering test scope, strategy, environments, and release criteria.',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# QA Test Plan

## 1. Test Objective
- Release / version:
- Test owner:
- Objective:

## 2. Scope
### In Scope
- 
### Out of Scope
- 

## 3. Test Strategy
- Functional testing:
- Integration testing:
- Regression testing:
- Non-functional testing:

## 4. Test Environments
| Environment | URL | Data Setup | Owner |
|---|---|---|---|
|  |  |  |  |

## 5. Test Matrix
| Module | Scenario | Priority | Type | Status |
|---|---|---|---|---|
|  |  | P0/P1/P2 | Manual/Auto | Planned |

## 6. Entry and Exit Criteria
### Entry
- [ ] Build available
- [ ] Test data ready
- [ ] Critical dependencies ready

### Exit
- [ ] P0/P1 cases passed
- [ ] No blocker defects
- [ ] Release sign-off completed

## 7. Defect Management
| Severity | SLA | Escalation |
|---|---|---|
|  |  |  |

## 8. Risks and Mitigations
| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
|  |  |  |  |
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a practical QA test plan for {projectName} with test strategy, matrix, environments, and release exit criteria.'
  },
  {
    name: 'Architecture Decision Record (ADR)',
    description: 'Decision log template to capture architecture choices, alternatives, and consequences.',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# Architecture Decision Record

## 1. Decision Summary
- ADR ID:
- Date:
- Status: Proposed / Accepted / Superseded
- Decision owner:

## 2. Context
- Problem to solve:
- Constraints:
- Relevant assumptions:

## 3. Decision
- Chosen option:
- Why this option:

## 4. Alternatives Considered
| Alternative | Pros | Cons | Why Not Chosen |
|---|---|---|---|
|  |  |  |  |

## 5. Consequences
### Positive
- 
### Negative / Trade-offs
- 

## 6. Impacted Components
- Services:
- Data model:
- Interfaces:

## 7. Follow-up Actions
| Action | Owner | Due Date | Status |
|---|---|---|---|
|  |  |  |  |
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate an architecture decision record for {projectName} with context, alternatives, rationale, and implementation follow-ups.'
  },
  {
    name: 'Change Request (Scope / Timeline / Cost)',
    description: 'Formal change request template for project scope, timeline, or budget adjustments.',
    category: TemplateCategory.EXECUTION_TRACKING,
    content: `# Change Request

## 1. Request Metadata
- CR ID:
- Requester:
- Date:
- Related project/release:

## 2. Requested Change
- Change type: Scope / Timeline / Cost / Technical
- Current baseline:
- Proposed change:

## 3. Business Justification
- Reason:
- Expected benefit:
- Urgency:

## 4. Impact Assessment
| Dimension | Impact | Details |
|---|---|---|
| Scope | Low/Medium/High |  |
| Timeline | Low/Medium/High |  |
| Cost | Low/Medium/High |  |
| Quality/Risk | Low/Medium/High |  |

## 5. Implementation Plan
| Step | Owner | ETA | Dependencies |
|---|---|---|---|
|  |  |  |  |

## 6. Approval Workflow
| Role | Approver | Decision | Date |
|---|---|---|---|
| Product |  | Pending |  |
| Engineering |  | Pending |  |
| Delivery |  | Pending |  |

## 7. Final Decision
- Approved / Rejected:
- Conditions:
- Next actions:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a structured change request for {projectName} including impact analysis, approval workflow, and implementation plan.'
  },
  {
    name: 'Risk Register & Mitigation Plan',
    description: 'Ongoing project risk register with probability/impact scoring and mitigation ownership.',
    category: TemplateCategory.EXECUTION_TRACKING,
    content: `# Risk Register & Mitigation Plan

## 1. Risk Governance
- Risk owner:
- Review cadence:
- Escalation path:

## 2. Risk Scoring Model
- Probability: Low / Medium / High
- Impact: Low / Medium / High
- Priority score = Probability x Impact

## 3. Active Risks
| Risk ID | Description | Probability | Impact | Priority | Trigger | Mitigation | Owner | Due Date | Status |
|---|---|---|---|---|---|---|---|---|---|
| R-001 |  |  |  |  |  |  |  |  | Open |

## 4. Dependency Risks
| Dependency | Risk | Impact | Mitigation | Owner |
|---|---|---|---|---|
|  |  |  |  |  |

## 5. Closed Risks (Audit)
| Risk ID | Closure Date | Resolution | Lessons Learned |
|---|---|---|---|
|  |  |  |  |
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a practical risk register for {projectName} with ranked risks, triggers, and actionable mitigation owners.'
  },
  {
    name: 'Stakeholder Communication Plan',
    description: 'Communication matrix for project stakeholders, decision forums, and reporting cadence.',
    category: TemplateCategory.EXECUTION_TRACKING,
    content: `# Stakeholder Communication Plan

## 1. Communication Objectives
- Transparency goals:
- Decision turnaround target:
- Escalation SLA:

## 2. Stakeholder Matrix
| Stakeholder Group | Primary Contact | Influence | Information Needs | Preferred Channel |
|---|---|---|---|---|
|  |  |  |  |  |

## 3. Cadence and Rituals
| Meeting / Report | Frequency | Audience | Owner | Output |
|---|---|---|---|---|
| Steering Committee | Weekly | Sponsor, Leads | PM | Decision log |

## 4. Decision Log Protocol
- Decision template:
- Required approvers:
- SLA for pending decisions:

## 5. Escalation Rules
| Scenario | Trigger | Escalation Path | Response Time |
|---|---|---|---|
|  |  |  |  |

## 6. Communication Risks
| Risk | Impact | Mitigation |
|---|---|---|
|  |  |  |
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a stakeholder communication plan for {projectName} with audience matrix, cadence, escalation, and decision governance.'
  },
  {
    name: 'Service Operations Runbook',
    description: 'Production operations runbook with alerts, diagnostics, and standard recovery procedures.',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# Service Operations Runbook

## 1. Service Basics
- Service name:
- Owner team:
- Repository:
- On-call rotation:

## 2. SLO / Alert Overview
| Signal | SLO Target | Alert Threshold | Dashboard |
|---|---|---|---|
| Availability | 99.9% | <99.5% (5m) |  |

## 3. Common Alerts and Triage
| Alert | Likely Cause | First Check | Runbook Link |
|---|---|---|---|
| 5xx spike |  |  |  |

## 4. Recovery Procedures
### Procedure A: Partial degradation
1. Verify impact scope
2. Mitigate traffic (rate-limit/feature flag)
3. Validate recovery metrics

### Procedure B: Full outage
1. Incident channel and severity set
2. Rollback or failover
3. Confirm service restoration

## 5. Dependencies and Fallbacks
| Dependency | Failure Mode | Fallback Strategy |
|---|---|---|
|  |  |  |

## 6. Post-Incident Follow-up
- Required data to collect:
- ADR / Postmortem links:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate an operations runbook for {projectName} with alert triage, recovery procedures, dependency fallbacks, and incident follow-up steps.'
  },
  {
    name: 'Data Migration Plan',
    description: 'Structured data migration plan covering mapping, backfill, validation, cutover, and rollback.',
    category: TemplateCategory.SOLUTION_DESIGN,
    content: `# Data Migration Plan

## 1. Migration Context
- Source system:
- Target system:
- Migration owner:
- Cutover window:

## 2. Scope and Data Domains
| Domain | Records | Criticality | Owner |
|---|---|---|---|
|  |  |  |  |

## 3. Mapping and Transformation Rules
| Source Field | Target Field | Transformation | Validation Rule |
|---|---|---|---|
|  |  |  |  |

## 4. Migration Strategy
- Full vs incremental:
- Batch strategy:
- Idempotency strategy:

## 5. Validation Plan
| Check | Method | Threshold | Owner |
|---|---|---|---|
| Record count parity | SQL compare | 100% |  |

## 6. Cutover Plan
| Step | Owner | Start | End | Rollback Trigger |
|---|---|---|---|---|
|  |  |  |  |  |

## 7. Rollback Plan
- Preconditions:
- Rollback steps:
- Data reconciliation after rollback:
`,
    isBuiltIn: true,
    isPublic: true,
    aiPrompt: 'Generate a data migration plan for {projectName} with mapping rules, validation criteria, cutover steps, and rollback controls.'
  },
]

async function main() {
  console.log('开始导入/更新内置模板...\n')

  for (const template of templates) {
    const existing = await prisma.template.findFirst({
      where: {
        isBuiltIn: true,
        name: template.name
      }
    })

    if (existing) {
      // Update existing built-in template by name
      await prisma.template.update({
        where: { id: existing.id },
        data: {
          name: template.name,
          description: template.description ?? null,
          category: template.category,
          content: template.content,
          aiPrompt: template.aiPrompt,
          isBuiltIn: true,
          isPublic: true
        }
      })
      console.log(`✅ 更新模板: ${template.name}`)
    } else {
      // Create new template
      await prisma.template.create({
        data: template
      })
      console.log(`✅ 创建模板: ${template.name}`)
    }
  }

  console.log('\n✅ 模板导入完成！')
}

main()
  .catch((e) => {
    console.error('❌ 模板导入失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
