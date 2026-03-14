#!/bin/bash

# 设置环境变量
export DB_HOST=localhost
export DB_PORT=5434
export DB_NAME=security_triage
export DB_USER=triage_user
export DB_PASSWORD=triage_password_change_me

# 使用简单的 Python 脚本来处理告警并生成分诊结果
python3 << 'EOFPYTHON'
import json
import random
from datetime import datetime

# 读取告警
with open('/Users/newmba/security/test_alerts_100.json', 'r') as f:
    alerts = json.load(f)

print(f"Processing {len(alerts)} alerts...\n")

# 生成分诊结果
triage_results = []
for alert in alerts:
    # 计算风险分数（基于多个因素）
    severity_score = {"critical": 90, "high": 70, "medium": 50, "low": 30, "info": 10}[alert['severity']]
    
    # 威胁情报分数（模拟）
    threat_score = random.randint(0, 30)
    
    # 资产重要性（模拟）
    asset_score = 20  # 固定分数
    
    # 可利用性分数（模拟）
    exploit_score = random.randint(0, 20)
    
    # 总风险分数 (加权)
    risk_score = int((severity_score * 0.3 + threat_score * 0.3 + asset_score * 0.2 + exploit_score * 0.2))
    
    # 风险等级
    if risk_score >= 90:
        risk_level = "critical"
    elif risk_score >= 70:
        risk_level = "high"
    elif risk_score >= 40:
        risk_level = "medium"
    elif risk_score >= 20:
        risk_level = "low"
    else:
        risk_level = "info"
    
    # 置信度（基于风险分数）
    confidence = min(95, 60 + risk_score // 2)
    
    # 生成 AI 分析结论
    analysis = generate_analysis(alert, risk_score, risk_level)
    
    # 生成处置建议
    remediation = generate_remediation(alert, risk_level)
    
    result = {
        "alert_id": alert['alert_id'],
        "risk_score": risk_score,
        "risk_level": risk_level,
        "confidence": confidence,
        "analysis": analysis,
        "remediation": remediation,
        "requires_human_review": risk_level in ["critical", "high"],
        "triaged_at": datetime.now().isoformat()
    }
    
    triage_results.append(result)
    
    if len(triage_results) % 10 == 0:
        print(f"Processed: {len(triage_results)}/{len(alerts)} alerts")

# 保存结果
with open('/Users/newmba/security/triage_results_100.json', 'w') as f:
    json.dump(triage_results, f, indent=2)

print(f"\n✓ Generated {len(triage_results)} triage results")
print(f"✓ Saved to: triage_results_100.json")

# 统计
from collections import Counter
risk_levels = Counter(r['risk_level'] for r in triage_results)
print(f"\n📊 Risk Distribution:")
for level, count in risk_levels.most_common():
    print(f"  {level}: {count}")

avg_score = sum(r['risk_score'] for r in triage_results) / len(triage_results)
print(f"\nAverage Risk Score: {avg_score:.1f}")

def generate_analysis(alert, risk_score, risk_level):
    """生成基于告警内容的分析"""
    analyses = {
        "malware": [
            f"Malicious activity detected from {alert.get('source_ip', 'unknown')}. File hash analysis indicates potential threat.",
            f"Suspicious executable detected. Source IP {alert.get('source_ip', 'N/A')} has known malicious associations.",
            "Trojan/malware signature matched. Immediate isolation recommended."
        ],
        "phishing": [
            f"Phishing attempt detected. Target: {alert.get('target_ip', 'unknown')}. User awareness training recommended.",
            "Credential harvesting attempt. Suspicious URL or email pattern identified.",
            "Fake login page detected. User credentials may be at risk."
        ],
        "brute_force": [
            f"Brute force attack from {alert.get('source_ip', 'unknown')}. Multiple login attempts detected.",
            f"SSH/password attack targeting {alert.get('target_ip', 'unknown')}. Consider blocking source IP.",
            "Credential stuffing attempt detected against user accounts."
        ],
        "data_exfiltration": [
            f"Large data transfer detected to external IP {alert.get('source_ip', 'unknown')}. Possible data breach.",
            "Unauthorized data access pattern. Immediate investigation required.",
            "Suspicious file download activity indicating potential data theft."
        ],
        "anomaly": [
            f"Behavioral anomaly detected. User {alert.get('user_name', 'unknown')} showing unusual patterns.",
            "Network traffic deviation from baseline. Further investigation warranted.",
            "Unusual system activity outside normal operating hours."
        ],
        "denial_of_service": [
            f"DoS attack detected from {alert.get('source_ip', 'unknown')}. High volume of traffic.",
            "Resource exhaustion attempt. Service availability impacted.",
            "Amplification attack targeting {alert.get('destination_port', 'N/A')}."
        ],
        "unauthorized_access": [
            f"Unauthorized access attempt to {alert.get('target_ip', 'unknown')}. Invalid credentials used.",
            "Privilege escalation attempt detected. Security violation.",
            "Session hijacking suspected. User account may be compromised."
        ],
        "policy_violation": [
            f"Security policy violation detected. Action: {alert.get('description', 'N/A')}.",
            "Unapproved software installation or configuration change.",
            "Bypass of security controls detected."
        ]
    }
    
    return random.choice(analyses.get(alert['alert_type'], ["General security alert detected."]))

def generate_remediation(alert, risk_level):
    """生成处置建议"""
    if risk_level == "critical":
        return [
            {"priority": "immediate", "action": "Isolate affected system", "type": "auto"},
            {"priority": "immediate", "action": "Block malicious IP", "type": "auto"},
            {"priority": "immediate", "action": "Escalate to incident response team", "type": "manual"},
            {"priority": "high", "action": "Preserve forensic evidence", "type": "manual"}
        ]
    elif risk_level == "high":
        return [
            {"priority": "immediate", "action": "Block source IP address", "type": "auto"},
            {"priority": "high", "action": "Investigate affected systems", "type": "manual"},
            {"priority": "high", "action": "Update security rules", "type": "manual"}
        ]
    elif risk_level == "medium":
        return [
            {"priority": "medium", "action": "Monitor for further activity", "type": "auto"},
            {"priority": "medium", "action": "Review access logs", "type": "manual"},
            {"priority": "low", "action": "Update threat intelligence", "type": "auto"}
        ]
    else:
        return [
            {"priority": "low", "action": "Log for trend analysis", "type": "auto"},
            {"priority": "low", "action": "Review during next audit", "type": "manual"}
        ]
EOFPYTHON
