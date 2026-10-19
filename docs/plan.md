# Kế hoạch triển khai — Module Workspace (Dự án & Khách hàng)

> Nguồn: feedback nghiệp vụ (nhóm chat) + yêu cầu bổ sung.
> Ngày lập: 2026-10-18. Nhánh: `dev/release-5`.

## 1. Mục tiêu tổng quan

Nâng cấp module Workspace để:
1. Có khu **"Dự án"** với **2 tab đầu màn**: **"Dự án"** và **"Khách hàng"** (theo mẫu UI 2 tab: "Sổ giao dịch & Xuất nhập" | "Kiểm kê kho & Đối soát").
2. Có **trang danh sách Dự án** độc lập (hiện chỉ có ở sidebar, `projects-view.tsx` luôn là chi tiết 1 dự án).
3. Quản lý **Khách hàng** và **Hợp đồng của khách hàng** (thực thể mới — chưa có trong code).
4. Đáp ứng 5 feedback: chuyển nhóm dự án, lọc trạng thái, đóng hồ sơ + ràng buộc, group công việc theo HĐ/Dự án, thêm thành viên ngoài dự án khi tạo công việc.

## 2. Quyết định đã chốt

- **Nhóm dự án = Loại dự án (`projectType`)**. "Chuyển nhóm" = đổi `projectType`.
- **"Thuộc hợp đồng" = thuộc khách hàng nào.** Dự án liên kết tới **Khách hàng**; Hợp đồng thuộc Khách hàng.
- Khu "Dự án" có **2 tab**: "Dự án" (danh sách dự án) và "Khách hàng" (danh sách KH + HĐ của KH).
- **Ngữ cảnh tab "Khách hàng"**: ở **trang chủ Dự án** (chưa chọn dự án) hiện **tất cả** khách hàng; khi **đã vào 1 dự án** thì chỉ hiện **khách hàng của dự án đó** (kèm hợp đồng, và tài liệu khách hàng của dự án — xem Commit 4).
- Form tạo dự án: trường **Khách hàng** = `SearchableSelect` (lọc tức thì); không có thì **tạo mới (cả mã + tên)**.
- **Tài liệu** có 2 loại: **nội bộ** (mặc định) và **khách hàng** (vd proposal, hợp đồng). Tài liệu khách hàng hiển thị ở **trang "Khách hàng" của dự án**; đổi nội bộ ↔ khách hàng bằng **chuột phải** trên tài liệu; tài liệu khách hàng **tìm nhanh** được (như công việc/dự án).
- Mục thêm thành viên khi tạo công việc: tìm người **toàn công ty**, người chưa thuộc dự án gắn tag **"Ngoài dự án"**; khi người tạo vẫn thêm → **popup xác nhận hiện tên + chức danh**, xác nhận xong người đó **tham gia dự án luôn**. Menu tìm tên **không hiện chức danh**.

## 3. Hiện trạng code (điểm neo)

- Nav/route hash: `workspace-screen.tsx` (`type Tab`, `NAV`; `#projects` đang `hidden: true`).
- Màn dự án: `components/projects-view.tsx` — luôn là **chi tiết 1 dự án**, KHÔNG có trang danh sách. Danh sách dự án chỉ ở sidebar (`workspace-screen.tsx` `sidebarSections`, group theo `projectType`).
- Bảng "Công việc của tôi": `components/my-work-view.tsx` (bảng phẳng, chưa group).
- Form tạo dự án: `components/project-form.tsx` — có `customerRef` là **text tự do** ("Mã khách hàng").
- Form tạo công việc: `components/work-item-form.tsx` — assignee **chỉ trong thành viên dự án** (`members`).
- Picker người: `components/people-picker.tsx` — **không** hiển thị `positionName` (chức danh); `components/members-dialog.tsx` đã lấy **toàn bộ danh bạ công ty** (`GET /directory`).
- Trạng thái dự án: `PROJECT_STATUSES = planning|active|on_hold|completed|cancelled` (`contracts-workspace.ts`), nhãn ở `workspace-labels.ts` (`completed`=Hoàn thành, `active`=Đang chạy).
- Backend: `packages/modules/workspace/src/lib/application/*.service.ts`, API `apps/workspace-api/`, migration `migrations/tenant/workspace/`.
- Client API: `packages/features/workspace/src/lib/workspace-api.ts`.
- Chưa có entity Khách hàng/Hợp đồng ở bất kỳ đâu (`customerRef` chỉ là con trỏ).

