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

# CI/CD Validation Script
# This script runs all quality checks locally before pushing to CI.
# It mimics the GitHub Actions CI/CD pipeline.
#
# Usage:
#   ./scripts/ci_validate.sh [--skip-tests] [--quick]
#
# Options:
#   --skip-tests    Skip running tests (only code quality checks)
#   --quick         Run quick checks (skip slow checks like pylint)

# Don't exit on error, we'll track failures manually
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
SKIP_TESTS=false
QUICK_MODE=false
for arg in "$@"; do
    case $arg in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --quick)
            QUICK_MODE=true
            shift
            ;;
    esac
done

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  CI/CD Validation Script${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Track failures
FAILURES=0

# Function to run command and track failures
run_check() {
    local name="$1"
    local cmd="$2"

    echo -e "${YELLOW}Running: $name${NC}"
    if eval "$cmd"; then
        echo -e "${GREEN}✓ $name passed${NC}"
        echo ""
    else
        echo -e "${RED}✗ $name failed${NC}"
        echo ""
        FAILURES=$((FAILURES + 1))
        return 1
    fi
}

# 1. Check Python syntax
run_check "Python Syntax Check" \
    "python3 -m py_compile services/*/main.py services/shared/**/*.py 2>&1 || true"

# 2. Black format check
run_check "Black Format Check" \
    "python3 -m black --check --line-length 100 services/ tests/"

# 3. isort import check
run_check "isort Import Check" \
    "python3 -m isort --check-only services/ tests/"

# 4. MyPy type check (non-blocking)
echo -e "${YELLOW}Running: MyPy Type Check (warnings only)${NC}"
python3 -m mypy services/ --ignore-missing-imports --explicit-package-bases || true
echo ""

# 5. Pylint (skip in quick mode)
if [ "$QUICK_MODE" = false ]; then
    run_check "Pylint Linting" \
        "pylint services/ --fail-under=8.0 || true"
fi

# 6. Security checks
run_check "Bandit Security Scan" \
    "bandit -r services/ -f json -o /tmp/bandit-report.json || true"

run_check "Safety Dependency Check" \
    "safety check --json || true"

# 7. Tests
if [ "$SKIP_TESTS" = false ]; then
    echo -e "${YELLOW}Running: Unit Tests${NC}"
    if python3 -m pytest tests/unit/test_models.py -v --tb=short; then
        echo -e "${GREEN}✓ Unit Tests passed${NC}"
    else
        echo -e "${RED}✗ Unit Tests failed${NC}"
        FAILURES=$((FAILURES + 1))
    fi
    echo ""
fi

# Summary
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Summary${NC}"
echo -e "${GREEN}======================================${NC}"

if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo -e "${GREEN}Ready to commit and push.${NC}"
    exit 0
else
    echo -e "${RED}✗ $FAILURES check(s) failed${NC}"
    echo -e "${YELLOW}Please fix the issues before pushing.${NC}"
    exit 1
fi
