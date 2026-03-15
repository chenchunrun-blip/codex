# Security Intelligent Triage System — Gap Analysis

> Generated: 2026-03-15
> Scope: Prototype (`src/`) + Microservices (`services/`) vs Production Architecture (`docs/`)

---

## Executive Summary

The core alert processing pipeline (ingestion → normalization → enrichment → threat intel → AI triage → similarity search) is **production-ready** with full database, messaging, and error handling. Support services (workflow, automation, notifications, reporting, analytics, dashboard) are **scaffolded but incomplete**. Key gaps remain in **real external integrations, test coverage, and operational tooling**.

| Category | Completion | Notes |
|----------|-----------|-------|
| Core Pipeline (7 services) | **85%** | Fully functional, minor gaps |
| AI & Analysis (3 services) | **80%** | LLM routing + triage + similarity done |
| Workflow & Automation (2 services) | **40%** | Framework only, execution logic missing |
| Support Services (5 services) | **30%** | Scaffolded, business logic incomplete |
| Shared Infrastructure | **90%** | DB, MQ, models, clustering, correlation done |
| Testing | **20%** | Only shared/ has tests; services have none |
| External Integrations | **15%** | Nearly all mocked or placeholder |
| DevOps / Observability | **10%** | No K8s manifests, no Prometheus/Grafana config |

---

## 1. Core Pipeline Gaps

### 1.1 Alert Ingestor — 95% complete

| Feature (Designed) | Status | Gap |
|---|---|---|
| REST ingestion | Done | — |
| Batch ingestion | Done | — |
| Rate limiting | Done | In-memory fallback when Redis unavailable |
| Deduplication | Done | Redis-backed + fallback |
| Syslog / CEF / MQTT / WebSocket ingestion | **Missing** | Only REST implemented; docs specify 5 protocols |
| `GET /alerts/{id}` status lookup | **Stub** | TODO comment in code |

### 1.2 Alert Normalizer — 90% complete

| Feature | Status | Gap |
|---|---|---|
| Splunk / QRadar / CEF processors | Done | — |
| IOC extraction (IP, hash, URL, domain, email) | Done | — |
| Fingerprint dedup | Done | — |
| Time-window aggregation | Done | — |
| OCSF schema compliance | **Missing** | Custom schema, not mapped to OCSF standard |
| 10+ device type mappings | **Partial** | 3 processors; design calls for 10+ |

### 1.3 Context Collector — 85% complete

| Feature | Status | Gap |
|---|---|---|
| Internal IP detection (RFC 1918) | Done | — |
| In-memory TTL cache | Done | — |
| DB persistence (alert_context) | Done | — |
| MQ consumer/publisher | Done | — |
| GeoIP (MaxMind) integration | **Mock** | Returns "Internal" / "Unknown" |
| CMDB / asset registry | **Mock** | JSON file fallback |
| LDAP / AD user lookup | **Mock** | JSON file fallback |
| VPN / proxy detection | **Missing** | Not implemented |
| ISP / ASN enrichment | **Missing** | Not implemented |
| Shodan / AbuseIPDB queries | **Missing** | Not implemented |

### 1.4 Threat Intel Aggregator — 75% complete

| Feature | Status | Gap |
|---|---|---|
| VirusTotal source | Done (API calls) | Needs real API key to activate |
| Abuse.ch source | Done | — |
| Internal IOC DB | Done | JSON-based |
| Custom threat feed | Placeholder | No real feed implementation |
| AlienVault OTX | **Missing** | Designed as P0 |
| WeChat / 360 threat intel | **Missing** | Designed as P1 (China sources) |
| Multi-level cache (L1 mem → L2 Redis → L3 API) | **Partial** | Redis cache done; no L1 in-memory layer |
| Threat score freshness decay | **Missing** | Score doesn't decay over time |
| Fallback strategy on API failure | **Partial** | Basic error handling; no circuit breaker |

---

## 2. AI & Analysis Gaps

### 2.1 AI Triage Agent — 90% complete

| Feature | Status | Gap |
|---|---|---|
| Alert-type-specific prompts (7 types) | Done | — |
| LLM Router integration | Done | — |
| Similarity search integration | Done | — |
| Retry with exponential backoff | Done | — |
| DB persistence (triage_results) | Done | — |
| Dynamic confidence calculation | **Missing** | Prototype hardcodes 0.75 |
| Attack chain analysis in prompt | **Partial** | Correlation data included; no MITRE mapping |
| Fine-tuned model support | **Missing** | Designed for Phase 4 |

### 2.2 LLM Router — 95% complete

| Feature | Status | Gap |
|---|---|---|
| Model capability registry (5 models) | Done | — |
| Task-type routing | Done | — |
| Complexity-based routing | Done | — |
| Mock mode for testing | Done | — |
| Model health monitoring / failover | **Missing** | No automatic failover between providers |
| Token usage tracking & cost accounting | **Missing** | — |
| Request queuing / backpressure | **Missing** | — |

### 2.3 Similarity Search — 90% complete

