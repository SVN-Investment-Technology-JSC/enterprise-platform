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
ENV NEXT_BUILD_OUTPUT=standalone
RUN pnpm nx run inventory-web:build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3005
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/inventory-web/.next/standalone ./
# Next's standalone tracing omits this pnpm virtual-store package even though
# Next requires it at runtime.
COPY --from=build --chown=node:node /workspace/node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers ./node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers
COPY --from=build --chown=node:node /workspace/apps/inventory-web/public ./apps/inventory-web/public
COPY --from=build --chown=node:node /workspace/apps/inventory-web/.next/static ./apps/inventory-web/.next/static
USER node
EXPOSE 3005
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3005/modules/inventory').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/inventory-web/server.js"]
