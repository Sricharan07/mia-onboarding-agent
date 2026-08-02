FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY sdk/package.json sdk/package.json
COPY backend/console/package.json backend/console/package-lock.json backend/console/

RUN npm ci && npm ci --prefix backend/console

COPY backend backend
COPY sdk sdk
RUN npm run build \
    && npm --prefix backend/console run build \
    && npm prune --omit=dev

FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS runtime

LABEL org.opencontainers.image.title="Mia" \
      org.opencontainers.image.description="Self-hosted intelligent product agent" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.source="https://github.com/Sricharan07/mia-onboarding-agent" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends dumb-init \
    && DEBIAN_FRONTEND=noninteractive npx playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/console/dist ./backend/console/dist
RUN mkdir -p /app/data/uploads \
    && chown -R node:node /app/data /ms-playwright

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "backend/dist/server.js"]
