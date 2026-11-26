# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml apps/*/package.json packages/*/*/package.json ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile
COPY . .
RUN --mount=type=secret,id=NX_CLOUD_ACCESS_TOKEN \
    sh -ec 'if [ -s /run/secrets/NX_CLOUD_ACCESS_TOKEN ]; then export NX_CLOUD_ACCESS_TOKEN="$(cat /run/secrets/NX_CLOUD_ACCESS_TOKEN)"; fi; pnpm nx run workspace-api:prune && mkdir -p /workspace/apps/workspace-api/dist/workspace_modules'

FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
COPY --from=build /workspace/apps/workspace-api/dist/package.json /workspace/apps/workspace-api/dist/pnpm-lock.yaml ./
COPY --from=build /workspace/apps/workspace-api/dist/workspace_modules ./workspace_modules
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3337
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/workspace-api/dist ./
USER node
EXPOSE 3337
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --start-interval=2s CMD node -e "fetch('http://127.0.0.1:3337/api/workspace/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
