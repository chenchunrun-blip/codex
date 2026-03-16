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
OpenTelemetry distributed tracing utilities.

Provides helpers to set up OpenTelemetry tracing across all microservices.
Gracefully degrades to no-op stubs when opentelemetry packages are not
installed, so importing this module never causes failures.

Usage::

    from shared.utils.tracing import setup_tracing, get_tracer, add_tracing_middleware

    # During service startup
    tracer = setup_tracing("my-service")

    # Get a named tracer elsewhere
    tracer = get_tracer("my-service.module")

    # Add tracing middleware to FastAPI app
    add_tracing_middleware(app)

    # Decorate async functions
    @trace_async("my_operation")
    async def do_work():
        ...
"""

from __future__ import annotations

import functools
import logging
import os
from typing import Any, Callable, Optional, TypeVar

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    _OTEL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _OTEL_AVAILABLE = False


# ---------------------------------------------------------------------------
# No-op fallbacks
# ---------------------------------------------------------------------------


class _NoOpSpan:
    """Minimal span-like object used when OpenTelemetry is not installed."""

    def set_attribute(self, key: str, value: Any) -> None:  # noqa: D401
        pass

    def set_status(self, status: Any) -> None:
        pass

    def record_exception(self, exception: BaseException) -> None:
        pass

    def __enter__(self) -> "_NoOpSpan":
        return self

    def __exit__(self, *args: Any) -> None:
        pass


class _NoOpTracer:
    """Minimal tracer-like object used when OpenTelemetry is not installed."""

    def start_as_current_span(self, name: str, **kwargs: Any) -> _NoOpSpan:
        return _NoOpSpan()

    def start_span(self, name: str, **kwargs: Any) -> _NoOpSpan:
        return _NoOpSpan()


_noop_tracer = _NoOpTracer()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def setup_tracing(service_name: str) -> Any:
    """Initialize OpenTelemetry tracing for a service.

    Reads the OTLP exporter endpoint from the ``OTEL_EXPORTER_OTLP_ENDPOINT``
    environment variable (default ``http://otel-collector:4317``).

    Args:
        service_name: Logical name of the service (used as the
            ``service.name`` resource attribute).

    Returns:
        A :class:`opentelemetry.trace.Tracer` instance, or a no-op tracer
        stub when the ``opentelemetry`` packages are not installed.
    """
    if not _OTEL_AVAILABLE:
        logger.warning(
            "opentelemetry packages not installed – tracing disabled. "
            "Install opentelemetry-sdk, opentelemetry-exporter-otlp-proto-grpc "
            "to enable distributed tracing."
        )
        return _noop_tracer

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4317")

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)

    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
    processor = BatchSpanProcessor(exporter)
    provider.add_span_processor(processor)

    trace.set_tracer_provider(provider)

    logger.info(
        "OpenTelemetry tracing initialised for service '%s' " "(exporter endpoint: %s)",
        service_name,
        endpoint,
    )

    return trace.get_tracer(service_name)


def get_tracer(name: str) -> Any:
    """Return a named tracer from the global TracerProvider.

    If OpenTelemetry is not installed a no-op tracer is returned so callers
    can use ``tracer.start_as_current_span(...)`` without guards.

    Args:
        name: Name for the tracer (typically ``__name__`` of the calling
            module).

    Returns:
        A tracer instance.
    """
    if not _OTEL_AVAILABLE:
        return _noop_tracer
    return trace.get_tracer(name)


def add_tracing_middleware(app: Any) -> None:
    """Add OpenTelemetry tracing middleware to a FastAPI application.

    When ``opentelemetry-instrumentation-fastapi`` is installed the official
    instrumentation is used.  Otherwise a lightweight ASGI middleware is
    registered that creates a span per request and records ``http.method``,
    ``http.target``, and ``http.status_code`` attributes.

    Args:
        app: A :class:`fastapi.FastAPI` application instance.
    """
    # Try the official FastAPI instrumentation first.
    try:
        from opentelemetry.instrumentation.fastapi import (  # type: ignore[import-untyped]
            FastAPIInstrumentor,
        )

        FastAPIInstrumentor.instrument_app(app)
        logger.info("OpenTelemetry FastAPI instrumentation enabled.")
        return
    except ImportError:
        pass

    if not _OTEL_AVAILABLE:
        logger.info("OpenTelemetry not installed – skipping tracing middleware.")
        return

    # Fallback: simple ASGI middleware using the core SDK.
    from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore[import-untyped]
    from starlette.requests import Request  # type: ignore[import-untyped]
    from starlette.responses import Response  # type: ignore[import-untyped]

    tracer = trace.get_tracer("fastapi.middleware")

    class _TracingMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable[..., Any]) -> Response:
            span_name = f"{request.method} {request.url.path}"
            with tracer.start_as_current_span(span_name) as span:
                span.set_attribute("http.method", request.method)
                span.set_attribute("http.target", request.url.path)
                try:
                    response: Response = await call_next(request)
                    span.set_attribute("http.status_code", response.status_code)
                    return response
                except Exception as exc:
                    span.record_exception(exc)
                    raise

    app.add_middleware(_TracingMiddleware)
    logger.info("Fallback tracing middleware registered.")


def trace_async(name: str) -> Callable[[F], F]:
    """Decorator that wraps an async function in an OpenTelemetry span.

    The span is named *name* and is automatically closed when the decorated
    coroutine finishes.  If tracing is unavailable the original function is
    returned unchanged.

    Args:
        name: The span name.

    Returns:
        A decorator function.

    Example::

        @trace_async("fetch_alerts")
        async def fetch_alerts(source: str) -> list[dict]:
            ...
    """

    def decorator(func: F) -> F:
        if not _OTEL_AVAILABLE:
            return func

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            tracer = trace.get_tracer(func.__module__)
            with tracer.start_as_current_span(name):
                return await func(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator
