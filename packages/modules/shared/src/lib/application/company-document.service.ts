import { S3ObjectStorage, type ObjectStorageManagementPort } from '@enterprise-platform/adapter-storage';
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
  type EmptySharedTrashResult,
  type RestoreSharedTrashRequest,
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
  type SharedFolderDeleteResult,
  type SharedFolderRole,
  type SharedRecordMeta,
  type SharedTrashItem,
  type SharedTrashKind,
  type SharedTrashRestoreResult,
  type SharedUploadTicket,
  type UpdateSharedDocumentRequest,
  type UpdateSharedFolderRequest,
} from '@enterprise-platform/contracts-shared';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SharedDocumentLockedError,
  SharedDocumentNotFoundError,
  SharedFolderLockedError,
  SharedFolderNotFoundError,
  SharedFolderUnavailableError,
  SharedForbiddenError,
  SharedNameTakenError,
  SharedValidationError,
} from '../domain/shared.error.js';
import {
  canDeleteIn,
  canSee,
  canWriteIn,
  type FolderAccess,
  type FolderAccessService,
} from './folder-access.js';
import { isSharedManager, type SharedActor } from './shared-actor.js';
import type { DocumentRow, PurgeResult, RecordMetaInput, SharedStore } from './shared-store.port.js';
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
 * - không có khái niệm dự án; quyền đi theo chia sẻ thư mục (xem
 *   `folder-access.ts`), quyền phân hệ là trần của việc ghi và xoá;
 * - thư mục và tài liệu mang thông tin hồ sơ (loại, số hiệu, đối tác, hiệu lực);
 * - mỗi lượt tải lên đi qua hạn mức dung lượng chung của tenant.
 *
 * Thư mục người gọi không được vào thì coi như không có (404), để không lộ
 * thư mục của phòng ban khác.
 */
