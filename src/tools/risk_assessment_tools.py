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

"""Risk Assessment Tools"""
from langchain_core.tools import tool
from typing import Dict, Any
from ..utils.logger import log
from ..models.alert import RiskLevel
from ..utils.config import config


@tool
def calculate_risk_score(
    severity: str,
    threat_intel_score: float,
    asset_criticality: str,
    exploitability: str
) -> Dict[str, Any]:
    """
    计算综合风险评分

    Args:
        severity: 告警严重级别 (critical/high/medium/low/info)
        threat_intel_score: 威胁情报评分 (0-10)
        asset_criticality: 资产重要性 (critical/high/medium/low)
        exploitability: 可利用性 (high/medium/low)

    Returns:
        风险评分结果
    """
    log.info(f"Calculating risk score: severity={severity}, threat_score={threat_intel_score}")

    # 权重配置
    weights = config.risk_weights

    # 各组件评分
    severity_score = _severity_to_score(severity)
    threat_multiplier = threat_intel_score / 10.0
    asset_multiplier = _criticality_to_multiplier(asset_criticality)
    exploit_multiplier = _exploitability_to_multiplier(exploitability)

    # 计算加权风险评分
    risk_score = (
        severity_score * weights['severity'] +
        threat_intel_score * 10 * weights['threat_intel'] +
        asset_multiplier * 20 * weights['asset_criticality'] +
        exploit_multiplier * 20 * weights['exploitability']
    )

    # 确保在0-100范围内
    risk_score = min(100, max(0, risk_score))

    # 确定风险级别
    risk_level = _score_to_risk_level(risk_score)

    result = {
        "risk_score": round(risk_score, 2),
        "risk_level": risk_level,
        "components": {
            "severity": severity_score,
            "threat_intel": round(threat_multiplier * 10, 2),
            "asset_criticality": round(asset_multiplier * 10, 2),
            "exploitability": round(exploit_multiplier * 10, 2)
        },
        "weights": weights
    }

    log.info(f"Risk score calculated: {result}")
    return result


@tool
def estimate_business_impact(alert: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    估算业务影响

    Args:
        alert: 告警信息
        context: 上下文信息

    Returns:
        业务影响评估
    """
    log.info("Estimating business impact")

    # Mock implementation - 基于规则的业务影响评估
    severity = alert.get("severity", "low")
    asset_criticality = context.get("asset_context", {}).get("criticality", "low")

    impact_matrix = {
        ("critical", "critical"): {"service_disruption": "high", "data_loss": "high", "compliance": "high"},
        ("critical", "high"): {"service_disruption": "high", "data_loss": "medium", "compliance": "high"},
        ("high", "critical"): {"service_disruption": "high", "data_loss": "medium", "compliance": "medium"},
        ("high", "high"): {"service_disruption": "medium", "data_loss": "medium", "compliance": "medium"},
    }

    impact = impact_matrix.get((severity, asset_criticality), {
        "service_disruption": "low",
        "data_loss": "low",
        "compliance": "low"
    })

    log.info(f"Business impact estimated: {impact}")
    return impact


@tool
def generate_containment_strategies(risk_level: str, alert_type: str) -> Dict[str, Any]:
    """
    生成遏制策略

    Args:
        risk_level: 风险级别
        alert_type: 告警类型

    Returns:
        遏制措施清单
    """
    log.info(f"Generating containment strategies for risk_level={risk_level}, alert_type={alert_type}")

    strategies = {
        "critical": [
            {
                "action": "立即隔离受影响主机",
                "priority": "immediate",
                "automated": True,
                "description": "断开网络连接，防止横向移动"
            },
            {
                "action": "阻断恶意IP地址",
                "priority": "immediate",
                "automated": True,
                "description": "在防火墙添加阻断规则"
            },
            {
                "action": "禁用受损账户",
                "priority": "immediate",
                "automated": True,
                "description": "临时禁用可疑用户账户"
            },
            {
                "action": "启动应急响应流程",
                "priority": "high",
                "automated": False,
                "description": "通知应急响应团队"
            }
        ],
        "high": [
            {
                "action": "监控相关网络活动",
                "priority": "high",
                "automated": True,
                "description": "增强日志收集和监控"
            },
            {
                "action": "加强访问控制",
                "priority": "high",
                "automated": True,
                "description": "临时提升认证要求"
            },
            {
                "action": "通知安全团队",
                "priority": "medium",
                "automated": False,
                "description": "创建安全工单"
            }
        ],
        "medium": [
            {
                "action": "记录告警信息",
                "priority": "medium",
                "automated": True,
                "description": "添加到安全事件日志"
            },
            {
                "action": "持续监控",
                "priority": "low",
                "automated": True,
                "description": "设置监控告警"
            }
        ],
        "low": [
            {
                "action": "记录告警",
                "priority": "low",
                "automated": True,
                "description": "添加到日志"
            }
        ]
    }

    result = strategies.get(risk_level, strategies["low"])
    log.info(f"Containment strategies generated: {len(result)} strategies")
    return {"strategies": result}


# Helper functions

def _severity_to_score(severity: str) -> float:
    """Convert severity level to numeric score"""
    severity_map = {
        "critical": 10.0,
        "high": 7.0,
        "medium": 4.0,
        "low": 2.0,
        "info": 0.0
    }
    return severity_map.get(severity.lower(), 0.0)


def _criticality_to_multiplier(criticality: str) -> float:
    """Convert asset criticality to multiplier"""
    criticality_map = {
        "critical": 1.5,
        "high": 1.2,
        "medium": 1.0,
        "low": 0.8
    }
    return criticality_map.get(criticality.lower(), 1.0)


def _exploitability_to_multiplier(exploitability: str) -> float:
    """Convert exploitability to multiplier"""
    exploitability_map = {
        "high": 1.5,
        "medium": 1.0,
        "low": 0.5
    }
    return exploitability_map.get(exploitability.lower(), 1.0)


def _score_to_risk_level(score: float) -> str:
    """Convert numeric score to risk level"""
    thresholds = config.risk_thresholds

    if score >= thresholds["critical"]:
        return RiskLevel.CRITICAL.value
    elif score >= thresholds["high"]:
        return RiskLevel.HIGH.value
    elif score >= thresholds["medium"]:
        return RiskLevel.MEDIUM.value
    elif score >= thresholds["low"]:
        return RiskLevel.LOW.value
    else:
        return RiskLevel.INFO.value
