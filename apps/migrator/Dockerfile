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
RUN pnpm nx run migrator:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/migrator/dist ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store pnpm fetch --prod --frozen-lockfile \
    && pnpm install --prod --offline --frozen-lockfile
USER node
CMD ["node", "main.js"]
