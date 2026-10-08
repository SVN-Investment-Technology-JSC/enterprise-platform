# THAY ĐỔI DỰ KIẾN TRƯỚC KHI SỬA LỖI ĐỢT 2

**Ngày lập:** 06/10/2026
**Căn cứ:** `TEST_testrun2_2026_10_06_ketqua.xlsx`, `PLAN/PLAN_FIX_PLATFORM_TEST_RESULTS.md`, kết quả sửa đợt 1 và phần so sánh hai kế hoạch.
**Trạng thái:** CHƯA thực hiện. Tài liệu này để duyệt trước. Chưa có mã nào được sửa theo nội dung dưới đây.

---

## 0. Hiện trạng đợt 1 (đã sửa, chưa commit)

Đã sửa trong working copy, test các project bị ảnh hưởng đạt, chưa kiểm trên trình duyệt:

| Nhóm | Đã làm |
|---|---|
| Outbox | Relay cô lập sự kiện lỗi, tự bù `occurredAt`/`tenantId`, loại sự kiện nội bộ của HRM bridge, trigger 0008 ghi `occurredAt` |
| Workspace | Ngày lệch múi giờ, chuông giả, lọc thư mục dự án, quyền `workspace.project.create` và `workspace.document.delete`, nút Mở khoá |
| HRM | Form ca, ngày nghỉ hằng tuần trong tính công, thông báo lỗi lương, roster đọc ca thật, hiển thị cứng, truy vấn `/positions` |
| PE | Vai S, validate 400, ô Nhóm, dropdown/Esc ở dialog QL trực tiếp, tìm không dấu, `<select>` ở bộ lọc |
| Kho | Dữ liệu giả hồ sơ thiết bị và kiểm kê, trạng thái sê-ri, UI giữ chỗ, trường Nhóm, validate 400 |
| Bảo trì | Popconfirm hoàn thành sự cố, xuất vật tư kèm phiếu, tệp đính kèm |
| Portal | 16 thẻ `<select>` đổi sang SearchableSelect, bỏ emoji |

**Thay đổi trong working copy KHÔNG thuộc các đợt sửa lỗi** (cần bạn xử lý riêng, các gói dưới đây sẽ không đụng vào):
- `packages/features/hrm/src/lib/screens/payroll-screen.tsx` (xuất Excel, đang có 2 lỗi typecheck dòng 105-106)
- `packages/features/hrm/package.json` và `pnpm-lock.yaml` (thêm `xlsx`)
- thư mục `PLAN/`

---

## 1. Nguyên tắc thực hiện

1. Mỗi gói việc (WP) có phạm vi file riêng, không đè nhau. Gói nào cần sửa file thuộc gói khác thì ghi rõ ở mục "Phụ thuộc".
2. Không commit. Chỉ chạy `nx test|typecheck|lint` của project bị ảnh hưởng, không build toàn workspace.
3. Dữ liệu thử nghiệm chỉ ở tenant TEST (`testrun2`, `testrun3`, tenant mới). **Không** chạy thao tác ghi lên DB `savina`, `test`, `qa03` nếu chưa có phê duyệt riêng.
4. Mỗi gói kết thúc bằng báo cáo: file đổi, test chạy, phần chưa làm.
5. Sau khi các gói xong: kiểm tra trên tenant mới theo thứ tự đã đề xuất (Core, PE, HRM, Kho, Bảo trì, Workspace, giao diện chung).

---

## 2. Danh sách gói việc

### WP1: Rào chắn giao diện và sửa phần dùng chung

**Phạm vi file:** `packages/shared/ui`, `packages/features/module-shell`, `packages/features/procedure-engine/.../components`, `packages/features/maintenance`, `packages/features/inventory` (trừ `stocktake-hub.tsx`), cấu hình ESLint, và màn từ chối đơn của `packages/features/hrm`.

