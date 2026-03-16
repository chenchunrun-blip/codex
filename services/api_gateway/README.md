# API Gateway Service

FastAPI-based REST API for the Security Triage System.

## Features

- RESTful API design
- OpenAPI/Swagger documentation
- Request validation with Pydantic
- Database integration
- Health check endpoints
- Comprehensive error handling

## Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Or install from project root
pip install -r requirements.txt
```

## Configuration

Set environment variables:

```bash
# Database (required)
DATABASE_URL=sqlite+aiosqlite:///data/triage.db

# Or PostgreSQL
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/triage

# Development
DEBUG=true

# Logging
LOG_LEVEL=INFO
```

## Running

### Development Mode

```bash
# Auto-reload enabled
python main.py

# Or with uvicorn directly
uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

### Production Mode

```bash
# Multiple workers
uvicorn main:app --host 0.0.0.0 --port 8080 --workers 4

# With SSL
uvicorn main:app --host 0.0.0.0 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

## API Documentation

Once running, access:

- **Swagger UI**: http://localhost:8080/docs
- **ReDoc**: http://localhost:8080/redoc
- **Health Check**: http://localhost:8080/health

## API Endpoints

### Alert Management

- `GET /api/v1/alerts/` - List alerts (filter, paginate)
- `GET /api/v1/alerts/{alert_id}` - Get alert details
- `POST /api/v1/alerts/` - Create new alert
- `PATCH /api/v1/alerts/{alert_id}/status` - Update status
- `GET /api/v1/alerts/stats/summary` - Alert statistics
- `GET /api/v1/alerts/high-priority` - High-priority alerts
- `GET /api/v1/alerts/active` - Active alerts
- `POST /api/v1/alerts/bulk` - Bulk actions
- `GET /api/v1/alerts/{alert_id}/triage` - Get triage result

### Analytics

- `GET /api/v1/analytics/dashboard` - Dashboard stats
- `GET /api/v1/analytics/trends/alerts` - Alert trends
- `GET /api/v1/analytics/trends/risk-scores` - Risk trends
- `GET /api/v1/analytics/metrics/severity-distribution` - Severity distribution
- `GET /api/v1/analytics/metrics/status-distribution` - Status distribution
- `GET /api/v1/analytics/metrics/top-sources` - Top sources
- `GET /api/v1/analytics/metrics/top-alert-types` - Top alert types
- `GET /api/v1/analytics/metrics/performance` - Performance metrics

### Health Checks

- `GET /` - API information
- `GET /health` - Health check with component status
- `GET /health/live` - Liveness probe
- `GET /health/ready` - Readiness probe

## Testing

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=routes --cov=models --cov-report=html

# Run specific test file
pytest tests/test_api.py -v
```

## Usage Examples

### List Alerts

```bash
curl -X GET "http://localhost:8080/api/v1/alerts/?skip=0&limit=10&severity=high"
```

### Create Alert

```bash
curl -X POST "http://localhost:8080/api/v1/alerts/" \
  -H "Content-Type: application/json" \
  -d '{
    "alert_type": "malware",
    "severity": "high",
    "title": "New Malware Alert",
    "description": "Malware detected on server",
    "source_ip": "45.33.32.156",
    "destination_ip": "10.0.0.50",
    "file_hash": "5d41402abc4b2a76b9719d911017c592"
  }'
```

### Get Dashboard Stats

```bash
curl -X GET "http://localhost:8080/api/v1/analytics/dashboard?time_range=24h"
```

## Architecture

```
api_gateway/
├── main.py                 # FastAPI application
├── models/
│   ├── requests.py         # Request models
│   └── responses.py        # Response models
├── routes/
│   ├── alerts.py           # Alert endpoints
│   └── analytics.py        # Analytics endpoints
├── middleware/             # Custom middleware
├── tests/
│   └── test_api.py         # API tests
├── requirements.txt        # Dependencies
└── README.md              # This file
```

## Database

The API Gateway uses SQLAlchemy with async support:

- **SQLite** (default): `sqlite+aiosqlite:///data/triage.db`
- **PostgreSQL**: `postgresql+asyncpg://user:pass@localhost:5432/triage`

Create database tables automatically on first run.

## Deployment

### Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### Kubernetes

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
spec:
  selector:
    app: api-gateway
  ports:
  - port: 8080
    targetPort: 8080
  type: LoadBalancer
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: api-gateway
        image: api-gateway:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8080
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
```

## Support

For issues or questions, contact the development team.
