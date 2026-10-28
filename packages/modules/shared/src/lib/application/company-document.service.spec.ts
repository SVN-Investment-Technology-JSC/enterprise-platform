import type {
  ObjectStorageCopy,
  ObjectStorageDownloadOptions,
  ObjectStorageManagementPort,
} from '@enterprise-platform/adapter-storage';
import type {
  SharedDocument,
  SharedDocumentVersion,
  SharedFolder,
  SharedTrashItem,
  StorageModuleUsage,
  TenantStorageLimit,
} from '@enterprise-platform/contracts-shared';
import { Logger } from '@nestjs/common';
import {
  SharedDocumentLockedError,
  SharedDocumentNotFoundError,
  SharedFolderLockedError,
  SharedFolderNotFoundError,
  SharedFolderUnavailableError,
  SharedForbiddenError,
  SharedNameTakenError,
  SharedValidationError,
  StorageQuotaExceededError,
} from '../domain/shared.error.js';
import {
  CompanyDocumentService,
  folderPaths,
  sortFolders,
  withFreeName,
} from './company-document.service.js';
import { canSee, FolderAccessService, type ShareRecord } from './folder-access.js';
import { FolderSharingService } from './folder-sharing.service.js';
import type { OrganizationSnapshot } from './organization.port.js';
import type { SharedActor } from './shared-actor.js';
import type { DocumentRow, SharedStore, TenantPerson } from './shared-store.port.js';
import { StorageQuotaService } from './storage-quota.service.js';

const TENANT = 'tenant-1';
const GB = 1024 * 1024 * 1024;
const TODAY = '2026-10-16';

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
/** Có quyền xoá nhưng không quản trị kho: xoá vào Thùng rác được, xoá vĩnh viễn thì không. */
const deleter = actor({ userId: 'user-deleter', canDeleteDocuments: true });
/** Quản trị kho có quyền xoá, không phải quản trị tenant. */
const keeper = actor({ userId: 'user-keeper', canManage: true, canDeleteDocuments: true });

/**
 * Kho giả trong bộ nhớ, đủ cho các luật của tầng application.
 *
 * `openRoots`: mọi thư mục gốc chia sẻ "Mọi người · Sửa" — như kho trước khi có
 * chia sẻ thư mục, để các ca về tài liệu và Thùng rác chỉ còn xét quyền phân hệ.
 */
