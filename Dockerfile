# syntax=docker/dockerfile:1.7

# ------------------------------
# Build stage
# ------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Install OS deps needed by Prisma in Alpine
RUN apk add --no-cache openssl

# Speed up npm and relax peer deps to avoid conflicts (e.g., sharp vs baileys)
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Cache lockfile first
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install deps (prefer npm ci if lockfile present); ignore scripts so postinstall doesn't run yet
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --ignore-scripts; \
    elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile --ignore-scripts; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile --ignore-scripts; \
    else npm i --no-audit --no-fund --ignore-scripts; fi

# Copy source
COPY . .

# Ensure Prisma Client for linux-musl gets generated into src/generated/prisma
RUN npx prisma generate

# Build Next.js (standalone output)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ------------------------------
# Runtime stage
# ------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# OS deps for Prisma and healthcheck
RUN apk add --no-cache openssl curl

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Copy the minimal Next standalone server and static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema and migrations for runtime migrate deploy
COPY --from=builder /app/prisma ./prisma

# Copy generated Prisma client (linux) used by the app source imports
COPY --from=builder /app/src/generated ./src/generated

# Copy node_modules so `prisma` CLI is available at runtime
COPY --from=builder /app/node_modules ./node_modules

# Add entrypoint
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create data dir for SQLite and adjust perms; use node user
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
