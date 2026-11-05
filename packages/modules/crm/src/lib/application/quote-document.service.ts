import {
  CRM_DOCUMENT_URL_TTL_SECONDS,
  QUOTE_DOCUMENT_SOURCE_TYPES,
  type AddQuoteDocumentReferenceRequest,
  type DocumentDownloadTicket,
  type QuoteDocumentCandidate,
  type QuoteDocumentCandidateQuery,
  type QuoteDocumentReference,
  type QuoteDocumentSource,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, normalizeSearch } from '../domain/fields.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { DocumentStorage, DocumentStore } from './document-store.port.js';
import type { QuoteDocumentStore } from './quote-document-store.port.js';

const QUOTE_NOT_FOUND = 'Không tìm thấy báo giá.';
const DOCUMENT_NOT_FOUND = 'Không tìm thấy tài liệu.';
const REFERENCE_NOT_FOUND = 'Không tìm thấy tài liệu đính kèm.';

/**
 * Chọn tài liệu có sẵn trong CRM để đính kèm vào báo giá (Q-P2-11).
 *
 * - Nguồn chọn: tài liệu của khách hàng, dự án của báo giá và các báo giá khác cùng dự án, và CHỈ những đối tượng người gọi
 *   đọc được theo phạm vi dữ liệu (ngoài phạm vi: không thấy, không đính kèm được, 404 như không có).
 * - Đính kèm cần `crm.document.write` và báo giá trong phạm vi đọc (cùng điều kiện tải tài liệu lên báo giá). Không nhân
 *   bản file: chỉ lưu liên kết; tải xuống ký URL theo object của tài liệu nguồn (300 giây).
 * - Xem danh sách và tải xuống tài liệu đã đính kèm: ai đọc được báo giá (đính kèm là chủ ý chia sẻ cùng báo giá).
 *   Xoá tài liệu nguồn thì liên kết mất theo.
 */
export class QuoteDocumentService {
  constructor(
    private readonly store: QuoteDocumentStore,
    private readonly documents: Pick<DocumentStore, 'listDocuments' | 'findDocument' | 'findDownloadVersion'>,
    private readonly storage: Pick<DocumentStorage, 'createDownloadUrl'>,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
  ) {}

  private async requireQuote(actor: CrmActor, quoteId: string) {
    if (!isUuid(quoteId)) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    if (!(await this.store.quoteVisible(actor.tenantId, scope, quoteId))) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    return scope;
  }

  private requireWriter(actor: CrmActor): void {
    if (!actor.canWriteDocument) throw new CrmForbiddenError('Bạn không có quyền tải lên hay sửa tài liệu CRM.');
  }

  /** Tài liệu có thể chọn: đã có phiên bản tải xong, thuộc nguồn trong phạm vi; kèm cờ đã đính kèm. */
  async candidates(actor: CrmActor, quoteId: string, query: QuoteDocumentCandidateQuery): Promise<QuoteDocumentCandidate[]> {
    const scope = await this.requireQuote(actor, quoteId);
    const sourceType =
      query?.sourceType === undefined || (query.sourceType as unknown) === ''
        ? undefined
        : QUOTE_DOCUMENT_SOURCE_TYPES.find((candidate) => candidate === query.sourceType);
    if (query?.sourceType !== undefined && (query.sourceType as unknown) !== '' && !sourceType) {
      throw new CrmValidationError('SOURCE_INVALID', 'Nguồn tài liệu phải là khách hàng, dự án hoặc báo giá.');
    }
    const search = normalizeSearch(query?.search)?.toLowerCase();
    const sources = (await this.store.visibleSources(actor.tenantId, scope, quoteId)).filter(
      (source) => !sourceType || source.entityType === sourceType,
    );
    const attached = new Set((await this.store.listReferences(actor.tenantId, quoteId)).map((reference) => reference.documentId));
    const result: QuoteDocumentCandidate[] = [];
    for (const source of sources) {
      const documents = await this.documents.listDocuments(actor.tenantId, { entityType: source.entityType, entityId: source.entityId });
      for (const document of documents) {
        if (document.currentVersionNo === null) continue;
        if (search && !`${document.name} ${document.fileName ?? ''}`.toLowerCase().includes(search)) continue;
        result.push({ document, source, attached: attached.has(document.id) });
      }
    }
    return result;
  }

