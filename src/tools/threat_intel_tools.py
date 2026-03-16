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

"""Threat Intelligence Tools"""
from langchain_core.tools import tool
from typing import Dict, Any, List
from ..utils.logger import log
from ..models.alert import ThreatIntelligence, RiskLevel


@tool
def query_threat_intel(ioc: str, ioc_type: str) -> Dict[str, Any]:
    """
    查询威胁情报数据库

    Args:
        ioc: 威胁指标（IP, domain, hash, URL等）
        ioc_type: IOC类型（ip, domain, hash, url）

    Returns:
        威胁情报信息
    """
    log.info(f"Querying threat intelligence for {ioc_type}: {ioc}")

    # Mock implementation - 在生产环境中集成真实的威胁情报源
    # 如 VirusTotal, Abuse.ch, MISP等

    intel = {
        "ioc": ioc,
        "ioc_type": ioc_type,
        "threat_level": _determine_threat_level(ioc),
        "confidence": 0.7,
        "malicious": _is_malicious(ioc),
        "sources": ["internal_database"],
        "related_campaigns": [],
        "tags": _get_ioc_tags(ioc),
        "first_seen": None,
        "last_seen": None
    }

    log.info(f"Threat intelligence result: {intel}")
    return intel


@tool
def check_vulnerabilities(cve_id: str) -> Dict[str, Any]:
    """
    查询CVE漏洞详细信息

    Args:
        cve_id: CVE编号

    Returns:
        漏洞详情
    """
    log.info(f"Checking vulnerability: {cve_id}")

    # Mock CVE database
    cve_db = {
        "CVE-2023-1234": {
            "cvss_score": 8.5,
            "severity": "high",
            "description": "Remote code execution vulnerability",
            "exploit_available": True,
            "patch_available": True
        },
        "CVE-2023-5678": {
            "cvss_score": 5.3,
            "severity": "medium",
            "description": "Information disclosure vulnerability",
            "exploit_available": False,
            "patch_available": True
        }
    }

    vuln_data = cve_db.get(cve_id, {
        "cvss_score": 0.0,
        "severity": "unknown",
        "description": "Unknown vulnerability",
        "exploit_available": False,
        "patch_available": False
    })

    log.info(f"Vulnerability data: {vuln_data}")
    return vuln_data


@tool
def check_malware_hash(file_hash: str) -> Dict[str, Any]:
    """
    检查文件哈希是否为已知恶意软件

    Args:
        file_hash: 文件哈希值（MD5, SHA1, SHA256）

    Returns:
        恶意软件分析结果
    """
    log.info(f"Checking malware hash: {file_hash}")

    # Mock implementation - 在生产环境中查询VirusTotal等
    # 已知的恶意哈希示例（用于测试）
    known_malicious = {
        "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8": {
            "name": "Trojan.Generic",
            "detection_rate": 45,
            "first_seen": "2024-12-01",
            "classification": "trojan"
        }
    }

    result = known_malicious.get(file_hash, {
        "name": "Unknown",
        "detection_rate": 0,
        "first_seen": None,
        "classification": "clean"
    })

    analysis = {
        "hash": file_hash,
        "is_malicious": file_hash in known_malicious,
        "detection_rate": result["detection_rate"],
        "classification": result["classification"],
        "malware_name": result["name"],
        "first_seen": result.get("first_seen")
    }

    log.info(f"Malware analysis result: {analysis}")
    return analysis


@tool
def analyze_attack_pattern(alerts: List[Dict]) -> Dict[str, Any]:
    """
    分析告警序列的攻击模式

    Args:
        alerts: 告警序列

    Returns:
        识别的攻击模式和MITRE ATT&CK技术
    """
    log.info(f"Analyzing attack pattern for {len(alerts)} alerts")

    # Mock implementation - 简化的模式识别
    # 在生产环境中使用更复杂的MITRE ATT&CK映射

    pattern = {
        "attack_stage": "initial_access",
        "mitre_techniques": ["T1190", "T1078"],  # Exploit Public-Facing Application
        "confidence": 0.6,
        "identified_patterns": ["brute_force", "exploit_attempt"],
        "recommendations": ["block_ip", "enhance_monitoring"]
    }

    log.info(f"Attack pattern analysis: {pattern}")
    return pattern


# Helper functions

def _determine_threat_level(ioc: str) -> str:
    """Determine threat level based on IOC"""
    # Mock logic - 在生产环境中基于真实威胁情报
    if ioc.startswith("192.168.") or ioc.startswith("10."):
        return RiskLevel.LOW.value

    suspicious_iocs = ["45.33.32.156", "103.224.212.222"]
    if ioc in suspicious_iocs:
        return RiskLevel.HIGH.value

    return RiskLevel.MEDIUM.value


def _is_malicious(ioc: str) -> bool:
    """Check if IOC is known malicious"""
    malicious_iocs = ["45.33.32.156", "103.224.212.222"]
    return ioc in malicious_iocs


def _get_ioc_tags(ioc: str) -> List[str]:
    """Get tags for IOC"""
    tags = []
    if _is_internal_ip(ioc):
        tags.append("internal")
    else:
        tags.append("external")

    if _is_malicious(ioc):
        tags.append("known_malicious")

    return tags


def _is_internal_ip(ip: str) -> bool:
    """Check if IP is internal"""
    import ipaddress
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False
