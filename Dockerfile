# Multi-stage Dockerfile for Module 11 — AI Infrastructure Observability Console
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Install native dependencies required for better-sqlite3 build if necessary
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY package*.json ./

# Install dependencies deterministically
RUN npm ci

# Copy full application codebase
COPY . .

# Run type checking to verify code integrity
RUN npm run typecheck

# Expose HTTP port
EXPOSE 8080

# Environment defaults
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DB_PATH=:memory:

# Healthcheck probe
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start application server
CMD ["node", "dist/server.js"]