| # | Thay đổi | Hành vi sau khi sửa | Rủi ro |
|---|---|---|---|
| 1.1 | Popconfirm có ô nhập lý do (prop mới, tương thích ngược) | Hành động cần lý do (từ chối đơn) dùng được Popconfirm đúng chuẩn | Thấp; kiểu gõ lại chuỗi xác nhận hiện có phải giữ nguyên |
| 1.2 | Đổi dialog "Từ chối đơn" của HRM sang Popconfirm có lý do | Từ chối đơn không còn mở dialog | Thấp-trung bình; cần backend vẫn nhận lý do bắt buộc |
| 1.3 | Esc trong SearchableSelect không đóng cả Dialog/Drawer | Esc đóng dropdown trước, dialog chỉ đóng ở lần nhấn sau | Trung bình; phụ thuộc cách dialog xử lý Esc, cần thử trên trình duyệt |
| 1.4 | Thay `<select>` còn sót ở 4 panel PE (`attachment-panel`, `material-request-panel`, `organization-board`, `subtask-panel`) | Đồng nhất SearchableSelect | Thấp |
| 1.5 | Thay `alert()`/`confirm()` còn sót ở `maintenance-matrix.tsx` và `excel-import-dialog.tsx` | Thông báo inline | Thấp |
| 1.6 | Sửa nhãn biểu đồ PE bị cắt (`BarChart` trong `module-shell`) | Nhãn xuống dòng hoặc đủ rộng, tooltip đầy đủ | Thấp |
| 1.7 | Quy tắc ESLint cấm `<select>`, `alert/confirm/prompt`, emoji trong giao diện, đặt mức cảnh báo (warn) | Lỗi tái phát bị báo khi lint, không làm vỡ build hiện tại | Thấp; có thể sinh nhiều cảnh báo ở mã cũ |

**Không đụng:** `payroll-screen.tsx`, `stocktake-hub.tsx`, backend, migration.

---

### WP2: Khởi tạo tenant và migration cho tenant đã có

**Phạm vi file:** `migrations/tenant/core`, `packages/platform/entitlement` (đăng ký migration), `packages/platform/identity` (phần cấp tenant), `apps/migrator` (không đụng dòng seed quyền), `packages/adapters/events`, `apps/worker`.

| # | Thay đổi | Hành vi sau khi sửa | Rủi ro |
|---|---|---|---|
| 2.1 | Migration core mới (idempotent) tạo lại hai hàm trigger với envelope đầy đủ, kể cả sự kiện `position.deleted` | Sự kiện mới đều có `occurredAt`, đúng cấu trúc | Trung bình; `position.deleted` hiện có cấu trúc phẳng khác, bridge đọc `payload.payload`, phải giữ tương thích |
| 2.2 | Seed loại node mặc định (đơn vị, chức danh) khi bảng rỗng | Tenant mới không cần chèn DB để HRM thấy chức danh | Thấp; không ép gán `node_type_id` cho node cũ |
| 2.3 | Cơ chế áp migration core lên **tenant đã tồn tại** (hiện core chỉ chạy lúc cấp tenant) | Tenant cũ nhận trigger mới | **Cao, cần bạn quyết định** (xem mục 4): sẽ thay đổi trigger trên mọi tenant đang chạy, kể cả tenant thật |
| 2.4 | Hàm `outboxHealth(pool)`: số sự kiện chờ, số bị "đỗ" (đã thử >= 10 lần), tuổi sự kiện cũ nhất; worker ghi log cảnh báo khi thay đổi | Sự kiện bị đỗ không còn nằm im; chưa có giao diện | Thấp |
| 2.5 | Cập nhật danh sách tệp migration và spec liên quan | Test cấp tenant vẫn đạt | Thấp |

**Kiểm chứng:** chạy migration 2 lần trên `testrun2`/`testrun3` để xác nhận idempotent.

---

### WP3: Kho: kiểm kê và lô hàng chuyển sang backend

**Phạm vi file:** `packages/modules/inventory`, `apps/inventory-api`, `packages/features/inventory`, `packages/contracts/inventory`, `packages/contracts/identity` (danh mục quyền), `migrations/tenant/inventory`, và **dòng seed quyền** trong `apps/migrator/src/main.ts`.

| # | Thay đổi | Hành vi sau khi sửa | Rủi ro |
|---|---|---|---|
| 3.1 | API kiểm kê: tạo đợt (chốt snapshot tồn), nhập số đếm, duyệt và ghi sổ sinh phiếu điều chỉnh trong cùng transaction | Kiểm kê lưu server, không mất khi đổi trình duyệt | **Cao**: thay đổi sổ kho; cần test kỹ số liệu |
| 3.2 | Quyền mới `inventory.stocktake.create`, `inventory.stocktake.approve`: thêm vào danh mục, seed migrator, guard API, ẩn nút theo quyền | Thủ kho tạo đợt, quản lý kho duyệt | Trung bình; vai trò hiện tại mất quyền cho đến khi được cấp |
| 3.3 | Bảng lô hàng (số lô, hạn dùng, số lượng còn) và API; phiếu nhập ghi lô lên server | Lô không còn lưu localStorage | Cao; cần migration |
| 3.4 | Xuất kho theo lô FEFO (hết hạn trước xuất trước) và trừ theo sê-ri | Xuất kho gắn đúng lô, sê-ri | Cao; ảnh hưởng luồng xuất kho đang dùng |
| 3.5 | `stocktake-hub.tsx` đọc API, bỏ localStorage và 5 `alert()` | Giao diện kiểm kê dùng dữ liệu server | Trung bình |

