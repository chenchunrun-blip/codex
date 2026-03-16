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
# Security Triage System - Rollback Script
################################################################################
#
# This script handles rollback of the Security Triage System to a previous
# deployment state.
#
# Usage:
#   ./rollback.sh [options]
#
# Options:
#   -v, --version VERSION    Rollback to specific version (git commit/tag)
#   -s, --stop              Stop all services before rollback
#   -b, --backup            Backup current state before rollback
#   -f, --force             Force rollback without confirmation
#   -h, --help              Show this help message
#
# Examples:
#   ./rollback.sh                              # Rollback to previous commit
#   ./rollback.sh -v abc123                    # Rollback to specific commit
#   ./rollback.sh -b -s                        # Backup and stop before rollback
#
################################################################################

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
TARGET_VERSION=""
STOP_BEFORE_ROLLBACK=false
BACKUP_BEFORE_ROLLBACK=false
FORCE=false

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

Rollback the Security Triage System to a previous deployment state.

Options:
  -v, --version VERSION    Rollback to specific version (git commit/tag)
  -s, --stop              Stop all services before rollback
  -b, --backup            Backup current state before rollback
  -f, --force             Force rollback without confirmation
  -h, --help              Show this help message

Examples:
  # Rollback to previous commit
  $(basename "$0")

  # Rollback to specific commit
  $(basename "$0") -v abc123

  # Backup and stop before rollback
  $(basename "$0") -b -s

EOF
}

check_git_status() {
    log_step "Checking git status..."

    cd "$PROJECT_ROOT"

    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not a git repository"
        return 1
    fi

    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        log_warn "You have uncommitted changes"
        git diff-index --stat HEAD --

        if [ "$FORCE" = false ]; then
            read -p "Continue with rollback? (yes/no): " confirm
            if [ "$confirm" != "yes" ]; then
                log_error "Rollback cancelled by user"
                exit 1
            fi
        fi
    fi

    log_info "✓ Git status checked"
}

get_previous_version() {
    log_step "Determining rollback target..."

    if [ -z "$TARGET_VERSION" ]; then
        # Get previous commit
        TARGET_VERSION=$(git rev-parse HEAD~1)
        log_info "Rolling back to previous commit: $TARGET_VERSION"
    else
        log_info "Rolling back to specified version: $TARGET_VERSION"
    fi
}

backup_current_state() {
    if [ "$BACKUP_BEFORE_ROLLBACK" = true ]; then
        log_step "Backing up current state..."

        local backup_dir="$PROJECT_ROOT/backups/$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$backup_dir"

        # Backup database
        log_info "Backing up database..."
        docker exec security-triage-postgres pg_dump -U triage_user security_triage > "$backup_dir/database.sql" 2>/dev/null || true

        # Backup environment
        log_info "Backing up environment configuration..."
        cp "$PROJECT_ROOT/.env" "$backup_dir/.env"

        # Backup current git state
        log_info "Backing up git state..."
        git rev-parse HEAD > "$backup_dir/git_commit.txt"
        git log -1 --pretty=format:"%H %s %an %ai" > "$backup_dir/git_info.txt"

        log_info "✓ Backup created at: $backup_dir"
    fi
}

stop_services() {
    if [ "$STOP_BEFORE_ROLLBACK" = true ]; then
        log_step "Stopping all services..."

        cd "$PROJECT_ROOT"

        if docker compose version &> /dev/null; then
            docker compose down
        elif command -v docker-compose &> /dev/null; then
            docker-compose down
        fi

        log_info "✓ Services stopped"
    fi
}

rollback_code() {
    log_step "Rolling back code to $TARGET_VERSION..."

    cd "$PROJECT_ROOT"

    # Checkout target version
    git checkout "$TARGET_VERSION"

    if [ $? -eq 0 ]; then
        log_info "✓ Code rolled back to $TARGET_VERSION"
    else
        log_error "✗ Failed to rollback code"
        return 1
    fi
}

