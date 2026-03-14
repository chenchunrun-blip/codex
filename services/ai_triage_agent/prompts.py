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

"""
LLM prompt templates for AI Triage Agent.

Provides structured prompts for different alert types and analysis scenarios.
"""

from typing import Any, Dict, List, Optional

from shared.models.alert import AlertType
from shared.utils.logger import get_logger

logger = get_logger(__name__)


def _escape_prompt_braces(text: str) -> str:
    """Escape braces in prompt JSON examples while preserving format placeholders."""
    # Escape all braces first
    result = text.replace('{', '{{').replace('}', '}}')
    # Unescape the placeholders we need
    placeholders = ['alert_details', 'threat_intel', 'network_context',
                   'asset_context', 'user_context', 'historical_context']
    for ph in placeholders:
        result = result.replace('{{' + ph + '}}', '{' + ph + '}')
    return result

class PromptTemplates:
    """Prompt templates for LLM-based alert analysis."""

    # System prompt for triage agent
    SYSTEM_PROMPT = """You are an expert cybersecurity analyst and incident responder with 15+ years of experience.
Your task is to analyze security alerts and provide comprehensive triage assessments.

You must respond ONLY in valid JSON format, with no additional text or explanation.
Your response must be parseable as JSON immediately.

Focus on:
- Accurate risk assessment based on available data
- Actionable and prioritized recommendations
- Clear justification for your conclusions
- Consideration of business impact and technical feasibility"""

    # Alert-specific prompts (with JSON braces escaped)
    MALWARE_ANALYSIS_PROMPT = _escape_prompt_braces("""Analyze this malware-related security alert and provide a comprehensive triage assessment.

ALERT DETAILS:
{alert_details}

THREAT INTELLIGENCE:
{threat_intel}

NETWORK CONTEXT:
{network_context}

ASSET CONTEXT:
{asset_context}

USER CONTEXT:
{user_context}

HISTORICAL PATTERNS:
{historical_context}

Provide your analysis in the following JSON format:
{
  "risk_assessment": {
    "risk_level": "critical|high|medium|low|info",
    "confidence": 0-100,
    "reasoning": "Detailed explanation of your analysis in 3-5 sentences"
  },
  "malware_analysis": {
    "malware_type": "Type of malware (e.g., trojan, ransomware, spyware)",
    "severity": "Estimated severity of this malware",
    "capabilities": ["List of observed or suspected capabilities"],
    "indicators_of_compromise": [
      {"type": "ip|hash|url|domain", "value": "IOC value", "confidence": "high|medium|low"}
    ]
  },
  "impact_assessment": {
    "technical_impact": "Technical impact on systems and data",
    "business_impact": "Business impact description",
    "affected_assets": ["List of affected assets"],
    "affected_users": "Number or description of affected users",
    "data_at_risk": "Description of data at risk"
  },
  "recommended_actions": [
    {
      "action": "Specific action to take",
      "priority": "critical|high|medium|low",
      "type": "containment|investigation|remediation|prevention",
      "urgency": "immediate|within_1_hour|within_4_hours|within_24_hours",
      "estimated_duration": "Estimated time to complete",
      "responsible_team": "SOC|IT|Management|Legal/Compliance"
    }
  ],
  "investigation_steps": [
    "Step 1: Specific investigation action",
    "Step 2: Follow-up action",
    "Step 3: Verification step"
  ],
  "related_iocs": {
    "ips": ["List of related IP addresses"],
    "hashes": ["List of related file hashes"],
    "urls": ["List of related URLs"],
    "domains": ["List of related domains"]
  },
  "requires_human_review": true/false,
  "escalation_trigger": "Condition that should trigger escalation",
  "additional_notes": "Any other relevant information"
}""")

    PHISHING_ANALYSIS_PROMPT = _escape_prompt_braces("""Analyze this phishing-related security alert and provide a comprehensive triage assessment.

ALERT DETAILS:
{alert_details}

THREAT INTELLIGENCE:
{threat_intel}

NETWORK CONTEXT:
{network_context}

USER CONTEXT:
{user_context}

HISTORICAL PATTERNS:
{historical_context}

Provide your analysis in the following JSON format:
{
  "risk_assessment": {
    "risk_level": "critical|high|medium|low|info",
    "confidence": 0-100,
    "reasoning": "Detailed explanation of your analysis"
  },
  "phishing_analysis": {
    "phishing_type": "email|credential_harvesting|spear_phishing|whaling|vishing",
    "target_audience": "Description of who is being targeted",
    "sophistication_level": "low|medium|high",
    "brand_impersonation": "Brand being impersonated if any",
    "social_engineering_techniques": ["List of techniques used"]
  },
  "impact_assessment": {
    "potential_victims": "Number or description of potential victims",
    "data_at_risk": "Type of data being targeted",
    "organizational_exposure": "Description of organizational exposure"
  },
  "recommended_actions": [
    {
      "action": "Specific action to take",
      "priority": "critical|high|medium|low",
      "type": "containment|investigation|remediation|prevention",
      "urgency": "immediate|within_1_hour|within_4_hours|within_24_hours",
      "responsible_team": "SOC|IT|Communications|Management"
    }
  ],
  "containment_measures": [
    "Specific containment measure 1",
    "Specific containment measure 2"
  ],
  "communication_plan": {
    "notify_users": true/false,
    "security_awareness": "Recommended awareness actions",
    "stakeholders_to_notify": ["List of stakeholders"]
  },
  "requires_human_review": true/false,
  "escalation_trigger": "Condition triggering escalation",
  "additional_notes": "Any other relevant information"
}""")

    BRUTE_FORCE_ANALYSIS_PROMPT = _escape_prompt_braces("""Analyze this brute force authentication attack alert and provide a comprehensive triage assessment.

ALERT DETAILS:
{alert_details}

THREAT INTELLIGENCE:
{threat_intel}

NETWORK CONTEXT:
{network_context}

USER CONTEXT:
{user_context}

HISTORICAL PATTERNS:
{historical_context}

Provide your analysis in the following JSON format:
{
  "risk_assessment": {
    "risk_level": "critical|high|medium|low|info",
    "confidence": 0-100,
    "reasoning": "Detailed explanation of your analysis"
  },
  "attack_analysis": {
    "attack_type": "credential_stuffing|password_spraying|dictionary_attack|rainbow_table",
    "attack_volume": "low|medium|high",
    "attack_duration": "Estimated duration if ongoing",
    "success_rate": "Estimated success rate of attempts",
    "source_analysis": "Analysis of attack source(s)"
  },
  "impact_assessment": {
    "compromised_accounts": "Estimated number of compromised accounts",
    "privilege_escalation_risk": "Assessment of privilege escalation risk",
    "lateral_movement_risk": "Assessment of lateral movement risk",
    "affected_systems": ["List of affected systems"]
  },
  "recommended_actions": [
    {
      "action": "Specific action to take",
      "priority": "critical|high|medium|low",
      "type": "containment|investigation|remediation|prevention",
      "urgency": "immediate|within_1_hour|within_4_hours|within_24_hours",
      "responsible_team": "SOC|IT|IAM|Management"
    }
  ],
  "containment_actions": [
    "Immediate containment action 1",
    "Follow-up action 2"
  ],
  "investigation_steps": [
    "Investigation step 1",
    "Investigation step 2"
  ],
  "prevention_recommendations": [
    "Prevention measure 1",
    "Prevention measure 2"
  ],
  "requires_human_review": true/false,
  "escalation_trigger": "Condition triggering escalation",
  "additional_notes": "Any other relevant information"
}""")

    DATA_EXFILTRATION_ANALYSIS_PROMPT = _escape_prompt_braces("""Analyze this data exfiltration alert and provide a comprehensive triage assessment.

ALERT DETAILS:
{alert_details}

THREAT INTELLIGENCE:
{threat_intel}

NETWORK CONTEXT:
{network_context}

ASSET CONTEXT:
{asset_context}

USER CONTEXT:
{user_context}

HISTORICAL PATTERNS:
{historical_context}

Provide your analysis in the following JSON format:
{
  "risk_assessment": {
    "risk_level": "critical|high|medium|low|info",
    "confidence": 0-100,
    "reasoning": "Detailed explanation of your analysis"
  },
  "exfiltration_analysis": {
    "method": "dns_tunneling|stego|encrypted_upload|cloud_storage|removable_media",
    "data_classification": "public|internal|confidential|secret|top_secret",
    "estimated_volume": "small|medium|large|unknown",
    "destination": "Analysis of data destination",
    "duration": "Estimated duration of exfiltration"
  },
  "impact_assessment": {
    "sensitivity_of_data": "Assessment of data sensitivity",
    "compliance_implications": ["GDPR|HIPAA|PCI_DSS|SOX|other"],
    "business_impact": "Description of business impact",
    "affected_parties": ["List of affected parties (customers, partners, etc.)"]
  },
  "recommended_actions": [
    {
      "action": "Specific action to take",
      "priority": "critical|high|medium|low",
      "type": "containment|investigation|remediation|prevention",
      "urgency": "immediate|within_1_hour|within_4_hours|within_24_hours",
      "responsible_team": "SOC|IT|Legal|PR|Management"
    }
  ],
  "containment_actions": [
    "Immediate containment action 1",
    "Critical containment action 2"
  ],
  "investigation_priorities": [
    "Investigation priority 1",
    "Investigation priority 2"
  ],
  "notification_requirements": {
    "legal_required": true/false,
    "regulatory_bodies": ["List of bodies to notify if applicable"],
    "affected_individuals": true/false,
    "timeline": "Notification timeline requirements"
  },
  "requires_human_review": true/false,
  "escalation_trigger": "Always escalate for data exfiltration",
  "additional_notes": "Any other relevant information"
}""")

    GENERAL_ANALYSIS_PROMPT = _escape_prompt_braces("""Analyze this security alert and provide a comprehensive triage assessment.

ALERT DETAILS:
{alert_details}

THREAT INTELLIGENCE:
{threat_intel}

NETWORK CONTEXT:
{network_context}

ASSET CONTEXT:
{asset_context}

USER CONTEXT:
{user_context}

HISTORICAL PATTERNS:
{historical_context}

Provide your analysis in the following JSON format:
{
  "risk_assessment": {
    "risk_level": "critical|high|medium|low|info",
    "confidence": 0-100,
    "reasoning": "Detailed explanation of your analysis"
  },
  "analysis_summary": "Brief 2-3 sentence summary of the alert",
  "impact_assessment": "Description of potential impact",
  "recommended_actions": [
    {
      "action": "Specific action to take",
      "priority": "critical|high|medium|low",
      "type": "containment|investigation|remediation|prevention",
      "urgency": "immediate|within_1_hour|within_4_hours|within_24_hours",
      "responsible_team": "SOC|IT|Management"
    }
  ],
  "investigation_steps": [
    "Investigation step 1",
    "Investigation step 2"
  ],
  "requires_human_review": true/false,
  "escalation_trigger": "Condition triggering escalation",
  "additional_notes": "Any other relevant information"
}""")

    @classmethod
    def get_prompt_for_alert_type(cls, alert_type: str, **kwargs) -> str:
        """
        Get appropriate prompt template for alert type.

        Args:
            alert_type: Type of alert
            **kwargs: Additional context variables

        Returns:
            Formatted prompt string
        """
        # Normalize alert type
        try:
            alert_enum = AlertType(alert_type.lower())
        except ValueError:
            alert_enum = AlertType.OTHER

        # Select base prompt
        if alert_enum == AlertType.MALWARE:
            base_prompt = cls.MALWARE_ANALYSIS_PROMPT
        elif alert_enum == AlertType.PHISHING:
            base_prompt = cls.PHISHING_ANALYSIS_PROMPT
        elif alert_enum == AlertType.BRUTE_FORCE:
            base_prompt = cls.BRUTE_FORCE_ANALYSIS_PROMPT
        elif alert_enum == AlertType.DATA_EXFILTRATION:
            base_prompt = cls.DATA_EXFILTRATION_ANALYSIS_PROMPT
        else:
            base_prompt = cls.GENERAL_ANALYSIS_PROMPT

        # Format prompt with context
        try:
            formatted_prompt = base_prompt.format(**kwargs)
            return formatted_prompt
        except KeyError as e:
            logger.error(f"Missing context variable for prompt: {e}")
            # Return prompt with missing variables
            return base_prompt

    @classmethod
    def format_context(
        cls,
        alert: Dict[str, Any],
        threat_intel: Optional[Dict] = None,
        network_context: Optional[Dict] = None,
        asset_context: Optional[Dict] = None,
        user_context: Optional[Dict] = None,
        historical_context: Optional[Dict] = None,
    ) -> Dict[str, str]:
        """
        Format all context into prompt-ready strings.

        Args:
            alert: Alert data
            threat_intel: Threat intelligence results
            network_context: Network context
            asset_context: Asset context
            user_context: User context
            historical_context: Historical patterns

        Returns:
            Dictionary with formatted context strings
        """
        return {
            "alert_details": cls._format_alert_details(alert),
            "threat_intel": cls._format_threat_intel(threat_intel),
            "network_context": cls._format_network_context(network_context),
            "asset_context": cls._format_asset_context(asset_context),
            "user_context": cls._format_user_context(user_context),
            "historical_context": cls._format_historical_context(historical_context),
        }

    @staticmethod
    def _format_alert_details(alert: Dict) -> str:
        """Format alert details for prompt."""
        details = [
            f"Alert ID: {alert.get('alert_id', 'N/A')}",
            f"Type: {alert.get('alert_type', 'N/A')}",
            f"Severity: {alert.get('severity', 'N/A')}",
            f"Title: {alert.get('title', alert.get('description', 'N/A'))}",
        ]

        if alert.get('source_ip'):
            details.append(f"Source IP: {alert['source_ip']}")
        if alert.get('target_ip'):
            details.append(f"Target IP: {alert['target_ip']}")
        if alert.get('file_hash'):
            details.append(f"File Hash: {alert['file_hash']}")
        if alert.get('url'):
            details.append(f"URL: {alert['url']}")

        return "\n".join(details)

    @staticmethod
    def _format_threat_intel(threat_intel: Optional[Dict]) -> str:
        """Format threat intelligence for prompt."""
        if not threat_intel:
            return "No threat intelligence data available"

        lines = [
            f"Aggregate Score: {threat_intel.get('aggregate_score', 'N/A')}",
            f"Threat Level: {threat_intel.get('threat_level', 'N/A')}",
            f"Sources Queried: {', '.join(threat_intel.get('queried_sources', []))}",
        ]

        detections = threat_intel.get('detections', [])
        if detections:
            lines.append("\nDetections:")
            for detection in detections[:5]:
                lines.append(f"  - {detection.get('source', 'N/A')}: {detection.get('detection_rate', 0)}% detection rate")

        return "\n".join(lines)

    @staticmethod
    def _format_network_context(network_context: Optional[Dict]) -> str:
        """Format network context for prompt."""
        if not network_context:
            return "No network context available"

        lines = []
        if network_context.get('is_internal'):
            lines.append("Internal IP address")
        else:
            lines.append("External IP address")

        if network_context.get('geolocation'):
            geo = network_context['geolocation']
            lines.append(f"Location: {geo.get('country', 'N/A')}")

        reputation = network_context.get('reputation', {})
        if reputation:
            lines.append(f"Reputation Score: {reputation.get('score', 'N/A')}")

        return "\n".join(lines) if lines else "No additional network details"

    @staticmethod
    def _format_asset_context(asset_context: Optional[Dict]) -> str:
        """Format asset context for prompt."""
        if not asset_context:
            return "No asset context available"

        lines = [
            f"Asset: {asset_context.get('name', 'N/A')}",
            f"Type: {asset_context.get('type', 'N/A')}",
            f"Criticality: {asset_context.get('criticality', 'N/A')}",
        ]

        if asset_context.get('owner'):
            lines.append(f"Owner: {asset_context['owner']}")

        return "\n".join(lines)

    @staticmethod
    def _format_user_context(user_context: Optional[Dict]) -> str:
        """Format user context for prompt."""
        if not user_context:
            return "No user context available"

        lines = [
            f"User: {user_context.get('username', user_context.get('email', 'N/A'))}",
        ]

        if user_context.get('department'):
            lines.append(f"Department: {user_context['department']}")
        if user_context.get('title'):
            lines.append(f"Title: {user_context['title']}")

        return "\n".join(lines) if lines else "No additional user details"

    @staticmethod
    def _format_historical_context(historical_context: Optional[Dict]) -> str:
        """Format historical patterns for prompt."""
        if not historical_context:
            return "No historical patterns available"

        similar_count = len(historical_context.get('similar_alerts', []))
        if similar_count > 0:
            return f"Found {similar_count} similar alerts in the past 30 days"
        else:
            return "No similar historical alerts found"
