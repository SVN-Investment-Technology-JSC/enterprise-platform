import { randomUUID } from 'node:crypto';
import {
  CRM_DOCUMENT_URL_TTL_SECONDS,
  type CompleteDocumentUploadRequest,
  type CreateDocumentFolderRequest,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type CreateDocumentTypeRequest,
  type CreateDocumentVersionRequest,
  type CrmDocument,
  type CrmDocumentDetail,
  type CrmDocumentEntityType,
  type CrmDocumentFolder,
  type CrmDocumentType,
  type CrmDocumentVersion,
  type DocumentDownloadTicket,
  type DocumentListQuery,
  type DocumentUploadTicket,
  type UpdateDocumentAudienceRequest,
  type UpdateDocumentRequest,
  type UpdateDocumentTypeRequest,
} from '@enterprise-platform/contracts-crm';
import {
  buildObjectKey,
  nextFolderDepth,
  normalizeDocumentName,
  normalizeDocumentTypeCode,
  normalizeFolderName,
  optionalText,
  parseAudience,
  parseEntityType,
  requiredText,
  validateSizeBytes,
  validateUploadFile,
} from '../domain/document-rules.js';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { DocumentStore, DocumentStorage } from './document-store.port.js';

const DOCUMENT_NOT_FOUND = 'Không tìm thấy tài liệu.';
const ENTITY_NOT_FOUND = 'Không tìm thấy đối tượng gắn tài liệu.';
const FOLDER_NOT_FOUND = 'Không tìm thấy thư mục.';
const LOCKED_BY_OTHER = 'Tài liệu đang được người khác khoá.';

function requireDocumentWriter(actor: CrmActor): void {
  if (!actor.canWriteDocument) throw new CrmForbiddenError('Bạn không có quyền tải lên hay sửa tài liệu CRM.');
}

function requireDocumentDeleter(actor: CrmActor): void {
  if (!actor.canDeleteDocument) throw new CrmForbiddenError('Bạn không có quyền xoá tài liệu CRM.');
}

/** `crm.manage` (đã gồm quản trị tenant ở cờ của guard) quản lý được khoá của người khác. */
function isDocumentModerator(actor: CrmActor): boolean {
  return actor.canManage || actor.isTenantAdmin;
}

function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new CrmValidationError('INVALID_ID', `${label} không hợp lệ.`);
  return value;
}

/**
 * Tài liệu CRM (GĐ C). **Máy chủ không nhận hay gửi byte của file**: chỉ ghi siêu dữ liệu, sinh `object_key`
 * và ký URL 300 giây để trình duyệt tự `PUT`/`GET` lên kho lưu trữ (S3/MinIO), như Workspace.
 *
 * Quyền: xem, tải xuống = `crm.read` trong phạm vi dữ liệu của đối tượng gốc (ngoài phạm vi trả 404, kể cả
 * người chỉ được gán giai đoạn của cơ hội: họ thấy tài liệu của cơ hội đó); tải lên, phiên bản, khoá, đổi
 * đối tượng xem, thư mục = `crm.document.write`; xoá = `crm.document.delete`. Mọi thay đổi ghi `audit_log`
 * cùng transaction (store). Xoá tài liệu chỉ xoá bản ghi, KHÔNG xoá object trên kho: chưa có job dọn (backlog),
 * khoá object được lưu trong `audit_log` để dọn sau.
 */
export class DocumentService {
  constructor(
    private readonly store: DocumentStore,
    private readonly storage: DocumentStorage,
    private readonly scopes: CrmDataScopeService,
  ) {}

  /** Đối tượng gốc phải tồn tại và trong phạm vi; không thì 404 như không có. */
  private async requireEntity(actor: CrmActor, entityType: CrmDocumentEntityType, entityId: string): Promise<void> {
    const scope = await this.scopes.resolve(actor);
    if (!(await this.store.entityVisible(actor.tenantId, scope, entityType, entityId))) {
      throw new CrmNotFoundError(ENTITY_NOT_FOUND);
    }
  }

  /** Tài liệu trong phạm vi của người gọi (theo đối tượng gốc); không thì 404. */
  private async requireDocument(actor: CrmActor, documentId: string): Promise<CrmDocument> {
    const document = await this.store.findDocument(actor.tenantId, documentId);
    if (!document) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    await this.requireEntityOfDocument(actor, document);
    return document;
  }

