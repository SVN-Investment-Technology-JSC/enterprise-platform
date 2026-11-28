# Kế hoạch giao diện: Vị trí lưu trữ, Cách theo dõi, Lô, Serial và Nhật ký vòng đời

Tài liệu này đặc tả chi tiết bố cục giao diện (UI layout), thành phần tương tác (components), luồng thao tác (UX workflows) và trạng thái hiển thị cho các tính năng mới được đề xuất trong [KE_HOACH_BACKEND_VI_TRI_LUU_TRU_VA_PHAN_LOAI_THEO_DOI.md](KE_HOACH_BACKEND_VI_TRI_LUU_TRU_VA_PHAN_LOAI_THEO_DOI.md).

Phạm vi: Phân hệ Kho (`packages/features/inventory`). Logic, dữ liệu và API nằm ở kế hoạch backend; tài liệu này chỉ nói về màn hình, bố cục và tương tác.

---

## 1. Quy chuẩn thiết kế chung (Design System Standards)

Toàn bộ các màn hình và hộp thoại tuân thủ nghiêm ngặt quy chuẩn UI/UX của nền tảng:
- **Nguyên tắc biểu tượng**: Tuyệt đối **không sử dụng emoji** (như các ký tự Unicode 📋, 🔍, ⚠️, 📦...). Toàn bộ icon sử dụng vector SVG từ thư viện `lucide-react` hoặc nhãn văn bản thuần túy.
- **Form Controls & Dropdowns**: Toàn bộ ô chọn danh mục (Kho, Hàng hóa, Nhà cung cấp, Trạng thái...) bắt buộc dùng `SearchableSelect` từ `@enterprise-platform/shared-ui`, không dùng thẻ `<select>` hay dropdown không tìm kiếm được.
- **Thư viện thành phần**:
  - `shadcn/ui` + Tailwind CSS cho Layout, Card, Form controls, Dialog, Drawer, Tabs, Badge, Tooltip.
  - `Ant Design (antd)` cho các Bảng dữ liệu phức tạp (Table/Data Grid với fixed columns, sorting, filtering, row selection).
- **Màu sắc**: dùng token và lớp Tailwind có sẵn của ModuleShell, không đặt mã màu cứng trong từng màn hình.
- **Ngôn ngữ hiển thị**: 100% tiếng Việt có dấu đầy đủ, rõ ràng và chuẩn mực doanh nghiệp.

---

## 2. Bản đồ màn hình & Thành phần tương tác mới

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PHÂN HỆ QUẢN LÝ KHO (INVENTORY MODULE)                          │
├────────────────────────┬───────────────────────────────┬───────────────────────────────┤
│    VỊ TRÍ LƯU TRỮ      │       CÁCH THEO DÕI           │     LÔ, SERIAL & NHẬT KÝ      │
├────────────────────────┼───────────────────────────────┼───────────────────────────────┤
│ 1. Tab Vị trí lưu trữ  │ 5. Ô Cách theo dõi            │ 7. Danh mục Nhà cung cấp      │
│    (Drawer hàng hóa)   │    (Form tạo/sửa hàng hóa)    │    (Cài đặt kho)              │
│ 2. Cấu hình cấp vị trí │ 6. Cảnh báo đổi cách theo dõi │ 8. Quản lý Lô & Hộp thoại     │
│    (Form chỉnh sửa kho)│    (Khi đã phát sinh tồn kho) │    xử lý trùng/lệch lô        │
│ 3. Vị trí trong Kiểm kê│                               │ 9. Dòng thời gian vòng đời    │
│    & Modal ghi ngược   │                               │    (Timeline Drawer Lô/Serial)│
│ 4. Vị trí trên Phiếu   │                               │ 10. Ghi chú tay (Note entry)  │
│    xuất / chuyển kho   │                               │     trên dòng thời gian       │
├────────────────────────┴───────────────────────────────┴───────────────────────────────┤
│ 11. Hộp thoại nhập Excel: Cột vị trí, serial, xử lý lô & Chế độ nạp vị trí hàng loạt   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Chi tiết bố cục & Luồng tương tác

