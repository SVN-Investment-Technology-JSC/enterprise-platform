import type { ObjectStorageManagementPort } from '@enterprise-platform/adapter-storage';
import {
  SHARED_CONFIDENTIALITY_LEVELS,
  SHARED_FILING_MODULES,
  SHARED_MAX_FOLDER_DEPTH,
  SHARED_PRESIGNED_URL_TTL_SECONDS,
  SHARED_PREVIEWABLE_CONTENT_TYPES,
  type SharedConfidentiality,
  type SharedDocumentVersion,
  type SharedDownloadMode,
  type SharedDownloadTicket,
  type SharedFilingDocumentRequest,
  type SharedFilingDocumentResponse,
  type SharedFilingFolderUpdateRequest,
  type SharedFilingModule,
  type SharedFilingPathSegment,
  type SharedFolder,
} from '@enterprise-platform/contracts-shared';
import {
  SharedDocumentNotFoundError,
  SharedFolderNotFoundError,
  SharedNameTakenError,
  SharedValidationError,
} from '../domain/shared.error.js';
import {
  optionalText,
  recordMeta,
  requireText,
  sharedObjectStorage,
  sharedStorageKey,
  validateFile,
} from './company-document.service.js';
import type { DocumentRow, SharedStore } from './shared-store.port.js';
import type { StorageQuotaService } from './storage-quota.service.js';

/** Người tạo thư mục hệ thống: không ai là chủ sở hữu, chỉ quản trị kho và người được chia sẻ thấy. */
export const SHARED_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/** Thư mục gốc của phân hệ chiếm cấp 0, nên đường dẫn bên dưới tối đa ngần này cấp. */
const MAX_PATH_SEGMENTS = 4;

/**
 * Lưu tệp của phân hệ khác vào kho tài liệu công ty (route nội bộ `/v1/internal/filings/*`).
 *
 * Phân hệ gọi đã tự kiểm quyền người dùng của nó; ở đây chỉ bảo đảm mọi thao tác
 * nằm dưới thư mục gốc của chính phân hệ đó (`system_module`), để service token
 * không thành cửa đọc ghi cả kho. Tệp đi qua hạn mức dung lượng chung như mọi lượt
 * tải lên khác, và đi theo luồng ba chặng: ký URL, trình duyệt `PUT`, báo xong.
 */
export class FilingService {
  constructor(
    private readonly store: SharedStore,
    private readonly quota: StorageQuotaService,
    private readonly storage: ObjectStorageManagementPort = sharedObjectStorage(),
  ) {}

  async createDocument(tenantId: string, input: SharedFilingDocumentRequest): Promise<SharedFilingDocumentResponse> {
    const module = parseModule(input?.module);
    const userId = requireText(input.userId, 'Người tải lên', 64);
    const name = requireText(input.name, 'Tên tài liệu', 255);
    const file = validateFile(input.fileName, input.contentType, input.sizeBytes);
    const folder = input.folderId
      ? await this.moduleFolder(tenantId, module, input.folderId)
      : await this.ensurePath(tenantId, module, requireText(input.rootName, 'Tên thư mục gốc', 180), input.path ?? []);
    await this.quota.ensureCapacity(tenantId, file.sizeBytes);

    const storageKey = sharedStorageKey(tenantId, 1, file.fileName);
    const meta = recordMeta(input);
    const create = (documentName: string) =>
      this.store.documents.create(tenantId, userId, {
        folderId: folder.id,
        name: documentName,
        description: optionalText(input.description, 'Mô tả', 4000),
        effectiveFrom: null,
        confidentiality: parseConfidentiality(input.confidentiality),
        tags: [],
        sourceLabel: optionalText(input.sourceLabel, 'Nguồn', 255),
        storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        changeNote: null,
        ...meta,
      });
    const created = await withUniqueName(name, create);
    await this.store.documents.log(tenantId, userId, {
      documentId: created.document.id,
      versionId: created.version.id,
      action: 'upload',
    });
    return {
      folderId: folder.id,
      documentId: created.document.id,
      versionId: created.version.id,
      uploadUrl: await this.storage.createUploadUrl({
        key: storageKey,
        contentType: file.contentType,
        expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
      }),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
    };
  }

