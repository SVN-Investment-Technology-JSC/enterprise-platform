# Phân tích Nhu cầu Phê duyệt Nhanh — Toàn bộ Module Hiện có & Đề xuất Hợp đồng Mở rộng

> **Mã tài liệu:** SPEC-TASK-MODULE-ANALYSIS-05  
> **Thuộc kế hoạch:** [README.md](./README.md)  
> **Liên quan:**  
> - [01_APPROVAL_CONTRACT_SPEC.md](./01_APPROVAL_CONTRACT_SPEC.md) — Hợp đồng hiện tại  
> - [02_UNIVERSAL_TASK_DRAWER_SPEC.md](./02_UNIVERSAL_TASK_DRAWER_SPEC.md) — Đặc tả Drawer  
> - [04_QUICK_APPROVAL_AUDIT_TRAIL_AND_ENTITLEMENT_PLAN.md](./04_QUICK_APPROVAL_AUDIT_TRAIL_AND_ENTITLEMENT_PLAN.md) — Kiến trúc tổng thể  
> **Trạng thái:** Dự thảo phân tích — chờ phê duyệt kiến trúc

---

## 1. Mục tiêu Phân tích

Trước khi quyết định phương án xử lý PE trong Universal Task Drawer, cần **khảo sát toàn bộ module hiện có** về nhu cầu phê duyệt nhanh, nhằm:

1. Tránh thiết kế đặc thù cho PE mà sau đó các module khác lại cần điều chỉnh tương tự.
2. Xác định đúng điểm cần mở rộng trong hợp đồng (`contracts-task-approval`) thay vì vá từng module.
3. Đảm bảo quy tắc: **Module mới chỉ implement adapter — không bao giờ phải sửa Core Drawer**.

---

## 2. Bản đồ Thực thể Phê duyệt theo Module

### 2.1. Module HRM — Đã tích hợp (`HrmTaskApprovalService`)

| Loại đơn | `entityType` | Dữ liệu cốt lõi | Actions | Đặc điểm |
|---|---|---|---|---|
| Nghỉ phép | `LEAVE_REQUEST` | Loại phép, từ ngày–đến ngày, số ngày, lý do | APPROVE / REJECT | Đơn tĩnh |
| Làm thêm giờ | `OT_REQUEST` | Ngày, giờ bắt đầu–kết thúc, số phút, lý do | APPROVE / REJECT | Đơn tĩnh |
| Công tác | `BUSINESS_TRIP_REQUEST` | Địa điểm, từ ngày–đến ngày, số ngày, lý do | APPROVE / REJECT | Đơn tĩnh |
| Giải trình công | `ATTENDANCE_CORRECTION` | Ngày, giờ vào–ra đề nghị, giờ cũ, lý do | APPROVE / REJECT | Đơn tĩnh |
| Đổi ca | `SHIFT_CHANGE_REQUEST` | Ngày làm, lý do | APPROVE / REJECT | Đơn tĩnh |
| Tạm ứng lương | `SALARY_ADVANCE_REQUEST` | Số tiền, số kỳ trả, lý do | APPROVE / REJECT | Có tiền |
| Đơn tùy chỉnh | `CUSTOM_REQUEST` | Tên loại, dữ liệu form động (`fields`) | APPROVE / REJECT | Form động nhẹ |

**Nhận xét:** Đơn HRM là đơn tĩnh — dữ liệu khóa ngay khi nộp, cấu trúc cố định, duyệt 1 chiều.

---

### 2.2. Module Procedure Engine (PE) — Đã tích hợp (`ProcedureTaskApprovalService`)

PE là module duy nhất có bước vừa là "Phê duyệt", vừa là "Tác nghiệp":

| Vai trò RACI | Ý nghĩa nghiệp vụ | Action PE thực tế | Bản chất tác vụ |
|---|---|---|---|
| **S** (Initiator) | Người mở hồ sơ điền form ban đầu và gửi đi | `complete` | **EXECUTION** — Điền form bắt buộc |
| **R** (Responsible) | Người chịu trách nhiệm tổng thể bước | `complete` | **EXECUTION** |
| **E** (Executor) | Người làm việc thực tế, tải chứng từ, checklist subtasks | `complete` | **EXECUTION** — Cần upload, checklist |
| **C** (Consulted) | Người cho ý kiến chuyên môn | `approve` + `return` | **DECISION** |
| **A** (Approver) | Người ra quyết định cuối | `approve` + `reject` + `return` | **DECISION** |
| **I** (Informed) | Theo dõi tiến độ | không có action | Không phải tác vụ |