## 4. Quy ước chung

- UI theo `AGENTS.md`: shadcn/ui + Tailwind; bảng phức tạp dùng antd; `SearchableSelect` (`@enterprise-platform/shared-ui`) thay cho `<select>`; **không emoji**; 3 định dạng tương tác Popconfirm / Drawer / Dialog; bố cục Master–Detail 16:9.
- Chạy lệnh qua `pnpm nx ...` (không dùng CLI global).
- **Sau mỗi mục dev lớn (mỗi commit): bắt buộc unit test lại trước khi sang mục kế tiếp. Unit test gồm cả test API và test qua browser.**
- Mọi thay đổi ghi lại vào `docs/task.md`.

---

## 5. Kế hoạch theo 3 commit

Mỗi commit là một "mục dev lớn" độc lập, test được (API + browser) trước khi qua commit kế.

### COMMIT 1 — Nền tảng Khách hàng/Hợp đồng + tab "Khách hàng"

**Commit message:**
```
feat: quản lý khách hàng, hợp đồng và tab khách hàng trong workspace
```

**Backend (A')**
- Migration mới trong `migrations/tenant/workspace/`:
  - Bảng `customer` (`id`, `code` mã, `name` tên, `note?`, audit cột).
  - Bảng `contract` (`id`, `code`, `name`, `customer_id` FK, `value?`, `status?`, audit).
  - Thêm cột `project.customer_id` (nullable, FK) — giữ `customerRef` cũ để backward-compat.
- `packages/contracts/workspace/src/lib/contracts-workspace.ts`:
  - Type `Customer`, `Contract`; request/response CRUD (`CreateCustomerRequest`, `UpdateCustomerRequest`, `CreateContractRequest`, ...).
  - Thêm `customerId` vào `Project`, `CreateProjectRequest`, `UpdateProjectRequest`.
- `packages/modules/workspace/src/lib/application/`: `customer.service.ts`, `contract.service.ts`; cập nhật `project.service.ts` nhận `customerId`.
- `apps/workspace-api/`: route `GET/POST/PUT /customers`, `GET/POST/PUT /contracts` (hoặc `/customers/:id/contracts`).
- `packages/features/workspace/src/lib/workspace-api.ts`: client methods `listCustomers`, `createCustomer`, `updateCustomer`, `listContracts`, `createContract`, `updateContract`.

**Frontend (A — phần tab + trang Khách hàng)**
- `workspace-screen.tsx`: bật nav `projects` (bỏ `hidden`), thêm cấp **2 tab** ("Dự án" | "Khách hàng") cho khu dự án; route hash con.
- Tạo `components/customers-view.tsx`: Master–Detail (trái: danh sách KH tìm/lọc; phải: HĐ của KH), nút tạo/sửa KH và HĐ (Dialog), xác nhận xoá bằng Popconfirm.

**Unit test (trước khi qua commit 2)**
- API: CRUD Khách hàng, CRUD Hợp đồng, liên kết `project.customerId`; ràng buộc FK. Chạy qua `pnpm nx test modules-workspace` (và test app `workspace-api`).
- Browser: mở tab "Khách hàng", tạo/sửa/xem KH + HĐ hiển thị đúng.

---

### COMMIT 2 — Trang danh sách "Dự án": nhóm, lọc, đóng hồ sơ, gắn khách hàng

**Commit message:**
```
feat: trang danh sách dự án với nhóm, lọc, đóng hồ sơ và gắn khách hàng
```

**Frontend**
- Tạo `components/projects-list-view.tsx`: bảng danh sách dự án (mã–tên, loại, khách hàng, trạng thái, % hoàn thành), cuộn nội bộ; mở chi tiết giữ deep-link `?project=<id>` (vào `projects-view.tsx`).
- **B — Nhóm theo loại + chuyển nhóm:** group dòng theo `projectType`; chọn 1/nhiều dự án + action "Chuyển nhóm" (đổi `projectType` qua `api.updateProject`).
- **C — Lọc trạng thái:** bộ lọc trạng thái + loại + khách hàng bằng `SearchableSelect`.
- **D — Đóng hồ sơ:** nút "Đóng hồ sơ" (→ `completed`) với **Popconfirm**; gọi `api.updateProject`.
- **F — Tạo dự án gắn khách hàng:** `components/project-form.tsx` đổi trường "Mã khách hàng" (text) → **`SearchableSelect`** chọn khách hàng; nếu không có → tạo mới inline (mã + tên) qua `createCustomer`; gửi `customerId`.

**Backend**
- **D — ràng buộc logic đóng hồ sơ:** trong `project.service.ts`, chặn chuyển `completed` nếu còn work-item chưa `done`/`cancelled` (hoặc còn đơn/đề nghị treo) → trả lỗi nghiệp vụ rõ ràng.
- `updateProject` hỗ trợ đổi `projectType`, `status`, `customerId`.

**Scoped Khách hàng (ngữ cảnh)**
- `CustomersView` nhận prop `scopeCustomerId?`: khi vào 1 dự án → chỉ hiện khách hàng của dự án (chi tiết + hợp đồng), không có master list/"Thêm khách hàng"; chưa gắn KH → trạng thái rỗng. Trang chủ (chưa chọn dự án) → toàn bộ KH như cũ.
- `workspace-screen.tsx`: `view==='projects'` → `ProjectsListView` khi chưa mở dự án, `ProjectsView` khi đã mở; `view==='customers'` → scoped theo `openProjectInfo.customerId` khi đang trong dự án.

**Unit test (trước khi qua commit 3)**
- API: `updateProject` đổi loại/khách hàng/trạng thái; **ràng buộc đóng hồ sơ** (có cv chưa xong → báo lỗi; xong hết → cho đóng); `createProject` kèm `customerId`; tạo khách hàng inline.
- Browser: danh sách + group theo loại, lọc trạng thái, chuyển nhóm, Popconfirm đóng hồ sơ (cả case bị chặn), tạo dự án chọn/tạo mới khách hàng.

---

### COMMIT 3 — Group công việc theo HĐ/Dự án + thêm thành viên "Ngoài dự án"

**Commit message:**
```
feat: nhóm công việc theo dự án và thêm thành viên ngoài dự án
```

**Frontend**
- **E — Group công việc:** `components/my-work-view.tsx` gom nhóm công việc theo **Khách hàng/Dự án** (header nhóm có thể thu/mở), thể hiện rõ công việc **chưa thực hiện** theo nhóm.
- **G — Thêm thành viên ngoài dự án khi tạo công việc:** `components/work-item-form.tsx` cho picker tìm **toàn công ty** (dùng `useDirectory`); người chưa thuộc dự án gắn **tag "Ngoài dự án"**; menu tìm tên **không hiện chức danh** (`people-picker.tsx` giữ nguyên list, chỉ bổ sung tag); khi chọn người ngoài dự án → **Popup xác nhận hiển thị tên + chức danh (`positionName`)**; xác nhận → gọi `api.setMembers` merge người đó vào dự án (dùng `mergeNewProjectMembers`) rồi gán việc.

**Backend**
- `project.service.ts` / `setMembers`: đảm bảo merge an toàn khi auto-add thành viên (PUT replace → merge set hiện có).

**Unit test (trước khi kết thúc)**
- API: `createWorkItem` gán người ngoài dự án → người đó được thêm vào `members`; `setMembers` merge đúng.
- Browser: tạo công việc, tìm người toàn công ty, thấy tag "Ngoài dự án", popup xác nhận tên+chức danh, sau xác nhận người đó thành thành viên; bảng công việc group theo Dự án/Khách hàng.

---

### COMMIT 4 — Tài liệu khách hàng

**Commit message:**
```
feat: phân loại tài liệu nội bộ/khách hàng và hiển thị trên trang khách hàng
```

**Backend**
- Thêm trường loại tài liệu `audience: 'internal' | 'customer'` (mặc định `internal`) vào `WorkspaceDocument` (contracts) + migration cột `documents.audience` + store/service.
- Endpoint đổi loại tài liệu (PATCH audience). Lọc tài liệu theo `audience` + theo dự án/khách hàng; cho phép quick-search trả tài liệu (đã có `listDocuments({search})`, bổ sung lọc/gắn nhãn khách hàng).
- **Files:** `contracts-workspace.ts` (`WorkspaceDocument.audience`, `DOCUMENT_AUDIENCES`), migration `migrations/tenant/workspace/00xx-workspace-document-audience.sql`, `workspace-store.port.ts`, `postgres-workspace-store.ts`, `document.service.ts`(+spec), `workspace.controller.ts`.

**Frontend**
- **Chuột phải đổi loại:** trong `components/document-panel.tsx` (đã có `ContextMenu`/`ContextAction`), thêm hành động "Đổi sang tài liệu khách hàng" / "Đổi về nội bộ" trên tài liệu đã upload trong dự án.
- **Hiển thị trên trang Khách hàng của dự án:** `CustomersView` khi scoped theo dự án hiện thêm mục **Tài liệu khách hàng** (các tài liệu `audience='customer'` của dự án) bên cạnh hợp đồng.
- **Hợp đồng có nguồn từ dự án:** nếu một hợp đồng/tài liệu khách hàng gắn với dự án thì hàng hợp đồng hiện thêm **tên dự án** dưới dạng **link sang dự án** (cần liên kết contract/tài liệu ↔ dự án; bổ sung `projectId` cho contract hoặc map qua tài liệu).
- **Quick-search:** `components/quick-search.tsx` cho tìm nhanh tài liệu khách hàng (nhãn/nhóm "Tài liệu khách hàng") tương tự công việc/dự án.
- **Files:** `document-panel.tsx`, `customers-view.tsx`, `quick-search.tsx`, `workspace-api.ts`.

**Tinh chỉnh giao diện bảng Hợp đồng (áp sớm, vùng Commit 2):** hàng hợp đồng **cao hơn**, cột **Tên hợp đồng cho phép xuống 2 dòng** (không cắt 1 dòng). Sửa ở `customers-view.tsx` + scss.

**Unit test**
- API: đổi `audience`, lọc tài liệu khách hàng theo dự án, quick-search trả tài liệu khách hàng.
- Browser: upload tài liệu → chuột phải đổi sang khách hàng → thấy ở trang Khách hàng của dự án; tìm nhanh ra tài liệu khách hàng.

---

## 6. Phụ thuộc & thứ tự

- Commit 1 (nền: entity + API) → Commit 2 (F cần `customerId`; trang danh sách + Khách hàng theo ngữ cảnh) → Commit 3 (E group theo khách hàng nhờ commit 1) → Commit 4 (Tài liệu khách hàng, cần trang Khách hàng theo ngữ cảnh của Commit 2).
- Commit 1 đã xong (đã commit `a734dbc5`): entity + API + tab Khách hàng, đã test API + browser.
- Rủi ro lớn nhất: migration Khách hàng/Hợp đồng + chuyển `customerRef` (text) sang `customerId` (FK) — giữ song song, không backfill tự động.

## 7. Lệnh test tham khảo

- API/unit: `pnpm nx test feature-workspace`, `pnpm nx test modules-workspace`, `pnpm nx test workspace-api` (xác nhận tên target bằng `pnpm nx show project <name>` nếu khác).
- Lint/build khi bàn giao: `pnpm nx lint ...`, `pnpm nx build ...`.
- Browser: chạy app `workspace-web` (`pnpm nx serve workspace-web`) và kiểm thử theo kịch bản từng commit.
