#!/usr/bin/env python3
"""
Validation script for Alert Correlation Analysis
"""

import sys
from datetime import datetime, timedelta
from alert_correlation_analysis import AlertCorrelationEngine, AttackChainType


def create_test_alerts():
    """Create test alerts for correlation"""
    base_time = datetime.now()

    return [
        {
            'alert_id': 'alert_001',
            'alert_type': 'phishing',
            'severity': 'high',
            'source_ip': '203.0.113.10',
            'target_ip': '192.168.1.100',
            'asset_id': 'user_pc_001',
            'user_id': 'user_001',
            'timestamp': (base_time - timedelta(minutes=30)).isoformat(),
            'description': 'Phishing email detected'
        },
        {
            'alert_id': 'alert_002',
            'alert_type': 'credential_theft',
            'severity': 'critical',
            'source_ip': '203.0.113.10',
            'target_ip': '192.168.1.100',
            'asset_id': 'user_pc_001',
            'user_id': 'user_001',
            'timestamp': (base_time - timedelta(minutes=20)).isoformat(),
            'description': 'Credentials harvested from web form'
        },
        {
            'alert_id': 'alert_003',
            'alert_type': 'lateral_movement',
            'severity': 'high',
            'source_ip': '192.168.1.100',
            'target_ip': '192.168.1.50',
            'asset_id': 'server_001',
            'timestamp': (base_time - timedelta(minutes=10)).isoformat(),
            'description': 'Lateral movement detected'
        },
        {
            'alert_id': 'alert_004',
            'alert_type': 'data_exfiltration',
            'severity': 'critical',
            'source_ip': '192.168.1.50',
            'target_ip': '203.0.113.20',
            'asset_id': 'server_001',
            'timestamp': base_time.isoformat(),
            'description': 'Large data transfer detected'
        }
    ]


def validate_correlation_engine():
    """Validate alert correlation engine"""
    print("\n=== Testing Alert Correlation Engine ===")
    engine = AlertCorrelationEngine(correlation_window_hours=24)

    alerts = create_test_alerts()

    # Test 1: Basic correlation analysis
    print("\nTest 1: Basic correlation analysis")
    analysis = engine.analyze_correlation(
        alert_id='alert_004',
        alert=alerts[3],
        recent_alerts=alerts[:3]
    )

    print(f"  Alert ID: {analysis['alert_id']}")
    print(f"  Related alerts found: {len(analysis['related_alerts'])}")
    assert len(analysis['related_alerts']) > 0, "Should find related alerts"

    for rel in analysis['related_alerts'][:2]:
        print(f"    - {rel['alert_id']}: {rel['relationship']} (confidence: {rel['confidence']:.2f})")

    # Test 2: Attack chain detection
    print("\nTest 2: Attack chain detection")
    chains = analysis['attack_chains']
    print(f"  Attack chains detected: {len(chains)}")
    assert len(chains) > 0, "Should detect attack chains"

    for chain in chains:
        print(f"    - Chain type: {chain['chain_type']}")
        print(f"      Stages: {len(chain['stages'])}")
        print(f"      Confidence: {chain['confidence']:.2f}")
        print(f"      Severity: {chain['severity']}")

    # Test 3: Root cause analysis
    print("\nTest 3: Root cause analysis")
    root_cause = analysis['root_cause']
    if root_cause:
        print(f"  Root cause alert: {root_cause['root_cause_alert_id']}")
        print(f"  Affected alerts: {len(root_cause['affected_alerts'])}")
        print(f"  Reasoning: {root_cause['reasoning']}")
        assert root_cause['root_cause_alert_id'] == 'alert_001', "Root cause should be phishing"
    else:
        print("  No root cause identified")

    # Test 4: Threat actor profiling
    print("\nTest 4: Threat actor profiling")
    profile = analysis['threat_actor']
    print(f"  Suspected motive: {profile['suspected_motive']}")
    print(f"  Sophistication: {profile['sophistication']}")
    print(f"  Observed tactics: {', '.join(profile['observed_tactics'])}")
    print(f"  Alert count: {profile['alert_count']}")
    assert profile['suspected_motive'] == "financial", "Motive should be financial (data exfil)"

    # Test 5: Impact propagation
    print("\nTest 5: Impact propagation analysis")
    propagation = analysis['impact_propagation']
    print(f"  Affected IPs: {len(propagation['affected_ip_addresses'])}")
    print(f"  Affected assets: {len(propagation['affected_assets'])}")
    print(f"  Affected users: {len(propagation['affected_users'])}")
    print(f"  Blast radius: {propagation['blast_radius']}")
    print(f"  Propagation rate: {propagation['propagation_rate']}")

    # Test 6: Alert relationships
    print("\nTest 6: Alert relationships")
    relationships = engine.alert_relationships
    print(f"  Total relationships tracked: {len(relationships)}")
    for rel in relationships[:3]:
        print(f"    - {rel.source_alert_id} -> {rel.target_alert_id}")
        print(f"      Type: {rel.relationship_type}, Confidence: {rel.confidence:.2f}")

    print("\n✓ Alert correlation engine validation passed")


