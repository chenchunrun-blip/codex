# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains both a **working prototype** and **production architecture design** for an AI-powered Security Alert Triage System. The system uses LangChain agents with LLMs (OpenAI-compatible APIs, including private MaaS like DeepSeek-V3 and Qwen3) to analyze security alerts, assess risks, query threat intelligence, and generate remediation recommendations.

### Two-Phase Architecture

**Phase 1: Current Prototype** (Single-node prototype in `/src/`)
- Agent-based system with LangChain tools for context collection, threat intelligence, and risk assessment
- Mock data implementations for testing and validation
- Single-alert and batch processing via CLI
- Ideal for understanding AI agent workflows and LangChain patterns

**Phase 2: Production System** (Microservices architecture in `/docs/`)
- 15 microservices with async message-driven communication (RabbitMQ)
- Private MaaS integration (DeepSeek-V3 + Qwen3) with intelligent routing
- Vector similarity search with ChromaDB for historical alert matching
- Multi-level caching (Redis), temporal workflows, and comprehensive monitoring
- See `/docs/README.md` for complete architecture documentation

---

## Essential Commands

### Prototype Commands (Current System)

```bash
# Setup
pip install -r requirements.txt
cp .env.example .env
# Edit .env with LLM_API_KEY and LLM_BASE_URL

# Run prototype
python main.py --sample                    # Process 4 sample alerts
python main.py --interactive               # Interactive mode
python main.py --file data/sample_alerts.json  # Batch processing
python main.py --alert '{...}'             # Single alert JSON

# Testing
python3 test_api.py                        # Test API connection
python3 test_system.py                     # Test without API
pytest tests/                              # Unit tests (when implemented)
```

### LLM Configuration

**Supports any OpenAI-compatible API** via `.env`:

```bash
# For 通义千问 Qwen (recommended for China)
LLM_API_KEY=sk-your-qwen-key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# For OpenAI
LLM_API_KEY=sk-your-openai-key
LLM_BASE_URL=

# For private MaaS (production)
LLM_API_KEY=internal-key-123
LLM_BASE_URL=http://internal-maas.deepseek/v1  # or qwen
```

Model selection in `config/config.yaml`:
```yaml
llm:
  model: "qwen-plus"  # or "gpt-4", "deepseek-chat", etc.
  temperature: 0.0
```

**Production MaaS Routing** (designed for private deployment):
- DeepSeek-V3: Complex analysis (deep reasoning)
- Qwen3: Fast response (general analysis)
- Automatic routing based on task complexity

---

## Prototype Architecture (Current Code)

### Directory Structure

```
src/
├── agents/
│   └── triage_agent.py          # Main SecurityAlertTriageAgent
├── tools/
│   ├── context_tools.py         # Network/Asset/User context collection
│   ├── threat_intel_tools.py    # IOC queries, CVE checks, malware analysis
│   └── risk_assessment_tools.py # Risk scoring, impact assessment, containment
├── models/
│   └── alert.py                  # SecurityAlert, TriageResult, RiskAssessment models
└── utils/
    ├── config.py                 # YAML config loader
    └── logger.py                 # Loguru logger setup
```

### Data Flow

1. **Alert Input** → SecurityAlert model (Pydantic validation)
2. **Context Collection** → Tools collect network/asset/user context
3. **Threat Intelligence** → Query IOCs against threat databases (mocked)
4. **Risk Assessment** → Calculate weighted risk score (0-100):
   - Severity (30% weight)
   - Threat intel score (30%)
   - Asset criticality (20%)
   - Exploitability (20%)
5. **Remediation** → Generate prioritized action items
6. **Output** → TriageResult saved to `logs/triage_result_*.json`

### Agent Workflow

`SecurityAlertTriageAgent.process_alert()` executes:
```python
1. collect_context()         # Network/Asset/User context
2. query_threat_intel()      # IPs, hashes, URLs
3. assess_risk()             # Weighted calculation
4. generate_remediation()    # Priority-based actions
5. determine_human_review()  # Based on risk/confidence
```