### 3.1 Màn hình 1: Vị trí lưu trữ trong hồ sơ hàng hóa
- **Vị trí tích hợp**: nhóm "Vị trí lưu trữ" trong drawer chi tiết mặt hàng (`storage-location-panel.tsx`, gắn vào `trade-item-drawer.tsx`). Drawer không chia tab.
- **Mục đích**: khai báo mặt hàng nằm ở vị trí nào trong từng kho; mỗi kho có một vị trí chính.

```
Vị trí lưu trữ
  Kho WH-01 - Kho tổng            Cấp: Khu vực / Dãy / Kệ / Tầng (riêng của kho)
    ( ) Chính   [Khu vực: A ] [Dãy: 02 ] [Kệ: K3 ] [Tầng: 4 ]   Ghi chú [......]   [Xóa]
    ( ) Phụ     [Khu vực: B ] [Dãy: 01 ] [Kệ:    ] [Tầng:   ]   Ghi chú [......]   [Xóa]
    [Thêm vị trí]                                                [Lưu]
  Kho WH-02 - Kho phụ tùng        Cấp: mẫu chung
    ...
```

- Mỗi kho một khối; số ô nhập và nhãn ô theo cấp của kho, không giới hạn số cấp. Kho không khai cấp thì dùng mẫu chung của tenant.
- Chỉ một dòng được chọn "Chính" trong mỗi kho. Vị trí là chữ tự do, không kiểm tra hợp lệ.
- Khối có thay đổi chưa lưu thì báo, đóng drawer phải hỏi (`CloseGuard`).
- Kho ảo và mặt hàng dịch vụ không hiện nhóm này.

### 3.2 Màn hình 2: Cấu hình Phân cấp Vị trí trong Form Kho
- **Vị trí tích hợp**: `packages/features/inventory/src/lib/components/warehouse-editor.tsx`.
- **Mục đích**: Cho phép admin định nghĩa số cấp và tên từng cấp (Khu vực, Kệ, Tầng, Ô...) riêng cho từng kho, không giới hạn số cấp.

```
┌───────────────────────────────────────────────────────────────────┐
│ Cấu hình phân cấp vị trí lưu trữ                                  │
│ Định nghĩa các tầng phân cấp giúp chuẩn hóa địa chỉ hàng hóa      │
├───────────────────────────────────────────────────────────────────┤
│ [X] Thiết lập cấu trúc phân cấp riêng cho kho này                 │
│     (Nếu tắt, kho sẽ áp dụng danh sách cấp mặc định của công ty)  │
│                                                                   │
│ Danh sách các cấp phân chia:                                      │
│ ┌───────────────────────────────────────────────────────────────┐ │
│ │ 1. Tên cấp 1: [ Khu vực           ] [Ví dụ: Khu A, Khu B] [X] │ │
│ │ 2. Tên cấp 2: [ Dãy kệ            ] [Ví dụ: Dãy 1, Dãy 2] [X] │ │
│ │ 3. Tên cấp 3: [ Kệ hàng           ] [Ví dụ: Kệ 01, Kệ 02] [X] │ │
│ │ 4. Tên cấp 4: [ Tầng / Ngăn       ] [Ví dụ: Tầng 1, Ô 03] [X] │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ [+ Thêm cấp tiếp theo]                                            │
│                                                                   │
│ Xem trước mẫu định vị: Khu vực / Dãy kệ / Kệ hàng / Tầng / Ngăn   │
└───────────────────────────────────────────────────────────────────┘
```

---

### 3.3 Màn hình 3: Kiểm kê Kho & Hộp thoại Ghi ngược Vị trí
- **Vị trí tích hợp**: `stocktake-hub.tsx`, `stocktake-lot-serial-drawer.tsx`.
- **Mục đích**: 
  - Cung cấp cột "Vị trí" ngay trên bảng đếm để sắp xếp tuyến kiểm kê thông minh.
  - Cập nhật ngược vị trí mới vào danh mục khi duyệt kiểm kê (không qua hộp thoại).

