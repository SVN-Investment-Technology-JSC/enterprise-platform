# BÁO CÁO ĐỐI CHIẾU VẬN HÀNH THỦ KHO & ĐỀ XUẤT THIẾT KẾ DRAWER CHI TIẾT THIẾT BỊ

---

## PHẦN 1: ĐỐI CHIẾU QUY TRÌNH THỦ KHO VỚI HIỆN TRẠNG MODULE NHÀ KHO

### 1. Luồng vận hành hằng ngày của Thủ kho (Workflow)
```
Nhận yêu cầu ──> Kiểm tra ──> Thực hiện Nhập/Xuất ──> Kiểm đếm ──> Cập nhật hệ thống ──> Lưu chứng từ ──> Đối chiếu ──> Báo cáo
```

### 2. Bảng phân tích chi tiết 8 đầu việc cốt lõi & Khoảng trống chức năng

| Đầu việc cốt lõi | Nghiệp vụ thực tế của Thủ kho | Hiện trạng module Kho (`@enterprise-platform/features/inventory`) | Khoảng trống (Gaps) cần bổ sung |
| :--- | :--- | :--- | :--- |
| **1. Nhập kho (Receipt)** | • Tiếp nhận theo Đơn mua hàng (PO) hoặc phiếu hoàn trả.<br>• Kiểm tra ngoại quan, thông số, dán nhãn Serial/Lot.<br>• Đính kèm hóa đơn, biên bản giao nhận. | ✅ Đã có Form Nhập kho (`kind: 'receipt'`).<br>✅ Hỗ trợ dán dải Serial tự do.<br>✅ Cho phép đính kèm tệp chứng từ.<br>✅ Hỗ trợ nhập trả từ thiết bị về kho. | ⚠️ **Thiếu:**<br>- Đối chiếu Đơn mua hàng (PO Matching).<br>- Quản lý Lô sản xuất (Batch/Lot) & Hạn sử dụng (Expiry Date). |
| **2. Lưu trữ (Storage)** | • Định vị vào từng Kệ/Dãy/Ngăn (Bin Location).<br>• Cảnh báo an toàn (Min/Max tồn).<br>• Theo dõi tình trạng bảo quản/khả dụng. | ✅ Bảng tồn kho tổng hợp (`StockTable`).<br>✅ Cảnh báo dưới mức tồn tối thiểu (`minStock`).<br>✅ Theo dõi vật tư đang giữ chỗ (`reservations`). | ⚠️ **Thiếu:**<br>- Vị trí chi tiết Kệ/Dãy/Ngăn (Aisle - Rack - Shelf - Bin). Hiện mới quản lý đến cấp Kho.<br>- Quy tắc xuất hàng tự động (FIFO/FEFO). |
| **3. Xuất kho (Issue)** | • Nhận phiếu đề nghị cấp phát.<br>• Soát xét tồn & giữ chỗ.<br>• In lệnh nhặt hàng (Pick-list).<br>• Bàn giao, ký nhận và trừ tồn. | ✅ Liên kết trực tiếp phiếu đề nghị từ Quy trình.<br>✅ Xuất theo phiếu hoặc xuất hàng loạt theo bảng kê.<br>✅ Form Xuất kho (`kind: 'issue'`). | ⚠️ **Thiếu:**<br>- Danh sách nhặt hàng (Pick-list/Packing Slip) hỗ trợ đi gom hàng.<br>- Biên bản bàn giao xuất kho ký nhận 2 bên / Chữ ký điện tử. |
| **4. Điều chuyển (Transfer)** | • Luân chuyển giữa các kho/chi nhánh.<br>• Theo dõi trạng thái Hàng đi đường (In-transit). | ✅ Có Form Chuyển kho (`kind: 'transfer'`).<br>✅ Nút chuyển nhanh trực tiếp từ dòng tồn. | ⚠️ **Thiếu:**<br>- Quy trình 2 bước: *Xuất chuyển $\rightarrow$ Hàng đi đường $\rightarrow$ Kho nhận kiểm đếm & xác nhận nhập*. Hiện tại đang trừ/cộng tức thời. |
| **5. Kiểm kê (Stocktaking)** | • Lập kế hoạch kiểm kê định kỳ/đột xuất.<br>• Khóa sổ tạm thời.<br>• Nhập số đếm thực tế (Physical count). | ❌ **Chưa có màn hình kiểm kê riêng.** Mới chỉ có thao tác Điều chỉnh (`adjust`) đơn lẻ từng dòng. | 🚨 **RẤT THIẾU (Core Gap):**<br>- Kỳ kiểm kê (Stocktaking Session) theo kho/nhóm hàng.<br>- Bảng kê kiểm đếm thực tế (Actual vs Book Quantity). |
| **6. Đối soát & Xử lý chênh lệch** | • Tự động tính chênh lệch Thừa/Thiếu.<br>• Lập biên bản giải trình.<br>• Trình duyệt cấp quản lý $\rightarrow$ Tạo bút toán cân đối. | ⚠️ Mới có loại giao dịch `ADJUST` ghi nhận thô trên Sổ cái (`LedgerTable`), thủ công từng mã. | 🚨 **RẤT THIẾU (Core Gap):**<br>- Báo cáo chênh lệch kiểm kê tổng hợp.<br>- Luồng phê duyệt xử lý chênh lệch trước khi ghi bút toán cân kho. |
| **7. Báo cáo (Reporting)** | • Báo cáo Nhập - Xuất - Tồn (N-X-T) theo kỳ.<br>• Thẻ kho / Sổ chi tiết vật tư.<br>• Phân tích hàng tồn đọng/chậm luân chuyển (Aging). | ✅ Dashboard thẻ tổng quan (`InventoryDashboard`).<br>✅ Sổ cái giao dịch kho (`LedgerTable`).<br>✅ Thẻ kho/lịch sử từng vật tư (`material-history.tsx`). | ⚠️ **Thiếu:**<br>- Báo cáo Nhập - Xuất - Tồn (N-X-T) chuẩn kỳ kế toán (Đầu kỳ, Nhập, Xuất, Cuối kỳ) lọc theo dải ngày.<br>- Xuất file Excel/PDF mẫu biểu chuẩn. |

