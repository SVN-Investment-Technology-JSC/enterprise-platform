# Báo cáo Phân tích UX: Hành vi Click Ra Ngoài và Quy chuẩn Thiết kế Form Nhập liệu (Modal & Drawer)

Trạng thái: **Đã phân tích - Đề xuất áp dụng vào Quy chuẩn UI/UX hệ thống**.  
Phạm vi: Toàn bộ hệ thống Enterprise Platform, trọng tâm là phân hệ Kho (`inventory`) và các form nhập liệu nghiệp vụ (CRM, HRM, Finance, Workspace).  
Case study: **Phản hồi người dùng trên màn hình Tạo hàng hóa:** *"click chuột ngoài -> mất luôn cửa sổ làm việc"*.

---

## 1. Tóm tắt Sự cố & Bối cảnh Thực tế

* **Hiện tượng**: Khi người dùng đang nhập dữ liệu trong hộp thoại **"Tạo hàng hóa"** (gồm 9 trường: Mã, Tên, Barcode, Nhóm, Phân loại, Đơn vị, Cách sử dụng, Giá bán, Mô tả), chỉ cần vô tình hoặc cố ý nhấp chuột ra ngoài khung viền trắng (vùng nền tối `modalOverlay`), hộp thoại lập tức biến mất không một dấu vết.
* **Hậu quả**:
  1. Toàn bộ thông tin người dùng đang gõ dở bị dọn sạch (`state reset`), không thể phục hồi.
  2. Người dùng rơi vào trạng thái hoang mang, hiểu lầm rằng phần mềm bị lỗi ("bug"), bị crash/văng cửa sổ.
  3. Gây ức chế tâm lý nặng nề, làm chậm tiến độ nhập liệu danh mục hàng hóa của doanh nghiệp.

---

## 2. Phân tích Thói quen & Mô hình Tâm lý Người dùng (User Mental Model)

Tại sao người dùng lại click chuột ra ngoài cửa sổ popup? Phân tích hành vi văn phòng cho thấy 4 lý do chính:

### 2.1. Thói quen "Bỏ Focus" (Unfocus / Blur) và đóng Dropdown
* Sau khi nhập xong một trường văn bản hoặc vừa chọn xong một giá trị từ `SearchableSelect`, người dùng văn phòng có phản xạ tự nhiên là **nhấp chuột vào một khoảng trống trên màn hình** để:
  * Đóng menu dropdown đang bung ra.
  * Ẩn con trỏ chuột nhấp nháy khỏi ô input.
* Với trang web thông thường (Web đọc báo, blog, xem ảnh), click ra ngoài là cách tiện nhất để đóng lightbox/banner quảng cáo. Tuy nhiên, khi sang phần mềm nghiệp vụ, thói quen tay này biến thành "cái bẫy" xóa sạch dữ liệu của họ.

### 2.2. Nhu cầu nhìn đối chiếu dữ liệu nền phía sau
* Khi tạo một mặt hàng mới, người dùng thường không nhớ hết quy cách đặt tên, mã hàng trước đó hay đơn vị tính chuẩn của công ty.
* Họ nhìn xuyên qua lớp nền mờ tối (`backdrop`) để đối chiếu bảng danh sách phía sau. Trong lúc quan sát và suy nghĩ, ngón tay thường click chuột vô thức lên màn hình.

### 2.3. Thao tác trượt tay (Misfire / Accidental Click)
* Một form nhập liệu trên màn hình laptop có diện tích tương đối hẹp so với độ phân giải màn hình. Khi người dùng rê chuột qua lại giữa các ô hoặc di chuyển chuột để với lấy tài liệu giấy bên cạnh, việc click chệch 1–2 pixel ra khỏi viền trắng là việc xảy ra liên tục hàng ngày.

### 2.4. Sự xung đột giữa Kỳ vọng (Expectation) và Thực tế (Reality)
* **Kỳ vọng của người dùng**: Form nhập liệu là một **"Không gian làm việc tạm thời" (Work in Progress)**. Họ cho rằng chỉ khi họ bấm nút màu đỏ/nút chữ rõ ràng như **[Huỷ]** hoặc nút dấu **[X]** ở góc thì công việc mới bị hủy.
* **Thực tế hệ thống xử lý**: Coi cú click ra ngoài tương đương với lệnh "Tôi muốn hủy hết và đóng ngay lập tức".

