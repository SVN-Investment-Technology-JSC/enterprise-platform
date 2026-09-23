# Thiết kế chức năng Kiểm kê kho

## 1. Mục tiêu và phạm vi

Kiểm kê kho là nghiệp vụ đối soát **nhiều hàng hóa trong một kho hoặc một phạm vi kho** với số liệu sổ sách. Chức năng không thay thế Nhập kho, Xuất kho hoặc Luân chuyển kho; chênh lệch chỉ được ghi nhận thành điều chỉnh tồn sau khi đã được duyệt.

Tab `Kiểm kê` trong drawer vật tư hiện hữu chỉ nên dùng để tra cứu lần kiểm kê gần nhất của **một vật tư**. Đây không phải nơi tạo hoặc hoàn tất một đợt kiểm kê toàn kho.

## 2. Vị trí trong điều hướng

Không thêm một tab cấp một mới trên menu bar. Cấu trúc menu hiện tại đã gộp các nghiệp vụ vận hành thành `Kho & Danh mục`, `Giao dịch & Nhập xuất` và `Cây tài sản`.

Đặt `Kiểm kê kho` là tab cấp hai trong `Giao dịch & Nhập xuất`:

```text
Giao dịch & Nhập xuất
├─ Giao dịch kho
│  ├─ Nhập kho
│  ├─ Xuất kho
│  ├─ Luân chuyển
│  └─ Sổ giao dịch
└─ Kiểm kê kho
   ├─ Danh sách đợt kiểm kê
   └─ Chi tiết / thực hiện kiểm kê
```

Lý do: kiểm kê có thể dẫn tới giao dịch `ADJUSTMENT`, nhưng có vòng đời, phê duyệt và lịch sử riêng; vì vậy không phù hợp với popup hoặc form của một phiếu nhập/xuất/chuyển đơn lẻ.

Có thể có lối tắt `Tạo đợt kiểm kê` từ dashboard, bảng tồn kho hoặc drawer vật tư. Lối tắt phải mở workspace `Kiểm kê kho` với kho/mã vật tư đã được điền sẵn.

## 3. Bố cục giao diện

Áp dụng master-detail cho màn hình 16:9.

```text
┌──────────────────── Danh sách đợt ───────────────────┬──────────────────── Chi tiết đợt kiểm kê ────────────────────┐
│ [+ Tạo đợt]  Tìm mã/tên đợt…                         │ KK-2026-00018 · Kho VT Trung tâm · Đang kiểm đếm             │
│                                                       │ [Lưu nháp] [Nhập Excel] [Xuất mẫu] [Trình duyệt]             │
│ KK-2026-00018  Đang kiểm đếm                          │                                                            │
│ KK-2026-00017  Chờ duyệt                              │ Thông tin đợt | Phạm vi | Tổ kiểm kê | Tệp                    │
│ KK-2026-00016  Đã ghi sổ                              │                                                            │
│                                                       │ Tìm mã/tên…  [Chưa đếm] [Có chênh lệch] [Lô/Sê-ri]          │
│                                                       │ ┌──────────────────── Bảng kiểm đếm đa hàng ──────────────┐ │
│                                                       │ │ Mã | Tên | ĐVT | Sổ sách | Thực đếm | Lệch | Lý do | ...│ │
│                                                       │ └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

- Cột trái: danh sách đợt, lọc theo kho, trạng thái, thời gian và người phụ trách.
- Cột phải: hồ sơ đợt và data grid kiểm đếm có sticky column, lọc/sắp xếp, chọn nhiều dòng và virtual scroll.
- Tạo đợt dùng Popup Form. Xóa hoặc hủy đợt dùng Popconfirm.
- Tất cả lựa chọn kho, phạm vi, nhóm hàng và thành viên dùng `SearchableSelect`; không dùng HTML `select` tĩnh.

## 4. Thông tin đợt kiểm kê

| Nhóm | Trường |
|---|---|
| Nhận diện | Mã tự sinh `KK-YYYY-xxxxx`, tên đợt, loại định kỳ/đột xuất |
| Phạm vi | Kho, toàn kho/nhóm vật tư/vị trí kệ/danh sách mã |
| Mốc đối chiếu | Thời điểm chốt snapshot số sách |
| Nhân sự | Trưởng nhóm, thành viên kiểm đếm, người duyệt |
| Hồ sơ | Ghi chú, quyết định, biên bản, ảnh/tệp đính kèm |

## 5. Bảng kiểm đếm đa hàng hóa

Mỗi dòng có các nhóm cột sau:

| Nhóm | Dữ liệu |
|---|---|
| Định danh | Mã, tên vật tư, ĐVT, vị trí kệ, loại quản lý thường/lô/sê-ri |
| Tồn sổ | Số lượng snapshot và biến động sau snapshot |
| Kiểm đếm | Lần đếm 1, lần đếm 2, số thực đếm chốt, người và thời điểm đếm |
| Đối soát | Chênh lệch thừa/thiếu, giá trị chênh lệch, trạng thái dòng |
| Xử lý | Lý do, ghi chú, minh chứng, lịch sử thay đổi |

Vật tư theo lô hoặc sê-ri được kiểm qua Drawer chi tiết để quét/nhập lô, sê-ri; grid chỉ hiển thị tổng hợp.

Toolbar cần có: tìm nhanh, lọc Chưa đếm/Có chênh lệch/Theo lô/Sê-ri, xuất mẫu Excel, nhập Excel, đánh dấu đã đếm và tải danh sách in.

## 6. Luồng nghiệp vụ

```text
Nháp → Đang kiểm đếm → Chờ duyệt → Đã duyệt → Đã ghi sổ
                         └────────→ Trả lại / Hủy
