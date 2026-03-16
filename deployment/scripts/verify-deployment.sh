#!/bin/bash

# 部署验证脚本
# 用于验证 Security Alert Triage System 是否成功部署

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Functions
log_info() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# 获取部署环境
DEPLOYMENT_ENV=${1:-"staging"}
BASE_URL=${2:-"http://localhost"}

echo "=========================================="
echo "  部署验证测试"
echo "=========================================="
echo "环境: $DEPLOYMENT_ENV"
echo "Base URL: $BASE_URL"
echo ""

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
test_endpoint() {
    local test_name=$1
    local endpoint=$2
    local expected_code=${3:-200}

    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    echo -n "测试 $test_name... "

    response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint" --max-time 10)

    if [ "$response" = "$expected_code" ]; then
        log_info "通过 (HTTP $response)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "失败 (预期: $expected_code, 实际: $response)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# 1. 基础设施健康检查
echo "=========================================="
echo "1. 基础设施健康检查"
echo "=========================================="

# Kong Gateway
test_endpoint "Kong Gateway Health" "/health" 200

# PostgreSQL (通过 Kong 暴露的健康检查端点)
test_endpoint "PostgreSQL Health" "/api/v1/health/db" 200 || true

# Redis
test_endpoint "Redis Health" "/api/v1/health/redis" 200 || true

# RabbitMQ
test_endpoint "RabbitMQ Health" "/api/v1/health/rabbitmq" 200 || true

echo ""

# 2. 微服务健康检查
echo "=========================================="
echo "2. 微服务健康检查"
echo "=========================================="

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
    "notification-service"
    "data-analytics"
    "reporting-service"
    "configuration-service"
    "monitoring-metrics"
    "web-dashboard"
)

for service in "${services[@]}"; do
    test_endpoint "$service Service" "/api/$service/health" 200 || true
done

echo ""

# 3. 功能测试
echo "=========================================="
echo "3. 功能测试"
echo "=========================================="

# 测试告警创建
echo -n "测试告警创建 API... "
TOTAL_TESTS=$((TOTAL_TESTS + 1))

response=$(curl -s -X POST "$BASE_URL/api/v1/alerts" \
    -H "Content-Type: application/json" \
    -d '{
        "alert_id": "test-verification-001",
        "alert_type": "malware",
        "severity": "high",
        "title": "Verification Test Alert",
        "description": "Automated verification test",
        "source_ip": "192.168.1.100",
        "destination_ip": "10.0.0.1",
        "iocs": [
            {"type": "ip", "value": "192.168.1.100"}
        ],
        "timestamp": "2026-01-06T15:30:00Z"
    }' \
    -w "%{http_code}" -o /tmp/alert_response.json)

if [ "$response" = "201" ] || [ "$response" = "202" ]; then
    log_info "通过 (HTTP $response)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    log_error "失败 (HTTP $response)"
    cat /tmp/alert_response.json
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# 测试告警查询
echo -n "测试告警查询 API... "
TOTAL_TESTS=$((TOTAL_TESTS + 1))

response=$(curl -s "$BASE_URL/api/v1/alerts?limit=1" -w "%{http_code}" -o /tmp/alerts_query.json)

if [ "$response" = "200" ]; then
    log_info "通过 (HTTP $response)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    log_error "失败 (HTTP $response)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

echo ""

# 4. 性能测试
echo "=========================================="
echo "4. 性能测试"
echo "=========================================="

echo -n "测试 API 响应时间... "
TOTAL_TESTS=$((TOTAL_TESTS + 1))

start_time=$(date +%s%N)
curl -s "$BASE_URL/health" > /dev/null
end_time=$(date +%s%N)

response_time=$((($end_time - $start_time) / 1000000))  # 转换为毫秒

if [ $response_time -lt 1000 ]; then
    log_info "通过 (${response_time}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    log_warn "响应较慢 (${response_time}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))  # 仍然算通过，但警告
fi

echo ""

# 5. Kubernetes 部署检查 (如果是 K8s 部署)
if command -v kubectl &> /dev/null; then
    echo "=========================================="
    echo "5. Kubernetes 集群状态"
    echo "=========================================="

    namespace="security-triage-$DEPLOYMENT_ENV"

    echo -n "检查 Namespace... "
    if kubectl get namespace "$namespace" &> /dev/null; then
        log_info "通过"
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
        PASSED_TESTS=$((PASSED_TESTS + 1))

        echo ""
        echo "Pods 状态:"
        kubectl get pods -n "$namespace"

        echo ""
        echo "Services 状态:"
        kubectl get services -n "$namespace"

        echo ""
        echo -n "检查 Pods 就绪状态... "
        TOTAL_TESTS=$((TOTAL_TESTS + 1))

        not_ready=$(kubectl get pods -n "$namespace" --field-selector=status.phase!=Succeeded -o json | \
                    jq -r '.items[] | select(.status.containerStatuses[]?.ready!=true) | .metadata.name' || true)

        if [ -z "$not_ready" ]; then
            log_info "通过 (所有 Pods 已就绪)"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            log_error "以下 Pods 未就绪:"
            echo "$not_ready"
            FAILED_TESTS=$((FAILED_TESTS + 1))
        fi
    else
        log_warn "Namespace $namespace 不存在，跳过 K8s 检查"
    fi

    echo ""
fi

# 6. Docker Compose 部署检查 (如果是 Docker Compose 部署)
if command -v docker-compose &> /dev/null; then
    echo "=========================================="
    echo "6. Docker Compose 状态"
    echo "=========================================="

    echo "容器状态:"
    docker-compose ps
    echo ""

    echo -n "检查所有容器运行状态... "
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    failed_containers=$(docker-compose ps | grep -E "Exit|exited" || true)

    if [ -z "$failed_containers" ]; then
        log_info "通过 (所有容器正在运行)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        log_error "部分容器未运行:"
        echo "$failed_containers"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi

    echo ""
fi

# 测试结果汇总
echo "=========================================="
echo "  测试结果汇总"
echo "=========================================="
echo ""
echo "总测试数: $TOTAL_TESTS"
echo -e "${GREEN}通过: $PASSED_TESTS${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}失败: $FAILED_TESTS${NC}"
fi
echo ""

# 计算通过率
if [ $TOTAL_TESTS -gt 0 ]; then
    pass_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    echo "通过率: ${pass_rate}%"
    echo ""

    if [ $pass_rate -ge 90 ]; then
        log_info "部署验证通过！✓"
        exit 0
    elif [ $pass_rate -ge 70 ]; then
        log_warn "部署基本成功，但存在问题"
        exit 1
    else
        log_error "部署验证失败"
        exit 1
    fi
else
    log_error "没有执行任何测试"
    exit 1
fi
