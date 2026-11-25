# So Sánh Kiến Trúc Điều Hướng Giữa HRM và Inventory: Đánh Giá Hiệu Năng & Đề Xuất Kế Hoạch Đồng Bộ

- **Ngày lập:** 20/11/2026
- **Vị trí lưu:** `docs/test/SO_SANH_KIEN_TRUC_DIEU_HUONG_HRM_VA_INVENTORY_DE_XUAT_DONG_BO.md`
- **Phạm vi khảo sát:** 
  - Module Quản lý Nhân sự: `apps/hrm-web`, `packages/features/hrm`
  - Module Quản lý Kho: `apps/inventory-web`, `packages/features/inventory`
  - Nền tảng dùng chung: `packages/features/module-shell`, `packages/shared/ui`

---

## 1. Bối cảnh và Đặt vấn đề

Trong quá trình phát triển Enterprise Platform, hai trường phái kiến trúc điều hướng giao diện (Frontend Navigation Architecture) đang cùng tồn tại:

1. **Kiến trúc Multi-page Routing dựa trên Next.js App Router (đang áp dụng ở HRM):** Mỗi chức năng tương ứng với một thư mục route riêng biệt (`/modules/hrm/employees`, `/modules/hrm/attendance`, `/modules/hrm/payroll`...).
2. **Kiến trúc Single Page Application (SPA) trên nền `ModuleShell` + URL Hash 2 cấp (đang áp dụng ở Inventory, Maintenance, Procedure Engine, Workspace, CRM):** Toàn bộ module chạy trên 1 route Next.js duy nhất (`/modules/inventory`), mọi điều hướng trong phân hệ được quản lý tức thì qua hash (`#stock/warehouse`, `#stock/movements`, `#reports`, `#settings`...).

Mục tiêu của tài liệu này là so sánh khách quan ưu - nhược điểm của hai cách tiếp cận, đánh giá tính tối ưu trong môi trường ERP doanh nghiệp, và đề xuất kế hoạch đồng bộ toàn diện về một chuẩn kiến trúc duy nhất.

---

## 2. So sánh Toàn diện Kỹ thuật giữa Hai Mô hình

### 2.1 Bảng đối chiếu các tiêu chí cốt lõi

| Tiêu chí | HRM (Next.js Multi-page Routing) | Inventory / Platform (SPA ModuleShell + Hash) |
|---|---|---|
| **Cấu trúc URL** | Đường dẫn tĩnh từng trang:<br>`/modules/hrm/employees`<br>`/modules/hrm/attendance`<br>`/modules/hrm/payroll` | URL phân cấp 2 tầng bằng Hash:<br>`/modules/inventory#stock/goods`<br>`/modules/inventory#stock/warehouse`<br>`/modules/inventory#stock/movements` |
| **Hành vi chuyển trang** | Trình duyệt kích hoạt chuyển route của Next.js: Component trang cũ bị hủy (`unmount`), nạp và dựng lại layout trang mới. | Hoán đổi component ngay tại chỗ (0ms): Khung `ModuleShell` giữ nguyên, không render lại toàn bộ trang. |
| **Tải lại dữ liệu dùng chung (Shared Context)** | **Tải lại liên tục:** Mỗi lần chuyển trang, Shell gọi lại `GET /capabilities`, `GET /api/auth/v1/me`, `GET /my-profile`. | **Tải 1 lần duy nhất:** Dữ liệu danh mục kho, phân quyền, cấu hình tenant được nạp khi mở module và tái sử dụng xuyên suốt. |
| **Bảo lưu trạng thái làm việc (State Preservation)** | Chuyển sang màn khác sẽ làm mất form nháp, bộ lọc và trạng thái bảng nếu chưa lưu vào URL hoặc backend. | Trạng thái của từng tab được lưu trong bộ nhớ RAM hoặc `sessionStorage`; chuyển sang tab khác rồi quay lại vẫn giữ nguyên. |
| **Quản lý Tab con (Subtabs)** | Các tab con trong `Employees`, `Profile`, `Requests` chỉ dùng `useState` nội bộ: **F5 hoặc chuyển trang là mất vết, luôn về tab đầu tiên**. | Đã chuẩn hóa Hash 2 cấp (`#stock/<subtab>`) + `sessionStorage`: **F5, reload hoặc Back/Forward giữ nguyên đúng tab con**. |
| **Tối ưu gói tải (Bundle Size)** | Tự động phân tách gói theo route (`route-based code splitting`). | Cần dùng `next/dynamic` hoặc `React.lazy` để phân tách mã cho các màn hình dung lượng lớn. |
| **Độ đồng bộ với toàn bộ Platform** | **Thiểu số:** Chỉ có HRM (và một phần Finance) áp dụng. | **Đa số (80%):** Inventory, Maintenance, Procedure Engine, CRM, Workspace, Correspondence đều dùng chuẩn này. |