**Dữ liệu PE chưa đưa vào Drawer (lỗi hiện tại):**

| Nguồn dữ liệu | Chứa gì | Đã map? |
|---|---|---|
| `instance.attributeValues` | Toàn bộ giá trị đã điền (số tiền, nhà cung cấp, lý do...) | CHƯA |
| `instance.flow?.attributes` | Schema định nghĩa các trường cấp quy trình | CHƯA |
| `step.attributes` | Schema định nghĩa các trường cấp bước | CHƯA |
| `instance.subtasks` | Danh sách đầu việc con của bước E | CHƯA |
| `authorization?.editableAttributeKeys` | Trường nào người dùng được điền ngay | CHƯA DÙNG |

---

### 2.3. Module Kho (Inventory) — Chưa tích hợp

| Thực thể | Trạng thái phê duyệt | Dữ liệu cốt lõi | Actions | Ghi chú |
|---|---|---|---|---|
| `InventoryTransaction` (Phiếu xuất/nhập/chuyển) | `WorkflowStatus`: PENDING → APPROVED / REJECTED | Mã phiếu, loại, kho, vật tư, số lượng, đơn giá | APPROVE / REJECT | Cần `blocks.table` |
| `InventoryAdjustment` (Điều chỉnh tồn) | PENDING → APPROVED / REJECTED | Kho, vật tư, số lượng hệ thống vs thực tế | APPROVE / REJECT | — |
| `StocktakeSession` (Phiên kiểm kê) | `PENDING_APPROVAL` → APPROVED / POSTED | Mã phiên, kho, bảng chênh lệch nhiều dòng | APPROVE / REJECT | Cần bảng kê |

**Đặc điểm:** Tất cả là DECISION. Người duyệt phiếu xuất kho cần thấy rõ vật tư, số lượng, tồn khả dụng.

---

### 2.4. Module Tài chính (Finance) — Chưa tích hợp

| Thực thể | Trạng thái | Dữ liệu cốt lõi | Actions | Ghi chú |
|---|---|---|---|---|
| Phiếu chi (PAYMENT) | PENDING → APPROVED / REJECTED / RETURNED | Nội dung, tổng tiền, tài khoản, người thụ hưởng, dòng chi tiết | APPROVE / REJECT / RETURN | Mode: DIRECT hoặc PROCEDURE |
| Phiếu thu (RECEIPT) | PENDING → APPROVED | Nội dung, tổng tiền, đối tượng nộp | APPROVE / REJECT / RETURN | — |
| Lệnh chuyển tiền (TRANSFER) | PENDING → APPROVED | TK nguồn → TK đích, số tiền | APPROVE / REJECT / RETURN | — |

**Đặc điểm Finance — 3 chế độ duyệt:**
- `DIRECT`: Kế toán lập xong → Cấp trên duyệt qua Drawer (Finance Adapter).
- `PROCEDURE`: Phiếu đi qua PE trước. Finance Adapter không cần vì PE đã xử lý.
- `INHERITED`: Phiếu tạo từ bước PE. Kế toán chỉ ghi sổ — không duyệt qua Drawer.

Finance có `attachments[]` (hoá đơn) và `lines[]` (dòng chi tiết) → cần `blocks.table` + `blocks.attachments`.

---

### 2.5. Module Bảo trì (Maintenance) — Không có approval nội bộ

Maintenance không có luồng phê duyệt riêng. Mọi phê duyệt đều qua PE (`MaintenanceOccurrence.procedureInstanceId`).
Status flow nội bộ không có trạng thái PENDING/APPROVED.

**Kết luận:** Tự động hưởng lợi khi PE Drawer hoàn thiện. Không cần adapter riêng.

---

### 2.6. Module CRM, Workspace — Chưa có nhu cầu