  async list(actor: CrmActor, quoteId: string): Promise<QuoteDocumentReference[]> {
    await this.requireQuote(actor, quoteId);
    const references = await this.store.listReferences(actor.tenantId, quoteId);
    const result: QuoteDocumentReference[] = [];
    for (const reference of references) {
      const document = await this.documents.findDocument(actor.tenantId, reference.documentId);
      const source = await this.store.sourceOfDocument(actor.tenantId, reference.documentId);
      if (!document || !source) continue;
      result.push({ id: reference.id, document, source, createdAt: reference.createdAt, createdBy: reference.createdBy });
    }
    return result;
  }

  async add(actor: CrmActor, quoteId: string, request: AddQuoteDocumentReferenceRequest): Promise<QuoteDocumentReference[]> {
    this.requireWriter(actor);
    const scope = await this.requireQuote(actor, quoteId);
    const documentId = typeof request?.documentId === 'string' ? request.documentId.toLowerCase() : '';
    if (!isUuid(documentId)) throw new CrmValidationError('DOCUMENT_REQUIRED', 'Vui lòng chọn tài liệu cần đính kèm.');
    const document = await this.documents.findDocument(actor.tenantId, documentId);
    if (!document) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    if (document.entityType === 'quote' && document.entityId === quoteId.toLowerCase()) {
      throw new CrmConflictError('DOCUMENT_ALREADY_ON_QUOTE', 'Tài liệu này đã thuộc báo giá, không cần đính kèm lại.');
    }
    // Tài liệu phải thuộc đối tượng nguồn người gọi đọc được; ngoài phạm vi thì 404 như không có.
    const sources = await this.store.visibleSources(actor.tenantId, scope, quoteId);
    if (!sources.some((source: QuoteDocumentSource) => source.entityType === document.entityType && source.entityId === document.entityId)) {
      throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    }
    if (document.currentVersionNo === null) {
      throw new CrmConflictError('DOCUMENT_NOT_READY', 'Tài liệu chưa có phiên bản tải lên xong, chưa đính kèm được.');
    }
    if (!(await this.store.addReference(actor.tenantId, quoteId, documentId, actor.userId))) {
      throw new CrmConflictError('DOCUMENT_REFERENCE_EXISTS', 'Tài liệu này đã được đính kèm vào báo giá.');
    }
    return this.list(actor, quoteId);
  }

  async remove(actor: CrmActor, quoteId: string, referenceId: string): Promise<QuoteDocumentReference[]> {
    this.requireWriter(actor);
    await this.requireQuote(actor, quoteId);
    if (!isUuid(referenceId) || !(await this.store.removeReference(actor.tenantId, quoteId, referenceId, actor.userId))) {
      throw new CrmNotFoundError(REFERENCE_NOT_FOUND);
    }
    return this.list(actor, quoteId);
  }

  /** URL tải xuống ký 300 giây của tài liệu được đính kèm; `versionNo` rỗng là phiên bản hiện hành của tài liệu nguồn. */
  async download(actor: CrmActor, quoteId: string, referenceId: string, versionNo?: number): Promise<DocumentDownloadTicket> {
    await this.requireQuote(actor, quoteId);
    const reference = isUuid(referenceId) ? await this.store.findReference(actor.tenantId, quoteId, referenceId) : undefined;
    if (!reference) throw new CrmNotFoundError(REFERENCE_NOT_FOUND);
    const stored = await this.documents.findDownloadVersion(actor.tenantId, reference.documentId, versionNo);
    if (!stored) throw new CrmNotFoundError('Tài liệu chưa có phiên bản tải lên xong hoặc không có phiên bản này.');
    return {
      downloadUrl: await this.storage.createDownloadUrl(stored.objectKey, CRM_DOCUMENT_URL_TTL_SECONDS),
      expiresInSeconds: CRM_DOCUMENT_URL_TTL_SECONDS,
      fileName: stored.version.fileName,
      contentType: stored.version.contentType,
      versionNo: stored.version.versionNo,
    };
  }
}