function fakeStore(usage: StorageModuleUsage[] = [], options: { openRoots?: boolean } = {}) {
  const openRoots = options.openRoots ?? true;
  const folders = new Map<string, SharedFolder>();
  const documents = new Map<string, DocumentRow>();
  const versions = new Map<string, SharedDocumentVersion & { storageKey: string }>();
  const shares: ShareRecord[] = [];
  const people: TenantPerson[] = [];
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const now = new Date('2026-10-15T00:00:00Z').toISOString();

  // Trạng thái Thùng rác; `SharedFolder` công khai không mang các cột này.
  const folderTrash = new Map<string, { deletedAt: string; deletedBy: string; batch: string }>();
  const documentTrash = new Map<string, { deletedBy: string; batch?: string }>();

  /** `rootId` và mọi con cháu thoả `include`. */
  const branchIds = (rootId: string, include: (folder: SharedFolder) => boolean) => {
    const ids = new Set<string>([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const folder of folders.values()) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id) && include(folder)) {
          ids.add(folder.id);
          grew = true;
        }
      }
    }
    return ids;
  };

  /** Xoá hẳn một tài liệu cùng phiên bản; trả khoá tệp của chúng. */
  const dropDocument = (documentId: string): string[] => {
    const keys: string[] = [];
    for (const [versionId, version] of versions) {
      if (version.documentId === documentId) {
        keys.push(version.storageKey);
        versions.delete(versionId);
      }
    }
    documents.delete(documentId);
    documentTrash.delete(documentId);
    return keys;
  };

  const store: SharedStore = {
    diagnostics: { schemaStatus: async () => ({ schemaExists: true, tablesReady: true }) },
    folders: {
      list: async () => [...folders.values()].filter((folder) => folder.isActive),
      skeleton: async () =>
        [...folders.values()].map((folder) => ({
          id: folder.id,
          parentId: folder.parentId,
          name: folder.name,
          createdBy: folder.createdBy,
          isActive: folder.isActive,
        })),
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
      trash: async (_tenant, folderId, userId) => {
        const ids = branchIds(folderId, (folder) => folder.isActive);
        for (const memberId of ids) {
          folders.set(memberId, { ...folders.get(memberId)!, isActive: false });
          folderTrash.set(memberId, { deletedAt: now, deletedBy: userId, batch: folderId });
        }
        let moved = 0;
        for (const doc of documents.values()) {
          if (ids.has(doc.folderId) && !doc.deletedAt) {
            documents.set(doc.id, { ...doc, deletedAt: now, lockedByUserId: undefined, lockedAt: undefined });
            documentTrash.set(doc.id, { deletedBy: userId, batch: folderId });
            moved += 1;
          }
        }
        return { folders: ids.size - 1, documents: moved };
      },
      findTrashed: async (_tenant, folderId) => {
        const mark = folderTrash.get(folderId);
        const folder = folders.get(folderId);
        if (!mark || !folder || mark.batch !== folderId) return undefined;
        const members = [...folderTrash.entries()]
          .filter(([, value]) => value.batch === folderId)
          .map(([memberId]) => folders.get(memberId)!);
        return {
          folder,
          deletedAt: mark.deletedAt,
          maxDepth: Math.max(...members.map((member) => member.depth)),
          folders: members.length - 1,
          documents: [...documentTrash.values()].filter((value) => value.batch === folderId).length,
        };
      },
      restoreBranch: async (_tenant, folderId, target) => {
        const taken = [...folders.values()].some(
          (folder) =>
            folder.isActive &&
            (folder.parentId ?? null) === target.parentId &&
            folder.name.toLowerCase() === target.name.toLowerCase(),
        );
        if (taken) throw new SharedNameTakenError(target.name);
        for (const [memberId, mark] of [...folderTrash.entries()]) {
          if (mark.batch !== folderId) continue;
          const member = folders.get(memberId)!;
          folders.set(memberId, {
            ...member,
            isActive: true,
            depth: member.depth + target.depthDelta,
            ...(memberId === folderId ? { name: target.name, parentId: target.parentId ?? undefined } : {}),
          });
          folderTrash.delete(memberId);
        }
        for (const [docId, mark] of [...documentTrash.entries()]) {
          if (mark.batch !== folderId) continue;
          documents.set(docId, { ...documents.get(docId)!, deletedAt: undefined });
          documentTrash.delete(docId);
        }
        return folders.get(folderId)!;
      },
      purgeBranch: async (_tenant, folderId) => {
        const ids = new Set(
          [...folderTrash.entries()].filter(([, mark]) => mark.batch === folderId).map(([memberId]) => memberId),
        );
        // Cả cây con, kể cả thư mục từng bị xoá riêng ở lượt trước.
        for (let grew = true; grew; ) {
          grew = false;
          for (const folder of folders.values()) {
            if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
              ids.add(folder.id);
              grew = true;
            }
          }
        }
        const storageKeys: string[] = [];
        let removed = 0;
        // Cả tài liệu từng bị xoá riêng khỏi các thư mục này.
        for (const doc of [...documents.values()]) {
          if (!ids.has(doc.folderId)) continue;
          storageKeys.push(...dropDocument(doc.id));
          removed += 1;
        }
        for (const memberId of ids) {
          folders.delete(memberId);
          folderTrash.delete(memberId);
        }
        return { storageKeys, documents: removed, folders: Math.max(0, ids.size - 1) };
      },
    },
    documents: {
      list: async (_tenant, query) =>
        [...documents.values()].filter(
          (doc) =>
            !doc.deletedAt &&
            doc.status === query.status &&
            (!query.folderId || doc.folderId === query.folderId) &&
            (!query.folderIds || query.folderIds.includes(doc.folderId)) &&
            (!query.search || doc.name.toLowerCase().includes(query.search.toLowerCase())),
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
      trash: async (_tenant, documentId, userId) => {
        documents.set(documentId, {
          ...documents.get(documentId)!,
          deletedAt: now,
          lockedByUserId: undefined,
          lockedAt: undefined,
        });
        documentTrash.set(documentId, { deletedBy: userId });
      },
      restoreFromTrash: async (_tenant, documentId, target) => {
        const current = documents.get(documentId)!;
        const taken =
          current.status === 'active' &&
          [...documents.values()].some(
            (doc) =>
              !doc.deletedAt &&
              doc.status === 'active' &&
              doc.folderId === target.folderId &&
              doc.name.toLowerCase() === target.name.toLowerCase(),
          );
        if (taken) throw new SharedNameTakenError(target.name);
        documents.set(documentId, { ...current, folderId: target.folderId, name: target.name, deletedAt: undefined });
        documentTrash.delete(documentId);
      },
      purge: async (_tenant, documentId) => ({
        storageKeys: dropDocument(documentId),
        documents: 1,
        folders: 0,
      }),
      countLockedByOthers: async (_tenant, folderIds, userId) =>
        [...documents.values()].filter(
          (doc) =>
            !doc.deletedAt &&
            folderIds.includes(doc.folderId) &&
            doc.lockedByUserId &&
            doc.lockedByUserId !== userId,
        ).length,
      countHiddenFrom: async (_tenant, folderIds, viewer) =>
        [...documents.values()].filter(
          (doc) =>
            !doc.deletedAt &&
            folderIds.includes(doc.folderId) &&
            doc.createdBy !== viewer.userId &&
            (doc.confidentiality === 'confidential' ||
              (doc.confidentiality === 'restricted' && !viewer.canSeeRestricted)),
        ).length,
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
        const owner = documents.get(version.documentId);
        if (owner?.currentVersionId === versionId) documents.set(owner.id, { ...owner, currentVersion: next });
        return next;
      },
      storageKeyOf: async (_tenant, versionId) => versions.get(versionId)?.storageKey,
      log: async () => undefined,
      accessLog: async () => [],
    },
    trash: {
      list: async () => {
        const paths = folderPaths([...folders.values()]);
        const items: SharedTrashItem[] = [];
        for (const [folderId, mark] of folderTrash) {
          if (mark.batch !== folderId) continue;
          const folder = folders.get(folderId)!;
          items.push({
            kind: 'folder',
            id: folderId,
            name: folder.name,
            location: folder.parentId ? (paths.get(folder.parentId) ?? '') : '',
            locationAvailable: !folder.parentId || Boolean(folders.get(folder.parentId)?.isActive),
            documentCount: [...documentTrash.values()].filter((value) => value.batch === folderId).length,
            folderCount: [...folderTrash.values()].filter((value) => value.batch === folderId).length - 1,
            totalBytes: 0,
            deletedAt: mark.deletedAt,
            deletedBy: mark.deletedBy,
          });
        }
        for (const [documentId, mark] of documentTrash) {
          if (mark.batch) continue;
          const doc = documents.get(documentId)!;
          items.push({
            kind: 'document',
            id: documentId,
            name: doc.name,
            location: paths.get(doc.folderId) ?? '',
            folderId: doc.folderId,
            locationAvailable: Boolean(folders.get(doc.folderId)?.isActive),
            documentCount: 1,
            folderCount: 0,
            totalBytes: doc.currentVersion?.sizeBytes ?? 0,
            deletedAt: doc.deletedAt ?? now,
            deletedBy: mark.deletedBy,
            confidentiality: doc.confidentiality,
            createdBy: doc.createdBy,
          });
        }
        // Mới xoá trước, như `ORDER BY deleted_at DESC` của cơ sở dữ liệu.
        return items.reverse();
      },
    },
    shares: {
      list: async () => [
        ...shares,
        ...(openRoots
          ? [...folders.values()]
              .filter((folder) => !folder.parentId)
              .map(
                (folder): ShareRecord => ({
                  folderId: folder.id,
                  principalType: 'everyone',
                  role: 'editor',
                  updatedBy: 'user-admin',
                  updatedAt: now,
                }),
              )
          : []),
      ],
      replace: async (_tenant, folderId, userId, grants) => {
        const kept = shares.filter((share) => share.folderId !== folderId);
        const before = shares.filter((share) => share.folderId === folderId);
        shares.length = 0;
        shares.push(...kept);
        for (const grant of grants) {
          const old = before.find(
            (share) => share.principalType === grant.principalType && share.principalId === grant.principalId,
          );
          const same = old && old.role === grant.role && old.expiresOn === grant.expiresOn;
          shares.push({
            ...grant,
            folderId,
            updatedBy: same ? old.updatedBy : userId,
            updatedAt: same ? old.updatedAt : now,
          });
        }
      },
    },
    people: { list: async () => people },
    storage: { usageByModule: async () => usage },
  };
  return { store, folders, documents, versions, shares, people };
}

/** Sơ đồ tổ chức giả: sửa trực tiếp `nodes`, `assignments`, `degraded` trong từng ca. */
function fakeOrganization() {
  const state: { -readonly [K in keyof OrganizationSnapshot]: OrganizationSnapshot[K] } = {
    nodes: [],
    assignments: [],
    degraded: false,
  };
  return { state, reader: { snapshot: async () => ({ ...state }) } };
}

