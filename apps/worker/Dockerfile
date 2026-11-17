# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile
RUN pnpm nx run worker:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm fetch --prod --frozen-lockfile \
    && pnpm install --prod --offline --frozen-lockfile
USER node
# Khoẻ khi tệp nhịp tim tồn tại và mtime cách hiện tại dưới 60 giây. Worker chỉ ghi tệp khi mọi consumer RabbitMQ còn kênh
# (src/main.ts, startFileHeartbeat); mất broker thì sau khoảng 2 chu kỳ kiểm container báo unhealthy. Chỉ dùng Node có sẵn.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=2 \
  CMD ["node", "-e", "try{const s=require('fs').statSync(process.env.WORKER_HEARTBEAT_FILE||'/tmp/worker.alive');process.exit(Date.now()-s.mtimeMs<60000?0:1)}catch{process.exit(1)}"]
CMD ["node", "main.js"]
