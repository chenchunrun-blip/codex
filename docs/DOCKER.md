# Docker Deployment Guide

This guide covers deploying MarqDex using Docker Compose, supporting both development and production environments.

## Quick Start

### Development Mode (with Hot Reload)

```bash
# Start development environment
make dev

# Or using docker compose directly
docker compose -f docker-compose.dev.yml up --build
```

Access the application at http://localhost:3000

### Production Mode

```bash
# Copy environment template
cp .env.docker .env.docker.local

# Edit environment variables
nano .env.docker.local

# Start production environment
make prod

# Or using docker compose directly
docker compose --env-file .env.docker.local up --build -d
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Network                          │
│  marqdex-network / marqdex-dev-network                      │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Nginx     │    │  Next.js    │    │ PostgreSQL  │     │
│  │ (optional)  │───▶│    App      │───▶│  Database   │     │
│  │   :80       │    │   :3000     │    │   :5432     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │  pgAdmin    │    │   Redis     │                        │
│  │  (optional) │    │ (optional)  │                        │
│  │   :5050     │    │   :6379     │                        │
│  └─────────────┘    └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Available Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start development environment |
| `make dev-down` | Stop development environment |
| `make dev-logs` | Show development logs |
| `make prod` | Start production environment |
| `make prod-down` | Stop production environment |
| `make build` | Build all Docker images |
| `make migrate` | Run database migrations (dev) |
| `make seed` | Seed database (dev) |
| `make db-shell` | Open PostgreSQL shell |
| `make shell` | Open shell in app container |
| `make clean` | Remove containers and volumes |
| `make reset` | Full reset (clean + rebuild) |

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `NEXTAUTH_URL` | Public URL of your application | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Secret for NextAuth.js | Generate with `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Key for encrypting sensitive data | 32+ character string |

### Optional Variables

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP server port |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From email address |
| `LIVEBLOCKS_SECRET` | Liveblocks secret key |
| `LIVEBLOCKS_PUBLIC_KEY` | Liveblocks public key |

## Development Features

### Hot Reload

The development setup includes hot reload support. Changes to the following directories will automatically reload the application:

- `app/` - Next.js pages and layouts
- `components/` - React components
- `lib/` - Utility functions
- `prisma/` - Database schema

### Database Management

```bash
# Access PostgreSQL shell
make db-shell

# Run migrations
make migrate

# Seed database
make seed

# Reset database (WARNING: destroys all data)
make db-reset
```

### pgAdmin (Optional)

```bash
# Start pgAdmin
make admin-up

# Access at http://localhost:5050
# Login: admin@marqdex.local / admin
```

### Redis (Optional)

```bash
# Start Redis
make redis-up

# Redis will be available at localhost:6379
```

## Production Deployment

### 1. Prepare Environment

```bash
# Copy and edit environment file
cp .env.docker .env.docker.local
nano .env.docker.local
```

### 2. Configure Security

```bash
# Generate secure secrets
openssl rand -base64 32  # NEXTAUTH_SECRET
openssl rand -base64 32  # ENCRYPTION_KEY

# Set strong database password
DB_PASSWORD=$(openssl rand -base64 24)
```

### 3. Deploy

```bash
# Build and start
make prod

# Check logs
make prod-logs

# Run migrations
make migrate-prod
```

### 4. With Nginx (Recommended)

```bash
# Start with nginx profile
docker compose --env-file .env.docker.local --profile nginx up -d
```

## Docker Compose Profiles

| Profile | Services | Use Case |
|---------|----------|----------|
| (default) | app, postgres | Basic deployment |
| `nginx` | app, postgres, nginx | Production with reverse proxy |
| `admin` | app, postgres, pgadmin | Development with database GUI |
| `cache` | app, postgres, redis | With caching layer |

```bash
# Example: Start with admin and cache
docker compose -f docker-compose.dev.yml --profile admin --profile cache up -d
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs app

# Rebuild from scratch
make clean
make dev
```

### Database connection issues

```bash
# Check database health
docker compose exec postgres pg_isready

# Reset database
make db-reset
```

### Hot reload not working

1. Ensure `WATCHPACK_POLLING=true` in environment
2. Check volume mounts: `docker compose config`
3. Restart containers: `make dev-down && make dev`

### Permission issues

```bash
# Fix ownership (run as root in container)
docker compose exec app chown -R nextjs:nodejs /app
```

## Health Checks

```bash
# Check application health
curl http://localhost:3000/api/health

# Check database connection
docker compose exec postgres pg_isready -U marqdex
```

## Backup and Restore

### Backup Database

```bash
docker compose exec postgres pg_dump -U marqdex marqdex > backup.sql
```

### Restore Database

```bash
cat backup.sql | docker compose exec -T postgres psql -U marqdex marqdex
```

## Scaling

```bash
# Scale application instances
docker compose up -d --scale app=3

# With nginx load balancer
docker compose --profile nginx up -d --scale app=3
```
