# syntax=docker/dockerfile:1.7

###############################################################################
# Build stage: install production dependencies only.
# The lockfile is copied first so image layers are cached across source changes.
###############################################################################
FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

###############################################################################
# Runtime stage: distroless-ish, non-root, read-only friendly.
###############################################################################
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

WORKDIR /app

# The official image already contains an unprivileged `node` user (uid 1000).
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node

EXPOSE 3000

# Informational for `docker run`; ECS health is judged by the ALB on /health.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# Exec form so PID 1 is node itself and receives SIGTERM directly.
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