#### A. Cột Vị trí trên Bảng đếm kiểm kê

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Đợt kiểm kê: Đợt KK Quý 4 - Kho Tổng                        [Xuất file] [Duyệt đợt]   │
│ Bộ lọc: [Tất cả vị trí ▼]  Sắp xếp theo: [Tuyến vị trí (Khu -> Kệ -> Ô) ▼]            │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Mã hàng    Tên mặt hàng      Vị trí sổ sách    Vị trí thực tế       SL Sổ   SL Đếm    │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ MAT-001    Vòng bi SKF 6205  Khu A / Kệ 01     [Khu A / Kệ 01    ]  100     100       │
│ MAT-002    Phớt dầu TC 35    Khu A / Kệ 02     [Khu B / Kệ 05  ✎ ]   50      48       │
│ MAT-003    Bulong M10x50     (Chưa khai)       [Khu C / Ô 12   ✎ ]  200     200       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```
- Khi người đếm nhập vị trí thực tế khác với sổ sách, ô được đánh dấu để nhận biết có thay đổi vị trí.

#### B. Duyệt đợt kiểm kê
- **Không có hộp thoại riêng** để chọn cách xử lý từng dòng. Vị trí kiểm kê khác sổ sách được ghi ngược vào danh mục **tự động** khi duyệt.
- Hộp xác nhận duyệt hiện sẵn có chỉ thêm một câu cho biết có bao nhiêu mặt hàng đổi vị trí và sẽ được đồng bộ.
- Dòng đổi vị trí được đánh dấu trong bảng đếm (viền nhạt), cột "Vị trí sổ sách" luôn hiện vị trí ban đầu.

---

### 3.4 Màn hình 4: Hiển thị Vị trí trên Phiếu Xuất kho / Chuyển kho
- **Vị trí tích hợp**: `movement-form.tsx`, `stock-document-parts.tsx`.
- Giúp người nhặt hàng thấy ngay vị trí chính của mặt hàng ở kho xuất; có phụ thì ghi thêm số vị trí phụ. Chỉ đọc, không sửa ở đây.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Bảng mặt hàng xuất kho                                                                │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ STT  Mặt hàng                   Vị trí lưu trữ tại kho xuất       Số lượng    Đơn vị  │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ 1    Vòng bi SKF 6205           Khu A / Kệ 03 / Tầng 2 [Chính]    10          Cái     │
│      Mã: MAT-001                (Có thêm 1 vị trí phụ: Khu B)                         │
│                                                                                       │
│ 2    Dầu động cơ Total 15W40    Khu Hóa Chất / Kệ D1              2           Thùng   │
│      Mã: MAT-089                                                                      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3.5 Màn hình 5: Cải tiến Form Hàng hóa - Phân loại theo dõi (`material-form.tsx`)
- Bổ sung lựa chọn `Cách theo dõi` (`tracking_mode`) độc lập hoàn toàn với `Nhóm`. Ba lựa chọn Số lượng, Lô, Serial hiển thị dạng thẻ chọn một (không phải dropdown).

```
┌───────────────────────────────────────────────────────────────────┐
│ Phân loại & Cách theo dõi tồn kho                                 │
├───────────────────────────────────────────────────────────────────┤
│ Loại mặt hàng: (*)                                                │
│ [ SearchableSelect: Hàng hóa lưu kho (STOCK)                    ▼]│
│                                                                   │
│ Nhóm hàng hóa: (*)                                                │
│ [ SearchableSelect: Phụ tùng thay thế (SPARE_PART)              ▼]│
│                                                                   │
│ Cách theo dõi tồn kho: (*)                                        │
│ ( ) Số lượng   (x) Theo lô   ( ) Theo serial│
│ Dòng trợ giúp: Nhóm "Phụ tùng" gợi ý mặc định là "Chỉ theo số     │
│ lượng", bạn có thể tùy chọn "Theo Lô" nếu cần quản lý HSD/CO-CQ. │
│                                                                   │
│ * Lưu ý: Khi mặt hàng là "Dịch vụ (SERVICE)", ô cách theo dõi sẽ  │
│ tự động ẩn và cố định giá trị "Không theo dõi".                   │
└───────────────────────────────────────────────────────────────────┘
```

#### Cảnh báo khi người dùng cố gắng đổi cách theo dõi đã có phát sinh:
- Nếu mặt hàng đã có tồn kho hoặc chứng từ ghi sổ, trường `Cách theo dõi` bị khóa (`disabled`).
- Bên cạnh có icon khóa kèm `Tooltip`: *"Mặt hàng đã có số dư tồn kho hoặc phát sinh chứng từ ghi sổ. Không thể thay đổi phương thức theo dõi để đảm bảo tính toàn vẹn dữ liệu sổ cái."*

---

### 3.6 Màn hình 6: Quản lý Danh mục Nhà cung cấp trong Cài đặt Kho
- **Vị trí tích hợp**: Trang Cài đặt phân hệ Kho $\rightarrow$ Tab `Nhà cung cấp` (`catalog.supplier`).
- **Mục đích**: Chuẩn hóa danh mục nhà cung cấp cho quản lý Lô và Phiếu nhập (chế độ `CATALOG_ONLY`), chấm dứt tình trạng gõ chữ tự do gây lệch dữ liệu.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Cài đặt Kho / Danh mục Nhà cung cấp                                                   │
│ Quản lý danh sách nhà cung cấp phục vụ định danh Lô hàng và Chứng từ nhập kho        │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [ Tìm kiếm nhà cung cấp...     ]            [Nhập từ dữ liệu cũ]  [+ Thêm nhà cung cấp]│
│                                                                                       │
│ ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Tên nhà cung cấp                                   Trạng thái         Thao tác  │ │
│ ├───────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Công ty TNHH Kỹ Thuật SKF VN                        Đang dùng          [Sửa][Tắt]│
│ │ Tổng Công ty Dầu Khí Castrol                        Đang dùng          [Sửa][Tắt]│
│ │ Nhà phân phối Vòng bi Minh Hải                      Ngừng dùng         [Sửa][Mở] │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

#### Modal "Nhập & Chuẩn hóa từ Dữ liệu cũ" (Migration Helper UI):
- Cho phép quản trị viên quét toàn bộ các chuỗi văn bản tự do đã từng nhập trong quá khứ (`materials.supplier`, `lots.supplier`, `counterparty_name`), tự động làm sạch và đề xuất danh sách chuẩn:

```
┌───────────────────────────────────────────────────────────────────┐
│ Khởi tạo danh mục từ dữ liệu lịch sử                         [ ✕ ]│
│ Hệ thống quét thấy 18 biến thể tên nhà cung cấp trong dữ liệu cũ  │
├───────────────────────────────────────────────────────────────────┤
│ Chọn các nhà cung cấp hợp lệ để đưa vào Danh mục chuẩn:           │
│ ┌───────────────────────────────────────────────────────────────┐ │
│ │ [X] Tên đề xuất chuẩn hóa: "Công ty TNHH Thiết Bị Công Nghiệp"│ │
│ │     Các chuỗi gốc cũ: "Cty Thiet Bi CN", "CTY TNHH THIET BI"..│ │
│ │                                                               │ │
│ │ [X] Tên đề xuất chuẩn hóa: "Tập Đoàn Hóa Chất Petrolimex"     │ │
│ │     Các chuỗi gốc cũ: "Petrolimex", "Cty Petrolimex Hoa Chat" │ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ [ Huỷ ]                                   [ Duyệt nạp vào danh mục ]│
└───────────────────────────────────────────────────────────────────┘
```

---

### 3.7 Màn hình 7: Quản lý Lô & Hộp thoại Xử lý trùng/lệch Lô khi Nhập kho

#### A. Màn hình Quản lý Danh sách Lô (`lot-panel.tsx`)
- Bổ sung bộ lọc trạng thái lô ngừng sử dụng, nút tạo lô trước khi nhập, và nút ngừng dùng / xóa lô.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Quản lý Lô hàng (Lots)                                                 [+ Tạo lô mới] │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Bộ lọc: [Mặt hàng: Tất cả ▼] [Nhà cung cấp ▼] [Trạng thái CL ▼] [Hiện cả lô ngừng dùng]│
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Số lô     Mặt hàng         Nhà cung cấp      Hạn dùng    Tồn kho  Chất lượng  Thao tác│
├───────────────────────────────────────────────────────────────────────────────────────┤
│ L2411-01  Vòng bi SKF 6205 Cty SKF Việt Nam  20/12/2027  45 Cái   ĐẠT (PASSED)[Xem][✎]│
│ L2409-02  Mỡ bôi trơn LGMT Cty SKF Việt Nam  15/09/2025  0 Hộp    HẾT HẠN     [Xem][✎]│
│ L2301-A   Dây curoa B52    (Chưa có NCC)     Không HSD   0 Sợi    ĐÃ NGỪNG    [Xem][↺]│
└───────────────────────────────────────────────────────────────────────────────────────┘
```

