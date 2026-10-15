import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import {
  SHARED_ALLOWED_CONTENT_TYPES,
  SHARED_CONFIDENTIALITY_LEVELS,
  SHARED_DOCUMENT_KINDS,
  SHARED_DOCUMENT_MAX_BYTES,
  SHARED_DOCUMENT_STATUSES,
  SHARED_MAX_FOLDER_DEPTH,
  SHARED_PRESIGNED_URL_TTL_SECONDS,
  SHARED_PREVIEWABLE_CONTENT_TYPES,
  type CreateSharedDocumentRequest,
  type CreateSharedDocumentResponse,
  type CreateSharedFolderRequest,
  type CreateSharedVersionRequest,
  type SharedConfidentiality,
  type SharedDocumentDetail,
  type SharedDocumentKind,
  type SharedDocumentQuery,
  type SharedDocumentStatus,
  type SharedDocumentSummary,
  type SharedDocumentVersion,
  type SharedDownloadMode,
  type SharedDownloadTicket,
  type SharedFolder,
  type SharedRecordMeta,
  type SharedUploadTicket,
  type UpdateSharedDocumentRequest,
  type UpdateSharedFolderRequest,
} from '@enterprise-platform/contracts-shared';
import { randomUUID } from 'node:crypto';
import {
  SharedDocumentLockedError,
  SharedDocumentNotFoundError,
  SharedFolderNotFoundError,
  SharedForbiddenError,
  SharedValidationError,
} from '../domain/shared.error.js';
import { isSharedManager, type SharedActor } from './shared-actor.js';
import type { DocumentRow, RecordMetaInput, SharedStore } from './shared-store.port.js';
import type { StorageQuotaService } from './storage-quota.service.js';

/** Kết quả tìm kiếm toàn kho tối đa từng này dòng; trong một thư mục thì lấy hết. */
const SEARCH_LIMIT = 200;
const FOLDER_LIMIT = 5000;

/**
 * Tài liệu công ty.
 *
 * **Máy chủ không nhận hay gửi byte của tệp**: chỉ ghi siêu dữ liệu, sinh
 * `storage_key`, ký URL cho trình duyệt tự `PUT`/`GET` lên kho — cùng khuôn với
 * `DocumentService` của Workspace. Khác Workspace ở ba điểm:
 *
 * - không có khái niệm dự án; quyền đi theo quyền của phân hệ;
 * - thư mục và tài liệu mang thông tin hồ sơ (loại, số hiệu, đối tác, hiệu lực);
 * - mỗi lượt tải lên đi qua hạn mức dung lượng chung của tenant.
 */
export class CompanyDocumentService {
  constructor(
    private readonly store: SharedStore,
    private readonly quota: StorageQuotaService,
    private readonly storage: ObjectStoragePort = new S3ObjectStorage({
      // Hai đầu nối: server gọi kho trong mạng nội bộ, còn URL ký sẵn phải mang
      // host công khai cho trình duyệt mở. Xem `DocumentService` của Workspace.
      internalEndpoint:
        process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://minio:9000',
      publicEndpoint:
        process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
    }),
  ) {}

  /* ------------------------------------------------------------ thư mục */

  async folders(actor: SharedActor): Promise<SharedFolder[]> {
    return sortFolders(await this.store.folders.list(actor.tenantId));
  }

