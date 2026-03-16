"""Unit tests for LLM Router service - routing logic, model selection, mock responses."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.models import (
    LLMModel,
    LLMProvider,
    LLMRequest,
    ModelCapabilities,
    TaskType,
)

# ---------------------------------------------------------------------------
# Model Capabilities Registry
# ---------------------------------------------------------------------------


class TestModelCapabilities:
    """Test model capabilities registry."""

    def test_all_models_registered(self):
        from services.llm_router.main import MODEL_CAPABILITIES

        assert LLMModel.DEEPSEEK_V3 in MODEL_CAPABILITIES
        assert LLMModel.DEEPSEEK_CODER in MODEL_CAPABILITIES
        assert LLMModel.QWEN3_MAX in MODEL_CAPABILITIES
        assert LLMModel.QWEN3_PLUS in MODEL_CAPABILITIES
        assert LLMModel.QWEN3_TURBO in MODEL_CAPABILITIES

    def test_deepseek_v3_best_for_triage(self):
        from services.llm_router.main import MODEL_CAPABILITIES

        caps = MODEL_CAPABILITIES[LLMModel.DEEPSEEK_V3]
        assert TaskType.TRIAGE in caps.best_for
        assert TaskType.ANALYSIS in caps.best_for

    def test_qwen3_turbo_is_fastest(self):
        from services.llm_router.main import MODEL_CAPABILITIES

        turbo = MODEL_CAPABILITIES[LLMModel.QWEN3_TURBO]
        for model, caps in MODEL_CAPABILITIES.items():
            if model != LLMModel.QWEN3_TURBO:
                assert turbo.speed >= caps.speed

    def test_qwen3_max_highest_reasoning(self):
        from services.llm_router.main import MODEL_CAPABILITIES

        qmax = MODEL_CAPABILITIES[LLMModel.QWEN3_MAX]
        for model, caps in MODEL_CAPABILITIES.items():
            if model != LLMModel.QWEN3_MAX:
                assert qmax.reasoning_quality >= caps.reasoning_quality

    def test_all_models_have_context_limit(self):
        from services.llm_router.main import MODEL_CAPABILITIES

        for model, caps in MODEL_CAPABILITIES.items():
            assert caps.max_context > 0
            assert caps.cost_per_1k_tokens >= 0


# ---------------------------------------------------------------------------
# Request Routing Logic
# ---------------------------------------------------------------------------


class TestRouteRequest:
    """Test the route_request function."""

    def test_user_specified_model(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "test"}],
            task_type=TaskType.TRIAGE,
            model=LLMModel.DEEPSEEK_V3,
        )

        decision = route_request(request)

        assert decision.selected_model == LLMModel.DEEPSEEK_V3
        assert decision.selected_provider == LLMProvider.DEEPSEEK
        assert decision.confidence == 1.0
        assert "User specified" in decision.reason

    def test_triage_task_routes_to_best_model(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "Analyze this security alert"}],
            task_type=TaskType.TRIAGE,
        )

        decision = route_request(request)

        # Should route to a model that supports TRIAGE
        from services.llm_router.main import MODEL_CAPABILITIES

        caps = MODEL_CAPABILITIES[decision.selected_model]
        assert TaskType.TRIAGE in caps.best_for

    def test_classification_task_routing(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "Classify this alert"}],
            task_type=TaskType.CLASSIFICATION,
        )

        decision = route_request(request)

        from services.llm_router.main import MODEL_CAPABILITIES

        caps = MODEL_CAPABILITIES[decision.selected_model]
        assert TaskType.CLASSIFICATION in caps.best_for

    def test_general_task_has_fallback(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "Hello"}],
            task_type=TaskType.GENERAL,
        )

        decision = route_request(request)
        assert decision.selected_model is not None
        assert decision.confidence > 0

    def test_deepseek_model_routes_to_deepseek_provider(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "test"}],
            model=LLMModel.DEEPSEEK_V3,
        )

        decision = route_request(request)
        assert decision.selected_provider == LLMProvider.DEEPSEEK

    def test_qwen_model_routes_to_qwen_provider(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "test"}],
            model=LLMModel.QWEN3_PLUS,
        )

        decision = route_request(request)
        assert decision.selected_provider == LLMProvider.QWEN

    def test_alternatives_provided(self):
        from services.llm_router.main import route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "test"}],
            task_type=TaskType.TRIAGE,
        )

        decision = route_request(request)

        # Alternatives should not include the selected model
        assert decision.selected_model not in decision.alternatives

    def test_large_context_skips_small_models(self):
        """Very long input should skip models with small context windows."""
        from services.llm_router.main import route_request

        # Generate a long message that exceeds 8k tokens (~32k chars)
        long_content = "x" * 40000

        request = LLMRequest(
            messages=[{"role": "user", "content": long_content}],
            task_type=TaskType.TRIAGE,
        )

        decision = route_request(request)

        from services.llm_router.main import MODEL_CAPABILITIES

        # Estimated tokens = 40000 / 4 = 10000, which exceeds Qwen3-Turbo's 8000
        caps = MODEL_CAPABILITIES[decision.selected_model]
        assert caps.max_context >= 10000


# ---------------------------------------------------------------------------
# Mock Response Generation
# ---------------------------------------------------------------------------


class TestMockResponse:
    """Test mock response generation for dev/testing."""

    def test_mock_response_structure(self):
        from services.llm_router.main import create_mock_response, route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "test"}],
            task_type=TaskType.TRIAGE,
        )

        decision = route_request(request)
        response = create_mock_response(request, decision)

        assert response.id.startswith("mock-")
        assert response.object == "chat.completion"
        assert len(response.choices) == 1
        assert response.choices[0].message.role == "assistant"
        assert response.choices[0].finish_reason == "stop"
        assert response.usage.total_tokens == 250

    def test_mock_response_contains_model_info(self):
        from services.llm_router.main import create_mock_response, route_request

        request = LLMRequest(
            messages=[{"role": "user", "content": "test"}],
            task_type=TaskType.ANALYSIS,
        )

        decision = route_request(request)
        response = create_mock_response(request, decision)

        content = response.choices[0].message.content
        assert decision.selected_model.value in content
        assert decision.selected_provider.value in content


# ---------------------------------------------------------------------------
# Provider Endpoints
# ---------------------------------------------------------------------------


class TestProviderEndpoints:
    """Test provider endpoint configuration."""

    def test_deepseek_endpoint(self):
        from services.llm_router.main import PROVIDER_ENDPOINTS

        assert "deepseek" in PROVIDER_ENDPOINTS[LLMProvider.DEEPSEEK]

    def test_qwen_endpoint(self):
        from services.llm_router.main import PROVIDER_ENDPOINTS

        assert "dashscope" in PROVIDER_ENDPOINTS[LLMProvider.QWEN]
