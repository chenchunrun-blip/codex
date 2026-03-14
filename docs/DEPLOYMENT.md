# Security Triage System - Deployment Guide

**Version**: 1.0
**Last Updated**: 2026-01-11

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Environment Configuration](#environment-configuration)
4. [Deployment Methods](#deployment-methods)
5. [Monitoring and Observability](#monitoring-and-observability)
6. [Health Checks](#health-checks)
7. [Backup and Recovery](#backup-and-recovery)
8. [Troubleshooting](#troubleshooting)
9. [Production Considerations](#production-considerations)

---

## Prerequisites

### System Requirements

**Minimum**:
- CPU: 4 cores
- RAM: 8 GB
- Disk: 20 GB SSD

**Recommended**:
- CPU: 8 cores
- RAM: 16 GB
- Disk: 50 GB SSD

### Software Requirements

- Docker 20.10+
- Docker Compose 2.0+
- Git 2.0+
- Bash 4.0+

### Port Requirements

| Service | Port | Protocol |
|---------|------|----------|
| PostgreSQL | 5432 | TCP |
| Redis | 6379 | TCP |
| RabbitMQ | 5672, 15672 | TCP |
| ChromaDB | 8001 | TCP |
| API Gateway | 8000 | TCP |
| Alert Ingestor | 9001 | TCP |
| Alert Normalizer | 9002 | TCP |
| Context Collector | 9003 | TCP |
| Threat Intel Aggregator | 9004 | TCP |
| LLM Router | 9005 | TCP |
| AI Triage Agent | 9006 | TCP |
| Web Dashboard | 9015 | TCP |
| Prometheus | 9090 | TCP |
| Grafana | 3000 | TCP |

---

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/chenchunrun/security.git
cd security
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Required Changes**:
- Change all default passwords
- Configure LLM API keys
- Set up threat intelligence API keys (optional)

### 3. Deploy

```bash
# Development environment
./scripts/deploy.sh dev

# With monitoring
./scripts/deploy.sh dev -m
```

### 4. Verify Deployment

```bash
# Run health checks
./scripts/health_check.sh
```

### 5. Access Services

- **API Gateway**: http://localhost:8000
- **Web Dashboard**: http://localhost:9015
- **API Documentation**: http://localhost:8000/docs
- **RabbitMQ Management**: http://localhost:15672
- **Grafana** (if enabled): http://localhost:3000

---

## Environment Configuration

### Environment Variables

The `.env` file contains all configuration for the system:

```bash
# =============================================================================
# Infrastructure
# =============================================================================

# Database
DB_PASSWORD=your_secure_password_here
DATABASE_URL=postgresql+asyncpg://triage_user:${DB_PASSWORD}@postgres:5432/security_triage

# Redis
REDIS_PASSWORD=your_redis_password_here
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

# RabbitMQ
RABBITMQ_PASSWORD=your_rabbitmq_password_here
RABBITMQ_URL=amqp://admin:${RABBITMQ_PASSWORD}@rabbitmq:5672/

# =============================================================================
# LLM Configuration
# =============================================================================

# For Qwen (recommended for China)
LLM_API_KEY=sk-your-qwen-api-key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# For OpenAI
# LLM_API_KEY=sk-your-openai-api-key
# LLM_BASE_URL=

# =============================================================================
# Security
# =============================================================================

JWT_SECRET_KEY=your-super-secret-jwt-key-min-32-chars
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# =============================================================================
# Optional Services
# =============================================================================

# Threat Intelligence APIs
VIRUSTOTAL_API_KEY=your_virustotal_key
ABUSE_CH_API_KEY=your_abuse_ch_key

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9091
```

### Environment-Specific Configuration

**Development (.env.dev)**:
```bash
LOG_LEVEL=DEBUG
DEBUG=true
ENABLE_METRICS=false
```

**Production (.env.prod)**:
```bash
LOG_LEVEL=WARNING
DEBUG=false
ENABLE_METRICS=true
```

---

## Deployment Methods

### 1. Automated Deployment (Recommended)

```bash
# Deploy to development
./scripts/deploy.sh dev

# Deploy to staging
./scripts/deploy.sh staging

# Deploy to production with monitoring
./scripts/deploy.sh prod -m

# Build only without starting
./scripts/deploy.sh dev -b

# Skip build (use existing images)
./scripts/deploy.sh dev -s
```

### 2. Manual Deployment

#### Start Infrastructure

```bash
docker-compose up -d postgres redis rabbitmq chromadb
```

#### Initialize Database

```bash
# Wait for PostgreSQL to be ready
docker exec security-triage-postgres pg_isready -U triage_user

# Run initialization script
docker exec -i security-triage-postgres psql -U postgres -d security_triage < scripts/init_db.sql
```

#### Start Services

```bash
# Core pipeline
docker-compose up -d \
  alert-ingestor \
  alert-normalizer \
  context-collector \
  threat-intel-aggregator \
  llm-router \
  ai-triage-agent

# API and UI
docker-compose up -d api-gateway web-dashboard
```

### 3. Deployment with Monitoring

```bash
# Start with monitoring profile
docker-compose --profile monitoring up -d

# Or use deploy script
./scripts/deploy.sh prod -m
```

**Monitoring Stack Includes**:
- Prometheus (metrics collection)
- Grafana (visualization)
- Node Exporter (system metrics)
- cAdvisor (container metrics)

---

## Monitoring and Observability

### Prometheus Metrics

All services expose Prometheus metrics on `/metrics` endpoint:

**Key Metrics**:
- `http_requests_total` - Request count by endpoint
- `http_request_duration_seconds` - Request latency
- `alert_processing_duration_seconds` - Alert processing time
- `database_query_duration_seconds` - Database query time
- `message_queue_messages` - Queue depth
- `llm_requests_total` - LLM API calls

### Grafana Dashboards

Pre-configured dashboards:
1. **System Overview** - Overall system health
2. **API Performance** - Request latency and throughput
3. **Database Metrics** - Query performance and connections
4. **Message Queue** - RabbitMQ queue depths
5. **LLM Usage** - API call statistics

### Log Aggregation

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f ai-triage-agent

# View last 100 lines
docker-compose logs --tail=100 api-gateway

# Export logs
docker-compose logs > deployment.log
```

---

## Health Checks

### Automated Health Checks

```bash
# Check all services
./scripts/health_check.sh

# Watch mode (continuous)
./scripts/health_check.sh -w

# Check specific service
./scripts/health_check.sh -s ai-triage-agent

# JSON output
./scripts/health_check.sh -j
```

### Manual Health Checks

```bash
# Check service status
docker-compose ps

# Check container health
docker inspect --format='{{.State.Health.Status}}' security-triage-ai-triage-agent

# Check HTTP endpoint
curl http://localhost:9006/health

# Check database connection
docker exec security-triage-postgres psql -U triage_user -d security_triage -c "SELECT 1;"
```

### Health Status Codes

| Status | Description | Action |
|--------|-------------|--------|
| `healthy` | Service is healthy | None |
| `running` | Service is running | Monitor |
| `starting` | Service is starting | Wait |
| `unhealthy` | Health check failed | Investigate |
| `stopped` | Service is stopped | Start service |
| `not_found` | Container doesn't exist | Deploy service |

---

## Backup and Recovery

### Database Backup

```bash
# Automatic backup
./scripts/backup.sh database

# Manual backup
docker exec security-triage-postgres pg_dump -U triage_user security_triage > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup with compression
docker exec security-triage-postgres pg_dump -U triage_user security_triage | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Database Recovery

```bash
# Restore from backup
cat backup.sql | docker exec -i security-triage-postgres psql -U triage_user -d security_triage

# Restore from compressed backup
gunzip -c backup.sql.gz | docker exec -i security-triage-postgres psql -U triage_user -d security_triage
```

### Configuration Backup

```bash
# Backup environment configuration
cp .env backups/.env.$(date +%Y%m%d_%H%M%S)

# Backup deployment scripts
tar -czf scripts_backup_$(date +%Y%m%d_%H%M%S).tar.gz scripts/
```

### Rollback Procedure

```bash
# Rollback to previous version
./scripts/rollback.sh

# Rollback to specific version
./scripts/rollback.sh -v abc123

# Rollback with backup
./scripts/rollback.sh -b -s
```

---

## Troubleshooting

### Common Issues

#### 1. Services Won't Start

**Symptoms**: Containers exit immediately

**Diagnosis**:
```bash
# Check logs
docker-compose logs [service_name]

# Check container status
docker-compose ps
```

**Solutions**:
- Verify `.env` configuration
- Check port availability: `netstat -tuln | grep LISTEN`
- Ensure dependencies are running
- Check disk space: `df -h`

#### 2. Database Connection Errors

**Symptoms**: Services can't connect to PostgreSQL

**Diagnosis**:
```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Test connection
docker exec security-triage-postgres psql -U triage_user -d security_triage
```

**Solutions**:
- Verify `DATABASE_URL` in `.env`
- Check PostgreSQL health: `docker exec security-triage-postgres pg_isready -U triage_user`
- Ensure database is initialized: `cat scripts/init_db.sql | docker exec -i security-triage-postgres psql -U postgres`

#### 3. Message Queue Issues

**Symptoms**: Messages not being processed

**Diagnosis**:
```bash
# Check RabbitMQ status
docker-compose ps rabbitmq

# Check queue status
curl -u admin:password http://localhost:15672/api/queues
```

**Solutions**:
- Verify `RABBITMQ_URL` in `.env`
- Check RabbitMQ management UI: http://localhost:15672
- Restart RabbitMQ: `docker-compose restart rabbitmq`

#### 4. High Memory Usage

**Symptoms**: Services consuming too much memory

**Diagnosis**:
```bash
# Check container resource usage
docker stats

# Check specific service
docker stats security-triage-ai-triage-agent
```

**Solutions**:
- Limit container memory in `docker-compose.yml`
- Reduce database pool size
- Enable debug logging only when needed
- Restart services: `docker-compose restart [service_name]`

#### 5. Slow Performance

**Diagnosis**:
```bash
# Check service metrics
curl http://localhost:9006/metrics

# Check database performance
docker exec security-triage-postgres psql -U triage_user -d security_triage -c "SELECT * FROM pg_stat_activity;"

# Check message queue depth
curl -u admin:password http://localhost:15672/api/queues/%2F/alert.raw
```

**Solutions**:
- Scale services horizontally
- Enable Redis caching
- Optimize database queries
- Increase worker counts

### Getting Help

1. **Check Logs**: `docker-compose logs -f [service_name]`
2. **Health Check**: `./scripts/health_check.sh -v`
3. **Documentation**: See `docs/` directory
4. **GitHub Issues**: https://github.com/chenchunrun/security/issues

---

## Production Considerations

### Security

**Before Production Deployment**:

1. **Change All Default Passwords**
   ```bash
   # Update .env
   DB_PASSWORD=<strong password>
   REDIS_PASSWORD=<strong password>
   RABBITMQ_PASSWORD=<strong password>
   JWT_SECRET_KEY=<32+ character random string>
   GRAFANA_PASSWORD=<strong password>
   ```

2. **Enable TLS/SSL**
   - Use reverse proxy (nginx/traefik)
   - Configure SSL certificates
   - Enable HTTPS only

3. **Network Isolation**
   - Use Docker networks
   - Expose only necessary ports
   - Configure firewall rules

4. **Secrets Management**
   - Use Docker secrets or vault
   - Never commit `.env` to git
   - Rotate credentials regularly

### High Availability

**Database**:
- Enable PostgreSQL streaming replication
- Use managed database service (AWS RDS, etc.)
- Configure connection pooling

**Message Queue**:
- Configure RabbitMQ clustering
- Enable queue mirroring
- Use load balancer

**Application**:
- Deploy multiple instances per service
- Use health checks for failover
- Configure load balancing

### Performance Optimization

**Database**:
- Create appropriate indexes
- Use connection pooling
- Enable query caching
- Regular vacuum and analyze

**Application**:
- Enable Redis caching
- Use async operations
- Optimize LLM calls
- Batch processing

**Infrastructure**:
- Use SSD storage
- Allocate sufficient resources
- Monitor resource usage
- Scale based on load

### Monitoring Setup

**Critical Alerts**:
- Service down
- High error rate (>5%)
- High latency (P95 > 3s)
- Queue depth > 1000
- Database connection pool exhausted
- Disk space < 20%

**Dashboards**:
- System health overview
- API performance
- Database metrics
- Message queue status
- LLM usage and costs

### Backup Strategy

**Database**:
- Automated daily backups
- Retention: 30 days
- Off-site storage
- Regular restore testing

**Configuration**:
- Version control all configs
- Document all changes
- Maintain change log

**Disaster Recovery**:
- Documented procedures
- Regular drills
- RTO: 1 hour
- RPO: 15 minutes

---

## Appendix

### Useful Commands

```bash
# View all running containers
docker ps

# View service logs
docker-compose logs -f [service_name]

# Restart a service
docker-compose restart [service_name]

# Stop all services
docker-compose down

# Stop all services and remove volumes
docker-compose down -v

# Rebuild a service
docker-compose build [service_name]

# Execute command in container
docker-compose exec [service_name] bash

# Check container resource usage
docker stats

# Prune unused Docker resources
docker system prune -a
```

### File Locations

| Type | Location |
|------|----------|
| Scripts | `./scripts/` |
| Configuration | `./.env`, `./docker-compose.yml` |
| Logs | `./logs/` |
| Database Data | Docker volume `postgres_data` |
| Redis Data | Docker volume `redis_data` |
| RabbitMQ Data | Docker volume `rabbitmq_data` |
| Backups | `./backups/` |

### Support Resources

- **Documentation**: `./docs/`
- **GitHub**: https://github.com/chenchunrun/security
- **Issues**: https://github.com/chenchunrun/security/issues
- **API Docs**: http://localhost:8000/docs (after deployment)

---

**Document Version**: 1.0
**Last Updated**: 2026-01-11
**Maintainer**: CCR <chenchunrun@gmail.com>