  /**
   * Thư mục gốc là khung của cả kho ("3. HỢP ĐỒNG", "4. HC_TH"…) nên chỉ người
   * quản trị kho dựng; thư mục con — một hồ sơ hợp đồng, một năm — thì người
   * có quyền ghi tài liệu tự tạo.
   */
  async createFolder(actor: SharedActor, input: CreateSharedFolderRequest): Promise<SharedFolder> {
    const name = requireText(input?.name, 'Tên thư mục', 180);
    let depth = 0;
    if (input.parentId) {
      if (!actor.canWriteDocuments && !isSharedManager(actor)) throw new SharedForbiddenError();
      const parent = await this.activeFolder(actor, input.parentId);
      depth = parent.depth + 1;
      if (depth > SHARED_MAX_FOLDER_DEPTH - 1) {
        throw new SharedValidationError(`Cây thư mục tối đa ${SHARED_MAX_FOLDER_DEPTH} cấp.`);
      }
    } else if (!isSharedManager(actor)) {
      throw new SharedForbiddenError('Chỉ người quản trị kho tạo được thư mục gốc.');
    }

    return this.store.folders.create(actor.tenantId, actor.userId, {
      parentId: input.parentId ?? null,
      name,
      depth,
      note: optionalText(input.note, 'Ghi chú', 2000),
      ...recordMeta(input),
    });
  }

  /**
   * Đổi tên, sửa thông tin hồ sơ, hoặc chuyển thư mục.
   *
   * Sửa tên và thông tin: người có quyền ghi. Chuyển chỗ đổi khung của kho nên
   * chỉ người quản trị; cả nhánh đi theo và vẫn phải nằm trong giới hạn cấp.
   */
  async updateFolder(
    actor: SharedActor,
    folderId: string,
    input: UpdateSharedFolderRequest,
  ): Promise<SharedFolder> {
    if (!actor.canWriteDocuments && !isSharedManager(actor)) throw new SharedForbiddenError();
    const folder = await this.activeFolder(actor, folderId);
    const patch = input ?? {};

    const name = patch.name === undefined ? folder.name : requireText(patch.name, 'Tên thư mục', 180);
    const currentParent = folder.parentId ?? null;
    const parentId = patch.parentId === undefined ? currentParent : patch.parentId || null;

    let depthDelta = 0;
    if (parentId !== currentParent) {
      if (!isSharedManager(actor)) {
        throw new SharedForbiddenError('Chỉ người quản trị kho chuyển được thư mục.');
      }
      const folders = await this.store.folders.list(actor.tenantId);
      const branch = branchOf(folders, folder.id);
      let newDepth = 0;
      if (parentId) {
        if (branch.has(parentId)) {
          throw new SharedValidationError(
            'Không chuyển được thư mục vào chính nó hoặc vào thư mục con của nó.',
          );
        }
        const parent = folders.find((item) => item.id === parentId);
        if (!parent) throw new SharedFolderNotFoundError(parentId);
        newDepth = parent.depth + 1;
      }
      depthDelta = newDepth - folder.depth;
      const deepest = Math.max(
        folder.depth,
        ...folders.filter((item) => branch.has(item.id)).map((item) => item.depth),
      );
      if (deepest + depthDelta > SHARED_MAX_FOLDER_DEPTH - 1) {
        throw new SharedValidationError(`Cây thư mục tối đa ${SHARED_MAX_FOLDER_DEPTH} cấp.`);
      }
    }

    return this.store.folders.update(actor.tenantId, folderId, {
      name,
      parentId,
      depthDelta,
      note: patch.note === undefined ? folder.note ?? null : optionalText(patch.note, 'Ghi chú', 2000),
      ...recordMeta(patch, folder),
    });
  }

  /** Chỉ gỡ thư mục rỗng; còn gì bên trong thì nói rõ còn bao nhiêu. */
  async removeFolder(actor: SharedActor, folderId: string): Promise<void> {
    if (!actor.canDeleteDocuments && !actor.isTenantAdmin) {
      throw new SharedForbiddenError('Bạn không có quyền xoá thư mục.');
    }
    await this.activeFolder(actor, folderId);
    const contents = await this.store.folders.countContents(actor.tenantId, folderId);
    if (contents.folders > 0) {
      throw new SharedValidationError(
        `Thư mục còn ${contents.folders} thư mục con. Hãy xoá hoặc chuyển chúng đi trước.`,
      );
    }
    if (contents.documents > 0) {
      throw new SharedValidationError(
        `Thư mục còn ${contents.documents} tài liệu. Hãy lưu trữ chúng trước khi xoá thư mục.`,
      );
    }
    await this.store.folders.deactivate(actor.tenantId, folderId);
  }