**Dữ liệu cũ:** đợt kiểm kê và lô đang nằm trong localStorage của từng người dùng sẽ **không** tự chuyển lên server. Cần bạn quyết định (mục 4).

**Phụ thuộc:** gói này là gói duy nhất được sửa dòng seed quyền trong migrator; WP2 không sửa dòng đó.

---

### WP4: HRM: chính sách, phân quyền, chẩn đoán

**Phạm vi file:** `packages/modules/hrm`, `packages/features/hrm` (trừ `payroll-screen.tsx`), `apps/hrm-api`, `migrations/tenant/hrm`.

| # | Thay đổi | Hành vi sau khi sửa | Rủi ro |
|---|---|---|---|
| 4.1 | Ngày nghỉ hằng tuần áp dụng cho đơn nghỉ phép (đếm ngày làm việc), phân ca và dashboard | Nghỉ 3 ngày qua Thứ 7/CN không bị trừ phép sai | Trung bình; đổi cách tính phép |
| 4.2 | Khấu trừ tạm ứng: giới hạn theo thu nhập khả dụng, phần còn lại chuyển sang kỳ sau | Tính lương không báo lỗi khi khấu trừ vượt thu nhập | **Cao**: đổi lịch thu hồi tạm ứng và công thức NET |
| 4.3 | Chẩn đoán thẻ "Đơn chờ duyệt luôn 0" ở dashboard, sửa nếu tìm ra nguyên nhân | Số đơn chờ khớp dữ liệu | Thấp (chẩn đoán trước, sửa sau) |
| 4.4 | Ma trận kiểm thử quyền HRM (vai trò × hành động × phạm vi) bằng test tự động; rà soát sidebar và payload chi tiết nhân viên có lộ lương hay không | Biết chính xác ô nào lộ; chỉ sửa ô báo không đạt | Thấp cho phần test; trung bình cho phần sửa |
| 4.5 | Cảnh báo khi chưa khai báo "Báo cáo cho"/trưởng đơn vị (ảnh hưởng phạm vi duyệt đơn) | Quản trị biết vì sao bước quản lý trực tiếp phân giải sai | Thấp |
| 4.6 | Roster: gán ca ở cấp đơn vị, cá nhân ghi đè (kế thừa, không sao chép bản ghi) | Gán ca cho cả phòng một lần | **Cao**: cần bảng/cột mới và đổi cách đọc ca; **đề xuất tách thành bước sau** nếu bạn muốn giảm phạm vi |

**Không đụng:** `payroll-screen.tsx`.

---

### WP5: Workspace và PE

**Phạm vi file:** `packages/modules/workspace`, `packages/features/workspace`, `apps/workspace-api`, `apps/workspace-web`, `packages/modules/procedure-engine`, `packages/features/procedure-engine`.

| # | Thay đổi | Hành vi sau khi sửa | Rủi ro |
|---|---|---|---|
| 5.1 | Danh bạ thành viên dự án: khi chưa có bổ nhiệm thì lấy user hoạt động của tenant, chỉ cho người có quyền quản lý dự án | Tenant mới gán được thành viên | Trung bình; nguy cơ lộ danh sách nhân sự, nên có điều kiện quyền |
| 5.2 | Chi tiết sự kiện lịch: người tổ chức thấy phản hồi từng người mời | Biết ai đồng ý, từ chối, chờ | Thấp |
| 5.3 | Panel chi tiết tài liệu dùng Drawer; tự tạo thư mục mặc định khi tạo dự án (mở khoá nút Tải lên) | Đúng chuẩn UI, tải lên ngay | Trung bình |
| 5.4 | Hồ sơ PE đã huỷ hiển thị "Đã huỷ" thay tiến độ | Không hiện 0/1 | Thấp |
| 5.5 | Đánh giá `synchronizeNormalized` của PE (đo trước, chưa refactor) | Có số liệu để quyết định | Thấp |
| 5.6 | Script **xuất danh sách** dự án/việc có ngày bị trôi do lỗi cũ (chỉ đọc, không sửa dữ liệu) | Người quản lý rà tay | Thấp |