#### B. Hộp thoại Xử lý trùng / lệch thông tin Lô khi Nhập kho (`LotResolutionDialog`)
- Xuất hiện khi thủ kho nhập hàng vào một Số lô đã tồn tại trong hệ thống nhưng có ít nhất một trường định danh (Nhà cung cấp, NSX, HSD, Số CO/CQ) bị khác biệt:

```
┌───────────────────────────────────────────────────────────────────┐
│ Xử lý thông tin Lô hàng nhập kho                             [ ✕ ]│
│ Số lô "L2411" đã tồn tại trên hệ thống với thông tin khác biệt    │
├───────────────────────────────────────────────────────────────────┤
│ Bảng so sánh thông tin:                                           │
│ ┌───────────────────────────────────────────────────────────────┐ │
│ │ Trường định danh     Lô hiện có trong kho   Lần nhập hàng này │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ Nhà cung cấp         Cty Thiết Bị Hà Nội    Cty SKF Việt Nam  │ │
│ │ Hạn sử dụng          31/12/2026             15/08/2027        │ │
│ │ Số chứng chỉ CO/CQ   CQ-9921                CQ-2024-X         │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ Chọn phương án giải quyết:                                        │
│ (•) Tạo số lô mới riêng biệt (Khuyến nghị)                        │
│     Số lô mới đề xuất: [ L2411-02                               ] │
│                                                                   │
│ ( ) Gom vào lô cũ & Cập nhật thông tin lô theo lần nhập này       │
│     (Ghi đè NCC và Hạn sử dụng mới vào hồ sơ Lô L2411)            │
│                                                                   │
│ ( ) Gom vào lô cũ & Giữ nguyên thông tin cũ của lô                │
│     (Số lượng cộng dồn vào L2411, bỏ qua thông tin NCC mới nhập)  │
│                                                                   │
│ [X] Áp dụng lựa chọn này cho các dòng mặt hàng cùng lô còn lại    │
├───────────────────────────────────────────────────────────────────┤
│ [ Hủy bỏ dòng này ]                                 [ Xác nhận xử lý ]│
└───────────────────────────────────────────────────────────────────┘
```

