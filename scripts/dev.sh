#!/usr/bin/env bash
# =============================================================================
# Development helper script for Security Triage System
# =============================================================================
# Usage:
#   ./scripts/dev.sh up              Start core services
#   ./scripts/dev.sh up --monitoring  Start core + Prometheus/Grafana
#   ./scripts/dev.sh down            Stop all services
#   ./scripts/dev.sh down -v         Stop and remove volumes
#   ./scripts/dev.sh restart [svc]   Restart a service (or all)
#   ./scripts/dev.sh rebuild [svc]   Rebuild and restart a service (or all)
#   ./scripts/dev.sh logs [svc]      Follow logs (default: all)
#   ./scripts/dev.sh status          Show service status
#   ./scripts/dev.sh health          Check health of all services
#   ./scripts/dev.sh psql            Connect to PostgreSQL
#   ./scripts/dev.sh redis           Connect to Redis CLI
#   ./scripts/dev.sh shell [svc]     Open a shell in a running service
# =============================================================================

set -euo pipefail

COMPOSE_FILE="docker-compose.dev.yml"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Ensure .env exists
if [ ! -f .env ]; then
    echo "No .env file found. Copying .env.dev as default..."
    cp .env.dev .env
fi

COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"

case "${1:-help}" in

  up)
    shift
    if [[ "${1:-}" == "--monitoring" || "${1:-}" == "-m" ]]; then
      echo "Starting core services + monitoring..."
      $COMPOSE_CMD --profile monitoring up -d --build
    else
      echo "Starting core services..."
      $COMPOSE_CMD up -d --build "$@"
    fi
    echo ""
    echo "Services starting. Run './scripts/dev.sh status' to check."
    echo ""
    echo "Endpoints:"
    echo "  Alert Ingestor    http://localhost:9001/health"
    echo "  Alert Normalizer  http://localhost:9002/health"
    echo "  Context Collector http://localhost:9003/health"
    echo "  Threat Intel      http://localhost:9004/health"
    echo "  LLM Router        http://localhost:9005/health"
    echo "  AI Triage Agent   http://localhost:9006/health"
    echo "  Similarity Search http://localhost:9007/health"
    echo "  Workflow Engine   http://localhost:9008/health"
    echo "  Automation Orch.  http://localhost:9009/health"
    echo "  Notification Svc  http://localhost:9010/health"
    echo "  RabbitMQ Mgmt     http://localhost:15673  (admin/dev_password)"
    ;;

  down)
    shift
    echo "Stopping services..."
    $COMPOSE_CMD --profile monitoring down "$@"
    ;;

  restart)
    shift
    svc="${1:-}"
    if [ -n "$svc" ]; then
      echo "Restarting $svc..."
      $COMPOSE_CMD restart "$svc"
    else
      echo "Restarting all services..."
      $COMPOSE_CMD restart
    fi
    ;;

  rebuild)
    shift
    svc="${1:-}"
    if [ -n "$svc" ]; then
      echo "Rebuilding and restarting $svc..."
      $COMPOSE_CMD up -d --build "$svc"
    else
      echo "Rebuilding all services..."
      $COMPOSE_CMD up -d --build
    fi
    ;;

  logs)
    shift
    $COMPOSE_CMD logs -f --tail=100 "$@"
    ;;

  status)
    $COMPOSE_CMD ps -a
    ;;

  health)
    echo "Checking service health..."
    echo ""
    services=(
      "Alert Ingestor:9001"
      "Alert Normalizer:9002"
      "Context Collector:9003"
      "Threat Intel:9004"
      "LLM Router:9005"
      "AI Triage Agent:9006"
      "Similarity Search:9007"
      "Workflow Engine:9008"
      "Automation Orch.:9009"
      "Notification Svc:9010"
    )
    for entry in "${services[@]}"; do
      name="${entry%%:*}"
      port="${entry##*:}"
      if curl -sf "http://localhost:${port}/health" > /dev/null 2>&1; then
        printf "  %-22s :%-5s  OK\n" "$name" "$port"
      else
        printf "  %-22s :%-5s  DOWN\n" "$name" "$port"
      fi
    done
    echo ""
    # Infrastructure
    echo "Infrastructure:"
    for entry in "PostgreSQL:5434" "Redis:6381" "RabbitMQ:15673" "ChromaDB:8001"; do
      name="${entry%%:*}"
      port="${entry##*:}"
      if curl -sf "http://localhost:${port}/" > /dev/null 2>&1 || \
         pg_isready -h localhost -p "$port" > /dev/null 2>&1 || \
         redis-cli -h localhost -p "$port" ping > /dev/null 2>&1; then
        printf "  %-22s :%-5s  OK\n" "$name" "$port"
      else
        printf "  %-22s :%-5s  --\n" "$name" "$port"
      fi
    done
    ;;

  psql)
    echo "Connecting to PostgreSQL..."
    docker exec -it dev-postgres psql -U triage_user -d security_triage
    ;;

  redis)
    echo "Connecting to Redis..."
    docker exec -it dev-redis redis-cli -a "${REDIS_PASSWORD:-dev_password}"
    ;;

  shell)
    shift
    svc="${1:?Usage: dev.sh shell <service-name>}"
    echo "Opening shell in $svc..."
    docker exec -it "dev-${svc}" /bin/bash || docker exec -it "dev-${svc}" /bin/sh
    ;;

  help|--help|-h|*)
    echo "Usage: ./scripts/dev.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  up [--monitoring]    Start services (add --monitoring for Prometheus/Grafana)"
    echo "  down [-v]            Stop services (add -v to remove volumes)"
    echo "  restart [service]    Restart one or all services"
    echo "  rebuild [service]    Rebuild and restart one or all services"
    echo "  logs [service]       Follow service logs"
    echo "  status               Show container status"
    echo "  health               Check health endpoints"
    echo "  psql                 Connect to PostgreSQL"
    echo "  redis                Connect to Redis CLI"
    echo "  shell <service>      Open a shell in a running container"
    ;;
esac