- CRM: Tương lai có thể: Duyệt Hợp đồng, Duyệt Báo giá.
- Workspace: Công việc duyệt qua PE vai A. Không có luồng approval nội bộ riêng.

---

## 3. Ma trận Phân loại Tác vụ theo Module

| Module | Loại tác vụ | Cần nhập liệu? | Cần bảng kê? | Cần tệp đính kèm? | Bản chất |
|---|---|---|---|---|---|
| HRM (tất cả) | Đơn tĩnh | Không | Không | Không | DECISION |
| PE vai A/C | Phê duyệt quy trình | Không | Hiếm | Cần xem chứng từ | DECISION |
| **PE vai S/E/R** | **Nhập liệu / Thực thi** | **Bắt buộc** | Có thể (subtasks) | Cần tải lên | **EXECUTION** |
| Inventory (tất cả) | Duyệt phiếu kho / kiểm kê | Không | Bắt buộc | Không | DECISION |
| Finance DIRECT | Duyệt phiếu chi/thu | Không | Bắt buộc | Cần xem hóa đơn | DECISION |
| Finance PROCEDURE | Ủy quyền PE xử lý | — | — | — | — (qua PE) |
| Maintenance | Không có approval nội bộ | — | — | — | — (qua PE) |
| CRM (tương lai) | Duyệt hợp đồng / báo giá | Không | Có thể | Cần xem tài liệu | DECISION |

---

## 4. Phát hiện: 3 Nhóm Tác vụ Khác nhau về Bản chất

### Nhóm 1 — DECISION (Phê duyệt Ra quyết định)

Dữ liệu đã đầy đủ và khóa. Người xem chỉ cần đọc rồi Đồng ý / Từ chối / Trả lại.

- Module: HRM, PE vai A/C, Inventory, Finance DIRECT.
- Ứng xử Drawer: Hiển thị đầy đủ context; nút APPROVE / REJECT / RETURN.

### Nhóm 2 — EXECUTION (Thực thi Công việc)

Bước yêu cầu người dùng hành động tích cực: điền form, tải file, đánh dấu checklist.

- Module: PE vai S (điền form khởi tạo), PE vai E (hoàn thành công việc, tải chứng từ).
- Ứng xử Drawer: Hiển thị `blocks.notice` mô tả "cần làm gì" + nút điều hướng "Mở biểu mẫu". **Không hiển thị nút "Phê duyệt"** để tránh thao tác sai nghiệp vụ.

### Nhóm 3 — RECORDING (Ghi nhận Nghiệp vụ Chuyên ngành) — Tương lai

Người dùng phải điền thông tin chuyên ngành phức tạp (tài khoản ngân hàng, mã hạch toán, tỷ lệ thuế VAT).

- Module: Finance (lập phiếu chi mới từ Drawer — chưa cần trong v1).
- Ứng xử Drawer: Tóm tắt + dẫn vào form chuyên biệt trong module.

---

## 5. Vấn đề Gốc rễ với Hợp đồng Hiện tại

### 5.1. `TaskActionType` thiếu ngữ nghĩa `COMPLETE`

```typescript
// Hiện tại — không đủ
type TaskActionType = 'APPROVE' | 'REJECT' | 'RETURN';
```

Thiếu `COMPLETE` để mô tả "Hoàn thành công việc" (PE vai S/E/R). Nếu dùng `APPROVE` thay thế:
- Nhãn nút sai: "Phê duyệt" nhưng người dùng đang hoàn thành bước nhập liệu của chính mình.
- Hiểu nhầm nghiệp vụ: Người khởi tạo hồ sơ không phải người phê duyệt hồ sơ của chính mình.

### 5.2. Thiếu trường phân loại bản chất tác vụ

Không có field nào cho phép module khai báo "đây là bước tác nghiệp, không phải bước phê duyệt".

**Nguyên tắc:** Module biết rõ nhất bản chất tác vụ của mình. Module phải khai báo tường minh.
Nếu Core Drawer tự suy luận (ví dụ từ `availableActions`), logic đó sẽ bị rò vào Core và khó bảo trì.