  private async requireEntityOfDocument(actor: CrmActor, document: CrmDocument): Promise<void> {
    const scope = await this.scopes.resolve(actor);
    if (!(await this.store.entityVisible(actor.tenantId, scope, document.entityType, document.entityId))) {
      throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    }
  }

  private async requireActiveType(tenantId: string, id: string | null): Promise<void> {
    if (!id) return;
    const type = await this.store.findDocumentType(tenantId, id);
    if (!type) throw new CrmValidationError('DOCUMENT_TYPE_NOT_FOUND', 'Loại tài liệu không tồn tại.');
    if (!type.active) throw new CrmValidationError('DOCUMENT_TYPE_INACTIVE', `Loại tài liệu "${type.name}" đã tắt, không chọn cho tài liệu mới.`);
  }

  private async requireFolder(
    tenantId: string,
    folderId: string | null,
    entityType: CrmDocumentEntityType,
    entityId: string,
  ): Promise<CrmDocumentFolder | null> {
    if (!folderId) return null;
    const folder = await this.store.findFolder(tenantId, folderId);
    // Thư mục của đối tượng khác coi như không có.
    if (!folder || folder.entityType !== entityType || folder.entityId !== entityId) {
      throw new CrmNotFoundError(FOLDER_NOT_FOUND);
    }
    return folder;
  }

  private requireNotLockedByOther(actor: CrmActor, document: CrmDocument): void {
    if (document.lockedByUserId && document.lockedByUserId !== actor.userId && !isDocumentModerator(actor)) {
      throw new CrmConflictError('DOCUMENT_LOCKED', LOCKED_BY_OTHER);
    }
  }

  async list(actor: CrmActor, query: DocumentListQuery): Promise<CrmDocument[]> {
    const entityType = parseEntityType(query?.entityType);
    const entityId = requiredText(query?.entityId, 64, 'Đối tượng');
    await this.requireEntity(actor, entityType, entityId);
    const audience = query.audience === undefined || query.audience === null ? undefined : parseAudience(query.audience);
    return this.store.listDocuments(actor.tenantId, {
      entityType,
      entityId,
      folderId: optionalId(query.folderId, 'Thư mục') ?? undefined,
      documentTypeId: optionalId(query.documentTypeId, 'Loại tài liệu') ?? undefined,
      audience,
    });
  }

  async get(actor: CrmActor, documentId: string): Promise<CrmDocumentDetail> {
    const document = await this.requireDocument(actor, documentId);
    const detail = await this.store.documentDetail(actor.tenantId, document.id);
    if (!detail) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    return detail;
  }

  /** Chặng 1: kiểm, ghi siêu dữ liệu (chưa có phiên bản hiện hành) và ký URL `PUT`. */
  async create(actor: CrmActor, input: CreateDocumentRequest): Promise<CreateDocumentResponse> {
    requireDocumentWriter(actor);
    const entityType = parseEntityType(input?.entityType);
    const entityId = requiredText(input?.entityId, 64, 'Đối tượng');
    await this.requireEntity(actor, entityType, entityId);

    const file = validateUploadFile(input.fileName, input.contentType, input.sizeBytes);
    const folderId = optionalId(input.folderId, 'Thư mục');
    const documentTypeId = optionalId(input.documentTypeId, 'Loại tài liệu');
    await this.requireFolder(actor.tenantId, folderId, entityType, entityId);
    await this.requireActiveType(actor.tenantId, documentTypeId);
    const audience = input.audience === undefined ? 'internal' : parseAudience(input.audience);
    const name = normalizeDocumentName(input.name, file.fileName);
    const description = optionalText(input.description, 1000, 'Mô tả');
    const note = optionalText(input.note, 500, 'Ghi chú');

    const id = randomUUID();
    const objectKey = buildObjectKey({
      tenantId: actor.tenantId,
      entityType,
      versionNo: 1,
      fileName: file.fileName,
      uuid: randomUUID(),
    });
    const created = await this.store.createDocument(
      actor.tenantId,
      actor.userId,
      {
        id,
        versionId: randomUUID(),
        entityType,
        entityId,
        folderId,
        documentTypeId,
        name,
        description,
        audience,
        fileName: file.fileName,
        contentType: file.contentType,
        declaredSizeBytes: file.sizeBytes,
        changeNote: note,
        objectKey,
      },
      {
        entityType: 'document',
        entityId: id,
        action: 'upload',
        actorId: actor.userId,
        metadata: { documentEntityType: entityType, documentEntityId: entityId, versionNo: 1, fileName: file.fileName, audience },
      },
    );
    return {
      ...created,
      uploadUrl: await this.storage.createUploadUrl({
        key: objectKey,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        expiresInSeconds: CRM_DOCUMENT_URL_TTL_SECONDS,
      }),
      expiresInSeconds: CRM_DOCUMENT_URL_TTL_SECONDS,
    };
  }

