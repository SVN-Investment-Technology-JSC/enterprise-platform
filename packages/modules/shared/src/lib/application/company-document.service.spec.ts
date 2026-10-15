import type { ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import type {
  SharedDocument,
  SharedDocumentVersion,
  SharedFolder,
  StorageModuleUsage,
  TenantStorageLimit,
} from '@enterprise-platform/contracts-shared';
import {
  SharedDocumentLockedError,
  SharedDocumentNotFoundError,
  SharedForbiddenError,
  SharedValidationError,
  StorageQuotaExceededError,
} from '../domain/shared.error.js';
import { CompanyDocumentService, canSee, folderPaths, sortFolders } from './company-document.service.js';
import type { SharedActor } from './shared-actor.js';
import type { DocumentRow, SharedStore } from './shared-store.port.js';
import { StorageQuotaService } from './storage-quota.service.js';

const TENANT = 'tenant-1';
const GB = 1024 * 1024 * 1024;

function actor(overrides: Partial<SharedActor> = {}): SharedActor {
  return {
    tenantId: TENANT,
    userId: 'user-writer',
    displayName: 'Người ghi',
    isTenantAdmin: false,
    canManage: false,
    canWriteDocuments: true,
    canDeleteDocuments: false,
    ...overrides,
  };
}

const admin = actor({ userId: 'user-admin', isTenantAdmin: true, canManage: true, canDeleteDocuments: true });
const reader = actor({ userId: 'user-reader', canWriteDocuments: false });

/** Kho giả trong bộ nhớ, đủ cho các luật của tầng application. */
function fakeStore(usage: StorageModuleUsage[] = []) {
  const folders = new Map<string, SharedFolder>();
  const documents = new Map<string, DocumentRow>();
  const versions = new Map<string, SharedDocumentVersion & { storageKey: string }>();
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const now = new Date('2026-10-15T00:00:00Z').toISOString();

  const store: SharedStore = {
    diagnostics: { schemaStatus: async () => ({ schemaExists: true, tablesReady: true }) },
    folders: {
      list: async () => [...folders.values()].filter((folder) => folder.isActive),
      find: async (_tenant, folderId) => folders.get(folderId),
      create: async (_tenant, userId, input) => {
        const folder: SharedFolder = {
          id: id('folder'),
          parentId: input.parentId ?? undefined,
          name: input.name,
          depth: input.depth,
          isActive: true,
          note: input.note ?? undefined,
          docKind: input.docKind ?? undefined,
          docNumber: input.docNumber ?? undefined,
          partner: input.partner ?? undefined,
          issuedOn: input.issuedOn ?? undefined,
          effectiveTo: input.effectiveTo ?? undefined,
          documentCount: 0,
          totalDocumentCount: 0,
          totalBytes: 0,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        };
        folders.set(folder.id, folder);
        return folder;
      },
      update: async (_tenant, folderId, input) => {
        const current = folders.get(folderId)!;
        const next = { ...current, name: input.name, parentId: input.parentId ?? undefined, depth: current.depth + input.depthDelta };
        folders.set(folderId, next);
        return next;
      },
      deactivate: async (_tenant, folderId) => {
        folders.set(folderId, { ...folders.get(folderId)!, isActive: false });
      },
      countContents: async (_tenant, folderId) => ({
        folders: [...folders.values()].filter((f) => f.parentId === folderId && f.isActive).length,
        documents: [...documents.values()].filter((d) => d.folderId === folderId && d.status === 'active').length,
      }),
    },
    documents: {
      list: async (_tenant, query) =>
        [...documents.values()].filter(
          (doc) => doc.status === query.status && (!query.folderId || doc.folderId === query.folderId),
        ),
      find: async (_tenant, documentId) => documents.get(documentId),
      create: async (_tenant, userId, input) => {
        const documentId = id('doc');
        const version: SharedDocumentVersion & { storageKey: string } = {
          id: id('version'),
          documentId,
          versionNo: 1,
          fileName: input.fileName,
          contentType: input.contentType,
          uploadedBy: userId,
          createdAt: now,
          storageKey: input.storageKey,
        };
        versions.set(version.id, version);
        const document: SharedDocument = {
          id: documentId,
          folderId: input.folderId,
          name: input.name,
          confidentiality: input.confidentiality,
          tags: input.tags,
          status: 'active',
          currentVersionId: version.id,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
          docKind: input.docKind ?? undefined,
          docNumber: input.docNumber ?? undefined,
          effectiveTo: input.effectiveTo ?? undefined,
        };
        documents.set(documentId, { ...document, versionCount: 1, currentVersion: version });
        return { document, version };
      },
      update: async (_tenant, documentId, input) => {
        const current = documents.get(documentId)!;
        documents.set(documentId, { ...current, folderId: input.folderId, name: input.name });
      },
      setLock: async (_tenant, documentId, userId) => {
        const current = documents.get(documentId)!;
        documents.set(documentId, { ...current, lockedByUserId: userId ?? undefined, lockedAt: userId ? now : undefined });
      },
      setStatus: async (_tenant, documentId, status) => {
        documents.set(documentId, { ...documents.get(documentId)!, status });
      },
      listVersions: async (_tenant, documentId) =>
        [...versions.values()].filter((version) => version.documentId === documentId),
      findVersion: async (_tenant, versionId) => versions.get(versionId),
      addVersion: async (_tenant, userId, input) => {
        const version = {
          id: id('version'),
          documentId: input.documentId,
          versionNo: input.versionNo,
          fileName: input.fileName,
          contentType: input.contentType,
          uploadedBy: userId,
          createdAt: now,
          storageKey: input.storageKey,
        };
        versions.set(version.id, version);
        return version;
      },
      completeVersion: async (_tenant, versionId, sizeBytes) => {
        const version = versions.get(versionId);
        if (!version) return undefined;
        const next = { ...version, sizeBytes };
        versions.set(versionId, next);
        return next;
      },
      storageKeyOf: async (_tenant, versionId) => versions.get(versionId)?.storageKey,
      log: async () => undefined,
      accessLog: async () => [],
    },
    storage: { usageByModule: async () => usage },
  };
  return { store, folders, documents, versions };
}

const storage: ObjectStoragePort = {
  createUploadUrl: async (input) => `https://files.example/upload/${input.key}`,
  createDownloadUrl: async (key) => `https://files.example/download/${key}`,
  putObject: async () => undefined,
};

function setup(options: { usage?: StorageModuleUsage[]; limit?: TenantStorageLimit } = {}) {
  const fake = fakeStore(options.usage);
  const quota = new StorageQuotaService(fake.store, { storageLimit: async () => options.limit });
  return { ...fake, service: new CompanyDocumentService(fake.store, quota, storage) };
}

const pdf = { fileName: 'HĐ 01.026.HĐTN.TNWP-SAVINA.pdf', contentType: 'application/pdf', sizeBytes: 2_400_000 };

describe('CompanyDocumentService – thư mục', () => {
  it('chỉ người quản trị kho tạo được thư mục gốc', async () => {
    const { service } = setup();
    await expect(service.createFolder(actor(), { name: '3. HỢP ĐỒNG' })).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
    const root = await service.createFolder(admin, { name: '3. HỢP ĐỒNG' });
    expect(root.depth).toBe(0);
  });

  it('người có quyền ghi tạo thư mục con, kèm thông tin hồ sơ hợp đồng', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: '3. HỢP ĐỒNG' });
    const contract = await service.createFolder(actor(), {
      parentId: root.id,
      name: '4. HĐ ĐO CLĐN – ĐG TRUNG NAM',
      docKind: 'contract',
      docNumber: '01.026.HĐTN.TNWP-SAVINA',
      partner: 'Điện gió Trung Nam',
    });
    expect(contract).toMatchObject({ depth: 1, docKind: 'contract', partner: 'Điện gió Trung Nam' });
  });

  it('chặn cây sâu quá 6 cấp', async () => {
    const { service } = setup();
    let parent = await service.createFolder(admin, { name: 'Cấp 1' });
    for (let level = 2; level <= 6; level += 1) {
      parent = await service.createFolder(actor(), { parentId: parent.id, name: `Cấp ${level}` });
    }
    await expect(
      service.createFolder(actor(), { parentId: parent.id, name: 'Cấp 7' }),
    ).rejects.toBeInstanceOf(SharedValidationError);
  });

  it('không chuyển thư mục vào chính con của nó', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const child = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await expect(service.updateFolder(admin, root.id, { parentId: child.id })).rejects.toBeInstanceOf(
      SharedValidationError,
    );
  });

  it('chỉ xoá thư mục rỗng, và cần quyền xoá', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await expect(service.removeFolder(actor(), root.id)).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.removeFolder(admin, root.id)).rejects.toThrow('còn 1 thư mục con');
  });

  it('sắp tên có số theo giá trị và dựng đường dẫn', () => {
    const base = { isActive: true, documentCount: 0, totalDocumentCount: 0, totalBytes: 0, createdBy: 'u', createdAt: '', updatedAt: '' };
    const folders: SharedFolder[] = [
      { ...base, id: 'b', name: '10. CHỨNG CHỈ NHÂN SỰ', depth: 0 },
      { ...base, id: 'a', name: '3. HỢP ĐỒNG', depth: 0 },
      { ...base, id: 'c', parentId: 'a', name: 'HỒ SƠ 2026', depth: 1 },
    ];
    expect(sortFolders(folders).map((folder) => folder.id)).toEqual(['a', 'b', 'c']);
    expect(folderPaths(folders).get('c')).toBe('3. HỢP ĐỒNG / HỒ SƠ 2026');
  });
});

