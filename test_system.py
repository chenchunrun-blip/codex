#!/usr/bin/env python3
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

"""Quick system test without API key"""
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

print("=" * 80)
print("🔒 Security Alert Triage System - Quick Test")
print("=" * 80)
print()

# Test 1: Import modules
print("Test 1: Importing modules...")
try:
    from src.models.alert import SecurityAlert, RiskLevel, AlertType, SeverityLevel
    from src.tools.context_tools import collect_network_context
    from src.tools.threat_intel_tools import check_malware_hash
    from src.tools.risk_assessment_tools import calculate_risk_score
    print("✅ All modules imported successfully")
except Exception as e:
    print(f"❌ Import failed: {e}")
    sys.exit(1)

# Test 2: Create alert model
print("\nTest 2: Creating alert model...")
try:
    alert = SecurityAlert(
        alert_id="TEST-001",
        timestamp="2025-01-04T12:00:00Z",
        alert_type=AlertType.MALWARE,
        source_ip="45.33.32.156",
        target_ip="10.0.0.50",
        severity=SeverityLevel.HIGH,
        description="Test alert"
    )
    print(f"✅ Alert created: {alert.alert_id}")
except Exception as e:
    print(f"❌ Alert creation failed: {e}")
    sys.exit(1)

# Test 3: Test context tools
print("\nTest 3: Testing context collection tools...")
try:
    context = collect_network_context.invoke({
        "source_ip": "192.168.1.1",
        "target_ip": "10.0.0.1"
    })
    print(f"✅ Context collected: {list(context.keys())}")
except Exception as e:
    print(f"❌ Context collection failed: {e}")
    sys.exit(1)

# Test 4: Test threat intel tools
print("\nTest 4: Testing threat intelligence tools...")
try:
    result = check_malware_hash.invoke({
        "file_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
    })
    print(f"✅ Malware check completed: {result.get('classification')}")
except Exception as e:
    print(f"❌ Malware check failed: {e}")
    sys.exit(1)

# Test 5: Test risk assessment tools
print("\nTest 5: Testing risk assessment tools...")
try:
    risk = calculate_risk_score.invoke({
        "severity": "high",
        "threat_intel_score": 7.0,
        "asset_criticality": "high",
        "exploitability": "medium"
    })
    print(f"✅ Risk score calculated: {risk['risk_score']}/100 ({risk['risk_level']})")
except Exception as e:
    print(f"❌ Risk assessment failed: {e}")
    sys.exit(1)

print()
print("=" * 80)
print("✅ All tests passed!")
print("=" * 80)
print()
print("System is ready. To run with API key:")
print("  1. Create .env file with OPENAI_API_KEY")
print("  2. Run: python main.py --sample")
print()
