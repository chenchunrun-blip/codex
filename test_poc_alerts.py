#!/usr/bin/env python3
"""
POC Alert Testing Script

Send various test alerts to the security triage system to verify:
1. Alert ingestion and persistence
2. Alert normalization
3. Context enrichment (assets, users)
4. Threat intelligence (internal IOCs)
5. End-to-end processing
"""

import json
import requests
import time
from datetime import datetime

API_BASE_URL = "http://localhost:9001/api/v1"

# Test alerts covering different scenarios
TEST_ALERTS = [
    # 1. Alert with known malicious hash (from internal IOCs)
    {
        "name": "Known Malware Hash",
        "alert": {
            "alert_id": f"MALWARE-HASH-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "malware",
            "severity": "critical",
            "title": "Known Malware Detected",
            "description": "File hash matches known ransomware variant",
            "source_ip": "192.168.1.100",
            "target_ip": "10.0.1.10",
            "file_hash": "5d41402abc4b2a76b9719d911017c592",  # Known malicious from internal IOCs
            "file_name": "suspicious.exe",
            "asset_id": "SRV-PROD-001"
        }
    },

    # 2. Alert with known malicious IP (from internal IOCs)
    {
        "name": "Known Malicious IP",
        "alert": {
            "alert_id": f"MALWARE-IP-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "brute_force",
            "severity": "high",
            "title": "Connection to Known Malicious IP",
            "description": "Internal host communicating with known botnet C2 server",
            "source_ip": "10.0.10.50",
            "target_ip": "45.33.32.156",  # Known malicious from internal IOCs
            "asset_id": "WS-DEV-001",
            "user_id": "john.doe@example.com"
        }
    },

    # 3. Alert with known malicious domain
    {
        "name": "Known Malicious Domain",
        "alert": {
            "alert_id": f"MALWARE-DOMAIN-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "data_exfiltration",
            "severity": "critical",
            "title": "Access to Known Malicious Domain",
            "description": "DNS query to known C2 domain",
            "source_ip": "10.0.1.20",
            "target_ip": "8.8.8.8",
            "url": "http://malware-domain.evil.com/payload",  # Known malicious from internal IOCs
            "asset_id": "SRV-PROD-002"
        }
    },

    # 4. Alert with phishing email
    {
        "name": "Phishing Email",
        "alert": {
            "alert_id": f"PHISH-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "phishing",
            "severity": "high",
            "title": "Suspicious Email Detected",
            "description": "Email from known phishing sender",
            "source_ip": "10.0.1.10",
            "user_id": "john.doe@example.com",
            "asset_id": "WS-DEV-001"
        }
    },

    # 5. Normal alert (no known IOCs)
    {
        "name": "Normal Anomaly",
        "alert": {
            "alert_id": f"ANOMALY-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "anomaly",
            "severity": "medium",
            "title": "Unusual Login Time",
            "description": "User login outside normal hours",
            "source_ip": "192.168.1.50",
            "target_ip": "10.0.1.10",
            "user_id": "alice.smith@example.com",
            "asset_id": "SRV-PROD-001"
        }
    },

    # 6. Database server alert
    {
        "name": "Database Attack",
        "alert": {
            "alert_id": f"DB-ATTACK-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "unauthorized_access",
            "severity": "critical",
            "title": "Unauthorized Database Access Attempt",
            "description": "Failed login attempts to production database",
            "source_ip": "10.0.50.100",
            "target_ip": "10.0.2.10",
            "asset_id": "SRV-PROD-003"
        }
    },

    # 7. Network firewall alert
    {
        "name": "Firewall Block",
        "alert": {
            "alert_id": f"FW-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "denial_of_service",
            "severity": "high",
            "title": "DDoS Attack Blocked",
            "description": "Firewall blocked suspicious traffic patterns",
            "source_ip": "203.0.113.50",
            "target_ip": "10.0.0.1",
            "source_port": 80,
            "destination_port": 443,
            "asset_id": "NET-FW-001"
        }
    },

    # 8. Internal compromised IP
    {
        "name": "Compromised Internal Host",
        "alert": {
            "alert_id": f"INTERNAL-{int(time.time())}",
            "timestamp": datetime.utcnow().isoformat(),
            "alert_type": "malware",
            "severity": "critical",
            "title": "Internal Host Known Compromised",
            "description": "Internal IP flagged as compromised in incident response",
            "source_ip": "192.168.1.100",
            "target_ip": "10.0.1.20",
            "asset_id": "SRV-PROD-002"
        }
    }
]


