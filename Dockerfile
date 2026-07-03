FROM mcr.microsoft.com/playwright:v1.57.0-noble AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY sdk/package.json sdk/package.json
RUN npm ci

COPY backend backend
COPY sdk sdk
RUN npm run build
RUN npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.57.0-noble

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

EXPOSE 4000
CMD ["node", "backend/dist/server.js"]
