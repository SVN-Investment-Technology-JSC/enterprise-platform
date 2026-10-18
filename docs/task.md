# Nhật ký thay đổi — Module Workspace (Dự án & Khách hàng)

> Ghi lại mọi thay đổi theo tiến độ plan tại `docs/plan.md`.
> Mỗi mục: ngày, phạm vi, file đụng tới, kết quả test (API + browser).

## Trạng thái commit

| Commit | Nội dung | Trạng thái | Test API | Test browser |
|---|---|---|---|---|
| 1 | Khách hàng/Hợp đồng + tab "Khách hàng" | ✅ Xong | ✅ | ✅ |
| 2 | Trang DS dự án: nhóm/lọc/đóng hồ sơ/gắn KH + Khách hàng theo ngữ cảnh | ✅ Xong | ✅ | ✅ |
| 3 | Group công việc + thêm thành viên ngoài dự án | ☐ Chưa làm | ☐ | ☐ |
| 4 | Tài liệu khách hàng (nội bộ/khách hàng + chuột phải + hiển thị + tìm nhanh) | ☐ Chưa làm | ☐ | ☐ |

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
- Ngày: 2026-10-18
- Phạm vi: trang danh sách dự án (nhóm theo loại, lọc trạng thái, chuyển nhóm, đóng hồ sơ + ràng buộc BE); form tạo dự án chọn/tạo khách hàng; tab "Khách hàng" theo ngữ cảnh (trang chủ = tất cả KH, trong dự án = KH của dự án).
- File thay đổi:
  - FE mới: `components/projects-list-view.tsx` (ProjectsListView: bảng + group theo loại + lọc trạng thái/loại/KH + chọn nhiều + Chuyển nhóm + Đóng hồ sơ + tạo dự án)
  - FE sửa: `components/project-form.tsx` (customerRef→customerId qua SearchableSelect + tạo KH mới inline), `components/customers-view.tsx` (prop `scoped`/`scopeCustomerId`; bảng hợp đồng hàng cao hơn + tên 2 dòng), `workspace-screen.tsx` (projects: list↔detail theo `?project=`; customers: scoped theo dự án), `workspace.module.scss` (.listPage/.listScroll/.scopePane/.inlineCreate + .contractTable/.contractName)
  - BE: `domain/workspace.error.ts` (`ProjectHasOpenWorkItemsError`), `application/project.service.ts` (chặn đóng hồ sơ khi còn việc mở) + `.spec.ts`, `workspace-store.port.ts` + `postgres-workspace-store.ts` (`workItem.openItemCount`)
- Ghi chú: list hiện khi chưa mở dự án, detail khi có `?project=`. Tab Khách hàng: trang chủ = tất cả, trong dự án = chỉ KH của dự án đó. Bảng hợp đồng tách class riêng (không đụng bảng khác).
- Kết quả test API: `nx test module-workspace` 400 pass; typecheck pass; `tsc --build workspace-web` exit 0; lint feature-workspace 0 error.
- Kết quả test browser: PASS (live stack) — danh sách group theo loại; đóng hồ sơ DGHB bị chặn đúng ("còn công việc chưa hoàn thành"); tạo DA-UI-TEST gắn KH-UI-002 (SearchableSelect gõ không dấu "Điện lực"); liên kết dự án↔KH lưu ("1 dự án"); tab Khách hàng trong dự án chỉ hiện KH đó; trang chủ hiện tất cả KH; Chuyển nhóm DA-UI-TEST sang "Dịch vụ thí nghiệm" OK; hàng hợp đồng cao hơn. Dữ liệu test còn trong svn (DA-UI-TEST, KH-UI-002, KH-TEST-001/HD-TEST-001).

### COMMIT 3 — Group công việc + thành viên ngoài dự án
- Ngày: _(chưa bắt đầu)_
- File thay đổi:
- Ghi chú:
- Kết quả test API:
- Kết quả test browser:

### COMMIT 4 — Tài liệu khách hàng
- Ngày: _(chưa bắt đầu)_
- Phạm vi: trường `audience` nội bộ/khách hàng (mặc định nội bộ); chuột phải đổi loại trên tài liệu dự án; tài liệu khách hàng hiện ở trang "Khách hàng" của dự án; tìm nhanh tài liệu khách hàng.
- File thay đổi:
- Ghi chú:
- Kết quả test API:
- Kết quả test browser:

---

## Quyết định / vướng mắc phát sinh
- _(ghi khi có)_
