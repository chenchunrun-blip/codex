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
Zhipu AI (GLM) LLM Client for Security Alert Triage
"""

import os
from typing import Any, Dict, List, Optional
import httpx
from loguru import logger


class ZhipuAIClient:
    """Client for Zhipu AI (智谱AI) GLM models."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://open.bigmodel.cn/api/paas/v4/",
        model: str = "glm-4-flash",  # Fast and cost-effective model
    ):
        """
        Initialize Zhipu AI client.

        Args:
            api_key: Zhipu AI API key (format: id.secret)
            base_url: API base URL
            model: Model name (glm-4-flash, glm-4-plus, glm-4-air, etc.)
        """
        self.api_key = api_key or os.getenv("ZHIPUAI_API_KEY")
        if not self.api_key:
            raise ValueError("ZHIPUAI_API_KEY is required")

        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(
            timeout=60.0,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        top_p: float = 0.7,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Send chat completion request to Zhipu AI.

        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature (0.0 to 1.0)
            max_tokens: Maximum tokens to generate
            top_p: Nucleus sampling parameter
            **kwargs: Additional parameters

        Returns:
            Response dict with content and metadata
        """
        try:
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "top_p": top_p,
                **kwargs,
            }

            if max_tokens:
                payload["max_tokens"] = max_tokens

            logger.info(f"Sending request to Zhipu AI: {self.model}")
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"Received response from Zhipu AI")

            return {
                "content": result["choices"][0]["message"]["content"],
                "model": result["model"],
                "usage": result.get("usage", {}),
                "finish_reason": result["choices"][0].get("finish_reason"),
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"Zhipu AI API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.exception(f"Error calling Zhipu AI: {e}")
            raise

    async def analyze_alert(
        self,
        alert_data: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Analyze a security alert using Zhipu AI.

        Args:
            alert_data: Alert data including title, description, severity, etc.
            context: Additional context (threat intel, asset info, etc.)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate

        Returns:
            Analysis result with risk assessment and recommendations
        """
        import json

        system_prompt = """你是一个专业的安全告警分析助手。你的任务是分析安全告警，评估风险，并提供处理建议。

请按照以下JSON格式返回分析结果：
{
  "risk_score": <0-100的整数风险评分>,
  "risk_level": "<critical/high/medium/low/info>",
  "confidence": <0-100的置信度>,
  "summary": "<告警摘要>",
  "analysis": "<详细分析>",
  "threat_indicators": ["<威胁指标列表>"],
  "recommended_actions": ["<建议行动列表>"],
  "priority": "<critical/high/medium/low>"
}

风险评分标准：
- 90-100: Critical - 需要立即处理
- 70-89: High - 需要尽快处理
- 40-69: Medium - 需要关注
- 20-39: Low - 需要监控
- 0-19: Info - 信息性

请用中文回答。"""

        user_message = f"""请分析以下安全告警：

告警标题: {alert_data.get('title', 'N/A')}
告警描述: {alert_data.get('description', 'N/A')}
严重程度: {alert_data.get('severity', 'N/A')}
告警类型: {alert_data.get('type', 'N/A')}
来源: {alert_data.get('source', 'N/A')}
目标: {alert_data.get('target', 'N/A')}

"""

        if context:
            user_message += f"\n上下文信息:\n{context}\n"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        try:
            result = await self.chat(messages, temperature=temperature, max_tokens=max_tokens)

            content = result["content"].strip()

            # Try to extract JSON from the response
            if "```json" in content:
                json_start = content.find("```json") + 7
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            elif "```" in content:
                json_start = content.find("```") + 3
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            else:
                json_str = content

            analysis = json.loads(json_str)

            return {
                "alert_id": alert_data.get("id"),
                "analysis": analysis,
                "model": result["model"],
                "usage": result["usage"],
            }

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            return {
                "alert_id": alert_data.get("id"),
                "error": "Failed to parse AI response",
                "raw_content": result.get("content", ""),
            }
        except Exception as e:
            logger.exception(f"Error analyzing alert: {e}")
            raise

    async def batch_analyze_alerts(
        self,
        alerts: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Analyze multiple alerts in batch.

        Args:
            alerts: List of alert data

        Returns:
            List of analysis results
        """
        results = []
        for alert in alerts:
            try:
                result = await self.analyze_alert(alert)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to analyze alert {alert.get('id')}: {e}")
                results.append({
                    "alert_id": alert.get("id"),
                    "error": str(e),
                })

        return results


# Global client instance
_zhipu_client: Optional[ZhipuAIClient] = None


def get_zhipu_client() -> ZhipuAIClient:
    """Get or create global Zhipu AI client instance."""
    global _zhipu_client
    if _zhipu_client is None:
        _zhipu_client = ZhipuAIClient()
    return _zhipu_client


class DeepSeekClient:
    """Client for DeepSeek models."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.deepseek.com/v1",
        model: str = "deepseek-v3",
    ):
        """Initialize DeepSeek client."""
        if not api_key:
            raise ValueError("API key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(
            timeout=60.0,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        top_p: float = 0.7,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send chat completion request to DeepSeek."""
        try:
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "top_p": top_p,
                **kwargs,
            }

            if max_tokens:
                payload["max_tokens"] = max_tokens

            logger.info(f"Sending request to DeepSeek: {self.model}")
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"Received response from DeepSeek")

            return {
                "content": result["choices"][0]["message"]["content"],
                "model": result["model"],
                "usage": result.get("usage", {}),
                "finish_reason": result["choices"][0].get("finish_reason"),
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"DeepSeek API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.exception(f"Error calling DeepSeek: {e}")
            raise

    async def analyze_alert(
        self,
        alert_data: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Analyze a security alert using DeepSeek."""
        import json

        system_prompt = """你是一个专业的安全告警分析助手。你的任务是分析安全告警，评估风险，并提供处理建议。

请按照以下JSON格式返回分析结果：
{
  "risk_score": <0-100的整数风险评分>,
  "risk_level": "<critical/high/medium/low/info>",
  "confidence": <0-100的置信度>,
  "summary": "<告警摘要>",
  "analysis": "<详细分析>",
  "threat_indicators": ["<威胁指标列表>"],
  "recommended_actions": ["<建议行动列表>"],
  "priority": "<critical/high/medium/low>"
}

请用中文回答。"""

        user_message = f"""请分析以下安全告警：

告警标题: {alert_data.get('title', 'N/A')}
告警描述: {alert_data.get('description', 'N/A')}
严重程度: {alert_data.get('severity', 'N/A')}
告警类型: {alert_data.get('type', 'N/A')}
来源: {alert_data.get('source', 'N/A')}
目标: {alert_data.get('target', 'N/A')}
"""

        if context:
            user_message += f"\n上下文信息:\n{context}\n"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        try:
            result = await self.chat(messages, temperature=temperature, max_tokens=max_tokens)
            content = result["content"].strip()

            if "```json" in content:
                json_start = content.find("```json") + 7
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            elif "```" in content:
                json_start = content.find("```") + 3
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            else:
                json_str = content

            analysis = json.loads(json_str)

            return {
                "alert_id": alert_data.get("id"),
                "analysis": analysis,
                "model": result["model"],
                "usage": result["usage"],
            }

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            return {
                "alert_id": alert_data.get("id"),
                "error": "Failed to parse AI response",
                "raw_content": result.get("content", ""),
            }
        except Exception as e:
            logger.exception(f"Error analyzing alert: {e}")
            raise


class QwenClient:
    """Client for Qwen (通义千问) models."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: str = "qwen3-max",
    ):
        """Initialize Qwen client."""
        if not api_key:
            raise ValueError("API key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(
            timeout=60.0,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        top_p: float = 0.7,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send chat completion request to Qwen."""
        try:
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "top_p": top_p,
                **kwargs,
            }

            if max_tokens:
                payload["max_tokens"] = max_tokens

            logger.info(f"Sending request to Qwen: {self.model}")
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"Received response from Qwen")

            return {
                "content": result["choices"][0]["message"]["content"],
                "model": result["model"],
                "usage": result.get("usage", {}),
                "finish_reason": result["choices"][0].get("finish_reason"),
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"Qwen API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.exception(f"Error calling Qwen: {e}")
            raise

    async def analyze_alert(
        self,
        alert_data: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Analyze a security alert using Qwen."""
        import json

        system_prompt = """你是一个专业的安全告警分析助手。你的任务是分析安全告警，评估风险，并提供处理建议。

请按照以下JSON格式返回分析结果：
{
  "risk_score": <0-100的整数风险评分>,
  "risk_level": "<critical/high/medium/low/info>",
  "confidence": <0-100的置信度>,
  "summary": "<告警摘要>",
  "analysis": "<详细分析>",
  "threat_indicators": ["<威胁指标列表>"],
  "recommended_actions": ["<建议行动列表>"],
  "priority": "<critical/high/medium/low>"
}

请用中文回答。"""

        user_message = f"""请分析以下安全告警：

告警标题: {alert_data.get('title', 'N/A')}
告警描述: {alert_data.get('description', 'N/A')}
严重程度: {alert_data.get('severity', 'N/A')}
告警类型: {alert_data.get('type', 'N/A')}
来源: {alert_data.get('source', 'N/A')}
目标: {alert_data.get('target', 'N/A')}
"""

        if context:
            user_message += f"\n上下文信息:\n{context}\n"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        try:
            result = await self.chat(messages, temperature=temperature, max_tokens=max_tokens)
            content = result["content"].strip()

            if "```json" in content:
                json_start = content.find("```json") + 7
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            elif "```" in content:
                json_start = content.find("```") + 3
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            else:
                json_str = content

            analysis = json.loads(json_str)

            return {
                "alert_id": alert_data.get("id"),
                "analysis": analysis,
                "model": result["model"],
                "usage": result["usage"],
            }

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            return {
                "alert_id": alert_data.get("id"),
                "error": "Failed to parse AI response",
                "raw_content": result.get("content", ""),
            }
        except Exception as e:
            logger.exception(f"Error analyzing alert: {e}")
            raise


class OpenAIClient:
    """Client for OpenAI models."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4-turbo",
    ):
        """Initialize OpenAI client."""
        if not api_key:
            raise ValueError("API key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(
            timeout=60.0,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        top_p: float = 0.7,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send chat completion request to OpenAI."""
        try:
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "top_p": top_p,
                **kwargs,
            }

            if max_tokens:
                payload["max_tokens"] = max_tokens

            logger.info(f"Sending request to OpenAI: {self.model}")
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"Received response from OpenAI")

            return {
                "content": result["choices"][0]["message"]["content"],
                "model": result["model"],
                "usage": result.get("usage", {}),
                "finish_reason": result["choices"][0].get("finish_reason"),
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.exception(f"Error calling OpenAI: {e}")
            raise

    async def analyze_alert(
        self,
        alert_data: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Analyze a security alert using OpenAI."""
        import json

        system_prompt = """You are a professional security alert analysis assistant. Your task is to analyze security alerts, assess risks, and provide handling recommendations.

Please return the analysis result in the following JSON format:
{
  "risk_score": <integer risk score 0-100>,
  "risk_level": "<critical/high/medium/low/info>",
  "confidence": <confidence score 0-100>,
  "summary": "<alert summary>",
  "analysis": "<detailed analysis>",
  "threat_indicators": ["<threat indicator list>"],
  "recommended_actions": ["<recommended action list>"],
  "priority": "<critical/high/medium/low>"
}

Risk score standards:
- 90-100: Critical - requires immediate action
- 70-89: High - requires urgent action
- 40-69: Medium - requires attention
- 20-39: Low - requires monitoring
- 0-19: Info - informational

Please respond in Chinese."""

        user_message = f"""Please analyze the following security alert:

Alert Title: {alert_data.get('title', 'N/A')}
Alert Description: {alert_data.get('description', 'N/A')}
Severity: {alert_data.get('severity', 'N/A')}
Alert Type: {alert_data.get('type', 'N/A')}
Source: {alert_data.get('source', 'N/A')}
Target: {alert_data.get('target', 'N/A')}
"""

        if context:
            user_message += f"\nContext Information:\n{context}\n"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        try:
            result = await self.chat(messages, temperature=temperature, max_tokens=max_tokens)
            content = result["content"].strip()

            if "```json" in content:
                json_start = content.find("```json") + 7
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            elif "```" in content:
                json_start = content.find("```") + 3
                json_end = content.find("```", json_start)
                json_str = content[json_start:json_end].strip()
            else:
                json_str = content

            analysis = json.loads(json_str)

            return {
                "alert_id": alert_data.get("id"),
                "analysis": analysis,
                "model": result["model"],
                "usage": result["usage"],
            }

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            return {
                "alert_id": alert_data.get("id"),
                "error": "Failed to parse AI response",
                "raw_content": result.get("content", ""),
            }
        except Exception as e:
            logger.exception(f"Error analyzing alert: {e}")
            raise