---

## PHẦN 2: ĐỀ XUẤT THIẾT KẾ DRAWER CHI TIẾT THIẾT BỊ TRONG KHO

### 1. Định vị & Tiêu chuẩn giao diện
- **Định dạng**: Drawer trượt từ bên phải màn hình (Right Drawer Panel).
- **Kích thước chuẩn**: Chiều rộng `640px - 720px` (chuẩn UI/UX Enterprise Platform cho Drawer thông tin chi tiết).
- **Mục tiêu**: Chuyển đổi từ màn hình "chỉ xem thụ động" thành **Trung tâm hành động (Actionable Drawer)** cho thủ kho ngay khi bấm vào 1 thiết bị trên bảng tồn kho.

---

### 2. Bố cục trực quan đề xuất (Wireframe Structure)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [ICON] BƠM LY TÂM TRỤC NGANG HYDRAULIC 7.5KW        [Trạng thái: SẴN SÀNG] │
│  Mã vật tư: PUMP-75-01  |  Số Serial: SN-2024-8892           [Đóng '✕']  │
├──────────────────────────────────────────────────────────────────────────┤
│  [Vị trí: Kho Cơ Điện Chính > Dãy B > Kệ B2 > Tầng 3 > Hộp 04]           │
├──────────────────────────────────────────────────────────────────────────┤
│  [Tab 1: Tổng quan & Vị trí]   [Tab 2: N-X-T & Thẻ kho]                   │
│  [Tab 3: Kiểm kê & Đối soát]   [Tab 4: Chứng từ & Serial]                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [NỘI DUNG CHI TIẾT THEO TAB TƯƠNG ỨNG...]                               │
│                                                                          │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  FOOTER TÁC VỤ NHANH (CỐ ĐỊNH):                                          │
│  [🖨 In Tem QR]   [📋 Đếm/Báo lệch]   [🔄 Chuyển kho]   [📦 Xuất kho ngay]│
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Chi tiết các Tab thông tin bổ sung

#### Tab 1: Tổng quan & Vị trí lưu trữ (Storage & Status)
*Khắc phục khoảng trống quản lý vị trí chi tiết và bảo quản hàng tồn.*
- **Vị trí vật lý trong kho**:
  - Tên Kho lưu trữ (`warehouseCode` - `warehouseName`).
  - Phân vùng chi tiết: `Dãy (Aisle) - Kệ (Rack) - Tầng (Shelf) - Ngăn/Hộp (Bin)`.
  - Nút bấm nhanh: **"Chuyển vị trí Kệ/Ngăn"** (cập nhật tọa độ lưu trữ nội bộ mà không cần sinh lệnh luân chuyển kho lớn).
