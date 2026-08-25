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
3. **Typography & Spacing**:
   - Sử dụng font hệ thống hiện đại, dễ đọc, phân cấp h1, h2, h3, body, caption rõ ràng.
   - Spacing nhịp nhàng theo bội số 4px/8px (Tailwind standard).
