<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Quy tắc chung cho người và trợ lý AI viết code ERP

File này áp dụng cho mọi công cụ (Codex, Claude Code, Antigravity, Gemini...); Claude Code đọc nó qua `CLAUDE.md`,
Antigravity và Gemini qua `GEMINI.md`. Hướng dẫn chi tiết theo loại việc nằm trong `.agents/skills/`; `.claude/skills/` là bản
sao sinh tự động.

## Hệ thống

- Monorepo Nx và pnpm. Mỗi phân hệ có API NestJS (`apps/<m>-api`) và giao diện Next.js (`apps/<m>-web`, đường dẫn
  `/modules/<m>`). Ngoài ra có `apps/web` (màn chính, Platform Admin), `apps/worker` và `apps/notification-worker`
  (việc nền, sự kiện), `apps/migrator` (migration), gateway nginx ở `infrastructure/nginx`.
- Code nghiệp vụ nằm trong `packages`, app chỉ ghép lại:
  - `packages/modules/<m>`: phía server, chia `domain`, `application`, `infrastructure`, `presentation`;
  - `packages/contracts/<m>`: kiểu và hằng số dùng chung giữa web và API;
  - `packages/features/<m>`: màn hình React, bọc trong `ModuleShell`;
  - `packages/platform`, `packages/adapters`, `packages/shared`: phần dùng chung.
- Mỗi tenant có DB riêng; mỗi phân hệ một schema `<m>_schema`. Migration ở `migrations/`.
- Phân hệ hiện có: `hrm`, `workspace`, `procedure-engine` (tiền tố quyền `procedure`), `maintenance`, `inventory`,
  `finance`, `shared`, `assistant`.

## Luật cứng

1. Không sửa, xoá, đổi tên migration đã merge vào `dev/release`; thay đổi tiếp bằng file mới. CI chặn. Skill `erp-migrations`.
2. Mọi API kiểm quyền ở server, qua guard của phân hệ dựa trên `ModuleAccess`. Ẩn nút ở giao diện không phải là phân
   quyền. Route HRM mới phải có `@RequirePermission`. Skill `erp-permissions`.
3. Action quyền mới chỉ thêm vào `TENANT_PERMISSION_ACTIONS`; không tạo danh sách quyền thứ hai.
4. Không ghi vào schema của phân hệ khác. Dữ liệu của phân hệ khác lấy qua API, route `/v1/internal/`, hoặc sự kiện.
5. Sự kiện giữa các phân hệ ghi vào outbox trong cùng transaction với thay đổi dữ liệu. Không đổi tên loại sự kiện đã
   phát. Skill `erp-events`.
6. Giao diện dùng `SearchableSelect`, không dùng thẻ `<select>`; không dùng emoji. CI chặn. Skill `ui-design`.
7. Không commit bí mật (`.env`, mật khẩu, token, tài khoản đăng nhập nhanh), bản dump DB, file Office/PDF, ghi chú cá
   nhân. Không thêm file lẻ vào gốc repo; tài liệu chung để ở `docs/`.
8. Không tự deploy. Merge vào `dev/release` chỉ build image; người phụ trách deploy trên Coolify, và mỗi lần deploy cả
   hệ thống dừng khoảng 2 phút. Skill `erp-pr-deploy`.
9. Không format lại cả file cũ; chỉ format phần mình sửa.
10. Chỉ sửa trong phạm vi việc được giao. Thấy lỗi khác thì ghi lại và báo, không sửa lan sang chỗ khác, nhất là
    `.github/`, cấu hình triển khai và script kiểm tra.
11. Không làm CI xanh bằng cách tắt test, thêm `eslint-disable`, `@ts-ignore`, hoặc nới script kiểm tra.

## Cách làm một việc

1. Tạo nhánh từ `origin/dev/release`; PR vào `dev/release`.
2. Đọc skill đúng loại việc trước khi sửa (bảng dưới).
3. Viết test cho logic mới (Jest, file `*.spec.ts` đặt cạnh code).
4. Trước khi mở PR, chạy:
   ```bash
   pnpm nx affected -t lint typecheck test --base=origin/dev/release
   pnpm nx sync:check
   node tools/check-migrations.mjs
   node tools/check-ui-rules.mjs
   node tools/sync-agent-skills.mjs --check
   ```
5. Commit theo mẫu `feat(<phạm vi>): <mô tả>` hoặc `fix(...)`. Mô tả PR ghi đổi gì, vì sao, đã kiểm thế nào.

## Skill theo loại việc

| Việc | Skill |
|---|---|
| Thêm phân hệ; thêm màn hình hay API vào phân hệ | `erp-module` |
| Quyền, guard, action mới, API nội bộ giữa service | `erp-permissions` |
| Đổi schema DB | `erp-migrations` |
| Phát hoặc nghe sự kiện, thêm loại thông báo | `erp-events` |
| Nhánh, PR, CI, merge, deploy | `erp-pr-deploy` |
| Giao diện, component, bố cục | `ui-design` |
| Lệnh Nx, generator | `nx-workspace`, `nx-generate`, `nx-run-tasks` |

Sửa skill ở `.agents/skills/` rồi chạy `node tools/sync-agent-skills.mjs` để cập nhật bản sao cho Claude Code.

## Ngôn ngữ

- Chữ trên giao diện và thông báo lỗi trả cho người dùng: tiếng Việt có dấu đầy đủ.
- Tên biến, hàm, file: tiếng Anh.

## Đọc code hiệu quả

- File lớn (trên 1.000 dòng): tìm bằng từ khoá chính xác rồi đọc khối 100–300 dòng quanh chỗ cần, không đọc lặp từng
  đoạn 5–20 dòng.
- Tìm 1–2 lần không thấy thì đọc tại chỗ dùng, đừng lặp tìm kiếm.
- Không chạy typecheck hay build toàn workspace khi chỉ khảo sát hoặc trả lời câu hỏi; chạy `nx affected` trước khi commit.
