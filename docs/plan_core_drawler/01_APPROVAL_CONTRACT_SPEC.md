# Đặc tả Kỹ thuật Giai đoạn 1: Hợp đồng Phê duyệt (Approval Contract Spec)

> **Mã đặc tả:** SPEC-TASK-CONTRACT-01 (Đã tinh chỉnh theo phản biện thực tế)  
> **Thuộc kế hoạch:** [README.md](file:///d:/CRM/enterprise-platform/docs/plan_core_drawler/README.md)  
> **Gói mục tiêu dự kiến:** `packages/contracts/task-approval` (hoặc mở rộng `packages/contracts/integration`)  
> **Trạng thái:** Bản thiết kế hoàn thiện (Refined Specification)

---

## 1. Mục tiêu & Nguyên tắc Cốt lõi

Tạo ra một **khế ước dữ liệu chuẩn hóa (Approval Contract)** giữa các phân hệ nghiệp vụ (HRM, Kho, Bảo trì, Quy trình...) và tầng hiển thị tại Core Dashboard.

### Các nguyên tắc bất biến rút ra từ thực tế vận hành:
1. **Phạm vi duyệt thuộc về Module (Module-Owned Scope)**: Task Router / Gateway **tuyệt đối không tự ý lọc lại quyền hay phạm vi duyệt**. Mỗi module (như HRM qua `hrm-approval-policy.ts` hay Kho qua quyền quản lý kho) tự chịu trách nhiệm truy vấn và trả về chính xác danh sách đơn mà người dùng hiện tại có thẩm quyền duyệt (theo chuỗi báo cáo, chức danh chỉ định, kiêm nhiệm hay dự phòng).
2. **Quyền sở hữu bước duyệt duy nhất (Single Approval Owner)**: Một bước duyệt tại một thời điểm chỉ có duy nhất một Owner (`LOCAL` hoặc `WORKFLOW`).
3. **Không tạo lối đi tắt**: Mọi hành động Từ chối (`REJECT`) hoặc Yêu cầu bổ sung (`RETURN`) bắt buộc phải có văn bản lý do.
4. **Server-side Formatting**: Mọi giá trị tiền tệ, ngày tháng, định lượng hiển thị trên Drawer phải được **Server định dạng sẵn thành chuỗi (String)** theo locale/tiền tệ của tenant (ví dụ `"15.000.000 ₫"`, `"1.250 kg"`), tránh để Client tự format gây sai lệch vùng miền.
5. **Kế thừa hạ tầng sẵn có**: Tệp đính kèm sử dụng trực tiếp cơ chế cấp URL ký trước (Presigned URL) của `@enterprise-platform/adapter-storage`, không tự tạo cơ chế lưu trữ mới.

---

## 2. Định nghĩa Kiểu dữ liệu TypeScript (Core Types)

### 2.1. Thực thể Task cốt lõi (`UniversalTaskDto`)

```typescript
/**
 * Chế độ phê duyệt của tác vụ:
 * - LOCAL: Module nghiệp vụ tự quản lý và quyết định bước duyệt.
 * - WORKFLOW: Procedure Engine (PE) quản lý luồng quy trình và quyết định bước duyệt.
 */
export type TaskApprovalMode = 'LOCAL' | 'WORKFLOW';

/**
 * Trạng thái của tác vụ phê duyệt
 */
export type TaskStatus = 
  | 'PENDING'      // Đang chờ người dùng xử lý
  | 'APPROVED'     // Đã được chấp thuận
  | 'REJECTED'     // Đã bị từ chối
  | 'RETURNED'     // Yêu cầu bổ sung / chỉnh sửa
  | 'CANCELLED';   // Người tạo đơn đã rút / hủy đơn

/**
 * Các hành động phê duyệt trong phiên bản v1.
 * (Lưu ý: Đã loại bỏ DELEGATE khỏi v1 theo phản biện để tránh phức tạp hóa khi chưa có nghiệp vụ).
 */
export type TaskActionType = 'APPROVE' | 'REJECT' | 'RETURN';

/**
 * DTO dữ liệu của một tác vụ phê duyệt hoàn chỉnh
 */
export interface UniversalTaskDto {
  /** Định danh duy nhất của tác vụ trong hệ thống */
  taskId: string;

  /** Định danh tenant */
  tenantId: string;

  /** Phân hệ phát sinh yêu cầu */
  sourceModule: 'hrm' | 'inventory' | 'maintenance' | 'procedure' | 'finance' | 'workspace';

  /** Loại thực thể nghiệp vụ (ví dụ: 'LEAVE_REQUEST', 'STOCK_EXPORT', 'WORK_ORDER') */
  entityType: string;

  /** ID của bản ghi nghiệp vụ gốc trong schema của module */
  entityId: string;

  /** Tiêu đề ngắn gọn hiển thị trên danh sách và Drawer */
  title: string;

  /** Mã tham chiếu nghiệp vụ dễ đọc (ví dụ: 'ĐN-2026-0042', 'XK-0812') */
  code?: string;

  /** Người tạo đơn / người yêu cầu */
  requester: {
    userId: string;
    fullName: string;
    email?: string;
    avatarUrl?: string;
    departmentName?: string;
    positionName?: string;
  };

  /** Thời điểm tạo tác vụ */
  createdAt: string; // ISO 8601 UTC

  /** Mức độ ưu tiên */
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  /** Chế độ thực thi phê duyệt */
  approvalMode: TaskApprovalMode;

  /** Đơn vị/Phân hệ sở hữu thẩm quyền quyết định bước hiện tại */
  approvalOwner: string; // Ví dụ: 'hrm', 'inventory', hoặc 'procedure-engine'

  /** ID của phiên quy trình PE (nếu approvalMode === 'WORKFLOW') */
  workflowInstanceId?: string;

  /** ID của bước quy trình hiện tại (nếu approvalMode === 'WORKFLOW') */
  stepId?: string;

  /** Trạng thái hiện tại của tác vụ */
  status: TaskStatus;

  /**
   * Danh sách hành động mà người duyệt hiện tại ĐƯỢC PHÉP thực hiện.
   * QUY TẮC: Module chỉ trả về các hành động mình hỗ trợ.
   * - HRM hiện tại chỉ hỗ trợ ['APPROVE', 'REJECT'].
   * - Kho / PE có thể hỗ trợ ['APPROVE', 'REJECT', 'RETURN'].
   * Universal Drawer CHỈ RENDER các nút có trong danh sách này.
   */
  availableActions: TaskActionType[];

  /**
   * Phiên bản dữ liệu phục vụ kiểm soát tranh chấp (tùy chọn theo module).
   * Nếu module chưa có cột version trong DB, tận dụng kiểm tra atomic trạng thái.
   */
  version?: number;

  /** Đường dẫn an toàn để mở toàn màn hình chi tiết trong phân hệ gốc */
  detailUrl: string;

  /** Các khối dữ liệu hiển thị động trong Drawer */
  blocks: TaskRenderingBlocks;
}
```

---

### 2.2. Các Khối Hiển thị Động (Schema-driven Rendering Blocks)

```typescript
export interface TaskRenderingBlocks {
  /** Khối tóm tắt thông tin cơ bản (hiển thị đầu trang Drawer) */
  summary: TaskSummaryBlock;

  /** Khối thuộc tính nghiệp vụ chi tiết (dạng Key-Value) */
  attributes?: TaskAttributesBlock;

  /** Khối danh mục bảng kê (ví dụ: danh sách vật tư xuất kho, bảng kê chi phí) */
  table?: TaskTableBlock;

  /** Khối tài liệu chứng từ đính kèm */
  attachments?: TaskAttachmentsBlock;

  /** Khối tiến trình phê duyệt nhiều bước / lịch sử thảo luận */
  timeline?: TaskTimelineBlock;
}

/** 1. Khối Tóm tắt */
export interface TaskSummaryBlock {
  badgeLabel?: string;
  badgeTone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  items: {
    label: string;
    /** Giá trị BẮT BUỘC đã được Server format sẵn thành chuỗi (ví dụ: "15.000.000 ₫") */
    value: string;
    hint?: string;
  }[];
}

/** 2. Khối Thuộc tính Chi tiết */
export interface TaskAttributesBlock {
  title?: string;
  items: {
    key: string;
    label: string;
    /** Chuỗi đã được format sẵn từ Server */
    value: string;
    badgeTone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  }[];
}

/** 3. Khối Bảng kê (Có giới hạn hiển thị an toàn) */
export interface TaskTableBlock {
  title: string;
  description?: string;
  columns: {
    key: string;
    title: string;
    align?: 'left' | 'center' | 'right';
    width?: string;
  }[];
  
  /**
   * QUY TẮC AN TOÀN HIỆU NĂNG:
   * Giới hạn tối đa 20 dòng trong response Drawer để tránh phình payload.
   */
  rows: Record<string, string | number | boolean | null>[];
  
  /** Tổng số dòng thực tế trong DB (ví dụ phiếu kho có 150 dòng) */
  totalRowsCount?: number;
  
  /** Cờ báo hiệu còn dòng chưa hiển thị hết */
  hasMoreRows?: boolean;

  /** Dòng tóm tắt tổng (đã format sẵn, ví dụ: "Tổng tiền: 120.000.000 ₫") */
  totalSummary?: {
    label: string;
    value: string;
  };
}

/** 4. Khối Tệp đính kèm (Sử dụng chuẩn Storage của hệ thống) */
export interface TaskAttachmentsBlock {
  title?: string;
  files: {
    id: string;
    fileName: string;
    fileSizeLabel: string; // Đã format sẵn, ví dụ "2.4 MB"
    mimeType: string;
    /** URL ký thời hạn ngắn sinh bởi @enterprise-platform/adapter-storage */
    downloadUrl: string;
    previewUrl?: string;
  }[];
}

/** 5. Khối Lịch sử / Stepper Tiến trình */
export interface TaskTimelineBlock {
  title?: string;
  steps: {
    stepId: string;
    stepName: string;
    assigneeName?: string;
    status: 'COMPLETED' | 'CURRENT' | 'WAITING' | 'REJECTED';
    actedAt?: string;
    comment?: string;
  }[];
}
```

---

## 3. Quy ước Chuyển đổi Trạng thái giữa `LOCAL` và `WORKFLOW`

Một rủi ro kiến trúc lớn là tranh chấp quyền sở hữu khi một đơn chuyển ngưỡng giá trị hoặc cấu hình tenant thay đổi giữa chừng.

### Quy tắc bất biến:
1. **Snapshot tại thời điểm nộp đơn**: Khi đơn được nộp, module xác định `approvalMode` dựa trên policy tại thời điểm đó (ví dụ: nghỉ phép $\le 2$ ngày là `LOCAL`, $> 2$ ngày là `WORKFLOW`). Giá trị này được ghim cố định vào đơn, không đổi hồi tố.
2. **Khóa chế độ LOCAL khi đã vào WORKFLOW (`PROCEDURE_IN_PROGRESS`)**:
   * Khi đơn đã được kích hoạt phiên quy trình trong Procedure Engine (`workflowInstanceId` tồn tại):
   * Quyền duyệt thuộc về PE. Bất kỳ lệnh duyệt trực tiếp nào gửi tới API `LOCAL` sẽ bị từ chối ngay lập tức với mã lỗi:
     ```json
     {
       "statusCode": 409,
       "error": "PROCEDURE_IN_PROGRESS",
       "message": "Đơn đang được xử lý trong Quy trình, vui lòng thực hiện qua luồng Quy trình."
     }
     ```
   * *Thực tế áp dụng:* HRM đã triển khai chốt chặn này rất thành công bằng cả mã kiểm tra nghiệp vụ và Trigger DB ở tầng dưới cùng.

---

## 4. Cơ chế Kiểm soát Tranh chấp (Concurrency & Idempotency) trong Thực tế

### 4.1. Thực trạng dữ liệu hiện tại
* Trong schema của HRM (`hrm_schema.*_requests`) và Kho hiện tại **chưa có cột `version` hay bảng lưu `idempotency_keys`**. Việc ép buộc phải có `expectedVersion` ngay lập tức sẽ là "trang trí" nếu chưa có cột DB.

### 4.2. Giải pháp phân tầng (Phù hợp thực tế):
* **Tầng 1 - Chặn trùng bằng Trạng thái Atomic (Áp dụng ngay cho mọi bảng hiện hữu)**:
  * Tất cả các thao tác duyệt/từ chối đều chạy câu lệnh cập nhật có điều kiện nghiêm ngặt:
    ```sql
    UPDATE hrm_schema.leave_requests 
    SET status = 'APPROVED', approved_by = $2, approved_at = now()
    WHERE tenant_id = $1 AND id = $3 AND status = 'PENDING'
    RETURNING *;
    ```
  * Nếu không có dòng nào được trả về (do người khác đã duyệt trước hoặc đơn đã bị hủy), API ném lỗi ngay:
    `409 Conflict: HRM_REQUEST_NOT_PENDING` (hoặc `TASK_NOT_PENDING`).
* **Tầng 2 - Khóa lạc quan bằng `version` (Áp dụng cho các bảng mới của Kho hoặc phiên bản sau)**:
  * Khi schema có cột `version`, lệnh update kiểm tra thêm `AND version = $expectedVersion` và tăng `version = version + 1`.
* **Idempotency Key trên Client**:
  * Client vẫn luôn gửi `idempotencyKey: UUID` trên header hoặc body. Server tận dụng key này để ghi nhật ký audit log và hỗ trợ dedup ở gateway.

---

## 5. DTO Gửi lệnh & Kết quả (Action DTOs)

### 5.1. `ExecuteTaskActionDto`

```typescript
export interface ExecuteTaskActionDto {
  /** Hành động: 'APPROVE', 'REJECT', hoặc 'RETURN' */
  action: TaskActionType;

  /**
   * Lý do:
   * - BẮT BUỘC khi action === 'REJECT' hoặc 'RETURN' (length > 0 sau khi trim)
   * - Tùy chọn khi action === 'APPROVE'
   */
  reason?: string;

  /** Khóa chống gửi trùng do client sinh */
  idempotencyKey: string;

  /** Phiên bản kỳ vọng (nếu module có hỗ trợ) */
  expectedVersion?: number;
}
```

### 5.2. `TaskActionResultDto`

```typescript
export interface TaskActionResultDto {
  success: boolean;
  taskId: string;
  action: TaskActionType;
  newStatus: TaskStatus;
  completedAt: string;
  message: string;
}
```
