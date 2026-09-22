# ĐỀ XUẤT THAY ĐỔI & CHUẨN HOÁ FORM XUẤT - NHẬP KHO ĐA ĐỐI TƯỢNG (MULTI-ITEM MOVEMENT FORM)

> **Dự án:** Enterprise Platform — Phân hệ Quản lý Kho & Thiết bị (`features/inventory`)  
> **Tài liệu tham chiếu:** [`movement-form.tsx`](file:///d:/CRM/enterprise-platform/packages/features/inventory/src/lib/components/movement-form.tsx), [`inventory-screen.tsx`](file:///d:/CRM/enterprise-platform/packages/features/inventory/src/lib/inventory-screen.tsx)  
> **Ngày lập:** 09/09/2026  
> **Trạng thái đề xuất:** Đang lấy ý kiến phê duyệt

---

## I. BỐI CẢNH & VẤN ĐỀ HIỆN TẠI (AS-IS)

### 1. Hiện trạng của form hiện tại (`MovementForm`)
- **Chỉ thao tác đơn lẻ 1 vật tư:** Người dùng chỉ có thể chọn 1 mã vật tư (`materialCode`) và 1 số lượng (`quantity`) cho mỗi lần tạo phiếu.
- **Select box truyền thống:** Sử dụng thẻ `<select>` tĩnh của HTML, khi danh mục vật tư lên đến hàng trăm/hàng nghìn mã thì rất khó tìm kiếm, không hỗ trợ gõ lọc ký tự.
- **Bất cập khi phát sinh lô hàng:** Khi nhập/xuất một lô gồm 5–10 loại vật tư, thủ kho phải lặp lại thao tác tạo phiếu 5–10 lần, dẫn đến:
  - Tốn thời gian thao tác.
  - Phân tán số liệu: Các vật tư trong cùng một hoá đơn/biên bản bàn giao bị chia thành nhiều mã giao dịch rời rạc.
  - Khó khăn trong công tác kiểm toán, đối soát chứng từ với bên giao/nhận hàng.

---

## II. MỤC TIÊU CẢI THIỆN (TO-BE)

Nâng cấp form Xuất / Nhập / Chuyển kho thành **Phiếu điều chuyển đa đối tượng (Multi-item Movement Voucher)** đáp ứng trọn vẹn 3 yêu cầu cốt lõi:
1. **Hỗ trợ đính kèm file tài liệu / chứng từ / bằng chứng** (Hoá đơn VAT, Biên bản bàn giao, Phiếu xuất kho hiện trường, Ảnh chụp...).
2. **Searchable Combobox / Autocomplete:** Cho phép gõ ký tự (tên hoặc mã vật tư) để tìm kiếm và lọc tức thì (hỗ trợ tiếng Việt không dấu).
3. **Bảng lưới động (Dynamic Table Grid):** Các vật tư được chọn sẽ được thêm vào bảng danh sách chi tiết với đầy đủ các trường thông tin phục vụ kiểm soát tồn kho và kế toán.

---

## III. THIẾT KẾ CẤU TRÚC GIAO DIỆN FORM ĐỀ XUẤT

Bố cục form được tối ưu theo quy chuẩn **16:9** của hệ thống, chia làm 3 phân khu chức năng:

```
┌────────────────────────────────────────────────────────────────────────┐
│  HEADER: THÔNG TIN CHUNG CỦA PHIẾU (Loại phiếu, Kho chính, Lý do, File) │
├────────────────────────────────────────────────────────────────────────┤
│  THANH TÌM KIẾM & THÊM VẬT TƯ (Searchable Combobox + Gợi ý tồn kho)    │
├────────────────────────────────────────────────────────────────────────┤
│  BẢNG LƯỚI DANH SÁCH VẬT TƯ CHI TIẾT (Multi-item Grid Table)           │
│  [STT | Mã & Tên | ĐVT | Kho | Tồn khả dụng | Số lượng | Đơn giá | Xoá]│
├────────────────────────────────────────────────────────────────────────┤
│  FOOTER: TỔNG HỢP & NÚT XÁC NHẬN GHI SỔ                                │
└────────────────────────────────────────────────────────────────────────┘
```

---

### PHẦN 1: THÔNG TIN CHUNG CỦA PHIẾU (HEADER CHUNG)
*Các thông tin áp dụng cho cả lô giao dịch, tránh lặp lại ở từng dòng:*

| Trường dữ liệu | Loại giao diện | Ý nghĩa & Quy tắc nghiệp vụ |
| :--- | :--- | :--- |
| **Loại nghiệp vụ** | Tabs chuyển đổi (`Nhập kho` / `Xuất kho` / `Chuyển kho`) | Đổi giao diện và logic kiểm tra tồn kho theo từng loại. |
| **Kho thực hiện** | Dropdown chọn kho | Kho tiếp nhận (nếu Nhập) hoặc Kho xuất hàng chính (nếu Xuất/Chuyển). Tự động điền mặc định cho các dòng bên dưới. |
| **Mục đích xuất** *(chỉ hiện khi Xuất)* | Radio buttons | • **Gán / Thay thế cho Thiết bị:** Chọn thiết bị đích $\rightarrow$ Tự động cộng vào chỉ số "Đang sử dụng".<br>• **Xuất tiêu hao / Sử dụng chung**. |
| **Lý do / Căn cứ** | Input text *(Bắt buộc)* | Ví dụ: *Theo hoá đơn VAT số HD-2026-118*, hoặc *Xuất theo lệnh bảo trì PR-082...* |
| **Quy trình liên kết** | Select box | Tuỳ chọn mở Work Order kèm theo trên hệ thống quy trình. |
| **Tài liệu & Chứng từ đính kèm** | File Upload Box | Kéo - thả hoặc chọn file (PDF, PNG, JPG, XLSX, DOCX). Hiển thị tên tệp, dung lượng, nút xoá/thay thế tệp. |

---

### PHẦN 2: BỘ TÌM KIẾM VẬT TƯ (SEARCHABLE COMBOBOX)
- **Cơ chế gõ lọc tức thời:**
  - Hỗ trợ gõ **Mã vật tư** (VD: `VT-CB`) hoặc **Tên vật tư** (VD: `máy cắt`, `dầu nhớt`).
  - Tìm kiếm tiếng Việt không dấu (gõ `may cat` vẫn tìm thấy `Máy cắt không khí ACB 630A`).
- **Menu gợi ý thông minh:**
  - Hiển thị: `[Mã vật tư] — [Tên vật tư] | ĐVT | Tồn khả dụng hiện tại: X`.
  - Phím tắt: Dùng phím mũi tên $\uparrow / \downarrow$ và phím `Enter` để chọn nhanh.
- **Nút "+ Thêm vào danh sách":** Khi bấm (hoặc nhấn Enter), vật tư lập tức được nạp vào Bảng bên dưới và tự động focus sẵn vào ô nhập số lượng.

---

### PHẦN 3: BẢNG LƯỚI DANH SÁCH VẬT TƯ CHI TIẾT (ITEM GRID TABLE)
*Giao diện tự động thích ứng theo nghiệp vụ (Nhập kho vs Xuất kho):*

| STT | Cột thông tin | Khi Nhập kho | Khi Xuất kho | Khi Chuyển kho | Ý nghĩa nghiệp vụ |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **1** | **Mã & Tên vật tư** | Hiển thị | Hiển thị | Hiển thị | Định danh chính xác vật tư/thiết bị. |
| **2** | **ĐVT** | Hiển thị | Hiển thị | Hiển thị | Đơn vị tính (Cái, Bộ, Mét, Lít...). |
| **3** | **Kho thực hiện** | Kho nhập | Kho xuất | Kho nguồn $\rightarrow$ Kho đích | Mặc định theo Header, nhưng cho phép linh hoạt đổi kho trên từng dòng. |
| **4** | **Tồn khả dụng** | Ẩn | **Badge 3 màu**<br>🟢 Đủ 1 kho<br>🟡 Đủ gom kho<br>🔴 Thiếu | **Badge tồn** tại kho nguồn | Kiểm soát tức thì, ngăn chặn xuất âm kho. |
| **5** | **Số lượng** | **Input** (`> 0`) | **Input** (`≤ Tồn`) | **Input** (`≤ Tồn`) | Số lượng thực tế của dòng. |
| **6** | **Đơn giá (VNĐ)** | **Input** đơn giá | Ẩn | Ẩn | Giá vốn nhập kho phục vụ kế toán. |
| **7** | **Thành tiền** | Tự động tính | Ẩn | Ẩn | $\text{Số lượng} \times \text{Đơn giá}$. |
| **8** | **Sê-ri / Barcode** | Nút nhập sê-ri | Ẩn | Ẩn | Khai báo danh sách sê-ri theo lô hàng. |
| **9** | **Ghi chú dòng** | Input ngắn | Input ngắn | Input ngắn | Ghi chú riêng cho từng mã hàng. |
| **10**| **Thao tác** | Icon Xoá (`Trash2`) | Icon Xoá (`Trash2`) | Icon Xoá (`Trash2`) | Xoá bỏ dòng khỏi bảng. |

#### Chân bảng (Footer summary):
- **Tổng số khoản mục:** Ví dụ: `4 hạng mục vật tư`.
- **Tổng số lượng xuất/nhập:** Ví dụ: `15 cái`.
- **Tổng giá trị lô hàng (khi Nhập):** Ví dụ: `65.400.000 VNĐ`.

---

## IV. XỬ LÝ LOGIC BACKEND & SỔ CÁI (LEDGER TRANSACTION)

1. **Gom nhóm giao dịch (Batch Grouping):**
   - Các dòng vật tư trong bảng khi submit sẽ được xử lý trong cùng một phiên.
   - Sinh mã chứng từ tham chiếu chung (Batch Reference Code) gắn vào trường `note` hoặc metadata để đối soát sổ cái sau này.
2. **Bảo toàn "Tổng sở hữu" khi Xuất bảo trì:**
   - Nếu chọn mục đích *Gán cho Thiết bị* (`targetAssetCode`): Hệ thống tự động gọi `installItem` cho từng dòng, hạch toán giảm tồn kho và cộng tăng tương ứng vào chỉ số **"Đang sử dụng"** trên cây tài sản.
3. **Lưu trữ file chứng từ:**
   - File đính kèm sẽ được lưu vào hệ thống tài liệu/storage và gắn liên kết vào chứng từ kho.

---

## V. LỘ TRÌNH THỰC HIỆN DỰ KIẾN

1. **Giai đoạn 1 (UI Component):**
   - Xây dựng component `SearchableCombobox` cho danh mục vật tư với tính năng tìm kiếm tiếng Việt không dấu.
   - Xây dựng component `MovementItemTable` hiển thị bảng lưới danh sách các dòng vật tư kèm footer tổng hợp.
   - Nâng cấp khu vực `FileUploadBox` kéo thả chứng từ đính kèm.
2. **Giai đoạn 2 (Integration & State):**
   - Cập nhật [`MovementForm`](file:///d:/CRM/enterprise-platform/packages/features/inventory/src/lib/components/movement-form.tsx) chuyển state sang mảng `items: MovementLineItem[]`.
   - Kết nối logic validation: Cảnh báo đỏ nếu có dòng vượt tồn kho, cảnh báo vàng nếu cần gom kho.
3. **Giai đoạn 3 (Execution & Sổ cái):**
   - Cập nhật hàm `submitMovement` tại [`InventoryScreen`](file:///d:/CRM/enterprise-platform/packages/features/inventory/src/lib/inventory-screen.tsx) để thực thi tuần tự các lệnh giao dịch theo lô an toàn.
   - Kiểm thử thực tế (Unit test / UI lint).
