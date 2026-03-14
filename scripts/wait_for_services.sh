#!/bin/bash
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

################################################################################
# Security Triage System - Service Health Check Script
################################################################################
#
# This script waits for all required infrastructure services to become healthy
# before proceeding with startup or deployment.
#
# Usage:
#   ./wait_for_services.sh [options]
#
# Options:
#   -t, --timeout TIMEOUT     Timeout in seconds (default: 300)
#   -v, --verbose             Enable verbose output
#   -h, --help                Show this help message
#
# Environment Variables:
#   POSTGRES_HOST    PostgreSQL host (default: localhost)
#   POSTGRES_PORT    PostgreSQL port (default: 5432)
#   RABBITMQ_HOST    RabbitMQ host (default: localhost)
#   RABBITMQ_PORT    RabbitMQ port (default: 5672)
#   RABBITMQ_MGMT_PORT RabbitMQ management port (default: 15672)
#   REDIS_HOST       Redis host (default: localhost)
#   REDIS_PORT       Redis port (default: 6379)
#   CHROMADB_HOST    ChromaDB host (default: localhost)
#   CHROMADB_PORT    ChromaDB port (default: 8000)
#
################################################################################

set -euo pipefail

# Default values
TIMEOUT=300
VERBOSE=false
POSTGRES_HOST=${POSTGRES_HOST:-localhost}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
RABBITMQ_HOST=${RABBITMQ_HOST:-localhost}
RABBITMQ_PORT=${RABBITMQ_PORT:-5672}
RABBITMQ_MGMT_PORT=${RABBITMQ_MGMT_PORT:-15672}
REDIS_HOST=${REDIS_HOST:-localhost}
REDIS_PORT=${REDIS_PORT:-6379}
CHROMADB_HOST=${CHROMADB_HOST:-localhost}
CHROMADB_PORT=${CHROMADB_PORT:-8000}

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "[VERBOSE] $1"
    fi
}

show_help() {
    cat << EOF
Usage: $(basename "$0") [options]

Wait for all infrastructure services to become healthy.

Options:
  -t, --timeout TIMEOUT     Timeout in seconds (default: 300)
  -v, --verbose             Enable verbose output
  -h, --help                Show this help message

Environment Variables:
  POSTGRES_HOST         PostgreSQL host (default: localhost)
  POSTGRES_PORT         PostgreSQL port (default: 5432)
  RABBITMQ_HOST         RabbitMQ host (default: localhost)
  RABBITMQ_PORT         RabbitMQ port (default: 5672)
  RABBITMQ_MGMT_PORT    RabbitMQ management port (default: 15672)
  REDIS_HOST            Redis host (default: localhost)
  REDIS_PORT            Redis port (default: 6379)
  CHROMADB_HOST         ChromaDB host (default: localhost)
  CHROMADB_PORT         ChromaDB port (default: 8000)

Examples:
  # Wait with default timeout (300 seconds)
  $(basename "$0")

  # Wait with custom timeout
  $(basename "$0") --timeout 600

  # Wait with verbose output
  $(basename "$0") --verbose

EOF
}

################################################################################
# Health Check Functions
################################################################################

check_postgres() {
    local host=$1
    local port=$2
    local timeout=$3

    log_verbose "Checking PostgreSQL at ${host}:${port}..."

    if command -v pg_isready &> /dev/null; then
        if pg_isready -h "$host" -p "$port" -t "$timeout" &> /dev/null; then
            log_info "✓ PostgreSQL is ready at ${host}:${port}"
            return 0
        else
            log_error "✗ PostgreSQL is not ready at ${host}:${port}"
            return 1
        fi
    else
        # Fallback: use nc if pg_isready is not available
        if nc -z "$host" "$port" 2>/dev/null; then
            log_info "✓ PostgreSQL is reachable at ${host}:${port}"
            return 0
        else
            log_error "✗ PostgreSQL is not reachable at ${host}:${port}"
            return 1
        fi
    fi
}

check_rabbitmq() {
    local host=$1
    local port=$2
    local mgmt_port=$3
    local timeout=$4

    log_verbose "Checking RabbitMQ at ${host}:${port}..."

    # Check AMQP port
    if nc -z "$host" "$port" 2>/dev/null; then
        log_info "✓ RabbitMQ AMQP is reachable at ${host}:${port}"
    else
        log_error "✗ RabbitMQ AMQP is not reachable at ${host}:${port}"
        return 1
    fi

    # Check Management UI
    if nc -z "$host" "$mgmt_port" 2>/dev/null; then
        log_info "✓ RabbitMQ Management UI is reachable at ${host}:${mgmt_port}"
    else
        log_warn "⚠ RabbitMQ Management UI is not reachable at ${host}:${mgmt_port}"
    fi

    return 0
}