| Feature | Status | Gap |
|---|---|---|
| ChromaDB vector store | Done | — |
| SentenceTransformer embeddings | Done | — |
| Cosine similarity search | Done | — |
| Clustering engine integration | Done | — |
| pgvector integration | **Missing** | Design calls for ChromaDB + pgvector |
| Embedding model fine-tuning | **Missing** | Phase 4 feature |

---

## 3. Workflow & Automation Gaps (Major)

### 3.1 Workflow Engine — 40% complete

| Feature | Status | Gap |
|---|---|---|
| Workflow definition model | Done | — |
| Default alert-processing workflow | Done | 5 steps defined |
| Correlation with recent alerts | Done | CorrelationEngine integrated |
| Attack chain detection | Done | — |
| **Workflow execution engine** | **Incomplete** | Step execution logic partial |
| **State machine transitions** | **Missing** | Design: new→assigned→in_progress→resolved→closed |
| **Temporal integration** | **Missing** | Design calls for Temporal; currently in-memory |
| **SLA monitoring & enforcement** | **Missing** | — |
| **Task assignment strategies** | **Missing** | Skill-based, load-balancing, on-call |
| **Human task management UI** | **Missing** | HumanTask model exists; no review workflow |
| **Timeout-based auto-closure** | **Missing** | Design: 24h resolved→closed |

### 3.2 Automation Orchestrator — 35% complete

| Feature | Status | Gap |
|---|---|---|
| Playbook definitions (malware, phishing) | Done | 2 playbooks defined |
| Approval workflow model | Done | — |
| **Playbook execution engine** | **Missing** | No SSH/EDR/API action execution |
| **Ansible integration** | **Missing** | Design calls for Ansible |
| **Approval workflow routing** | **Missing** | Model exists; no routing logic |
| **Audit trail for actions** | **Missing** | — |
| **Playbook library** | **Partial** | 2 of 4+ designed playbooks (block_ip, isolate_host, disable_account, collect_evidence) |
| **Rollback capabilities** | **Missing** | — |

---

## 4. Support Services Gaps (Major)

### 4.1 Notification Service — 30% complete

| Feature | Status | Gap |
|---|---|---|
| Channel enum (9 channels) | Done | — |
| Priority levels | Done | — |
| MQ consumer | Done | — |
| **Email (SMTP) implementation** | **Missing** | — |
| **Slack / DingTalk / WeChat** | **Missing** | — |
| **SMS / PagerDuty** | **Missing** | — |
| **Template engine** | **Missing** | — |
| **Escalation after 5-15 min** | **Missing** | — |
| **Notification throttling** | **Missing** | — |

### 4.2 Configuration Service — 40% complete

| Feature | Status | Gap |
|---|---|---|
| In-memory config store | Done | Default values populated |
| History tracking model | Done | — |
| **Full CRUD API endpoints** | **Missing** | — |
| **Config validation** | **Missing** | — |
| **Change notifications** | **Missing** | — |
| **Version diffing** | **Missing** | — |

### 4.3 Data Analytics — 25% complete

| Feature | Status | Gap |
|---|---|---|
| Metrics structure | Done | Counts, rates, trends |
| **Time-series storage** | **Missing** | Design: TimescaleDB |
| **Trend calculations** | **Missing** | — |
| **Dashboard query endpoints** | **Missing** | — |
| **Real-time streaming metrics** | **Missing** | — |

### 4.4 Reporting Service — 20% complete

| Feature | Status | Gap |
|---|---|---|
| Report type / format enums | Done | — |
| Report status tracking | Done | — |
| **PDF / HTML / CSV generation** | **Missing** | — |
| **Scheduled report delivery** | **Missing** | — |
| **Template system** | **Missing** | — |
| **MinIO integration for storage** | **Missing** | — |

### 4.5 Web Dashboard — 25% complete

| Feature | Status | Gap |
|---|---|---|
| FastAPI backend with service routing | Done | — |
| Encrypted config storage | Done | — |
| WebSocket support | Done | — |
| **React frontend components** | **Missing** | No UI implemented |
| **Real-time alert feed** | **Missing** | — |
| **Triage review interface** | **Missing** | — |
| **Analytics dashboards** | **Missing** | — |

### 4.6 API Gateway — 40% complete

| Feature | Status | Gap |
|---|---|---|
| FastAPI router framework | Done | — |
| CORS / GZip middleware | Done | — |
| K8s liveness/readiness probes | Done | — |
| **JWT authentication middleware** | **Missing** | — |
| **Rate limiting (per-user)** | **Missing** | — |
| **Request/response logging** | **Partial** | — |
| **Kong integration** | **Missing** | Design calls for Kong |

### 4.7 User Management — Not Implemented

| Feature | Status | Gap |
|---|---|---|
| **RBAC roles & permissions** | **Missing** | Design: admin, analyst, viewer, auditor |
| **JWT token issuance/refresh** | **Missing** | — |
| **SSO / LDAP integration** | **Missing** | — |
| **MFA support** | **Missing** | — |
| **On-call schedule management** | **Missing** | — |

### 4.8 Monitoring & Metrics — 30% complete

