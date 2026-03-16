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
# Security Triage System - Deployment Script
################################################################################
#
# This script handles the deployment of the Security Triage System,
# including building images, starting services, and verifying health.
#
# Usage:
#   ./deploy.sh [options] [environment]
#
# Environments:
#   dev     Development environment (default)
#   staging Staging environment
#   prod    Production environment
#
# Options:
#   -b, --build-only      Only build images without starting services
#   -s, --skip-build      Skip building images (use existing)
#   -m, --monitoring       Include monitoring stack (Prometheus, Grafana)
#   -c, --clean           Remove orphaned containers before deploy
#   -v, --verbose         Enable verbose output
#   -h, --help            Show this help message
#
# Examples:
#   ./deploy.sh dev                    # Deploy to development
#   ./deploy.sh prod -m                # Deploy to production with monitoring
#   ./deploy.sh staging -c             # Deploy to staging with cleanup
#
################################################################################

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
ENVIRONMENT="dev"
BUILD_ONLY=false
SKIP_BUILD=false
WITH_MONITORING=false
CLEAN=false
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
Usage: $(basename "$0") [options] [environment]

Deploy the Security Triage System to the specified environment.

Environments:
  dev     Development environment (default)
  staging Staging environment
  prod    Production environment

Options:
  -b, --build-only      Only build images without starting services
  -s, --skip-build      Skip building images (use existing)
  -m, --monitoring       Include monitoring stack (Prometheus, Grafana)
  -c, --clean           Remove orphaned containers before deploy
  -v, --verbose         Enable verbose output
  -h, --help            Show this help message

Examples:
  # Deploy to development
  $(basename "$0") dev

  # Deploy to production with monitoring
  $(basename "$0") prod -m

  # Build only without starting
  $(basename "$0") dev -b

  # Deploy with cleanup
  $(basename "$0") staging -c

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
    if docker compose version &> /dev/null; then
        DOCKER_COMPOSE="docker compose"
    elif command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE="docker-compose"
    else
        log_error "Docker Compose is not installed."
        return 1
    fi
    log_verbose "  ✓ Docker Compose is available"

    # Check if .env exists
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        log_warn ".env file not found. Creating from .env.example..."
        if [ -f "$PROJECT_ROOT/.env.example" ]; then
            cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
            log_warn "Please edit .env with your configuration before proceeding."
            return 1
        else
            log_error ".env.example not found. Please create .env manually."
            return 1
        fi
    fi
    log_verbose "  ✓ .env file found"

    log_info "✓ All prerequisites satisfied"
    return 0
}

load_environment() {
    log_step "Loading environment configuration for: $ENVIRONMENT"

    # Load environment-specific variables
    case "$ENVIRONMENT" in
        dev)
            export COMPOSE_PROJECT_NAME="security-triage-dev"
            export LOG_LEVEL="DEBUG"
            ;;
        staging)
            export COMPOSE_PROJECT_NAME="security-triage-staging"
            export LOG_LEVEL="INFO"
            ;;
        prod)
            export COMPOSE_PROJECT_NAME="security-triage-prod"
            export LOG_LEVEL="WARNING"

            # Production safety checks
            log_warn "Deploying to PRODUCTION environment!"
            log_warn "Please ensure:"
            log_warn "  - All passwords have been changed"
            log_warn "  - TLS/SSL is configured"
            log_warn "  - Backups are enabled"
            log_warn "  - Monitoring is enabled"

            read -p "Continue with production deployment? (yes/no): " confirm
            if [ "$confirm" != "yes" ]; then
                log_error "Deployment cancelled by user"
                exit 1
            fi
            ;;
        *)
            log_error "Unknown environment: $ENVIRONMENT"
            return 1
            ;;
    esac

    log_verbose "  ✓ Environment: $ENVIRONMENT"
    log_verbose "  ✓ Project name: $COMPOSE_PROJECT_NAME"
    log_verbose "  ✓ Log level: $LOG_LEVEL"

    log_info "✓ Environment loaded: $ENVIRONMENT"
}

cleanup() {
    if [ "$CLEAN" = true ]; then
        log_step "Cleaning up orphaned containers..."
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE down --remove-orphans
        log_info "✓ Cleanup complete"
    fi
}

build_images() {
    log_step "Building Docker images..."
    cd "$PROJECT_ROOT"

    local build_args=""

    # Add China mirror for builds in China region
    if curl -s --connect-timeout 2 ipinfo.io/country | grep -iq "CN"; then
        log_info "Detected China region, using mirror sources"
        build_args="--build-arg USE_MIRROR=yes"
    fi

    if [ "$WITH_MONITORING" = true ]; then
        log_info "Building with monitoring stack..."
        $DOCKER_COMPOSE build $build_args
    else
        log_info "Building core services..."
        $DOCKER_COMPOSE build postgres redis rabbitmq chromadb
        $DOCKER_COMPOSE build alert-ingestor alert-normalizer context-collector
        $DOCKER_COMPOSE build threat-intel-aggregator llm-router ai-triage-agent
        $DOCKER_COMPOSE build api-gateway web-dashboard
    fi

    if [ $? -eq 0 ]; then
        log_info "✓ Docker images built successfully"
    else
        log_error "✗ Docker build failed"
        return 1
    fi
}

