.PHONY: help dev dev-clean docker-up docker-down backend frontend install

help:
	@echo "CarpoolUTEC — Development commands"
	@echo ""
	@echo "make dev              Start everything (Docker + backend + frontend)"
	@echo "make dev-clean        Stop everything gracefully"
	@echo "make docker-up        Start Docker containers only"
	@echo "make docker-down      Stop Docker containers"
	@echo "make backend          Start backend only"
	@echo "make frontend         Start frontend (Expo) only"
	@echo "make install          Install dependencies (backend + frontend)"

dev:
	@./dev-start.sh

dev-clean:
	@echo "Stopping all services..."
	@killall node 2>/dev/null || true
	@killall expo 2>/dev/null || true
	@echo "Closing iOS Simulators..."
	@xcrun simctl shutdown "iPhone 17" 2>/dev/null || true
	@xcrun simctl shutdown "iPhone 17 Pro" 2>/dev/null || true
	@xcrun simctl shutdown "iPhone 17 Pro Max" 2>/dev/null || true
	@killall Simulator 2>/dev/null || true
	@echo "Stopping Docker containers..."
	@docker compose down
	@echo "✓ Todo cerrado correctamente"

docker-up:
	@echo "Starting PostgreSQL + Redis..."
	@docker compose up -d postgres redis
	@sleep 2
	@echo "✓ Docker containers running"

docker-down:
	@echo "Stopping Docker containers..."
	@docker compose down

backend:
	@cd backend && npm run start:dev

frontend:
	@cd frontend && expo start

install:
	@echo "Installing backend dependencies..."
	@cd backend && npm install
	@echo "Installing frontend dependencies..."
	@cd frontend && npm install
	@echo "✓ All dependencies installed"
