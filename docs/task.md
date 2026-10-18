# Nhật ký thay đổi — Module Workspace (Dự án & Khách hàng)

> Ghi lại mọi thay đổi theo tiến độ plan tại `docs/plan.md`.
> Mỗi mục: ngày, phạm vi, file đụng tới, kết quả test (API + browser).

## Trạng thái commit

| Commit | Nội dung | Trạng thái | Test API | Test browser |
|---|---|---|---|---|
| 1 | Khách hàng/Hợp đồng + tab "Khách hàng" | ✅ Xong | ✅ | ✅ |
| 2 | Trang danh sách dự án: nhóm/lọc/đóng hồ sơ/gắn KH | ☐ Chưa làm | ☐ | ☐ |
| 3 | Group công việc + thêm thành viên ngoài dự án | ☐ Chưa làm | ☐ | ☐ |

---

## Chi tiết thay đổi

### COMMIT 1 — Khách hàng/Hợp đồng + tab "Khách hàng"
- Ngày: 2026-10-18
- File thay đổi:
  - contracts: `packages/contracts/workspace/src/lib/contracts-workspace.ts` (thêm `Customer`, `CustomerSummary`, `Contract`, `CONTRACT_STATUSES`, request types; `customerId` cho Project)
  - migration: `migrations/tenant/workspace/0023-workspace-customers-contracts.sql` (bảng `customers`, `contracts`, cột `projects.customer_id`)
  - backend: `domain/workspace.error.ts`, `application/workspace-store.port.ts`, `infrastructure/postgres-workspace-store.ts`, `application/customer.service.ts`(+spec), `application/contract.service.ts`(+spec), `workspace.module.ts`, `presentation/workspace.controller.ts` (8 route customers/contracts)
  - frontend: `workspace-api.ts` (client KH/HĐ), `workspace-screen.tsx` (mục nav "Dự án" hiện rõ + dải 2 tab Dự án/Khách hàng), `components/customers-view.tsx` (mới), `workspace-labels.ts` (CONTRACT_STATUS_*), `index.ts`
- Ghi chú: REST trả mảng trần cho list; `createProject/updateProject` tự truyền `customerId`. Migration 0023 đã áp vào tenant `svn` (sha256+ledger). Stack chạy local: gateway 8080 (docker) + dev servers host (api 3333, workspace-api 3337, web 3002, workspace-web 3006); env cần: `TENANT_DATABASE_URL_TEMPLATE`, `INTERNAL_SERVICE_TOKEN` cho api/workspace-api.
- Kết quả test API: `nx test module-workspace` PASS (394, +17 test customer/contract). Live e2e qua gateway: login svn → POST customer 201 → POST contract 201 → GET detail 200 (đủ customer+contracts).
- Kết quả test browser: PASS (Chrome extension). Tab "Khách hàng" render Master-Detail đúng; danh sách + chi tiết KH + bảng hợp đồng (KH-TEST-001/HD-TEST-001); tạo KH mới qua UI (KH-UI-002) thành công; tab "Dự án" cũ không vỡ. Dữ liệu test còn trong tenant svn (KH-TEST-001, HD-TEST-001, KH-UI-002).

### COMMIT 2 — Trang danh sách dự án
- Ngày: _(chưa bắt đầu)_
- File thay đổi:
- Ghi chú:
- Kết quả test API:
- Kết quả test browser:

### COMMIT 3 — Group công việc + thành viên ngoài dự án
- Ngày: _(chưa bắt đầu)_
- File thay đổi:
- Ghi chú:
- Kết quả test API:
- Kết quả test browser:

---

## Quyết định / vướng mắc phát sinh
- _(ghi khi có)_
