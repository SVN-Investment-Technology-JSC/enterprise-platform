/**
 * Kho tài liệu CRM (GĐ C): hợp đồng giữa giao diện và API.
 *
 * Các hằng số giới hạn (dung lượng, loại file, TTL URL ký, độ sâu thư mục) được VIẾT RIÊNG cho CRM, cùng giá
 * trị với `contracts-workspace` (P2-D14). Việc gom chung với Workspace và Kho làm sau (backlog BL2-09); đến
 * lúc đó mới đổi nguồn, không sửa Workspace ở đợt này.
 *
 * Máy chủ không nhận byte của file: tạo tài liệu hoặc phiên bản trả URL ký sẵn để trình duyệt `PUT` thẳng lên
 * kho lưu trữ, rồi gọi "xác nhận" để tài liệu thành phiên bản hiện hành.
 */

/** Trần dung lượng một file (50 MB), cùng giá trị `DOCUMENT_MAX_BYTES` của Workspace. */
export const CRM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/** URL ký (tải lên, tải xuống) sống 300 giây, cùng giá trị `PRESIGNED_URL_TTL_SECONDS` của Workspace. */
export const CRM_DOCUMENT_URL_TTL_SECONDS = 300;

/** Độ sâu tối đa của cây thư mục (thư mục gốc là cấp 1), cùng `MAX_FOLDER_DEPTH` của Workspace. */
export const CRM_DOCUMENT_MAX_FOLDER_DEPTH = 5;

/** Loại file chấp nhận (danh sách trắng), cùng danh sách `ALLOWED_DOCUMENT_CONTENT_TYPES` của Workspace. */
export const CRM_ALLOWED_DOCUMENT_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
];

/** Đối tượng CRM mà tài liệu gắn vào. */
export const CRM_DOCUMENT_ENTITY_TYPES = [
  'customer',
  'lead',
  'opportunity',
  'quote',
  'contract',
  'sales_order',
  'warranty_case',
] as const;
export type CrmDocumentEntityType = (typeof CRM_DOCUMENT_ENTITY_TYPES)[number];

/** Đối tượng xem: `internal` (nội bộ, mặc định) hoặc `customer` (hồ sơ hướng ra khách). */
export const CRM_DOCUMENT_AUDIENCES = ['internal', 'customer'] as const;
export type CrmDocumentAudience = (typeof CRM_DOCUMENT_AUDIENCES)[number];

/** Loại tài liệu cấu hình theo tenant. `code` là tham chiếu `ref` của điều kiện DOCUMENT_TYPE. */
export interface CrmDocumentType {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface CreateDocumentTypeRequest {
  /** Chữ hoa, số, gạch dưới, 2 đến 32 ký tự; không đổi sau khi tạo. */
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sortOrder?: number;
}

export interface UpdateDocumentTypeRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly active?: boolean;
  readonly sortOrder?: number;
}

