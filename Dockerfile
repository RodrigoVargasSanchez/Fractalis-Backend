# ============================================================================
# Fractalis Backend - Production Image
# Express + PostGraphile + Neo4j | Node 22 + TypeScript
# ============================================================================

# ============================================================================
# Stage 1: Instalar dependencias (incluyendo devDeps para compilar TypeScript)
# ============================================================================
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package*.json ./

RUN npm ci

# ============================================================================
# Stage 2: Compilar TypeScript
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ============================================================================
# Stage 3: Imagen de producción (solo deps de runtime + JS compilado)
# ============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Instalar solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código compilado
COPY --from=builder /app/dist ./dist

EXPOSE 5002

CMD ["node", "dist/server.js"]
