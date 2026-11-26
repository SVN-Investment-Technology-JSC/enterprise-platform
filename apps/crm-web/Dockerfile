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
ENV NEXT_BUILD_OUTPUT=standalone
RUN --mount=type=secret,id=NX_CLOUD_ACCESS_TOKEN \
    sh -ec 'if [ -s /run/secrets/NX_CLOUD_ACCESS_TOKEN ]; then export NX_CLOUD_ACCESS_TOKEN="$(cat /run/secrets/NX_CLOUD_ACCESS_TOKEN)"; fi; pnpm nx run crm-web:build'
# Trace standalone chỉ giữ lại bản cjs của @swc/helpers, còn require-hook của
# Next lại nạp bản esm lúc khởi động, nên phải bù đủ package vào output.
RUN set -eu; \
    helpers=$(ls -d node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers | head -1); \
    target=apps/crm-web/.next/standalone/$helpers; \
    mkdir -p "$target"; \
    cp -R "$helpers/." "$target/"; \
    mv apps/crm-web/.next/standalone/node_modules apps/crm-web/.next/standalone-node-modules

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3012
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/crm-web/.next/standalone-node-modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/crm-web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/crm-web/public ./apps/crm-web/public
COPY --from=build --chown=node:node /workspace/apps/crm-web/.next/static ./apps/crm-web/.next/static
USER node
EXPOSE 3012
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --start-interval=2s CMD node -e "fetch('http://127.0.0.1:3012/modules/crm').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/crm-web/server.js"]
