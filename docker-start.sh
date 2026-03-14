#!/bin/bash

# MarqDex Docker Quick Start Script
# Usage: ./docker-start.sh [dev|prod|stop|reset]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════╗"
    echo "║           MarqDex Docker Deploy           ║"
    echo "╚═══════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_help() {
    echo "Usage: ./docker-start.sh [command]"
    echo ""
    echo "Commands:"
    echo "  dev       Start development environment (default)"
    echo "  prod      Start production environment"
    echo "  stop      Stop all containers"
    echo "  reset     Remove containers and volumes"
    echo "  logs      Show logs"
    echo "  shell     Open shell in app container"
    echo "  db        Open database shell"
    echo "  help      Show this help message"
}

check_requirements() {
    echo -e "${YELLOW}Checking requirements...${NC}"

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        echo "Please install Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null; then
        echo -e "${RED}Error: Docker Compose is not installed${NC}"
        echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
        exit 1
    fi

    echo -e "${GREEN}✓ Docker is installed${NC}"
    echo -e "${GREEN}✓ Docker Compose is installed${NC}"
}

start_dev() {
    print_banner
    check_requirements

    echo -e "${BLUE}Starting development environment...${NC}"
    echo ""

    # Check if containers are already running
    if docker compose -f docker-compose.dev.yml ps -q 2>/dev/null | grep -q .; then
        echo -e "${YELLOW}Containers are already running. Restarting...${NC}"
        docker compose -f docker-compose.dev.yml down
    fi

    docker compose -f docker-compose.dev.yml up --build -d

    echo ""
    echo -e "${GREEN}✓ Development environment started!${NC}"
    echo ""
    echo -e "Access the application at: ${BLUE}http://localhost:3000${NC}"
    echo -e "Database: ${BLUE}localhost:5432${NC}"
    echo ""
    echo -e "View logs: ${YELLOW}./docker-start.sh logs${NC}"
    echo -e "Stop:      ${YELLOW}./docker-start.sh stop${NC}"
}

start_prod() {
    print_banner
    check_requirements

    echo -e "${BLUE}Starting production environment...${NC}"
    echo ""

    # Check for environment file
    if [ ! -f .env.docker.local ]; then
        echo -e "${YELLOW}Creating .env.docker.local from template...${NC}"
        cp .env.docker .env.docker.local
        echo ""
        echo -e "${RED}IMPORTANT: Please edit .env.docker.local with your values!${NC}"
        echo ""
        read -p "Press Enter to continue with default values (not recommended for production)..."
    fi

    # Check if containers are already running
    if docker compose ps -q 2>/dev/null | grep -q .; then
        echo -e "${YELLOW}Containers are already running. Restarting...${NC}"
        docker compose down
    fi

    docker compose --env-file .env.docker.local up --build -d

    echo ""
    echo -e "${GREEN}✓ Production environment started!${NC}"
    echo ""
    echo -e "Access the application at: ${BLUE}http://localhost:3000${NC}"
    echo ""
    echo -e "View logs: ${YELLOW}./docker-start.sh logs${NC}"
    echo -e "Stop:      ${YELLOW}./docker-start.sh stop${NC}"
}

stop_all() {
    echo -e "${YELLOW}Stopping all containers...${NC}"
    docker compose -f docker-compose.dev.yml down 2>/dev/null || true
    docker compose down 2>/dev/null || true
    echo -e "${GREEN}✓ All containers stopped${NC}"
}

reset_all() {
    echo -e "${RED}This will remove all containers, volumes, and data!${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker compose -f docker-compose.dev.yml down -v --rmi local 2>/dev/null || true
        docker compose down -v --rmi local 2>/dev/null || true
        echo -e "${GREEN}✓ Reset complete${NC}"
    else
        echo -e "${YELLOW}Cancelled${NC}"
    fi
}

show_logs() {
    echo -e "${BLUE}Showing logs (Ctrl+C to exit)...${NC}"
    if docker compose -f docker-compose.dev.yml ps -q app 2>/dev/null | grep -q .; then
        docker compose -f docker-compose.dev.yml logs -f app
    else
        docker compose logs -f app
    fi
}

open_shell() {
    echo -e "${BLUE}Opening shell in app container...${NC}"
    if docker compose -f docker-compose.dev.yml ps -q app 2>/dev/null | grep -q .; then
        docker compose -f docker-compose.dev.yml exec app sh
    else
        docker compose exec app sh
    fi
}

open_db_shell() {
    echo -e "${BLUE}Opening database shell...${NC}"
    if docker compose -f docker-compose.dev.yml ps -q postgres 2>/dev/null | grep -q .; then
        docker compose -f docker-compose.dev.yml exec postgres psql -U marqdex -d marqdex
    else
        docker compose exec postgres psql -U marqdex -d marqdex
    fi
}

# Main
case "${1:-dev}" in
    dev)
        start_dev
        ;;
    prod)
        start_prod
        ;;
    stop)
        stop_all
        ;;
    reset)
        reset_all
        ;;
    logs)
        show_logs
        ;;
    shell)
        open_shell
        ;;
    db)
        open_db_shell
        ;;
    help|--help|-h)
        print_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        print_help
        exit 1
        ;;
esac
