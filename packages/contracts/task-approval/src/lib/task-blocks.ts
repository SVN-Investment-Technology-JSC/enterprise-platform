/**
 * Tông màu huy hiệu (badge tone)
 */
export type BlockTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * 1. Khối Tóm tắt (Summary Block)
 * Hiển thị đầu Drawer với các thông tin cốt lõi nhất.
 */
export interface TaskSummaryItem {
  label: string;
  /**
   * Giá trị BẮT BUỘC đã được Server format sẵn thành chuỗi
   * (ví dụ: "15.000.000 ₫", "2 ngày", "Kho Linh Kiện A").
   */
  value: string;
  hint?: string;
}

export interface TaskSummaryBlock {
  badgeLabel?: string;
  badgeTone?: BlockTone;
  items: TaskSummaryItem[];
}

/**
 * 2. Khối Thuộc tính Chi tiết (Attributes Block)
 * Dạng cặp Key-Value mở rộng.
 */
export interface TaskAttributeItem {
  key: string;
  label: string;
  /** Chuỗi đã được format sẵn từ Server */
  value: string;
  badgeTone?: BlockTone;
}

export interface TaskAttributesBlock {
  title?: string;
  items: TaskAttributeItem[];
}

/**
 * 3. Khối Bảng kê Danh mục (Table Block)
 * Phục vụ danh sách mặt hàng xuất nhập kho, tài sản, bảng kê chi phí.
 */
export interface TaskTableColumn {
  key: string;
  title: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export interface TaskTableBlock {
  title: string;
  description?: string;
  columns: TaskTableColumn[];

  /**
   * QUY TẮC AN TOÀN HIỆU NĂNG:
   * Giới hạn tối đa 20 dòng trong response Drawer để tránh phình payload.
   */
  rows: Record<string, string | number | boolean | null>[];

  /** Tổng số dòng thực tế trong DB (ví dụ phiếu kho có 150 dòng) */
  totalRowsCount?: number;

  /** Cờ báo hiệu còn dòng chưa hiển thị hết trong Drawer */
  hasMoreRows?: boolean;

  /** Dòng tóm tắt tổng (đã format sẵn, ví dụ: "Tổng tiền: 120.000.000 ₫") */
  totalSummary?: {
    label: string;
    value: string;
  };
}

/**
 * 4. Khối Tệp đính kèm (Attachments Block)
 * Sử dụng cơ chế cấp URL ký trước (Presigned URL) có thời hạn của hệ thống.
 */
export interface TaskAttachmentItem {
  id: string;
  fileName: string;
  fileSizeLabel: string; // Đã format sẵn, ví dụ: "2.4 MB"
  mimeType: string;
  downloadUrl: string;   // Presigned URL tải file
  previewUrl?: string;   // Presigned URL xem trước (ảnh, PDF)
}

export interface TaskAttachmentsBlock {
  title?: string;
  files: TaskAttachmentItem[];
}

/**
 * 5. Khối Lịch sử / Tiến trình (Timeline Block)
 * Thể hiện các bước duyệt theo Stepper và ý kiến trao đổi.
 */
export interface TaskTimelineStep {
  stepId: string;
  stepName: string;
  assigneeName?: string;
  status: 'COMPLETED' | 'CURRENT' | 'WAITING' | 'REJECTED';
  actedAt?: string;
  comment?: string;
}

export interface TaskTimelineBlock {
  title?: string;
  steps: TaskTimelineStep[];
}

/**
 * Tập hợp toàn bộ các khối hiển thị động của một Task
 */
export interface TaskRenderingBlocks {
  /** Khối tóm tắt thông tin cơ bản (Bắt buộc) */
  summary: TaskSummaryBlock;

  /** Khối thuộc tính nghiệp vụ chi tiết */
  attributes?: TaskAttributesBlock;

  /** Khối danh mục bảng kê (Nhà kho, Mua sắm, v.v.) */
  table?: TaskTableBlock;

  /** Khối tài liệu chứng từ đính kèm */
  attachments?: TaskAttachmentsBlock;

  /** Khối tiến trình phê duyệt nhiều bước / lịch sử thảo luận */
  timeline?: TaskTimelineBlock;
}
