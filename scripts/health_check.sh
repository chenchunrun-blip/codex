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
# Security Triage System - Health Check Script
################################################################################
#
# This script performs comprehensive health checks on all services
# in the Security Triage System.
#
# Usage:
#   ./health_check.sh [options]
#
# Options:
#   -s, --service NAME    Check specific service only
#   -w, --watch           Continuously monitor health (refresh every 5s)
#   -j, --json            Output results in JSON format
#   -v, --verbose         Show detailed health information
#   -h, --help            Show this help message
#
################################################################################

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
TARGET_SERVICE=""
WATCH_MODE=false
JSON_OUTPUT=false
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

show_help() {
    cat << EOF
Usage: $(basename "$0") [options]

Perform health checks on Security Triage System services.

Options:
  -s, --service NAME    Check specific service only
  -w, --watch           Continuously monitor health (refresh every 5s)
  -j, --json            Output results in JSON format
  -v, --verbose         Show detailed health information
  -h, --help            Show this help message

Available Services:
  Infrastructure: postgres, redis, rabbitmq, chromadb
  Core Pipeline: alert-ingestor, alert-normalizer, context-collector,
                 threat-intel-aggregator, llm-router, ai-triage-agent
  Support Services: api-gateway, web-dashboard, similarity-search, etc.

Examples:
  # Check all services
  $(basename "$0")

  # Check specific service
  $(basename "$0") -s ai-triage-agent

  # Watch mode (continuous monitoring)
  $(basename "$0") -w

EOF
}

get_service_port() {
    local service=$1
    case "$service" in
        postgres) echo "5432" ;;
        redis) echo "6379" ;;
        rabbitmq) echo "5672" ;;
        chromadb) echo "8001" ;;
        alert-ingestor) echo "9001" ;;
        alert-normalizer) echo "9002" ;;
        context-collector) echo "9003" ;;
        threat-intel-aggregator) echo "9004" ;;
        llm-router) echo "9005" ;;
        ai-triage-agent) echo "9006" ;;
        similarity-search) echo "9007" ;;
        workflow-engine) echo "9008" ;;
        automation-orchestrator) echo "9009" ;;
        configuration-service) echo "9010" ;;
        data-analytics) echo "9011" ;;
        reporting-service) echo "9012" ;;
        notification-service) echo "9013" ;;
        monitoring-metrics) echo "9014" ;;
        web-dashboard) echo "9015" ;;
        api-gateway) echo "8000" ;;
        *) echo "unknown" ;;
    esac
}

get_health_endpoint() {
    local service=$1
    case "$service" in
        api-gateway) echo "http://localhost:8000/health" ;;
        alert-ingestor) echo "http://localhost:9001/health" ;;
        alert-normalizer) echo "http://localhost:9002/health" ;;
        context-collector) echo "http://localhost:9003/health" ;;
        threat-intel-aggregator) echo "http://localhost:9004/health" ;;
        llm-router) echo "http://localhost:9005/health" ;;
        ai-triage-agent) echo "http://localhost:9006/health" ;;
        *) echo "" ;;
    esac
}

check_service_health() {
    local service=$1
    local container_name="security-triage-${service}"
    local status="unknown"
    local status_icon="?"
    local status_color="${RED}"

    # Check if container exists
    if ! docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${container_name}$"; then
        status="not_found"
        status_icon="✗"
        status_color="${RED}"
    elif ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container_name}$"; then
        status="stopped"
        status_icon="✗"
        status_color="${RED}"
    else
        # Check container health status
        local health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "unknown")

        case "$health_status" in
            healthy)
                status="healthy"
                status_icon="✓"
                status_color="${GREEN}"
                ;;
            unhealthy)
                status="unhealthy"
                status_icon="✗"
                status_color="${RED}"
                ;;
            starting)
                status="starting"
                status_icon="⧖"
                status_color="${YELLOW}"
                ;;
            *)
                status="running"
                status_icon="✓"
                status_color="${GREEN}"
                ;;
        esac
    fi

    # Check HTTP endpoint if configured and container is healthy
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
        local endpoint=$(get_health_endpoint "$service")
        if [ -n "$endpoint" ] && command -v curl >/dev/null 2>&1; then
            local http_code=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint" --connect-timeout 3 --max-time 5 2>/dev/null || echo "000")
            if [ "$http_code" != "200" ]; then
                status="http_error_${http_code}"
                status_icon="✗"
                status_color="${RED}"
            fi
        fi
    fi

    # Output result
    echo -e "${status_color}${status_icon}${NC} ${service}: ${status}"

    # Verbose output
    if [ "$VERBOSE" = true ] && [ "$status" != "not_found" ]; then
        local port=$(get_service_port "$service")
        local endpoint=$(get_health_endpoint "$service")

        echo "  Container: ${container_name}"
        echo "  Port: ${port}"
        echo "  Health Endpoint: ${endpoint:-N/A}"

        # Show uptime if running
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container_name}$"; then
            local uptime=$(docker exec "$container_name" uptime -p 2>/dev/null || echo "N/A")
            echo "  Uptime: ${uptime}"
        fi
        echo ""
    fi

    # Return status
    [ "$status" = "healthy" ] || [ "$status" = "running" ]
}

check_all_services() {
    local services=(
        "postgres"
        "redis"
        "rabbitmq"
        "chromadb"
        "alert-ingestor"
        "alert-normalizer"
        "context-collector"
        "threat-intel-aggregator"
        "llm-router"
        "ai-triage-agent"
        "api-gateway"
        "web-dashboard"
    )

    local healthy=0
    local total=0

    for service in "${services[@]}"; do
        if [ -z "$TARGET_SERVICE" ] || [ "$TARGET_SERVICE" = "$service" ]; then
            total=$((total + 1))
            if check_service_health "$service"; then
                healthy=$((healthy + 1))
            fi
        fi
    done

    # Return summary
    return $((total - healthy))
}

output_summary() {
    echo ""
    echo "=============================================================================="
    echo "Health Check Complete"
    echo "=============================================================================="
    echo "Timestamp: $(date)"
    echo ""
}

################################################################################
# Main Function
################################################################################

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -s|--service)
                TARGET_SERVICE="$2"
                shift 2
                ;;
            -w|--watch)
                WATCH_MODE=true
                shift
                ;;
            -j|--json)
                JSON_OUTPUT=true
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

    # Watch mode
    if [ "$WATCH_MODE" = true ]; then
        while true; do
            clear
            echo "=============================================================================="
            echo "Security Triage System - Health Check (Watch Mode)"
            echo "=============================================================================="
            echo "Last Update: $(date)"
            echo "Press Ctrl+C to exit"
            echo "=============================================================================="
            echo ""

            check_all_services || true
            output_summary

            sleep 5
        done
    fi

    # Single run mode
    if [ "$JSON_OUTPUT" = false ]; then
        echo "=============================================================================="
        echo "Security Triage System - Health Check"
        echo "=============================================================================="
        echo "Timestamp: $(date)"
        echo "=============================================================================="
        echo ""
    fi

    check_all_services
    local failed=$?

    if [ "$JSON_OUTPUT" = false ]; then
        output_summary
        if [ $failed -eq 0 ]; then
            log_info "All services are healthy"
        else
            log_warn "$failed service(s) may have issues"
        fi
    fi

    exit $failed
}

# Run main function
main "$@"
