#!/usr/bin/env python3
"""
Validation script for Intelligent Alert Triage System
"""

import sys
from intelligent_triage import (
    IntelligentTriageEngine,
    AlertPriority,
    TriageAction,
    AlertDeduplicator,
    AlertClusterer,
)


def validate_deduplicator():
    """Validate alert deduplication"""
    print("\n=== Testing Alert Deduplicator ===")
    dedup = AlertDeduplicator(time_window_minutes=60)

    alert1 = {
        'alert_id': 'alert_1',
        'alert_type': 'malware',
        'source_ip': '192.168.1.100',
        'target_ip': '10.0.0.1',
        'asset_id': 'server1',
        'file_hash': 'abc123'
    }

    # Test 1: First alert should not be duplicate
    is_dup = dedup.is_duplicate(alert1)
    print(f"Test 1 - First alert is duplicate: {is_dup} (Expected: False)")
    assert not is_dup, "Failed: First alert should not be duplicate"

    dedup.register_alert('alert_1', alert1)

    # Test 2: Identical alert should be duplicate
    alert2 = alert1.copy()
    alert2['alert_id'] = 'alert_2'
    is_dup = dedup.is_duplicate(alert2)
    print(f"Test 2 - Identical alert is duplicate: {is_dup} (Expected: True)")
    assert is_dup, "Failed: Identical alert should be duplicate"

    print("✓ Alert deduplicator validation passed")


def validate_clusterer():
    """Validate alert clustering"""
    print("\n=== Testing Alert Clusterer ===")
    clusterer = AlertClusterer()

    alert1 = {
        'alert_id': 'alert_1',
        'alert_type': 'malware',
        'source_ip': '192.168.1.100',
        'target_ip': '10.0.0.1',
        'asset_id': 'server1'
    }

    alert2 = {
        'alert_id': 'alert_2',
        'alert_type': 'malware',
        'source_ip': '192.168.1.100',
        'target_ip': '10.0.0.1',
        'asset_id': 'server1'
    }

    # Test 1: Find related alerts
    related = clusterer.find_related_alerts(alert1, [alert2], similarity_threshold=0.6)
    print(f"Test 1 - Found {len(related)} related alerts (Expected: 1)")
    assert len(related) == 1, "Failed: Should find 1 related alert"

    # Test 2: Create cluster
    cluster = clusterer.create_cluster(
        cluster_id='cluster_1',
        primary_alert_id='alert_1',
        related_alert_ids=['alert_2'],
        cluster_type='malware'
    )
    print(f"Test 2 - Created cluster {cluster.cluster_id}")
    assert cluster.cluster_id == 'cluster_1', "Failed: Cluster ID mismatch"

    # Test 3: Retrieve cluster
    retrieved = clusterer.get_cluster_for_alert('alert_2')
    print(f"Test 3 - Retrieved cluster for alert_2: {retrieved.cluster_id}")
    assert retrieved is not None, "Failed: Should retrieve cluster"

    print("✓ Alert clusterer validation passed")