  async completeUpload(
    tenantId: string,
    moduleValue: unknown,
    documentId: string,
    versionId: string,
    sizeBytes: unknown,
  ): Promise<SharedDocumentVersion> {
    const module = parseModule(moduleValue);
    await this.moduleDocument(tenantId, module, documentId);
    const version = await this.store.documents.findVersion(tenantId, versionId);
    if (!version || version.documentId !== documentId) throw new SharedDocumentNotFoundError(versionId);
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 0) {
      throw new SharedValidationError('Dung lượng tệp phải là số nguyên không âm.');
    }
    validateFile(version.fileName, version.contentType, size);
    const completed = await this.store.documents.completeVersion(tenantId, versionId, size);
    if (!completed) throw new SharedDocumentNotFoundError(versionId);
    return completed;
  }

  async download(
    tenantId: string,
    moduleValue: unknown,
    documentId: string,
    userIdValue: unknown,
    mode: SharedDownloadMode,
  ): Promise<SharedDownloadTicket> {
    const module = parseModule(moduleValue);
    const userId = requireText(userIdValue, 'Người xem', 64);
    const document = await this.moduleDocument(tenantId, module, documentId);
    const version = document.currentVersionId
      ? await this.store.documents.findVersion(tenantId, document.currentVersionId)
      : undefined;
    if (!version) throw new SharedDocumentNotFoundError(documentId);
    if (version.sizeBytes == null) {
      throw new SharedValidationError('Tệp chưa tải lên xong, chưa mở được.');
    }
    const preview = mode === 'preview';
    if (preview && !SHARED_PREVIEWABLE_CONTENT_TYPES.includes(version.contentType)) {
      throw new SharedValidationError('Định dạng này chưa xem trước được, hãy tải xuống để mở.');
    }
    const key = await this.store.documents.storageKeyOf(tenantId, version.id);
    if (!key) throw new SharedDocumentNotFoundError(version.id);
    await this.store.documents.log(tenantId, userId, {
      documentId,
      versionId: version.id,
      action: preview ? 'view' : 'download',
    });
    return {
      downloadUrl: await this.storage.createDownloadUrl(
        key,
        SHARED_PRESIGNED_URL_TTL_SECONDS,
        preview
          ? { inline: true, contentType: version.contentType, fileName: version.fileName }
          : { attachment: true, fileName: version.fileName },
      ),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
      fileName: version.fileName,
      contentType: version.contentType,
    };
  }

  /** Bỏ một tệp khỏi hồ sơ: tài liệu vào Thùng rác của kho, khôi phục được như mọi tài liệu khác. */
  async trashDocument(tenantId: string, moduleValue: unknown, documentId: string, userIdValue: unknown): Promise<void> {
    const module = parseModule(moduleValue);
    const userId = requireText(userIdValue, 'Người xoá', 64);
    await this.moduleDocument(tenantId, module, documentId);
    await this.store.documents.trash(tenantId, documentId, userId);
    await this.store.documents.log(tenantId, userId, { documentId, action: 'delete' });
  }

  /** Ghi thông tin hồ sơ lên thư mục của phân hệ (ví dụ số lưu trữ khi đóng hồ sơ). */
  async updateFolder(
    tenantId: string,
    folderId: string,
    input: SharedFilingFolderUpdateRequest,
  ): Promise<SharedFolder> {
    const module = parseModule(input?.module);
    const folder = await this.moduleFolder(tenantId, module, folderId);
    return this.store.folders.update(tenantId, folder.id, {
      name: folder.name,
      parentId: folder.parentId ?? null,
      depthDelta: 0,
      note: input.note === undefined ? folder.note ?? null : optionalText(input.note, 'Ghi chú', 2000),
      ...recordMeta(input, folder),
    });
  }

  /* ------------------------------------------------------------ nội bộ */

  /** Thư mục gốc của phân hệ, rồi từng cấp của `path`; cấp nào chưa có thì tạo. */
  private async ensurePath(
    tenantId: string,
    module: SharedFilingModule,
    rootName: string,
    path: readonly SharedFilingPathSegment[],
  ): Promise<SharedFolder> {
    if (!Array.isArray(path) || path.length > MAX_PATH_SEGMENTS) {
      throw new SharedValidationError(`Đường dẫn lưu hồ sơ tối đa ${MAX_PATH_SEGMENTS} cấp.`);
    }
    let folder = await this.ensureRoot(tenantId, module, rootName);
    for (const segment of path) {
      const name = requireText(segment?.name, 'Tên thư mục', 180);
      const parent = folder;
      if (parent.depth + 1 > SHARED_MAX_FOLDER_DEPTH - 1) {
        throw new SharedValidationError(`Cây thư mục tối đa ${SHARED_MAX_FOLDER_DEPTH} cấp.`);
      }
      const existing = await this.store.folders.activeChild(tenantId, parent.id, name);
      if (existing) {
        folder = existing;
        continue;
      }
      try {
        folder = await this.store.folders.create(tenantId, SHARED_SYSTEM_USER_ID, {
          parentId: parent.id,
          name,
          depth: parent.depth + 1,
          note: optionalText(segment.note, 'Ghi chú', 2000),
          ...recordMeta(segment),
        });
      } catch (error) {
        // Hai lượt lưu cùng lúc tạo cùng một thư mục: lượt sau dùng thư mục lượt trước vừa tạo.
        if (!(error instanceof SharedNameTakenError)) throw error;
        const raced = await this.store.folders.activeChild(tenantId, parent.id, name);
        if (!raced) throw error;
        folder = raced;
      }
    }
    return folder;
  }

  private async ensureRoot(tenantId: string, module: SharedFilingModule, rootName: string): Promise<SharedFolder> {
    const existing = await this.store.folders.systemRoot(tenantId, module);
    if (existing) return existing;
    // Kho đã có thư mục gốc cùng tên do người dùng dựng: thư mục của phân hệ mang thêm hậu tố.
    for (const candidate of [rootName, `${rootName} (hệ thống)`, `${rootName} (hệ thống 2)`]) {
      try {
        return await this.store.folders.createSystemRoot(tenantId, SHARED_SYSTEM_USER_ID, module, candidate);
      } catch (error) {
        if (!(error instanceof SharedNameTakenError)) throw error;
        const raced = await this.store.folders.systemRoot(tenantId, module);
        if (raced) return raced;
      }
    }
    throw new SharedNameTakenError(rootName);
  }

  /** Thư mục đang dùng nằm dưới thư mục gốc của `module`; không thì như không có. */
  private async moduleFolder(tenantId: string, module: SharedFilingModule, folderId: string): Promise<SharedFolder> {
    const root = await this.store.folders.rootOf(tenantId, folderId);
    const folder = root?.active && root.systemModule === module ? await this.store.folders.find(tenantId, folderId) : undefined;
    if (!folder || !folder.isActive) throw new SharedFolderNotFoundError(folderId);
    return folder;
  }

  /** Tài liệu đang dùng (không ở Thùng rác) nằm dưới thư mục gốc của `module`. */
  private async moduleDocument(tenantId: string, module: SharedFilingModule, documentId: string): Promise<DocumentRow> {
    const document = await this.store.documents.find(tenantId, documentId);
    if (!document || document.deletedAt) throw new SharedDocumentNotFoundError(documentId);
    const root = await this.store.folders.rootOf(tenantId, document.folderId);
    if (!root?.active || root.systemModule !== module) throw new SharedDocumentNotFoundError(documentId);
    return document;
  }
}