---

### 3.8 Màn hình 8: Dòng thời gian Nhật ký vòng đời Lô & Serial (Timeline Workspace)
- **Vị trí tích hợp**: Drawer hông phải (`Slide-in Panel`, độ rộng `680px`), cuộn độc lập (`overflow-y: auto`), thanh cuộn mảnh thanh lịch hover-reveal.
- **Mục đích**: Xem lại toàn bộ lịch sử biến động từ lúc sinh ra đến hiện tại, bao gồm: Nhập/Xuất/Chuyển kho, Đổi trạng thái kiểm định, Bán hàng, Bảo dưỡng, và Ghi chú tay của thủ kho.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Hồ sơ Serial: SN-8839201 - Máy bơm ly tâm 5KW                    [ ✕ ] │
│ Trạng thái tồn: ĐÃ XUẤT KHO  |  Chất lượng: HOẠT ĐỘNG TỐT             │
├────────────────────────────────────────────────────────────────────────┤
│ [Thông tin]   [Dòng thời gian vòng đời]                                │
├────────────────────────────────────────────────────────────────────────┤
│ Thêm ghi chú nhanh vào nhật ký:                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [ Nhập ghi chú kiểm tra, bàn giao hoặc tình trạng thực tế...     ] │ │
│ │                                                      [+ Thêm ghi chú]│
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ DÒNG THỜI GIAN HOẠT ĐỘNG                                               │
│                                                                        │
│ ◯ 18/11/2026 14:30 | Ghi chú vận hành thủ công                         │
│ │ Người ghi: Nguyễn Văn A (Thủ kho)                                    │
│ │ Nội dung: Khách hàng phản hồi chạy êm, đã nghiệm thu tại trạm bơm 2. │
│ │                                                                      │
│ ◯ 15/11/2026 09:15 | Xuất kho bán hàng                                 │
│ │ Chứng từ: XK-2026-00412  | Khách hàng: Công ty Cấp Thoát Nước ĐN     │
│ │ Người thực hiện: Trần Thị B                                          │
│ │                                                                      │
│ ◯ 10/11/2026 16:00 | Đổi trạng thái kiểm định chất lượng               │
│ │ Từ: PENDING_INSPECTION  -->  PASSED (Đạt tiêu chuẩn xuất kho)        │
│ │ Chứng chỉ kiểm định số: QC-8821/2026                                 │
│ │                                                                      │
│ ◯ 05/11/2026 10:00 | Nhập kho ban đầu                                  │
│   Chứng từ: NK-2026-00105  | Nhà cung cấp: Tập đoàn Bơm EBARA          │
│   Vị trí ban đầu: Kho Tổng / Khu Máy Lớn / Bệ 01                       │
└────────────────────────────────────────────────────────────────────────┘
```

- **Phân loại node**: nhập, xuất, chuyển kho; đổi chất lượng; ghi chú tay; sự kiện từ module khác (bảo dưỡng, bán hàng). Phân biệt bằng nhãn chữ và icon vector, màu lấy từ token chung.

---

### 3.9 Màn hình 9: Cải tiến Nhập Excel & Chế độ Nạp vị trí hàng loạt

#### A. Cải tiến Hộp thoại nạp chứng từ Excel hiện tại (`excel-import-dialog.tsx`)
- Thêm các cột mới vào bước Ghép cột (Column Mapping) và bảng Xem trước (Preview Grid):
  - Cột `Vị trí lưu trữ`: Tự động nhận diện chuỗi tự do, hỗ trợ ghép nhiều cột cấp độ (`Cấp 1`, `Cấp 2`...).
  - Cột `Cách theo dõi`: Nhận diện `NONE`, `LOT`, `SERIAL`.
  - Cột `Số serial`: Nhận danh sách serial phân tách bằng dấu chấm phẩy `;`.
  - Cột `Xử lý lô`: Cho phép chỉ định trước phương án xử lý trùng lô trong file.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Bảng xem trước dữ liệu nạp từ Excel (Dòng 1 - 10 / Tổng số 150 dòng)                  │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Dòng  Mã hàng   Tên hàng hóa   Vị trí            Số lô     Cách theo dõi   Cảnh báo │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ 1     MAT-001   Vòng bi 6205   Khu A / Kệ 03     L2401     Lô              Hợp lệ   │
│ 2     MAT-002   Phớt chắn dầu  Khu B / Ô 99      -         Số lượng        Hợp lệ   │
│ 3     MAT-003   Dây cu roa B52 (để trống)        L2402     Lô              Hợp lệ   │
│ 4     MAT-004   Bulong neo     Khu A             -         Số lượng        Nhà cung cấp chưa có trong danh mục │
└───────────────────────────────────────────────────────────────────────────────────────┘
* Vị trí là chữ tự do: không đối chiếu với vị trí đã có, ô trống nghĩa là không đổi.
```