def validate_attack_chain_detection():
    """Validate attack chain detection"""
    print("\n=== Testing Attack Chain Detection ===")
    engine = AlertCorrelationEngine()

    alerts = create_test_alerts()

    # Test exfiltration chain detection
    print("\nTest 1: Exfiltration chain detection")
    chain = engine._detect_exfiltration_chain(alerts)
    assert chain is not None, "Should detect exfiltration chain"
    print(f"  Chain detected: {chain.chain_type.value}")
    print(f"  Confidence: {chain.confidence:.2f}")
    print(f"  Severity: {chain.estimated_severity}")
    print(f"  Stages: {len(chain.stages)}")

    print("\n✓ Attack chain detection validation passed")


def validate_threat_actor_profiling():
    """Validate threat actor profiling"""
    print("\n=== Testing Threat Actor Profiling ===")
    engine = AlertCorrelationEngine()

    alerts = create_test_alerts()

    # Test sophistication assessment
    print("\nTest 1: Sophistication assessment")
    sophistication = engine._assess_sophistication(alerts)
    print(f"  Assessed sophistication: {sophistication}")
    assert sophistication in ["low", "medium", "high", "very_high"], "Invalid sophistication"

    # Test motive determination
    print("\nTest 2: Motive determination")
    motive = engine._determine_motive(alerts)
    print(f"  Determined motive: {motive}")
    assert motive == "financial", "Should detect financial motive (exfil)"

    # Test TTP extraction
    print("\nTest 3: TTP extraction")
    ttps = engine._extract_ttps(alerts)
    print(f"  Extracted {len(ttps)} TTPs:")
    for ttp in ttps:
        print(f"    - {ttp}")

    print("\n✓ Threat actor profiling validation passed")


def validate_root_cause_analysis():
    """Validate root cause analysis"""
    print("\n=== Testing Root Cause Analysis ===")
    engine = AlertCorrelationEngine()

    alerts = create_test_alerts()

    # Test root cause identification
    print("\nTest 1: Root cause identification")
    current_alert = alerts[3]  # Data exfil alert
    root_cause = engine._analyze_root_cause(current_alert, alerts[:3])

    if root_cause:
        print(f"  Root cause: {root_cause['root_cause_alert_id']}")
        print(f"  Affected: {len(root_cause['affected_alerts'])} alerts")
        print(f"  Reasoning: {root_cause['reasoning']}")
        print(f"  Remediation steps:")
        for step in root_cause['remediation'][:2]:
            print(f"    - {step}")
        assert root_cause['root_cause_alert_id'] == 'alert_001', "Root cause should be first alert"
    else:
        print("  No root cause identified")

    print("\n✓ Root cause analysis validation passed")


def main():
    """Run all validations"""
    print("=" * 60)
    print("Alert Correlation Analysis - Validation")
    print("=" * 60)

    try:
        validate_correlation_engine()
        validate_attack_chain_detection()
        validate_threat_actor_profiling()
        validate_root_cause_analysis()

        print("\n" + "=" * 60)
        print("✓ ALL VALIDATIONS PASSED")
        print("=" * 60)
        return 0

    except Exception as e:
        print(f"\n✗ VALIDATION FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
