# Threat Intelligence API Configuration Guide

This guide explains how to configure threat intelligence API keys for the Security Alert Triage System.

## Overview

The system integrates with multiple threat intelligence sources to enrich security alerts:

- **VirusTotal** - File, URL, IP, and domain reputation
- **Abuse.ch** - Malware URLs and payloads (URLhaus, SSLBL)
- **AlienVault OTX** - Community threat intelligence
- **Internal IOC Database** - Custom threat indicators

## API Key Configuration

### Method 1: Environment Variables (Recommended for Production)

Set the following environment variables in your `.env` file or Docker Compose configuration:

```bash
# VirusTotal API Key
# Get your key from: https://www.virustotal.com/
VIRUSTOTAL_API_KEY=your_virustotal_api_key_here

# AlienVault OTX API Key
# Get your key from: https://otx.alienvault.com/
OTX_API_KEY=your_otx_api_key_here

# Abuse.ch (free public API, no key required)
# ABUSE_CH_API_KEY=  # Not needed for free tier
```

### Method 2: Web Dashboard Configuration

1. Navigate to **Settings** page in the Web Dashboard
2. Scroll to **Threat Intelligence** section
3. Enter your API keys:
   - **VirusTotal API Key**: Your VT API key
   - **OTX API Key**: Your AlienVault OTX API key
4. Click **Save Configuration**

Keys are encrypted in the database using Fernet symmetric encryption.

### Method 3: System Configuration API

```bash
curl -X PUT http://localhost:3000/api/v1/config \
  -H "Content-Type: application/json" \
  -d '{
    "virustotal_api_key": "your_virustotal_api_key_here",
    "otx_api_key": "your_otx_api_key_here"
  }'
```

## Getting API Keys

### VirusTotal

1. Visit https://www.virustotal.com/
2. Sign up for a free account
3. Go to your **API Settings**
4. Copy your **API Key**

**Limits**:
- Free tier: 500 requests/day, 4 requests/minute
- Premium tier: Higher limits available

### AlienVault OTX

1. Visit https://otx.alienvault.com/
2. Sign up for a free account
3. Go to your **User Settings** → **API Key**
4. Copy your **API Key**

**Limits**:
- Free tier: No rate limit for community usage
- Requires API key for advanced features

### Abuse.ch

Abuse.ch provides free public APIs, no key required:

- **URLhaus**: https://urlhaus-api.abuse.ch/
- **SSLBL**: https://sslbl.abuse.ch/

**Limits**:
- Fair use policy applies
- No authentication required

## Testing API Configuration

### Test VirusTotal

```bash
curl -X POST http://localhost:9501/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "ip": "8.8.8.8"
  }'
```

### Test OTX

```bash
curl -X POST http://localhost:9501/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "ip": "45.33.32.156"
  }'
```

### Test Abuse.ch

```bash
curl -X POST http://localhost:9501/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://malicious-site.com"
  }'
```

## Redis Cache Configuration

Threat intelligence results are cached in Redis for 24 hours (configurable).

### Cache TTL Settings

Edit `services/threat_intel_aggregator/main.py`:

```python
# Cache TTL configuration
THREAT_INTEL_CACHE_TTL = 86400  # 24 hours (in seconds)
```

### Clear Cache

```bash
# Connect to Redis
docker exec -it security-triage-redis redis-cli

# Clear all threat intel cache
KEYS threatintel:*
# Then for each key: DEL <key>

# Or clear entire database (use with caution)
FLUSHDB
```

## Service Configuration

### Docker Compose Environment Variables

Add to `docker-compose.yml` or `docker-compose.simple.yml`:

```yaml
services:
  threat-intel-aggregator:
    environment:
      VIRUSTOTAL_API_KEY: ${VIRUSTOTAL_API_KEY}
      OTX_API_KEY: ${OTX_API_KEY}
      REDIS_URL: redis://@redis:6379/0
      DATABASE_URL: postgresql+asyncpg://user:pass@postgres:5432/security_triage
```

### Kubernetes ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: threat-intel-config
data:
  VIRUSTOTAL_API_KEY: "your_virustotal_api_key_here"
  OTX_API_KEY: "your_otx_api_key_here"
  THREAT_INTEL_CACHE_TTL: "86400"
```

## Troubleshooting

### Issue: API Key Not Working

**Symptoms**: Threat intel queries return empty results

**Solutions**:
1. Verify API key is correct
2. Check API key hasn't expired
3. Verify rate limits haven't been exceeded
4. Check service logs: `docker logs security-triage-threat-intel-aggregator`

### Issue: High API Usage

**Symptoms**: Reaching rate limits quickly

**Solutions**:
1. Increase cache TTL to reduce API calls
2. Implement batch querying for multiple IOCs
3. Upgrade to premium API tier if needed
4. Use internal IOC database for common threats

### Issue: Outdated Threat Intel

**Symptoms**: Cache returning old data

**Solutions**:
1. Reduce cache TTL for more frequent updates
2. Manually clear cache: `redis-cli FLUSHDB`
3. Check if threat intel source is experiencing delays

### Issue: Redis Connection Failed

**Symptoms**: Service fails to start, logs show "Redis connection error"

**Solutions**:
1. Verify Redis is running: `docker ps | grep redis`
2. Check Redis URL in environment variables
3. Test Redis connection: `redis-cli -h localhost -p 6381 PING`

## API Rate Limits

| Source      | Free Tier Limits                      | Premium Tiers        |
|-------------|---------------------------------------|----------------------|
| VirusTotal  | 500 req/day, 4 req/min              | Up to 1M req/day    |
| OTX         | No rate limit (community)            | Priority access     |
| Abuse.ch    | Fair use (no strict limit)           | Priority access     |

## Security Best Practices

1. **Never commit API keys to version control**
   - Use `.env` files (add to `.gitignore`)
   - Use Docker secrets or Kubernetes secrets
   - Use environment-specific configuration

2. **Rotate API keys regularly**
   - Set calendar reminders for key rotation
   - Document key rotation procedures

3. **Monitor API usage**
   - Set up alerts for rate limit approach
   - Review usage patterns for anomalies
   - Audit API access logs

4. **Use read-only API keys**
   - Avoid API keys with write/delete permissions
   - Create dedicated API keys for this system

## Further Reading

- [VirusTotal API Documentation](https://developers.virustotal.com/reference)
- [AlienVault OTX API](https://otx.alienvault.com/api)
- [Abuse.ch API Documentation](https://abuse.ch/api/)
- [Redis Configuration](https://redis.io/topics/config)