  /* ----------------------------------------------------------- tài liệu */

  async list(actor: SharedActor, query: SharedDocumentQuery): Promise<SharedDocumentSummary[]> {
    const status = parseStatus(query?.status) ?? 'active';
    const search = query?.search?.trim() || undefined;
    if (query?.folderId) await this.activeFolder(actor, query.folderId);
    const expiring = Number(query?.expiringWithinDays);
    const rows = await this.store.documents.list(actor.tenantId, {
      folderId: query?.folderId,
      search,
      kind: parseKind(query?.kind),
      status,
      expiringWithinDays: Number.isInteger(expiring) && expiring >= 0 ? Math.min(expiring, 3650) : undefined,
      limit: query?.folderId && !search ? FOLDER_LIMIT : SEARCH_LIMIT,
    });
    const paths = folderPaths(await this.store.folders.list(actor.tenantId));
    return rows
      .filter((row) => canSee(actor, row))
      .map((row) => ({ ...row, folderPath: paths.get(row.folderId) ?? '' }));
  }

  async detail(actor: SharedActor, documentId: string): Promise<SharedDocumentDetail> {
    const document = await this.visibleDocument(actor, documentId);
    const [versions, accessLog, folders] = await Promise.all([
      this.store.documents.listVersions(actor.tenantId, documentId),
      this.store.documents.accessLog(actor.tenantId, documentId, 30),
      this.store.folders.list(actor.tenantId),
    ]);
    // Mở thông tin không ghi nhật ký; "xem" chỉ tính khi mở tệp (download chế độ preview).
    return {
      ...document,
      folderPath: folderPaths(folders).get(document.folderId) ?? '',
      versions,
      accessLog,
    };
  }

  /**
   * Chặng 1 của luồng ba chặng: kiểm hạn mức, ghi siêu dữ liệu, trả URL ký.
   * Chặng 2 trình duyệt `PUT` thẳng lên kho; chặng 3 gọi `completeUpload`.
   */
  async create(
    actor: SharedActor,
    input: CreateSharedDocumentRequest,
  ): Promise<CreateSharedDocumentResponse> {
    this.requireWrite(actor);
    if (!input?.folderId) throw new SharedValidationError('Cần chọn thư mục.');
    const folder = await this.activeFolder(actor, input.folderId);
    const name = requireText(input.name, 'Tên tài liệu', 255);
    const file = validateFile(input.fileName, input.contentType, input.sizeBytes);
    const effectiveFrom = optionalDate(input.effectiveFrom, 'Hiệu lực từ');
    const meta = recordMeta(input);
    requireRange(effectiveFrom, meta.effectiveTo);
    await this.quota.ensureCapacity(actor.tenantId, file.sizeBytes);

    const storageKey = this.storageKey(actor, 1, file.fileName);
    const created = await this.store.documents.create(actor.tenantId, actor.userId, {
      folderId: folder.id,
      name,
      description: optionalText(input.description, 'Mô tả', 4000),
      effectiveFrom,
      confidentiality: parseConfidentiality(input.confidentiality) ?? 'internal',
      tags: parseTags(input.tags),
      sourceLabel: null,
      storageKey,
      fileName: file.fileName,
      contentType: file.contentType,
      changeNote: optionalText(input.note, 'Ghi chú', 500),
      ...meta,
    });
    await this.store.documents.log(actor.tenantId, actor.userId, {
      documentId: created.document.id,
      versionId: created.version.id,
      action: 'upload',
    });

    return {
      document: created.document,
      version: created.version,
      uploadUrl: await this.storage.createUploadUrl({
        key: storageKey,
        contentType: file.contentType,
        expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
      }),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
    };
  }