start_services() {
    log_step "Starting services..."
    cd "$PROJECT_ROOT"

    local services=""

    if [ "$WITH_MONITORING" = true ]; then
        log_info "Starting services with monitoring stack..."
        $DOCKER_COMPOSE --profile monitoring up -d
    else
        log_info "Starting core services..."
        # Start infrastructure first
        $DOCKER_COMPOSE up -d postgres redis rabbitmq chromadb

        # Wait for infrastructure
        log_step "Waiting for infrastructure to be ready..."
        sleep 10

        # Start core pipeline
        $DOCKER_COMPOSE up -d \
            alert-ingestor \
            alert-normalizer \
            context-collector \
            threat-intel-aggregator \
            llm-router \
            ai-triage-agent \
            api-gateway \
            web-dashboard
    fi

    if [ $? -eq 0 ]; then
        log_info "✓ Services started successfully"
    else
        log_error "✗ Failed to start services"
        return 1
    fi
}

verify_deployment() {
    log_step "Verifying deployment..."

    # Wait a bit for services to initialize
    sleep 5

    local services=("postgres" "redis" "rabbitmq" "alert-ingestor" "alert-normalizer"
                   "context-collector" "threat-intel-aggregator" "llm-router" "ai-triage-agent")
    local all_healthy=true

    for service in "${services[@]}"; do
        local container_name="security-triage-${service}"

        if docker ps --format '{{{{.Names}}}}' | grep -q "$container_name"; then
            local status=$(docker inspect --format '{{{{.State.Status}}}}' "$container_name" 2>/dev/null || echo "unknown")
            log_verbose "  ✓ $service: $status"
        else
            log_error "  ✗ $service: not running"
            all_healthy=false
        fi
    done

    if [ "$all_healthy" = true ]; then
        log_info "✓ All core services are running"
    else
        log_warn "Some services may not be fully started yet"
        log_warn "Check logs with: $DOCKER_COMPOSE logs -f [service_name]"
    fi
}

show_summary() {
    echo ""
    echo "=============================================================================="
    echo "✅ Deployment Complete: $ENVIRONMENT"
    echo "=============================================================================="
    echo ""
    echo "📊 Service URLs:"
    echo "  - API Gateway: http://localhost:8000"
    echo "  - Web Dashboard: http://localhost:9015"
    echo "  - RabbitMQ Management: http://localhost:15672 (admin/rabbitmq_password_change_me)"
    echo ""

    if [ "$WITH_MONITORING" = true ]; then
        echo "  - Prometheus: http://localhost:9090"
        echo "  - Grafana: http://localhost:3000 (admin/grafana_password_change_me)"
        echo ""
    fi

    echo "💡 Useful Commands:"
    echo "  - View logs: $DOCKER_COMPOSE logs -f"
    echo "  - View status: $DOCKER_COMPOSE ps"
    echo "  - Stop all: $DOCKER_COMPOSE down"
    echo "  - Restart service: $DOCKER_COMPOSE restart [service_name]"
    echo ""
    echo "📚 Documentation:"
    echo "  - Deployment Guide: docs/DEPLOYMENT.md"
    echo "  - API Documentation: http://localhost:8000/docs"
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
            dev|staging|prod)
                ENVIRONMENT="$1"
                shift
                ;;
            -b|--build-only)
                BUILD_ONLY=true
                shift
                ;;
            -s|--skip-build)
                SKIP_BUILD=true
                shift
                ;;
            -m|--monitoring)
                WITH_MONITORING=true
                shift
                ;;
            -c|--clean)
                CLEAN=true
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
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    echo "=============================================================================="
    echo "🚀 Security Triage System - Deployment"
    echo "=============================================================================="
    echo ""
    log_info "Environment: $ENVIRONMENT"
    log_info "Monitoring: $([ "$WITH_MONITORING" = true ] && echo 'enabled' || echo 'disabled')"
    echo ""

    local start_time=$(date +%s)
    local exit_code=0

    # Check prerequisites
    if ! check_prerequisites; then
        exit_code=1
    else
        # Load environment
        if ! load_environment; then
            exit_code=1
        else
            # Cleanup if requested
            cleanup

            # Build images
            if [ "$SKIP_BUILD" = false ]; then
                if ! build_images; then
                    exit_code=1
                fi
            fi

            # Start services (unless build-only)
            if [ $exit_code -eq 0 ] && [ "$BUILD_ONLY" = false ]; then
                if ! start_services; then
                    exit_code=1
                else
                    # Verify deployment
                    verify_deployment
                fi
            fi
        fi
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        show_summary
        log_info "Total deployment time: ${duration}s"
    else
        echo ""
        log_error "❌ Deployment failed after ${duration}s"
        echo ""
        echo "💡 Troubleshooting:"
        echo "  1. Check logs: $DOCKER_COMPOSE logs [service_name]"
        echo "  2. Check status: $DOCKER_COMPOSE ps"
        echo "  3. Verify .env configuration"
        echo "  4. Check port availability: netstat -tuln | grep LISTEN"
    fi

    echo "=============================================================================="

    exit $exit_code
}

# Run main function
main "$@"