export class CompanyDocumentService {
  constructor(
    private readonly store: SharedStore,
    private readonly quota: StorageQuotaService,
    private readonly access: FolderAccessService,
    private readonly storage: ObjectStorageManagementPort = new S3ObjectStorage({
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

  private readonly logger = new Logger(CompanyDocumentService.name);

  /* ------------------------------------------------------------ thư mục */

  /** Thư mục người gọi được vào, kèm quyền của họ ở từng thư mục. */
  async folders(actor: SharedActor): Promise<SharedFolder[]> {
    const [folders, access] = await Promise.all([
      this.store.folders.list(actor.tenantId),
      this.access.forActor(actor),
    ]);
    return sortFolders(withAccess(folders, access));
  }

  /**
   * Thư mục gốc là khung của cả kho ("3. HỢP ĐỒNG", "4. HC_TH"…) nên chỉ người
   * quản trị kho dựng; thư mục con — một hồ sơ hợp đồng, một năm — thì người
   * có quyền Sửa ở thư mục cha tự tạo, và thành chủ sở hữu của nó.
   */
  async createFolder(actor: SharedActor, input: CreateSharedFolderRequest): Promise<SharedFolder> {
    const name = requireText(input?.name, 'Tên thư mục', 180);
    let depth = 0;
    if (input.parentId) {
      const { folder: parent, role } = await this.activeFolder(actor, await this.access.forActor(actor), input.parentId);
      if (!canWriteIn(actor, role)) {
        throw new SharedForbiddenError(`Bạn không có quyền tạo thư mục trong “${parent.name}”.`);
      }
      depth = parent.depth + 1;
      if (depth > SHARED_MAX_FOLDER_DEPTH - 1) {
        throw new SharedValidationError(`Cây thư mục tối đa ${SHARED_MAX_FOLDER_DEPTH} cấp.`);
      }
    } else if (!isSharedManager(actor)) {
      throw new SharedForbiddenError('Chỉ người quản trị kho tạo được thư mục gốc.');
    }

    const created = await this.store.folders.create(actor.tenantId, actor.userId, {
      parentId: input.parentId ?? null,
      name,
      depth,
      note: optionalText(input.note, 'Ghi chú', 2000),
      ...recordMeta(input),
    });
    // Người tạo là chủ sở hữu.
    return { ...created, access: 'manager' };
  }

  /**
   * Đổi tên, sửa thông tin hồ sơ, hoặc chuyển thư mục.
   *
   * Sửa tên và thông tin: quyền Sửa ở thư mục. Chuyển chỗ đổi khung của kho nên
   * chỉ người quản trị; cả nhánh đi theo và vẫn phải nằm trong giới hạn cấp.
   */
  async updateFolder(
    actor: SharedActor,
    folderId: string,
    input: UpdateSharedFolderRequest,
  ): Promise<SharedFolder> {
    const { folder, role } = await this.activeFolder(actor, await this.access.forActor(actor), folderId);
    if (!canWriteIn(actor, role)) throw new SharedForbiddenError('Bạn không có quyền sửa thư mục này.');
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

    const updated = await this.store.folders.update(actor.tenantId, folderId, {
      name,
      parentId,
      depthDelta,
      note: patch.note === undefined ? folder.note ?? null : optionalText(patch.note, 'Ghi chú', 2000),
      ...recordMeta(patch, folder),
    });
    // Chỉ quản trị kho chuyển được thư mục, và họ là Quản lý ở mọi chỗ: quyền không đổi.
    return { ...updated, access: role };
  }

  /**
   * Xoá thư mục: cả nhánh và mọi tài liệu bên trong vào Thùng rác, khôi phục
   * được. Thư mục gốc của kho chỉ người quản trị kho xoá — cũng như chỉ họ dựng.
   */
  async deleteFolder(actor: SharedActor, folderId: string): Promise<SharedFolderDeleteResult> {
    this.requireDelete(actor, 'Bạn không có quyền xoá thư mục.');
    const access = await this.access.forActor(actor);
    const { folder, role } = await this.activeFolder(actor, access, folderId);
    if (!canDeleteIn(actor, role)) throw new SharedForbiddenError('Bạn không có quyền xoá thư mục này.');
    if (folder.depth === 0 && !isSharedManager(actor)) {
      throw new SharedForbiddenError('Chỉ người quản trị kho xoá được thư mục gốc.');
    }
    const branch = [...branchOf(await this.store.folders.list(actor.tenantId), folder.id)];
    const locked = await this.store.documents.countLockedByOthers(actor.tenantId, branch, actor.userId);
    if (locked > 0) throw new SharedFolderLockedError(locked);
    if (!isSharedManager(actor)) {
      // Không xoá hộ những tài liệu mà chính người xoá không được thấy. Cả nhánh
      // có quyền Sửa trở lên (quyền chỉ cộng dồn xuống), nên chỉ còn tài liệu
      // Mật ở những thư mục người xoá không quản lý.
      const unmanaged = branch.filter((id) => access.roleOf(id) !== 'manager');
      const hidden =
        unmanaged.length === 0
          ? 0
          : await this.store.documents.countHiddenFrom(actor.tenantId, unmanaged, {
              userId: actor.userId,
              canSeeRestricted: true,
            });
      if (hidden > 0) {
        throw new SharedForbiddenError(
          `Thư mục có ${hidden} tài liệu bạn không có quyền xem nên bạn không xoá được.`,
        );
      }
    }
    return this.store.folders.trash(actor.tenantId, folder.id, actor.userId);
  }

  /* ----------------------------------------------------------- tài liệu */

  async list(actor: SharedActor, query: SharedDocumentQuery): Promise<SharedDocumentSummary[]> {
    const status = parseStatus(query?.status) ?? 'active';
    const search = query?.search?.trim() || undefined;
    const access = await this.access.forActor(actor);
    if (query?.folderId) await this.activeFolder(actor, access, query.folderId);
    const folders = await this.store.folders.list(actor.tenantId);
    const visible = withAccess(folders, access);
    if (visible.length === 0) return [];
    const expiring = Number(query?.expiringWithinDays);
    const rows = await this.store.documents.list(actor.tenantId, {
      folderId: query?.folderId,
      // Tìm cả kho thì chỉ trong những thư mục người gọi được vào.
      folderIds: access.everything || query?.folderId ? undefined : visible.map((folder) => folder.id),
      search,
      kind: parseKind(query?.kind),
      status,
      expiringWithinDays: Number.isInteger(expiring) && expiring >= 0 ? Math.min(expiring, 3650) : undefined,
      limit: query?.folderId && !search ? FOLDER_LIMIT : SEARCH_LIMIT,
    });
    const paths = folderPaths(visible);
    return rows
      .filter((row) => canSee(actor, row, access.roleOf(row.folderId)))
      .map((row) => ({ ...row, folderPath: paths.get(row.folderId) ?? '' }));
  }

  async detail(actor: SharedActor, documentId: string): Promise<SharedDocumentDetail> {
    const access = await this.access.forActor(actor);
    const document = await this.visibleDocument(actor, access, documentId);
    const [versions, accessLog, folders] = await Promise.all([
      this.store.documents.listVersions(actor.tenantId, documentId),
      this.store.documents.accessLog(actor.tenantId, documentId, 30),
      this.store.folders.list(actor.tenantId),
    ]);
    // Mở thông tin không ghi nhật ký; "xem" chỉ tính khi mở tệp (download chế độ preview).
    return {
      ...document,
      folderPath: folderPaths(withAccess(folders, access)).get(document.folderId) ?? '',
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
    const { folder, role } = await this.activeFolder(actor, await this.access.forActor(actor), input.folderId);
    if (!canWriteIn(actor, role)) {
      throw new SharedForbiddenError(`Bạn không có quyền tải tài liệu lên “${folder.name}”.`);
    }
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
    const access = await this.access.forActor(actor);
    const document = await this.writableDocument(actor, access, documentId);
    if (document.status !== 'active') {
      throw new SharedValidationError('Tài liệu đã lưu trữ; khôi phục trước khi sửa.');
    }
    this.requireNotLockedByOther(actor, document);
    const patch = input ?? {};

    let folderId = document.folderId;
    if (patch.folderId && patch.folderId !== document.folderId) {
      const { folder: target, role } = await this.activeFolder(actor, access, patch.folderId);
      if (!canWriteIn(actor, role)) {
        throw new SharedForbiddenError(`Bạn không có quyền đưa tài liệu vào “${target.name}”.`);
      }
      folderId = target.id;
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
    return this.summary(actor, documentId, access);
  }

  /** Phiên bản mới; bắt buộc ghi chú thay đổi. Người khác đang khoá thì từ chối. */
  async addVersion(
    actor: SharedActor,
    documentId: string,
    input: CreateSharedVersionRequest,
  ): Promise<SharedUploadTicket> {
    this.requireWrite(actor);
    const document = await this.writableDocument(actor, await this.access.forActor(actor), documentId);
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
    await this.writableDocument(actor, await this.access.forActor(actor), documentId);
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
    const document = await this.visibleDocument(actor, await this.access.forActor(actor), documentId);
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
    const access = await this.access.forActor(actor);
    const document = await this.writableDocument(actor, access, documentId);
    this.requireNotLockedByOther(actor, document);
    if (document.lockedByUserId !== actor.userId) {
      await this.store.documents.setLock(actor.tenantId, documentId, actor.userId);
      await this.store.documents.log(actor.tenantId, actor.userId, { documentId, action: 'lock' });
    }
    return this.summary(actor, documentId, access);
  }

  /** Người giữ khoá tự mở; khoá của người khác cần quyền Quản lý ở thư mục, hoặc quản trị kho. */
  async unlock(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    const access = await this.access.forActor(actor);
    const document = await this.visibleDocument(actor, access, documentId);
    if (!document.lockedByUserId) return this.summary(actor, documentId, access);
    if (document.lockedByUserId !== actor.userId && access.roleOf(document.folderId) !== 'manager') {
      throw new SharedForbiddenError('Chỉ người giữ khoá hoặc người quản lý thư mục mở được khoá này.');
    }
    await this.store.documents.setLock(actor.tenantId, documentId, null);
    await this.store.documents.log(actor.tenantId, actor.userId, { documentId, action: 'unlock' });
    return this.summary(actor, documentId, access);
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

  /* --------------------------------------------------- xoá, Thùng rác, nhân bản */

  /** Xoá tài liệu: vào Thùng rác, khôi phục được. Tệp vẫn nằm trong kho. */
  async deleteDocument(actor: SharedActor, documentId: string): Promise<void> {
    this.requireDelete(actor, 'Bạn không có quyền xoá tài liệu.');
    const access = await this.access.forActor(actor);
    const document = await this.visibleDocument(actor, access, documentId);
    if (!canDeleteIn(actor, access.roleOf(document.folderId))) {
      throw new SharedForbiddenError('Bạn không có quyền xoá tài liệu trong thư mục này.');
    }
    this.requireNotLockedByOther(actor, document);
    await this.store.documents.trash(actor.tenantId, documentId, actor.userId);
    await this.store.documents.log(actor.tenantId, actor.userId, { documentId, action: 'delete' });
  }

  /**
   * Thùng rác của tenant, phần người gọi được động vào: mục nằm ở thư mục họ có
   * quyền Sửa trở lên. Tài liệu mật chỉ hiện với người được xem chúng. Vị trí
   * cũ chỉ ghi những thư mục họ vào được, như cây thư mục của họ.
   */
  async trash(actor: SharedActor): Promise<SharedTrashItem[]> {
    this.requireDelete(actor, 'Bạn không có quyền xem Thùng rác.');
    const [items, access] = await Promise.all([this.store.trash.list(actor.tenantId), this.access.forActor(actor)]);
    if (access.everything) return items;
    const paths = folderPaths(access.folders.filter((folder) => access.roleOf(folder.id)));
    const parentOf = new Map(access.folders.map((folder) => [folder.id, folder.parentId]));
    return items
      .filter((item) => {
        const role = access.roleOf(item.kind === 'folder' ? item.id : item.folderId);
        if (!canDeleteIn(actor, role)) return false;
        return (
          item.kind === 'folder' ||
          canSee(actor, { confidentiality: item.confidentiality ?? 'internal', createdBy: item.createdBy ?? '' }, role)
        );
      })
      .map((item) => {
        const parentId = item.kind === 'folder' ? parentOf.get(item.id) : item.folderId;
        return { ...item, location: parentId ? (paths.get(parentId) ?? '') : '' };
      });
  }

  /**
   * Khôi phục về chỗ cũ, hoặc vào `targetFolderId` khi chỗ cũ không còn. Chỗ đó
   * đã có mục cùng tên thì mục khôi phục mang thêm hậu tố "(khôi phục)".
   */
  async restoreFromTrash(
    actor: SharedActor,
    kind: SharedTrashKind,
    id: string,
    input?: RestoreSharedTrashRequest,
  ): Promise<SharedTrashRestoreResult> {
    this.requireDelete(actor, 'Bạn không có quyền khôi phục từ Thùng rác.');
    const targetFolderId = input?.targetFolderId || undefined;
    const access = await this.access.forActor(actor);

    if (kind === 'folder') {
      const trashed = await this.store.folders.findTrashed(actor.tenantId, id);
      // Mục người gọi không thấy trong Thùng rác của họ thì như không có.
      if (!trashed || !canDeleteIn(actor, access.roleOf(id))) throw new SharedFolderNotFoundError(id);
      const { folder } = trashed;

      let parentId: string | null;
      let depth: number;
      if (targetFolderId || folder.parentId) {
        const parent = await this.availableFolder(actor, access, targetFolderId ?? (folder.parentId as string), {
          chosen: Boolean(targetFolderId),
        });
        parentId = parent.id;
        depth = parent.depth + 1;
      } else {
        if (!isSharedManager(actor)) {
          throw new SharedForbiddenError('Chỉ người quản trị kho khôi phục được thư mục gốc.');
        }
        parentId = null;
        depth = 0;
      }
      const depthDelta = depth - folder.depth;
      if (trashed.maxDepth + depthDelta > SHARED_MAX_FOLDER_DEPTH - 1) {
        throw new SharedValidationError(`Cây thư mục tối đa ${SHARED_MAX_FOLDER_DEPTH} cấp.`);
      }
      const restored = await withFreeName(folder.name, 180, 'khôi phục', (name) =>
        this.store.folders.restoreBranch(actor.tenantId, id, { parentId, name, depthDelta }),
      );
      return { kind, id, name: restored.name };
    }

    const document = await this.trashedDocument(actor, access, id);
    if (!canDeleteIn(actor, access.roleOf(document.folderId))) throw new SharedDocumentNotFoundError(id);
    const folder = await this.availableFolder(actor, access, targetFolderId ?? document.folderId, {
      chosen: Boolean(targetFolderId),
    });
    const restored = await withFreeName(document.name, 255, 'khôi phục', (name) =>
      this.store.documents.restoreFromTrash(actor.tenantId, id, { folderId: folder.id, name }),
    );
    await this.store.documents.log(actor.tenantId, actor.userId, { documentId: id, action: 'restore' });
    return { kind, id, name: restored.name };
  }

  /**
   * Xoá vĩnh viễn một mục trong Thùng rác: dòng cơ sở dữ liệu, mọi phiên bản và
   * tệp trong kho. Dung lượng trả lại cho hạn mức của tenant.
   */
  async purge(actor: SharedActor, kind: SharedTrashKind, id: string): Promise<void> {
    this.requirePurge(actor);
    await this.purgeItem(actor, await this.access.forActor(actor), kind, id);
  }

  /** Dọn sạch Thùng rác. Mục nào hỏng thì bỏ qua và đếm, không dừng cả lượt. */
  async emptyTrash(actor: SharedActor): Promise<EmptySharedTrashResult> {
    this.requirePurge(actor);
    const access = await this.access.forActor(actor);
    // Thư mục trước: xoá nó kéo theo cả tài liệu từng bị xoá riêng khỏi nhánh đó.
    const items = (await this.store.trash.list(actor.tenantId)).sort(
      (left, right) => Number(right.kind === 'folder') - Number(left.kind === 'folder'),
    );
    let purged = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await this.purgeItem(actor, access, item.kind, item.id);
        purged += 1;
      } catch (error) {
        // Đã đi theo thư mục vừa xoá: không phải lỗi.
        if (error instanceof SharedDocumentNotFoundError || error instanceof SharedFolderNotFoundError) continue;
        failed += 1;
        this.logger.error(
          `Không xoá vĩnh viễn được ${item.kind} ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { purged, failed };
  }

  /**
   * Nhân bản tài liệu trong cùng thư mục: một tài liệu mới có phiên bản đầu là
   * bản hiện hành của tài liệu gốc. Tệp sao chép ngay trong kho, không qua máy
   * chủ ứng dụng, và tính vào hạn mức dung lượng.
   */
  async duplicate(actor: SharedActor, documentId: string): Promise<SharedDocumentSummary> {
    this.requireWrite(actor);
    const access = await this.access.forActor(actor);
    const document = await this.writableDocument(actor, access, documentId);
    if (document.status !== 'active') {
      throw new SharedValidationError('Tài liệu đã lưu trữ; khôi phục trước khi nhân bản.');
    }
    const source = document.currentVersion;
    if (!source || source.sizeBytes == null) {
      throw new SharedValidationError('Phiên bản hiện hành chưa tải lên xong, chưa nhân bản được.');
    }
    const sourceKey = await this.store.documents.storageKeyOf(actor.tenantId, source.id);
    if (!sourceKey) throw new SharedDocumentNotFoundError(source.id);
    const sizeBytes = source.sizeBytes;
    await this.quota.ensureCapacity(actor.tenantId, sizeBytes);

    const siblings = await this.store.documents.list(actor.tenantId, {
      folderId: document.folderId,
      status: 'active',
      limit: FOLDER_LIMIT,
    });
    const taken = new Set(siblings.map((entry) => entry.name.toLowerCase()));
    let name = `${document.name.slice(0, 255 - ' (bản sao)'.length)} (bản sao)`;
    for (let n = 2; taken.has(name.toLowerCase()) && n <= 100; n += 1) {
      const tail = ` (bản sao ${n})`;
      name = `${document.name.slice(0, 255 - tail.length)}${tail}`;
    }

    const storageKey = this.storageKey(actor, 1, source.fileName);
    await this.storage.copyObject({ from: sourceKey, to: storageKey });
    let created: Awaited<ReturnType<SharedStore['documents']['create']>>;
    try {
      created = await this.store.documents.create(actor.tenantId, actor.userId, {
        folderId: document.folderId,
        name,
        description: document.description ?? null,
        effectiveFrom: document.effectiveFrom ?? null,
        confidentiality: document.confidentiality,
        tags: document.tags,
        sourceLabel: document.sourceLabel ?? null,
        storageKey,
        fileName: source.fileName,
        contentType: source.contentType,
        changeNote: `Nhân bản từ "${document.name}"`.slice(0, 500),
        docKind: document.docKind ?? null,
        docNumber: document.docNumber ?? null,
        partner: document.partner ?? null,
        issuedOn: document.issuedOn ?? null,
        effectiveTo: document.effectiveTo ?? null,
      });
    } catch (error) {
      // Chưa có dòng nào trỏ tới bản sao: dọn tệp vừa chép.
      await this.removeFiles([storageKey]);
      throw error;
    }
    await this.store.documents.completeVersion(actor.tenantId, created.version.id, sizeBytes);
    await this.store.documents.log(actor.tenantId, actor.userId, {
      documentId: created.document.id,
      versionId: created.version.id,
      action: 'upload',
    });
    return this.summary(actor, created.document.id, access);
  }

  /* ------------------------------------------------------------ nội bộ */

  private async purgeItem(actor: SharedActor, access: FolderAccess, kind: SharedTrashKind, id: string): Promise<void> {
    let result: PurgeResult;
    if (kind === 'folder') {
      if (!(await this.store.folders.findTrashed(actor.tenantId, id))) throw new SharedFolderNotFoundError(id);
      result = await this.store.folders.purgeBranch(actor.tenantId, id, actor.userId);
    } else {
      const document = await this.trashedDocument(actor, access, id);
      result = await this.store.documents.purge(actor.tenantId, document.id, actor.userId);
    }
    await this.removeFiles(result.storageKeys);
  }

  private async changeStatus(
    actor: SharedActor,
    documentId: string,
    status: SharedDocumentStatus,
  ): Promise<SharedDocumentSummary> {
    if (!actor.canDeleteDocuments && !actor.isTenantAdmin) {
      throw new SharedForbiddenError('Bạn không có quyền lưu trữ hay khôi phục tài liệu.');
    }
    const access = await this.access.forActor(actor);
    const document = await this.visibleDocument(actor, access, documentId);
    if (!canDeleteIn(actor, access.roleOf(document.folderId))) {
      throw new SharedForbiddenError('Bạn không có quyền lưu trữ hay khôi phục tài liệu trong thư mục này.');
    }
    if (document.status !== status) {
      if (status === 'active') await this.activeFolder(actor, access, document.folderId);
      await this.store.documents.setStatus(actor.tenantId, documentId, status);
      await this.store.documents.log(actor.tenantId, actor.userId, {
        documentId,
        action: status === 'archived' ? 'archive' : 'restore',
      });
    }
    return this.summary(actor, documentId, access);
  }

  private async summary(
    actor: SharedActor,
    documentId: string,
    known?: FolderAccess,
  ): Promise<SharedDocumentSummary> {
    const access = known ?? (await this.access.forActor(actor));
    const row = await this.visibleDocument(actor, access, documentId);
    const paths = folderPaths(withAccess(await this.store.folders.list(actor.tenantId), access));
    return { ...row, folderPath: paths.get(row.folderId) ?? '' };
  }

  /** Thư mục đang dùng mà người gọi được vào, kèm quyền của họ; không thì như không có. */
  private async activeFolder(
    actor: SharedActor,
    access: FolderAccess,
    folderId: string,
  ): Promise<{ folder: SharedFolder; role: SharedFolderRole }> {
    const role = access.roleOf(folderId);
    const folder = role ? await this.store.folders.find(actor.tenantId, folderId) : undefined;
    if (!role || !folder || !folder.isActive) throw new SharedFolderNotFoundError(folderId);
    return { folder: { ...folder, access: role }, role };
  }

  /**
   * Tài liệu người gọi được xem: vào được thư mục chứa nó và đủ quyền theo độ
   * mật. Tài liệu trong Thùng rác coi như không có, trừ khi nơi gọi chủ động hỏi
   * `trashed` (khôi phục, xoá vĩnh viễn).
   */
  private async visibleDocument(
    actor: SharedActor,
    access: FolderAccess,
    documentId: string,
    options: { trashed?: boolean } = {},
  ): Promise<DocumentRow> {
    const document = await this.store.documents.find(actor.tenantId, documentId);
    if (
      !document ||
      !canSee(actor, document, access.roleOf(document.folderId)) ||
      Boolean(document.deletedAt) !== Boolean(options.trashed)
    ) {
      throw new SharedDocumentNotFoundError(documentId);
    }
    return document;
  }

  /** Tài liệu người gọi được ghi: thấy được, và có quyền Sửa ở thư mục chứa nó. */
  private async writableDocument(actor: SharedActor, access: FolderAccess, documentId: string): Promise<DocumentRow> {
    const document = await this.visibleDocument(actor, access, documentId);
    if (!canWriteIn(actor, access.roleOf(document.folderId))) {
      throw new SharedForbiddenError('Bạn chỉ có quyền xem tài liệu trong thư mục này.');
    }
    return document;
  }

  private trashedDocument(actor: SharedActor, access: FolderAccess, documentId: string): Promise<DocumentRow> {
    return this.visibleDocument(actor, access, documentId, { trashed: true });
  }

  /**
   * Thư mục dùng được làm chỗ khôi phục; không thì để người dùng chọn chỗ khác.
   * Chỗ do người dùng chọn (`chosen`) phải là thư mục họ có quyền Sửa; về chỗ cũ
   * thì quyền ở chính mục được khôi phục là đủ.
   */
  private async availableFolder(
    actor: SharedActor,
    access: FolderAccess,
    folderId: string,
    options: { chosen: boolean },
  ): Promise<SharedFolder> {
    const folder = await this.store.folders.find(actor.tenantId, folderId);
    if (!folder || !folder.isActive) throw new SharedFolderUnavailableError();
    if (options.chosen && !canDeleteIn(actor, access.roleOf(folder.id))) {
      throw new SharedForbiddenError(`Bạn không có quyền khôi phục vào “${folder.name}”.`);
    }
    return folder;
  }

  private requireDelete(actor: SharedActor, message: string): void {
    if (!actor.canDeleteDocuments && !actor.isTenantAdmin) throw new SharedForbiddenError(message);
  }

  /** Xoá vĩnh viễn không có đường lùi: cần cả quyền xoá lẫn quyền quản trị kho. */
  private requirePurge(actor: SharedActor): void {
    const allowed = actor.isTenantAdmin || (actor.canDeleteDocuments && actor.canManage);
    if (!allowed) throw new SharedForbiddenError('Chỉ quản trị kho có quyền xoá mới xoá vĩnh viễn được.');
  }

  /**
   * Xoá tệp trong kho đối tượng sau khi dòng cơ sở dữ liệu đã mất. Hỏng thì chỉ
   * ghi log: dòng đã xoá không hoàn lại được, tệp mồ côi dọn sau.
   */
  private async removeFiles(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const { failed } = await this.storage.deleteObjects(keys);
      if (failed.length > 0) {
        this.logger.error(`Kho không xoá được ${failed.length}/${keys.length} tệp: ${failed.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(
        `Không xoá được ${keys.length} tệp trong kho: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
 * Những thư mục người gọi được vào, mỗi thư mục mang quyền của họ ở đó. Thư
 * mục cha không vào được thì thư mục con hiện như một gốc trong cây của họ.
 */
export function withAccess(folders: readonly SharedFolder[], access: FolderAccess): SharedFolder[] {
  const visible: SharedFolder[] = [];
  for (const folder of folders) {
    const role = access.roleOf(folder.id);
    if (role) visible.push({ ...folder, access: role });
  }
  return visible;
}

/** Sắp theo cấp rồi theo tên, số đứng đầu tên so theo giá trị ("2." trước "10."). */
export function sortFolders(folders: readonly SharedFolder[]): SharedFolder[] {
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  return [...folders].sort(
    (left, right) => left.depth - right.depth || collator.compare(left.name, right.name),
  );
}

/**
 * Đường dẫn "A / B / C" của mọi thư mục trong danh sách. Đi lên tới thư mục cha
 * đầu tiên vắng mặt: truyền vào thư mục người gọi được vào thì đường dẫn bắt
 * đầu từ chỗ cây của họ bắt đầu.
 */
export function folderPaths(
  folders: readonly Pick<SharedFolder, 'id' | 'parentId' | 'name'>[],
): Map<string, string> {
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

/** Lần đổi tên tối đa khi khôi phục vào chỗ đã có mục cùng tên. */
const MAX_RESTORE_RENAMES = 50;

/**
 * Thử `attempt` với tên gốc, rồi "tên (khôi phục)", "tên (khôi phục 2)"… cho
 * tới khi không trùng. Thùng rác không được kẹt vì chỗ cũ đã có mục cùng tên.
 */
export async function withFreeName<TValue>(
  base: string,
  maxLength: number,
  suffix: string,
  attempt: (name: string) => Promise<TValue>,
): Promise<{ name: string; value: TValue }> {
  for (let n = 0; n <= MAX_RESTORE_RENAMES; n += 1) {
    const tail = n === 0 ? '' : n === 1 ? ` (${suffix})` : ` (${suffix} ${n})`;
    const name = `${base.slice(0, maxLength - tail.length)}${tail}`;
    try {
      return { name, value: await attempt(name) };
    } catch (error) {
      if (!(error instanceof SharedNameTakenError)) throw error;
    }
  }
  throw new SharedNameTakenError(base);
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
