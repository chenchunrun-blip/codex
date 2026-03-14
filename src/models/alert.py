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

"""Security Alert Data Models"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class SeverityLevel(str, Enum):
    """告警严重级别"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class RiskLevel(str, Enum):
    """风险级别"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AlertType(str, Enum):
    """告警类型"""
    MALWARE = "malware"
    PHISHING = "phishing"
    BRUTE_FORCE = "brute_force"
    DDOS = "ddos"
    DATA_EXFILTRATION = "data_exfiltration"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    ANOMALY = "anomaly"
    OTHER = "other"


class SecurityAlert(BaseModel):
    """安全告警模型"""
    alert_id: str = Field(description="告警唯一标识")
    timestamp: datetime = Field(description="告警时间戳")
    alert_type: AlertType = Field(description="告警类型")
    source_ip: str = Field(description="源IP地址")
    target_ip: Optional[str] = Field(default=None, description="目标IP地址")
    severity: SeverityLevel = Field(description="告警严重级别")
    description: str = Field(description="告警描述")
    raw_data: Dict[str, Any] = Field(default_factory=dict, description="原始告警数据")

    # 可选字段
    user_id: Optional[str] = Field(default=None, description="关联用户ID")
    asset_id: Optional[str] = Field(default=None, description="关联资产ID")
    file_hash: Optional[str] = Field(default=None, description="文件哈希")
    domain: Optional[str] = Field(default=None, description="域名")
    url: Optional[str] = Field(default=None, description="URL")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class ThreatIntelligence(BaseModel):
    """威胁情报模型"""
    ioc: str = Field(description="威胁指标")
    ioc_type: str = Field(description="IOC类型")
    threat_level: RiskLevel = Field(description="威胁级别")
    confidence: float = Field(description="置信度", ge=0, le=1)
    malicious: bool = Field(description="是否恶意")
    sources: List[str] = Field(default_factory=list, description="情报来源")
    related_campaigns: List[str] = Field(default_factory=list, description="相关攻击活动")
    first_seen: Optional[datetime] = Field(default=None, description="首次发现时间")
    last_seen: Optional[datetime] = Field(default=None, description="最后发现时间")
    tags: List[str] = Field(default_factory=list, description="标签")


class ContextInfo(BaseModel):
    """上下文信息模型"""
    network_context: Dict[str, Any] = Field(default_factory=dict, description="网络上下文")
    asset_context: Dict[str, Any] = Field(default_factory=dict, description="资产上下文")
    user_context: Dict[str, Any] = Field(default_factory=dict, description="用户上下文")


class HistoricalAlert(BaseModel):
    """历史告警模型"""
    alert_id: str
    timestamp: datetime
    similarity_score: float = Field(description="相似度分数", ge=0, le=1)
    resolution: str = Field(description="处理结果")
    false_positive: bool = Field(default=False, description="是否误报")
    notes: Optional[str] = Field(default=None, description="备注")


class RiskAssessment(BaseModel):
    """风险评估模型"""
    risk_score: float = Field(description="风险评分", ge=0, le=100)
    risk_level: RiskLevel = Field(description="风险级别")
    confidence: float = Field(description="评估置信度", ge=0, le=1)
    key_factors: List[str] = Field(default_factory=list, description="关键风险因素")
    components: Dict[str, float] = Field(default_factory=dict, description="评分组件")


class RemediationAction(BaseModel):
    """处置措施模型"""
    action: str = Field(description="措施描述")
    priority: str = Field(description="优先级: immediate/high/medium/low")
    automated: bool = Field(description="是否可自动执行")
    owner: Optional[str] = Field(default=None, description="负责人")


class TriageResult(BaseModel):
    """告警研判结果模型"""
    alert: SecurityAlert
    risk_assessment: RiskAssessment
    threat_intelligence: List[ThreatIntelligence]
    context: ContextInfo
    historical_analysis: List[HistoricalAlert]
    remediation: List[RemediationAction]
    requires_human_review: bool = Field(description="是否需要人工审核")
    processing_time_seconds: float = Field(description="处理耗时")
    analysis_timestamp: datetime = Field(default_factory=datetime.now)

    # 元数据
    agent_version: str = "1.0.0"
    model_used: str = "gpt-4"
