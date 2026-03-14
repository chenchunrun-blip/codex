# Dockerfile Build Context Fix - Final

## Problem

GitHub Actions Docker build was failing with errors like:
```
ERROR: failed to calculate checksum of ref: "/services/shared": not found
ERROR: failed to calculate checksum of ref: "/services/data_analytics": not found
```

## Root Cause

The issue was a **mismatch between Docker build context and COPY paths**:

### GitHub Actions Configuration
```yaml
# File: .github/workflows/ci-cd.yml (line 142)
context: ./services/${{ matrix.service }}  # e.g., ./services/data_analytics
```

### Incorrect Dockerfile (Before)
```dockerfile
COPY services/requirements.txt /app/
COPY services/shared /app/services/shared
COPY services/data_analytics /app/services/data_analytics
```

When build context is `./services/data_analytics`, Docker can only see:
- `./` (data_analytics directory)
- `../` (services directory with other services and shared)

Paths like `services/shared` don't exist because `services/` is the **parent** directory, not a subdirectory.

## Solution

### Correct Dockerfile (After)

All 11 Python service Dockerfiles were updated to use **relative paths**:

```dockerfile
# Build context is ./services/data_analytics, so use relative paths
COPY requirements.txt /app/

# Copy shared module (parent directory relative to build context)
COPY ../shared /app/services/shared

# Copy service code (current directory)
COPY . /app/services/data_analytics
```

### Key Changes

| Before | After | Explanation |
|--------|-------|-------------|
| `COPY services/requirements.txt /app/` | `COPY requirements.txt /app/` | Use local requirements.txt from current service |
| `COPY services/shared /app/services/shared` | `COPY ../shared /app/services/shared` | shared/ is in parent directory relative to build context |
| `COPY services/data_analytics /app/...` | `COPY . /app/services/data_analytics` | Copy current directory contents |

## Why This Works

With build context `./services/data_analytics`:
```
services/
├── data_analytics/          ← Build context root (./)
│   ├── Dockerfile
│   ├── requirements.txt     ← COPY requirements.txt
│   └── main.py              ← COPY . (includes everything)
└── shared/                  ← ../shared (parent directory)
    └── ...
```

## Services Fixed

All 11 Python services with Dockerfiles:
1. ai_triage_agent
2. alert_ingestor
3. alert_normalizer
4. automation_orchestrator
5. configuration_service
6. data_analytics
7. monitoring_metrics
8. notification_service
9. reporting_service
10. similarity_search
11. workflow_engine

## Verification

After this fix, the GitHub Actions CI/CD pipeline should successfully:
- ✅ Build all 11 Python service Docker images
- ✅ Push images to GitHub Container Registry (ghcr.io)
- ✅ Tag images as `main`, `latest`, and `main-<sha>`

## Commit

```
commit 1870e3b
fix: Use relative COPY paths in Dockerfiles matching build context
```

## Additional Notes

- Each service has its own `requirements.txt` file (no shared requirements.txt at services level)
- Build context remains `./services/${service}` for efficient caching
- No changes needed to CI/CD configuration
- web_dashboard (Node.js) service uses separate build configuration

---

**Status**: ✅ Complete - All Dockerfile paths fixed and pushed to GitHub
**Date**: 2026-01-08
**Issue**: Docker COPY paths not matching build context in GitHub Actions