/** Kho đối tượng giả: ghi lại các lần sao chép, xoá, và gây lỗi theo yêu cầu. */
function fakeStorage() {
  const copies: ObjectStorageCopy[] = [];
  const deleted: string[] = [];
  const downloads: { key: string; options?: ObjectStorageDownloadOptions }[] = [];
  const faults = { failedKeys: [] as string[], throwOnDelete: false };
  const port: ObjectStorageManagementPort = {
    createUploadUrl: async (input) => `https://files.example/upload/${input.key}`,
    createDownloadUrl: async (key, _expiresInSeconds, options) => {
      downloads.push({ key, options });
      return `https://files.example/download/${key}`;
    },
    putObject: async () => undefined,
    copyObject: async (input) => {
      copies.push(input);
    },
    deleteObjects: async (keys) => {
      if (faults.throwOnDelete) throw new Error('kho không phản hồi');
      deleted.push(...keys);
      return { failed: keys.filter((key) => faults.failedKeys.includes(key)) };
    },
  };
  return { port, copies, deleted, downloads, faults };
}

function setup(
  options: { usage?: StorageModuleUsage[]; limit?: TenantStorageLimit; openRoots?: boolean } = {},
) {
  const fake = fakeStore(options.usage, { openRoots: options.openRoots });
  const clock = { now: 0 };
  const quota = new StorageQuotaService(fake.store, { storageLimit: async () => options.limit }, () => clock.now);
  const files = fakeStorage();
  const organization = fakeOrganization();
  const access = new FolderAccessService(fake.store, organization.reader, () => TODAY);
  return {
    ...fake,
    clock,
    files,
    organization: organization.state,
    service: new CompanyDocumentService(fake.store, quota, access, files.port),
    sharing: new FolderSharingService(fake.store, access, organization.reader),
  };
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

  it('xoá thư mục cần quyền xoá, và gốc của kho chỉ quản trị kho xoá', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const child = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await expect(service.deleteFolder(actor(), child.id)).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.deleteFolder(deleter, root.id)).rejects.toThrow('thư mục gốc');
    await expect(service.deleteFolder(deleter, child.id)).resolves.toEqual({ folders: 0, documents: 0 });
    await expect(service.deleteFolder(keeper, root.id)).resolves.toEqual({ folders: 0, documents: 0 });
  });

  it('xoá thư mục chuyển cả nhánh và tài liệu bên trong vào Thùng rác', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const child = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await service.create(actor(), { folderId: child.id, name: 'HĐ', ...pdf });
    await expect(service.deleteFolder(admin, root.id)).resolves.toEqual({ folders: 1, documents: 1 });
    await expect(service.folders(admin)).resolves.toEqual([]);
    await expect(service.deleteFolder(admin, root.id)).rejects.toBeInstanceOf(SharedFolderNotFoundError);
    const items = await service.trash(admin);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'folder', name: 'A', folderCount: 1, documentCount: 1 });
  });

  it('không xoá thư mục có tài liệu đang bị người khác khoá', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const created = await service.create(actor(), { folderId: root.id, name: 'HĐ', ...pdf });
    await service.lock(actor({ userId: 'user-other' }), created.document.id);
    await expect(service.deleteFolder(admin, root.id)).rejects.toBeInstanceOf(SharedFolderLockedError);
    await service.unlock(admin, created.document.id);
    await expect(service.deleteFolder(admin, root.id)).resolves.toMatchObject({ documents: 1 });
  });

  it('người không quản trị không xoá hộ tài liệu mật mà họ không được xem', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const child = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await service.create(actor(), { folderId: child.id, name: 'Lương', ...pdf, confidentiality: 'confidential' });
    await expect(service.deleteFolder(deleter, child.id)).rejects.toThrow('không có quyền xem');
    await expect(service.deleteFolder(admin, child.id)).resolves.toMatchObject({ documents: 1 });
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

  it('nhận mọi định dạng; chỉ từ chối kiểu tệp sai cú pháp và hiệu lực ngược', async () => {
    const { service, folder } = await withFolder();
    const exe = await service.create(actor(), {
      folderId: folder.id,
      name: 'Bộ cài',
      ...pdf,
      fileName: 'setup.exe',
      contentType: 'application/x-msdownload',
    });
    expect(exe.version.contentType).toBe('application/x-msdownload');
    // Trình duyệt không nhận ra kiểu (.step, .dwg trên Windows): lưu như tệp nhị phân.
    const step = await service.create(actor(), { folderId: folder.id, name: 'Bản vẽ', ...pdf, fileName: 'khung.step', contentType: '' });
    expect(step.version.contentType).toBe('application/octet-stream');
    await expect(
      service.create(actor(), { folderId: folder.id, name: 'X', ...pdf, contentType: 'text/html; <script>' }),
    ).rejects.toThrow('không hợp lệ');
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
    expect(canSee(reader, { confidentiality: 'restricted', createdBy: 'x' }, 'viewer')).toBe(false);
    expect(canSee(actor(), { confidentiality: 'restricted', createdBy: 'x' }, 'editor')).toBe(true);
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

  it('tải về luôn ký kèm attachment; tệp HTML không xem tại chỗ được', async () => {
    const { service, folder, files } = await withFolder();
    const page = await service.create(actor(), {
      folderId: folder.id,
      name: 'Trang',
      fileName: 'trang.html',
      contentType: 'text/html',
      sizeBytes: 1_000,
    });
    await service.completeUpload(actor(), page.document.id, page.version.id, 1_000);
    await expect(service.download(actor(), page.document.id, undefined, 'preview')).rejects.toThrow('chưa xem trước được');
    await service.download(actor(), page.document.id);
    expect(files.downloads.at(-1)?.options).toEqual({ attachment: true, fileName: 'trang.html' });

    const created = await service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await service.completeUpload(actor(), created.document.id, created.version.id, pdf.sizeBytes);
    await service.download(actor(), created.document.id, undefined, 'preview');
    expect(files.downloads.at(-1)?.options).toEqual({ inline: true, contentType: 'application/pdf', fileName: pdf.fileName });
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

describe('CompanyDocumentService – xoá và Thùng rác', () => {
  afterEach(() => jest.restoreAllMocks());

  async function withDocument(options: { confidentiality?: 'confidential' } = {}) {
    const context = setup();
    const folder = await context.service.createFolder(admin, { name: '3. HỢP ĐỒNG' });
    const created = await context.service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf, ...options });
    await context.service.completeUpload(actor(), created.document.id, created.version.id, pdf.sizeBytes);
    return { ...context, folder, documentId: created.document.id, versionId: created.version.id };
  }

  it('xoá tài liệu cần quyền xoá, và không xoá khi người khác đang khoá', async () => {
    const { service, documentId } = await withDocument();
    await expect(service.deleteDocument(actor(), documentId)).rejects.toBeInstanceOf(SharedForbiddenError);
    await service.lock(actor({ userId: 'user-other' }), documentId);
    await expect(service.deleteDocument(deleter, documentId)).rejects.toBeInstanceOf(SharedDocumentLockedError);
  });

  it('tài liệu đã xoá biến khỏi danh sách và chi tiết, nằm trong Thùng rác', async () => {
    const { service, folder, documentId } = await withDocument();
    await service.deleteDocument(deleter, documentId);
    await expect(service.list(admin, { folderId: folder.id })).resolves.toEqual([]);
    await expect(service.detail(admin, documentId)).rejects.toBeInstanceOf(SharedDocumentNotFoundError);
    await expect(service.deleteDocument(deleter, documentId)).rejects.toBeInstanceOf(SharedDocumentNotFoundError);
    await expect(service.trash(deleter)).resolves.toMatchObject([
      { kind: 'document', id: documentId, name: 'HĐ', location: '3. HỢP ĐỒNG', locationAvailable: true },
    ]);
  });

  it('người không có quyền xoá không xem và không khôi phục được từ Thùng rác', async () => {
    const { service, documentId } = await withDocument();
    await service.deleteDocument(deleter, documentId);
    await expect(service.trash(actor())).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.restoreFromTrash(actor(), 'document', documentId)).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
  });

  it('Thùng rác ẩn tài liệu mật với người không được xem chúng', async () => {
    const { service, documentId } = await withDocument({ confidentiality: 'confidential' });
    await service.deleteDocument(admin, documentId);
    await expect(service.trash(deleter)).resolves.toEqual([]);
    await expect(service.trash(admin)).resolves.toHaveLength(1);
    await expect(service.restoreFromTrash(deleter, 'document', documentId)).rejects.toBeInstanceOf(
      SharedDocumentNotFoundError,
    );
  });

  it('khôi phục tài liệu về chỗ cũ', async () => {
    const { service, folder, documentId } = await withDocument();
    await service.deleteDocument(deleter, documentId);
    await expect(service.restoreFromTrash(deleter, 'document', documentId)).resolves.toEqual({
      kind: 'document',
      id: documentId,
      name: 'HĐ',
    });
    await expect(service.list(admin, { folderId: folder.id })).resolves.toHaveLength(1);
    await expect(service.trash(admin)).resolves.toEqual([]);
  });

  it('khôi phục vào chỗ đã có tài liệu cùng tên thì thêm hậu tố "(khôi phục)"', async () => {
    const { service, folder, documentId } = await withDocument();
    await service.deleteDocument(deleter, documentId);
    await service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await expect(service.restoreFromTrash(deleter, 'document', documentId)).resolves.toMatchObject({
      name: 'HĐ (khôi phục)',
    });
  });

  it('chỗ cũ không còn thì báo FOLDER_UNAVAILABLE, chọn thư mục khác thì khôi phục được', async () => {
    const { service, folder, documentId } = await withDocument();
    const other = await service.createFolder(admin, { name: 'Khác' });
    await service.deleteDocument(deleter, documentId);
    await service.deleteFolder(admin, folder.id);
    await expect(service.restoreFromTrash(deleter, 'document', documentId)).rejects.toBeInstanceOf(
      SharedFolderUnavailableError,
    );
    await expect(
      service.restoreFromTrash(deleter, 'document', documentId, { targetFolderId: other.id }),
    ).resolves.toMatchObject({ name: 'HĐ' });
    await expect(service.list(admin, { folderId: other.id })).resolves.toHaveLength(1);
  });

  it('khôi phục thư mục cùng cả nhánh và tài liệu về chỗ cũ', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const child = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await service.create(actor(), { folderId: child.id, name: 'HĐ', ...pdf });
    await service.deleteFolder(admin, child.id);
    await expect(service.restoreFromTrash(admin, 'folder', child.id)).resolves.toMatchObject({ name: 'B' });
    const names = (await service.folders(admin)).map((folder) => folder.name).sort();
    expect(names).toEqual(['A', 'B']);
    await expect(service.list(admin, { folderId: child.id })).resolves.toHaveLength(1);
    await expect(service.trash(admin)).resolves.toEqual([]);
  });

  it('khôi phục thư mục vào chỗ đã có thư mục cùng tên thì thêm hậu tố', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const child = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await service.deleteFolder(admin, child.id);
    await service.createFolder(admin, { parentId: root.id, name: 'B' });
    await expect(service.restoreFromTrash(admin, 'folder', child.id)).resolves.toMatchObject({
      name: 'B (khôi phục)',
    });
  });

  it('thư mục cha cũng đã xoá thì phải chọn chỗ khác, cả nhánh đổi cấp theo', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const mid = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    const leaf = await service.createFolder(admin, { parentId: mid.id, name: 'C' });
    const target = await service.createFolder(admin, { name: 'Đích' });
    await service.deleteFolder(admin, leaf.id);
    await service.deleteFolder(admin, root.id);
    await expect(service.restoreFromTrash(admin, 'folder', leaf.id)).rejects.toBeInstanceOf(
      SharedFolderUnavailableError,
    );
    await service.restoreFromTrash(admin, 'folder', leaf.id, { targetFolderId: target.id });
    const folders = await service.folders(admin);
    expect(folders.find((folder) => folder.id === leaf.id)).toMatchObject({ parentId: target.id, depth: 1 });
  });

  it('khôi phục thư mục gốc cần quản trị kho; chuyển sang chỗ quá sâu thì từ chối', async () => {
    const { service } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    await service.deleteFolder(admin, root.id);
    await expect(service.restoreFromTrash(deleter, 'folder', root.id)).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.restoreFromTrash(keeper, 'folder', root.id)).resolves.toMatchObject({ name: 'A' });

    let parent = await service.createFolder(admin, { name: 'N0' });
    for (let level = 1; level <= 5; level += 1) {
      parent = await service.createFolder(admin, { parentId: parent.id, name: `N${level}` });
    }
    const branch = await service.createFolder(admin, { name: 'Nhánh' });
    await service.createFolder(admin, { parentId: branch.id, name: 'Cành' });
    await service.deleteFolder(admin, branch.id);
    await expect(
      service.restoreFromTrash(admin, 'folder', branch.id, { targetFolderId: parent.id }),
    ).rejects.toBeInstanceOf(SharedValidationError);
  });

  it('xoá vĩnh viễn cần quản trị kho có quyền xoá', async () => {
    const { service, documentId } = await withDocument();
    await service.deleteDocument(deleter, documentId);
    await expect(service.purge(deleter, 'document', documentId)).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.purge(actor({ canManage: true }), 'document', documentId)).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
    await expect(service.purge(keeper, 'document', documentId)).resolves.toBeUndefined();
    await expect(service.emptyTrash(deleter)).rejects.toBeInstanceOf(SharedForbiddenError);
  });

  it('xoá vĩnh viễn xoá dòng, mọi phiên bản và tệp trong kho', async () => {
    const { service, files, documentId } = await withDocument();
    await service.addVersion(actor(), documentId, { ...pdf, changeNote: 'Bản ký' });
    await service.deleteDocument(deleter, documentId);
    await service.purge(admin, 'document', documentId);
    expect(files.deleted.map((key) => /\/(v\d+)-/.exec(key)?.[1]).sort()).toEqual(['v1', 'v2']);
    await expect(service.trash(admin)).resolves.toEqual([]);
    await expect(service.restoreFromTrash(admin, 'document', documentId)).rejects.toBeInstanceOf(
      SharedDocumentNotFoundError,
    );
  });

  it('chỉ xoá vĩnh viễn được mục đang ở trong Thùng rác', async () => {
    const { service, folder, documentId } = await withDocument();
    await expect(service.purge(admin, 'document', documentId)).rejects.toBeInstanceOf(SharedDocumentNotFoundError);
    await expect(service.purge(admin, 'folder', folder.id)).rejects.toBeInstanceOf(SharedFolderNotFoundError);
  });

  it('kho không xoá được tệp thì dòng vẫn mất, chỉ ghi log', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, files, documentId } = await withDocument();
    await service.deleteDocument(deleter, documentId);
    files.faults.throwOnDelete = true;
    await expect(service.purge(admin, 'document', documentId)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    await expect(service.trash(admin)).resolves.toEqual([]);
  });

  it('kho từ chối một số tệp thì ghi log từng khoá', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, files, versionId, store, documentId } = await withDocument();
    const key = (await store.documents.storageKeyOf(TENANT, versionId))!;
    await service.deleteDocument(deleter, documentId);
    files.faults.failedKeys.push(key);
    await expect(service.purge(admin, 'document', documentId)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(key));
  });

  it('xoá vĩnh viễn thư mục kéo theo cả tài liệu từng xoá riêng trong nhánh', async () => {
    const { service, files, folder, documentId } = await withDocument();
    const second = await service.create(actor(), { folderId: folder.id, name: 'HĐ 2', ...pdf });
    await service.completeUpload(actor(), second.document.id, second.version.id, pdf.sizeBytes);
    await service.deleteDocument(deleter, documentId);
    await service.deleteFolder(admin, folder.id);
    const kinds = (await service.trash(admin)).map((item) => item.kind).sort();
    expect(kinds).toEqual(['document', 'folder']);
    await service.purge(admin, 'folder', folder.id);
    expect(files.deleted).toHaveLength(2);
    await expect(service.trash(admin)).resolves.toEqual([]);
  });

  it('xoá vĩnh viễn nhánh kéo theo cả thư mục con từng xoá riêng; dọn Thùng rác không báo lỗi', async () => {
    const { service, files } = setup();
    const root = await service.createFolder(admin, { name: 'A' });
    const mid = await service.createFolder(admin, { parentId: root.id, name: 'B' });
    const leaf = await service.createFolder(admin, { parentId: mid.id, name: 'C' });
    await service.create(actor(), { folderId: leaf.id, name: 'HĐ', ...pdf });
    await service.deleteFolder(admin, leaf.id);
    await service.deleteFolder(admin, root.id);
    await expect(service.trash(admin)).resolves.toHaveLength(2);
    await expect(service.emptyTrash(admin)).resolves.toEqual({ purged: 1, failed: 0 });
    expect(files.deleted).toHaveLength(1);
    await expect(service.trash(admin)).resolves.toEqual([]);
  });

  it('dọn Thùng rác xoá hết, thư mục trước, và không tính lỗi cho mục đã đi theo thư mục', async () => {
    const { service, files, folder, documentId } = await withDocument();
    const other = await service.createFolder(admin, { name: 'Khác' });
    const loose = await service.create(actor(), { folderId: other.id, name: 'Lẻ', ...pdf });
    await service.deleteDocument(deleter, documentId);
    await service.deleteDocument(deleter, loose.document.id);
    await service.deleteFolder(admin, folder.id);
    await expect(service.emptyTrash(admin)).resolves.toEqual({ purged: 2, failed: 0 });
    expect(files.deleted).toHaveLength(2);
    await expect(service.trash(admin)).resolves.toEqual([]);
  });

  it('dọn Thùng rác: một mục hỏng thì bỏ qua, đếm và đi tiếp', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, store, documentId } = await withDocument();
    const other = await service.createFolder(admin, { name: 'Khác' });
    const second = await service.create(actor(), { folderId: other.id, name: 'Hai', ...pdf });
    await service.deleteDocument(deleter, documentId);
    await service.deleteDocument(deleter, second.document.id);
    jest.spyOn(store.documents, 'purge').mockRejectedValueOnce(new Error('mất kết nối'));
    await expect(service.emptyTrash(admin)).resolves.toEqual({ purged: 1, failed: 1 });
    expect(logged).toHaveBeenCalledTimes(1);
    await expect(service.trash(admin)).resolves.toHaveLength(1);
  });
});

