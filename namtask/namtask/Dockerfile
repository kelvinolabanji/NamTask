# ══════════════════════════════════════════════════════════════════════════════
# Nam Task API — Production Dockerfile
#
# Stages:
#   base       — node:20-alpine with dumb-init
#   deps       — install production dependencies only
#   builder    — copy source (no .env, no secrets — see .dockerignore)
#   runtime    — lean final image (~180MB), runs as non-root "node" user
#
# Secrets are injected at RUNTIME via environment variables,
# never baked into image layers.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

# dumb-init: proper PID 1 — handles SIGTERM, reaps zombie processes
RUN apk add --no-cache dumb-init curl

WORKDIR /app

# ── Stage 2: dependencies ─────────────────────────────────────────────────────
FROM base AS deps

# Copy manifests only — layer is cached until package.json changes
COPY package.json package-lock.json ./

# Install prod deps, skip optional, clean cache
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM base AS builder

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy source (excludes everything in .dockerignore)
COPY src/      ./src/
COPY scripts/  ./scripts/

# Run any build steps (transpile, asset prep) — currently none needed
# RUN npm run build

# ── Stage 4: runtime (final image) ────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000

# Copy production node_modules from deps stage
COPY --from=deps    /app/node_modules ./node_modules

# Copy application source from builder stage
COPY --from=builder /app/src          ./src
COPY --from=builder /app/scripts      ./scripts
COPY package.json ./

# Create runtime directories; set ownership to non-root node user
RUN mkdir -p uploads/tasks uploads/avatars uploads/proofs logs \
 && chown -R node:node /app

# Switch to non-root user (node is built into node:alpine images)
USER node

EXPOSE 3000

# Health check — matches /health endpoint in server.js
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# dumb-init ensures proper signal propagation to node process
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