### 5.3. Thiếu `blocks.notice` — Không có cơ chế chuẩn để thông báo "cần điều hướng"

Khi bước là EXECUTION, Drawer cần hiển thị thông báo có cấu trúc kèm nút điều hướng.
Không có block chuẩn hóa cho trường hợp này; mỗi module sẽ phải tự giải quyết theo cách riêng.

---

## 6. Đề xuất Mở rộng Hợp đồng — 3 Thay đổi Nhỏ, Hiệu quả Lớn

> **Nguyên tắc thiết kế:** Module khai báo `taskNature` và `blocks.notice`.
> Core Drawer render tương ứng. Core KHÔNG có logic suy luận từ `sourceModule`.

### 6.1. Thêm `taskNature` vào `UniversalTaskDto`

```typescript
/**
 * Bản chất của tác vụ — quyết định cách Universal Task Drawer ứng xử.
 * Module PHẢI khai báo tường minh; Drawer KHÔNG tự suy luận.
 *
 * - DECISION:  Đọc và ra quyết định. Mặc định khi không khai báo.
 * - EXECUTION: Phải hành động tích cực (điền form, checklist, upload).
 * - RECORDING: Ghi nhận nghiệp vụ chuyên ngành (chưa dùng trong v1).
 */
export type TaskNature = 'DECISION' | 'EXECUTION' | 'RECORDING';

// Thêm vào UniversalTaskDto:
taskNature?: TaskNature; // mặc định 'DECISION' khi vắng mặt
```

### 6.2. Thêm `COMPLETE` vào `TaskActionType`

```typescript
export type TaskActionType =
  | 'APPROVE'    // Phê duyệt / Đồng ý (vai A, C, LOCAL)
  | 'REJECT'     // Từ chối — bắt buộc lý do
  | 'RETURN'     // Yêu cầu làm lại — bắt buộc lý do
  | 'COMPLETE';  // Hoàn thành công việc / Nộp bước (vai S, E, R trong PE)
```

Quy tắc nhãn nút trong `TaskActionFooter`:

| Action | Nhãn mặc định | Màu |
|---|---|---|
| APPROVE | "Phê duyệt" | Xanh lá (success) |
| REJECT | "Từ chối..." | Đỏ (danger) |
| RETURN | "Yêu cầu bổ sung..." | Cam (warning) |
| COMPLETE | "Hoàn thành" | Xanh dương (primary) |

### 6.3. Thêm `blocks.notice` vào `TaskRenderingBlocks`

```typescript
/**
 * Khối Thông báo Hướng dẫn — hiển thị nổi bật ở đầu thân Drawer.
 * Dùng khi tác vụ cần người dùng điều hướng sang module để thực hiện.
 */
export interface TaskNoticeBlock {
  tone: 'info' | 'warning' | 'success' | 'danger';
  title: string;        // "Bước này yêu cầu thực thi công việc"
  body: string;         // Mô tả chi tiết những gì cần làm
  actionLabel?: string; // "Mở biểu mẫu thực thi"
  actionUrl?: string;   // Deep link vào bước cụ thể trong module
}

export interface TaskRenderingBlocks {
  notice?: TaskNoticeBlock;    // Hiển thị đầu tiên, trước summary
  summary?: TaskSummaryBlock;
  attributes?: TaskAttributesBlock;
  table?: TaskTableBlock;
  attachments?: TaskAttachmentsBlock;
  timeline?: TaskTimelineBlock;
}
```

---

## 7. Ví dụ Khai báo theo Module

### HRM — Không thay đổi (DECISION)
```typescript
{ taskNature: 'DECISION', availableActions: ['APPROVE', 'REJECT'], blocks: { summary, attributes, timeline } }
```

### PE vai A/C — Thêm dữ liệu thuộc tính (DECISION)
```typescript
{
  taskNature: 'DECISION',
  availableActions: ['APPROVE', 'REJECT', 'RETURN'],
  blocks: {
    summary,
    attributes: { items: [ /* attributeValues đã format: số tiền, nhà cung cấp, lý do... */ ] },
    attachments: { files: [ /* chứng từ đính kèm */ ] },
    timeline,
  },
}
```

