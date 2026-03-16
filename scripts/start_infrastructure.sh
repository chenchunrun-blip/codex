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
# Security Triage System - Infrastructure Startup Script
################################################################################
#
# This script orchestrates the startup of all infrastructure services,
# initializes the database, and sets up RabbitMQ queues.
#
# Usage:
#   ./start_infrastructure.sh [options]
#
# Options:
#   -s, --skip-init       Skip database initialization
#   -q, --skip-queues     Skip RabbitMQ queue setup
#   -v, --verbose         Enable verbose output
#   -h, --help            Show this help message
#
# Prerequisites:
#   - Docker and Docker Compose must be installed
#   - Port 5432, 5672, 15672, 6379, 8000 must be available
#
################################################################################

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
SKIP_INIT=false
SKIP_QUEUES=false
VERBOSE=false

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_step() {
    echo -e "${BLUE}===>${NC} $1"
}

log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "[VERBOSE] $1"
    fi
}

show_help() {
    cat << EOF
Usage: $(basename "$0") [options]

Orchestrate the startup of all infrastructure services for the Security Triage System.

Options:
  -s, --skip-init       Skip database initialization
  -q, --skip-queues     Skip RabbitMQ queue setup
  -v, --verbose         Enable verbose output
  -h, --help            Show this help message

Prerequisites:
  - Docker and Docker Compose must be installed
  - Ports 5432, 5672, 15672, 6379, 8000 must be available

Environment Variables:
  COMPOSE_FILE    Docker Compose file path (default: docker-compose.yml)
  POSTGRES_USER   PostgreSQL user for initialization (default: postgres)
  POSTGRES_DB     PostgreSQL database name (default: security_triage)

Examples:
  # Start all infrastructure with database and queues
  $(basename "$0")

  # Start infrastructure but skip initialization
  $(basename "$0") --skip-init --skip-queues

  # Start with verbose output
  $(basename "$0") --verbose

EOF
}

check_prerequisites() {
    log_step "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        return 1
    fi
    log_verbose "  ✓ Docker is installed: $(docker --version)"

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        return 1
    fi

    # Determine which docker-compose command to use
    if docker compose version &> /dev/null; then
        DOCKER_COMPOSE="docker compose"
    else
        DOCKER_COMPOSE="docker-compose"
    fi

    log_verbose "  ✓ Docker Compose is available"

    # Check if docker-compose file exists
    if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ] && [ ! -f "$PROJECT_ROOT/docker-compose.yaml" ]; then
        log_error "docker-compose.yml not found in $PROJECT_ROOT"
        log_error "Please ensure you're in the correct directory."
        return 1
    fi
    log_verbose "  ✓ docker-compose.yml found"

    log_info "✓ All prerequisites satisfied"
    return 0
}

start_infrastructure() {
    log_step "Starting infrastructure services..."
    cd "$PROJECT_ROOT"

    # Start services
    if [ "$VERBOSE" = true ]; then
        $DOCKER_COMPOSE up -d
    else
        $DOCKER_COMPOSE up -d --quiet
    fi

    # Check if services started successfully
    if [ $? -eq 0 ]; then
        log_info "✓ Infrastructure services started"
    else
        log_error "✗ Failed to start infrastructure services"
        return 1
    fi

    # Show running services
    echo ""
    log_info "Running services:"
    $DOCKER_COMPOSE ps
    echo ""
}

initialize_database() {
    if [ "$SKIP_INIT" = true ]; then
        log_warn "Skipping database initialization (--skip-init flag)"
        return 0
    fi

    log_step "Initializing database..."

    # Wait for PostgreSQL to be ready
    log_info "Waiting for PostgreSQL to be ready..."
    local max_attempts=60
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker exec security-triage-postgres pg_isready -U postgres &> /dev/null; then
            log_verbose "  PostgreSQL is ready"
            break
        fi

        attempt=$((attempt + 1))
        log_verbose "  Waiting for PostgreSQL... (${attempt}/${max_attempts})"
        sleep 2
    done

    if [ $attempt -eq $max_attempts ]; then
        log_error "PostgreSQL did not become ready in time"
        return 1
    fi

    # Run database initialization script
    log_info "Running database initialization script..."

    if [ -f "$SCRIPT_DIR/init_db.sql" ]; then
        docker exec -i security-triage-postgres psql -U postgres -d security_triage < "$SCRIPT_DIR/init_db.sql"

        if [ $? -eq 0 ]; then
            log_info "✓ Database initialized successfully"
        else
            log_error "✗ Database initialization failed"
            return 1
        fi
    else
        log_error "init_db.sql not found in $SCRIPT_DIR"
        return 1
    fi
}