  /** Phiên bản mới. Tài liệu bị người khác khoá thì chỉ người khoá (hoặc quản trị bán hàng) tải bản mới. */
  async addVersion(actor: CrmActor, documentId: string, input: CreateDocumentVersionRequest): Promise<DocumentUploadTicket> {
    requireDocumentWriter(actor);
    const document = await this.requireDocument(actor, documentId);
    this.requireNotLockedByOther(actor, document);
    const file = validateUploadFile(input?.fileName, input?.contentType, input?.sizeBytes);
    const changeNote = requiredText(input?.changeNote, 500, 'Ghi chú thay đổi');
    const uuid = randomUUID();
    const created = await this.store.addVersion(
      actor.tenantId,
      actor.userId,
      documentId,
      {
        id: randomUUID(),
        fileName: file.fileName,
        contentType: file.contentType,
        declaredSizeBytes: file.sizeBytes,
        changeNote,
        objectKeyFor: (versionNo) =>
          buildObjectKey({ tenantId: actor.tenantId, entityType: document.entityType, versionNo, fileName: file.fileName, uuid }),
      },
      { entityType: 'document', entityId: documentId, action: 'version', actorId: actor.userId, reason: changeNote },
    );
    return {
      version: created.version,
      uploadUrl: await this.storage.createUploadUrl({
        key: created.objectKey,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        expiresInSeconds: CRM_DOCUMENT_URL_TTL_SECONDS,
      }),
      expiresInSeconds: CRM_DOCUMENT_URL_TTL_SECONDS,
    };
  }

  /**
   * Chặng 3: trình duyệt báo đã `PUT` xong. Hỏi kho (HEAD) xem object có thật và đúng dung lượng đã khai;
   * có thì phiên bản thành hiện hành. Gọi lại với phiên bản đã xác nhận thì trả nguyên phiên bản đó.
   */
  async completeUpload(
    actor: CrmActor,
    documentId: string,
    versionId: string,
    input: CompleteDocumentUploadRequest,
  ): Promise<CrmDocumentVersion> {
    requireDocumentWriter(actor);
    await this.requireDocument(actor, documentId);
    const stored = await this.store.findVersion(actor.tenantId, documentId, versionId);
    if (!stored) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    if (stored.version.uploadedAt) return stored.version;

    const actual = await this.storage.objectSize(stored.objectKey);
    if (actual === null) {
      throw new CrmValidationError('UPLOAD_NOT_FOUND', 'Chưa thấy file trên kho lưu trữ. Hãy tải lên lại rồi xác nhận.');
    }
    const size = validateSizeBytes(actual);
    const reported = validateSizeBytes(input?.sizeBytes);
    if (size !== reported) {
      throw new CrmValidationError('SIZE_MISMATCH', 'Dung lượng file trên kho không khớp với dung lượng đã báo.');
    }
    const completed = await this.store.completeVersion(actor.tenantId, actor.userId, documentId, versionId, size, {
      entityType: 'document',
      entityId: documentId,
      action: 'upload-complete',
      actorId: actor.userId,
      reason: null,
    });
    if (!completed) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    return completed;
  }

  /** URL tải xuống ký 300 giây; `versionNo` rỗng là phiên bản hiện hành. Cần `crm.read` trong phạm vi. */
  async download(actor: CrmActor, documentId: string, versionNo?: number): Promise<DocumentDownloadTicket> {
    await this.requireDocument(actor, documentId);
    const stored = await this.store.findDownloadVersion(actor.tenantId, documentId, versionNo);
    if (!stored) {
      throw new CrmNotFoundError(versionNo ? 'Không tìm thấy phiên bản này hoặc phiên bản chưa tải lên xong.' : 'Tài liệu chưa có phiên bản tải lên xong.');
    }
    return {
      downloadUrl: await this.storage.createDownloadUrl(stored.objectKey, CRM_DOCUMENT_URL_TTL_SECONDS),
      expiresInSeconds: CRM_DOCUMENT_URL_TTL_SECONDS,
      fileName: stored.version.fileName,
      contentType: stored.version.contentType,
      versionNo: stored.version.versionNo,
    };
  }

