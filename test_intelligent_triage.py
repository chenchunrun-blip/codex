"""
Test suite for Intelligent Alert Triage System
"""

import pytest
from datetime import datetime
from intelligent_triage import (
    IntelligentTriageEngine,
    AlertPriority,
    TriageAction,
    AlertDeduplicator,
    AlertClusterer,
    HistoricalLearning,
    TriageMetrics
)


class TestAlertDeduplicator:
    """Test alert deduplication"""

    def test_duplicate_detection(self):
        """Test duplicate alert detection"""
        dedup = AlertDeduplicator(time_window_minutes=60)

        alert1 = {
            'alert_id': 'alert_1',
            'alert_type': 'malware',
            'source_ip': '192.168.1.100',
            'target_ip': '10.0.0.1',
            'asset_id': 'server1',
            'file_hash': 'abc123'
        }

        # First alert should not be duplicate
        assert not dedup.is_duplicate(alert1)
        dedup.register_alert('alert_1', alert1)

        # Identical alert should be duplicate
        alert2 = alert1.copy()
        alert2['alert_id'] = 'alert_2'
        assert dedup.is_duplicate(alert2)

    def test_different_alerts_not_duplicate(self):
        """Test different alerts are not marked as duplicate"""
        dedup = AlertDeduplicator(time_window_minutes=60)

        alert1 = {
            'alert_id': 'alert_1',
            'alert_type': 'malware',
            'source_ip': '192.168.1.100',
            'target_ip': '10.0.0.1',
            'asset_id': 'server1',
            'file_hash': 'abc123'
        }

        alert2 = {
            'alert_id': 'alert_2',
            'alert_type': 'phishing',
            'source_ip': '192.168.1.200',
            'target_ip': '10.0.0.2',
            'asset_id': 'server2',
            'file_hash': 'xyz789'
        }

        dedup.register_alert('alert_1', alert1)
        assert not dedup.is_duplicate(alert2)


class TestAlertClusterer:
    """Test alert clustering"""

    def test_similar_alerts_clustering(self):
        """Test clustering of similar alerts"""
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

        related = clusterer.find_related_alerts(alert1, [alert2], similarity_threshold=0.6)
        assert 'alert_2' in related

    def test_cluster_creation(self):
        """Test cluster creation"""
        clusterer = AlertClusterer()

        cluster = clusterer.create_cluster(
            cluster_id='cluster_1',
            primary_alert_id='alert_1',
            related_alert_ids=['alert_2', 'alert_3'],
            cluster_type='malware'
        )

        assert cluster.cluster_id == 'cluster_1'
        assert cluster.primary_alert_id == 'alert_1'
        assert len(cluster.related_alert_ids) == 2

    def test_get_cluster_for_alert(self):
        """Test retrieving cluster for alert"""
        clusterer = AlertClusterer()

        clusterer.create_cluster(
            cluster_id='cluster_1',
            primary_alert_id='alert_1',
            related_alert_ids=['alert_2']
        )

        cluster = clusterer.get_cluster_for_alert('alert_2')
        assert cluster is not None
        assert cluster.cluster_id == 'cluster_1'


class TestHistoricalLearning:
    """Test historical learning"""

    def test_pattern_recording(self):
        """Test recording alert patterns"""
        learning = HistoricalLearning()

        learning.record_alert_pattern(
            alert_type='malware',
            severity='high',
            action_taken='quarantine',
            outcome='resolved'
        )

        learning.record_alert_pattern(
            alert_type='malware',
            severity='high',
            action_taken='quarantine',
            outcome='resolved'
        )

        pattern = learning.alert_patterns.get('malware_high')
        assert pattern['count'] == 2
        assert pattern['successful_outcomes'] == 2

    def test_success_rate(self):
        """Test success rate calculation"""
        learning = HistoricalLearning()

        for _ in range(3):
            learning.record_alert_pattern(
                alert_type='phishing',
                severity='medium',
                action_taken='investigate',
                outcome='resolved'
            )

        learning.record_alert_pattern(
            alert_type='phishing',
            severity='medium',
            action_taken='investigate',
            outcome='false_positive'
        )

        success_rate = learning.get_success_rate('phishing', 'medium')
        assert success_rate == 0.75

    def test_recommended_action(self):
        """Test action recommendation"""
        learning = HistoricalLearning()

        learning.record_alert_pattern(
            alert_type='brute_force',
            severity='high',
            action_taken='block_ip',
            outcome='resolved'
        )

        learning.record_alert_pattern(
            alert_type='brute_force',
            severity='high',
            action_taken='block_ip',
            outcome='resolved'
        )

        action = learning.get_recommended_action('brute_force', 'high')
        assert action == 'block_ip'


