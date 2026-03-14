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

"""
API Gateway Startup Script.

This script starts the API Gateway service with proper configuration.
"""

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Security Triage System - API Gateway${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Default values
PORT="${PORT:-8080}"
HOST="${HOST:-0.0.0.0}"
WORKERS="${WORKERS:-1}"
LOG_LEVEL="${LOG_LEVEL:-info}"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Virtual environment not found. Creating...${NC}"
    python3 -m venv venv
    source venv/bin/activate
    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    echo -e "${GREEN}Virtual environment created and dependencies installed.${NC}"
else
    echo -e "${GREEN}Virtual environment found.${NC}"
fi

# Activate virtual environment
source venv/bin/activate

# Create data directory if it doesn't exist
mkdir -p data

# Set environment variables
export DATABASE_URL="${DATABASE_URL:-sqlite+aiosqlite:///data/triage.db}"
export PYTHONPATH="${PYTHONPATH}:/Users/newmba/security:/Users/newmba/security/services"

# Show configuration
echo ""
echo -e "${GREEN}Configuration:${NC}"
echo -e "  Host: ${HOST}"
echo -e "  Port: ${PORT}"
echo -e "  Workers: ${WORKERS}"
echo -e "  Log Level: ${LOG_LEVEL}"
echo -e "  Database: ${DATABASE_URL}"
echo ""

# Check if database exists
if [ ! -f "data/triage.db" ]; then
    echo -e "${YELLOW}Database not found. It will be created on first start.${NC}"
fi

echo -e "${GREEN}Starting API Gateway...${NC}"
echo ""

# Start the server
if [ "$WORKERS" -eq 1 ]; then
    # Single worker with auto-reload (development)
    uvicorn main:app \
        --host "${HOST}" \
        --port "${PORT}" \
        --reload \
        --log-level "${LOG_LEVEL}"
else
    # Multiple workers (production)
    uvicorn main:app \
        --host "${HOST}" \
        --port "${PORT}" \
        --workers "${WORKERS}" \
        --log-level "${LOG_LEVEL}"
fi