def validate_triage_engine():
    """Validate main triage engine"""
    print("\n=== Testing Intelligent Triage Engine ===")
    engine = IntelligentTriageEngine()

    # Test 1: Basic triage - Critical malware
    alert1 = {
        'alert_id': 'alert_123',
        'alert_type': 'malware',
        'severity': 'critical',
        'source_ip': '192.168.1.100',
        'target_ip': '10.0.0.1',
        'asset_id': 'server1'
    }

    decision1 = engine.triage_alert(alert1)
    print(f"Test 1 - Critical malware alert")
    print(f"  Priority: {decision1.priority.name} (Expected: CRITICAL)")
    print(f"  Action: {decision1.recommended_action.name} (Expected: ESCALATE_IMMEDIATE)")
    print(f"  Confidence: {decision1.confidence:.2f}")
    assert decision1.priority == AlertPriority.CRITICAL, "Failed: Should be CRITICAL priority"
    assert decision1.recommended_action == TriageAction.ESCALATE_IMMEDIATE, "Failed: Should escalate"

    # Test 2: Duplicate detection
    alert2 = alert1.copy()
    alert2['alert_id'] = 'alert_124'
    decision2 = engine.triage_alert(alert2)
    print(f"\nTest 2 - Duplicate detection")
    print(f"  Action: {decision2.recommended_action.name} (Expected: ARCHIVE)")
    print(f"  Confidence: {decision2.confidence:.2f}")
    assert decision2.recommended_action == TriageAction.ARCHIVE, "Failed: Should archive duplicate"

    # Test 3: Low severity alert
    alert3 = {
        'alert_id': 'alert_125',
        'alert_type': 'info',
        'severity': 'low',
        'source_ip': '192.168.1.100'
    }
    decision3 = engine.triage_alert(alert3)
    print(f"\nTest 3 - Low severity alert")
    print(f"  Priority: {decision3.priority.name}")
    print(f"  Action: {decision3.recommended_action.name}")
    assert decision3.priority in [AlertPriority.LOW, AlertPriority.INFO], "Failed: Should be low priority"

    # Test 4: With threat intelligence
    alert4 = {
        'alert_id': 'alert_126',
        'alert_type': 'malware',
        'severity': 'high',
        'source_ip': '192.168.1.200',  # Different IP to avoid duplicate
        'target_ip': '10.0.0.2',  # Different IP
        'asset_id': 'server2'  # Different asset
    }
    threat_intel = {
        'threat_level_score': 90,
        'threat_level': 'critical'
    }
    decision4 = engine.triage_alert(alert4, threat_intel=threat_intel)
    print(f"\nTest 4 - With threat intelligence")
    print(f"  Threat intel score: {decision4.metrics.threat_intel_score:.1f} (Expected: 90)")
    print(f"  Priority: {decision4.priority.name}")
    print(f"  Total score: {decision4.metrics.get_total_score():.1f}")
    assert decision4.metrics.threat_intel_score == 90, "Failed: Threat intel score mismatch"

    # Test 5: With asset context
    alert5 = {
        'alert_id': 'alert_127',
        'alert_type': 'intrusion',
        'severity': 'medium',
        'asset_id': 'db_server'
    }
    asset_context = {
        'criticality': 'critical',
        'name': 'Database Server'
    }
    decision5 = engine.triage_alert(alert5, asset_context=asset_context)
    print(f"\nTest 5 - With asset context")
    print(f"  Asset criticality: {decision5.metrics.asset_criticality_score:.1f}")
    print(f"  Impact: {decision5.estimated_impact}")
    assert decision5.metrics.asset_criticality_score > 70, "Failed: Asset criticality score low"

    # Test 6: With correlation
    alert6 = {
        'alert_id': 'alert_128',
        'alert_type': 'brute_force',
        'severity': 'high',
        'source_ip': '192.168.1.100'
    }
    recent_alerts = [
        {
            'alert_id': 'alert_120',
            'alert_type': 'brute_force',
            'severity': 'high',
            'source_ip': '192.168.1.100'
        },
        {
            'alert_id': 'alert_121',
            'alert_type': 'brute_force',
            'severity': 'high',
            'source_ip': '192.168.1.100'
        }
    ]
    decision6 = engine.triage_alert(alert6, recent_alerts=recent_alerts)
    print(f"\nTest 6 - With correlation")
    print(f"  Cluster ID: {decision6.cluster_id}")
    print(f"  Correlation score: {decision6.metrics.correlation_score:.1f}")
    assert decision6.cluster_id is not None, "Failed: Should create cluster"

    print("\n✓ Intelligent triage engine validation passed")


def validate_metrics():
    """Validate metrics calculation"""
    print("\n=== Testing Metrics Calculation ===")
    from intelligent_triage import TriageMetrics

    metrics1 = TriageMetrics(
        alert_type_match_score=90,
        severity_score=80,
        threat_intel_score=85,
        asset_criticality_score=75,
        historical_pattern_score=70,
        correlation_score=60
    )

    score1 = metrics1.get_total_score()
    print(f"Test 1 - Weighted score: {score1:.2f}")
    assert 60 < score1 < 100, "Failed: Score out of range"

    metrics2 = TriageMetrics(
        alert_type_match_score=100,
        severity_score=100,
        threat_intel_score=100,
        asset_criticality_score=100,
        historical_pattern_score=100,
        correlation_score=100
    )

    score2 = metrics2.get_total_score()
    print(f"Test 2 - Perfect score: {score2:.2f} (Expected: 100)")
    assert score2 == 100, "Failed: Perfect score should be 100"

    print("✓ Metrics validation passed")


def main():
    """Run all validations"""
    print("=" * 60)
    print("Intelligent Alert Triage System - Validation")
    print("=" * 60)

    try:
        validate_deduplicator()
        validate_clusterer()
        validate_metrics()
        validate_triage_engine()

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