describe('CompanyDocumentService – nhân bản', () => {
  afterEach(() => jest.restoreAllMocks());

  async function ready(options: Parameters<typeof setup>[0] = {}) {
    const context = setup(options);
    const folder = await context.service.createFolder(admin, { name: '3. HỢP ĐỒNG' });
    const created = await context.service.create(actor(), { folderId: folder.id, name: 'HĐ', ...pdf });
    await context.service.completeUpload(actor(), created.document.id, created.version.id, pdf.sizeBytes);
    return { ...context, folder, documentId: created.document.id, versionId: created.version.id };
  }

  it('nhân bản vào cùng thư mục, sao chép tệp ngay trong kho và đặt tên bản sao', async () => {
    const { service, files, folder, documentId, store, versionId } = await ready();
    const copy = await service.duplicate(actor(), documentId);
    expect(copy).toMatchObject({ name: 'HĐ (bản sao)', folderId: folder.id, versionCount: 1, status: 'active' });
    expect(copy.id).not.toBe(documentId);
    expect(copy.currentVersion?.sizeBytes).toBe(pdf.sizeBytes);
    const sourceKey = await store.documents.storageKeyOf(TENANT, versionId);
    expect(files.copies).toEqual([{ from: sourceKey, to: expect.stringContaining(`tenants/${TENANT}/shared/`) }]);
    expect(files.copies[0]?.to).not.toBe(sourceKey);

    const again = await service.duplicate(actor(), documentId);
    expect(again.name).toBe('HĐ (bản sao 2)');
  });

  it('người chỉ đọc không nhân bản được', async () => {
    const { service, documentId } = await ready();
    await expect(service.duplicate(reader, documentId)).rejects.toBeInstanceOf(SharedForbiddenError);
  });

  it('chỉ nhân bản được tài liệu đang dùng và đã tải lên xong', async () => {
    const { service, folder, documentId } = await ready();
    const pending = await service.create(actor(), { folderId: folder.id, name: 'Chưa xong', ...pdf });
    await expect(service.duplicate(actor(), pending.document.id)).rejects.toThrow('chưa tải lên xong');
    await service.archive(admin, documentId);
    await expect(service.duplicate(actor(), documentId)).rejects.toThrow('đã lưu trữ');
  });

  it('vượt hạn mức thì không sao chép tệp', async () => {
    const usage: StorageModuleUsage[] = [];
    const { service, files, documentId, clock } = await ready({
      usage,
      limit: { resourceKey: 'storage_gb', limitValue: 50, enforcement: 'hard', source: 'plan', planKey: 'standard', addOnValue: 0 },
    });
    // Kho đầy sau khi tài liệu gốc đã tải lên.
    usage.push({ moduleKey: 'workspace', label: 'Workspace', bytes: 50 * GB - 1_000_000, files: 10 });
    clock.now += 60_000; // quá hạn cache dung lượng để đọc lại số thật
    await expect(service.duplicate(actor(), documentId)).rejects.toBeInstanceOf(StorageQuotaExceededError);
    expect(files.copies).toEqual([]);
  });

  it('ghi dòng lỗi thì dọn tệp vừa sao chép', async () => {
    const { service, files, store, documentId } = await ready();
    jest.spyOn(store.documents, 'create').mockRejectedValueOnce(new Error('mất kết nối'));
    await expect(service.duplicate(actor(), documentId)).rejects.toThrow('mất kết nối');
    expect(files.copies).toHaveLength(1);
    expect(files.deleted).toEqual([files.copies[0]?.to]);
  });
});