function parseModule(value: unknown): SharedFilingModule {
  const text = String(value ?? '');
  if (!(SHARED_FILING_MODULES as readonly string[]).includes(text)) {
    throw new SharedValidationError(`Phân hệ "${text.slice(0, 40)}" không được lưu hồ sơ vào kho.`);
  }
  return text as SharedFilingModule;
}

function parseConfidentiality(value: unknown): SharedConfidentiality {
  if (value === undefined || value === null || value === '') return 'internal';
  const text = String(value);
  if (!(SHARED_CONFIDENTIALITY_LEVELS as readonly string[]).includes(text)) {
    throw new SharedValidationError(`Độ mật "${text}" không hợp lệ.`);
  }
  return text as SharedConfidentiality;
}

/** Thử tên gốc, rồi "tên (2)", "tên (3)"… khi thư mục đã có tài liệu cùng tên. */
async function withUniqueName<TValue>(base: string, attempt: (name: string) => Promise<TValue>): Promise<TValue> {
  for (let n = 1; n <= 50; n += 1) {
    const tail = n === 1 ? '' : ` (${n})`;
    try {
      return await attempt(`${base.slice(0, 255 - tail.length)}${tail}`);
    } catch (error) {
      if (!(error instanceof SharedNameTakenError)) throw error;
    }
  }
  throw new SharedNameTakenError(base);
}