```

1. Tạo đợt, chọn kho và phạm vi.
2. Hệ thống chụp snapshot tồn sổ và sinh các dòng kiểm kê.
3. Thủ kho nhập số đếm trực tiếp hoặc từ Excel.
4. Mọi dòng chênh lệch phải có lý do; mức chênh lệch lớn có thể yêu cầu minh chứng.
5. Gửi duyệt, khóa số đếm và snapshot.
6. Khi duyệt, hệ thống tạo các bút toán `ADJUSTMENT` theo các dòng chênh lệch.
7. Đợt chuyển sang `Đã ghi sổ`, toàn bộ nội dung chỉ đọc.

## 7. Quy tắc số liệu và kiểm soát

- Không cập nhật tồn trực tiếp khi người dùng nhập số thực đếm.
- Snapshot là mốc đối chiếu bất biến; không dùng số tồn đang thay đổi làm lại mốc sau khi bắt đầu đếm.
- Ưu tiên khóa giao dịch Nhập/Xuất/Luân chuyển cho kho đang kiểm kê. Nếu vẫn cho phép giao dịch, phải ghi nhận phần biến động sau snapshot để đối soát lại trước lúc duyệt.
- Không sửa/xóa đợt đã ghi sổ. Nếu có sai sót, tạo đợt hoặc điều chỉnh mới có tham chiếu đợt cũ.
- Bắt buộc audit log cho thay đổi số đếm: giá trị trước/sau, người thực hiện, thời điểm và lý do.

## 8. Mô hình lưu trữ

### 8.1. Sơ đồ thực thể quan hệ (ERD)
```text
stocktake_sessions (1) ───< (N) stocktake_lines (1) ───< (N) stocktake_count_entries
       │                                 │
       │                                 ├───< (N) stocktake_line_audits
       │                                 └───< (N) stocktake_lot_allocations / serials
       └───< (N) inventory_adjustments
