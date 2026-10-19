---
name: erp-migrations
description: Dùng khi thêm hoặc đổi schema DB (file .sql trong migrations/), đăng ký migration cho migrator, hoặc gặp lỗi "Checksum mismatch" khi deploy ERP.
---

# Migration DB (platform và tenant)

## Luật cứng

1. **Không sửa, xoá, đổi tên file `.sql` đã merge vào `dev/release`.** Migrator lưu sha256 của từng file trong
   `integration_schema.schema_migrations`; file đổi thì báo `Checksum mismatch`, dừng cả lượt chạy và mọi tenant phía
   sau không được nâng cấp. Sự cố thật: PR #60 sửa `tenant/core/0008` và `tenant/hrm/0033`, deploy lỗi, PR #65 phải
   trả lại file cũ và chuyển phần sửa sang file mới `tenant/hrm/0051`. Muốn đổi gì thì tạo file mới với số kế tiếp.
2. **File mới phải được đăng ký**, không thì không bao giờ chạy (xem bảng dưới).
3. **UTF-8 không BOM.** Migrator bỏ BOM trước khi tính checksum nhưng worker tạo tenant thì không, nên file có BOM làm
   lệch checksum giữa hai đường chạy (sự cố `fe4ece27`).
4. **Chạy lại được.** Dùng `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
   `DROP ... IF EXISTS`. Bắt buộc với `tenant/core`: lúc tạo tenant, identity service chạy lại toàn bộ core mà không
   ghi ledger (`platform-identity.service.ts`).
5. **Tương thích ngược.** Bản app cũ phải chạy được với schema mới (rollback chỉ lùi image, không lùi schema; xem
   `docs/ci-cd.md`, mục Rollback). Không `DROP` cột hay bảng còn được đọc trong cùng đợt. Đổi tên cột: thêm cột mới,
   chép dữ liệu, chuyển code sang cột mới, rồi bỏ cột cũ ở đợt sau.
6. **Chỉ đụng schema của phân hệ mình** (`<phân hệ>_schema`). Dữ liệu phân hệ khác lấy qua API hoặc sự kiện.

## Bố cục và nơi đăng ký

| Thư mục | DB | `module_key` trong ledger | Đăng ký ở |
|---|---|---|---|
| `migrations/platform/` | platform | `platform-core` | `apps/migrator/src/main.ts`, các lời gọi `migrate(...)` |
| `migrations/tenant/0001-integration.sql` | tenant | `integration` | có sẵn |
| `migrations/tenant/core/` | tenant | `tenant-core` | `TENANT_CORE_MIGRATIONS` |
| `migrations/tenant/<thư mục phân hệ>/` | tenant | mã phân hệ (thư mục `procedure` là `procedure-engine`) | `TENANT_MODULE_MIGRATIONS` |

Hai mảng ở `packages/platform/entitlement/src/lib/tenant-migrations.ts`. Thứ tự chạy là thứ tự trong mảng, không phải
thứ tự tên file. Version trong ledger là tên file bỏ `.sql`.

## Thêm migration cho phân hệ

1. Tạo `migrations/tenant/<phân hệ>/NNNN-mo-ta-ngan.sql`, `NNNN` là số lớn nhất trong thư mục cộng 1. Sau khi rebase mà
   trùng số với nhánh khác thì đổi số trước khi merge.
2. Mở đầu như các file gần đây:
   ```sql
   -- Đổi gì, vì sao, dữ liệu cũ được xử lý thế nào.
   SET LOCAL lock_timeout = '3s';
   SET LOCAL statement_timeout = '30s';
   ```
   Không viết `BEGIN`/`COMMIT`: migrator đã bọc mỗi file và dòng ledger trong một transaction.
3. Thêm vào **cuối** mảng của phân hệ trong `TENANT_MODULE_MIGRATIONS`:
   ```ts
   { version: '0065-mo-ta-ngan', path: 'tenant/hrm/0065-mo-ta-ngan.sql' },
   ```
   Phân hệ mới thì thêm cả thư mục vào `MODULE_DIRECTORIES` trong `tenant-migrations.spec.ts`.
4. Kiểm:
   ```bash
   node tools/check-migrations.mjs
   pnpm nx test platform-entitlement
   ```
5. Chạy thử trên DB local: `pnpm infra:up` rồi `pnpm db:provision`.

## Khi đã lỡ sai

- Migration đã merge bị sai: viết file mới để sửa (như `hrm/0051` sửa cho `0033`).
- Migration còn trong PR của mình, chưa merge: sửa thẳng được, vì kiểm tra chỉ so với `dev/release`.
- Cần tạm không chạy một file đã có: ghi vào `DELIBERATELY_UNREGISTERED` trong spec, kèm lý do.
- Deploy báo `Checksum mismatch for <module>/<version>`: trả file đó về đúng nội dung đã merge
  (`git show <commit>:migrations/...`), không sửa checksum trong DB.

## Kiểm tra trong CI

`tools/check-migrations.mjs` chạy ở job "Detect CI scope" cho mọi PR, kể cả PR chỉ có file `.sql`. Nó so với commit
gốc của PR và báo lỗi khi:
- file đã có bị sửa, xoá hoặc đổi tên (chỉ khác CRLF/LF thì bỏ qua, vì migrator chuẩn hoá xuống dòng);
- file có BOM;
- tên file mới sai mẫu `NNNN-ten-thay-doi.sql`;
- file mới chưa có trong nơi đăng ký.
