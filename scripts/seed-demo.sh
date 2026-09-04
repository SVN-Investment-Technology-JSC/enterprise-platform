#!/usr/bin/env bash
#
# Nạp tenant demo SAVINA vào stack Docker đang chạy.
#
# Chạy sau khi `docker compose ... up --wait` xong. Idempotent: chạy lại chỉ bổ
# sung phần còn thiếu, không tạo trùng — nên gọi bao nhiêu lần cũng được.
#
# Cố ý KHÔNG gắn vào `docker compose up`: đây là dữ liệu demo, và một lần `up`
# nhầm trên máy chủ thật sẽ bơm 45 người dùng giả kèm mật khẩu mặc định vào đó.
# Muốn có data thì phải gõ đúng một lệnh, và lệnh đó phải cố ý.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose.full.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/.env.docker}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Thiếu $ENV_FILE. Chép từ .env.docker.example rồi điền mật khẩu." >&2
  exit 1
fi

for f in seed-savina.ts seed-savina-demo.mjs; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "Thiếu $ROOT/$f — không nạp được dữ liệu demo." >&2
    exit 1
  fi
done

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Mật khẩu superadmin nằm trong .env.docker (file bị gitignore). Đọc từ đó thay
# vì bắt người dùng gõ lại, và không in ra màn hình.
SUPERADMIN_PASSWORD="${SEED_SUPERADMIN_PASSWORD:-$(grep -E '^SEED_SUPERADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)}"
if [[ -z "$SUPERADMIN_PASSWORD" ]]; then
  echo "Thiếu SEED_SUPERADMIN_PASSWORD trong $ENV_FILE." >&2
  exit 1
fi
TENANT_DB_PASSWORD="${TENANT_DB_PASSWORD:-$(grep -E '^TENANT_DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)}"
TENANT_DB_PASSWORD="${TENANT_DB_PASSWORD:-tenant_local_2026}"

API_CONTAINER="$(compose ps -q api)"
if [[ -z "$API_CONTAINER" ]]; then
  echo "Container 'api' chưa chạy. Chạy 'docker compose ... up --wait' trước." >&2
  exit 1
fi

# Chạy TRONG container api chứ không trên host: ở đó có sẵn `pg`, gọi được
# http://gateway qua mạng nội bộ, và dùng Node 24 mà script yêu cầu.
docker exec "$API_CONTAINER" mkdir -p /tmp/seed
docker cp "$ROOT/seed-savina.ts"       "$API_CONTAINER:/tmp/seed/seed-savina.ts"
docker cp "$ROOT/seed-savina-demo.mjs" "$API_CONTAINER:/tmp/seed/seed-savina-demo.mjs"

compose exec -T \
  -e GATEWAY_URL=http://gateway \
  -e SEED_SUPERADMIN_PASSWORD="$SUPERADMIN_PASSWORD" \
  -e TENANT_SAVINA_DATABASE_URL="postgresql://tenant:${TENANT_DB_PASSWORD}@tenant-db:5432/savina" \
  ${SAVINA_ADMIN_PASSWORD:+-e SAVINA_ADMIN_PASSWORD="$SAVINA_ADMIN_PASSWORD"} \
  ${SAVINA_MEMBER_PASSWORD:+-e SAVINA_MEMBER_PASSWORD="$SAVINA_MEMBER_PASSWORD"} \
  api node /tmp/seed/seed-savina-demo.mjs