describe('CompanyDocumentService – tài liệu', () => {
  async function withFolder() {
    const context = setup();
    const folder = await context.service.createFolder(admin, { name: '3. HỢP ĐỒNG' });
    return { ...context, folder };
  }

  it('tải lên trả URL ký sẵn, khoá object theo prefix tenant', async () => {
    const { service, folder } = await withFolder();
    const created = await service.create(actor(), { folderId: folder.id, name: 'HĐ Trung Nam', ...pdf });
    expect(created.uploadUrl).toContain(`tenants/${TENANT}/shared/`);
    expect(created.uploadUrl).toMatch(/v1-HD-01\.026\.HDTN\.TNWP-SAVINA\.pdf$/);
    expect(created.document.confidentiality).toBe('internal');
  });

  it('người chỉ đọc không tải lên được', async () => {
    const { service, folder } = await withFolder();
    await expect(service.create(reader, { folderId: folder.id, name: 'X', ...pdf })).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
  });

  it('từ chối loại tệp ngoài danh sách và hiệu lực ngược', async () => {
    const { service, folder } = await withFolder();
    await expect(
      service.create(actor(), { folderId: folder.id, name: 'X', ...pdf, contentType: 'application/x-msdownload' }),
    ).rejects.toThrow('Không hỗ trợ loại tệp');
    await expect(
      service.create(actor(), { folderId: folder.id, name: 'X', ...pdf, effectiveFrom: '2026-12-31', effectiveTo: '2026-01-01' }),
    ).rejects.toThrow('Ngày hiệu lực từ');
  });

  it('người khác đang khoá thì không tải được phiên bản mới', async () => {
    const { service, folder } = await withFolder();
    const created = await service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await service.lock(actor({ userId: 'user-other' }), created.document.id);
    await expect(
      service.addVersion(actor(), created.document.id, { ...pdf, changeNote: 'Bản ký hai bên' }),
    ).rejects.toBeInstanceOf(SharedDocumentLockedError);
  });

  it('phiên bản mới đánh số tiếp và bắt buộc ghi chú', async () => {
    const { service, folder } = await withFolder();
    const created = await service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await expect(
      service.addVersion(actor(), created.document.id, { ...pdf, changeNote: '' }),
    ).rejects.toThrow('Ghi chú thay đổi');
    const ticket = await service.addVersion(actor(), created.document.id, { ...pdf, changeNote: 'Bản ký hai bên' });
    expect(ticket.version.versionNo).toBe(2);
  });

  it('tài liệu mật chỉ người tạo và quản trị thấy', async () => {
    const { service, folder } = await withFolder();
    const created = await service.create(actor(), {
      folderId: folder.id,
      name: 'Hồ sơ lương',
      ...pdf,
      confidentiality: 'confidential',
    });
    await expect(service.detail(reader, created.document.id)).rejects.toBeInstanceOf(
      SharedDocumentNotFoundError,
    );
    await expect(service.detail(admin, created.document.id)).resolves.toMatchObject({ name: 'Hồ sơ lương' });
    expect(canSee(reader, { confidentiality: 'restricted', createdBy: 'x' })).toBe(false);
    expect(canSee(actor(), { confidentiality: 'restricted', createdBy: 'x' })).toBe(true);
  });

  it('lưu trữ cần quyền xoá, khôi phục trả lại trạng thái đang dùng', async () => {
    const { service, folder } = await withFolder();
    const created = await service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await expect(service.archive(actor(), created.document.id)).rejects.toBeInstanceOf(SharedForbiddenError);
    expect((await service.archive(admin, created.document.id)).status).toBe('archived');
    expect((await service.restore(admin, created.document.id)).status).toBe('active');
  });

  it('tải xuống phiên bản chưa tải lên xong thì báo rõ', async () => {
    const { service, folder } = await withFolder();
    const created = await service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await expect(service.download(actor(), created.document.id)).rejects.toThrow('chưa tải lên xong');
    await service.completeUpload(actor(), created.document.id, created.version.id, pdf.sizeBytes);
    await expect(service.download(actor(), created.document.id, undefined, 'preview')).resolves.toMatchObject({
      fileName: pdf.fileName,
    });
  });
});

