import type { QuoteDocumentSource } from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port của tài liệu tham chiếu vào báo giá (Q-P2-11). Không nhân bản file: chỉ lưu liên kết tới tài liệu nguồn.
 */
export const CRM_QUOTE_DOCUMENT_STORE = Symbol('CRM_QUOTE_DOCUMENT_STORE');

export interface StoredDocumentReference {
  readonly id: string;
  readonly documentId: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface QuoteDocumentStore {
  /** Báo giá có nằm trong phạm vi đọc của người gọi không (giống phạm vi xem tài liệu của báo giá). */
  quoteVisible(tenantId: string, scope: CrmDataScope, quoteId: string): Promise<boolean>;
  /**
   * Các đối tượng nguồn người gọi được đọc: khách hàng của báo giá, dự án của báo giá, các báo giá khác cùng dự án.
   * Đối tượng ngoài phạm vi dữ liệu không có trong kết quả.
   */
  visibleSources(tenantId: string, scope: CrmDataScope, quoteId: string): Promise<QuoteDocumentSource[]>;
  listReferences(tenantId: string, quoteId: string): Promise<StoredDocumentReference[]>;
  findReference(tenantId: string, quoteId: string, referenceId: string): Promise<StoredDocumentReference | undefined>;
  /** Nhãn nguồn của tài liệu (tên khách, tên dự án, mã báo giá); `undefined` khi nguồn không còn hay không thuộc loại cho phép. */
  sourceOfDocument(tenantId: string, documentId: string): Promise<QuoteDocumentSource | undefined>;
  /** `undefined` khi đã tham chiếu rồi; ném 409 khi quá số lượng tối đa. */
  addReference(tenantId: string, quoteId: string, documentId: string, actorId: string): Promise<string | undefined>;
  removeReference(tenantId: string, quoteId: string, referenceId: string, actorId: string): Promise<boolean>;
}