### Risk Level Thresholds

Defined in `config/config.yaml`:
- **Critical**: 90+ (requires human review)
- **High**: 70+ (requires human review)
- **Medium**: 40-69
- **Low**: 20-39
- **Info**: 0-19

### Tool Invocation Pattern

All tools are LangChain tools decorated with `@tool`:
```python
result = tool_name.invoke({"param": value})
```

Tools use synchronous `.invoke()` within async agent workflow.

---

## Production Architecture (Designed, Not Yet Implemented)

### Key Components (15 Microservices)

**Core Processing**:
- `alert-ingestor` - Multi-protocol alert ingestion (REST, webhook, syslog)
- `alert-normalizer` - Standardize alerts to common format
- `context-collector` - Enrich alerts with network/asset/user context
- `threat-intel-aggregator` - Aggregate threat intel from multiple sources
- `ai-triage-agent` - LangChain-based AI analysis (enhanced prototype agent)

**AI & Analysis**:
- `similarity-search` - Vector similarity search with ChromaDB
- `llm-router` - Intelligent routing to DeepSeek-V3 or Qwen3

**Workflow & Automation**:
- `workflow-engine` - Temporal workflow orchestration
- `automation-engine` - SOAR playbook execution

**Data & Support**:
- `api-gateway` (Kong) - API routing, rate limiting, auth
- `notification-service` - Multi-channel notifications
- `user-management` - RBAC, authentication
- `reporting-service` - BI reports and dashboards
- `audit-logger` - Event sourcing for audit trails

### Technology Stack

**Backend**: Python 3.11+, FastAPI, LangChain, Pydantic v2, Temporal
**Data**: PostgreSQL 15 (HA), Redis Cluster, RabbitMQ 3.12, ChromaDB, Elasticsearch 8.x
**LLM**: Private MaaS (DeepSeek-V3 + Qwen3) with intelligent routing
**Frontend**: React 18, TypeScript, Tailwind CSS
**DevOps**: Kubernetes, Prometheus, Grafana, Jaeger, ELK

### Critical Design Patterns

- **CQRS**: Command-query separation for write/read optimization
- **Event Sourcing**: Audit logs with immutable event history
- **Circuit Breaker**: Fault tolerance with exponential backoff
- **Multi-level Cache**: L1 (memory) → L2 (Redis) → L3 (API)
- **Async Message-Driven**: RabbitMQ for service decoupling

See `/docs/01_architecture_overview.md` for complete architecture details.

---

## Development Standards

When working on this codebase, follow the standards defined in `/standards/`:

### Key Standards Documents

1. **`standards/01_coding_standards.md`** - Python PEP 8, type annotations, async patterns
2. **`standards/02_api_standards.md`** - RESTful API design, error handling, authentication
3. **`standards/03_architecture_standards.md`** - Microservices patterns, caching, monitoring
4. **`standards/04_security_standards.md`** - Data encryption, RBAC, audit logging

### Critical Development Practices

**Code Style**:
- Use type hints for all function parameters and returns
- Async functions for all I/O operations (database, HTTP, message queues)
- Structured logging with `extra={}` for contextual data
- Google-style docstrings for all public functions

**API Design**:
- Standard response format: `{"success": true/false, "data": {...}, "meta": {...}}`
- Error codes: `VALIDATION_ERROR`, `ALERT_NOT_FOUND`, etc.
- JWT authentication with refresh tokens
- RBAC authorization with permission decorators

**Error Handling**:
- Define custom exception classes inheriting from base `SecurityTriageError`
- Layered exception handling (specific → general)
- Never silently ignore exceptions
- Log with appropriate levels (DEBUG, INFO, WARNING, ERROR, CRITICAL)