class TestIntelligentTriageEngine:
    """Test main triage engine"""

    def test_basic_triage(self):
        """Test basic alert triage"""
        engine = IntelligentTriageEngine()

        alert = {
            'alert_id': 'alert_123',
            'alert_type': 'malware',
            'severity': 'critical',
            'source_ip': '192.168.1.100',
            'target_ip': '10.0.0.1',
            'asset_id': 'server1'
        }

        decision = engine.triage_alert(alert)

        assert decision.alert_id == 'alert_123'
        assert decision.priority == AlertPriority.CRITICAL
        assert decision.recommended_action == TriageAction.ESCALATE_IMMEDIATE
        assert decision.confidence > 0.9

    def test_triage_with_threat_intel(self):
        """Test triage with threat intelligence"""
        engine = IntelligentTriageEngine()

        alert = {
            'alert_id': 'alert_124',
            'alert_type': 'malware',
            'severity': 'high',
            'source_ip': '192.168.1.100',
            'target_ip': '10.0.0.1',
            'asset_id': 'server1'
        }

        threat_intel = {
            'threat_level_score': 90,
            'threat_level': 'critical'
        }

        decision = engine.triage_alert(alert, threat_intel=threat_intel)

        assert decision.priority in [AlertPriority.CRITICAL, AlertPriority.HIGH]
        assert decision.metrics.threat_intel_score == 90

    def test_triage_with_asset_context(self):
        """Test triage with asset context"""
        engine = IntelligentTriageEngine()

        alert = {
            'alert_id': 'alert_125',
            'alert_type': 'intrusion',
            'severity': 'medium',
            'asset_id': 'db_server'
        }

        asset_context = {
            'criticality': 'critical',
            'name': 'Database Server'
        }

        decision = engine.triage_alert(alert, asset_context=asset_context)

        assert decision.metrics.asset_criticality_score > 70
        assert 'Critical asset' in decision.estimated_impact

    def test_triage_with_correlation(self):
        """Test triage with alert correlation"""
        engine = IntelligentTriageEngine()

        alert = {
            'alert_id': 'alert_126',
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

        decision = engine.triage_alert(alert, recent_alerts=recent_alerts)

        assert decision.cluster_id is not None
        assert decision.metrics.correlation_score > 0

    def test_duplicate_handling(self):
        """Test duplicate alert handling"""
        engine = IntelligentTriageEngine()

        alert1 = {
            'alert_id': 'alert_130',
            'alert_type': 'phishing',
            'source_ip': '192.168.1.100',
            'target_ip': '10.0.0.1',
            'asset_id': 'user_pc'
        }

        alert2 = alert1.copy()
        alert2['alert_id'] = 'alert_131'

        decision1 = engine.triage_alert(alert1)
        assert decision1.recommended_action != TriageAction.ARCHIVE

        decision2 = engine.triage_alert(alert2)
        assert decision2.recommended_action == TriageAction.ARCHIVE
        assert decision2.confidence == 0.95

    def test_low_priority_alert(self):
        """Test low priority alert handling"""
        engine = IntelligentTriageEngine()

        alert = {
            'alert_id': 'alert_135',
            'alert_type': 'info',
            'severity': 'low',
            'source_ip': '192.168.1.100'
        }

        decision = engine.triage_alert(alert)

        assert decision.priority in [AlertPriority.LOW, AlertPriority.INFO]
        assert decision.recommended_action in [TriageAction.ARCHIVE, TriageAction.MONITOR_ONLY]

    def test_high_confidence_decision(self):
        """Test high confidence triage decision"""
        engine = IntelligentTriageEngine()

        alert = {
            'alert_id': 'alert_140',
            'alert_type': 'malware',
            'severity': 'critical',
            'source_ip': '192.168.1.100',
            'target_ip': '10.0.0.1',
            'asset_id': 'critical_server'
        }

        threat_intel = {
            'threat_level_score': 95,
            'threat_level': 'critical'
        }

        asset_context = {
            'criticality': 'critical',
            'name': 'Critical Database'
        }

        decision = engine.triage_alert(
            alert,
            threat_intel=threat_intel,
            asset_context=asset_context
        )

        assert decision.confidence > 0.85
        assert decision.priority == AlertPriority.CRITICAL


class TestTriageMetrics:
    """Test triage metrics calculation"""

    def test_metric_calculation(self):
        """Test metric score calculation"""
        metrics = TriageMetrics(
            alert_type_match_score=90,
            severity_score=80,
            threat_intel_score=85,
            asset_criticality_score=75,
            historical_pattern_score=70,
            correlation_score=60
        )

        total = metrics.get_total_score()
        assert 60 < total < 100

    def test_weighted_scoring(self):
        """Test weighted scoring"""
        metrics1 = TriageMetrics(
            alert_type_match_score=100,
            severity_score=100,
            threat_intel_score=100,
            asset_criticality_score=100,
            historical_pattern_score=100,
            correlation_score=100
        )

        metrics2 = TriageMetrics(
            alert_type_match_score=50,
            severity_score=50,
            threat_intel_score=50,
            asset_criticality_score=50,
            historical_pattern_score=50,
            correlation_score=50
        )

        assert metrics1.get_total_score() > metrics2.get_total_score()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
