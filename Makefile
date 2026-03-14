.PHONY: help dev dev-down prod prod-down build clean logs shell db-shell migrate seed

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Development
dev: ## Start development environment with hot reload
	@echo "Starting development environment..."
	docker compose -f docker-compose.dev.yml up --build -d
	@echo "Development server running at http://localhost:3000"
	@echo "MCP Server running at http://localhost:3002"
	@echo "Database running at localhost:5432"

dev-down: ## Stop development environment
	@echo "Stopping development environment..."
	docker compose -f docker-compose.dev.yml down

dev-logs: ## Show development logs
	docker compose -f docker-compose.dev.yml logs -f app

# Production
prod: ## Start production environment
	@echo "Starting production environment..."
	@if [ ! -f .env.docker.local ]; then \
		echo "Creating .env.docker.local from template..."; \
		cp .env.docker .env.docker.local; \
		echo "Please edit .env.docker.local with your values"; \
	fi
	docker compose --env-file .env.docker.local up --build -d
	@echo "Production server running at http://localhost:3000"

prod-down: ## Stop production environment
	@echo "Stopping production environment..."
	docker compose down

prod-logs: ## Show production logs
	docker compose logs -f app

# Build
build: ## Build all Docker images
	@echo "Building Docker images..."
	docker compose -f docker-compose.dev.yml build
	docker compose build

build-prod: ## Build production image only
	docker compose build app

# Database
migrate: ## Run database migrations in dev container
	docker compose -f docker-compose.dev.yml exec app npx prisma migrate dev

migrate-prod: ## Run database migrations in prod container
	docker compose exec app npx prisma migrate deploy

seed: ## Seed database in dev container
	docker compose -f docker-compose.dev.yml exec app npm run db:seed

db-shell: ## Open PostgreSQL shell
	docker compose -f docker-compose.dev.yml exec postgres psql -U marqdex -d marqdex

db-reset: ## Reset database (WARNING: destroys all data)
	docker compose -f docker-compose.dev.yml exec app npx prisma migrate reset --force

# Utilities
logs: ## Show all logs
	docker compose -f docker-compose.dev.yml logs -f

shell: ## Open shell in app container
	docker compose -f docker-compose.dev.yml exec app sh

clean: ## Remove all containers, volumes, and images
	@echo "Cleaning up..."
	docker compose -f docker-compose.dev.yml down -v --rmi local
	docker compose down -v --rmi local

# Admin tools (requires --profile admin)
admin-up: ## Start pgAdmin
	docker compose -f docker-compose.dev.yml --profile admin up -d pgadmin
	@echo "pgAdmin running at http://localhost:5050"
	@echo "Login: admin@marqdex.local / admin"

admin-down: ## Stop pgAdmin
	docker compose -f docker-compose.dev.yml --profile admin down pgadmin

# Redis (requires --profile cache)
redis-up: ## Start Redis
	docker compose -f docker-compose.dev.yml --profile cache up -d redis
	@echo "Redis running at localhost:6379"

redis-down: ## Stop Redis
	docker compose -f docker-compose.dev.yml --profile cache down redis

# Full reset
reset: clean ## Full reset: clean and rebuild
	@echo "Full reset completed. Run 'make dev' to start fresh."