**Example**:
```python
async def process_alert(alert_id: str) -> Dict[str, Any]:
    """
    Process alert and return risk assessment.

    Args:
        alert_id: Alert identifier

    Returns:
        Risk assessment result

    Raises:
        AlertNotFoundError: If alert not found
        ProcessingError: If processing fails
    """
    try:
        alert = await fetch_alert(alert_id)
        if not alert:
            raise AlertNotFoundError(alert_id)

        result = await analyze_alert(alert)
        logger.info("Alert processed", extra={"alert_id": alert_id})
        return result

    except AlertNotFoundError:
        logger.warning(f"Alert not found: {alert_id}")
        raise
    except Exception as e:
        logger.exception(f"Unexpected error processing {alert_id}")
        raise ProcessingError(f"Failed to process: {e}") from e
```

---

## Important Files and Locations

### Prototype Files
- `main.py` - CLI entry point with argument parsing
- `config/config.yaml` - Risk thresholds, weights, LLM settings
- `data/sample_alerts.json` - 4 example alerts (malware, brute_force, anomaly, data_exfiltration)
- `.env.example` - Environment variable template (rename to `.env` for use)
- `logs/triage.log` - Runtime logs with rotation (100MB, 30-day retention)
- `logs/triage_result_*.json` - JSON output of analysis results

### Architecture & Standards Documentation
- `/docs/README.md` - Architecture design index (start here)
- `/docs/01_architecture_overview.md` - Complete architecture with diagrams
- `/docs/02_functional_requirements.md` - 10 major modules with P0/P1/P2 priorities
- `/docs/03_components_inventory.md` - All 15 microservices with resource allocation
- `/docs/04_database_design.md` - PostgreSQL schema with indexes and migrations
- `/docs/05_api_design.md` - RESTful API specifications
- `/docs/06_poc_implementation.md` - 4-6 week POC plan with Docker Compose
- `/standards/README.md` - Development standards index
- `/standards/01_coding_standards.md` - Python PEP 8, async patterns, testing
- `/standards/02_api_standards.md` - RESTful design, error codes, JWT auth
- `/standards/03_architecture_standards.md` - Microservices, caching, monitoring
- `/standards/04_security_standards.md` - Encryption, RBAC, audit logging

---

## Extending the System

### Adding New Tools (Prototype)

1. Create function with `@tool` decorator in `src/tools/`
2. Add type hints and comprehensive docstring
3. Register in `SecurityAlertTriageAgent.__init__()`
4. Call in appropriate workflow method

### Integrating Real APIs

Replace mock implementations in `src/tools/`:
- `threat_intel_tools.py` - VirusTotal, MISP, Abuse.ch APIs
- `context_tools.py` - Real CMDB, user directory, geolocation APIs
- Add API keys to `.env`
- Update `config/config.yaml` with API endpoints

### Adding New Alert Types

Add to `AlertType` enum in `src/models/alert.py`:
```python
class AlertType(str, Enum):
    malware = "malware"
    phishing = "phishing"
    # ... existing types
    new_type = "new_type"  # Add here
```

---

## Production Implementation Roadmap

### POC Phase (4-6 weeks)
See `/docs/06_poc_implementation.md` for detailed plan:

**Week 1-2**: Infrastructure
- Docker Compose setup (PostgreSQL, Redis, RabbitMQ, ChromaDB)
- Shared libraries (models, messaging, database, auth)
- Development environment

**Week 3-4**: Core Services
- Alert Ingestor (multi-protocol ingestion)
- AI Triage Agent (enhanced prototype with private MaaS)
- Threat Intel Aggregator (2-3 sources)
- Context Collector (real integrations)

**Week 5**: Integration
- End-to-end testing
- Performance optimization
- Error handling and monitoring

**Week 6**: Demo & Evaluation
- Performance metrics
- POC evaluation checklist
- Production deployment plan

### MVP Phase (2-3 months post-POC)
- High availability deployment
- Web UI development
- User authentication and RBAC
- Basic monitoring

