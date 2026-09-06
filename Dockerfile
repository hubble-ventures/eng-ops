# syntax=docker/dockerfile:1
#
# Container image for eng-ops.
#
#   docker build -t eng-ops .
#   docker run --rm -p 127.0.0.1:3000:3000 \
#     -e DATABASE_URL=postgres://user:pass@host:5432/db eng-ops
#
# The entrypoint is the eng-ops CLI, so every flag works as an argument:
#   docker run ... eng-ops --check
#   docker run ... eng-ops --write --wait-for-db 60
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------- build stage
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
#
# --ignore-scripts keeps arbitrary install hooks out of the image and avoids
# compiling native dev-only tooling (node-gyp) that the build never needs; the
# one script that matters is run explicitly right after.
COPY package.json package-lock.json ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts \
 && npx patch-package

COPY . .
RUN npm run build

# Drop devDependencies from the tree we copy into the runtime image. Pruning
# removes packages only — the patched files above stay patched.
RUN npm prune --omit=dev --ignore-scripts

# -------------------------------------------------------------- runtime stage
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.title="eng-ops" \
      org.opencontainers.image.description="Introspection-driven admin UI for any Postgres database" \
      org.opencontainers.image.source="https://github.com/hubble-ventures/eng-ops" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/bin ./bin
COPY --from=build --chown=node:node /app/scripts/seed.mjs ./scripts/seed.mjs
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

# Liveness only — /readyz additionally checks Postgres and is what an
# orchestrator should gate traffic on.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/bin/eng-ops.mjs", "--health-check"]

ENTRYPOINT ["node", "/app/bin/eng-ops.mjs"]