#### B. Chế độ riêng: "Nhập Vị trí lưu trữ hàng loạt" (Bulk Storage Locations Import)
- Dành cho trường hợp thiết lập ban đầu (Go-live) hoặc quy hoạch lại kho cho hàng nghìn mã hàng mà không tạo giao dịch tăng/giảm số dư tồn kho.
- **Giao diện**: Modal kéo thả file Excel đơn giản gồm 3 cột: `Mã mặt hàng`, `Mã kho`, `Vị trí lưu trữ`. Có nút tải file mẫu `.xlsx`.

---

## 4. Bảng tổng hợp Component & File triển khai

| Màn hình / Tính năng | File mã nguồn dự kiến | Component thư viện sử dụng |
|---|---|---|
| Vị trí trong hồ sơ hàng hóa | `packages/features/inventory/src/lib/components/storage-location-panel.tsx` (đã có) | Ô nhập, nút chọn, `SearchableSelect` |
| Cấu hình Cấp vị trí Kho | `packages/features/inventory/src/lib/components/warehouse-editor.tsx` | `Form.List` (Antd) hoặc Dynamic inputs, `Switch` (shadcn) |
| Cột vị trí kiểm kê, đánh dấu dòng đổi vị trí | `packages/features/inventory/src/lib/components/stocktake-hub.tsx` (đã có) | Bảng hiện có |
| Phân loại theo dõi hàng hóa | `packages/features/inventory/src/lib/components/material-form.tsx` | `SearchableSelect` (`shared-ui`), `Tooltip`, `Alert` (shadcn) |
| Danh mục nhà cung cấp | `packages/features/inventory/src/lib/components/supplier-catalog-section.tsx` (đã có) | `SearchableSelect`, xác nhận xóa |
| Quản lý Lô & Dialog Trùng Lô | `packages/features/inventory/src/lib/components/lot-panel.tsx`, `lot-resolution-dialog.tsx` *(tạo mới)* | `RadioGroup`, `Dialog`, `Table` (shadcn + antd) |
| Timeline Nhật ký Vòng đời | `packages/features/inventory/src/lib/components/material-timeline-drawer.tsx` *(tạo mới)* | `Sheet` / `Drawer`, `Textarea`, `ScrollArea` (shadcn) |
| Nạp vị trí hàng loạt | `packages/features/inventory/src/lib/components/storage-location-bulk-import-dialog.tsx` (đã có) | `Dialog`, `CloseGuard` |

---

## 5. Danh mục kiểm tra nghiệm thu giao diện (UI Acceptance Criteria)

- [ ] **Accessibility & Keyboard Navigation**: Mọi modal và form có thể dùng phím `Tab`, `Enter` để submit và `ESC` để đóng (khi form chưa sửa đổi).
- [ ] **Nguyên tắc Click ra ngoài**: Không bao giờ tự ý đóng modal nhập liệu khi click nhầm ra ngoài vùng backdrop (tuân thủ mục 4.4 của `ui-design`).
- [ ] **Tuân thủ chuẩn Không Emoji**: Kiểm tra tự động bằng script `node tools/check-ui-rules.mjs` đảm bảo không có bất kỳ emoji nào lọt vào mã nguồn.
- [ ] **Chuẩn hóa Dropdown**: 100% các ô chọn sử dụng `SearchableSelect` có gõ tìm kiếm tiếng Việt không dấu/có dấu.
- [ ] **Độ mượt mà trên tỷ lệ 16:9**: Các bảng dữ liệu hiển thị tốt ở độ phân giải 1920x1080 và 1366x768, thanh cuộn nội bộ hover-reveal thanh lịch, không gây vỡ bố cục tổng thể của `ModuleShell`.
