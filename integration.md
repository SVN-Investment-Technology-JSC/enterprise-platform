# Dựng hệ thống trên máy mới

Hướng dẫn đưa toàn bộ Enterprise Platform lên một máy chưa từng chạy dự án này, kèm tenant demo SAVINA có sẵn dữ liệu.

Mọi bước và mọi cảnh báo dưới đây đều đã được chạy thật trên stack sạch (volume rỗng, database trắng), không phải suy đoán.

---

## 1. Cần có sẵn

| Thứ | Yêu cầu | Ghi chú |
|---|---|---|
| Docker | Có BuildKit (Docker 23+) | Bắt buộc — Dockerfile dùng cache mount |
| RAM cho Docker | **≥ 8 GB** | Dưới mức này `maintenance-web` dễ bị OOM lúc build |
| Dung lượng trống | ~15 GB | 10 image + volume database |
| Node trên host | **Không cần** | Mọi thứ chạy trong container |

Chỉ khi muốn chạy `pnpm nx ...` trực tiếp trên host thì mới cần **Node 24** (`>=24.11.0 <25`) và **pnpm 10.33.1**. Node 25/26 sẽ không chạy được — repo dùng type stripping của Node 24 và chốt phiên bản ở `engines`.

---

## 2. Cấu hình môi trường

```bash
git clone <repo> && cd enterprise-platform
cp .env.docker.example .env.docker
```

Mở `.env.docker` và đổi tối thiểu `SEED_SUPERADMIN_PASSWORD`.

### Nên sinh cặp khoá RS256 ngay từ đầu

`AUTH_PRIVATE_KEY` / `AUTH_PUBLIC_KEY` để trống thì **Platform Core sinh khoá mới mỗi lần khởi động lại**, và ba module API sẽ trả `401 Access token không hợp lệ` cho tới khi chúng cũng được restart theo. Triệu chứng rất khó đoán: đăng nhập được nhưng mọi màn hình module đều lỗi.

Chạy trên máy có Node, **hoặc** trong container `api` nếu host không có Node:

```bash
node <<'EOF'
const { generateKeyPairSync } = require('node:crypto');
const k = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const esc = (pem) => pem.trim().replace(/\n/g, '\\n');
console.log('AUTH_PRIVATE_KEY=' + esc(k.privateKey));
console.log('AUTH_PUBLIC_KEY=' + esc(k.publicKey));
EOF
```

Kết quả là **hai dòng**, mỗi khoá một dòng, xuống dòng được mã hoá thành `\n`. Dán thẳng vào `.env.docker`.

> Dùng heredoc `<<'EOF'` chứ đừng dùng `node -e "..."` trong bash: dấu nháy kép làm bash nuốt mất một lớp backslash, `replace(/\n/g,'\\n')` biến thành thay xuống dòng bằng xuống dòng — tức không làm gì — và khoá in ra trải nhiều dòng, không nhét vào file `.env` được. Bản `node -e` trong `.env.docker.example` viết cho PowerShell.

---

## 3. Dựng stack lần đầu

```bash
pnpm docker:up
```

Tương đương `docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml up --build --wait`.

Lượt đầu build 10 image, khoảng **3–8 phút** tuỳ máy.

### ⚠️ Máy dưới 12 GB RAM: build tuần tự

`up --build` build **cả 10 image song song**. Bốn image web đều chạy `next build` (webpack), mỗi cái ngốn hàng GB, nên máy dễ hết bộ nhớ và fail:

```
target web: failed to solve: ResourceExhausted: cannot allocate memory
```

Chạy cách này thay thế — chậm hơn khoảng một phút, nhưng chắc chắn qua:

```bash
for s in migrator api procedure-api maintenance-api inventory-api worker \
         web procedure-web maintenance-web inventory-web; do
  docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml build $s || break
done
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml up -d --wait
```

Đóng bớt ứng dụng nặng trước khi build cũng giúp. Và **đừng chạy hai lượt build cùng lúc** — đó là cách nhanh nhất để hết RAM.

### Kết quả mong đợi

**16 service**: 14 đang chạy, cộng `migrator` và `minio-init` ở trạng thái `Exited (0)`. Hai cái sau là job chạy một lần, thoát `0` nghĩa là **thành công** chứ không phải lỗi.

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml ps
```

Một lệnh này dựng **cả backend lẫn frontend**. Bốn frontend là bốn ứng dụng Next.js riêng biệt; nginx gateway ghép chúng thành một origin duy nhất ở `localhost:8080`, nên đăng nhập một lần là vào được cả ba module.

| Đường dẫn | Đi tới |
|---|---|
| `/` | `web` — Platform |
| `/modules/procedure` · `/modules/maintenance` · `/modules/inventory` | ba web module |
| `/api/auth/` · `/api/platform/` · `/api/crm/` | `api` (Platform Core) |
| `/api/procedure/` · `/api/maintenance/` · `/api/inventory/` | ba API module |

---

## 3b. Tắt và bật lại hằng ngày

Sau lần dựng đầu tiên, **không cần build lại** trừ khi code đổi. Ba mức, từ nhẹ tới nặng:

### Tạm dừng — nhanh nhất, dùng hằng ngày

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml stop    # ~2 giây
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml start   # ~55 giây
```

