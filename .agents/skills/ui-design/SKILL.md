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
  - Xuất hiện ngay tại vị trí nút bấm (Popover anchored overlay), có mũi tên định hướng (`arrow`).
  - Không che khuất toàn bộ màn hình, có nút `Huỷ` (ghost) và nút `Xác nhận` (danger/primary).
  - Tự động đóng khi người dùng click ra ngoài hoặc bấm Huỷ.
- **Quy tắc thiết kế**: Gọn gàng (chiều rộng ~240-280px), bao gồm: Icon cảnh báo ⚠️ + Tiêu đề ngắn gọn + Câu giải thích hậu quả hành động + 2 nút bấm thao tác.

### 4.2. Drawer / Slide-in Panel (Ngăn kéo trượt bên hông)
- **Mục đích**: Dùng cho **"Hồ sơ & Không gian làm việc phụ trợ"** (Contextual Workspace & Archive) chứa dữ liệu đa chiều cần không gian dọc/ngang lớn mà người dùng vẫn muốn giữ ngữ cảnh màn hình hiện tại (VD: *Hồ sơ nhật ký làm việc, Trao đổi thảo luận (Chat/Comments), Tệp & Tài liệu đính kèm, Chi tiết lịch sử phiên bản, Hoạt động kiểm toán*).
- **Vị trí & Cơ chế**:
  - Trượt từ cạnh phải màn hình (`width: 580px - 720px`), có backdrop làm mờ nhẹ (`blur(4px)`).
  - Header cố định hiển thị Mã hồ sơ + Badge trạng thái + Tiêu đề + **Thanh Tab điều hướng nhanh** (nếu có nhiều phân khu dữ liệu).
  - Body có cuộn nội bộ độc lập (`overflow-y: auto`).
  - Đóng khi click nút `✕`, nút `Đóng` ở footer, hoặc click vào vùng backdrop bên ngoài.

### 4.3. Popup Form / Modal Dialog (Hộp thoại nhập liệu tập trung)
- **Mục đích**: Dùng cho các tác vụ **tạo mới / cập nhật có cấu trúc dữ liệu độc lập** cần sự tập trung cao độ của người dùng (VD: *Tạo mới quy trình/hồ sơ, Phân quyền nâng cao, Cấu hình thiết bị, Popup chọn người nhận việc phức tạp*).
- **Vị trí & Cơ chế**:
  - Nằm giữa màn hình (Center Modal), độ rộng quy chuẩn: `Small: 480px`, `Medium: 640px`, `Large: 800px`, `Extra Large: 1000px`.
  - Có Backdrop làm tối màn hình nền.
  - Phân vùng rõ ràng: **Header (Tiêu đề + Mô tả)** - **Body (Form inputs với validation)** - **Footer (Hàng nút Huỷ & Lưu/Gửi cố định)**.
  - Hỗ trợ phím tắt `Esc` để đóng và `Ctrl+Enter` để submit nhanh.

---

## 5. Tóm Tắt Ma Trận Áp Dụng Cho Các Module

| Trường hợp nghiệp vụ | Định dạng sử dụng | Thành phần UI đề xuất |
|---|---|---|
| Xác nhận Từ chối / Huỷ / Xoá | **Popconfirm** | Popover / Custom Popconfirm |
| Xem Nhật ký, Lịch sử, Trao đổi, Tệp hồ sơ | **Drawer** | Sheet (shadcn) / Drawer (antd) |
| Tạo mới hồ sơ / Form nhập liệu nhiều trường | **Popup Form** | Dialog (shadcn) / Modal (antd) |
| Phân rã công việc & Thao tác duyệt chính | **Inline Action Console** | Master-Detail Panel (Cột phải) |