### Production Phase (4-6 months)
- Full 15 microservices
- Advanced workflow orchestration
- Comprehensive monitoring and alerting
- Security hardening

---

## Configuration Management

### Prototype Config (`config/config.yaml`)
```yaml
llm:
  model: "qwen-plus"
  temperature: 0.0

risk_scoring:
  thresholds:
    critical: 90
    high: 70
    medium: 40
    low: 20

  weights:
    severity: 0.3
    threat_intel: 0.3
    asset_criticality: 0.2
    exploitability: 0.2
```

### Production MaaS Config
```python
# In production code, intelligent routing between models
def route_llm_task(complexity: str) -> str:
    """Route to appropriate MaaS model"""
    return "deepseek" if complexity == "high" else "qwen"
```

### Environment Variables
```bash
# Required
LLM_API_KEY=sk-your-key
LLM_BASE_URL=https://api.example.com/v1

# Production MaaS (private deployment)
DEEPSEEK_BASE_URL=http://internal-maas.deepseek/v1
DEEPSEEK_API_KEY=internal-key-123
QWEN_BASE_URL=http://internal-maas.qwen/v1
QWEN_API_KEY=internal-key-456

# Database (production)
DATABASE_URL=postgresql://user:pass@localhost:5432/triage
REDIS_URL=redis://localhost:6379/0
RABBITMQ_URL=amqp://admin:password@localhost:5672/
```

---

## Testing Strategy

### Prototype Testing
```bash
# Test API connection first
python3 test_api.py

# Test system components without API
python3 test_system.py

# Run with sample data
python main.py --sample
```

### Production Testing (Planned)
- **Unit Tests**: pytest with >80% coverage
- **Integration Tests**: Full workflow testing
- **Load Tests**: 100+ alerts/minute processing
- **Security Tests**: OWASP Top 10 vulnerability scanning

---

## Key Differences: Prototype vs Production

| Aspect | Prototype | Production |
|--------|-----------|------------|
| **Architecture** | Single script | 15 microservices |
| **Database** | JSON files | PostgreSQL HA |
| **Message Queue** | None | RabbitMQ cluster |
| **Caching** | None | Redis Cluster |
| **Vector Search** | None | ChromaDB |
| **LLM** | External API | Private MaaS |
| **Auth** | None | JWT + RBAC |
| **Monitoring** | Log files | Prometheus + Grafana |
| **Deployment** | Local | Kubernetes |

---

## Troubleshooting

### Common Issues

**ImportError**:
```bash
# Solution: Reinstall dependencies
pip install -r requirements.txt --upgrade
```

**API Connection Errors**:
```bash
# Check .env configuration
cat .env
# Ensure format: LLM_API_KEY=sk-key (no quotes)
```

**Module Not Found**:
```bash
# Ensure running from project root
cd /Users/newmba/Downloads/CCWorker/security_triage
python main.py --sample
```

**Database Connection (Production)**:
```bash
# Check PostgreSQL is running
docker ps | grep postgres
# Verify connection string
echo $DATABASE_URL
```

---

## Additional Resources

### Documentation
- **LLM Configuration**: `LLM_API_CONFIG.md`
- **Quick Start**: `QUICKSTART.md`
- **Project Summary**: `PROJECT_SUMMARY.md`
- **Installation**: `INSTALL_GUIDE.md`
- **Migration**: `MIGRATION_GUIDE.md`

### External References
- **FastAPI**: https://fastapi.tiangolo.com/
- **LangChain**: https://python.langchain.com/
- **Temporal**: https://temporal.io/
- **ChromaDB**: https://www.trychroma.com/
- **DeepSeek**: https://platform.deepseek.com/
- **Qwen**: https://bailian.console.aliyun.com/

---

**Last Updated**: 2025-01-05
**Project Status**: 🟢 Prototype Complete | 🟡 Production Architecture Designed | 🔄 POC Pending
