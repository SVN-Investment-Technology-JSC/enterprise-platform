import { CRM_NO_CAPABILITIES, type CrmDocument } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import { CrmDataScopeService } from './data-scope.js';
import { DocumentService, DocumentTypeService } from './document.service.js';
import type { DocumentStorage, DocumentStore } from './document-store.port.js';

const TENANT = 'tenant-1';
const ENTITY = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: 'user-1',
  displayName: 'Người dùng',
  canWriteDocument: true,
  ...extra,
});

const document = (extra: Partial<CrmDocument> = {}): CrmDocument => ({
  id: DOC_ID,
  entityType: 'opportunity',
  entityId: ENTITY,
  folderId: null,
  documentType: null,
  name: 'Tài liệu',
  description: null,
  audience: 'internal',
  currentVersionNo: 1,
  fileName: 'a.pdf',
  contentType: 'application/pdf',
  sizeBytes: 10,
  lockedByUserId: null,
  lockedAt: null,
  createdBy: 'user-1',
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  ...extra,
});

function setup(options: { visible?: boolean; doc?: CrmDocument } = {}) {
  const store = {
    entityVisible: jest.fn(async () => options.visible ?? true),
    findDocument: jest.fn(async () => options.doc ?? document()),
    createDocument: jest.fn(async (_tenant, _actor, input) => ({
      document: document({ id: input.id }),
      version: { id: input.versionId, documentId: input.id, versionNo: 1 },
    })),
    setLock: jest.fn(async () => document()),
    deleteDocument: jest.fn(async () => true),
    findDocumentType: jest.fn(async () => ({ id: 't1', code: 'X', name: 'Loại X', description: null, active: false, sortOrder: 0 })),
    createDocumentType: jest.fn(),
  } as unknown as jest.Mocked<DocumentStore>;
  const storage = {
    createUploadUrl: jest.fn(async () => 'https://s3.local/upload'),
    createDownloadUrl: jest.fn(async () => 'https://s3.local/download'),
    objectSize: jest.fn(async () => 10),
  } as unknown as jest.Mocked<DocumentStorage>;
  const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
  return { store, storage, service: new DocumentService(store, storage, scopes) };
}

const upload = { entityType: 'opportunity', entityId: ENTITY, fileName: 'hs.pdf', contentType: 'application/pdf', sizeBytes: 100 } as const;

describe('DocumentService', () => {
  it('TC-DOC-01: tạo tài liệu ký URL 300 giây ghim đúng dung lượng, object_key không chứa tên thô', async () => {
    const { service, storage, store } = setup();
    const result = await service.create(actor(), { ...upload, fileName: 'Hồ sơ/mời thầu.pdf' });
    expect(result.uploadUrl).toBe('https://s3.local/upload');
    expect(result.expiresInSeconds).toBe(300);
    const signed = storage.createUploadUrl.mock.calls[0][0];
    expect(signed).toMatchObject({ contentType: 'application/pdf', sizeBytes: 100, expiresInSeconds: 300 });
    expect(signed.key).toMatch(/^tenants\/tenant-1\/crm\/documents\/opportunity\/[0-9a-f-]{36}\/v1-Ho-so_moi-thau\.pdf$/);
    expect(store.createDocument.mock.calls[0][2].name).toBe('Hồ sơ_mời thầu.pdf');
  });

  it('TC-DOC-02/03: file .exe hoặc 51 MB bị từ chối, không ghi bản ghi, không ký URL', async () => {
    const { service, storage, store } = setup();
    await expect(service.create(actor(), { ...upload, contentType: 'application/x-msdownload' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create(actor(), { ...upload, sizeBytes: 51 * 1024 * 1024 })).rejects.toMatchObject({ statusCode: 400 });
    expect(store.createDocument).not.toHaveBeenCalled();
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('TC-DOC-08: đối tượng ngoài phạm vi thì 404 cho tạo, phiên bản, tải xuống, xoá', async () => {
    const { service, storage } = setup({ visible: false });
    const full = actor({ canDeleteDocument: true });
    await expect(service.create(full, upload)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.addVersion(full, DOC_ID, { ...upload, changeNote: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.download(full, DOC_ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.remove(full, DOC_ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.list(full, { entityType: 'opportunity', entityId: ENTITY })).rejects.toMatchObject({ statusCode: 404 });
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('thiếu quyền ghi thì 403; xoá cần quyền xoá riêng', async () => {
    const { service } = setup();
    await expect(service.create(actor({ canWriteDocument: false }), upload)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.lock(actor({ canWriteDocument: false }), DOC_ID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(actor({ canManage: true }), DOC_ID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('TC-DOC-05: tài liệu khoá bởi người khác: không tải bản mới, không khoá lại; chỉ người khoá hoặc quản lý mở', async () => {
    const locked = document({ lockedByUserId: 'owner', lockedAt: '2026-11-02T00:00:00.000Z' });
    const { service, store } = setup({ doc: locked });
    await expect(service.addVersion(actor(), DOC_ID, { ...upload, changeNote: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.lock(actor(), DOC_ID)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.unlock(actor(), DOC_ID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.unlock(actor({ userId: 'owner' }), DOC_ID)).resolves.toBeDefined();
    await expect(service.unlock(actor({ canManage: true }), DOC_ID)).resolves.toBeDefined();
    expect(store.setLock).toHaveBeenCalledTimes(2);
  });

  it('loại tài liệu đã tắt không chọn cho tài liệu mới', async () => {
    const { service } = setup();
    await expect(service.create(actor(), { ...upload, documentTypeId: 't1' })).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_INACTIVE' });
  });

  it('quản lý loại tài liệu chỉ crm.manage', async () => {
    const { store } = setup();
    const types = new DocumentTypeService(store);
    await expect(types.create(actor(), { code: 'ABC', name: 'Loại' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(types.update(actor(), 't1', { active: false })).rejects.toMatchObject({ statusCode: 403 });
  });
});
