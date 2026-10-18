# Nhật ký thay đổi — Module Workspace (Dự án & Khách hàng)

> Ghi lại mọi thay đổi theo tiến độ plan tại `docs/plan.md`.
> Mỗi mục: ngày, phạm vi, file đụng tới, kết quả test (API + browser).

## Trạng thái commit

| Commit | Nội dung | Trạng thái | Test API | Test browser |
|---|---|---|---|---|
| 1 | Khách hàng/Hợp đồng + tab "Khách hàng" | ✅ Xong | ✅ | ✅ |
| 2 | Trang DS dự án: nhóm/lọc/đóng hồ sơ/gắn KH + Khách hàng theo ngữ cảnh | ✅ Xong | ✅ | ✅ |
| 3 | Group công việc + thêm thành viên ngoài dự án | ✅ Xong | ✅ | ✅ |
| 4 | Tài liệu khách hàng (nội bộ/khách hàng + chuột phải + hiển thị + tìm nhanh) | ✅ Xong (browser 1 phần) | ✅ | ◐ thiếu MinIO |

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
- Ngày: 2026-10-18
- File thay đổi:
  - `components/my-work-view.tsx` (E: group "Công việc của tôi" theo dự án, header thu/mở + đếm "chưa thực hiện")
  - `components/work-item-form.tsx` (G: create mode tìm người toàn công ty cho người phụ trách + người thực hiện cùng; tag "Ngoài dự án"; popup xác nhận tên+chức danh; truyền `addMemberUserIds`)
  - `components/people-picker.tsx` (prop `tagFor` render tag "Ngoài dự án")
  - `components/projects-view.tsx` (onCreate nhận `addMemberUserIds` → setMembers merge role 'member' trước khi createWorkItem)
  - `workspace.module.scss` (.groupToggle/.rowPending/.outsideTag)
- Ghi chú: không đổi backend (merge thành viên client-side qua `mergeNewProjectMembers` + `setMembers`). "Người thực hiện cùng" có thể trong hoặc ngoài dự án.
- Kết quả test API: lint feature-workspace 0 error; `tsc --build workspace-web` exit 0.
- Kết quả test browser: PASS (live) — E: "Công việc của tôi" group theo dự án (EVN/ADG, header đếm "chưa thực hiện", dòng chưa làm có vạch nhấn). G: trong DA-UI-TEST (1 thành viên), ô Người phụ trách tìm "toán" ra "Kế toán Hai/Một (test) · Ngoài dự án"; chọn Kế toán Hai → submit → popup "Thêm thành viên vào dự án" hiện tên + chức danh (Kế toán thanh toán) → Xác nhận → công việc tạo, giao cho Kế toán Hai, dự án thành 2 thành viên (tự thêm). (Lưu ý: danh bạ dùng cache module-level `use-directory.ts`; trong phiên dev có thể cần reload nếu nạp lúc chưa sẵn token — không ảnh hưởng deploy thật.)

### COMMIT 4 — Tài liệu khách hàng
- Ngày: 2026-10-18
- Phạm vi: trường `audience` nội bộ/khách hàng (mặc định nội bộ); chuột phải đổi loại trên tài liệu dự án; tài liệu khách hàng hiện ở trang "Khách hàng" của dự án; tìm nhanh tài liệu khách hàng.
- File thay đổi:
  - contracts: `DOCUMENT_AUDIENCES`, `DocumentAudience`, `WorkspaceDocument.audience`, `UpdateDocumentAudienceRequest`
  - migration: `migrations/tenant/workspace/0024-workspace-document-audience.sql` (cột `documents.audience` + partial index)
  - BE: `workspace-store.port.ts` (audience filter + `setAudience`), `postgres-workspace-store.ts` (map + filter + setAudience), `document.service.ts`(+spec, `setAudience` quyền requireWriteAccess), `workspace.controller.ts` (`PATCH /documents/:id/audience` + query `audience`)
  - FE: `workspace-api.ts` (`setDocumentAudience`, `listDocuments({audience})`), `workspace-labels.ts` (DOCUMENT_AUDIENCE_LABELS), `document-panel.tsx` (chuột phải đổi loại + badge "Khách hàng"), `customers-view.tsx` (prop `scopeProjectId` + mục "Tài liệu khách hàng"), `workspace-screen.tsx` (truyền scopeProjectId), `quick-search.tsx` (nhóm "Tài liệu khách hàng"), `workspace.module.scss`
- Ghi chú: ĐÃ HOÃN "hợp đồng hiện tên+link dự án" (cần quyết mô hình contract↔dự án). Migration 0024 đã áp vào tenant svn.
- Kết quả test API: `nx test module-workspace` 405 pass (+5 test audience); typecheck pass; lint feature-workspace 0 error; `tsc --build workspace-web` exit 0.
- Kết quả test browser: 1 PHẦN — trang Khách hàng scoped (DA-UI-TEST) hiện mục "TÀI LIỆU KHÁCH HÀNG" với empty state hướng dẫn chuột phải; không lỗi. Luồng đầy đủ (upload → chuột phải đổi khách hàng → hiện ở trang Khách hàng → tìm nhanh) CHƯA test được vì MinIO (storage) không chạy — image quay.io pull lỗi 401. Cần test lại khi có storage.

---

## Quyết định / vướng mắc phát sinh
- _(ghi khi có)_