rebuild_and_restart() {
    log_step "Rebuilding and restarting services..."

    cd "$PROJECT_ROOT"

    # Determine docker-compose command
    if docker compose version &> /dev/null; then
        DOCKER_COMPOSE="docker compose"
    else
        DOCKER_COMPOSE="docker-compose"
    fi

    # Rebuild images
    log_info "Rebuilding Docker images..."
    $DOCKER_COMPOSE build

    if [ $? -ne 0 ]; then
        log_error "✗ Docker build failed"
        return 1
    fi

    # Start services
    log_info "Starting services..."
    $DOCKER_COMPOSE up -d

    if [ $? -eq 0 ]; then
        log_info "✓ Services rebuilt and started"
    else
        log_error "✗ Failed to start services"
        return 1
    fi
}

verify_rollback() {
    log_step "Verifying rollback..."

    sleep 5

    local services=("postgres" "redis" "rabbitmq" "alert-ingestor" "alert-normalizer")
    local all_healthy=true

    for service in "${services[@]}"; do
        local container_name="security-triage-${service}"

        if docker ps --format '{{{{.Names}}}}' | grep -q "$container_name"; then
            log_verbose "  ✓ $service is running"
        else
            log_warn "  ✗ $service is not running"
            all_healthy=false
        fi
    done

    if [ "$all_healthy" = true ]; then
        log_info "✓ All core services are running"
    else
        log_warn "Some services may not be fully started"
        log_warn "Check logs: docker compose logs -f [service_name]"
    fi
}

show_summary() {
    echo ""
    echo "=============================================================================="
    echo "✅ Rollback Complete"
    echo "=============================================================================="
    echo ""
    echo "📊 Rollback Details:"
    echo "  - Target Version: $TARGET_VERSION"
    echo "  - Git Commit: $(git rev-parse HEAD)"
    echo "  - Commit Message: $(git log -1 --pretty=%s)"
    echo "  - Author: $(git log -1 --pretty=%an)"
    echo "  - Date: $(git log -1 --pretty=%ai)"
    echo ""
    echo "💡 Next Steps:"
    echo "  - Verify services: docker compose ps"
    echo "  - Check logs: docker compose logs -f"
    echo "  - Test API endpoints"
    echo ""
    echo "📝 If rollback was unsuccessful:"
    echo "  - Rollback to previous version: git checkout -"
    echo "  - Restore database from backup if needed"
    echo "  - Check logs for errors"
    echo ""
    echo "=============================================================================="
}

################################################################################
# Main Function
################################################################################

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)
                TARGET_VERSION="$2"
                shift 2
                ;;
            -s|--stop)
                STOP_BEFORE_ROLLBACK=true
                shift
                ;;
            -b|--backup)
                BACKUP_BEFORE_ROLLBACK=true
                shift
                ;;
            -f|--force)
                FORCE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    echo "=============================================================================="
    echo "🔄 Security Triage System - Rollback"
    echo "=============================================================================="
    echo ""

    if [ "$FORCE" = false ]; then
        log_warn "This will rollback the deployment to a previous version"
        read -p "Continue? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            log_error "Rollback cancelled by user"
            exit 0
        fi
    fi

    local start_time=$(date +%s)
    local exit_code=0

    # Check git status
    if ! check_git_status; then
        exit_code=1
    else
        # Determine rollback target
        get_previous_version

        # Backup current state if requested
        backup_current_state

        # Stop services if requested
        stop_services

        # Rollback code
        if ! rollback_code; then
            exit_code=1
        else
            # Rebuild and restart
            if ! rebuild_and_restart; then
                exit_code=1
            else
                # Verify rollback
                verify_rollback
            fi
        fi
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        show_summary
        log_info "Total rollback time: ${duration}s"
    else
        echo ""
        log_error "❌ Rollback failed after ${duration}s"
        echo ""
        echo "💡 Recovery Options:"
        echo "  1. Check git log: git log --oneline -10"
        echo "  2. Checkout previous version: git checkout <commit>"
        echo "  3. Restore database from backup if created"
    fi

    echo "=============================================================================="

    exit $exit_code
}

# Run main function
main "$@"
