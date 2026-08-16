FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV NEXT_BUILD_OUTPUT=standalone
RUN pnpm nx run procedure-web:build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/procedure-web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/procedure-web/public ./apps/procedure-web/public
COPY --from=build --chown=node:node /workspace/apps/procedure-web/.next/static ./apps/procedure-web/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3001/modules/procedure').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/procedure-web/server.js"]
