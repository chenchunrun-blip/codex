#!/bin/bash

# Docker Resource Check Script

echo "========================================="
echo "Docker Resource Diagnostic"
echo "========================================="
echo ""

echo "1. Docker Memory Allocation:"
docker info 2>/dev/null | grep -A 2 "Total Memory" || echo "   Docker not running or not accessible"
echo ""

echo "2. System Memory Usage:"
if command -v free &> /dev/null; then
    free -h
else
    # macOS
    echo "   Note: On macOS, Docker runs in a VM with limited memory"
    echo "   Check Docker Desktop → Settings → Resources → Memory"
fi
echo ""

echo "3. Docker Disk Usage:"
docker system df 2>/dev/null || echo "   Cannot determine"
echo ""

echo "4. Running Containers:"
docker ps -s --format "table {{.Names}}\t{{.Size}}" 2>/dev/null | head -10 || echo "   No containers running"
echo ""

echo "5. Build Cache Usage:"
docker du --format "{{.Type}}: {{.Size}}" 2>/dev/null | grep build || echo "   Cannot determine"
echo ""

echo "========================================="
echo "Recommendations:"
echo "========================================="
echo ""
echo "Minimum Docker Memory: 4 GB"
echo "Recommended Docker Memory: 8 GB"
echo ""
echo "To increase Docker memory on macOS:"
echo "  1. Open Docker Desktop"
echo "  2. Go to Settings → Resources → Advanced"
echo "  3. Increase Memory slider to 8 GB"
echo "  4. Click 'Apply & Restart'"
echo ""
echo "To free up Docker space:"
echo "  docker system prune -a       # Remove unused data"
echo "  docker builder prune -a      # Remove build cache"
echo ""
