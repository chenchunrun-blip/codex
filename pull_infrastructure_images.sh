#!/bin/bash

# Pull Infrastructure Images with Retry
# This script pulls all required infrastructure images with retry logic

set -e

echo "========================================="
echo "Docker 镜像拉取脚本（带重试）"
echo "========================================="
echo ""

# Max retries per image
MAX_RETRIES=3
# Delay between retries (seconds)
RETRY_DELAY=10

# Function to pull image with retry
pull_with_retry() {
    local image=$1
    local attempt=1

    echo "正在拉取: $image"

    while [ $attempt -le $MAX_RETRIES ]; do
        echo "  尝试 $attempt/$MAX_RETRIES..."

        if docker pull "$image" 2>&1; then
            echo "  ✅ 成功: $image"
            return 0
        else
            echo "  ❌ 失败: $image"

            if [ $attempt -lt $MAX_RETRIES ]; then
                echo "  等待 ${RETRY_DELAY} 秒后重试..."
                sleep $RETRY_DELAY
            fi

            ((attempt++))
        fi
    done

    echo "  ❌❌ 最终失败: $image (已尝试 $MAX_RETRIES 次)"
    return 1
}

# List of infrastructure images
images=(
    "postgres:15-alpine"
    "redis:7-alpine"
    "rabbitmq:3.12-management-alpine"
    "chromadb/chroma:latest"
    "prom/prometheus:latest"
    "grafana/grafana:latest"
    "kong/kong-gateway:3.5.0.0-alpine"
)

failed=0

for image in "${images[@]}"; do
    if ! pull_with_retry "$image"; then
        ((failed++))
    fi
    echo ""
done

echo "========================================="
echo "拉取完成！"
echo "========================================="
echo ""

if [ $failed -eq 0 ]; then
    echo "✅ 所有镜像拉取成功！"

    echo ""
    echo "本地镜像列表："
    docker images | grep -E "(postgres|redis|rabbitmq|chromadb|prometheus|grafana|kong)" | head -10

    echo ""
    echo "现在可以启动服务了："
    echo "  docker-compose up -d"
else
    echo "❌ $failed 个镜像拉取失败"
    echo ""
    echo "建议："
    echo "1. 配置 Docker 镜像加速器（推荐）"
    echo "2. 检查网络连接"
    echo "3. 稍后重试"
    exit 1
fi
