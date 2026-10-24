# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile
RUN pnpm nx run video-worker:prune

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# ffmpeg/ffprobe cho việc chuyển mã video; dọn danh sách apt để image gọn.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/video-worker/dist ./
RUN corepack enable && corepack install --global pnpm@10.33.1 && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,id=enterprise-platform-pnpm,target=/pnpm/store,sharing=locked pnpm fetch --prod --frozen-lockfile \
    && pnpm install --prod --offline --frozen-lockfile
# Thư mục tạm cho bản gốc và bản chuyển mã; gắn volume `video-work` vào đây khi chạy.
RUN mkdir -p /var/tmp/video-work && chown node:node /var/tmp/video-work
ENV VIDEO_WORKER_TMP_DIR=/var/tmp/video-work
USER node
CMD ["node", "main.js"]
