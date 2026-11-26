# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml apps/*/package.json packages/*/*/package.json ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --offline
COPY . .
RUN --mount=type=secret,id=NX_CLOUD_ACCESS_TOKEN \
    sh -ec 'if [ -s /run/secrets/NX_CLOUD_ACCESS_TOKEN ]; then export NX_CLOUD_ACCESS_TOKEN="$(cat /run/secrets/NX_CLOUD_ACCESS_TOKEN)"; fi; pnpm nx run social-api:prune && mkdir -p /workspace/apps/social-api/dist/workspace_modules'

FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
COPY --from=build /workspace/apps/social-api/dist/package.json /workspace/apps/social-api/dist/pnpm-lock.yaml ./
COPY --from=build /workspace/apps/social-api/dist/workspace_modules ./workspace_modules
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked \
    pnpm fetch --prod --frozen-lockfile \
    && pnpm install --prod --offline --frozen-lockfile

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3343
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/social-api/dist ./
USER node
EXPOSE 3343
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --start-interval=2s CMD node -e "fetch('http://127.0.0.1:3343/api/social/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