---

## 3. Nguyên nhân Kỹ thuật trong Codebase

Kiểm tra mã nguồn tại `packages/features/inventory/src/lib/components/trade-item-form-dialog.tsx` (dòng 89):

```tsx
// packages/features/inventory/src/lib/components/trade-item-form-dialog.tsx
return (
  <div className={styles.modalOverlay} onClick={onCancel}> {/* ❌ Gán trực tiếp onClick vào lớp nền */}
    <div
      className={styles.modalDialog}
      style={{ maxWidth: '620px' }}
      role="dialog"
      aria-modal="true"
      onClick={(event) => event.stopPropagation()}
    >
```

Sự kiện `onClick={onCancel}` được gắn trực tiếp vào toàn bộ lớp phủ `modalOverlay`. Khi người dùng click ra ngoài, sự kiện kích hoạt hàm `onCancel()`, đóng component và hủy toàn bộ React state.

Rà soát rộng hơn: 17 file trong phân hệ Kho dùng `modalOverlay` (khoảng 20 chỗ gắn `onClick` đóng). Chưa thấy phân hệ khác dùng lớp này. Chia theo loại:

| Loại | Dialog | Xử lý |
| :--- | :--- | :--- |
| **Nhập liệu (cần bảo vệ)** | `trade-item-form-dialog`, `asset-form`, `material-form`, `movement-form` (modal chính), `custody-assign-dialog`, `custody-declare-dialog`, `incident-record-dialog`, `install-material-dialog`, `return-to-stock-dialog`, `bulk-return-dialog`, `batch-requisition-modal`, `excel-import-dialog`, `trade-item-import-dialog`, `item-catalog` (sửa mặt hàng), `lot-panel` (sửa lô), lô trong `movement-form` | Bỏ đóng khi click nền, hỏi xác nhận khi có thay đổi |
| **Chỉ xem** | modal QR (`asset-detail`, `item-catalog`), `asset-list-modal` | Giữ đóng khi click nền và `ESC` |

---

## 4. Quy chuẩn UX Chuẩn ngành cho Phần mềm Doanh nghiệp (Enterprise Standards)

Theo quy chuẩn của các Design System hàng đầu (Ant Design, SAP Fiori, Salesforce Lightning, shadcn/ui):

### 4.1. Phân loại Modal rõ ràng
| Loại Modal | Mục đích | Click ra ngoài (Backdrop click) | Phím Esc |
| :--- | :--- | :---: | :---: |
| **Modal Xem (Informational)** | Xem ảnh, xem chi tiết nhanh, xem thông báo | **Cho phép đóng** (`maskClosable: true`) | Cho phép đóng |
| **Modal Nhập liệu (Data Entry / Form)** | Tạo mới, chỉnh sửa, phiếu nhập xuất, báo giá | **TUYỆT ĐỐI CẤM ĐÓNG** (`maskClosable: false`) | Chưa thay đổi: đóng; đã thay đổi: không đóng im lặng (hỏi xác nhận qua nút Huỷ/X) |

### 4.2. Quy tắc 1: Khóa sự kiện đóng khi click ra ngoài (`Disable Backdrop Click`)
* Toàn bộ form có từ 2 trường nhập liệu trở lên: **Không đóng khi click ra ngoài lớp nền**.
* Người dùng chỉ có thể thoát form bằng cách bấm nút **[Huỷ]** hoặc nút **[X]**.

### 4.3. Quy tắc 2: Cảnh báo khi có dữ liệu chưa lưu (`Dirty Form Guard`)
* `isDirty` là **so với giá trị ban đầu** (form sửa có sẵn dữ liệu thì không coi là dirty nếu chưa đổi gì), tính cả `SearchableSelect`, tệp đã chọn và dòng chi tiết.
* Khi `isDirty = true`, bấm **[Huỷ]** hoặc **[X]** hiện **`Popconfirm`** của `@enterprise-platform/shared-ui` (không dùng `window.confirm`):
  > Tiêu đề: *"Đóng và bỏ thay đổi?"* · Mô tả: *"Thông tin vừa nhập chưa được lưu và sẽ bị mất."* · Nút: *"Tiếp tục nhập"* / *"Đóng và bỏ"*.
