---
name: ui-design
description: "Quy chuẩn thiết kế giao diện UI/UX cho Enterprise Platform. Áp dụng shadcn/ui + Tailwind CSS cho hầu hết các UI component cơ bản, cài đặt component mới bằng 'pnpm dlx shadcn@latest add <component>', và sử dụng Ant Design (antd) cho các component phức tạp như Bảng (Table/Data Grid), Tree, Cascader. Tối ưu trải nghiệm cho tỉ lệ 16:9, Dark Enterprise Theme, responsive và accessibility."
---

# UI/UX Design & Component Guidelines

Tài liệu hướng dẫn và quy chuẩn thiết kế giao diện người dùng (UI/UX) cho toàn bộ hệ thống Enterprise Platform.

## 1. Công Nghệ Lõi (Core UI Stack)

Hệ thống tuân thủ kiến trúc phân tầng UI chuẩn:
- **shadcn/ui** (https://ui.shadcn.com/docs/components): Thư viện thành phần giao diện chính (Headless Radix UI + Tailwind CSS).
- **Tailwind CSS** (v4/v3): Khung tiện ích định kiểu (Styling & Design Tokens).
- **Ant Design (antd)** (https://ant.design/components/overview/): Dành cho các thành phần dữ liệu phức tạp (Table, Data Grid, Advanced Tree, Complex Forms, v.v.).

---

## 2. Quy Tắc Lựa Chọn Component

### 2.1 Thành phần cơ bản & tương tác: Ưu tiên `shadcn/ui` + `Tailwind CSS`
Sử dụng các component từ shadcn/ui cho hầu hết giao diện:
- **Layout & Containers**: `Card`, `Sheet` (Drawer), `Dialog` (Modal), `Tabs`, `Accordion`, `Separator`, `ScrollArea`.
- **Form Controls**: `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `Form`.
- **Navigation & Feedback**: `DropdownMenu`, `NavigationMenu`, `Breadcrumb`, `Pagination`, `Tooltip`, `Popover`, `Toast`/`Sonner`, `Alert`, `Badge`, `Progress`, `Skeleton`, `Avatar`.

#### Cách cài đặt component shadcn/ui khi chưa có:
```bash
pnpm dlx shadcn@latest add <component-name>
```
*Ví dụ phổ biến:*
```bash
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add dialog
pnpm dlx shadcn@latest add dropdown-menu
pnpm dlx shadcn@latest add select
pnpm dlx shadcn@latest add table
pnpm dlx shadcn@latest add sheet
pnpm dlx shadcn@latest add tabs
pnpm dlx shadcn@latest add badge
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add tooltip
```

### 2.2 Thành phần dữ liệu phức tạp: Sử dụng `Ant Design (antd)`
Đối với các trường hợp nghiệp vụ dữ liệu phức tạp mà shadcn/ui cơ bản không tối ưu hoặc mất nhiều thời gian tự dựng:
- **Table / Data Grid phức tạp**: Bảng có sorting nhiều cột, column resizing, filtering, fixed header/columns, expandable rows, tree-table, virtual scroll cho dữ liệu lớn.
- **Tree View nâng cao**: Kéo thả node, search node, checkable tree với tri-state.
- **Form phức tạp**: Form.List động, dynamic validation rules nhiều tầng.
- **Bộ lọc & chọn nâng cao**: `Cascader`, `Transfer`, `TreeSelect`, `DatePicker.RangePicker` với preset thời gian phức tạp.

#### Cài đặt và cấu hình Ant Design:
```bash
pnpm add antd @ant-design/icons
```
Sử dụng `ConfigProvider` của antd để đồng bộ design token (màu sắc primary, border-radius, font-family, dark mode) với Tailwind CSS và shadcn/ui.

---

## 3. Quy Chuẩn Bố Cục & Trải Nghiệm 16:9

1. **Master-Detail Split Grid**:
   - Tận dụng màn hình ngang 16:9 (1920×1080, 1600×900) với bố cục 2 cột (Cột trái ~40-46% Master list / Cột phải ~54-60% Detail & Action Console).
   - Vùng cuộn nội bộ độc lập (`height: calc(100vh - headerHeight)`) để tránh cuộn toàn trang.
2. **Enterprise Color Palette**:
   - Primary: Sapphire / Cobalt Blue (`#2563eb`, `#1d4ed8`).
   - Dark Accent: `#09192e` - `#0d223f` cho Sidebar và Header.
   - Statuses: Emerald (Thành công), Crimson (Lỗi/Khẩn cấp/SLA), Amber (Chờ duyệt), Violet (Khởi tạo).
---

## 4. Quy Chuẩn 3 Định Dạng Tương Tác (Interaction Formats)

Để đảm bảo trải nghiệm người dùng nhất quán giữa tất cả các module nghiệp vụ, toàn bộ các tác vụ tương tác dạng nổi/phụ trợ bắt buộc phải tuân theo 3 định dạng chuẩn sau:

### 4.1. Popconfirm (Xác nhận nhanh tại chỗ)
- **Mục đích**: Dùng cho các hành động nguy hiểm, có tính huỷ bỏ/đảo ngược hoặc ảnh hưởng trực tiếp đến trạng thái dòng công việc mà không cần nhập thêm thông tin phụ (VD: *Từ chối hồ sơ, Huỷ tác vụ, Xoá dữ liệu, Rút lại phê duyệt*).
- **Vị trí & Cơ chế**:
  - Xuất hiện ngay tại vị trí nút bấm (Popover anchored overlay), có tính toán vị trí thông minh (`placement: 'top' | 'bottom' | 'left' | 'right'`).
  - Không che khuất toàn bộ màn hình, có nút `Huỷ` (ghost) và nút `Xác nhận` (danger/primary/warning).
  - Tự động đóng khi người dùng click ra ngoài hoặc bấm `ESC`.
- **Quy tắc thiết kế**: Gọn gàng (chiều rộng ~240-280px), bao gồm: Icon cảnh báo ⚠️ + Tiêu đề ngắn gọn + Câu giải thích hậu quả hành động + 2 nút bấm thao tác.
- **Component dùng chung cho toàn hệ thống**: Sẵn sàng tại `@enterprise-platform/shared-ui` (`Popconfirm`).
  - Hỗ trợ `confirmInput`: Yêu cầu người dùng nhập chính xác chuỗi/mã xác nhận (VD: mã thiết bị cha khi node có chứa các node con) trước khi mở khoá nút bấm Xác nhận.
  ```tsx
  import { Popconfirm } from '@enterprise-platform/shared-ui';

  <Popconfirm
    title="Xoá vật tư này khỏi BOM?"
    description="Hành động này sẽ loại bỏ phụ tùng khỏi danh sách định mức."
    okText="Xoá"
    cancelText="Huỷ"
    okType="danger"
    placement="top"
    confirmInput={
      hasChildren
        ? { requiredText: asset.code, label: 'Nhập chính xác mã thiết bị để xác nhận:' }
        : undefined
    }
    onConfirm={() => handleDelete(item.id)}
  >
    <button type="button" className={styles.deleteBtn}>Xoá</button>
  </Popconfirm>
  ```

### 4.2. Drawer / Slide-in Panel (Ngăn kéo trượt bên hông)
- **Mục đích**: Dùng cho **"Hồ sơ & Không gian làm việc phụ trợ"** (Contextual Workspace & Archive) chứa dữ liệu đa chiều cần không gian dọc/ngang lớn mà người dùng vẫn muốn giữ ngữ cảnh màn hình hiện tại (VD: *Hồ sơ nhật ký làm việc, Trao đổi thảo luận (Chat/Comments), Tệp & Tài liệu đính kèm, Chi tiết lịch sử phiên bản, Hoạt động kiểm toán*).
- **Vị trí & Cơ chế**:
  - Trượt từ cạnh phải màn hình (`width: 580px - 720px`), có backdrop làm mờ nhẹ (`blur(4px)`).
  - Header cố định hiển thị Mã hồ sơ + Badge trạng thái + Tiêu đề + **Thanh Tab điều hướng nhanh** (nếu có nhiều phân khu dữ liệu).
  - Body có cuộn nội bộ độc lập (`overflow-y: auto`).
  - Đóng khi click nút `✕`, nút `Đóng` ở footer, hoặc click vào vùng backdrop bên ngoài.

### 4.3. Popup Form / Modal Dialog (Hộp thoại nhập liệu tập trung)
- **Mục đích**: Dùng cho các tác vụ **tạo mới / cập nhật có cấu trúc dữ liệu độc lập** cần sự tập trung cao độ của người dùng (VD: *Tạo mới quy trình/hồ sơ, Lập lịch bảo trì, Phân quyền nâng cao, Cấu hình thiết bị*).
- **Quy chuẩn Thiết kế Tối Giản (Minimal Popup Form Guidelines)**:
  - **Typography**:
    - Tiêu đề chính (`title`): `24px - 28px` (chuẩn `26px`), `font-weight: 700`, `color: #333333`.
    - Tiêu đề phụ (`subtitle`): `13.5px - 14px`, `color: #666666`, line-height `1.4`.
    - Nhãn trường (`label`): `14px`, `font-weight: 600`, `color: #333333`.
    - Chữ trong ô nhập (`input/select`): `15px - 16px`, `color: #333333`.
    - Dòng trợ giúp/gợi ý (`fieldHint`): `12px`, `color: #64748b`.
  - **Khoảng cách (Spacing)**:
    - Padding toàn bộ khung popup: `24px` (mobile: `18px`).
    - Khoảng cách giữa các hàng trường (`form gap`): `16px`.
    - Khoảng cách giữa label và input: `6px`.
    - Khoảng cách chân form (`formActions / popupFoot`): `margin-top: 18px`, `padding-top: 16px`, `border-top: 1px solid #e5e7eb`, `gap: 12px` giữa các nút.
  - **Bảng màu & Đường nét (Colors & Borders)**:
    - Nền form: Xám nhẹ tối giản (`#f5f5f5`).
    - Viền khung form & ô input: Xám trung tính (`#e0e0e0`, focus `#2563eb`).
    - Chữ văn bản chính: Xám đậm (`#333333`).
    - Bo góc (`border-radius`): `8px` cho khung form popup, `4px` cho các ô input, select và nút bấm (`button`).
    - Độ sâu (`box-shadow`): `0 4px 12px rgba(0, 0, 0, 0.1)`.
- **Thành phần & Nút bấm chuẩn**:
  - **Nút đóng (X)**: Góc trên bên phải, kích thước `32x32px`, hover chuyển nền xám nhạt (`#e5e5e5`), phím tắt `ESC`.
  - **Nút Submit chính** (`submitButton / primarySubmitBtn`): Nền xanh highlight (`#2563eb`, hover `#1d4ed8`), chữ trắng `color: #ffffff !important`, `font-weight: 700`, có spinner loading khi đang xử lý; khi `disabled` chuyển nền `#93c5fd` với chữ trắng rõ ràng.
  - **Nút Huỷ** (`cancelButton / actionGhost`): Outline style (`background: transparent`, `border: 1px solid #d1d5db`, `color: #4b5563`, hover `#e5e5e5`).
- **Hành vi & Tương tác (Behavior & Animation)**:
  - Backdrop mờ nền: `rgba(0, 0, 0, 0.45)` với `backdrop-filter: blur(4px)`.
  - Hiệu ứng mở mượt mà: `fadeIn` và `scaleIn` `0.2s cubic-bezier(0.16, 1, 0.3, 1)`.
  - Hỗ trợ đóng khi click ra ngoài backdrop hoặc bấm phím `ESC`.
  - Kiểm tra tính hợp lệ (Validation) đầy đủ trước khi kích hoạt `onSubmit`.
- **Responsive**:
  - Desktop: `max-width: 500px` (hoặc `640px` cho form 2 cột), căn giữa màn hình (centered).
  - Mobile (`<= 480px`): Chiều rộng 100% kèm margin 16px, nút bấm xếp dọc `100% width`.
- **Component dùng chung**: Sẵn sàng tại `@enterprise-platform/shared-ui` (`MinimalPopupForm`).

---

## 5. Quy Chuẩn Thiết Kế Cho Các Element Khác Ngoài Popup

Để toàn bộ ứng dụng đạt được sự đồng nhất và tối giản từ popup đến từng chi tiết màn hình, các element còn lại được quy chuẩn như sau:

### 5.1. Thanh điều hướng dọc (Rail Sidebar / Menubar)
- **Bảng màu**: Dark Navy phong cách Enterprise (`#091426` đến `#0d2450`), viền phân cách mờ `rgba(255, 255, 255, 0.08)`.
- **Khu vực chân Menubar (`railFoot`)**:
  - Đặt các nút điều hướng cốt lõi: **Nút "← Trang chủ"** và **Nút icon "Đăng xuất"** trên cùng một hàng ngang (`display: flex`, `align-items: center`, `gap: 0.45rem`).
  - **Nút Đăng xuất**: Dạng icon compact `34×34px`, border mờ đỏ cảnh báo nhẹ `rgba(239, 68, 68, 0.25)`, background `rgba(239, 68, 68, 0.08)`, chữ `#fca5a5`; khi hover chuyển sang nền đỏ mờ rõ nét và viền sáng hơn.
  - Không đặt nút đăng xuất hay quay về trang chủ trên TopBar để tránh phân mảnh trải nghiệm.

### 5.2. Bảng dữ liệu & Ma trận (Data Grid / Enterprise Table / Matrix)
- **Header & Ô góc cố định (`th.corner`)**:
  - Tích hợp cụm điều khiển lọc & tìm kiếm trực tiếp trong ô góc bảng (ngăn chặn toolbar chiếm diện tích dọc không cần thiết).
  - Bố cục 1 hàng linh hoạt: `[+ Thêm mới]` (nút compact `font-size: 0.74rem`, `padding: 0.3rem 0.6rem`) → `[Tìm kiếm...]` (input co giãn `flex: 1`) → `[📂 Tất cả nhóm]` (select dropdown tự động cắt chữ tràn).
- **Độ cao & Căn chỉnh hàng**:
  - Hàng tiêu đề ma trận phân tầng `depth` tự động, gộp ô bằng `rowSpan`.
  - Ô đầu dòng cố định (`stickyCell`) giữ nguyên `display: table-cell` để tránh hiện tượng lệch cột khi mở rộng / thu gọn tree.
  - Phân định rõ ràng màu sắc vai trò: `S` (Vàng nâu khởi tạo), `R` (Xanh biển xem xét), `E` (Cam thực thi), `C` (Tím kiểm soát), `A` (Cam đậm phê duyệt), `I` (Xám nhận thông tin).

#### 5.2.1. Cấu Trúc Bảng Dữ Liệu Chuẩn 3 Phần (Standard 3-Zone Enterprise Table):
Toàn bộ các bảng danh sách dữ liệu trong hệ thống được chuẩn hóa theo kiến trúc 3 phần rõ ràng:

1. **Header (Đầu bảng - Controls & Filters)**:
   - Chứa thanh công cụ điều khiển chức năng:
     - **Nút hành động đầu bảng**: `[+ Thêm mới]`, `[ Xuất Excel]`, `[ Đồng bộ]`...
     - **Ô tìm kiếm tức thời (Instant Search Box)**: Tìm theo mã/tên thực thể, có icon kính lúp `🔍`.
     - **Cụm bộ lọc đa tiêu chí (Filter Group)**: Dropdown loại hình, dropdown trạng thái, chọn khoảng ngày `Từ ngày → Đến ngày`.
     - **Nút đặt lại**: `[✕ Xoá bộ lọc]` dạng outline để đưa bảng về mặc định.
   - Hàng tiêu đề cột (`th`): Cố định tỷ lệ hoặc auto-fit, typography đậm (`font-size: 12-13px`, `font-weight: 700`, chữ hoa hoặc title-case).

2. **Body (Thân bảng - Data Rows & Row Actions)**:
   - Danh sách các dòng dữ liệu phẳng hoặc cây phân cấp.
   - **Tối ưu hiển thị**: Cột mã font Monospace, Badge phân loại màu sắc rõ nét, cột ngày tháng rõ ràng.
   - **Cột Thao tác riêng cho từng dòng (`Row Action Buttons`)**:
     - Đặt ở cột cuối cùng bên phải (`actionCell`).
     - Sử dụng các nút hành động dạng compact / icon gắn nhãn (VD: `⚡ Bảo trì ngay`, `🕒 Lịch sử`, `✕ Gỡ`, `✏️ Sửa`, `🗑️ Xoá`).
     - Sắp xếp dạng Flex Row ngang có `gap: 0.35rem`, không xếp dọc làm phình chiều cao dòng.
     - Khi click vào dòng: Hỗ trợ mở **Drawer** chi tiết trượt bên phải hoặc kích hoạt highlight dòng active (`tableRowActive`).

3. **Footer / End (Chân bảng - Pagination & Page Size chuẩn thống nhất)**:
   - Đặt cố định ở đáy bảng (`pagerRow` / `tableFooter`), nền xám sáng thanh nhã `#f8fafc`, viền ngăn cách trên `1px solid #e2e8f0`, `padding: 10px 14px`, `font-size: 12px`, `color: #64748b`.
   - **Bên trái (Left Info & Page Size)**:
     - Dòng thống kê: `Hiển thị [từ - đến] / [tổng số] [tên thực thể]` (VD: `Hiển thị 1–15 / 120 hồ sơ`).
     - Dropdown chọn số lượng hiển thị ngay cạnh: `Hiển thị: [15 | 30 | 45 | 60] / trang` (select compact `padding: 2px 8px`, `border: 1px solid #cbd5e1`, `border-radius: 4px`, `font-size: 11.5px`).
   - **Bên phải (Right Pager Controls)**:
     - Nhóm nút điều hướng phân trang: `[← Trước]` (nút outline bo góc `6px`, `padding: 4px 10px`, hover viền `#2563eb`) → `[Trang hiện tại / Tổng số trang]` (VD: `1 / 8`, `font-weight: 700`, `color: #0f172a`) → `[Sau →]`.
   - **Lợi ích trải nghiệm**: Giao diện cực kỳ gọn gàng, không bị rối bởi hàng loạt số trang dài dòng, trực quan trên mọi kích thước màn hình và tối ưu hiệu năng render.

### 5.3. Form & Ô nhập liệu trên trang chính (Page-level Forms & Controls)
- **Typography & Chiều cao**:
  - Nhãn (`label`): `14px`, `font-weight: 600`, màu `#334155`.
  - Chiều cao ô nhập (`input`, `select`): Chuẩn `38px - 42px`, `padding: 8px 12px`, `font-size: 14px - 15px`, `border: 1px solid #cbd5e1`, bo góc `4px - 6px`.
  - Khi focus: Viền `#2563eb` kèm vòng sáng nhẹ `box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15)`.
- **Khoảng cách chống chạm dính (Spacing & Layout)**:
  - Bố cục 2 cột cân xứng (`grid-template-columns: repeat(2, minmax(0, 1fr))`, `gap: 16px`).
  - Hàng nút hành động dưới form (`formActions`): Luôn có `margin-top: 18px`, `padding-top: 16px`, `border-top: 1px solid #e5e7eb` và `gap: 12px` giữa các nút bấm.

### 5.4. Thẻ thông tin & Khung tổng quan (Cards & Containers)
- **Nền & Viền**: Nền trắng `#ffffff`, viền xám mềm `#dbe3ed` hoặc `#e2e8f0`, bo góc `12px - 16px` (`0.75rem - 1rem`).
- **Độ sâu (Shadow)**: `0 1px 3px rgba(0, 0, 0, 0.04)` cho thẻ thường và `0 14px 35px rgba(23, 51, 93, 0.06)` cho các bảng tính lớn.
- **Tiêu đề thẻ (`cardHeader`)**: Flexbox ngang chứa tiêu đề `h2` (`20px - 22px`, `font-weight: 700`) và các nút hành động bổ trợ nằm bên phải.

### 5.5. Hệ thống Nút bấm (Button System)
- **Primary Button (Nút chính)**: `background: #2563eb`, hover `#1d4ed8`, `color: #ffffff !important`, `font-weight: 600 - 700`, bo góc `4px`, shadow `0 1px 3px rgba(37, 99, 235, 0.2)`.
- **Ghost / Outline Button (Nút phụ / Huỷ)**: `background: transparent`, `border: 1px solid #d1d5db`, `color: #4b5563`, hover chuyển nền `#e5e5e5` hoặc `#f1f5f9`.
- **Danger / Action Incident Button (Nút khẩn cấp / Sự cố)**: Nền đỏ `#c0392b` hoặc viền đỏ cảnh báo, font đậm, tách biệt khỏi các nút thao tác thông thường.

---

## 6. Tóm Tắt Ma Trận Áp Dụng Cho Các Module

| Trường hợp nghiệp vụ | Định dạng sử dụng | Thành phần UI đề xuất |
|---|---|---|
| Xác nhận Từ chối / Huỷ / Xoá | **Popconfirm** | Popover / Custom Popconfirm |
| Xem Nhật ký, Lịch sử, Trao đổi, Tệp hồ sơ | **Drawer** | Sheet (shadcn) / Drawer (antd) |
| Tạo mới hồ sơ / Form nhập liệu | **Minimal Popup Form** | `MinimalPopupForm` (@enterprise-platform/shared-ui) |
| Bảng ma trận ma trận RACI / Lịch bảo trì | **Matrix Data Grid** | Table Header đa tầng tích hợp bộ lọc góc `th.corner` |
| Điều hướng & Đăng xuất hệ thống | **Menubar Rail Foot** | Cặp nút Trang chủ + Icon Đăng xuất chân sidebar |
