# Intelligent Alert Triage System Guide

## Overview

The Intelligent Alert Triage System provides advanced security alert analysis and automated prioritization. It combines multiple techniques to efficiently process and route security alerts:

### Key Features

1. **Alert Deduplication** - Automatically detects and filters duplicate alerts using fingerprint matching
2. **Alert Clustering** - Groups related alerts to identify coordinated attacks or patterns
3. **Intelligent Prioritization** - Uses weighted scoring to determine alert priority
4. **Threat Intelligence Integration** - Incorporates threat intel data into risk assessment
5. **Historical Learning** - Learns from past triage decisions to improve future recommendations
6. **Automated Routing** - Routes alerts to appropriate teams based on type and severity
7. **Confidence Scoring** - Provides confidence levels for all triage decisions

## Architecture

### Core Components

#### 1. AlertDeduplicator
Handles alert deduplication using fingerprint matching within a configurable time window.

```python
from intelligent_triage import AlertDeduplicator

dedup = AlertDeduplicator(time_window_minutes=60)

# Check if alert is duplicate
is_duplicate = dedup.is_duplicate(alert)

# Register alert
dedup.register_alert(alert_id, alert)
```

#### 2. AlertClusterer
Groups related alerts based on similarity analysis.

```python
from intelligent_triage import AlertClusterer

clusterer = AlertClusterer()

# Find related alerts
related = clusterer.find_related_alerts(
    alert,
    candidate_alerts,
    similarity_threshold=0.7
)

# Create cluster
cluster = clusterer.create_cluster(
    cluster_id='cluster_1',
    primary_alert_id='alert_1',
    related_alert_ids=['alert_2', 'alert_3']
)
```

#### 3. HistoricalLearning
Learns from historical triage decisions to improve recommendations.

```python
from intelligent_triage import HistoricalLearning

learning = HistoricalLearning()

# Record pattern
learning.record_alert_pattern(
    alert_type='malware',
    severity='high',
    action_taken='quarantine',
    outcome='resolved'
)

# Get recommended action
action = learning.get_recommended_action('malware', 'high')

# Get success rate
rate = learning.get_success_rate('malware', 'high')
```

#### 4. IntelligentTriageEngine
Main engine that orchestrates all components.

```python
from intelligent_triage import IntelligentTriageEngine

engine = IntelligentTriageEngine()

decision = engine.triage_alert(
    alert=alert_data,
    threat_intel=threat_intel,
    asset_context=asset_info,
    user_context=user_info,
    recent_alerts=recent_alert_list
)
```

## Usage Examples

### Basic Alert Triage

```python
from intelligent_triage import IntelligentTriageEngine

engine = IntelligentTriageEngine()

alert = {
    'alert_id': 'alert_001',
    'alert_type': 'malware',
    'severity': 'critical',
    'source_ip': '192.168.1.100',
    'target_ip': '10.0.0.1',
    'asset_id': 'server1'
}

decision = engine.triage_alert(alert)

print(f"Priority: {decision.priority.name}")
print(f"Recommended Action: {decision.recommended_action.name}")
print(f"Confidence: {decision.confidence}")
print(f"Reasoning: {decision.reasoning}")
```

### Advanced Triage with Context

```python
threat_intel = {
    'threat_level_score': 85,
    'threat_level': 'high',
    'detections': [
        {'source': 'VirusTotal', 'detection_rate': 45}
    ]
}

asset_context = {
    'criticality': 'critical',
    'name': 'Database Server',
    'owner': 'IT Team'
}

recent_alerts = [
    {'alert_id': 'alert_002', 'alert_type': 'malware'},
    {'alert_id': 'alert_003', 'alert_type': 'malware'}
]

decision = engine.triage_alert(
    alert=alert,
    threat_intel=threat_intel,
    asset_context=asset_context,
    recent_alerts=recent_alerts
)

print(f"Cluster ID: {decision.cluster_id}")
print(f"Suggested Teams: {decision.suggested_teams}")
print(f"Estimated Impact: {decision.estimated_impact}")
```

## Triage Decision Outcomes

### Priority Levels

- **CRITICAL**: Immediate escalation required (score >= 70)
- **HIGH**: Urgent investigation needed (score >= 55)
- **MEDIUM**: Standard investigation (score >= 40)
- **LOW**: Low priority monitoring (score >= 25)
- **INFO**: Informational only (score < 25)

### Recommended Actions

- **ESCALATE_IMMEDIATE**: Critical priority escalation to management
- **INVESTIGATE_MANUAL**: Manual investigation by SOC team
- **QUARANTINE**: Isolate affected assets
- **AUTO_REMEDIATE**: Automated remediation if confidence > 85%
- **MONITOR_ONLY**: Monitoring without immediate action
- **ARCHIVE**: Duplicate or low-risk alert, archive without action

