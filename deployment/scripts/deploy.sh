#!/bin/bash

# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Production deployment script for Security Triage System
# Supports both staging and production environments

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl"
        exit 1
    fi

    if ! command -v helm &> /dev/null; then
        log_error "helm not found. Please install helm"
        exit 1
    fi

    log_info "Prerequisites check passed ✓"
}

validate_environment() {
    local env=$1

    case $env in
        staging|production)
            ;;
        *)
            log_error "Invalid environment: $env. Must be 'staging' or 'production'"
            exit 1
            ;;
    esac
}

backup_database() {
    local namespace=$1
    local env=$2

    log_info "Creating database backup..."

    local backup_dir="backups/${env}"
    local backup_file="${backup_dir}/backup-$(date +%Y%m%d-%H%M%S).sql"

    mkdir -p "${backup_dir}"

    # Get primary pod name
    local postgres_pod=$(kubectl get pod -n "${namespace}" -l app=postgres,role=master -o jsonpath='{.items[0].metadata.name}')

    # Execute backup
    kubectl exec -n "${namespace}" "${postgres_pod}" -- pg_dump \
        -U triage_user \
        -d security_triage \
        --clean \
        --if-exists \
        > "${backup_file}"

    log_info "Backup saved to: ${backup_file}"
}

deploy_helm_chart() {
    local namespace=$1
    local env=$2
    local version=${3:-"latest"}
    local values_file="deployment/helm/security-triage/values-${env}.yaml"

    log_info "Deploying to ${env}..."
    log_info "Namespace: ${namespace}"
    log_info "Version: ${version}"
    log_info "Values file: ${values_file}"

    # Check if values file exists
    if [ ! -f "${values_file}" ]; then
        log_error "Values file not found: ${values_file}"
        exit 1
    fi

    # Create namespace if not exists
    kubectl create namespace "${namespace}" --dry-run=client -o yaml | kubectl apply -f -

    # Install/upgrade Helm chart
    helm upgrade --install security-triage-${env} deployment/helm/security-triage \
        --namespace "${namespace}" \
        --values "${values_file}" \
        --set image.tag="${version}" \
        --wait \
        --timeout 15m \
        --atomic \
        --debug

    log_info "Deployment completed successfully! ✓"
}

verify_deployment() {
    local namespace=$1
    local env=$2

    log_info "Verifying deployment..."

    # Wait for deployments to be ready
    kubectl rollout status deployment -n "${namespace}"

    # Get pod status
    log_info "Pod status:"
    kubectl get pods -n "${namespace}"

    # Check for failed pods
    local failed_pods=$(kubectl get pods -n "${namespace}" -o json | jq -r '.items[] | select(.status.phase!="Running" or .status.containerStatuses[].ready!=true) | .metadata.name' || true)

    if [ -n "${failed_pods}" ]; then
        log_error "Some pods are not running properly:"
        echo "${failed_pods}"
        return 1
    fi

    log_info "All pods are running ✓"
}

run_tests() {
    local env=$1
    local base_url

    if [ "$env" = "production" ]; then
        base_url="https://security-triage.example.com"
    else
        base_url="https://staging.security-triage.example.com"
    fi

    log_info "Running smoke tests against ${base_url}..."

    # Health check
    if curl -f -s "${base_url}/health" > /dev/null; then
        log_info "Health check passed ✓"
    else
        log_error "Health check failed"
        return 1
    fi

    # Run E2E tests
    if [ -f "scripts/e2e-tests.sh" ]; then
        bash scripts/ee2e-tests.sh "${base_url}"
    fi

    log_info "All tests passed ✓"
}

rollback_deployment() {
    local namespace=$1
    local env=$2
    local revision=${3:-""}

    log_warn "Rolling back deployment..."

    if [ -z "$revision" ]; then
        helm rollback security-triage-${env} -n "${namespace}"
    else
        helm rollback security-triage-${env} "${revision}" -n "${namespace}"
    fi

    log_info "Rollback completed"
}

# Main deployment flow
main() {
    local env=${1:-"staging"}
    local version=${2:-"latest"}
    local skip_backup=${3:-"false"}

    log_info "Starting deployment process..."
    log_info "Environment: ${env}"
    log_info "Version: ${version}"

    # Validate
    validate_environment "${env}"
    check_prerequisites

    # Set namespace
    local namespace="security-triage-${env}"

    # Backup database (production only)
    if [ "${env}" = "production" ] && [ "${skip_backup}" = "false" ]; then
        backup_database "${namespace}" "${env}"
    fi

    # Deploy
    deploy_helm_chart "${namespace}" "${env}" "${version}"

    # Verify
    if ! verify_deployment "${namespace}" "${env}"; then
        log_error "Deployment verification failed!"
        read -p "Do you want to rollback? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            rollback_deployment "${namespace}" "${env}"
        fi
        exit 1
    fi

    # Run tests
    run_tests "${env}"

    log_info "================================"
    log_info "Deployment completed successfully! 🎉"
    log_info "================================"
    log_info ""
    log_info "Access URLs:"
    if [ "${env}" = "production" ]; then
        log_info "  Dashboard: https://security-triage.example.com"
        log_info "  API:       https://api.security-triage.example.com"
    else
        log_info "  Dashboard: https://staging.security-triage.example.com"
        log_info "  API:       https://api-staging.security-triage.example.com"
    fi
    log_info ""
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [ENVIRONMENT] [VERSION] [SKIP_BACKUP]

Deploy Security Triage System to Kubernetes

ARGUMENTS:
  ENVIRONMENT    Target environment (staging or production, default: staging)
  VERSION        Docker image version to deploy (default: latest)
  SKIP_BACKUP    Skip database backup (true/false, default: false)

EXAMPLES:
  # Deploy latest to staging
  $0 staging

  # Deploy specific version to production
  $0 production v1.0.0

  # Deploy to production without backup
  $0 production v1.0.0 true

EOF
}

# Parse arguments
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
fi

# Run main
main "$@"
