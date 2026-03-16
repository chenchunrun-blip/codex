# Docker Build Fix - 2026-01-09

## Issue

Docker build was failing with error:
```
ERROR [alert-normalizer 6/8] COPY ../shared /app/services/shared:
------
> [alert-normalizer 6/8] COPY ../shared /app/services/shared:
------
failed to compute cache key: "/shared": not found
```

## Root Cause

The Dockerfiles used `COPY ../shared` to copy the shared module, but Docker Compose build context was set to the project root directory (`context: .`), making the parent directory reference invalid.

## Solution

Fixed all 15 Dockerfiles by updating COPY paths:

### Before:
```dockerfile
# From service directory context (incorrect)
COPY requirements.txt /app/
COPY ../shared /app/services/shared
COPY . /app/services/alert_normalizer
```

### After:
```dockerfile
# From project root context (correct)
COPY ./services/alert_normalizer/requirements.txt /app/
COPY ./services/shared /app/services/shared
COPY ./services/alert_normalizer /app/services/alert_normalizer
```

## Fixed Services (15)

✓ ai_triage_agent
✓ alert_ingestor
✓ alert_normalizer
✓ automation_orchestrator
✓ configuration_service
✓ context_collector
✓ data_analytics
✓ llm_router
✓ monitoring_metrics
✓ notification_service
✓ reporting_service
✓ similarity_search
✓ threat_intel_aggregator
✓ web_dashboard
✓ workflow_engine

## Testing

Use the provided test script:

```bash
# Test a single service
./test_docker_build.sh context-collector

# Test core pipeline services
./test_docker_build.sh core

# Test all services
./test_docker_build.sh all
```

## Expected Build Time

- Single service: 2-5 minutes (first time, with cache: 30-60 seconds)
- Core services: 10-15 minutes
- All services: 25-35 minutes

## Build Verification

After build, verify images:
```bash
docker images | grep security-triage
```

Expected output:
```
security-triage-alert-normalizer     latest    ...
security-triage-context-collector    latest    ...
security-triage-ai-triage-agent      latest    ...
...
```

## Next Steps

1. Test build with: `./test_docker_build.sh core`
2. If successful, start services: `docker-compose up -d`
3. Check service health: `curl http://localhost:9001/health`

## Troubleshooting

If build still fails:

1. Check Docker daemon is running:
   ```bash
   docker ps
   ```

2. Clear build cache:
   ```bash
   docker builder prune -a
   ```

3. Check disk space:
   ```bash
   df -h
   ```

4. Review build logs:
   ```bash
   docker-compose build --no-cache context-collector
   ```