---

## 3. Đánh giá Tính Tối Ưu cho Ứng dụng ERP Doanh nghiệp

### 3.1 Vì sao mô hình của Inventory tối ưu hơn cho trải nghiệm ERP?

1. **Thao tác vận hành liên tục không có độ trễ (Zero Page Reload Latency):**
   - Đặc thù của nhân sự quản lý kho hoặc điều hành là mở nhiều danh mục, đối chiếu chứng từ, chuyển qua lại giữa thẻ kho và phiếu xuất nhập hàng trăm lần mỗi ngày.
   - Việc chuyển đổi bằng Hash giữ nguyên khung nhìn và dữ liệu đệm, mang lại tốc độ phản hồi tức thì dưới 16ms (60 FPS), không có hiện tượng chớp nháy trắng trang (layout shift / flash).

2. **Giảm áp lực lên hệ thống Backend (Network Traffic Reduction):**
   - Trong HRM, mỗi lần nhân viên bấm đổi giữa 10 mục menu, hệ thống lặp lại ít nhất 20–30 lượt gọi API kiểm quyền và thông tin định danh người dùng.
   - Trong Inventory, các lệnh kiểm tra quyền (`InventoryPermissionsContext`) và danh sách kho cơ sở chỉ nạp 1 lần ban đầu, giúp giảm đáng kể lượng truy vấn thừa đến gateway và database.

3. **Khả năng điều hướng 2 cấp thông minh (Two-level State Tracking):**
   - Giải pháp vừa triển khai tại Inventory (commit `2f69387d`) đã giải quyết triệt để bài toán: khi chuyển sang menu cấp 1 khác (*Báo cáo kho*, *Cài đặt*...) rồi quay lại menu *Kho hàng*, hệ thống tự động mở lại đúng subtab gần nhất (*Nhà kho* hoặc *Xuất/nhập kho*) thay vì văng về subtab mặc định đầu tiên (*Hàng hóa*).

---

## 4. Đề xuất Kế hoạch Đồng Bộ HRM về Chuẩn Chung `ModuleShell`

Nhằm loại bỏ sự phân mảnh kiến trúc và nâng cao trải nghiệm người dùng trên toàn hệ thống, đề xuất lộ trình chuyển đổi HRM theo 4 giai đoạn cụ thể:

### Giai đoạn 1: Tái cấu trúc Cây Điều hướng HRM (Menu Hierarchy Redesign)
Hiện tại HRM có 20 mục phẳng trên thanh điều hướng, khiến thanh cuộn dài và gây phân tán. Đề xuất gom lại thành 5 nhóm tab cấp 1 trên `ModuleShell`:

1. **Tổng quan (`#dashboard`):** Bàn làm việc, chấm công nhanh, số liệu tổng hợp.
2. **Nhân sự (`#personnel`):**
   - Subtab: Hồ sơ của tôi (`#personnel/profile`)
   - Subtab: Danh sách nhân viên (`#personnel/employees`)
   - Subtab: Người phụ thuộc (`#personnel/dependents`)
   - Subtab: Quyết định bổ nhiệm (`#personnel/decisions`)