  /** Sửa thông tin hồ sơ, đổi tên hoặc chuyển thư mục. */
  async update(
    actor: SharedActor,
    documentId: string,
    input: UpdateSharedDocumentRequest,
  ): Promise<SharedDocumentSummary> {
    this.requireWrite(actor);
    const document = await this.visibleDocument(actor, documentId);
    if (document.status !== 'active') {
      throw new SharedValidationError('Tài liệu đã lưu trữ; khôi phục trước khi sửa.');
    }
    this.requireNotLockedByOther(actor, document);
    const patch = input ?? {};

    let folderId = document.folderId;
    if (patch.folderId && patch.folderId !== document.folderId) {
      folderId = (await this.activeFolder(actor, patch.folderId)).id;
    }
    const effectiveFrom =
      patch.effectiveFrom === undefined
        ? document.effectiveFrom ?? null
        : optionalDate(patch.effectiveFrom, 'Hiệu lực từ');
    const meta = recordMeta(patch, document);
    requireRange(effectiveFrom, meta.effectiveTo);

    await this.store.documents.update(actor.tenantId, documentId, {
      folderId,
      name: patch.name === undefined ? document.name : requireText(patch.name, 'Tên tài liệu', 255),
      description:
        patch.description === undefined
          ? document.description ?? null
          : optionalText(patch.description, 'Mô tả', 4000),
      effectiveFrom,
      confidentiality:
        patch.confidentiality === undefined
          ? document.confidentiality
          : parseConfidentiality(patch.confidentiality) ?? document.confidentiality,
      tags: patch.tags === undefined ? document.tags : parseTags(patch.tags),
      ...meta,
    });
    await this.store.documents.log(actor.tenantId, actor.userId, {
      documentId,
      action: folderId !== document.folderId ? 'move' : 'update',
    });
    return this.summary(actor, documentId);
  }

  /** Phiên bản mới; bắt buộc ghi chú thay đổi. Người khác đang khoá thì từ chối. */
  async addVersion(
    actor: SharedActor,
    documentId: string,
    input: CreateSharedVersionRequest,
  ): Promise<SharedUploadTicket> {
    this.requireWrite(actor);
    const document = await this.visibleDocument(actor, documentId);
    if (document.status !== 'active') {
      throw new SharedValidationError('Tài liệu đã lưu trữ; khôi phục trước khi tải phiên bản mới.');
    }
    this.requireNotLockedByOther(actor, document);
    const changeNote = requireText(input?.changeNote, 'Ghi chú thay đổi', 500);
    const file = validateFile(input?.fileName, input?.contentType, input?.sizeBytes);
    await this.quota.ensureCapacity(actor.tenantId, file.sizeBytes);

    const versions = await this.store.documents.listVersions(actor.tenantId, documentId);
    const versionNo = Math.max(0, ...versions.map((entry) => entry.versionNo)) + 1;
    const storageKey = this.storageKey(actor, versionNo, file.fileName);
    const version = await this.store.documents.addVersion(actor.tenantId, actor.userId, {
      documentId,
      versionNo,
      storageKey,
      fileName: file.fileName,
      contentType: file.contentType,
      changeNote,
    });
    await this.store.documents.log(actor.tenantId, actor.userId, {
      documentId,
      versionId: version.id,
      action: 'upload',
    });
    return {
      version,
      uploadUrl: await this.storage.createUploadUrl({
        key: storageKey,
        contentType: file.contentType,
        expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
      }),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
    };
  }