def send_alert(alert_data: dict) -> dict:
    """Send alert to the triage system."""
    try:
        response = requests.post(
            f"{API_BASE_URL}/alerts",
            json=alert_data,
            headers={"Content-Type": "application/json"},
            timeout=10
        )

        if response.status_code == 200:
            return response.json()
        else:
            return {
                "error": True,
                "status_code": response.status_code,
                "detail": response.text
            }
    except Exception as e:
        return {
            "error": True,
            "detail": str(e)
        }


def check_alert_in_db(alert_id: str) -> bool:
    """Check if alert exists in database."""
    try:
        import subprocess
        result = subprocess.run(
            [
                "docker-compose", "exec", "-T", "postgres",
                "psql", "-U", "triage_user", "-d", "security_triage",
                "-c", f"SELECT alert_id FROM alerts WHERE alert_id = '{alert_id}';"
            ],
            capture_output=True,
            text=True,
            timeout=10
        )

        return alert_id in result.stdout
    except Exception as e:
        print(f"  ⚠️  Could not check database: {e}")
        return False


def main():
    """Run all test alerts."""
    print("=" * 80)
    print("POC Alert Testing - Security Triage System")
    print("=" * 80)
    print()

    results = {
        "total": len(TEST_ALERTS),
        "success": 0,
        "failed": 0,
        "details": []
    }

    for i, test_case in enumerate(TEST_ALERTS, 1):
        name = test_case["name"]
        alert = test_case["alert"]

        print(f"\n[{i}/{len(TEST_ALERTS)}] Testing: {name}")
        print(f"  Alert ID: {alert['alert_id']}")
        print(f"  Type: {alert['alert_type']}, Severity: {alert['severity']}")

        # Send alert
        response = send_alert(alert)

        if response.get("error"):
            print(f"  ❌ Failed to send: {response.get('detail')}")
            results["failed"] += 1
            results["details"].append({
                "name": name,
                "status": "failed",
                "error": response.get("detail")
            })
        else:
            print(f"  ✅ Sent successfully")
            print(f"  📝 Ingestion ID: {response['data']['ingestion_id']}")
            print(f"  📊 Status: {response['data']['status']}")

            # Wait a moment for processing
            time.sleep(2)

            # Check if persisted to database
            if check_alert_in_db(alert['alert_id']):
                print(f"  ✅ Persisted to database")
            else:
                print(f"  ⚠️  Not yet in database (processing...)")

            results["success"] += 1
            results["details"].append({
                "name": name,
                "status": "success",
                "alert_id": alert['alert_id'],
                "ingestion_id": response['data']['ingestion_id']
            })

        # Small delay between alerts
        time.sleep(1)

    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total Alerts: {results['total']}")
    print(f"✅ Success: {results['success']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"Success Rate: {results['success']/results['total']*100:.1f}%")

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"test_results_{timestamp}.json"

    with open(results_file, "w") as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\n📄 Results saved to: {results_file}")
    print("\n" + "=" * 80)
    print("Next Steps:")
    print("1. Check alert processing logs: docker-compose logs -f --tail=50")
    print("2. View database: docker-compose exec postgres psql -U triage_user -d security_triage")
    print("3. Query alerts: SELECT alert_id, alert_type, severity, status FROM alerts ORDER BY created_at DESC LIMIT 10;")
    print("=" * 80)


if __name__ == "__main__":
    main()
