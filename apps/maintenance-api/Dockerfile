FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm nx run maintenance-api:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3335
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/maintenance-api/dist ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
USER node
EXPOSE 3335
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3335/api/maintenance/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
