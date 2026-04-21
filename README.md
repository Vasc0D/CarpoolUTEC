# CarpoolUTEC — Carpool Universitario (Fase 1: Retorno a Casa)

Monolito modular para gestionar el carpool universitario.

## Stack Tecnológico

| Capa            | Tecnología                              |
|-----------------|-----------------------------------------|
| Backend         | NestJS (TypeScript)                     |
| Base de Datos   | PostgreSQL 16 + PostGIS 3.4             |
| Real-Time/Caché | Redis 7 + Socket.io                     |
| Frontend        | React Native (Expo)                     |
| Infraestructura | Docker Compose                          |

## Requisitos Previos

- [Node.js](https://nodejs.org/) v18+
- [Docker](https://www.docker.com/) y Docker Compose
- [Expo CLI](https://docs.expo.dev/) (`npm install -g expo-cli`)

## 🚀 Inicio Rápido

### 1. Levantar los contenedores (PostgreSQL + Redis)

```bash
docker compose up -d
```

Para verificar que los servicios estén corriendo:

```bash
docker compose ps
```

Para detener los contenedores:

```bash
docker compose down
```

### 2. Ejecutar el servidor backend (NestJS)

```bash
cd backend
npm install        # Solo la primera vez
npm run start:dev
```

El servidor estará disponible en `http://localhost:3000`.

### 3. Ejecutar el frontend (Expo)

```bash
cd frontend
npm install        # Solo la primera vez
npx expo start
```

Escanea el código QR con la app **Expo Go** en tu dispositivo, o presiona:
- `a` → abrir en Android
- `i` → abrir en iOS Simulator
- `w` → abrir en navegador web

## Estructura del Proyecto

```
CarpoolUTEC/
├── docker-compose.yml        # PostgreSQL + PostGIS, Redis
├── README.md
├── backend/                  # NestJS (Monolito Modular)
│   └── src/
│       ├── users/            # Usuarios y autenticación
│       ├── trips/            # Rutas y viajes programados
│       ├── notifications/    # Alertas push y WebSockets
│       ├── geo/              # Cálculos de distancia (PostGIS)
│       ├── app.module.ts
│       └── main.ts
└── frontend/                 # React Native (Expo)
    ├── App.js
    └── ...
```

## Variables de Entorno (Docker)

| Variable            | Valor por defecto    |
|---------------------|----------------------|
| `POSTGRES_USER`     | `carpoolutec`        |
| `POSTGRES_PASSWORD` | `carpoolutec_secret` |
| `POSTGRES_DB`       | `carpoolutec_db`     |

**Puertos expuestos:**
- PostgreSQL: `5432`
- Redis: `6379`
