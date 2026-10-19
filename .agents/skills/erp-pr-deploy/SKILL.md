---
name: erp-pr-deploy
description: Dùng khi tạo nhánh, commit, mở hoặc cập nhật pull request, xử lý CI đỏ, merge, hay khi có người hỏi về deploy hoặc rollback ERP.
---

# Nhánh, PR, CI và deploy

## Nhánh và commit

- Tạo nhánh mới từ `origin/dev/release` (`feat/...`, `fix/...`), mỗi nhánh một việc. Không push thẳng vào `dev/release`
  hay `main`.
- Commit theo mẫu `feat(<phạm vi>): <mô tả>`, `fix(...)`, `refactor(...)`, `test(...)`, `docs(...)`, `ci(...)`. Phạm vi
  là phân hệ hay gói (`hrm`, `workspace`, `shared-ui`...).
- Chỉ format phần mình sửa; không chạy prettier cho cả file cũ, vì diff sẽ khó review và dễ conflict.
- Không commit `.env`, mật khẩu, token, bản dump DB, file Office/PDF, ghi chú cá nhân. Không thêm file lẻ vào gốc repo;
  tài liệu chung để ở `docs/`.

## Pull request

- PR vào `dev/release`. Mô tả ghi: đổi gì, vì sao, đã kiểm thế nào, có migration hay sự kiện mới không.
- Trước khi mở PR, chạy:
  ```bash
  pnpm nx affected -t lint typecheck test --base=origin/dev/release
  pnpm nx sync:check
  node tools/check-migrations.mjs
  node tools/check-ui-rules.mjs
  node tools/sync-agent-skills.mjs --check
  ```
- Check bắt buộc là `PR validation complete`. Nó gồm:
  - job `Detect CI scope`: chặn tài khoản đăng nhập nhanh, migration cũ bị sửa, skill lệch bản sao;
  - job `Validate affected projects`: luật giao diện, lint, typecheck, test, build của project bị ảnh hưởng;
  - job `Verify container ...`: build Docker image.
  Chi tiết ở `docs/ci-cd.md`.
- CI đỏ thì đọc log của job đỏ và sửa nguyên nhân. Không tắt test, không thêm `eslint-disable` hay `@ts-ignore` để qua
  CI, không sửa script kiểm tra để nó bỏ qua lỗi.
- Sửa `.github/` cần người giữ CODEOWNERS duyệt.

## Merge và deploy

- Merge vào `dev/release` chỉ build và đẩy image lên GHCR. **Merge không deploy.**
- Deploy do người phụ trách bấm trên Coolify. Mỗi lần deploy, cả hệ thống (kể cả DB) dừng khoảng 2 phút và migrator chạy
  trước API, nên gom nhiều PR rồi deploy một lần, vào giờ ít người dùng.
- Trợ lý AI không tự deploy, không gọi API Coolify, không SSH vào máy chủ production nếu không được giao rõ.
- Rollback: đặt `IMAGE_TAG=sha-<commit>` trong Coolify rồi deploy lại. Schema không lùi theo, nên migration phải tương
  thích ngược (skill `erp-migrations`).