| Feature | Status | Gap |
|---|---|---|
| Service registry | Done | 14 services registered |
| System metrics (psutil) | Done | CPU, memory |
| **Prometheus exporter** | **Partial** | Format defined; not all metrics exposed |
| **Grafana dashboards** | **Missing** | — |
| **AlertManager rules** | **Missing** | — |
| **Jaeger distributed tracing** | **Missing** | — |

---

## 5. Cross-Cutting Gaps

### 5.1 Testing

| Area | Current | Target | Gap |
|---|---|---|---|
| Shared library unit tests | 4 test files | >80% coverage | **~40% coverage** |
| Service unit tests | 0 (all services) | >80% coverage | **No tests exist** |
| Integration tests | Framework exists | Full pipeline tests | **Not implemented** |
| E2E tests | Framework exists | Automated regression | **Not implemented** |
| Load tests | Locust config exists | 1000+ alerts/s | **Not executed** |
| Security tests | None | OWASP Top 10 scan | **Not implemented** |

### 5.2 External Integrations

| Integration | Designed | Status |
|---|---|---|
| MaxMind GeoIP2 | P0 | **Not integrated** |
| VirusTotal API | P0 | Code ready, needs API key |
| AlienVault OTX | P0 | **Not integrated** |
| Shodan | P1 | **Not integrated** |
| AbuseIPDB | P1 | **Not integrated** |
| CMDB (real) | P0 | **Mock / JSON file** |
| LDAP / Active Directory | P1 | **Mock / JSON file** |
| Firewall APIs (Palo Alto, etc.) | P1 | **Not integrated** |
| EDR (CrowdStrike, etc.) | P1 | **Not integrated** |
| SIEM webhook receivers | P0 | REST only |

### 5.3 DevOps & Infrastructure

| Component | Designed | Status |
|---|---|---|
| Docker Compose (dev) | POC Phase | **Not created** |
| Kubernetes manifests | Production | **Not created** |
| Helm charts | Production | **Not created** |
| CI/CD pipeline | Production | **Not created** |
| Database migrations (Alembic) | Production | **Not created** |
| Prometheus config | Production | **Not created** |
| Grafana dashboards | Production | **Not created** |
| Jaeger config | Production | **Not created** |
| ELK config | Production | **Not created** |

### 5.4 Security Hardening

| Feature | Designed | Status |
|---|---|---|
| TLS 1.3 / mTLS | Production | **Not configured** |
| AES-256 field encryption | Production | Crypto utilities exist in shared/ |
| JWT auth with refresh | Production | **Not implemented** |
| RBAC permission checks | Production | **Not implemented** |
| Immutable audit log (event sourcing) | Production | **Not implemented** |
| Secret management (Vault) | Production | **Not configured** |
| Input sanitization | Production | Pydantic validation only |

---

## 6. Priority Recommendations

### P0 — Must Fix (blocks basic production use)

1. **Add unit tests for all core services** (ingestor, normalizer, context collector, threat intel, AI triage, similarity search)
2. **Complete workflow engine execution logic** — state machine, step execution, timeout handling
3. **Create Docker Compose** for local development and POC validation
4. **Implement JWT authentication** in API gateway
5. **Replace mock integrations** in context collector with at least one real source (GeoIP or CMDB)

### P1 — Should Fix (needed for production deployment)

6. **Complete notification service** — at minimum email + Slack/webhook channels
7. **Complete automation orchestrator** — playbook execution engine with approval workflow
8. **Add database migrations** (Alembic) for schema management
9. **Implement AlienVault OTX** as second P0 threat intel source
10. **Add Prometheus metrics** to all services with standard labels
11. **Create Kubernetes manifests** for core pipeline services
12. **Implement dynamic confidence scoring** in AI triage (replace hardcoded 0.75)

### P2 — Nice to Have (enterprise features)

13. **Build React web dashboard** — alert list, triage review, analytics
14. **Add MITRE ATT&CK mapping** service (Attack Chain Analyzer)
15. **Implement reporting service** — PDF/HTML generation with templates
16. **Add Syslog/CEF ingestion** to alert ingestor
17. **Integrate Temporal** for durable workflow execution
18. **Add multi-level threat intel cache** (L1 in-memory + L2 Redis)

---

## 7. Prototype vs Microservices Overlap

The original prototype (`src/`) and the microservices (`services/`) have significant code overlap. Key differences:

| Concern | Prototype (`src/`) | Microservices (`services/`) |
|---|---|---|
| Risk scoring | Standalone weighted formula | Same formula + LLM-enhanced analysis |
| Threat intel | 2 hardcoded IOCs | 4 pluggable sources |
| Context | All mocked | JSON file fallback + real API stubs |
| Clustering | Not implemented | Full engine in shared/ |
| Correlation | Not implemented | CorrelationEngine in shared/ |
| Dedup | Not implemented | Redis-backed deduplicator |
| LLM | Direct OpenAI API | Router with model selection |
| Persistence | JSON files in logs/ | PostgreSQL via SQLAlchemy |
| Messaging | None | RabbitMQ pub/sub |

**Recommendation**: The prototype served its purpose for validation. Future development should focus exclusively on the microservices architecture. Consider archiving `src/` to avoid confusion.

---

*End of Gap Analysis*