  /**
   * Chặng 3: trình duyệt báo đã `PUT` xong. Lượt `PUT` hỏng không bao giờ tới
   * đây, nên phiên bản ở lại "chưa tải lên xong" (`size_bytes` rỗng).
   */
  async completeUpload(
    actor: SharedActor,
    documentId: string,
    versionId: string,
    sizeBytes: unknown,
  ): Promise<SharedDocumentVersion> {
    this.requireWrite(actor);
    await this.visibleDocument(actor, documentId);
    const version = await this.store.documents.findVersion(actor.tenantId, versionId);
    if (!version || version.documentId !== documentId) {
      throw new SharedDocumentNotFoundError(versionId);
    }
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 0) {
      throw new SharedValidationError('Dung lượng tệp phải là số nguyên không âm.');
    }
    if (size > SHARED_DOCUMENT_MAX_BYTES) {
      throw new SharedValidationError(
        `Tệp không được vượt quá ${Math.round(SHARED_DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }
    const completed = await this.store.documents.completeVersion(actor.tenantId, versionId, size);
    if (!completed) throw new SharedDocumentNotFoundError(versionId);
    return completed;
  }

  /** URL ký sẵn để lấy tệp. `preview` mở ngay trong trình duyệt và ghi nhật ký là "xem". */
  async download(
    actor: SharedActor,
    documentId: string,
    versionId?: string,
    mode: SharedDownloadMode = 'download',
  ): Promise<SharedDownloadTicket> {
    const document = await this.visibleDocument(actor, documentId);
    const targetId = versionId || document.currentVersionId;
    if (!targetId) throw new SharedDocumentNotFoundError(documentId);
    const version = await this.store.documents.findVersion(actor.tenantId, targetId);
    if (!version || version.documentId !== documentId) {
      throw new SharedDocumentNotFoundError(targetId);
    }
    if (version.sizeBytes == null) {
      throw new SharedValidationError('Phiên bản này chưa tải lên xong, chưa tải xuống được.');
    }
    const preview = mode === 'preview';
    if (preview && !SHARED_PREVIEWABLE_CONTENT_TYPES.includes(version.contentType)) {
      throw new SharedValidationError('Định dạng này chưa xem trước được, hãy tải xuống để mở.');
    }
    const key = await this.store.documents.storageKeyOf(actor.tenantId, version.id);
    if (!key) throw new SharedDocumentNotFoundError(version.id);
    await this.store.documents.log(actor.tenantId, actor.userId, {
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
          : { fileName: version.fileName },
      ),
      expiresInSeconds: SHARED_PRESIGNED_URL_TTL_SECONDS,
      fileName: version.fileName,
      contentType: version.contentType,
    };
  }

  async lock(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    this.requireWrite(actor);
    const document = await this.visibleDocument(actor, documentId);
    this.requireNotLockedByOther(actor, document);
    if (document.lockedByUserId !== actor.userId) {
      await this.store.documents.setLock(actor.tenantId, documentId, actor.userId);
      await this.store.documents.log(actor.tenantId, actor.userId, { documentId, action: 'lock' });
    }
    return this.summary(actor, documentId);
  }

  /** Người giữ khoá tự mở; khoá của người khác cần quyền quản trị kho. */
  async unlock(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    const document = await this.visibleDocument(actor, documentId);
    if (!document.lockedByUserId) return this.summary(actor, documentId);
    if (document.lockedByUserId !== actor.userId && !isSharedManager(actor)) {
      throw new SharedForbiddenError('Chỉ người giữ khoá hoặc quản trị kho mở được khoá này.');
    }
    await this.store.documents.setLock(actor.tenantId, documentId, null);
    await this.store.documents.log(actor.tenantId, actor.userId, { documentId, action: 'unlock' });
    return this.summary(actor, documentId);
  }

  /**
   * Lưu trữ (vào Thùng rác). Tệp vật lý vẫn nằm trong kho và vẫn tính vào
   * dung lượng; khôi phục được bất cứ lúc nào.
   */
  async archive(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    return this.changeStatus(actor, documentId, 'archived');
  }

  async restore(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    return this.changeStatus(actor, documentId, 'active');
  }

  /* ------------------------------------------------------------ nội bộ */

  private async changeStatus(
    actor: SharedActor,
    documentId: string,
    status: SharedDocumentStatus,
  ): Promise<SharedDocumentSummary> {
    if (!actor.canDeleteDocuments && !actor.isTenantAdmin) {
      throw new SharedForbiddenError('Bạn không có quyền lưu trữ hay khôi phục tài liệu.');
    }
    const document = await this.visibleDocument(actor, documentId);
    if (document.status !== status) {
      if (status === 'active') await this.activeFolder(actor, document.folderId);
      await this.store.documents.setStatus(actor.tenantId, documentId, status);
      await this.store.documents.log(actor.tenantId, actor.userId, {
        documentId,
        action: status === 'archived' ? 'archive' : 'restore',
      });
    }
    return this.summary(actor, documentId);
  }

  private async summary(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    const row = await this.visibleDocument(actor, documentId);
    const paths = folderPaths(await this.store.folders.list(actor.tenantId));
    return { ...row, folderPath: paths.get(row.folderId) ?? '' };
  }

  private async activeFolder(actor: SharedActor, folderId: string): Promise<SharedFolder> {
    const folder = await this.store.folders.find(actor.tenantId, folderId);
    if (!folder || !folder.isActive) throw new SharedFolderNotFoundError(folderId);
    return folder;
  }

  private async visibleDocument(actor: SharedActor, documentId: string): Promise<DocumentRow> {
    const document = await this.store.documents.find(actor.tenantId, documentId);
    if (!document || !canSee(actor, document)) throw new SharedDocumentNotFoundError(documentId);
    return document;
  }

  private requireWrite(actor: SharedActor): void {
    if (!actor.canWriteDocuments && !isSharedManager(actor)) {
      throw new SharedForbiddenError('Bạn không có quyền ghi tài liệu công ty.');
    }
  }

  private requireNotLockedByOther(actor: SharedActor, document: DocumentRow): void {
    if (document.lockedByUserId && document.lockedByUserId !== actor.userId) {
      throw new SharedDocumentLockedError();
    }
  }

  /**
   * Khoá object: một bucket dùng chung, tách theo prefix tenant — trùng prefix
   * mà quy trình xoá tenant dọn — cộng UUID để hai lượt tải cùng tên không đụng
   * ràng buộc UNIQUE của `storage_key`.
   */
  private storageKey(actor: SharedActor, versionNo: number, fileName: string): string {
    const safeName = fileName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-80);
    return `tenants/${actor.tenantId}/shared/${randomUUID()}/v${versionNo}-${safeName || 'file'}`;
  }
}

/* ----------------------------------------------------------- hàm thuần */

/**
 * Ai thấy tài liệu nào theo độ mật:
 *
 * - Nội bộ: mọi người vào được phân hệ;
 * - Hạn chế: người có quyền ghi tài liệu trở lên;
 * - Mật: quản trị kho, quản trị tenant và chính người tạo.
 */
export function canSee(actor: SharedActor, document: Pick<DocumentRow, 'confidentiality' | 'createdBy'>): boolean {
  if (isSharedManager(actor) || document.createdBy === actor.userId) return true;
  if (document.confidentiality === 'confidential') return false;
  if (document.confidentiality === 'restricted') return actor.canWriteDocuments;
  return true;
}

/** Sắp theo cấp rồi theo tên, số đứng đầu tên so theo giá trị ("2." trước "10."). */
export function sortFolders(folders: readonly SharedFolder[]): SharedFolder[] {
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  return [...folders].sort(
    (left, right) => left.depth - right.depth || collator.compare(left.name, right.name),
  );
}

/** Đường dẫn "A / B / C" của mọi thư mục. */
export function folderPaths(folders: readonly SharedFolder[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const resolve = (id: string, guard: number): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    if (!folder) return '';
    const parent = folder.parentId && guard < 10 ? resolve(folder.parentId, guard + 1) : '';
    const path = parent ? `${parent} / ${folder.name}` : folder.name;
    paths.set(id, path);
    return path;
  };
  for (const folder of folders) resolve(folder.id, 0);
  return paths;
}

/** Thư mục và mọi con cháu đang dùng của nó. */
export function branchOf(folders: readonly SharedFolder[], folderId: string): Set<string> {
  const branch = new Set([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of folders) {
      if (item.parentId && branch.has(item.parentId) && !branch.has(item.id)) {
        branch.add(item.id);
        grew = true;
      }
    }
  }
  return branch;
}

/**
 * Thông tin hồ sơ từ một yêu cầu ghi. Trường không gửi thì giữ giá trị cũ
 * (`current`); gửi chuỗi rỗng là xoá.
 */
function recordMeta(input: SharedRecordMeta | undefined, current?: SharedRecordMeta): RecordMetaInput {
  const pick = <K extends keyof SharedRecordMeta>(key: K) =>
    input?.[key] === undefined ? current?.[key] : input[key];
  const kind = pick('docKind');
  return {
    docKind: kind ? parseKindStrict(kind) : null,
    docNumber: optionalText(pick('docNumber'), 'Số hiệu', 120),
    partner: optionalText(pick('partner'), 'Đối tác', 255),
    issuedOn: optionalDate(pick('issuedOn'), 'Ngày ký, ban hành'),
    effectiveTo: optionalDate(pick('effectiveTo'), 'Hiệu lực đến'),
  };
}

function validateFile(
  fileName: unknown,
  contentType: unknown,
  sizeBytes: unknown,
): { fileName: string; contentType: string; sizeBytes: number } {
  const name = requireText(fileName, 'Tên tệp', 255);
  const type = String(contentType ?? '').trim();
  if (!SHARED_ALLOWED_CONTENT_TYPES.includes(type)) {
    throw new SharedValidationError(`Không hỗ trợ loại tệp "${type || '(trống)'}".`);
  }
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size < 0) {
    throw new SharedValidationError('Dung lượng tệp không hợp lệ.');
  }
  if (size > SHARED_DOCUMENT_MAX_BYTES) {
    throw new SharedValidationError(
      `Tệp không được vượt quá ${Math.round(SHARED_DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`,
    );
  }
  return { fileName: name, contentType: type, sizeBytes: Math.round(size) };
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new SharedValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new SharedValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new SharedValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new SharedValidationError(`${label} phải là ngày dạng YYYY-MM-DD.`);
  }
  return text;
}

function requireRange(from: string | null, to: string | null): void {
  if (from && to && from > to) {
    throw new SharedValidationError('Ngày hiệu lực từ phải trước ngày hiệu lực đến.');
  }
}

function parseTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SharedValidationError('Thẻ phải là danh sách.');
  const tags = [...new Set(value.map((tag) => String(tag ?? '').trim()).filter(Boolean))];
  if (tags.length > 20) throw new SharedValidationError('Tối đa 20 thẻ cho một tài liệu.');
  if (tags.some((tag) => tag.length > 60)) {
    throw new SharedValidationError('Mỗi thẻ không dài quá 60 ký tự.');
  }
  return tags;
}

function parseStatus(value: unknown): SharedDocumentStatus | undefined {
  const text = String(value ?? '');
  return (SHARED_DOCUMENT_STATUSES as readonly string[]).includes(text)
    ? (text as SharedDocumentStatus)
    : undefined;
}

function parseKind(value: unknown): SharedDocumentKind | undefined {
  const text = String(value ?? '');
  return (SHARED_DOCUMENT_KINDS as readonly string[]).includes(text)
    ? (text as SharedDocumentKind)
    : undefined;
}

function parseKindStrict(value: unknown): SharedDocumentKind {
  const kind = parseKind(value);
  if (!kind) throw new SharedValidationError(`Loại tài liệu "${String(value)}" không hợp lệ.`);
  return kind;
}

function parseConfidentiality(value: unknown): SharedConfidentiality | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value);
  if (!(SHARED_CONFIDENTIALITY_LEVELS as readonly string[]).includes(text)) {
    throw new SharedValidationError(`Độ mật "${text}" không hợp lệ.`);
  }
  return text as SharedConfidentiality;
}
