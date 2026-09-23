# KẾ HOẠCH TRIỂN KHAI: NHẬP VẬT TƯ HÀNG LOẠT TỪ EXCEL CHO FORM NHẬP KHO (SMART EXCEL IMPORTER)

## 1. Mục tiêu & Bối cảnh
Người dùng (thủ kho / quản lý kho) muốn nhập một lúc nhiều vật tư vào phiếu Nhập kho (`receipt`) bằng cách tải lên file Excel có sẵn của doanh nghiệp. Vì mỗi doanh nghiệp có cấu trúc file, tên cột, thứ tự và định dạng khác nhau (từ SAP, MISA, Bravo, FAST hay Excel nội bộ), hệ thống cần một cơ chế linh hoạt, thông minh:
- Không bắt buộc dùng file mẫu cố định.
- Cho phép tải file bất kỳ (`.xlsx`, `.xls`, `.csv`), chọn Sheet, chọn dòng bắt đầu đọc.
- **Ánh xạ cột động (Dynamic Column Mapping)**: Tự động đoán cột bằng fuzzy matching (từ điển đồng nghĩa tiếng Việt/tiếng Anh) và cho phép người dùng tự khớp cột.
- **Lưu mẫu ánh xạ (Mapping Profiles)**: Lưu lại cấu hình khớp cột cho từng nhà cung cấp / đối tác để các lần sau tải lên chỉ mất 1 cú click.
- **Tiền kiểm tra & Làm sạch dữ liệu (Preview & Validation)**: Phát hiện lỗi (mã trùng, thiếu số lượng, số âm, chưa có trong danh mục...), hỗ trợ tạo mới vật tư trực tiếp nếu chưa có trong kho.
- Nạp trực tiếp vào danh sách vật tư của Phiếu Nhập kho (`items` của `MovementForm`).

---

## 2. Thiết kế Kiến trúc & Component

### Component Mới: `packages/features/inventory/src/lib/components/excel-import-dialog.tsx`
Quy trình Wizard 3 bước:
1. **Bước 1: Chọn File & Xem trước cấu trúc sơ bộ**
   - Kéo-thả file Excel.
   - Hiển thị danh sách Sheet (nếu có nhiều sheet) để chọn.
   - Chọn dòng tiêu đề (Header row - mặc định hệ thống tự nhận diện).
   - Chọn kho nhận áp dụng mặc định (có thể ghi đè nếu trong file có cột Kho).
2. **Bước 2: Ánh xạ cột (Column Mapping)**
   - Các trường hệ thống:
     - `Mã vật tư` (Bắt buộc)
     - `Tên vật tư` (Tùy chọn)
     - `Đơn vị tính` (Tùy chọn, mặc định "Cái")
     - `Số lượng` (Bắt buộc)
     - `Đơn giá nhập` (Tùy chọn)
     - `Số lô / Hạn sử dụng` (Tùy chọn)
     - `Ghi chú` (Tùy chọn)
   - Tự động nhận diện cột (Fuzzy Match):
     - Mã: `mã`, `code`, `sku`, `part`, `item`
     - Tên: `tên`, `name`, `diễn giải`, `description`
     - ĐVT: `đvt`, `unit`, `đơn vị`
     - Số lượng: `số lượng`, `sl`, `qty`, `quantity`, `thực nhận`
     - Đơn giá: `giá`, `đơn giá`, `price`, `cost`
     - Lô / HSD: `lô`, `lot`, `hsd`, `hạn`, `expiry`
   - Quản lý cấu hình mẫu (Mapping Profile): Lưu tên mẫu (VD: "NCC Dây Cáp CADIVI", "Hóa đơn MISA"), tự động tải lại lần sau.
3. **Bước 3: Tiền kiểm tra dữ liệu (Validation & Preview Grid)**
   - Bảng xem trước danh sách vật tư trích xuất từ file.
   - Badge trạng thái từng dòng:
     - 🟢 **Hợp lệ**: Mã tồn tại trong danh mục vật tư, số lượng $>0$.
     - 🟡 **Vật tư mới**: Mã chưa có trong danh mục $\rightarrow$ Đánh dấu tạo mới (`newMaterial`) tự động khi nạp vào phiếu.
     - 🔴 **Lỗi**: Thiếu mã hoặc số lượng $\le 0$ / không phải số.
   - Nút **"Nhập [N] dòng hợp lệ vào phiếu"**.

---

## 3. Tích hợp vào `MovementForm`
- Trong `packages/features/inventory/src/lib/components/movement-form.tsx`:
  - Khi `kind === 'receipt'` (hoặc cả khi nhập kho), thêm nút **"Nhập từ Excel"** (icon `FileSpreadsheet` / `Upload`) đặt cạnh nút `Thêm vật tư mới vào danh mục`.
  - Khi bấm, mở `ExcelImportDialog`.
  - Sau khi hoàn thành ở dialog, các dòng vật tư được nạp trực tiếp vào mảng `items` của `MovementForm`.
  - Cập nhật số lượng và thành tiền tương ứng.
