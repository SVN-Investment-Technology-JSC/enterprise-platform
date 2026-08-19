# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm nx run inventory-api:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3336
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/inventory-api/dist ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store pnpm fetch --prod --frozen-lockfile \
    && pnpm install --prod --offline --frozen-lockfile
USER node
EXPOSE 3336
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3336/api/inventory/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
