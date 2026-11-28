# Tổng Hợp & Phân Tích Kỹ Thuật: Quản Lý Vòng Đời Serial Trong Phân Hệ Kho (Inventory)

- **Ngày lập:** 20/11/2026
- **Vị trí lưu:** `docs/test/TONG_HOP_QUAN_LY_VONG_DOI_SERIAL_INVENTORY.md`
- **Đối tượng khảo sát:** Mã hàng hóa theo dõi theo số serial (ví dụ dữ liệu thử `TC-LAP`), vòng đời cá thể thiết bị.
- **Phạm vi kỹ thuật:**
  - Cơ sở dữ liệu: `inventory_schema.serial_tracking`, `inventory_schema.serial_movements`
  - Hợp đồng dùng chung: `packages/contracts/inventory` (các kiểu `SerialTracking`, `SerialHistory`, `SerialMovement`)
  - Tầng dịch vụ & API: `packages/modules/inventory`
  - Giao diện người dùng: `packages/features/inventory` (`trade-item-drawer.tsx`, `serial-panel.tsx`, `stock-table.tsx`)

---

## 1. Đặt Vấn Đề: Hiện Trạng Hiển Thị Dữ Liệu Thử `TC-LAP`

### 1.1 Hiện tượng quan sát được
- Mặt hàng `TC-LAP` (Laptop / Thiết bị tin học) đã được thiết lập phương thức theo dõi là **Theo số Serial** (`trackingMode = 'SERIAL'` hoặc `isSerialized = true`).
- Tuy nhiên, người dùng khi xem thông tin mặt hàng lại **chưa thấy sự phân biệt rõ ràng giữa các máy/serial của cùng mã `TC-LAP`** (ví dụ: máy nào đang ở kho nào, máy nào đã xuất bán, máy nào đang báo lỗi, lịch sử từng máy ra sao).

### 1.2 Nguyên nhân kỹ thuật từ phía Giao diện (Frontend UI Gap)
1. **Tại Subtab "Hàng hóa" (`#goods` / `#trade`):**
   - Khi bấm vào dòng `TC-LAP` để mở Drawer chi tiết (`TradeItemDrawer`), giao diện hiện chỉ render một nhãn hiển thị (Badge): `Cách theo dõi: Theo số Serial`.
   - Thành phần danh sách từng cá thể (`SerialPanel`) **chưa được tích hợp vào trong `TradeItemDrawer`**, khiến người dùng chỉ nhìn thấy thông tin chung của mã sản phẩm mà không thấy danh sách máy con.
2. **Tại Subtab "Nhà kho" (`#warehouse` / `#stock`):**
   - Danh sách serial chỉ xuất hiện khi người dùng bấm vào nút mở rộng dòng (expand row) trong bảng tồn kho `stock-table.tsx`.
   - Bảng hiển thị serial hiện tại (`SerialPanel`) mới chỉ dừng lại ở 3 cột cơ bản: `Số sê-ri`, `Tình trạng`, `Vị trí`, thiếu các cột quan trọng phản ánh nghiệp vụ kho:
     - **Kho hiện tại (`currentWarehouseId` / `warehouseCode`):** Máy đang nằm ở kho nào.
     - **Trạng thái sổ kho (`stockState`):** Máy đang Trong kho (`IN_STOCK`), Đã xuất (`ISSUED`), hay Đang vận chuyển (`IN_TRANSIT`).
     - **Chất lượng (`qualityStatus`):** Đạt (`PASSED`), Chờ kiểm định (`QUARANTINE`), hay Hỏng (`DEFECTIVE`).
     - **Nút xem lịch sử vòng đời của từng số serial.**

---

## 2. Toàn Bộ Chức Năng Quản Lý Vòng Đời Serial Đang Có Trong Hệ Thống

Trái ngược với sự tinh giản ở giao diện, **tầng Cơ sở dữ liệu và Backend của Enterprise Platform đã được xây dựng hoàn chỉnh cho toàn bộ vòng đời của một cá thể Serial**.

### 2.1 Chu trình Vòng đời Tổng thể của Cá thể Serial