## Metrics and Scoring

The triage engine uses weighted scoring across multiple factors:

### Metrics Components

1. **Alert Type Match** (15% weight)
   - Malware, Phishing, Data Exfiltration: 90 points
   - Brute Force, Intrusion: 75 points
   - Other: 50 points

2. **Severity Score** (20% weight)
   - Critical: 100 points
   - High: 80 points
   - Medium: 60 points
   - Low: 40 points

3. **Threat Intelligence** (25% weight)
   - Based on threat level scores from intel sources
   - Critical threats: 95 points
   - High threats: 80 points

4. **Asset Criticality** (15% weight)
   - Critical assets: 100 points
   - High importance: 80 points
   - Medium: 50 points
   - Low: 20 points

5. **Historical Pattern** (15% weight)
   - Success rate of past similar alerts (0-100%)

6. **Correlation** (10% weight)
   - Number of related alerts detected

## Integration with Existing Systems

### With API Gateway

```python
from flask import Flask, request
from intelligent_triage import IntelligentTriageEngine

app = Flask(__name__)
engine = IntelligentTriageEngine()

@app.route('/api/triage', methods=['POST'])
def triage_endpoint():
    alert = request.json
    decision = engine.triage_alert(alert)
    return {
        'alert_id': decision.alert_id,
        'priority': decision.priority.name,
        'action': decision.recommended_action.name,
        'confidence': decision.confidence,
        'suggested_teams': decision.suggested_teams
    }
```

### With SIEM Integration

```python
async def process_siem_alert(siem_alert):
    # Extract relevant fields
    alert = {
        'alert_id': siem_alert['id'],
        'alert_type': siem_alert['type'],
        'severity': siem_alert['severity'],
        'source_ip': siem_alert.get('src_ip'),
        'target_ip': siem_alert.get('dst_ip'),
        'asset_id': siem_alert.get('asset_id')
    }

    # Get context
    threat_intel = await fetch_threat_intel(alert['source_ip'])
    asset_context = await fetch_asset_info(alert['asset_id'])

    # Perform triage
    engine = IntelligentTriageEngine()
    decision = engine.triage_alert(
        alert,
        threat_intel=threat_intel,
        asset_context=asset_context
    )

    # Route based on decision
    await route_alert(decision)
```

## Configuration and Tuning

### Adjusting Deduplication Time Window

```python
# 30-minute deduplication window
dedup = AlertDeduplicator(time_window_minutes=30)
```

### Adjusting Similarity Threshold for Clustering

```python
# Higher threshold = stricter matching
related = clusterer.find_related_alerts(
    alert,
    candidates,
    similarity_threshold=0.85  # 85% similarity required
)
```

### Customizing Weights

Edit the `_calculate_metrics` method to adjust component weights or the `_determine_priority` method to change priority thresholds.

## Performance Characteristics

- **Alert Processing**: <100ms per alert (without external API calls)
- **Deduplication**: O(1) fingerprint lookup
- **Clustering**: O(n) similarity matching where n = number of candidate alerts
- **Memory**: ~100KB per 1000 alerts in dedup window

## Testing

Run the validation suite:

```bash
python validate_intelligent_triage.py
```

Run specific tests:

```bash
python -m pytest test_intelligent_triage.py -v
```

## Logging

The system uses Python logging. Configure as needed:

```python
import logging

# Set to DEBUG for detailed logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger('intelligent_triage')
```

## Future Enhancements

1. **Machine Learning Models** - Integrate ML models for better classification
2. **Custom Rules Engine** - Allow custom triage rules per organization
3. **Feedback Loop** - Incorporate analyst feedback for continuous improvement
4. **Multi-Model Routing** - Route complex alerts to multiple analysis models
5. **Threat Correlation Engine** - Advanced correlation across multiple data sources
6. **Real-time Adaptation** - Dynamic threshold adjustment based on threat landscape

## Troubleshooting

### High False Positive Rate

- Increase similarity threshold for clustering
- Reduce alert type match score weight
- Train historical learning with more success data

### Alerts Not Being Clustered

- Lower similarity threshold
- Check that candidate alerts have overlapping fields
- Verify alert fingerprints are correctly calculated

### Incorrect Priority Assignment

- Review threat intelligence data quality
- Check asset context information
- Adjust priority threshold in `_determine_priority`

## Support

For issues or questions, refer to:
- Test suite: `test_intelligent_triage.py`
- Validation script: `validate_intelligent_triage.py`
- Debug utilities: `debug_triage.py`, `debug_triage2.py`
