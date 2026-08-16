FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm nx run procedure-api:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3334
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/procedure-api/dist ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
USER node
EXPOSE 3334
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3334/api/procedure/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
