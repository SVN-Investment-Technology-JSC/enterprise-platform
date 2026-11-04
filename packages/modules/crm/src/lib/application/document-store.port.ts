import type {
  CrmDocument,
  CrmDocumentAudience,
  CrmDocumentDetail,
  CrmDocumentEntityType,
  CrmDocumentFolder,
  CrmDocumentType,
  CrmDocumentVersion,
  DocumentListQuery,
} from '@enterprise-platform/contracts-crm';
import type { CrmAuditEntry } from '../domain/audit-log.js';
import type { CrmDataScope } from './data-scope.js';

export const CRM_DOCUMENT_STORE = Symbol('CRM_DOCUMENT_STORE');
export const CRM_DOCUMENT_STORAGE = Symbol('CRM_DOCUMENT_STORAGE');

/**
 * Kho lưu trữ file (S3/MinIO) cho tài liệu. Máy chủ chỉ ký URL cho trình duyệt tự `PUT`/`GET`; không nhận
 * hay gửi byte của file. `objectSize` (HEAD) để xác nhận lượt tải lên có thật và đúng dung lượng.
 */
export interface DocumentStorage {
  /** URL `PUT` ký sẵn, ghim `content-type` và đúng `sizeBytes` byte. */
  createUploadUrl(input: {
    readonly key: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly expiresInSeconds: number;
  }): Promise<string>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  /** Dung lượng object đang có trên kho; `null` khi chưa có (chưa tải lên hoặc tải hỏng). */
  objectSize(key: string): Promise<number | null>;
}

export interface NewDocumentInput {
  readonly id: string;
  readonly versionId: string;
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  readonly folderId: string | null;
  readonly documentTypeId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly audience: CrmDocumentAudience;
  readonly fileName: string;
  readonly contentType: string;
  readonly declaredSizeBytes: number;
  readonly changeNote: string | null;
  readonly objectKey: string;
}

export interface NewVersionInput {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly declaredSizeBytes: number;
  readonly changeNote: string;
  /** Khoá object theo số phiên bản, tính TRONG transaction (sau khi khoá dòng tài liệu). */
  readonly objectKeyFor: (versionNo: number) => string;
}

/** Phiên bản kèm khoá object, chỉ dùng phía máy chủ để ký URL; không bao giờ trả ra ngoài. */
export interface StoredVersion {
  readonly version: CrmDocumentVersion;
  readonly objectKey: string;
}

export interface DocumentFolderInput {
  readonly entityType: CrmDocumentEntityType;
  readonly entityId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly depth: number;
}

/**
 * Lưu tài liệu CRM. Mọi hàm ghi nhận `audit` và ghi `audit_log` CÙNG transaction với thay đổi dữ liệu.
 * Quyền và phạm vi kiểm ở `DocumentService`; store chỉ kiểm điều kiện cần tính trong transaction (khoá).
 */
export interface DocumentStore {
  /** Đối tượng gốc có tồn tại và nằm trong phạm vi dữ liệu của người gọi không (kể cả giai đoạn được gán). */
  entityVisible(
    tenantId: string,
    scope: CrmDataScope,
    entityType: CrmDocumentEntityType,
    entityId: string,
  ): Promise<boolean>;

  listDocuments(tenantId: string, query: DocumentListQuery): Promise<CrmDocument[]>;
  findDocument(tenantId: string, documentId: string): Promise<CrmDocument | null>;
  documentDetail(tenantId: string, documentId: string): Promise<CrmDocumentDetail | null>;
  findVersion(tenantId: string, documentId: string, versionId: string): Promise<StoredVersion | null>;
  /** Phiên bản hiện hành đã xác nhận, hoặc đúng số phiên bản (đã xác nhận) khi có `versionNo`. */
  findDownloadVersion(tenantId: string, documentId: string, versionNo?: number): Promise<StoredVersion | null>;

  createDocument(tenantId: string, actorId: string, input: NewDocumentInput, audit: CrmAuditEntry): Promise<{ document: CrmDocument; version: CrmDocumentVersion }>;
  addVersion(
    tenantId: string,
    actorId: string,
    documentId: string,
    input: NewVersionInput,
    audit: Omit<CrmAuditEntry, 'metadata'>,
  ): Promise<{ version: CrmDocumentVersion; objectKey: string }>;
  /** Đánh dấu phiên bản đã tải lên xong với dung lượng thực; trả `null` khi không có phiên bản đó. */
  completeVersion(
    tenantId: string,
    actorId: string,
    documentId: string,
    versionId: string,
    sizeBytes: number,
    audit: Omit<CrmAuditEntry, 'metadata'>,
  ): Promise<CrmDocumentVersion | null>;
  /**
   * Khoá cho `userId`, hoặc mở khoá (`null`, service đã kiểm quyền mở). Khoá chỉ thành công khi chưa ai giữ
   * hoặc chính `userId` giữ; trả `null` khi tài liệu không còn hoặc khoá đã bị người khác giữ (đua).
   */
  setLock(tenantId: string, documentId: string, userId: string | null, audit: CrmAuditEntry): Promise<CrmDocument | null>;
  setAudience(tenantId: string, documentId: string, audience: CrmDocumentAudience, audit: CrmAuditEntry): Promise<CrmDocument | null>;
  updateDocument(
    tenantId: string,
    documentId: string,
    actorId: string,
    patch: { readonly name?: string; readonly description?: string | null; readonly documentTypeId?: string | null },
    audit: CrmAuditEntry,
  ): Promise<CrmDocument | null>;
  /**
   * Xoá bản ghi tài liệu và phiên bản. KHÔNG xoá object trên kho lưu trữ (dọn riêng ở backlog); khoá object
   * của các phiên bản được ghi vào `audit_log` (metadata) để dọn sau. Trả `false` khi không có tài liệu.
   */
  deleteDocument(tenantId: string, documentId: string, audit: (objectKeys: readonly string[]) => CrmAuditEntry): Promise<boolean>;

  listFolders(tenantId: string, entityType: CrmDocumentEntityType, entityId: string): Promise<CrmDocumentFolder[]>;
  findFolder(tenantId: string, folderId: string): Promise<CrmDocumentFolder | null>;
  createFolder(tenantId: string, actorId: string, input: DocumentFolderInput): Promise<CrmDocumentFolder>;

  listDocumentTypes(tenantId: string, includeInactive: boolean): Promise<CrmDocumentType[]>;
  findDocumentType(tenantId: string, id: string): Promise<CrmDocumentType | null>;
  createDocumentType(
    tenantId: string,
    actorId: string,
    input: { readonly code: string; readonly name: string; readonly description: string | null; readonly sortOrder: number },
  ): Promise<CrmDocumentType>;
  updateDocumentType(
    tenantId: string,
    id: string,
    actorId: string,
    patch: { readonly name?: string; readonly description?: string | null; readonly active?: boolean; readonly sortOrder?: number },
  ): Promise<CrmDocumentType | null>;
}