describe('Hạn mức dung lượng', () => {
  it('chặn tải lên khi vượt hạn mức cứng của gói', async () => {
    const { service } = setup({
      usage: [{ moduleKey: 'workspace', label: 'Workspace', bytes: 50 * GB - 1_000_000, files: 10 }],
      limit: { resourceKey: 'storage_gb', limitValue: 50, enforcement: 'hard', source: 'plan', planKey: 'standard', addOnValue: 0 },
    });
    const folder = await service.createFolder(admin, { name: 'A' });
    await expect(service.create(actor(), { folderId: folder.id, name: 'X', ...pdf })).rejects.toBeInstanceOf(
      StorageQuotaExceededError,
    );
  });

  it('Platform không trả hạn mức thì dùng 50 GB mặc định và không chặn', async () => {
    const fake = fakeStore([{ moduleKey: 'shared', label: 'Tài liệu công ty', bytes: 60 * GB, files: 1 }]);
    const quota = new StorageQuotaService(fake.store, { storageLimit: async () => undefined });
    const usage = await quota.usage(TENANT);
    expect(usage).toMatchObject({ quotaBytes: 50 * GB, source: 'default', enforcement: 'soft', usedPercent: 120 });
    await expect(quota.ensureCapacity(TENANT, GB)).resolves.toBeUndefined();
  });

  it('gói mua thêm cộng vào hạn mức, phân hệ xếp theo dung lượng giảm dần', async () => {
    const fake = fakeStore([
      { moduleKey: 'shared', label: 'Tài liệu công ty', bytes: 1 * GB, files: 1 },
      { moduleKey: 'workspace', label: 'Workspace', bytes: 3 * GB, files: 2 },
    ]);
    const quota = new StorageQuotaService(fake.store, {
      storageLimit: async () => ({ resourceKey: 'storage_gb', limitValue: 150, enforcement: 'hard', source: 'plan', planKey: 'standard', addOnValue: 100 }),
    });
    const usage = await quota.usage(TENANT);
    expect(usage.quotaBytes).toBe(150 * GB);
    expect(usage.addOnBytes).toBe(100 * GB);
    expect(usage.byModule.map((item) => item.moduleKey)).toEqual(['workspace', 'shared']);
  });
});