export interface CrmDocumentFolder {
  readonly id: string;
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  readonly parentId: string | null;
  readonly name: string;
  /** Từ 1 (thư mục gốc). */
  readonly depth: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateDocumentFolderRequest {
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  readonly parentId?: string | null;
  readonly name: string;
}

export interface CrmDocumentVersion {
  readonly id: string;
  readonly documentId: string;
  readonly versionNo: number;
  readonly fileName: string;
  readonly contentType: string;
  /** Rỗng cho tới khi xác nhận tải lên xong. */
  readonly sizeBytes: number | null;
  readonly changeNote: string | null;
  /** Rỗng cho tới khi xác nhận tải lên xong. */
  readonly uploadedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CrmDocument {
  readonly id: string;
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  readonly folderId: string | null;
  readonly documentType: { readonly id: string; readonly code: string; readonly name: string } | null;
  readonly name: string;
  readonly description: string | null;
  readonly audience: CrmDocumentAudience;
  /** Rỗng khi chưa có phiên bản nào được xác nhận. */
  readonly currentVersionNo: number | null;
  /** Thông tin phiên bản hiện hành (rỗng khi chưa có). */
  readonly fileName: string | null;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
  readonly lockedByUserId: string | null;
  readonly lockedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmDocumentDetail extends CrmDocument {
  /** Mới nhất trước. */
  readonly versions: readonly CrmDocumentVersion[];
}

/** Query `GET /v1/documents`: tài liệu của MỘT đối tượng. */
export interface DocumentListQuery {
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  /** Rỗng: mọi thư mục; `root`: chỉ tài liệu ở gốc; còn lại là id thư mục. */
  readonly folderId?: string;
  readonly documentTypeId?: string;
  readonly audience?: CrmDocumentAudience;
}

export interface CreateDocumentRequest {
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  readonly folderId?: string | null;
  readonly documentTypeId?: string | null;
  /** Tên hiển thị của tài liệu; rỗng thì lấy tên file. */
  readonly name?: string;
  readonly description?: string | null;
  readonly audience?: CrmDocumentAudience;
  readonly fileName: string;
  readonly contentType: string;
  /** Dung lượng khai báo, tối đa `CRM_DOCUMENT_MAX_BYTES`; URL ký ghim đúng số byte này. */
  readonly sizeBytes: number;
  readonly note?: string | null;
}

export interface UpdateDocumentRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly documentTypeId?: string | null;
}

export interface CreateDocumentVersionRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Bắt buộc: lý do có bản mới. */
  readonly changeNote: string;
}

export interface UpdateDocumentAudienceRequest {
  readonly audience: CrmDocumentAudience;
}

/** Trả về khi tạo tài liệu: bản ghi (chưa có phiên bản hiện hành) và URL để `PUT` file. */
export interface CreateDocumentResponse {
  readonly document: CrmDocument;
  readonly version: CrmDocumentVersion;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

export interface DocumentUploadTicket {
  readonly version: CrmDocumentVersion;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

export interface CompleteDocumentUploadRequest {
  /** Dung lượng thực của file đã tải lên. */
  readonly sizeBytes: number;
}

export interface DocumentDownloadTicket {
  readonly downloadUrl: string;
  readonly expiresInSeconds: number;
  readonly fileName: string;
  readonly contentType: string;
  readonly versionNo: number;
}

// ---------------------------------------------------------------------------
// Tham chiếu tài liệu có sẵn vào báo giá (Q-P2-11)
// ---------------------------------------------------------------------------

/** Số tài liệu tham chiếu tối đa trên một báo giá. */
export const QUOTE_DOCUMENT_REFERENCES_MAX = 50;

/** Đối tượng nguồn mà tài liệu được chọn từ đó: khách của báo giá, dự án của báo giá, báo giá khác cùng dự án. */
export const QUOTE_DOCUMENT_SOURCE_TYPES = ['customer', 'opportunity', 'quote'] as const;
export type QuoteDocumentSourceType = (typeof QUOTE_DOCUMENT_SOURCE_TYPES)[number];

export interface QuoteDocumentSource {
  readonly entityType: QuoteDocumentSourceType;
  readonly entityId: string;
  /** Tên khách, tên dự án hoặc mã báo giá. */
  readonly label: string;
}

/** Tài liệu ứng viên để chọn: tài liệu nguồn (đã có phiên bản tải xong) kèm nguồn của nó. */
export interface QuoteDocumentCandidate {
  readonly document: CrmDocument;
  readonly source: QuoteDocumentSource;
  /** `true` khi tài liệu đã được tham chiếu vào báo giá này. */
  readonly attached: boolean;
}

/** Query `GET /v1/quotes/:id/document-candidates`. */
export interface QuoteDocumentCandidateQuery {
  /** Lọc theo nguồn; bỏ trống là mọi nguồn. */
  readonly sourceType?: QuoteDocumentSourceType;
  /** Tìm trong tên tài liệu và tên file (không phân biệt hoa thường). */
  readonly search?: string;
}

export interface AddQuoteDocumentReferenceRequest {
  readonly documentId: string;
}

/** Tham chiếu đã đính kèm. Tải xuống: `GET /v1/quotes/:id/document-references/:id/download`. */
export interface QuoteDocumentReference {
  readonly id: string;
  readonly document: CrmDocument;
  readonly source: QuoteDocumentSource;
  readonly createdAt: string;
  readonly createdBy: string;
}
