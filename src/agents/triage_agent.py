# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Security Alert Triage Agent"""
import asyncio
from typing import Dict, Any
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain.agents import AgentExecutor, create_openai_functions_agent
from ..models.alert import SecurityAlert, TriageResult, RiskAssessment, RemediationAction
from ..tools.context_tools import collect_network_context, collect_asset_context, collect_user_context
from ..tools.threat_intel_tools import query_threat_intel, check_vulnerabilities, check_malware_hash
from ..tools.risk_assessment_tools import (
    calculate_risk_score,
    estimate_business_impact,
    generate_containment_strategies
)
from ..utils.config import config
from ..utils.logger import log


class SecurityAlertTriageAgent:
    """安全告警研判Agent"""

    def __init__(self):
        """Initialize the triage agent"""
        log.info("Initializing Security Alert Triage Agent")

        # Initialize LLM (支持OpenAI兼容API)
        self.llm = ChatOpenAI(
            model=config.llm_model,
            temperature=config.llm_temperature,
            api_key=config.llm_api_key,
            base_url=config.llm_base_url,  # 支持自定义API端点
            timeout=config.get("agents.timeout", 300)  # 添加超时配置
        )

        # Initialize tools
        self.context_tools = [collect_network_context, collect_asset_context, collect_user_context]
        self.threat_intel_tools = [query_threat_intel, check_vulnerabilities, check_malware_hash]
        self.risk_tools = [calculate_risk_score, estimate_business_impact, generate_containment_strategies]

    async def process_alert(self, alert: SecurityAlert) -> TriageResult:
        """
        处理安全告警

        Args:
            alert: 安全告警对象

        Returns:
            研判结果
        """
        log.info(f"Processing alert: {alert.alert_id}")
        start_time = datetime.now()

        try:
            # Step 1: 收集上下文信息
            log.info("Step 1: Collecting context information")
            context = await self._collect_context(alert)

            # Step 2: 查询威胁情报
            log.info("Step 2: Querying threat intelligence")
            threat_intel = await self._query_threat_intelligence(alert)

            # Step 3: 风险评估
            log.info("Step 3: Performing risk assessment")
            risk_assessment = await self._assess_risk(alert, context, threat_intel)

            # Step 4: 生成处置建议
            log.info("Step 4: Generating remediation recommendations")
            remediation = await self._generate_remediation(risk_assessment, alert)

            # 计算处理时间
            processing_time = (datetime.now() - start_time).total_seconds()

            # 判断是否需要人工审核
            requires_human_review = self._requires_human_review(risk_assessment)

            # 构建结果
            result = TriageResult(
                alert=alert,
                risk_assessment=risk_assessment,
                threat_intelligence=threat_intel,
                context=context,
                historical_analysis=[],  # 简化版本暂不包含历史分析
                remediation=remediation,
                requires_human_review=requires_human_review,
                processing_time_seconds=processing_time,
                analysis_timestamp=datetime.now()
            )

            log.info(f"Alert processing completed: {alert.alert_id} in {processing_time:.2f}s")
            return result

        except Exception as e:
            log.error(f"Error processing alert {alert.alert_id}: {str(e)}")
            raise

    async def _collect_context(self, alert: SecurityAlert) -> Dict[str, Any]:
        """收集上下文信息"""
        log.info("Collecting context information")

        context = {
            "network_context": {},
            "asset_context": {},
            "user_context": {}
        }

        # 收集网络上下文
        network_context = collect_network_context.invoke({
            "source_ip": alert.source_ip,
            "target_ip": alert.target_ip
        })
        context["network_context"] = network_context

        # 收集资产上下文
        asset_context = collect_asset_context.invoke({
            "asset_id": alert.asset_id,
            "ip": alert.target_ip or alert.source_ip
        })
        context["asset_context"] = asset_context

        # 收集用户上下文（如果有）
        if alert.user_id:
            user_context = collect_user_context.invoke({
                "user_id": alert.user_id
            })
            context["user_context"] = user_context

        return context

    async def _query_threat_intelligence(self, alert: SecurityAlert) -> list:
        """查询威胁情报"""
        log.info("Querying threat intelligence")

        intel_results = []

        # 查询源IP
        if alert.source_ip:
            intel = query_threat_intel.invoke({
                "ioc": alert.source_ip,
                "ioc_type": "ip"
            })
            intel_results.append(intel)

        # 查询文件哈希（如果有）
        if alert.file_hash:
            malware_check = check_malware_hash.invoke({
                "file_hash": alert.file_hash
            })
            intel_results.append(malware_check)

        return intel_results

    async def _assess_risk(
        self,
        alert: SecurityAlert,
        context: Dict[str, Any],
        threat_intel: list
    ) -> RiskAssessment:
        """执行风险评估"""
        log.info("Performing risk assessment")

        # 计算威胁情报评分
        threat_score = 0.0
        for intel in threat_intel:
            if intel.get("malicious") or intel.get("is_malicious"):
                threat_score = max(threat_score, 7.0)
            elif intel.get("threat_level") in ["high", "critical"]:
                threat_score = max(threat_score, 5.0)

        # 获取资产重要性
        asset_criticality = context.get("asset_context", {}).get("criticality", "medium")

        # 调用风险评分计算工具
        risk_result = calculate_risk_score.invoke({
            "severity": alert.severity.value,
            "threat_intel_score": threat_score,
            "asset_criticality": asset_criticality,
            "exploitability": "medium"  # 默认值
        })

        # 构建风险评估对象
        assessment = RiskAssessment(
            risk_score=risk_result["risk_score"],
            risk_level=risk_result["risk_level"],
            confidence=0.75,  # 简化版本使用固定置信度
            key_factors=[
                f"告警严重级别: {alert.severity.value}",
                f"资产重要性: {asset_criticality}",
                f"威胁情报评分: {threat_score:.1f}/10"
            ],
            components=risk_result["components"]
        )

        log.info(f"Risk assessment completed: score={assessment.risk_score}, level={assessment.risk_level}")
        return assessment

    async def _generate_remediation(
        self,
        risk_assessment: RiskAssessment,
        alert: SecurityAlert
    ) -> list:
        """生成处置建议"""
        log.info("Generating remediation recommendations")

        # 调用遏制策略生成工具
        strategies_result = generate_containment_strategies.invoke({
            "risk_level": risk_assessment.risk_level,
            "alert_type": alert.alert_type.value
        })

        # 转换为RemediationAction对象列表
        remediation_actions = []
        for strategy in strategies_result.get("strategies", []):
            action = RemediationAction(
                action=strategy["action"],
                priority=strategy["priority"],
                automated=strategy["automated"],
                owner="Security Team" if not strategy["automated"] else None
            )
            remediation_actions.append(action)

        log.info(f"Generated {len(remediation_actions)} remediation actions")
        return remediation_actions

    def _requires_human_review(self, risk_assessment: RiskAssessment) -> bool:
        """判断是否需要人工审核"""
        # 高风险或低置信度需要人工审核
        return (
            risk_assessment.risk_score >= 70 or
            risk_assessment.confidence < 0.7 or
            risk_assessment.risk_level in ["critical", "high"]
        )


# 便捷函数
async def triage_alert(alert_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    研判安全告警的便捷函数

    Args:
        alert_data: 告警数据字典

    Returns:
        研判结果字典
    """
    # 转换为SecurityAlert对象
    alert = SecurityAlert(**alert_data)

    # 创建Agent并处理
    agent = SecurityAlertTriageAgent()
    result = await agent.process_alert(alert)

    # 返回字典格式
    return result.model_dump()
