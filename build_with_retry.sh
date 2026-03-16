#!/bin/bash

# Docker Build with Retry Script
# Handles Debian mirror failures by retrying with backoff

set -e

SERVICE=${1:-"alert-normalizer"}
MAX_RETRIES=3
RETRY_DELAY=30

echo "========================================="
echo "Building with retry: $SERVICE"
echo "========================================="
echo ""

for attempt in $(seq 1 $MAX_RETRIES); do
    echo "Attempt $attempt/$MAX_RETRIES: Building $SERVICE..."

    if docker-compose build "$SERVICE" 2>&1 | tee "/tmp/${SERVICE}_build_attempt_${attempt}.log"; then
        echo ""
        echo "========================================="
        echo "✅ SUCCESS: $SERVICE built successfully!"
        echo "========================================="
        exit 0
    else
        echo ""
        echo "❌ Attempt $attempt failed"

        # Check if it's a network error (502 Bad Gateway)
        if grep -q "502 Bad Gateway" "/tmp/${SERVICE}_build_attempt_${attempt}.log"; then
            echo "Network error detected (Debian mirror issue)"
            echo "Waiting ${RETRY_DELAY}s before retry..."
            echo ""

            if [ $attempt -lt $MAX_RETRIES ]; then
                sleep $RETRY_DELAY
                RETRY_DELAY=$((RETRY_DELAY + 30))  # Increase delay for next retry
            fi
        else
            echo "Non-network error. Check logs:"
            echo "  /tmp/${SERVICE}_build_attempt_${attempt}.log"
            exit 1
        fi
    fi
done

echo ""
echo "========================================="
echo "❌ FAILED: $SERVICE failed after $MAX_RETRIES attempts"
echo "========================================="
echo ""
echo "Suggestions:"
echo "1. Try again later (Debian mirrors may be down)"
echo "2. Increase Docker memory allocation"
echo "3. Check internet connection"
echo "4. Use pre-built images if available"
exit 1