check_redis() {
    local host=$1
    local port=$2
    local timeout=$3

    log_verbose "Checking Redis at ${host}:${port}..."

    # Use redis-cli if available, otherwise fallback to nc
    if command -v redis-cli &> /dev/null; then
        if redis-cli -h "$host" -p "$port" ping &> /dev/null; then
            log_info "✓ Redis is ready at ${host}:${port}"
            return 0
        else
            log_error "✗ Redis is not ready at ${host}:${port}"
            return 1
        fi
    else
        # Fallback: use nc
        if nc -z "$host" "$port" 2>/dev/null; then
            log_info "✓ Redis is reachable at ${host}:${port}"
            return 0
        else
            log_error "✗ Redis is not reachable at ${host}:${port}"
            return 1
        fi
    fi
}

check_chromadb() {
    local host=$1
    local port=$2
    local timeout=$3

    log_verbose "Checking ChromaDB at ${host}:${port}..."

    # ChromaDB exposes an HTTP API
    local url="http://${host}:${port}/api/v1/heartbeat"

    if command -v curl &> /dev/null; then
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

        if [ "$http_code" = "200" ] || [ "$http_code" = "404" ]; then
            # 404 is acceptable - older ChromaDB versions don't have /api/v1/heartbeat
            log_info "✓ ChromaDB is reachable at ${host}:${port}"
            return 0
        else
            log_error "✗ ChromaDB is not ready at ${host}:${port} (HTTP code: $http_code)"
            return 1
        fi
    else
        # Fallback: use nc
        if nc -z "$host" "$port" 2>/dev/null; then
            log_info "✓ ChromaDB is reachable at ${host}:${port}"
            return 0
        else
            log_error "✗ ChromaDB is not reachable at ${host}:${port}"
            return 1
        fi
    fi
}

wait_for_service() {
    local service_name=$1
    local check_func=$2
    shift 2
    local args=("$@")

    local elapsed=0
    local interval=5

    log_info "Waiting for ${service_name}... (timeout: ${TIMEOUT}s)"

    while [ $elapsed -lt $TIMEOUT ]; do
        if $check_func "${args[@]}" 2>/dev/null; then
            return 0
        fi

        log_verbose "  ${service_name} not ready yet... (${elapsed}s/${TIMEOUT}s)"
        sleep $interval
        elapsed=$((elapsed + interval))
    done

    log_error "Timeout waiting for ${service_name} after ${TIMEOUT}s"
    return 1
}

################################################################################
# Main Function
################################################################################

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--timeout)
                TIMEOUT="$2"
                shift 2
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    echo "=============================================================================="
    echo "🔍 Security Triage System - Service Health Check"
    echo "=============================================================================="
    echo ""
    log_info "Waiting for infrastructure services to be ready..."
    log_info "Timeout: ${TIMEOUT}s"
    echo ""

    local start_time=$(date +%s)
    local exit_code=0

    # Wait for PostgreSQL
    if ! wait_for_service "PostgreSQL" check_postgres "$POSTGRES_HOST" "$POSTGRES_PORT" "$TIMEOUT"; then
        exit_code=1
    fi

    # Wait for RabbitMQ
    if ! wait_for_service "RabbitMQ" check_rabbitmq "$RABBITMQ_HOST" "$RABBITMQ_PORT" "$RABBITMQ_MGMT_PORT" "$TIMEOUT"; then
        exit_code=1
    fi

    # Wait for Redis
    if ! wait_for_service "Redis" check_redis "$REDIS_HOST" "$REDIS_PORT" "$TIMEOUT"; then
        exit_code=1
    fi

    # Wait for ChromaDB
    if ! wait_for_service "ChromaDB" check_chromadb "$CHROMADB_HOST" "$CHROMADB_PORT" "$TIMEOUT"; then
        exit_code=1
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    echo ""
    echo "=============================================================================="

    if [ $exit_code -eq 0 ]; then
        log_info "✅ All services are healthy! (wait time: ${duration}s)"
        echo ""
        echo "Service URLs:"
        echo "  - PostgreSQL:        ${POSTGRES_HOST}:${POSTGRES_PORT}"
        echo "  - RabbitMQ:          ${RABBITMQ_HOST}:${RABBITMQ_PORT}"
        echo "  - RabbitMQ Mgmt UI:  http://${RABBITMQ_HOST}:${RABBITMQ_MGMT_PORT}"
        echo "  - Redis:             ${REDIS_HOST}:${REDIS_PORT}"
        echo "  - ChromaDB:          http://${CHROMADB_HOST}:${CHROMADB_PORT}"
        echo ""
        echo "💡 Next steps:"
        echo "  1. Initialize database: psql -U postgres -d security_triage -f scripts/init_db.sql"
        echo "  2. Create RabbitMQ queues: python3 scripts/create_queues.py"
        echo "  3. Start the services: docker-compose up -d"
    else
        log_error "❌ Some services failed health check"
        echo ""
        echo "💡 Troubleshooting:"
        echo "  1. Check if services are running: docker-compose ps"
        echo "  2. View service logs: docker-compose logs [service_name]"
        echo "  3. Start services: docker-compose up -d"
        echo ""
        echo "Service status:"
        docker-compose ps || echo "  (docker-compose not available)"
    fi

    echo "=============================================================================="

    exit $exit_code
}

# Run main function
main "$@"