describe('Chia sẻ thư mục', () => {
  // Sơ đồ tổ chức: Công ty › Khối thí nghiệm › Phòng TN điện › (chức danh) Kỹ sư thí nghiệm;
  // Công ty › Phòng Kinh doanh › (chức danh) Chuyên viên kinh doanh.
  const COMPANY = '0a000000-0000-4000-8000-000000000001';
  const LAB_DIVISION = '0a000000-0000-4000-8000-000000000002';
  const LAB_ROOM = '0a000000-0000-4000-8000-000000000003';
  const LAB_ENGINEER = '0a000000-0000-4000-8000-000000000004';
  const SALES_ROOM = '0a000000-0000-4000-8000-000000000005';
  const SALES_STAFF = '0a000000-0000-4000-8000-000000000006';
  const LAB_USER = '0b000000-0000-4000-8000-000000000001';
  const SALES_USER = '0b000000-0000-4000-8000-000000000002';
  const LEFT_USER = '0b000000-0000-4000-8000-000000000003';

  /** Người của phòng thí nghiệm: ghi được, chưa có quyền xoá. */
  const lab = actor({ userId: LAB_USER, displayName: 'Trần Thí Nghiệm' });
  const sales = actor({ userId: SALES_USER, displayName: 'Lê Kinh Doanh' });

  async function organized() {
    const context = setup({ openRoots: false });
    context.organization.nodes = [
      { id: COMPANY, name: 'Công ty', kind: 'unit' },
      { id: LAB_DIVISION, name: 'Khối thí nghiệm', parentId: COMPANY, kind: 'unit' },
      { id: LAB_ROOM, name: 'Phòng TN điện', parentId: LAB_DIVISION, kind: 'unit' },
      { id: LAB_ENGINEER, name: 'Kỹ sư thí nghiệm', parentId: LAB_ROOM, kind: 'position' },
      { id: SALES_ROOM, name: 'Phòng Kinh doanh', parentId: COMPANY, kind: 'unit' },
      { id: SALES_STAFF, name: 'Chuyên viên kinh doanh', parentId: SALES_ROOM, kind: 'position' },
    ];
    context.organization.assignments = [
      { userId: LAB_USER, nodeId: LAB_ENGINEER },
      { userId: SALES_USER, nodeId: SALES_STAFF },
    ];
    context.people.push(
      { id: LAB_USER, name: 'Trần Thí Nghiệm', active: true },
      { id: SALES_USER, name: 'Lê Kinh Doanh', active: true },
      { id: LEFT_USER, name: 'Người Đã Nghỉ', active: false },
      { id: 'user-admin', name: 'Quản trị', active: true },
    );
    const { service } = context;
    const labRoot = await service.createFolder(admin, { name: '6. Khối Thí nghiệm' });
    const contracts = await service.createFolder(admin, { name: '3. HỢP ĐỒNG' });
    const year = await service.createFolder(admin, { parentId: contracts.id, name: 'HỒ SƠ 2026' });
    return { ...context, labRoot, contracts, year };
  }

  it('vào được phân hệ chưa có nghĩa là thấy kho: chưa chia sẻ thì không thấy gì', async () => {
    const { service, sharing, labRoot, year } = await organized();
    const doc = await service.create(admin, { folderId: year.id, name: 'HĐ Trung Nam', ...pdf });
    await expect(service.folders(lab)).resolves.toEqual([]);
    await expect(service.list(lab, { search: 'HĐ' })).resolves.toEqual([]);
    await expect(service.detail(lab, doc.document.id)).rejects.toBeInstanceOf(SharedDocumentNotFoundError);
    await expect(service.list(lab, { folderId: year.id })).rejects.toBeInstanceOf(SharedFolderNotFoundError);
    await expect(service.createFolder(lab, { parentId: labRoot.id, name: 'X' })).rejects.toBeInstanceOf(
      SharedFolderNotFoundError,
    );
    await expect(sharing.sharing(lab, labRoot.id)).rejects.toBeInstanceOf(SharedFolderNotFoundError);
    // Quản trị kho vẫn thấy cả kho, quyền Quản lý ở mọi thư mục.
    expect((await service.folders(admin)).map((folder) => folder.access)).toEqual(['manager', 'manager', 'manager']);
  });

  it('chia sẻ cho phòng ban tới cả người ở đơn vị con, áp xuống thư mục con', async () => {
    const { service, sharing, labRoot } = await organized();
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' }],
    });
    const sub = await service.createFolder(admin, { parentId: labRoot.id, name: 'ISO 17025' });
    const seen = await service.folders(lab);
    expect(seen.map((folder) => [folder.name, folder.access])).toEqual([
      ['6. Khối Thí nghiệm', 'editor'],
      ['ISO 17025', 'editor'],
    ]);
    await expect(service.create(lab, { folderId: sub.id, name: 'Biên bản', ...pdf })).resolves.toBeDefined();
    await expect(service.folders(sales)).resolves.toEqual([]);
    await expect(service.create(sales, { folderId: sub.id, name: 'X', ...pdf })).rejects.toBeInstanceOf(
      SharedFolderNotFoundError,
    );
  });

  it('chia sẻ cho chức danh, quyền Xem không ghi được', async () => {
    const { service, sharing, contracts, year } = await organized();
    await sharing.updateSharing(admin, contracts.id, {
      shares: [{ principalType: 'position', principalId: SALES_STAFF, role: 'viewer' }],
    });
    expect((await service.folders(sales)).map((folder) => folder.id)).toEqual([contracts.id, year.id]);
    await expect(service.create(sales, { folderId: year.id, name: 'X', ...pdf })).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
    await expect(service.createFolder(sales, { parentId: year.id, name: 'X' })).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
    await expect(service.folders(lab)).resolves.toEqual([]);
  });

  it('thời hạn tính hết ngày: hôm qua là hết quyền, hôm nay còn', async () => {
    const { service, sharing, labRoot } = await organized();
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'user', principalId: LAB_USER, role: 'viewer', expiresOn: '2026-10-15' }],
    });
    await expect(service.folders(lab)).resolves.toEqual([]);
    const view = await sharing.sharing(admin, labRoot.id);
    expect(view.shares[0]).toMatchObject({ label: 'Trần Thí Nghiệm', expired: true });
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'user', principalId: LAB_USER, role: 'viewer', expiresOn: TODAY }],
    });
    await expect(service.folders(lab)).resolves.toHaveLength(1);
  });

  it('người tạo thư mục con là chủ sở hữu: Quản lý ở đó và chia sẻ tiếp được', async () => {
    const { service, sharing, labRoot } = await organized();
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' }],
    });
    const own = await service.createFolder(lab, { parentId: labRoot.id, name: 'Báo cáo tháng' });
    expect(own.access).toBe('manager');
    await expect(sharing.sharing(lab, labRoot.id)).rejects.toBeInstanceOf(SharedForbiddenError);
    await sharing.updateSharing(lab, own.id, {
      shares: [{ principalType: 'user', principalId: SALES_USER, role: 'viewer' }],
    });
    expect((await service.folders(sales)).map((folder) => folder.name)).toEqual(['Báo cáo tháng']);

    const view = await sharing.sharing(lab, own.id);
    expect(view.owner).toEqual({ userId: LAB_USER, name: 'Trần Thí Nghiệm' });
    expect(view.shares).toEqual([
      expect.objectContaining({ principalType: 'user', label: 'Lê Kinh Doanh', detail: 'Chuyên viên kinh doanh · Phòng Kinh doanh' }),
    ]);
    expect(view.inherited).toEqual([
      expect.objectContaining({ owner: true, label: 'Quản trị', role: 'manager', fromFolderName: '6. Khối Thí nghiệm' }),
      expect.objectContaining({
        principalType: 'unit',
        label: 'Khối thí nghiệm',
        detail: 'Công ty',
        role: 'editor',
        fromFolderId: labRoot.id,
      }),
    ]);
  });

  it('người chỉ có quyền xem của phân hệ: không ghi, không chia sẻ dù được giao Quản lý', async () => {
    const { service, sharing, labRoot } = await organized();
    const viewerOnly = actor({ userId: LAB_USER, canWriteDocuments: false });
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'user', principalId: LAB_USER, role: 'manager' }],
    });
    await expect(service.folders(viewerOnly)).resolves.toMatchObject([{ access: 'manager' }]);
    await expect(service.create(viewerOnly, { folderId: labRoot.id, name: 'X', ...pdf })).rejects.toBeInstanceOf(
      SharedForbiddenError,
    );
    await expect(sharing.sharing(viewerOnly, labRoot.id)).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(sharing.directory(viewerOnly)).rejects.toBeInstanceOf(SharedForbiddenError);
  });

  it('độ mật theo quyền ở thư mục: Hạn chế cần Sửa, Mật cần Quản lý', async () => {
    const { service, sharing, labRoot } = await organized();
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [
        { principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' },
        { principalType: 'user', principalId: SALES_USER, role: 'viewer' },
      ],
    });
    const restricted = await service.create(admin, { folderId: labRoot.id, name: 'Báo giá', ...pdf, confidentiality: 'restricted' });
    const secret = await service.create(admin, { folderId: labRoot.id, name: 'Lương', ...pdf, confidentiality: 'confidential' });
    const names = async (who: SharedActor) =>
      (await service.list(who, { folderId: labRoot.id })).map((doc) => doc.name).sort();
    await expect(names(sales)).resolves.toEqual([]);
    await expect(names(lab)).resolves.toEqual(['Báo giá']);
    await expect(service.detail(sales, restricted.document.id)).rejects.toBeInstanceOf(SharedDocumentNotFoundError);
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'manager' }],
    });
    await expect(names(lab)).resolves.toEqual(['Báo giá', 'Lương']);
    await expect(service.detail(lab, secret.document.id)).resolves.toMatchObject({ name: 'Lương' });
  });

  it('tìm cả kho chỉ trong thư mục được vào; thư mục con chia sẻ riêng hiện như gốc', async () => {
    const { service, sharing, labRoot, year } = await organized();
    await service.create(admin, { folderId: labRoot.id, name: 'HĐ thí nghiệm', ...pdf });
    await service.create(admin, { folderId: year.id, name: 'HĐ Trung Nam', ...pdf });
    await sharing.updateSharing(admin, year.id, {
      shares: [{ principalType: 'user', principalId: SALES_USER, role: 'viewer' }],
    });
    const folders = await service.folders(sales);
    expect(folders).toEqual([expect.objectContaining({ id: year.id, parentId: expect.any(String), access: 'viewer' })]);
    const found = await service.list(sales, { search: 'HĐ' });
    expect(found.map((doc) => [doc.name, doc.folderPath])).toEqual([['HĐ Trung Nam', 'HỒ SƠ 2026']]);
  });

  it('Thùng rác chỉ hiện mục ở thư mục người dùng có quyền Sửa', async () => {
    const { service, sharing, labRoot, year } = await organized();
    const labDeleter = actor({ userId: LAB_USER, canDeleteDocuments: true });
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' }],
    });
    const mine = await service.create(admin, { folderId: labRoot.id, name: 'Của khối', ...pdf });
    const theirs = await service.create(admin, { folderId: year.id, name: 'Của kinh doanh', ...pdf });
    await service.deleteDocument(labDeleter, mine.document.id);
    await service.deleteDocument(admin, theirs.document.id);
    await expect(service.trash(labDeleter)).resolves.toMatchObject([{ id: mine.document.id, location: '6. Khối Thí nghiệm' }]);
    await expect(service.restoreFromTrash(labDeleter, 'document', theirs.document.id)).rejects.toBeInstanceOf(
      SharedDocumentNotFoundError,
    );
    // Khôi phục sang chỗ không có quyền Sửa thì từ chối.
    await expect(
      service.restoreFromTrash(labDeleter, 'document', mine.document.id, { targetFolderId: year.id }),
    ).rejects.toBeInstanceOf(SharedForbiddenError);
    await expect(service.restoreFromTrash(labDeleter, 'document', mine.document.id)).resolves.toMatchObject({
      name: 'Của khối',
    });
  });

  it('kiểm danh sách chia sẻ: trùng, thiếu quyền, đối tượng không có thật', async () => {
    const { sharing, labRoot } = await organized();
    const save = (shares: unknown[]) =>
      sharing.updateSharing(admin, labRoot.id, { shares } as Parameters<typeof sharing.updateSharing>[2]);
    await expect(
      save([
        { principalType: 'unit', principalId: LAB_DIVISION, role: 'viewer' },
        { principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' },
      ]),
    ).rejects.toThrow('một lần');
    await expect(save([{ principalType: 'unit', principalId: LAB_DIVISION }])).rejects.toThrow('Chọn quyền');
    await expect(save([{ principalType: 'unit', role: 'viewer' }])).rejects.toThrow('Chọn đối tượng');
    await expect(save([{ principalType: 'unit', principalId: LAB_ENGINEER, role: 'viewer' }])).rejects.toThrow(
      'không còn trong sơ đồ tổ chức',
    );
    await expect(save([{ principalType: 'user', principalId: LEFT_USER, role: 'viewer' }])).rejects.toThrow(
      'không còn trong danh sách',
    );
    await expect(save([{ principalType: 'everyone', role: 'viewer', expiresOn: '16/10/2026' }])).rejects.toThrow(
      'YYYY-MM-DD',
    );
    await expect(save([{ principalType: 'group', principalId: COMPANY, role: 'viewer' }])).rejects.toThrow(
      'không hợp lệ',
    );
  });

  it('không đọc được sơ đồ tổ chức: giữ được dòng cũ, không thêm được phòng ban mới', async () => {
    const { sharing, labRoot, organization } = await organized();
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'viewer' }],
    });
    organization.degraded = true;
    organization.nodes = [];
    const kept = await sharing.updateSharing(admin, labRoot.id, {
      shares: [
        { principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' },
        { principalType: 'everyone', role: 'viewer' },
      ],
    });
    expect(kept.shares.map((share) => [share.label, share.role, share.missing])).toEqual([
      ['Mọi người', 'viewer', false],
      ['Phòng ban', 'editor', false],
    ]);
    await expect(
      sharing.updateSharing(admin, labRoot.id, {
        shares: [{ principalType: 'unit', principalId: SALES_ROOM, role: 'viewer' }],
      }),
    ).rejects.toThrow('Chưa đọc được sơ đồ tổ chức');
  });

  it('dòng giữ nguyên quyền thì giữ người sửa cuối', async () => {
    const { sharing, labRoot, shares } = await organized();
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'viewer' }],
    });
    await sharing.updateSharing(keeper, labRoot.id, {
      shares: [
        { principalType: 'unit', principalId: LAB_DIVISION, role: 'viewer' },
        { principalType: 'unit', principalId: SALES_ROOM, role: 'editor' },
      ],
    });
    expect(shares.map((share) => [share.principalId, share.updatedBy])).toEqual([
      [LAB_DIVISION, 'user-admin'],
      [SALES_ROOM, 'user-keeper'],
    ]);
  });

  it('danh bạ chỉ cho người chia sẻ được: người còn hoạt động, phòng ban kèm đường dẫn', async () => {
    const { service, sharing, labRoot } = await organized();
    await expect(sharing.directory(lab)).rejects.toBeInstanceOf(SharedForbiddenError);
    await sharing.updateSharing(admin, labRoot.id, {
      shares: [{ principalType: 'unit', principalId: LAB_DIVISION, role: 'editor' }],
    });
    await service.createFolder(lab, { parentId: labRoot.id, name: 'Của tôi' });
    const directory = await sharing.directory(lab);
    expect(directory.people.map((person) => person.displayName)).toEqual(['Lê Kinh Doanh', 'Quản trị', 'Trần Thí Nghiệm']);
    expect(directory.people.find((person) => person.userId === LAB_USER)).toMatchObject({
      unitNames: ['Phòng TN điện'],
      positionName: 'Kỹ sư thí nghiệm',
    });
    expect(directory.nodes.find((node) => node.id === LAB_ENGINEER)).toMatchObject({
      kind: 'position',
      path: 'Công ty › Khối thí nghiệm › Phòng TN điện',
    });
    expect(directory.degraded).toBe(false);
  });
});

