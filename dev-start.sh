#!/bin/bash

# CarpoolUTEC — Start all services for development
set -e  # Exit on error

echo "🚀 Starting CarpoolUTEC development environment..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Docker Compose (PostgreSQL + Redis)
echo -e "${BLUE}1. Starting Docker containers (PostgreSQL + Redis)...${NC}"
docker compose up -d postgres redis
echo -e "${GREEN}✓ Docker containers running${NC}"

# Step 2: Abrir los simuladores de iOS
echo -e "${BLUE}📱 Abriendo simuladores: iPhone 17, 17 Pro y 17 Pro Max...${NC}"
xcrun simctl boot "iPhone 17" 2>/dev/null || true
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true
xcrun simctl boot "iPhone 17 Pro Max" 2>/dev/null || true
open -a Simulator
echo -e "${GREEN}✓ Simuladores iniciados${NC}"

# Step 3: Frontend en una NUEVA ventana
echo -e "${BLUE}3. Starting frontend en una nueva ventana de Terminal...${NC}"

# Lanzamos el truco "automágico" en segundo plano en esta terminal original
(
  sleep 10
  echo -e "${GREEN}🚀 Instalando app en los 3 simuladores...${NC}"
  xcrun simctl openurl "iPhone 17" "exp://127.0.0.1:8081" 2>/dev/null || true
  xcrun simctl openurl "iPhone 17 Pro" "exp://127.0.0.1:8081" 2>/dev/null || true
  xcrun simctl openurl "iPhone 17 Pro Max" "exp://127.0.0.1:8081" 2>/dev/null || true
) &

# Magia de Mac: Abre una nueva ventana, entra a la carpeta y corre Expo
osascript -e "tell application \"Terminal\" to do script \"cd $(pwd)/frontend && npx expo start\""

# Step 4: Backend en la ventana ACTUAL
echo -e "${BLUE}4. Starting backend en esta ventana...${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ ¡Todo en marcha!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "Los logs del BACKEND aparecerán aquí abajo 👇"
echo "El FRONTEND (Expo) tiene su propia ventana emergente."
echo "Para cerrar todo: presiona Ctrl+C aquí y ejecuta 'make dev-clean'"
echo ""

cd backend
# Quitamos el '&' para que esta terminal se dedique 100% a mostrar tu backend
npm run start:dev