Container được giữ nguyên, chỉ dừng tiến trình. Dữ liệu nguyên vẹn.

### Xoá container nhưng giữ dữ liệu

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml down    # ~2 giây
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml up -d --wait   # ~60 giây
```

`down` **không** đụng volume, nên mọi tenant và dữ liệu còn nguyên. Dùng khi sửa `compose.full.yml` hoặc biến môi trường.

> Đã kiểm cả hai chu trình trên stack thật: trước và sau đều `45 người dùng, 18 quy trình, 6 hồ sơ`, ba database tenant còn đủ, `/t/savina/login` trả 200.

### Sau khi sửa code

```bash
pnpm docker:up      # build lại phần đổi rồi khởi động
```

Hoặc chỉ dựng lại service liên quan, nhanh hơn nhiều:

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml up -d --build procedure-api procedure-web
```

Sửa **migration** thì phải chạy lại `migrator`:

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml run --rm migrator
```

### Xoá sạch làm lại từ đầu

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml down --volumes
```

**Mất toàn bộ** Platform DB, mọi database tenant, RabbitMQ và MinIO. Sau đó làm lại từ mục 3 và **phải seed lại** (mục 4).

---

## 4. Nạp tenant demo SAVINA

```bash
pnpm seed:demo
```

Khoảng 1–2 phút. Kết quả: tenant `savina` với 45 người dùng, 39 đơn vị + 43 chức danh, 3 kho, 8 vật tư, 8 thiết bị, 18 quy trình (17 công bố + 1 giữ nháp có chủ đích), 5 hồ sơ và 4 lịch bảo trì.

Lệnh này **idempotent** — chạy lại chỉ bổ sung phần còn thiếu, không tạo trùng.

Seed **cố ý không gắn vào `docker compose up`**: đây là dữ liệu demo, một lần `up` nhầm trên máy chủ thật sẽ bơm 45 tài khoản giả vào đó.

---

## 5. Đăng nhập

| Cổng vào | URL |
|---|---|
| Platform Admin | `http://localhost:8080/platform/login` |
| Tenant SAVINA | `http://localhost:8080/t/savina/login` |

Route tenant là `/t/<slug>/login`, không phải `/tenant/login`. Platform Admin là `/platform/login`, không phải `/login` — `/login` trả 404.

Các trang bên trong (`/platform`, `/t/savina`, …) trả `307` khi chưa đăng nhập; đó là chuyển hướng về trang login, không phải lỗi.

| Tài khoản | Email | Mật khẩu |
|---|---|---|
| Platform Admin | `superadmin@platform.local` | `SEED_SUPERADMIN_PASSWORD` |
| Tenant Admin SAVINA | `admin@savina.local` | `Savina-Admin-Demo-2026` |
| Nhân sự SAVINA | ví dụ `ha.nguyen.hoang@savina.local` | `Savina-Member-Demo-2026` |

Danh sách 45 nhân sự nằm trong `seed-savina.ts`. Đổi mật khẩu demo bằng `SAVINA_ADMIN_PASSWORD` / `SAVINA_MEMBER_PASSWORD` trong `.env.docker` **trước khi** chạy seed.

### Bốn module

| Module | URL |
|---|---|
| Platform | `http://localhost:8080/platform` |
| Quy trình | `http://localhost:8080/modules/procedure` |
| Bảo trì | `http://localhost:8080/modules/maintenance` |
| Kho | `http://localhost:8080/modules/inventory` |

---

## 6. Kiểm tra đã chạy đúng

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/t/savina/login
for m in procedure maintenance inventory; do
  curl -s -o /dev/null -w "$m %{http_code}\n" "http://localhost:8080/api/$m/health/ready"
done
```

Tất cả phải trả `200`.

Đối chiếu dữ liệu SAVINA:

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml \
  exec -T tenant-db psql -U tenant -d savina -Atc \
  "SELECT 'migration='||(SELECT count(*) FROM integration_schema.schema_migrations)
       ||' | nguoi dung='||(SELECT count(*) FROM core_schema.users)
       ||' | quy trinh='||(SELECT count(*) FROM procedure_schema.definitions)"
```

Kỳ vọng: `migration=22 | nguoi dung=45 | quy trinh=18`.

Con số đầy đủ của SAVINA sau khi seed:

| Hạng mục | Số lượng |
|---|---|
| Migration đã áp | 22 |
| Người dùng | 45 |
| Node tổ chức | 82 (39 đơn vị + 43 chức danh) |
| Kho / vật tư / thiết bị | 3 / 8 / 8 |
| Quy trình | 18 (17 đã công bố, 1 giữ nháp có chủ đích) |
| Hồ sơ đang chạy | 5 |
| Lịch bảo trì | 4 |

---

## 7. Tạo tenant mới (không phải demo)

Đăng nhập Platform Admin rồi tạo tenant qua giao diện quản trị, hoặc gọi API.

**Bật entitlement từng module một, không bật cả loạt.** Worker xử lý các provisioning job song song, và hai job cùng chạy `CREATE SCHEMA IF NOT EXISTS` trên một database sẽ đụng nhau ở `pg_namespace_nspname_index` — Postgres không làm câu lệnh đó an toàn với truy cập đồng thời. Chờ module trước chuyển sang `active` rồi mới bật module sau.

Tenant mới nhận đủ toàn bộ migration ngay lúc cấp phát; không cần restart stack.

---

## 8. Lỗi thường gặp

### Gateway trả 503 hoặc trang bảo trì trong ~30 giây sau khi rebuild

Bình thường, tự khỏi. Nginx cache DNS 30 giây (`resolver ... valid=30s`), nên sau khi một container đổi IP thì gateway còn trỏ vào IP cũ tới hết chu kỳ. Chờ 30 giây.

### Mọi màn hình module trả 401 sau khi restart `api`

`AUTH_PRIVATE_KEY` / `AUTH_PUBLIC_KEY` đang để trống → Core sinh khoá RS256 mới. Xem mục 2. Cách chữa tạm: restart cả ba module API.

### `docker compose build` fail với `ENOENT ... sass@.../package.json`

Không nên gặp nữa — cả 10 Dockerfile đã khai `sharing=locked` trên cache mount pnpm. Nếu vẫn gặp (ví dụ ai đó gỡ mất khai báo đó), build tuần tự từng service:

```bash
for s in migrator api procedure-api maintenance-api inventory-api worker web procedure-web maintenance-web inventory-web; do
  docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml build $s || break
done
```

Nguyên nhân là nhiều build song song cùng ghi vào một pnpm store dùng chung. Thông báo lỗi trỏ vào `sass` nhưng `sass` hoàn toàn vô can.

### Build fail với `ResourceExhausted: cannot allocate memory`

Thường chết ở `web` hoặc `maintenance-web` — hai image nặng nhất. Nguyên nhân là 10 image build song song, bốn cái trong đó chạy `next build`.

Ba cách, theo thứ tự nên thử: build tuần tự (xem mục 3), giải phóng RAM trên máy, tăng bộ nhớ cấp cho Docker Desktop.

Và kiểm xem có lượt build nào khác đang chạy không — hai lượt chồng nhau là nguyên nhân phổ biến nhất:

```bash
pgrep -fl "docker compose"
```

### Gọi API login trả 400 trông như sai mật khẩu

Thiếu trường `portal` trong body. Bắt buộc là `platform` hoặc `tenant`; với tenant thì phải kèm `tenantSlug`.

### `pnpm install` báo lockfile không khớp

Chạy đúng `pnpm install --frozen-lockfile`. Nếu vừa thêm dependency, `--lockfile-only` **không** tạo symlink workspace — phải cài thật thì import mới phân giải được.

### Muốn xoá sạch làm lại

Xem mục 3b — có ba mức tắt/bật khác nhau, `down --volumes` là mức nặng nhất và **mất hết dữ liệu**.

---

## 9. Chạy dev trên host (tuỳ chọn)

Chỉ cần khi muốn hot reload. Đòi hỏi Node 24 và pnpm 10.33.1 trên máy.

```bash
cp .env.example .env      # rồi thay hết password/token mẫu
pnpm install --frozen-lockfile
pnpm infra:up             # chỉ hạ tầng: postgres, rabbitmq, minio
pnpm db:provision
pnpm dev
```

| Ứng dụng | Cổng |
|---|---|
| Platform Web / Procedure / Maintenance / Inventory | 3002 / 3003 / 3004 / 3005 |
| Bốn API | 3333–3336 |
| Platform DB / Tenant DB | 55432 / 55433 |
| RabbitMQ / MinIO | 5672, 15672 / 9010, 9011 |

Kiểm tra trước khi commit:

```bash
pnpm check              # lint + typecheck + test + build toàn workspace
pnpm nx sync:check      # tham chiếu tsconfig còn đồng bộ không
```

Thêm migration mới thì **phải đăng ký trong `packages/platform/entitlement/src/lib/tenant-migrations.ts`** — đó là nguồn duy nhất, dùng chung cho cả migrator lẫn worker. Quên thì `tenant-migrations.spec.ts` sẽ đỏ ngay.