  async lock(actor: CrmActor, documentId: string): Promise<CrmDocument> {
    requireDocumentWriter(actor);
    const document = await this.requireDocument(actor, documentId);
    if (document.lockedByUserId === actor.userId) return document;
    if (document.lockedByUserId) throw new CrmConflictError('DOCUMENT_LOCKED', LOCKED_BY_OTHER);
    const locked = await this.store.setLock(actor.tenantId, documentId, actor.userId, {
      entityType: 'document',
      entityId: documentId,
      action: 'lock',
      actorId: actor.userId,
      fromStatus: 'unlocked',
      toStatus: 'locked',
    });
    if (!locked) throw new CrmConflictError('DOCUMENT_LOCKED', LOCKED_BY_OTHER);
    return locked;
  }

  /** Người khoá tự mở; khoá của người khác chỉ `crm.manage` (khoá không tự hết hạn) mở được. */
  async unlock(actor: CrmActor, documentId: string): Promise<CrmDocument> {
    const document = await this.requireDocument(actor, documentId);
    if (!document.lockedByUserId) return document;
    if (document.lockedByUserId === actor.userId) requireDocumentWriter(actor);
    else if (!isDocumentModerator(actor)) {
      throw new CrmForbiddenError('Chỉ người khoá hoặc quản trị bán hàng mới mở khoá được tài liệu này.');
    }
    const unlocked = await this.store.setLock(actor.tenantId, documentId, null, {
      entityType: 'document',
      entityId: documentId,
      action: 'unlock',
      actorId: actor.userId,
      fromStatus: 'locked',
      toStatus: 'unlocked',
      metadata: { lockedBy: document.lockedByUserId },
    });
    if (!unlocked) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    return unlocked;
  }

  /** Đổi đối tượng xem (nội bộ hoặc khách hàng); ghi nhật ký với giá trị trước và sau. */
  async setAudience(actor: CrmActor, documentId: string, input: UpdateDocumentAudienceRequest): Promise<CrmDocument> {
    requireDocumentWriter(actor);
    const document = await this.requireDocument(actor, documentId);
    this.requireNotLockedByOther(actor, document);
    const audience = parseAudience(input?.audience);
    if (audience === document.audience) return document;
    const updated = await this.store.setAudience(actor.tenantId, documentId, audience, {
      entityType: 'document',
      entityId: documentId,
      action: 'audience',
      actorId: actor.userId,
      fromStatus: document.audience,
      toStatus: audience,
    });
    if (!updated) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    return updated;
  }

  /** Đổi tên, mô tả, loại tài liệu. Loại mới phải còn dùng; đổi giữ nguyên loại cũ thì không kiểm. */
  async update(actor: CrmActor, documentId: string, input: UpdateDocumentRequest): Promise<CrmDocument> {
    requireDocumentWriter(actor);
    const document = await this.requireDocument(actor, documentId);
    this.requireNotLockedByOther(actor, document);
    const patch: { name?: string; description?: string | null; documentTypeId?: string | null } = {};
    if (input?.name !== undefined) patch.name = normalizeDocumentName(input.name, document.name);
    if (input?.description !== undefined) patch.description = optionalText(input.description, 1000, 'Mô tả');
    if (input?.documentTypeId !== undefined) {
      const typeId = optionalId(input.documentTypeId, 'Loại tài liệu');
      if (typeId !== (document.documentType?.id ?? null)) await this.requireActiveType(actor.tenantId, typeId);
      patch.documentTypeId = typeId;
    }
    const updated = await this.store.updateDocument(actor.tenantId, documentId, actor.userId, patch, {
      entityType: 'document',
      entityId: documentId,
      action: 'update',
      actorId: actor.userId,
      metadata: { fields: Object.keys(patch) },
    });
    if (!updated) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
    return updated;
  }

