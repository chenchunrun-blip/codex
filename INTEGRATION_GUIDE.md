# Alert Triage and Correlation System - Integration Guide

## Overview

This guide demonstrates how to integrate the Intelligent Triage System and Alert Correlation Analysis Engine into your security infrastructure.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Alert Sources                            │
│  (SIEM, IDS/IPS, Endpoint Detection, Threat Intel)         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Alert Normalization Layer                       │
│          (Convert to standard alert format)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Correlation  │ │  Intelligent │ │  Threat      │
│  Analysis    │ │   Triage     │ │  Intelligence│
│  Engine      │ │  Engine      │ │  Integration │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
        ┌──────────────────────────────┐
        │    Triage Decision &         │
        │   Correlation Results        │
        └──────────────┬───────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
    ┌──────┐      ┌──────────┐    ┌────────────┐
    │ SOC  │      │Incident  │    │ Automated  │
    │ Team │      │Response  │    │ Remediation│
    │ Mgmt │      │Playbooks │    │ System     │
    └──────┘      └──────────┘    └────────────┘
```

## Quick Start Integration

### 1. Basic Setup

```python
from intelligent_triage import IntelligentTriageEngine
from alert_correlation_analysis import AlertCorrelationEngine

# Initialize engines
triage_engine = IntelligentTriageEngine()
correlation_engine = AlertCorrelationEngine(correlation_window_hours=24)
```

### 2. Processing Incoming Alert

```python
async def process_security_alert(alert_data):
    """Process alert through complete triage pipeline"""

    # Step 1: Normalize alert format
    alert = normalize_alert(alert_data)

    # Step 2: Gather context
    threat_intel = await fetch_threat_intelligence(alert)
    asset_context = await fetch_asset_context(alert)
    user_context = await fetch_user_context(alert)
    recent_alerts = await fetch_recent_alerts(hours=24)

    # Step 3: Correlation analysis
    correlation_analysis = correlation_engine.analyze_correlation(
        alert_id=alert['alert_id'],
        alert=alert,
        recent_alerts=recent_alerts
    )

    # Step 4: Intelligent triage
    triage_decision = triage_engine.triage_alert(
        alert=alert,
        threat_intel=threat_intel,
        asset_context=asset_context,
        user_context=user_context,
        recent_alerts=recent_alerts
    )

    # Step 5: Combine results and route
    incident_context = {
        'alert': alert,
        'triage_decision': triage_decision,
        'correlation_analysis': correlation_analysis,
        'threat_intel': threat_intel,
        'asset_context': asset_context
    }

    await route_and_escalate(incident_context)
    return incident_context
```

## Advanced Integration Scenarios

### Scenario 1: SIEM Integration (Splunk)

```python
from flask import Flask, request
from splunk_sdk import client as splunk_client

app = Flask(__name__)
triage_engine = IntelligentTriageEngine()
correlation_engine = AlertCorrelationEngine()

@app.route('/api/splunk/webhook', methods=['POST'])
async def splunk_webhook():
    """Receive alerts from Splunk search head"""

    alert_data = request.json

    # Convert Splunk format to standard format
    alert = {
        'alert_id': alert_data['sid'],
        'alert_type': alert_data['search_name'].lower(),
        'severity': map_severity(alert_data['severity']),
        'source_ip': alert_data.get('src_ip'),
        'target_ip': alert_data.get('dst_ip'),
        'asset_id': alert_data.get('host'),
        'timestamp': alert_data['_time'],
        'description': alert_data.get('description', '')
    }

    # Process through pipeline
    context = await process_security_alert(alert)

    # Send enriched alert back to Splunk
    await update_splunk_lookup(alert['alert_id'], context['triage_decision'])

    return {'status': 'processed', 'decision': context['triage_decision'].recommended_action.name}