```

### 8.2. Chi tiết cấu trúc bảng (DDL Specification)

#### Bảng `stocktake_sessions`
- `id` (UUID, PK): Khóa chính
- `tenant_id` (VARCHAR(64), NOT NULL): Mã định danh tenant
- `code` (VARCHAR(32), UNIQUE, NOT NULL): Mã đợt tự sinh định dạng `KK-YYYY-xxxxx`
- `title` (VARCHAR(255), NOT NULL): Tên/Mục đích đợt kiểm kê
- `warehouse_code` (VARCHAR(64), NOT NULL): Mã kho được kiểm kê (FK -> warehouses)
- `status` (VARCHAR(32), NOT NULL DEFAULT 'DRAFT'): `DRAFT`, `COUNTING`, `PENDING_APPROVAL`, `APPROVED`, `POSTED`, `CANCELLED`
- `scope_type` (VARCHAR(32), NOT NULL DEFAULT 'ALL'): `ALL` (Toàn kho), `CATEGORY` (Theo nhóm), `SPECIFIC_ITEMS` (Chỉ định)
- `scope_categories` (JSONB): Mảng danh mục khi scope_type = CATEGORY
- `snapshot_at` (TIMESTAMPTZ): Thời điểm chốt số tồn hệ thống (bất biến)
- `lead_auditor` (VARCHAR(128)): Trưởng nhóm kiểm kê
- `auditors` (JSONB): Danh sách kiểm kê viên
- `approved_by` (VARCHAR(128)): Người phê duyệt
- `approved_at` (TIMESTAMPTZ): Thời điểm duyệt
- `note` (TEXT): Ghi chú, quyết định kiểm kê
- `total_items` (INT DEFAULT 0): Tổng số mặt hàng trong phạm vi
- `counted_items` (INT DEFAULT 0): Số mặt hàng đã kiểm đếm
- `difference_items` (INT DEFAULT 0): Số mặt hàng phát hiện chênh lệch (thừa/thiếu)
- `total_variance_value` (DECIMAL(18,4) DEFAULT 0): Tổng giá trị chênh lệch (VNĐ)
- `created_by` (VARCHAR(128)): Người tạo
- `created_at` (TIMESTAMPTZ DEFAULT NOW()): Thời điểm tạo
- `updated_at` (TIMESTAMPTZ DEFAULT NOW()): Thời điểm cập nhật cuối

#### Bảng `stocktake_lines`
- `id` (UUID, PK): Khóa chính dòng kiểm kê
- `session_id` (UUID, NOT NULL, FK -> stocktake_sessions ON DELETE CASCADE)
- `material_code` (VARCHAR(64), NOT NULL): Mã vật tư
- `material_name` (VARCHAR(255), NOT NULL): Tên vật tư
- `unit` (VARCHAR(32), NOT NULL): Đơn vị tính
- `bin_location` (VARCHAR(64)): Vị trí kệ/khay
- `is_serialized` (BOOLEAN DEFAULT FALSE): Quản lý theo sê-ri
- `is_lot_tracked` (BOOLEAN DEFAULT FALSE): Quản lý theo số lô / HSD
- `system_quantity` (DECIMAL(14,4) NOT NULL): Số lượng tồn snapshot sổ sách
- `count_round1` (DECIMAL(14,4)): Số lượng kiểm đếm vòng 1
- `count_round2` (DECIMAL(14,4)): Số lượng kiểm đếm vòng 2 (nếu có đối soát lại)
- `actual_quantity` (DECIMAL(14,4)): Số lượng thực đếm chốt cuối cùng
- `difference` (DECIMAL(14,4) DEFAULT 0): `actual_quantity - system_quantity` (<0: Thiếu, >0: Thừa, =0: Khớp)
- `unit_cost` (DECIMAL(18,4) DEFAULT 0): Giá vốn đơn vị tại thời điểm snapshot
- `difference_value` (DECIMAL(18,4) DEFAULT 0): `difference * unit_cost`
- `reason` (TEXT): Lý do chênh lệch (bắt buộc khi difference != 0)
- `status` (VARCHAR(32) NOT NULL DEFAULT 'UNCOUNTED'): `UNCOUNTED`, `MATCHED`, `SURPLUS`, `DEFICIT`
- `lot_allocations` (JSONB): Chi tiết phân bổ lô (lotNumber, systemQty, actualQty, expiryDate)
- `serial_allocations` (JSONB): Danh sách serial đối soát (serialNumber, status: FOUND/MISSING/EXTRA)
- `note` (TEXT): Ghi chú riêng cho dòng vật tư
- `updated_at` (TIMESTAMPTZ DEFAULT NOW())

#### Bảng `stocktake_line_audits`
- `id` (UUID, PK)
- `line_id` (UUID, NOT NULL, FK -> stocktake_lines)
- `previous_quantity` (DECIMAL(14,4)): Giá trị đếm trước khi sửa
- `new_quantity` (DECIMAL(14,4)): Giá trị đếm mới
- `operator` (VARCHAR(128)): Người sửa
- `timestamp` (TIMESTAMPTZ DEFAULT NOW()): Thời điểm thay đổi
- `reason` (TEXT): Lý do thay đổi số đếm

---

## 9. Chi tiết đặc tả API (API Specifications)

### 9.1. Danh sách và Tạo đợt kiểm kê

#### 1. `GET /api/inventory/v1/stocktakes`
- **Mục đích**: Lấy danh sách đợt kiểm kê kèm bộ lọc tìm kiếm và phân trang.
- **Query Params**:
  - `warehouseCode` (string, optional): Lọc theo mã kho
  - `status` (StocktakeStatus, optional): Lọc theo trạng thái
  - `search` (string, optional): Tìm theo mã hoặc tên đợt
  - `page` (number, default 1), `limit` (number, default 20)
- **Response (200 OK)**:
  ```json
  {
    "items": [
      {
        "id": "st-uuid-1",
        "code": "KK-2026-00001",
        "title": "Kiểm kê định kỳ Quý 1/2026",
        "warehouseCode": "WH-MAIN",
        "warehouseName": "Kho Tổng Thiết Bị",
        "status": "COUNTING",
        "scopeType": "ALL",
        "snapshotAt": "2026-03-31T01:00:00Z",
        "leadAuditor": "Nguyễn Văn A",
        "totalItems": 140,
        "countedItems": 85,
        "differenceItems": 4,
        "totalVarianceValue": -3450000,
        "createdAt": "2026-03-31T00:30:00Z",
        "updatedAt": "2026-03-31T03:15:00Z"
      }
    ],
    "total": 1
  }
  ```

#### 2. `POST /api/inventory/v1/stocktakes`
- **Mục đích**: Khởi tạo hồ sơ đợt kiểm kê ở trạng thái `DRAFT`.
- **Request Body**:
  ```json
  {
    "title": "Kiểm kê đột xuất Kho Vật tư Phụ tùng",
    "warehouseCode": "WH-SPARE",
    "scopeType": "ALL",
    "leadAuditor": "Trần Thị B",
    "auditors": ["Lê Văn C", "Phạm Văn D"],
    "note": "Kiểm kê theo Quyết định số 45/QĐ-VT"
  }
  ```
- **Response (201 Created)**: Trả về đối tượng `StocktakeSession` vừa tạo.

---

### 9.2. Quy trình Thực hiện Kiểm đếm & Chốt Snapshot

#### 3. `POST /api/inventory/v1/stocktakes/:id/start`
- **Mục đích**: **Chốt snapshot số liệu sổ sách** và bắt đầu kiểm đếm.
- **Hành vi hệ thống**:
  - Khóa số tồn hiện tại của tất cả vật tư thuộc phạm vi vào `systemQuantity`.
  - Tự động sinh danh sách các bản ghi `stocktake_lines` với `status = 'UNCOUNTED'`.
  - Cập nhật `status = 'COUNTING'` và ghi nhận `snapshotAt = NOW()`.
- **Response (200 OK)**:
  ```json
  {
    "session": { "id": "st-uuid-1", "status": "COUNTING", "snapshotAt": "2026-03-31T08:00:00Z", ... },
    "totalLinesGenerated": 140
  }
  ```

#### 4. `GET /api/inventory/v1/stocktakes/:id/lines`
- **Mục đích**: Lấy danh sách chi tiết các mặt hàng cần đếm của đợt kiểm kê.
- **Query Params**:
  - `status` (UNCOUNTED | MATCHED | SURPLUS | DEFICIT)
  - `search` (Mã hoặc tên vật tư)
  - `hasDiffOnly` (boolean): Chỉ lấy các dòng có chênh lệch
- **Response (200 OK)**: Mảng các `StocktakeLine`.

#### 5. `PATCH /api/inventory/v1/stocktakes/:id/lines` (Lưu nháp kiểm đếm)
- **Mục đích**: Cập nhật kết quả kiểm đếm thực tế và lý do cho một hoặc nhiều dòng.
- **Request Body**:
  ```json
  {
    "lines": [
      {
        "lineId": "line-uuid-1",
        "countRound1": 15,
        "actualQuantity": 15,
        "reason": "Hao hụt tự nhiên do bảo quản",
        "note": "Kiểm đếm tại kệ A2",
        "lotAllocations": [
          { "lotNumber": "LOT-2025-01", "systemQty": 16, "actualQty": 15 }
        ]
      }
    ]
  }
  ```
- **Hành vi hệ thống**:
  - Tính toán tự động: `difference = actualQuantity - systemQuantity`, `differenceValue = difference * unitCost`.
  - Cập nhật trạng thái dòng (`MATCHED` / `SURPLUS` / `DEFICIT`).
  - Ghi vết lịch sử vào `stocktake_line_audits` nếu số lượng thay đổi so với lần lưu trước.
  - Tổng hợp lại thống kê đợt (`countedItems`, `differenceItems`, `totalVarianceValue`).
- **Response (200 OK)**: Danh sách dòng sau cập nhật và session thống kê mới.

#### 6. `POST /api/inventory/v1/stocktakes/:id/import`
- **Mục đích**: Nhập file Excel số lượng thực tế kiểm đếm.
- **Payload**: `multipart/form-data` chứa file `.xlsx` / `.csv`.
- **Hành vi**: Ánh xạ theo `materialCode`, cập nhật hàng loạt `actualQuantity` và trả về kết quả đối soát.

---

### 9.3. Quy trình Phê duyệt & Ghi sổ Cân kho

#### 7. `POST /api/inventory/v1/stocktakes/:id/submit` (Gửi trình duyệt)
- **Mục đích**: Chốt hồ sơ đếm, chuyển trạng thái từ `COUNTING` sang `PENDING_APPROVAL`.
- **Ràng buộc**:
  - Chỉ cho phép gửi khi đợt đang ở trạng thái `COUNTING`.
  - Cảnh báo nếu còn dòng chưa đếm (`UNCOUNTED`).
  - Khóa quyền chỉnh sửa ô `actualQuantity` trên giao diện.

#### 8. `POST /api/inventory/v1/stocktakes/:id/reject` (Yêu cầu kiểm đếm lại)
- **Mục đích**: Cấp quản lý/kế toán từ chối kết quả đếm nếu nghi ngờ sai lệch số liệu.
- **Request Body**:
  ```json
  {
    "reason": "Chênh lệch vòng bi quá lớn, yêu cầu thủ kho đếm lại vòng 2 với sự giám sát của kế toán"
  }
  ```
- **Hành vi**: Chuyển trạng thái từ `PENDING_APPROVAL` trở lại `COUNTING`, mở khóa quyền sửa số đếm cho nhân viên.

#### 9. `POST /api/inventory/v1/stocktakes/:id/approve` (Phê duyệt kết quả)
- **Mục đích**: Phê duyệt báo cáo chênh lệch kiểm kê.
- **Quyền hạn**: Kế toán trưởng / Giám đốc kho vận (`role: INVENTORY_MANAGER` / `TENANT_ADMIN`).
- **Trạng thái chuyển đổi**: `PENDING_APPROVAL` -> `APPROVED`.

#### 10. `POST /api/inventory/v1/stocktakes/:id/post` (Ghi sổ cân kho tự động)
- **Mục đích**: Tự động sinh các giao dịch điều chỉnh kho (`ADJUSTMENT`) trên sổ cái kho và kết thúc đợt kiểm kê.
- **Hành vi nguyên tử (Atomic Database Transaction)**:
  1. Lọc tất cả các dòng có `difference != 0`.
  2. Nếu `difference > 0` (Thừa): Tạo bút toán `TransactionType.RECEIPT` (hoặc `ADJUSTMENT_IN`) với số lượng `+difference`.
  3. Nếu `difference < 0` (Thiếu): Tạo bút toán `TransactionType.ISSUE` (hoặc `ADJUSTMENT_OUT`) với số lượng `-difference`.
  4. Ghi nhận tham chiếu giao dịch: `referenceType = 'STOCKTAKE'`, `referenceId = session.code`.
  5. Chuyển trạng thái đợt sang `POSTED`. Toàn bộ hồ sơ trở thành **chỉ đọc bất biến (Read-only)**.

#### 11. `POST /api/inventory/v1/stocktakes/:id/cancel`
- **Mục đích**: Hủy đợt kiểm kê (chỉ áp dụng khi đợt chưa `POSTED`).
- **Request Body**: `{ "reason": "Hủy đợt do lịch bảo trì đột xuất" }`.

#### 12. `GET /api/inventory/v1/stocktakes/:id/audit`
- **Mục đích**: Lấy toàn bộ nhật ký thay đổi số đếm của đợt để phục vụ kiểm toán nội bộ.

---

## 10. Lộ trình triển khai

1. Migration CSDL PostgreSQL và Domain Contracts/Store/API (`stocktake_sessions`, `stocktake_lines`, `stocktake_line_audits`).
2. Màn hình Master-Detail Danh sách đợt + Modal Tạo đợt kiểm kê.
3. Grid Kiểm đếm số lượng thực tế, lưu nháp và Import/Export Excel.
4. Kiểm đếm vật tư quản lý theo Lô / Số Sê-ri (Serial Tracking) qua Drawer chi tiết.
5. Quy trình Trình duyệt, Trả về kiểm đếm lại và Tự động ghi sổ bút toán cân kho `ADJUSTMENT`.