  /** Xoá bản ghi tài liệu (object trên kho còn nguyên, xem mô tả lớp). Cần `crm.document.delete`. */
  async remove(actor: CrmActor, documentId: string): Promise<void> {
    requireDocumentDeleter(actor);
    const document = await this.requireDocument(actor, documentId);
    this.requireNotLockedByOther(actor, document);
    const removed = await this.store.deleteDocument(actor.tenantId, documentId, (objectKeys) => ({
      entityType: 'document',
      entityId: documentId,
      action: 'delete',
      actorId: actor.userId,
      fromStatus: 'active',
      toStatus: 'deleted',
      metadata: {
        documentEntityType: document.entityType,
        documentEntityId: document.entityId,
        name: document.name,
        // Object còn trên kho; khoá lưu ở đây để job dọn (backlog) xử lý sau.
        orphanedObjectKeys: objectKeys.slice(0, 200),
      },
    }));
    if (!removed) throw new CrmNotFoundError(DOCUMENT_NOT_FOUND);
  }

  async listFolders(actor: CrmActor, entityType: unknown, entityId: unknown): Promise<CrmDocumentFolder[]> {
    const type = parseEntityType(entityType);
    const id = requiredText(entityId, 64, 'Đối tượng');
    await this.requireEntity(actor, type, id);
    return this.store.listFolders(actor.tenantId, type, id);
  }

  async createFolder(actor: CrmActor, input: CreateDocumentFolderRequest): Promise<CrmDocumentFolder> {
    requireDocumentWriter(actor);
    const entityType = parseEntityType(input?.entityType);
    const entityId = requiredText(input?.entityId, 64, 'Đối tượng');
    await this.requireEntity(actor, entityType, entityId);
    const parent = await this.requireFolder(actor.tenantId, optionalId(input.parentId, 'Thư mục cha'), entityType, entityId);
    return this.store.createFolder(actor.tenantId, actor.userId, {
      entityType,
      entityId,
      parentId: parent?.id ?? null,
      name: normalizeFolderName(input.name),
      depth: nextFolderDepth(parent?.depth ?? null),
    });
  }
}

/** Loại tài liệu: ai có `crm.read` xem loại còn dùng; thêm, sửa, tắt, xem cả loại tắt chỉ `crm.manage`. */
export class DocumentTypeService {
  constructor(private readonly store: DocumentStore) {}

  async list(actor: CrmActor, includeInactive = false): Promise<CrmDocumentType[]> {
    return this.store.listDocumentTypes(actor.tenantId, includeInactive && (actor.canManage || actor.isTenantAdmin));
  }

  async create(actor: CrmActor, input: CreateDocumentTypeRequest): Promise<CrmDocumentType> {
    requireSalesManager(actor);
    return this.store.createDocumentType(actor.tenantId, actor.userId, {
      code: normalizeDocumentTypeCode(input?.code),
      name: requiredText(input?.name, 200, 'Tên loại tài liệu'),
      description: optionalText(input?.description, 500, 'Mô tả'),
      sortOrder: sortOrderOf(input?.sortOrder),
    });
  }

  async update(actor: CrmActor, id: string, input: UpdateDocumentTypeRequest): Promise<CrmDocumentType> {
    requireSalesManager(actor);
    const patch: { name?: string; description?: string | null; active?: boolean; sortOrder?: number } = {};
    if (input?.name !== undefined) patch.name = requiredText(input.name, 200, 'Tên loại tài liệu');
    if (input?.description !== undefined) patch.description = optionalText(input.description, 500, 'Mô tả');
    if (input?.active !== undefined) {
      if (typeof input.active !== 'boolean') throw new CrmValidationError('INVALID_ACTIVE', 'Trạng thái dùng không hợp lệ.');
      patch.active = input.active;
    }
    if (input?.sortOrder !== undefined) patch.sortOrder = sortOrderOf(input.sortOrder);
    const updated = await this.store.updateDocumentType(actor.tenantId, id, actor.userId, patch);
    if (!updated) throw new CrmNotFoundError('Không tìm thấy loại tài liệu.');
    return updated;
  }
}

function sortOrderOf(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000) {
    throw new CrmValidationError('INVALID_SORT_ORDER', 'Thứ tự phải là số nguyên từ 0 đến 100000.');
  }
  return value;
}