```

### Scenario 2: SOAR Integration

```python
async def create_soar_incident(incident_context):
    """Create and manage incident in SOAR platform"""

    decision = incident_context['triage_decision']
    correlation = incident_context['correlation_analysis']

    # Create incident
    incident = {
        'title': f"{decision.priority.name} - {incident_context['alert']['alert_type']}",
        'severity': map_priority_to_severity(decision.priority),
        'description': incident_context['alert'].get('description', ''),
        'alert_id': incident_context['alert']['alert_id'],
        'cluster_id': decision.cluster_id,
        'root_cause': correlation.get('root_cause', {}).get('root_cause_alert_id'),
        'attack_chains': correlation.get('attack_chains', []),
        'threat_actor_profile': correlation.get('threat_actor', {}),
        'recommended_action': decision.recommended_action.name,
        'suggested_teams': decision.suggested_teams,
        'automation_enabled': decision.automation_enabled,
        'confidence': decision.confidence
    }

    # Create in SOAR
    soar_client = connect_to_soar()
    incident_id = await soar_client.incidents.create(incident)

    # Assign playbook based on decision
    playbook = select_playbook(decision, correlation)
    await soar_client.incidents.assign_playbook(incident_id, playbook)

    return incident_id
```

### Scenario 3: Alert Automation and Remediation

```python
async def handle_triage_decision(decision, incident_context):
    """Execute automated actions based on triage decision"""

    if decision.recommended_action == TriageAction.ESCALATE_IMMEDIATE:
        await escalate_to_management(incident_context)
        await create_critical_incident(incident_context)

    elif decision.recommended_action == TriageAction.QUARANTINE:
        await quarantine_asset(incident_context['asset_context']['id'])
        await isolate_network_segment(incident_context['asset_context']['ip'])
        await create_investigation_ticket(incident_context)

    elif decision.recommended_action == TriageAction.AUTO_REMEDIATE:
        if decision.confidence > 0.9:
            remediation_steps = decision.metrics.get_key_remediation()
            await execute_remediation(remediation_steps, incident_context)
        else:
            await create_investigation_ticket(incident_context)

    elif decision.recommended_action == TriageAction.INVESTIGATE_MANUAL:
        await assign_to_team(decision.suggested_teams[0], incident_context)

    elif decision.recommended_action == TriageAction.MONITOR_ONLY:
        await add_to_monitoring_queue(incident_context)

    elif decision.recommended_action == TriageAction.ARCHIVE:
        await archive_alert(incident_context['alert_id'])
```

### Scenario 4: Attack Chain Playbook Selection

```python
def select_remediation_playbook(correlation_analysis, triage_decision):
    """Select remediation playbook based on attack chain"""

    chains = correlation_analysis.get('attack_chains', [])

    if not chains:
        # Generic playbook
        return 'generic_incident_response'

    chain_type = chains[0]['chain_type']

    playbook_map = {
        'credential_theft_to_exfil': 'exfiltration_containment_playbook',
        'malware_delivery': 'malware_eradication_playbook',
        'ransomware_deployment': 'ransomware_response_playbook',
        'apt_style': 'apt_response_playbook',
        'insider_threat': 'insider_threat_investigation_playbook'
    }

    return playbook_map.get(chain_type, 'generic_incident_response')
```

## API Endpoints

### Triage Alert Endpoint

```
POST /api/alerts/triage

Request:
{
  "alert_id": "alert_123",
  "alert_type": "malware",
  "severity": "critical",
  "source_ip": "192.168.1.100",
  "target_ip": "10.0.0.1",
  "asset_id": "server1",
  "threat_intel": {
    "threat_level_score": 90,
    "threat_level": "critical"
  },
  "asset_context": {
    "criticality": "critical"
  }
}

Response:
{
  "alert_id": "alert_123",
  "priority": "CRITICAL",
  "recommended_action": "ESCALATE_IMMEDIATE",
  "confidence": 0.95,
  "cluster_id": "cluster_001",
  "suggested_teams": ["SOC", "Management"],
  "impact": "Severe - Critical asset compromised",
  "automation_enabled": true,
  "reasoning": [...]
}
```

### Correlation Analysis Endpoint

```
POST /api/alerts/analyze-correlation

Request:
{
  "alert_id": "alert_123",
  "alert": {...},
  "recent_alerts": [...]
}

