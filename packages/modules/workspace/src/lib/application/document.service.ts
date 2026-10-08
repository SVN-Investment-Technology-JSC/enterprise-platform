import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  DOCUMENT_LINK_ENTITY_TYPES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_STATUSES,
  MAX_FOLDER_DEPTH,
  PRESIGNED_URL_TTL_SECONDS,
  PREVIEWABLE_DOCUMENT_CONTENT_TYPES,
  type AddFolderRefRequest,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type CreateFolderRequest,
  type CreateVersionRequest,
  type DocumentDetail,
  type DocumentFolder,
  type DocumentFolderRef,
  type DocumentLinkEntityType,
  type DocumentStatus,
  type DocumentSummary,
  type DocumentVersion,
  type DownloadMode,
  type DownloadTicket,
  type LinkDocumentRequest,
  type UpdateFolderRequest,
  type UploadTicket,
  type WorkspaceDocument,
} from '@enterprise-platform/contracts-workspace';
import { randomUUID } from 'node:crypto';
import {
  DocumentLockedError,
  DocumentNotFoundError,
  DocumentUnlockForbiddenError,
  EventNotFoundError,
  FolderNotFoundError,
  ProjectForbiddenError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { hasProjectRole, requireProjectRole, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Tài liệu của Workspace.
 *
 * **Máy chủ không bao giờ nhận hay gửi byte của tệp.** Nó chỉ ghi siêu dữ
 * liệu, sinh `storage_key`, và ký URL cho trình duyệt tự `PUT` hoặc `GET`
 * thẳng lên kho lưu trữ. Cùng khuôn với `AssetDocumentService` của Inventory
 * và `ProcedureAttachmentService` của Quy trình.
 */
export class DocumentService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly storage: ObjectStoragePort = new S3ObjectStorage({
      /*
       * Hai đầu nối khác nhau, như Kho, Bảo trì và Quy trình đang làm:
       *
       * - `internalEndpoint` là đường server gọi kho trong mạng nội bộ;
       * - `publicEndpoint` là host đi vào **URL ký sẵn** mà trình duyệt mở.
       *
       * Gộp làm một là hỏng: ký bằng `http://minio:9000` thì chỉ máy nằm trong
       * mạng Docker mới tải lên hay tải xuống được, người dùng thật mở link sẽ
       * gặp lỗi không phân giải được tên miền.
       */
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

  async folders(
    actor: WorkspaceActor,
    projectId?: string,
  ): Promise<readonly DocumentFolder[]> {
    if (projectId) await this.projects.access(actor, projectId);
    return this.store.document.listFolders(actor.tenantId, projectId);
  }

  async createFolder(
    actor: WorkspaceActor,
    input: CreateFolderRequest,
  ): Promise<DocumentFolder> {
    const name = requireText(input.name, 'Tên thư mục', 180);

    // Thư mục cấp đơn vị dùng chung cho cả tenant, nên chỉ quản trị viên
    // tenant được tạo; thư mục dự án mượn hàng rào thành viên của dự án.
    if (!input.projectId) {
      if (!actor.canManage && !actor.isTenantAdmin) throw new ProjectForbiddenError();
    } else {
      // Thư mục chung của dự án: mọi thành viên (trừ người chỉ xem) tự tạo và
      // quản lý được, không cần thêm quyền nào ở cấp Platform.
      requireProjectRole(await this.projects.access(actor, input.projectId), 'member');
    }

    let depth = 0;
    if (input.parentId) {
      const parent = await this.store.document.findFolder(actor.tenantId, input.parentId);
      if (!parent) throw new FolderNotFoundError(input.parentId);
      // Thư mục của dự án ĐƯỢC nằm trong thư mục cấp đơn vị: đó là cách kho
      // chung của văn thư gom tài liệu theo từng dự án ("Hợp đồng / DA-001 ·
      // … / CV-003 · …"). Chiều ngược lại vẫn cấm — một thư mục dùng chung
      // toàn tenant mà nằm trong dự án thì người ngoài dự án không tới được
      // nó — và cũng cấm trộn hai dự án khác nhau.
      const parentScope = parent.projectId ?? null;
      const childScope = input.projectId ?? null;
      if (parentScope !== childScope && !(parentScope === null && childScope !== null)) {
        throw new WorkspaceValidationError('Thư mục con phải cùng phạm vi với thư mục cha.');
      }
      depth = parent.depth + 1;
      if (depth > MAX_FOLDER_DEPTH - 1) {
        throw new WorkspaceValidationError(
          `Cây thư mục tối đa ${MAX_FOLDER_DEPTH} cấp.`,
        );
      }
    }

    return this.store.document.createFolder(actor.tenantId, actor.userId, {
      projectId: input.projectId ?? null,
      parentId: input.parentId ?? null,
      name,
      depth,
    });
  }

  /**
   * Đổi tên hoặc chuyển một thư mục sang cha khác.
   *
   * Cùng luật với lúc tạo: thư mục dự án được nằm trong kho đơn vị nhưng
   * không ngược lại, không trộn hai dự án, cây tối đa 5 cấp — tính cả nhánh
   * con cháu đi theo. Không cho chuyển vào chính nó hay vào con cháu của nó.
   */
  async updateFolder(
    actor: WorkspaceActor,
    folderId: string,
    input: UpdateFolderRequest,
  ): Promise<DocumentFolder> {
    const folder = await this.store.document.findFolder(actor.tenantId, folderId);
    if (!folder || !folder.isActive) throw new FolderNotFoundError(folderId);
    await this.requireFolderWrite(actor, folder);

    const name =
      input?.name === undefined ? folder.name : requireText(input.name, 'Tên thư mục', 180);
    const currentParent = folder.parentId ?? null;
    const parentId = input?.parentId === undefined ? currentParent : input.parentId || null;

    let depthDelta = 0;
    if (parentId !== currentParent) {
      const folders = await this.store.document.listFolders(actor.tenantId, folder.projectId);
      // Nhánh của thư mục đang chuyển: chính nó và mọi con cháu còn hoạt động.
      const branch = new Set([folder.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const item of folders) {
          if (item.parentId && branch.has(item.parentId) && !branch.has(item.id)) {
            branch.add(item.id);
            grew = true;
          }
        }
      }

      let newDepth = 0;
      if (parentId) {
        if (branch.has(parentId)) {
          throw new WorkspaceValidationError(
            'Không chuyển được thư mục vào chính nó hoặc vào thư mục con của nó.',
          );
        }
        const parent =
          folders.find((item) => item.id === parentId) ??
          (await this.store.document.findFolder(actor.tenantId, parentId));
        if (!parent || !parent.isActive) throw new FolderNotFoundError(parentId);
        const parentScope = parent.projectId ?? null;
        const childScope = folder.projectId ?? null;
        if (parentScope !== childScope && !(parentScope === null && childScope !== null)) {
          throw new WorkspaceValidationError('Thư mục con phải cùng phạm vi với thư mục cha.');
        }
        newDepth = parent.depth + 1;
      }

      depthDelta = newDepth - folder.depth;
      const deepest = Math.max(
        folder.depth,
        ...folders.filter((item) => branch.has(item.id)).map((item) => item.depth),
      );
      if (deepest + depthDelta > MAX_FOLDER_DEPTH - 1) {
        throw new WorkspaceValidationError(`Cây thư mục tối đa ${MAX_FOLDER_DEPTH} cấp.`);
      }
    }

    return this.store.document.updateFolder(actor.tenantId, folderId, {
      name,
      parentId,
      depthDelta,
    });
  }

  /**
   * Dọn sẵn đường dẫn `<gốc>/<dự án>/<công việc>` rồi trả về thư mục lá.
   *
   * Người dùng chỉ chọn **thư mục gốc** (ví dụ "Hợp đồng" của kho văn thư);
   * phần còn lại hệ thống tự lo, và lần sau tải lên cùng công việc đó thì dùng
   * lại đúng thư mục cũ chứ không đẻ thêm. Tìm theo tên trong cùng thư mục cha
   * nên hai lượt tải song song cùng lắm tạo trùng một lần, không dựng hai
   * nhánh khác nhau.
   *
   * Không có `workItemId` thì dừng ở cấp dự án — vẫn đúng khi tải tài liệu
   * chung của cả dự án.
   */
  async ensurePath(
    actor: WorkspaceActor,
    input: { rootFolderId?: string; projectId: string; workItemId?: string },
  ): Promise<DocumentFolder> {
    const root = input.rootFolderId
      ? await this.store.document.findFolder(actor.tenantId, input.rootFolderId)
      : undefined;
    if (input.rootFolderId && !root) throw new FolderNotFoundError(input.rootFolderId);

    const access = await this.projects.access(actor, input.projectId);
    requireProjectRole(access, 'member');
    if (!actor.canWriteDocuments) throw new ProjectForbiddenError();

    // Gốc phải là kho chung hoặc kho của chính dự án này.
    if (root?.projectId && root.projectId !== input.projectId) {
      throw new WorkspaceValidationError(
        'Thư mục gốc thuộc dự án khác, không đặt tài liệu của dự án này vào được.',
      );
    }

    const project = await this.store.project.findById(actor.tenantId, input.projectId);
    if (!project) throw new WorkspaceValidationError('Không tìm thấy dự án.');

    // `parent` rỗng: thư mục nằm ở cấp gốc của kho, thuộc riêng dự án.
    const ensureChild = async (
      parent: DocumentFolder | undefined,
      name: string,
    ): Promise<DocumentFolder> => {
      const siblings = await this.store.document.listFolders(actor.tenantId, input.projectId);
      const existing = siblings.find(
        (folder) =>
          (folder.parentId ?? null) === (parent?.id ?? null) &&
          (parent || folder.projectId === input.projectId) &&
          folder.isActive &&
          folder.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      if (existing) return existing;
      return this.createFolder(actor, {
        projectId: input.projectId,
        parentId: parent?.id,
        name,
      });
    };

    const projectFolder = await ensureChild(root, `${project.code} · ${project.name}`);
    if (!input.workItemId) return projectFolder;

    const item = await this.store.workItem.findById(actor.tenantId, input.workItemId);
    if (!item || item.projectId !== input.projectId) {
      throw new WorkspaceValidationError('Công việc không thuộc dự án đã chọn.');
    }
    return ensureChild(projectFolder, `${item.code} · ${item.title}`);
  }

  /**
   * Gỡ một thư mục khỏi cây.
   *
   * **Chỉ gỡ thư mục rỗng.** Còn tài liệu hay thư mục con thì từ chối và nói rõ
   * còn bao nhiêu: xoá dây chuyền một nhánh tài liệu là thao tác không có
   * đường lùi, và người bấm thường không biết bên dưới có gì.
   *
   * Thư mục không bị xoá khỏi CSDL, chỉ `is_active = false`, để tài liệu đã lưu
   * trữ vẫn còn đường dẫn mà tra ngược.
   */
  async removeFolder(actor: WorkspaceActor, folderId: string): Promise<void> {
    const folder = await this.store.document.findFolder(actor.tenantId, folderId);
    if (!folder) throw new FolderNotFoundError(folderId);

    // Thư mục chung của dự án do thành viên tự quản lý, nên thành viên xoá
    // được thư mục rỗng. Kho cấp đơn vị dùng chung cả tenant: vẫn cần quyền
    // xoá riêng, người soạn tài liệu không đương nhiên được dọn cây đó.
    if (folder.projectId) {
      requireProjectRole(await this.projects.access(actor, folder.projectId), 'member');
    } else if (!actor.canDeleteDocuments) {
      throw new ProjectForbiddenError();
    }

    const siblings = await this.store.document.listFolders(actor.tenantId, folder.projectId);
    const children = siblings.filter((item) => item.parentId === folderId && item.isActive);
    if (children.length > 0) {
      throw new WorkspaceValidationError(
        `Thư mục còn ${children.length} thư mục con. Hãy xoá hoặc chuyển chúng đi trước.`,
      );
    }
    const documents = await this.store.document.countActiveDocuments(actor.tenantId, folderId);
    if (documents > 0) {
      throw new WorkspaceValidationError(
        `Thư mục còn ${documents} tài liệu. Hãy lưu trữ chúng trước khi xoá thư mục.`,
      );
    }

    await this.store.document.deactivateFolder(actor.tenantId, folderId);
  }

  /* ----------------------------------------------------------- tài liệu */

  async list(
    actor: WorkspaceActor,
    query: {
      projectId?: string;
      folderId?: string;
      status?: string;
      search?: string;
      linkedType?: string;
      linkedId?: string;
    },
  ): Promise<readonly DocumentSummary[]> {
    if (query.projectId) await this.projects.access(actor, query.projectId);

    const linkedTo =
      query.linkedType && query.linkedId
        ? {
            entityType: query.linkedType as DocumentLinkEntityType,
            entityId: query.linkedId,
          }
        : undefined;

    const items = await this.store.document.list(actor.tenantId, {
      projectId: query.projectId,
      folderId: query.folderId,
      status: parseStatus(query.status) ?? 'active',
      search: query.search?.trim() || undefined,
      linkedTo,
    });

    // Danh sách có thể trộn nhiều dự án — kể cả khi lọc theo một dự án, vì
    // tài liệu dự án khác có thể được **tham chiếu** vào thư mục của nó. Lọc
    // lại theo quyền của dự án gốc để không ai thấy tài liệu mình không được xem.
    return this.filterVisible(actor, items, query.projectId);
  }

  async detail(actor: WorkspaceActor, documentId: string): Promise<DocumentDetail> {
    const document = await this.loadVisible(actor, documentId);
    const [versions, links, folderRefs] = await Promise.all([
      this.store.document.listVersions(actor.tenantId, documentId),
      this.store.document.listLinks(actor.tenantId, documentId),
      this.store.document.listFolderRefs(actor.tenantId, documentId),
    ]);
    await this.store.document.log(actor.tenantId, actor.userId, {
      documentId,
      action: 'view',
    });
    return { ...document, versions, links, folderRefs };
  }

  /**
   * Chặng 1 của luồng ba chặng: ghi siêu dữ liệu và trả URL ký trước.
   *
   * Chặng 2 là trình duyệt `PUT` thẳng lên `uploadUrl`; chặng 3 là trình
   * duyệt gọi `completeUpload`. Kho lưu trữ không báo lại cho server, nên cho
   * tới chặng 3 `size_bytes` để rỗng — rỗng là tín hiệu "chưa tải lên xong".
   * Ghi luôn con số client khai ở chặng 1 thì một lượt `PUT` hỏng vẫn trông
   * như tài liệu hoàn chỉnh.
   */
  async create(
    actor: WorkspaceActor,
    input: CreateDocumentRequest,
  ): Promise<CreateDocumentResponse> {
    const folder = await this.store.document.findFolder(actor.tenantId, input.folderId ?? '');
    if (!folder) throw new FolderNotFoundError(String(input.folderId ?? '(trống)'));
    await this.requireWriteAccess(actor, folder.projectId);

    const name = requireText(input.name, 'Tên tài liệu', 255);
    const file = this.validateFile(input.fileName, input.contentType, input.sizeBytes);
    // Kiểm đích gắn TRƯỚC khi ghi, để một đích sai không để lại tài liệu mồ côi.
    if (input.linkTo?.entityType && input.linkTo.entityId) {
      await this.requireLinkTarget(actor, folder.projectId, input.linkTo);
    }

    const storageKey = this.storageKey(actor, folder.projectId, 1, file.fileName);
    const created = await this.store.document.create(actor.tenantId, actor.userId, {
      folderId: folder.id,
      projectId: folder.projectId ?? null,
      name,
      description: input.description ?? null,
      storageKey,
      fileName: file.fileName,
      contentType: file.contentType,
      // Rỗng cho tới khi trình duyệt báo tải lên xong — xem `completeUpload`.
      sizeBytes: null,
      changeNote: input.note ?? null,
    });

    if (input.linkTo?.entityType && input.linkTo.entityId) {
      await this.store.document.addLink(actor.tenantId, actor.userId, {
        documentId: created.document.id,
        entityType: input.linkTo.entityType,
        entityId: input.linkTo.entityId,
      });
    }

    await this.store.document.log(actor.tenantId, actor.userId, {
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
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      }),
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
    };
  }

  /** Phiên bản mới. Phải đang giữ khoá, và bắt buộc có ghi chú thay đổi. */
  async addVersion(
    actor: WorkspaceActor,
    documentId: string,
    input: CreateVersionRequest,
  ): Promise<UploadTicket> {
    const document = await this.loadVisible(actor, documentId);
    await this.requireWriteAccess(actor, document.projectId);

    // Giữ khoá trước khi tạo phiên bản là cách duy nhất tránh hai người cùng
    // soạn rồi ghi đè nhau mà không ai biết.
    if (document.lockedByUserId !== actor.userId) {
      throw new DocumentLockedError(document.lockedByUserId ?? 'người khác');
    }

    const changeNote = requireText(input.changeNote, 'Ghi chú thay đổi', 500);
    const file = this.validateFile(input.fileName, input.contentType, input.sizeBytes);

    const versions = await this.store.document.listVersions(actor.tenantId, documentId);
    const versionNo = Math.max(0, ...versions.map((entry) => entry.versionNo)) + 1;
    const storageKey = this.storageKey(actor, document.projectId, versionNo, file.fileName);

    const version = await this.store.document.addVersion(actor.tenantId, actor.userId, {
      documentId,
      versionNo,
      storageKey,
      fileName: file.fileName,
      contentType: file.contentType,
      // Rỗng cho tới khi trình duyệt báo tải lên xong — xem `completeUpload`.
      sizeBytes: null,
      changeNote,
    });

    await this.store.document.log(actor.tenantId, actor.userId, {
      documentId,
      versionId: version.id,
      action: 'upload',
    });

    return {
      version,
      uploadUrl: await this.storage.createUploadUrl({
        key: storageKey,
        contentType: file.contentType,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      }),
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
    };
  }

  /**
   * Chặng 3: trình duyệt báo đã `PUT` xong.
   *
   * Server không kiểm được tệp có thật trên kho hay không — adapter không có
   * lệnh `HEAD`. Chặng này chỉ bảo đảm một điều: lượt `PUT` **hỏng** thì
   * không bao giờ tới đây, nên phiên bản ở lại "chưa tải lên xong".
   */
  async completeUpload(
    actor: WorkspaceActor,
    documentId: string,
    versionId: string,
    sizeBytes: unknown,
  ): Promise<DocumentVersion> {
    const document = await this.loadVisible(actor, documentId);
    await this.requireWriteAccess(actor, document.projectId);

    const version = await this.store.document.findVersion(actor.tenantId, versionId);
    if (!version || version.documentId !== documentId) throw new DocumentNotFoundError(versionId);

    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 0) {
      throw new WorkspaceValidationError('Dung lượng tệp phải là số nguyên không âm.');
    }
    if (size > DOCUMENT_MAX_BYTES) {
      throw new WorkspaceValidationError(
        `Tệp không được vượt quá ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const completed = await this.store.document.completeVersion(actor.tenantId, versionId, size);
    if (!completed) throw new DocumentNotFoundError(versionId);
    return completed;
  }

  /** URL tải xuống ký trước. `versionId` rỗng nghĩa là phiên bản hiện hành. */
  /**
   * Cấp URL ký sẵn để lấy tệp của một phiên bản.
   *
   * `preview`: chỉ cho loại tệp xem trước được, URL ép trình duyệt mở ngay tại
   * chỗ (`inline`) thay vì tải về, và nhật ký ghi là "xem" chứ không phải "tải
   * xuống".
   */
  async download(
    actor: WorkspaceActor,
    documentId: string,
    versionId?: string,
    mode: DownloadMode = 'download',
  ): Promise<DownloadTicket> {
    const document = await this.loadVisible(actor, documentId);
    const targetId = versionId ?? document.currentVersionId;
    if (!targetId) throw new DocumentNotFoundError(documentId);

    const version = await this.store.document.findVersion(actor.tenantId, targetId);
    if (!version || version.documentId !== documentId) throw new DocumentNotFoundError(targetId);
    // `sizeBytes` rỗng nghĩa là lượt tải lên chưa hoàn tất; ký URL cho một
    // object không tồn tại chỉ dẫn tới lỗi khó hiểu ở trình duyệt.
    if (version.sizeBytes == null) {
      throw new WorkspaceValidationError(
        'Phiên bản này chưa tải lên xong, chưa tải xuống được.',
      );
    }

    const preview = mode === 'preview';
    if (preview && !PREVIEWABLE_DOCUMENT_CONTENT_TYPES.includes(version.contentType)) {
      throw new WorkspaceValidationError(
        'Định dạng này chưa xem trước được, hãy tải xuống để mở.',
      );
    }

    const key = await this.store.document.storageKeyOf(actor.tenantId, version.id);
    if (!key) throw new DocumentNotFoundError(version.id);

    await this.store.document.log(actor.tenantId, actor.userId, {
      documentId,
      versionId: version.id,
      action: preview ? 'view' : 'download',
    });

    return {
      downloadUrl: await this.storage.createDownloadUrl(
        key,
        PRESIGNED_URL_TTL_SECONDS,
        preview
          ? { inline: true, contentType: version.contentType, fileName: version.fileName }
          : undefined,
      ),
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      fileName: version.fileName,
      contentType: version.contentType,
    };
  }

  async lock(actor: WorkspaceActor, documentId: string): Promise<WorkspaceDocument> {
    const document = await this.loadVisible(actor, documentId);
    await this.requireWriteAccess(actor, document.projectId);
    if (document.lockedByUserId && document.lockedByUserId !== actor.userId) {
      throw new DocumentLockedError(document.lockedByUserId);
    }
    await this.store.document.log(actor.tenantId, actor.userId, {
      documentId,
      action: 'lock',
    });
    return this.store.document.setLock(actor.tenantId, documentId, actor.userId);
  }

  /**
   * Mở khoá.
   *
   * Người đang giữ khoá tự mở được. Khoá của người khác cần vai trò quản lý
   * dự án — khoá không tự hết hạn, nên phải có đường gỡ khi người giữ đi vắng.
   */
  async unlock(actor: WorkspaceActor, documentId: string): Promise<WorkspaceDocument> {
    const document = await this.loadVisible(actor, documentId);
    if (!document.lockedByUserId) return document;

    if (document.lockedByUserId !== actor.userId) {
      const canModerate = document.projectId
        ? hasProjectRole(await this.projects.access(actor, document.projectId), 'manager')
        : actor.canManage || actor.isTenantAdmin;
      if (!canModerate) throw new DocumentUnlockForbiddenError();
    }

    await this.store.document.log(actor.tenantId, actor.userId, {
      documentId,
      action: 'unlock',
    });
    return this.store.document.setLock(actor.tenantId, documentId, null);
  }

  /**
   * Lưu trữ tài liệu.
   *
   * Chỉ chuyển `status = archived`; **tệp vật lý vẫn nằm trong kho**. Adapter
   * storage chỉ có `createUploadUrl` và `createDownloadUrl`, không có API xoá
   * object, nên dọn kho phải là một job riêng — hiện chưa module nào có.
   */
  async archive(actor: WorkspaceActor, documentId: string): Promise<WorkspaceDocument> {
    const document = await this.loadVisible(actor, documentId);
    // Quyền xoá riêng: mặc định chỉ quản trị tenant, xem `WorkspaceActor`.
    if (!actor.canDeleteDocuments) throw new ProjectForbiddenError();
    if (document.projectId) {
      const access = await this.projects.access(actor, document.projectId);
      requireProjectRole(access, 'manager');
    } else if (!actor.canManage && !actor.isTenantAdmin) {
      throw new ProjectForbiddenError();
    }
    return this.store.document.archive(actor.tenantId, documentId);
  }

  async link(actor: WorkspaceActor, documentId: string, input: LinkDocumentRequest) {
    const document = await this.loadVisible(actor, documentId);
    await this.requireWriteAccess(actor, document.projectId);
    if (!input?.entityType || !input.entityId) {
      throw new WorkspaceValidationError('Cần chỉ rõ loại và định danh thực thể để gắn.');
    }
    await this.requireLinkTarget(actor, document.projectId, input);
    return this.store.document.addLink(actor.tenantId, actor.userId, {
      documentId,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }

  async unlink(actor: WorkspaceActor, documentId: string, linkId: string): Promise<void> {
    const document = await this.loadVisible(actor, documentId);
    await this.requireWriteAccess(actor, document.projectId);

    // Xác minh liên kết thuộc đúng tài liệu này, để một id lạ không gỡ được
    // liên kết của tài liệu khác.
    const links = await this.store.document.listLinks(actor.tenantId, documentId);
    if (!links.some((link) => link.id === linkId)) throw new DocumentNotFoundError(linkId);
    await this.store.document.removeLink(actor.tenantId, linkId);
  }

  /**
   * Cho tài liệu hiện thêm ở một thư mục khác, không nhân bản tệp.
   *
   * Người gọi phải xem được tài liệu và ghi được ở thư mục đích. Thư mục đích
   * có thể thuộc dự án khác: thành viên dự án đó chỉ thấy dòng tham chiếu nếu
   * họ cũng xem được tài liệu gốc — `list` lọc theo dự án gốc.
   */
  async addFolderRef(
    actor: WorkspaceActor,
    documentId: string,
    input: AddFolderRefRequest,
  ): Promise<DocumentFolderRef> {
    const document = await this.loadVisible(actor, documentId);
    if (document.status !== 'active') {
      throw new WorkspaceValidationError('Tài liệu đã lưu trữ, không thêm vào thư mục được.');
    }
    if (!input?.folderId) throw new WorkspaceValidationError('Cần chọn thư mục.');
    const folder = await this.store.document.findFolder(actor.tenantId, input.folderId);
    if (!folder || !folder.isActive) throw new FolderNotFoundError(input.folderId);
    if (folder.id === document.folderId) {
      throw new WorkspaceValidationError('Tài liệu đã nằm sẵn trong thư mục này.');
    }
    await this.requireFolderWrite(actor, folder);
    return this.store.document.addFolderRef(actor.tenantId, actor.userId, {
      documentId,
      folderId: folder.id,
    });
  }

  /** Gỡ tài liệu khỏi một thư mục tham chiếu; tài liệu gốc không đổi. */
  async removeFolderRef(actor: WorkspaceActor, documentId: string, refId: string): Promise<void> {
    await this.loadVisible(actor, documentId);
    // Tham chiếu phải thuộc đúng tài liệu này, để một id lạ không gỡ được
    // tham chiếu của tài liệu khác.
    const refs = await this.store.document.listFolderRefs(actor.tenantId, documentId);
    const ref = refs.find((item) => item.id === refId);
    if (!ref) throw new DocumentNotFoundError(refId);
    const folder = await this.store.document.findFolder(actor.tenantId, ref.folderId);
    if (folder) await this.requireFolderWrite(actor, folder);
    await this.store.document.removeFolderRef(actor.tenantId, refId);
  }

  /* ------------------------------------------------------------ nội bộ */

  /**
   * Ghi được vào một thư mục: tạo con, đổi tên, chuyển, thêm tham chiếu.
   *
   * Thư mục của dự án là việc của thành viên dự án; kho cấp đơn vị dùng
   * chung cả tenant nên cần quyền quản trị Workspace.
   */
  private async requireFolderWrite(actor: WorkspaceActor, folder: DocumentFolder): Promise<void> {
    if (folder.projectId) {
      requireProjectRole(await this.projects.access(actor, folder.projectId), 'member');
      return;
    }
    if (!actor.canManage && !actor.isTenantAdmin) throw new ProjectForbiddenError();
  }

  /**
   * Đích gắn phải tồn tại, người gọi phải thấy được nó, và — với tài liệu của
   * một dự án — phải thuộc chính dự án đó.
   *
   * `document_links.entity_id` là cột đa hình, không có khoá ngoại. Không kiểm
   * ở đây thì tài liệu dự án A gắn được vào công việc dự án B, và hiện ra
   * trước mặt những người không có quyền xem dự án A. Loại đích sai thì rơi
   * xuống ràng buộc `CHECK` thành lỗi 500 thay vì một thông báo rõ ràng.
   */
  private async requireLinkTarget(
    actor: WorkspaceActor,
    documentProjectId: string | undefined,
    target: { readonly entityType: string; readonly entityId: string },
  ): Promise<void> {
    if (!(DOCUMENT_LINK_ENTITY_TYPES as readonly string[]).includes(target.entityType)) {
      throw new WorkspaceValidationError(
        `Không gắn được tài liệu vào loại "${target.entityType}".`,
      );
    }

    let targetProjectId: string | undefined;
    if (target.entityType === 'project') {
      targetProjectId = target.entityId;
    } else if (target.entityType === 'work_item') {
      const item = await this.store.workItem.findById(actor.tenantId, target.entityId);
      if (!item) throw new WorkItemNotFoundError(target.entityId);
      targetProjectId = item.projectId;
    } else {
      const event = await this.store.calendar.findEvent(actor.tenantId, target.entityId);
      if (!event) throw new EventNotFoundError(target.entityId);
      targetProjectId = event.projectId;
    }

    if (documentProjectId && targetProjectId !== documentProjectId) {
      throw new WorkspaceValidationError('Chỉ gắn được tài liệu vào mục thuộc cùng dự án.');
    }
    // Tài liệu dùng chung gắn được vào mục của bất kỳ dự án nào — miễn người
    // gọi thấy được dự án đó.
    if (targetProjectId) await this.projects.access(actor, targetProjectId);
  }

  private async loadVisible(
    actor: WorkspaceActor,
    documentId: string,
  ): Promise<WorkspaceDocument> {
    const document = await this.store.document.findById(actor.tenantId, documentId);
    if (!document) throw new DocumentNotFoundError(documentId);
    // Tài liệu gắn dự án mượn hàng rào thành viên của dự án đó; tài liệu cấp
    // đơn vị thì mọi người trong tenant đọc được.
    if (document.projectId) await this.projects.access(actor, document.projectId);
    return document;
  }

  private async requireWriteAccess(
    actor: WorkspaceActor,
    projectId: string | undefined,
  ): Promise<void> {
    if (!actor.canWriteDocuments) throw new ProjectForbiddenError();
    if (!projectId) {
      if (!actor.canManage && !actor.isTenantAdmin) throw new ProjectForbiddenError();
      return;
    }
    requireProjectRole(await this.projects.access(actor, projectId), 'member');
  }

  /**
   * Bỏ những tài liệu thuộc dự án người gọi không tham gia.
   *
   * `checkedProjectId` là dự án đã kiểm quyền ở đầu lời gọi, khỏi hỏi lại.
   */
  private async filterVisible(
    actor: WorkspaceActor,
    items: readonly DocumentSummary[],
    checkedProjectId?: string,
  ): Promise<DocumentSummary[]> {
    if (actor.isTenantAdmin) return [...items];

    const allowed = new Set<string>(checkedProjectId ? [checkedProjectId] : []);
    const projectIds = [
      ...new Set(items.map((item) => item.projectId).filter(Boolean)),
    ].filter((projectId) => !allowed.has(projectId as string)) as string[];
    await Promise.all(
      projectIds.map(async (projectId) => {
        const role = await this.store.member.roleOf(actor.tenantId, projectId, actor.userId);
        if (role) allowed.add(projectId);
      }),
    );
    return items.filter((item) => !item.projectId || allowed.has(item.projectId));
  }

  /**
   * Khoá object trong kho.
   *
   * Một bucket dùng chung, phân tách bằng prefix theo tenant. Thêm một UUID
   * ngẫu nhiên vào tên: hai lần tải cùng một tệp lên cùng một phiên bản sẽ
   * đụng ràng buộc UNIQUE trên `storage_key` nếu khoá chỉ dựa vào tên tệp.
   */
  private storageKey(
    actor: WorkspaceActor,
    projectId: string | undefined,
    versionNo: number,
    fileName: string,
  ): string {
    const scope = projectId ?? 'shared';
    const safeName = fileName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-80);
    return `tenants/${actor.tenantId}/workspace/${scope}/${randomUUID()}/v${versionNo}-${safeName || 'file'}`;
  }

  /**
   * Kiểm tra tệp trước khi ký URL.
   *
   * `sizeBytes` do client khai và **không kiểm chứng được**: URL ký trước chỉ
   * ghim bucket, khoá và content-type, không ghim độ dài. Kiểm ở đây là để
   * chặn nhầm lẫn, không phải để chống gian lận.
   */
  private validateFile(
    fileName: unknown,
    contentType: unknown,
    sizeBytes: number | undefined,
  ): { fileName: string; contentType: string } {
    const name = requireText(fileName, 'Tên tệp', 255);
    const type = String(contentType ?? '').trim();
    if (!ALLOWED_DOCUMENT_CONTENT_TYPES.includes(type)) {
      throw new WorkspaceValidationError(`Không hỗ trợ loại tệp "${type || '(trống)'}".`);
    }
    if (sizeBytes != null && sizeBytes > DOCUMENT_MAX_BYTES) {
      throw new WorkspaceValidationError(
        `Tệp không được vượt quá ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }
    return { fileName: name, contentType: type };
  }
}

function parseStatus(value: unknown): DocumentStatus | undefined {
  if (!value) return undefined;
  const text = String(value);
  return (DOCUMENT_STATUSES as readonly string[]).includes(text)
    ? (text as DocumentStatus)
    : undefined;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}