- **Tình trạng khả dụng & Bảo quản**:
  - Badge tình trạng: *Sẵn sàng cấp phát / Đang niêm phong dự phòng / Hàng lỗi chờ bảo hành / Chờ kiểm định*.
  - Lịch bảo dưỡng lưu kho định kỳ (ví dụ: bơm dầu mỡ, quay trục động cơ định kỳ 3 tháng/lần đối với thiết bị lưu kho lâu ngày).
- **Chỉ số tồn & Giữ chỗ**:
  - Số lượng thực tế trong kho vs. Số lượng đang được giữ chỗ (Reserved) cho các Work Order.
  - Cảnh báo tồn kho Min/Max.

#### Tab 2: Lịch sử Nhập - Xuất - Tồn (Movement History & Aging)
*Khắc phục khoảng trống về vòng đời lưu kho và truy vết dòng chuyển động.*
- **Chỉ số tuổi thọ kho (Inventory Aging)**:
  - `Thời gian lưu kho`: Đã nằm kho bao nhiêu ngày (Ví dụ: *Đã lưu kho 142 ngày*).
  - Cảnh báo tự động nếu vượt quá ngưỡng: **Hàng tồn đọng / Chậm luân chuyển (Slow-moving/Dead Stock)**.
- **Dòng thời gian biến động (Movement Timeline)**:
  - Liệt kê các bút toán gần nhất: Ngày nhập kho, người nhập, các đợt xuất lẻ, đợt điều chuyển giữa các kho.
  - Link bấm xem nhanh Phiếu xuất/nhập liên quan.

#### Tab 3: Kiểm kê & Đối soát gần nhất (Stocktaking & Variance)
*Khắc phục khoảng trống kiểm đếm thực tế và xử lý sai lệch.*
- **Thông tin đợt kiểm kê gần nhất**:
  - Ngày kiểm kê gần nhất + Mã kỳ kiểm kê.
  - Người thực hiện kiểm đếm (Thủ kho / Tổ kiểm kê).
  - Tình trạng đối soát: `Khớp 100%` hoặc hiển thị badge đỏ cảnh báo: `Lệch -1 cái so với sổ sách`.
- **Hành động kiểm đếm tại chỗ**:
  - Nút **"Xác nhận kiểm đếm nhanh"**: Khi thủ kho đang đứng kiểm tra tại kệ, có thể nhập ngay số lượng thực tế đếm được để hệ thống ghi nhận mốc thời gian kiểm tra.

#### Tab 4: Chứng từ nguồn gốc & Serial / Barcode (Inbound & Traceability)
*Khắc phục khoảng trống về nguồn gốc đơn mua PO và quản lý tem nhãn.*
- **Nguồn gốc nhập (Inbound Traceability)**:
  - Nhập theo Đơn mua hàng (PO) số mấy / Hợp đồng mua sắm nào.
  - Tên Nhà cung cấp / Hãng chế tạo.
  - Danh sách file đính kèm: Hóa đơn VAT, Biên bản giao nhận, CO/CQ (Chứng chỉ xuất xứ & chất lượng).
- **Mã vạch / QR Code**:
  - Mã QR code định danh trực tiếp thiết bị/serial.
  - Nút **"Tải tem nhãn / In QR"** để dán trực tiếp lên thân vỏ thiết bị hoặc hộp đựng.

---

### 4. Thanh tác vụ nhanh ở Chân Drawer (Sticky Action Footer)
Thanh tác vụ cố định dưới đáy Drawer giúp thủ kho thao tác tức thời mà không cần rời màn hình:

1. **🖨 In tem QR (Print Label)**: Mở hộp thoại in tem nhãn khổ 50x30mm hoặc A4 có mã vạch, mã thiết bị và tên kệ.
2. **📋 Đếm/Báo lệch (Spot Count)**: Ghi nhận nhanh số đếm hoặc lập biên bản sự cố hư hỏng trong kho.
3. **🔄 Chuyển kho (Transfer)**: Mở modal chuyển kho với thông tin mã thiết bị và kho hiện tại đã được điền sẵn.
4. **📦 Xuất kho ngay (Issue)**: Mở modal xuất kho nhanh cho một yêu cầu/phiếu bảo trì.