---

## 3. Những việc cố ý KHÔNG làm trong đợt này

| Mục | Lý do |
|---|---|
| Nút "+ Bổ nhiệm" trực tiếp ở Core (CORE-09) | Sẽ vượt qua hồ sơ quyết định nhân sự, gây lệch dữ liệu HRM; chỉ giữ hướng dẫn sang HRM |
| Dự án con (WS-02), ghi nhận khoản thu (WS-23) | Cần quyết định sản phẩm |
| Giới hạn xem danh sách nhân sự HRM theo cây tổ chức | Rủi ro hồi quy lớn; cần cờ cấu hình và quyết định mặc định |
| Thông báo thật cho chuông | Cần bảng thông báo và consumer sự kiện, việc riêng |
| HRM-28, HRM-30 như lỗi P1 | Đã rút lại: do cấu hình test; chỉ làm 4.4 và 4.5 để xác nhận |
| Cấu hình hoá tổng quát cho mọi loại công ty | Việc dài hạn, xem tài liệu phân tích riêng |
| `payroll-screen.tsx`, `xlsx`, `pnpm-lock.yaml` | Không thuộc đợt sửa lỗi này |

---

## 4. Cần bạn quyết định trước khi chạy

1. **WP2.3: áp migration lên tenant đã tồn tại, kể cả Savina?** Đề xuất: chỉ áp lên tenant TEST trước; tenant thật chỉ áp khi bạn xác nhận, sau khi sao lưu. Nếu không áp, tenant cũ vẫn dựa vào relay tự bù (đã đủ để không bị kẹt).
2. **WP3: dữ liệu kiểm kê và lô đang nằm trong localStorage của người dùng.** Chọn: (a) bỏ, nhập lại; (b) tạo công cụ xuất để nhập lại thủ công.
3. **WP3: phạm vi.** Làm cả kiểm kê và lô (khoảng 5-6 ngày), hay chỉ kiểm kê trước (khoảng 3 ngày)?
4. **WP4.6: roster theo đơn vị.** Làm trong đợt này, hay tách thành đợt sau?
5. **WP4.2: khấu trừ tạm ứng** tự chuyển kỳ sau có phù hợp quy định công ty không? Nếu chưa chắc, chỉ giữ thông báo lỗi rõ.
6. **WP5.1: danh bạ dự án khi chưa bổ nhiệm** chỉ dành cho người có quyền quản lý dự án, có chấp nhận không?

---

## 5. Thứ tự và thời gian dự kiến (ước tính thô)

| Thứ tự | Gói | Ước tính | Ghi chú |
|---|---|---|---|
| 1 | WP1, WP2 | 0,5-1 ngày mỗi gói | Chạy song song, ít rủi ro |
| 2 | WP4 (trừ 4.6), WP5 | 1-2 ngày mỗi gói | Song song với bước 1 nếu phạm vi file không đè |
| 3 | WP3 | 3-6 ngày | Gói lớn nhất, nên kiểm kỹ riêng |
| 4 | WP4.6 | 2 ngày | Chỉ khi bạn chọn làm |
| 5 | Kiểm tra trên tenant mới | 2,5-3 giờ | Theo thứ tự Core, PE, HRM, Kho, Bảo trì, Workspace, giao diện chung |

Các ước tính là của tôi, chưa kiểm tra chi tiết từng mục trong mã.

---

## 6. Cách kiểm chứng sau khi sửa

- **Tự động:** `nx test` cho `adapter-events`, `module-workspace`, `module-procedure-engine`, `module-inventory`, `module-maintenance`, `module-hrm`, `feature-hrm`, `feature-procedure-engine`, `web`, cùng `typecheck` các project liên quan.
- **Tenant mới (UI localhost:8080):** theo danh sách lỗi đã sửa, mỗi mục ghi Đạt/Không đạt vào bảng Excel mới cùng cấu trúc tệp kết quả cũ.
- **Các mục cần thử trình duyệt thật:** Esc trong dialog, Popconfirm có lý do, Drawer tài liệu, ngày không trôi sau nhiều lần Sửa, chuông thông báo.

## 7. Rollback

- Tất cả thay đổi chưa commit: có thể hoàn tác bằng git theo từng file hoặc gói.
- Migration đều idempotent. Riêng 2.3 và gói 3 (bảng lô, kiểm kê) cần kế hoạch sao lưu trước khi áp lên tenant thật.
