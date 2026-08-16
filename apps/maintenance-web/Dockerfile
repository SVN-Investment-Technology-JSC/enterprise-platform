FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV NEXT_BUILD_OUTPUT=standalone
RUN pnpm nx run maintenance-web:build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3004
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/maintenance-web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/maintenance-web/public ./apps/maintenance-web/public
COPY --from=build --chown=node:node /workspace/apps/maintenance-web/.next/static ./apps/maintenance-web/.next/static
USER node
EXPOSE 3004
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3004/modules/maintenance').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/maintenance-web/server.js"]
