FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm nx run migrator:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/migrator/dist ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
USER node
CMD ["node", "main.js"]
