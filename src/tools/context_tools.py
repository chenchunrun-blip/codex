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

"""Context Collection Tools"""
from langchain_core.tools import tool
from typing import Dict, Any
import ipaddress
from ..utils.logger import log


@tool
def collect_network_context(source_ip: str, target_ip: str = None) -> Dict[str, Any]:
    """
    收集网络上下文信息

    Args:
        source_ip: 源IP地址
        target_ip: 目标IP地址（可选）

    Returns:
        网络上下文信息字典
    """
    log.info(f"Collecting network context for source: {source_ip}, target: {target_ip}")

    context = {
        "source_ip": source_ip,
        "is_internal_source": _is_internal_ip(source_ip),
        "source_geolocation": _mock_geolocation(source_ip),
    }

    if target_ip:
        context.update({
            "target_ip": target_ip,
            "is_internal_target": _is_internal_ip(target_ip),
            "target_geolocation": _mock_geolocation(target_ip),
            "is_cross_border": _is_cross_border(source_ip, target_ip)
        })

    log.info(f"Network context collected: {context}")
    return context


@tool
def collect_asset_context(asset_id: str = None, ip: str = None) -> Dict[str, Any]:
    """
    收集资产上下文信息

    Args:
        asset_id: 资产ID（可选）
        ip: IP地址（可选）

    Returns:
        资产上下文信息字典
    """
    log.info(f"Collecting asset context for asset_id: {asset_id}, ip: {ip}")

    # Mock implementation - 在生产环境中查询CMDB
    context = {
        "asset_id": asset_id or f"ASSET-{ip}",
        "asset_type": "workstation" if _is_internal_ip(ip or "0.0.0.0") else "server",
        "criticality": "high",
        "owner": "IT Department",
        "os": "Ubuntu 22.04",
        "vulnerabilities": _get_mock_vulnerabilities(),
        "patch_status": "partially_patched"
    }

    log.info(f"Asset context collected: {context}")
    return context


@tool
def collect_user_context(user_id: str = None) -> Dict[str, Any]:
    """
    收集用户上下文信息

    Args:
        user_id: 用户ID（可选）

    Returns:
        用户上下文信息字典
    """
    log.info(f"Collecting user context for user_id: {user_id}")

    # Mock implementation - 在生产环境中查询用户目录
    context = {
        "user_id": user_id or "UNKNOWN",
        "role": "employee",
        "department": "Engineering",
        "access_level": "standard",
        "login_history": _get_mock_login_history(),
        "anomaly_count": 0
    }

    log.info(f"User context collected: {context}")
    return context


# Helper functions

def _is_internal_ip(ip: str) -> bool:
    """Check if IP is internal/private"""
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


def _mock_geolocation(ip: str) -> Dict[str, str]:
    """Mock geolocation data - 在生产中使用真实的IP地理位置服务"""
    if _is_internal_ip(ip):
        return {
            "country": "Internal",
            "city": "Corporate Network",
            "coordinates": "N/A"
        }
    return {
        "country": "Unknown",
        "city": "Unknown",
        "coordinates": "N/A"
    }


def _is_cross_border(source_ip: str, target_ip: str) -> bool:
    """Check if communication crosses borders"""
    # Mock implementation
    return False


def _get_mock_vulnerabilities() -> list:
    """Get mock vulnerabilities for the asset"""
    return [
        {"cve_id": "CVE-2023-1234", "severity": "high", "patched": False},
        {"cve_id": "CVE-2023-5678", "severity": "medium", "patched": True}
    ]


def _get_mock_login_history() -> list:
    """Get mock login history"""
    return [
        {"timestamp": "2025-01-04T08:00:00Z", "ip": "192.168.1.100", "location": "Office"},
        {"timestamp": "2025-01-03T17:30:00Z", "ip": "192.168.1.100", "location": "Office"}
    ]