```
                     +-------------------------------------------------------+
                     |           GIAI ĐOẠN 1: KHAI BÁO & NHẬP KHO            |
                     |  - Khai báo danh mục số serial trước                  |
                     |  - Hoặc nhập kho kèm serial qua Phiếu Nhập / Excel    |
                     |  - Khởi tạo: stock_state = 'IN_STOCK'                 |
                     +---------------------------+---------------------------+
                                                 |
                                                 v
                     +-------------------------------------------------------+
                     |           GIAI ĐOẠN 2: LƯU KHO & KIỂM ĐỊNH            |
                     |  - Định vị: Gắn với kho cụ thể (current_warehouse_id) |
                     |  - Chất lượng: Đạt (PASSED) / Cách ly (QUARANTINE)    |
                     |  - Cảnh báo: Chỉ serial Đạt mới tính vào Tồn khả dụng |
                     +---------------------------+---------------------------+
                                                 |
                                                 v
                     +-------------------------------------------------------+
                     |         GIAI ĐOẠN 3: ĐIỀU CHUYỂN & CẤP PHÁT           |
                     |  - Chuyển kho nội bộ (TRANSFER -> IN_TRANSIT)         |
                     |  - Cấp phát cho nhân sự quản lý (CUSTODY / HRM)       |
                     |  - Lắp ráp vào Cây tài sản / Máy móc (CMMS / ASSET)   |
                     +---------------------------+---------------------------+
                                                 |
                                                 v
                     +-------------------------------------------------------+
                     |           GIAI ĐOẠN 4: XUẤT KHO & HẬU MÃI             |
                     |  - Xuất bán hàng (CRM / ISSUE -> stock_state = ISSUED)|
                     |  - Ghi nhận lần xuất cuối (SerialLastIssue, ngày xuất)|
                     |  - Xuất bảo hành hãng (VENDOR_REPAIR)                 |
                     |  - Nhập thu hồi / Nhập trả lại kho (RETURN)           |
                     |  - Hết khấu hao / Hỏng hoàn toàn (SCRAPPED - Thanh lý)|
                     +-------------------------------------------------------+
```

---

### 2.2 Chi tiết Cấu trúc Dữ liệu Vòng đời

#### A. Bảng Quản lý Cá thể: `inventory_schema.serial_tracking`
Mỗi số serial của một mã hàng hóa là một dòng độc lập với các thuộc tính định danh:
- `id`: Định danh duy nhất của cá thể.
- `material_id`: Mã mặt hàng cha (ví dụ liên kết tới `TC-LAP`).
- `serial_number`: Số serial duy nhất (ví dụ `TC-LAP-2026-001`).
- `internal_code`: Mã quản lý nội bộ bổ sung (nếu có).
- `current_warehouse_id`: Kho vật lý mà cá thể này đang cư trú.
- `current_asset_id`: Tài sản cha mà serial này đang được lắp đặt vào (nếu là linh kiện).
- `stock_state`: Trạng thái sổ kho chuẩn hóa:
  - `IN_STOCK`: Đang thực tế nằm trong kho, có thể xuất.
  - `IN_TRANSIT`: Đang trong quá trình luân chuyển giữa các kho.
  - `ISSUED`: Đã xuất khỏi kho (bán cho khách, lắp công trình, hoặc cấp phát).
  - `SCRAPPED`: Đã thanh lý, hủy bỏ hoàn toàn.
- `quality_status`: Trạng thái kiểm định chất lượng:
  - `PASSED`: Đạt tiêu chuẩn, cho phép xuất dùng.
  - `QUARANTINE`: Tạm khóa để kiểm định / chờ kiểm tra kỹ thuật.
  - `DEFECTIVE`: Phát hiện lỗi / hỏng hóc, chặn không cho đưa vào phiếu xuất.
  - `PENDING_INSPECTION`: Chờ nghiệm thu đầu vào.
- `location_type`: Phân loại vị trí sử dụng (`WAREHOUSE`, `ASSET`, `VENDOR_REPAIR`, `CUSTOMER`).

#### B. Bảng Nhật ký Biến động Vòng đời: `inventory_schema.serial_movements`
Mọi thay đổi phát sinh trên từng serial đều tự động tạo một dòng sự kiện bất biến (`SerialMovement`):
- `movement_type`: Loại biến động:
  - `RECEIPT`: Nhập kho (kèm số chứng từ nhập, ngày nhập, người thực hiện).
  - `ISSUE`: Xuất kho (kèm số chứng từ xuất, khách hàng / đối tác nhận).
  - `TRANSFER`: Điều chuyển từ kho A sang kho B.
  - `RETURN`: Nhập trả lại kho (từ khách hàng hoặc từ nhân viên trả máy).
  - `WARRANTY_ISSUE`: Xuất gửi đi bảo hành tại hãng.
  - `ADJUSTMENT`: Điều chỉnh trạng thái qua đợt kiểm kê.
  - `REVERSAL`: Đảo ngược / hủy chứng từ trước đó.
  - `QUALITY_CHANGE`: Đổi trạng thái chất lượng (từ Đạt sang Lỗi hoặc ngược lại, **bắt buộc kèm lý do kỹ thuật**).
- `from_warehouse_code`, `to_warehouse_code`: Lộ trình kho.
- `document_code`, `source_type`, `source_id`: Truy vết chứng từ gốc (đơn bán CRM, phiếu bảo hành, phiếu quy trình).
- `occurred_at`: Dấu thời gian chính xác của sự kiện.
- `actor_id`: Người dùng thực hiện thao tác.

---

### 2.3 Các API Vòng đời Đã Sẵn Sàng Ở Tầng Backend

Hệ thống đã cung cấp đầy đủ các API sẵn sàng phục vụ hiển thị và xử lý:

| Phương thức & Đường dẫn | Chức năng nghiệp vụ |
|---|---|
| `GET /api/inventory/v1/serials?materialCode=...` | Tải danh sách toàn bộ các cá thể serial của một mã hàng hóa (bao gồm trạng thái tồn và chất lượng). |
| `POST /api/inventory/v1/serials` | Đăng ký hàng loạt số serial mới cho mã hàng hóa. |
| `PATCH /api/inventory/v1/serials/:code/:serial` | Cập nhật tình trạng sử dụng hoặc phân loại vị trí của serial. |
| `GET /api/inventory/v1/serials/:serial/history` | **Tra cứu toàn diện hồ sơ vòng đời của một serial:** Thông tin mặt hàng, kho hiện tại, lần xuất gần nhất (`SerialLastIssue`), ngày kích hoạt bảo hành, và danh sách toàn bộ sự kiện biến động từ trước đến nay. |
| `PUT /api/inventory/v1/serials/:serial/quality` | Thay đổi trạng thái chất lượng của serial (bắt buộc truyền lý do). |
| `POST /api/inventory/v1/installations` | Lắp serial vào thiết bị / cây tài sản (chuyển vị trí sang `ASSET`). |
| `POST /api/inventory/v1/uninstallations` | Tháo serial khỏi thiết bị hồi về kho (chuyển vị trí sang `WAREHOUSE`). |

---

## 3. Đề Xuất Giải Pháp Nâng Cấp Giao Diện (Action Plan)

Để giải quyết triệt để sự thiếu hụt thông tin và làm rõ sự phân biệt giữa các serial của cùng một hàng hóa (như `TC-LAP`), đề xuất triển khai 2 hạng mục giao diện:

### 3.1 Hạng mục 1: Tích hợp Danh sách Serial vào `TradeItemDrawer`
- **Vị trí:** Trong Drawer chi tiết hàng hóa (`packages/features/inventory/src/lib/components/trade-item-drawer.tsx`).
- **Nội dung:** Khi mặt hàng có `trackingMode === 'SERIAL'`, bổ sung thêm một phần riêng: **"Danh sách cá thể Serial"**.
- **Cấu trúc bảng hiển thị:**
  - Cột 1: **Số Serial** (Font chữ mono rõ ràng, nổi bật).
  - Cột 2: **Kho hiện tại** (Hiển thị tên kho đang giữ máy, ví dụ: Kho Tổng Hà Nội).
  - Cột 3: **Trạng thái sổ kho** (Badge màu: Xanh lá = `Trong kho`, Xanh dương = `Đã xuất`, Cam = `Đang chuyển`).
  - Cột 4: **Chất lượng** (Badge: Đạt / Cách ly / Lỗi).
  - Cột 5: **Thao tác** (Nút xem chi tiết lịch sử vòng đời).

### 3.2 Hạng mục 2: Xây dựng Popup/Drawer "Nhật ký Vòng đời Serial" (`SerialHistoryDrawer`)
- Khi người dùng bấm vào một số serial bất kỳ (ví dụ `TC-LAP-001`):
  - Hiển thị hộp thông tin tóm tắt: Mặt hàng cha, số serial, kho đang giữ, ngày nhập kho đầu tiên, ngày xuất bán (nếu có).
  - Hiển thị **Dòng thời gian sự kiện (Event Timeline)** trực quan:
    - *20/11/2026 09:30:* Nhập kho qua Phiếu nhập `PN-2026-0012` bởi Thủ kho A.
    - *20/11/2026 11:00:* Kiểm tra kỹ thuật: Chất lượng chuyển sang `Đạt`.
    - *20/11/2026 14:15:* Xuất kho bàn giao theo Đơn hàng CRM `SO-0089` bởi Nhân viên B.
    - *20/11/2026 16:00:* Khách hàng kích hoạt bảo hành điện tử (thời hạn 12 tháng).

---

## 4. Kịch Bản Kiểm Thử Xác Nhận (UAT Test Cases)

1. **TC-SERIAL-01: Phân biệt cá thể trong cùng một mã hàng**
   - Mở mặt hàng `TC-LAP` có 3 số serial: `SN01`, `SN02`, `SN03`.
   - Kết quả: Thấy rõ `SN01` đang ở Kho A (Trong kho), `SN02` đang ở Kho B (Trong kho), `SN03` đã xuất cho khách hàng.
2. **TC-SERIAL-02: Tra cứu lịch sử di chuyển**
   - Bấm vào số serial `SN03`.
   - Kết quả: Hệ thống hiển thị đầy đủ chứng từ xuất kho đã giao cho ai, ngày giờ nào.
3. **TC-SERIAL-03: Đổi trạng thái chất lượng**
   - Chuyển `SN02` từ `Đạt` sang `Lỗi / Hỏng` kèm lý do "Vỡ màn hình khi vận chuyển".
   - Kết quả: Hệ thống khóa `SN02`, khi lập phiếu xuất kho không cho phép chọn `SN02`.