describe('withFreeName', () => {
  const taken = (...names: string[]) => async (name: string) => {
    if (names.includes(name)) throw new SharedNameTakenError(name);
    return name;
  };

  it('giữ tên gốc khi chưa trùng', async () => {
    await expect(withFreeName('HĐ', 255, 'khôi phục', taken())).resolves.toEqual({ name: 'HĐ', value: 'HĐ' });
  });

  it('thêm hậu tố rồi đánh số cho tới khi hết trùng', async () => {
    const result = await withFreeName('HĐ', 255, 'khôi phục', taken('HĐ', 'HĐ (khôi phục)', 'HĐ (khôi phục 2)'));
    expect(result.name).toBe('HĐ (khôi phục 3)');
  });

  it('cắt tên gốc cho vừa độ dài tối đa kể cả hậu tố', async () => {
    const base = 'x'.repeat(255);
    const result = await withFreeName(base, 255, 'khôi phục', taken(base));
    expect(result.name).toHaveLength(255);
    expect(result.name.endsWith(' (khôi phục)')).toBe(true);
  });

  it('lỗi không phải trùng tên thì ném thẳng, không thử tiếp', async () => {
    const attempt = jest.fn().mockRejectedValue(new Error('mất kết nối'));
    await expect(withFreeName('HĐ', 255, 'khôi phục', attempt)).rejects.toThrow('mất kết nối');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('thử mãi vẫn trùng thì bỏ cuộc với lỗi trùng tên', async () => {
    const attempt = jest.fn().mockRejectedValue(new SharedNameTakenError('HĐ'));
    await expect(withFreeName('HĐ', 255, 'khôi phục', attempt)).rejects.toBeInstanceOf(SharedNameTakenError);
    expect(attempt.mock.calls.length).toBeGreaterThan(10);
  });
});
