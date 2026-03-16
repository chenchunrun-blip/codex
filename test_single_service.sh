#!/bin/bash

# Single Service Build Script
# Builds services one at a time to avoid memory issues

set -e

SERVICE=${1:-"context-collector"}

echo "========================================="
echo "Building Service: $SERVICE"
echo "========================================="
echo ""

# Clean up to free memory
echo "Step 1: Cleaning up Docker resources..."
docker system prune -f
echo ""

# Build the service
echo "Step 2: Building $SERVICE..."
echo "(This may take 3-5 minutes on first build)"
echo ""

if docker-compose build --no-cache "$SERVICE"; then
    echo ""
    echo "========================================="
    echo "✅ SUCCESS: $SERVICE built successfully!"
    echo "========================================="
    echo ""
    echo "Image info:"
    docker images | grep "$SERVICE" || true
else
    echo ""
    echo "========================================="
    echo "❌ FAILED: $SERVICE build failed"
    echo "========================================="
    echo ""
    echo "Troubleshooting:"
    echo "1. Check Docker has enough memory (Settings → Resources → Memory)"
    echo "2. Try closing other applications"
    echo "3. Check disk space: df -h"
    exit 1
fi