setup_rabbitmq_queues() {
    if [ "$SKIP_QUEUES" = true ]; then
        log_warn "Skipping RabbitMQ queue setup (--skip-queues flag)"
        return 0
    fi

    log_step "Setting up RabbitMQ queues..."

    # Wait for RabbitMQ to be ready
    log_info "Waiting for RabbitMQ to be ready..."
    local max_attempts=60
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker exec security-triage-rabbitmq rabbitmq-diagnostics -q ping &> /dev/null; then
            log_verbose "  RabbitMQ is ready"
            break
        fi

        attempt=$((attempt + 1))
        log_verbose "  Waiting for RabbitMQ... (${attempt}/${max_attempts})"
        sleep 2
    done

    if [ $attempt -eq $max_attempts ]; then
        log_error "RabbitMQ did not become ready in time"
        return 1
    fi

    # Run queue creation script
    log_info "Creating RabbitMQ queues and exchanges..."

    if [ -f "$SCRIPT_DIR/create_queues.py" ]; then
        docker exec -i security-triage-rabbitmq python3 /scripts/create_queues.py

        if [ $? -eq 0 ]; then
            log_info "✓ RabbitMQ queues created successfully"
        else
            log_error "✗ RabbitMQ queue setup failed"
            return 1
        fi
    else
        log_error "create_queues.py not found in $SCRIPT_DIR"
        return 1
    fi
}

verify_setup() {
    log_step "Verifying infrastructure setup..."

    # Check service health
    local services=("postgres" "rabbitmq" "redis" "chromadb")
    local all_healthy=true

    for service in "${services[@]}"; do
        local container_name="security-triage-${service}"

        if docker ps --format '{{{{.Names}}}}' | grep -q "^${container_name}$"; then
            local status=$(docker inspect --format '{{{{.State.Health.Status}}}}' "$container_name" 2>/dev/null || echo "running")
            log_info "  ✓ $service: $status"
        else
            log_error "  ✗ $service: not running"
            all_healthy=false
        fi
    done

    if [ "$all_healthy" = true ]; then
        log_info "✓ All infrastructure services are healthy"
        return 0
    else
        log_error "✗ Some infrastructure services are not healthy"
        return 1
    fi
}

show_summary() {
    echo ""
    echo "=============================================================================="
    echo "✅ Infrastructure Setup Complete"
    echo "=============================================================================="
    echo ""
    echo "📊 Service URLs:"
    echo "  - PostgreSQL:"
    echo "    Host: localhost"
    echo "    Port: 5432"
    echo "    Database: security_triage"
    echo "    Connection: psql -h localhost -U postgres -d security_triage"
    echo ""
    echo "  - RabbitMQ:"
    echo "    AMQP Port: 5672"
    echo "    Management UI: http://localhost:15672"
    echo "    Username: admin"
    echo "    Password: (see docker-compose.yml)"
    echo ""
    echo "  - Redis:"
    echo "    Port: 6379"
    echo "    Connection: redis-cli -h localhost -p 6379"
    echo ""
    echo "  - ChromaDB:"
    echo "    URL: http://localhost:8000"
    echo ""
    echo "💡 Next Steps:"
    echo "  1. Start application services:"
    echo "     cd $PROJECT_ROOT"
    echo "     $DOCKER_COMPOSE up -d alert_ingestor alert_normalizer ..."
    echo ""
    echo "  2. View logs:"
    echo "     $DOCKER_COMPOSE logs -f [service_name]"
    echo ""
    echo "  3. Stop infrastructure:"
    echo "     $DOCKER_COMPOSE down"
    echo ""
    echo "📚 Documentation:"
    echo "  - Database Schema: docs/04_database_design.md"
    echo "  - Architecture: docs/01_architecture_overview.md"
    echo ""
    echo "=============================================================================="
}

################################################################################
# Main Function
################################################################################

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -s|--skip-init)
                SKIP_INIT=true
                shift
                ;;
            -q|--skip-queues)
                SKIP_QUEUES=true
                shift
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
    echo "🚀 Security Triage System - Infrastructure Startup"
    echo "=============================================================================="
    echo ""
    log_info "Starting infrastructure services and setup..."
    echo ""

    local start_time=$(date +%s)
    local exit_code=0

    # Check prerequisites
    if ! check_prerequisites; then
        exit_code=1
    else
        # Start infrastructure services
        if ! start_infrastructure; then
            exit_code=1
        else
            # Wait for services to be healthy
            log_step "Waiting for services to be healthy..."
            "$SCRIPT_DIR/wait_for_services.sh" || exit_code=1

            # Initialize database
            if ! initialize_database; then
                exit_code=1
            fi

            # Setup RabbitMQ queues
            if ! setup_rabbitmq_queues; then
                exit_code=1
            fi

            # Verify setup
            if ! verify_setup; then
                exit_code=1
            fi
        fi
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        show_summary
        log_info "Total time: ${duration}s"
    else
        echo ""
        log_error "❌ Infrastructure setup failed after ${duration}s"
        echo ""
        echo "💡 Troubleshooting:"
        echo "  1. Check service logs: $DOCKER_COMPOSE logs"
        echo "  2. Restart services: $DOCKER_COMPOSE restart"
        echo "  3. View service status: $DOCKER_COMPOSE ps"
    fi

    echo "=============================================================================="

    exit $exit_code
}

# Run main function
main "$@"