3. **Công & Lịch (`#time`):**
   - Subtab: Chấm công cá nhân (`#time/attendance`)
   - Subtab: Đơn từ & Phê duyệt (`#time/approvals`)
   - Subtab: Phân ca làm việc (`#time/schedules`)
   - Subtab: Bảng công tổng hợp (`#time/timesheets`)
4. **Tiền lương (`#payroll`):**
   - Subtab: Kỳ lương & Chi trả (`#payroll/runs`)
   - Subtab: Phiếu lương của tôi (`#payroll/payslips`)
   - Subtab: Ứng lương & Thu hồi (`#payroll/advances`)
5. **Cài đặt & Vận hành (`#settings`):**
   - Subtab: Chính sách chấm công & Địa điểm (`#settings/policies`)
   - Subtab: Quỹ phép (`#settings/leave`)
   - Subtab: Cấu hình lương (`#settings/payroll-config`)
   - Subtab: Quy trình tự động & Phân quyền (`#settings/system`)

### Giai đoạn 2: Xây dựng Component Trung tâm `HrmScreen`
- Tạo file `packages/features/hrm/src/lib/hrm-screen.tsx` bọc trong `ModuleShell`.
- Khai báo các view chính và kết nối với hook `useHashView<HrmTab>`.
- Áp dụng `next/dynamic` cho các Screen lớn (ví dụ `RequestsScreen`, `EmployeesScreen`) để đảm bảo bundle size được tải lười (lazy load) khi người dùng truy cập tab đó.

### Giai đoạn 3: Áp dụng Cơ chế Lưu Vết Subtab 2 Cấp (Proven Pattern từ Inventory)
- Áp dụng helper `isHrmSubTab`, `getStoredHrmSubTab`, `setStoredHrmSubTab` với khóa `sessionStorage`.
- Khi người dùng click chọn subtab, URL hash tự động cập nhật `#personnel/employees` hoặc `#time/attendance`.
- Khi reload trang hoặc quay lại tab chính từ tab khác, hệ thống đọc lại subtab gần nhất từ URL hoặc `sessionStorage`.

### Giai đoạn 4: Đảm bảo Tương thích Ngược (Backward Compatibility)
- Tại `apps/hrm-web/src/app`:
  - `page.tsx` gốc nạp thẳng `HrmScreen`.
  - Các đường dẫn route cũ (`/employees`, `/attendance`, `/payroll`...) giữ lại file `page.tsx` đơn giản thực hiện chuyển hướng (`redirect`) sang URL hash tương ứng.
- Đảm bảo các đường dẫn gửi qua email, thông báo quy trình (`procedure_links`) hay bookmark của người dùng cũ vẫn hoạt động trơn tru 100%.

---

## 5. Kịch Bản Kiểm Thử Xác Nhận (Test Scenarios)

Khi triển khai đồng bộ hoặc kiểm thử thực tế trên hệ thống, thực hiện các ca kiểm thử sau:

1. **TC-01: Chuyển đổi Subtab nội bộ:**
   - Đang ở `#stock/goods`, click sang `Nhà kho`.
   - Kết quả mong muốn: URL chuyển thành `#stock/warehouse`, nội dung chuyển tức thì sang bảng tồn kho vật lý.
2. **TC-02: Chuyển đổi Tab cấp 1 và Quay lại (State Memory):**
   - Từ `#stock/warehouse`, bấm vào menu `Báo cáo kho` trên sidebar (URL: `#reports`).
   - Bấm lại menu `Kho hàng` trên sidebar.
   - Kết quả mong muốn: URL tự phục hồi về `#stock/warehouse`, không bị nhảy về `#stock/goods`.
3. **TC-03: Tải lại trang (F5 / Hard Refresh):**
   - Đứng tại `#stock/warehouse` và bấm F5.
   - Kết quả mong muốn: Trang tải xong hiển thị đúng subtab `Nhà kho`.
4. **TC-04: Điều hướng từ màn hình bên ngoài (External Link / Dashboard):**
   - Từ màn hình Dashboard bấm nút xem "Lịch sử xuất nhập".
   - Kết quả mong muốn: Hệ thống điều hướng thẳng đến `#stock/history`.