* `Popconfirm` bám theo nút nên không mở được bằng `ESC`; khi dirty, `ESC` không đóng form.
* Đang gửi (`busy`) thì không cho đóng.
* Rời hẳn trang (tải lại, đóng tab, Back) khi dirty: dùng thông báo của trình duyệt qua `beforeunload`.
* Quy tắc đầy đủ nằm ở `.agents/skills/ui-design/SKILL.md`, mục 4.4.

### 4.4. Quy tắc 3: Hiệu ứng phản hồi thị giác (Shake Animation)
* Khi người dùng click vào vùng nền ngoài modal nhập liệu:
  * Không đóng popup.
  * Khung modal rung nhẹ (Shake animation) hoặc nhấp nháy viền để báo hiệu: *"Cửa sổ này đang mở, vui lòng hoàn tất hoặc bấm nút Hủy để đóng"*.

---

## 5. Phương án Kỹ thuật Khắc phục

### 5.1. Khắc phục ngay lập tức (Áp dụng cho `TradeItemFormDialog` và các Modal tương tự)

Xóa bỏ `onClick={onCancel}` trên `styles.modalOverlay`:

```tsx
// packages/features/inventory/src/lib/components/trade-item-form-dialog.tsx
// TRƯỚC:
<div className={styles.modalOverlay} onClick={onCancel}>

// SAU:
<div className={styles.modalOverlay}>
  <div
    className={styles.modalDialog}
    style={{ maxWidth: '620px' }}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
```

### 5.2. Bổ sung kiểm tra dữ liệu chưa lưu trước khi đóng

Dùng hook dùng chung (dự kiến đặt ở `@enterprise-platform/shared-ui`) để tránh mỗi dialog tự viết:

```tsx
// useDirtyGuard(dirty): đăng ký beforeunload khi dirty, gỡ khi hết dirty hoặc unmount
// CloseGuard: bọc nút Huỷ/X; dirty thì dùng Popconfirm, chưa dirty thì đóng ngay

<CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
  <button type="button" className={styles.cancelButton}>Huỷ</button>
</CloseGuard>
```

Trong `TradeItemFormDialog`: `isDirty` so sánh các trường (mã, tên, barcode, nhóm, phân loại, đơn vị, cách sử dụng, giá bán, mô tả) với giá trị ban đầu; nút `X` và `Huỷ` đều bọc `CloseGuard`; lớp nền không có `onClick`; phím `ESC` không đóng khi dirty.

### 5.3. Hướng phát triển dài hạn: Chuyển đổi Form nhập liệu lớn sang Drawer (Ngăn kéo)
* Đối với danh mục Hàng hóa, Khách hàng, Báo giá:
  * Thay vì modal popup nằm chính giữa che khuất toàn bộ màn hình, chuẩn thiết kế khuyến nghị là dùng **Drawer (Sheet)** trượt từ cạnh phải màn hình sang.
  * Ưu điểm:
    1. Người dùng vừa thấy bảng dữ liệu bên trái để tra cứu đối chiếu, vừa gõ form bên phải.
    2. Chiều dọc vô tận (cuộn form dễ dàng khi có nhiều trường).
    3. Tránh hoàn toàn lỗi vô tình click ra ngoài làm mất form.

---

## 6. Kế hoạch Hành động (Action Items)

| STT | Việc cần làm | Phạm vi | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **1** | Bỏ `onClick={onCancel}` ở lớp nền `modalOverlay` của `TradeItemFormDialog` | `packages/features/inventory/src/lib/components/trade-item-form-dialog.tsx` | **P0 (Làm ngay)** |
| **2** | Tạo `useDirtyGuard` và `CloseGuard` dùng chung, kèm test | `packages/shared/ui` | **P0** |
| **3** | Áp dụng cho các dialog nhập liệu trong bảng ở mục 3 (bỏ `onClick` đóng ở lớp nền, bọc nút đóng bằng `CloseGuard`); giữ nguyên modal chỉ xem | `packages/features/inventory/src/lib/components/*.tsx` | **P1** |
| **4** | Cập nhật quy tắc vào `.agents/skills/ui-design/SKILL.md` (đã làm, mục 4.4) rồi chạy `node tools/sync-agent-skills.mjs` | `.agents/skills/ui-design/` | **P1** |
| **5** | Lên kế hoạch chuyển các form tạo mới phức tạp sang Drawer nhập liệu (cũng không đóng khi click nền) | Kho và Bán hàng (CRM) | **P2** |