### PE vai S/E/R — Bước nhập liệu (EXECUTION)
```typescript
{
  taskNature: 'EXECUTION',
  availableActions: ['COMPLETE'],
  blocks: {
    notice: {
      tone: 'info',
      title: 'Bước này yêu cầu thực thi công việc',
      body: 'Điền thông tin biểu mẫu và tải tệp chứng từ đính kèm trước khi chuyển bước tiếp.',
      actionLabel: 'Mở biểu mẫu thực thi',
      actionUrl: `/modules/procedure#workspace/${instanceId}`,
    },
    summary,
    // attributes: các trường của bước trước để người thực thi tham chiếu
    timeline,
  },
}
```

### Inventory — Phiếu xuất kho (DECISION + bảng kê)
```typescript
{
  taskNature: 'DECISION',
  availableActions: ['APPROVE', 'REJECT'],
  blocks: {
    summary: { items: [{ label: 'Kho', value: warehouseName }, { label: 'Tổng dòng', value: `${lines.length} dòng` }] },
    table: {
      title: 'Danh sách vật tư xuất kho',
      columns: [
        { key: 'materialCode', title: 'Mã VT' },
        { key: 'materialName', title: 'Tên vật tư' },
        { key: 'quantity', title: 'Số lượng', align: 'right' },
        { key: 'available', title: 'Tồn khả dụng', align: 'right' },
      ],
      rows: lines.slice(0, 20).map(/* ... */),
      totalRowsCount: lines.length,
      hasMoreRows: lines.length > 20,
    },
    timeline,
  },
}
```

---

## 8. Quy tắc Mở rộng cho Module Mới

Khi xây module mới cần phê duyệt nhanh, developer chỉ làm 4 việc:

1. **Implement `UniversalApprovalProvider`** — 3 method: `getPendingTasks`, `getTaskDetail`, `executeAction`.
2. **Khai báo đúng `taskNature`:**
   - Phê duyệt một chiều → `'DECISION'`
   - Bước cần điền form / upload → `'EXECUTION'` (kèm `blocks.notice`)
3. **Map dữ liệu nghiệp vụ vào các Blocks đã chuẩn hóa** — không tạo block mới.
4. **Khai báo đúng `availableActions`** — chỉ trả về action module thực sự hỗ trợ.

**Không bao giờ cần:** Sửa `UniversalTaskDrawer`, sửa `TaskRenderingBlocks`,
hay thêm nhánh `if sourceModule === 'xyz'` vào Core.

---

## 9. Lộ trình Triển khai

| Giai đoạn | Công việc | Trạng thái |
|---|---|---|
| **0 — Hoàn thành** | Contract v1, HRM Adapter, PE Adapter cơ bản, Drawer, Dashboard sync | Xong |
| **1 — Nâng cấp Contract & PE** | Thêm `taskNature`, `COMPLETE`, `blocks.notice`; PE mapper map attributeValues; Drawer nhãn nút thích ứng | Tiếp theo |
| **2 — Inventory Adapter** | `InventoryTaskApprovalService` cho phiếu xuất kho, kiểm kê | Sau giai đoạn 1 |
| **3 — Finance Adapter** | `FinanceTaskApprovalService` cho phiếu DIRECT; phiếu PROCEDURE uỷ quyền PE | Sau giai đoạn 2 |
| **4+ — Module mới** | Áp dụng quy tắc mở rộng, không sửa Core | Liên tục |

---

## 10. Tóm tắt Quyết định Kiến trúc

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Phân loại bản chất tác vụ | Module khai báo tường minh (`taskNature`) | Module biết rõ nghiệp vụ nhất; Core không suy luận |
| Xử lý bước PE cần nhập liệu | Hiển thị `blocks.notice` + link điều hướng | Không nhúng Form Engine vào Core Drawer |
| Nút "Hoàn thành" cho vai S/E | Thêm `COMPLETE` vào `TaskActionType` | Ngữ nghĩa đúng, Frontend render nhãn đúng |
| Inventory và Finance | Tạo adapter riêng, không sửa Core | Tuân thủ ranh giới phân hệ Rule 4 |
| Maintenance | Không cần adapter | Tự động hưởng lợi qua PE adapter |