Response:
{
  "alert_id": "alert_123",
  "related_alerts": [...],
  "attack_chains": [
    {
      "chain_type": "credential_theft_to_exfil",
      "stages": ["initial_compromise", "lateral_movement", "data_exfiltration"],
      "confidence": 0.95,
      "severity": "critical"
    }
  ],
  "root_cause": {
    "root_cause_alert_id": "alert_001",
    "affected_alerts": ["alert_002", "alert_003", "alert_004"],
    "reasoning": "Initial phishing event triggered subsequent alerts"
  },
  "threat_actor": {
    "suspected_motive": "financial",
    "sophistication": "high",
    "observed_tactics": ["phishing", "lateral_movement", "exfiltration"]
  },
  "impact_propagation": {
    "affected_ip_addresses": [...],
    "affected_assets": [...],
    "blast_radius": 6,
    "propagation_rate": "moderate"
  }
}
```

## Configuration

### Environment Variables

```bash
# Triage Engine
TRIAGE_DEDUP_WINDOW_MINUTES=60
TRIAGE_SIMILARITY_THRESHOLD=0.7

# Correlation Engine
CORRELATION_WINDOW_HOURS=24
CORRELATION_CONFIDENCE_THRESHOLD=0.5

# External Services
THREAT_INTEL_API_KEY=...
THREAT_INTEL_API_URL=...
ASSET_DB_CONNECTION=...
```

### Configuration File (config.yaml)

```yaml
triage:
  deduplication:
    enabled: true
    time_window_minutes: 60

  clustering:
    enabled: true
    similarity_threshold: 0.7

  priority_thresholds:
    critical: 70
    high: 55
    medium: 40
    low: 25

correlation:
  window_hours: 24
  attack_chain_detection:
    enabled: true
    confidence_threshold: 0.5
  root_cause_analysis:
    enabled: true
  threat_actor_profiling:
    enabled: true

integrations:
  splunk:
    enabled: true
    webhook_url: /api/splunk/webhook

  soar:
    enabled: true
    api_endpoint: https://soar.company.com
    api_key_env: SOAR_API_KEY
```

## Monitoring and Metrics

### Key Metrics to Track

```python
metrics = {
    'alerts_processed': count,
    'duplicates_removed': count,
    'alerts_clustered': count,
    'attack_chains_detected': count,
    'triage_accuracy': percentage,
    'false_positive_rate': percentage,
    'average_triage_time_ms': duration,
    'automation_rate': percentage,
    'escalation_rate': percentage
}
```

### Health Checks

```python
@app.route('/health', methods=['GET'])
def health_check():
    return {
        'status': 'healthy',
        'triage_engine': 'operational',
        'correlation_engine': 'operational',
        'threat_intel_connection': check_threat_intel(),
        'database_connection': check_db(),
        'memory_usage_mb': get_memory_usage()
    }
```

## Performance Tuning

### Database Optimization

```python
# Index alert_id for fast lookup
CREATE INDEX idx_alert_id ON alerts(alert_id);

# Index timestamp for time-based queries
CREATE INDEX idx_timestamp ON alerts(timestamp);

# Index source_ip and target_ip for correlation
CREATE INDEX idx_ips ON alerts(source_ip, target_ip);

# Index asset_id for asset tracking
CREATE INDEX idx_asset_id ON alerts(asset_id);
```

### Caching Strategy

```python
# Cache threat intel results (1 hour TTL)
cache.set(f'threat_intel:{ip}', result, ttl=3600)

# Cache asset context (12 hours TTL)
cache.set(f'asset:{asset_id}', context, ttl=43200)

# Cache historical patterns (1 day TTL)
cache.set(f'pattern:{alert_type}', data, ttl=86400)
```

## Troubleshooting

### High False Positive Rate

1. Increase similarity threshold: 0.7 → 0.8
2. Review threat intel integration
3. Adjust asset criticality scoring
4. Enable additional context gathering

### Missed Attack Chains

1. Increase correlation window: 24h → 48h
2. Add custom attack patterns
3. Review alert type relationships
4. Enable TTP extraction

### Performance Issues

1. Enable caching for threat intel
2. Implement database indexing
3. Use alert batching (process 100 at a time)
4. Consider distributed processing

## Best Practices

1. **Regular Tuning**: Review metrics weekly and adjust thresholds
2. **Feedback Loop**: Incorporate analyst feedback into learning engine
3. **Testing**: Test with known attack signatures monthly
4. **Documentation**: Keep playbooks updated with new attack patterns
5. **Training**: Ensure SOC team understands triage recommendations
6. **Monitoring**: Set up alerting for system health metrics
7. **Backup**: Maintain alert history for trend analysis

## Support and Feedback

For issues or feature requests:
- Check the validation scripts for reference implementations
- Review integration examples in test files
- Consult the architecture diagrams
- Contact the security team for custom integrations
