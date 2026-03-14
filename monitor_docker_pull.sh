#!/bin/bash

# Monitor Docker image pull progress

echo "=== Docker 镜像拉取监控 ==="
echo ""

check_images=(
    "postgres:15-alpine"
    "redis:7-alpine"
    "rabbitmq:3.12-management-alpine"
    "chromadb/chroma:latest"
    "prom/prometheus:latest"
    "grafana/grafana:latest"
    "kong/kong-gateway:3.5.0.0-alpine"
)

total=${#check_images[@]}
ready=0

echo "检查 $total 个基础设施镜像..."
echo ""

for image in "${check_images[@]}"; do
    if docker images | grep -q "$(echo $image | tr ':/' '  ')"; then
        echo "✅ $image"
        ((ready++))
    else
        echo "⏳ $image (未完成)"
    fi
done

echo ""
echo "进度: $ready/$total ($(( ready * 100 / total ))%)"
echo ""

if [ $ready -eq $total ]; then
    echo "🎉 所有镜像已准备就绪！"
    echo ""
    echo "可以启动服务了："
    echo "  docker-compose up -d"
else
    echo "⚠️  还有 $(( total - ready )) 个镜像需要拉取"
    echo ""
    echo "查看 Docker 拉取进程："
    echo "  ps aux | grep docker"
fi
