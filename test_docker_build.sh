#!/bin/bash

# Docker Build Test Script
# Tests Docker build for services incrementally

set -e

cd "$(dirname "$0")"

echo "🐳 Docker Build Test Script"
echo "============================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test build a single service
test_service_build() {
    local service=$1
    echo -e "${YELLOW}Testing build for: $service${NC}"

    if docker-compose build "$service" 2>&1 | tee "/tmp/${service}_build.log"; then
        echo -e "${GREEN}✓ $service built successfully${NC}"
        return 0
    else
        echo -e "${RED}✗ $service build failed${NC}"
        echo "Check log: /tmp/${service}_build.log"
        return 1
    fi
}

# Parse arguments
if [ $# -eq 0 ]; then
    echo "Usage:"
    echo "  $0 all                    # Build all services"
    echo "  $0 core                   # Build core services only"
    echo "  $0 <service-name>         # Build specific service"
    echo ""
    echo "Examples:"
    echo "  $0 context-collector"
    echo "  $0 core"
    echo "  $0 all"
    exit 0
fi

if [ "$1" = "all" ]; then
    echo "Building all services (this will take a while)..."
    echo ""

    services=(
        "alert-ingestor"
        "alert-normalizer"
        "context-collector"
        "threat-intel-aggregator"
        "llm-router"
        "ai-triage-agent"
        "similarity-search"
        "workflow-engine"
        "automation-orchestrator"
        "configuration-service"
        "data-analytics"
        "reporting-service"
        "notification-service"
        "monitoring-metrics"
        "web-dashboard"
    )

    failed=0
    for service in "${services[@]}"; do
        if ! test_service_build "$service"; then
            ((failed++))
        fi
        echo ""
    done

    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}✅ All services built successfully!${NC}"
    else
        echo -e "${RED}❌ $failed service(s) failed to build${NC}"
        exit 1
    fi

elif [ "$1" = "core" ]; then
    echo "Building core pipeline services..."
    echo ""

    core_services=(
        "alert-ingestor"
        "alert-normalizer"
        "context-collector"
        "threat-intel-aggregator"
        "ai-triage-agent"
    )

    failed=0
    for service in "${core_services[@]}"; do
        if ! test_service_build "$service"; then
            ((failed++))
        fi
        echo ""
    done

    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}✅ All core services built successfully!${NC}"
    else
        echo -e "${RED}❌ $failed service(s) failed to build${NC}"
        exit 1
    fi

else
    # Build specific service
    service=$1
    if ! test_service_build "$service"; then
        exit 1
    fi
fi

echo ""
echo "Build test completed!"
