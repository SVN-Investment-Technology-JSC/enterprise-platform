import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DocumentService, DocumentTypeService } from './application/document.service.js';
import type { DocumentStorage } from './application/document-store.port.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService } from './application/opportunity.service.js';
import { CachedPipelineConfig } from './application/pipeline-config.cache.js';
import { StageAssigneeResolver } from './application/stage-assignee.resolver.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresDocumentStore, PostgresOpportunityDocumentChecker } from './infrastructure/postgres-document.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresPipelineConfigReader } from './infrastructure/postgres-pipeline-config.store.js';
import { S3DocumentStorage } from './infrastructure/s3-document-storage.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const QL = randomUUID();
const TN = randomUUID();
const NV1 = randomUUID();
const NV3 = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-ql', reportsToPositionId: null },
    { id: 'p-tn', reportsToPositionId: 'p-ql' },
    { id: 'p-nv1', reportsToPositionId: 'p-tn' },
    { id: 'p-nv3', reportsToPositionId: 'p-ql' },
  ],
  assignments: [
    { userId: QL, positionId: 'p-ql' },
    { userId: TN, positionId: 'p-tn' },
    { userId: NV1, positionId: 'p-nv1' },
    { userId: NV3, positionId: 'p-nv3' },
  ],
};
const PEOPLE = [QL, TN, NV1, NV3].map((userId) => ({ userId, displayName: userId.slice(0, 4) }));

const BUCKET = 'crm-test-bucket';
const ENDPOINT = 'http://minio.test:9000';

/**
 * Kho giả cho test, KHÔNG cần mạng và không cần MinIO: URL ký bằng `S3ObjectStorage` thật (ký là tính toán
 * cục bộ, không gọi mạng) nên kiểm được chữ ký, TTL, `content-length` bị ghim; còn việc "trình duyệt PUT lên
 * kho" được mô phỏng bằng `put` (kiểm hạn URL, dung lượng ghim) rồi `objectSize` (HEAD) đọc từ bộ nhớ.
 */
class FakeObjectStorage implements DocumentStorage {
  readonly objects = new Map<string, number>();
  readonly signed: { kind: 'upload' | 'download'; url: string; key: string }[] = [];
  private readonly s3 = new S3ObjectStorage({
    internalEndpoint: ENDPOINT,
    publicEndpoint: ENDPOINT,
    bucket: BUCKET,
    accessKeyId: 'test',
    secretAccessKey: 'test-secret',
    forcePathStyle: true,
  });

  keyOf(url: string): string {
    return decodeURIComponent(new URL(url).pathname.replace(`/${BUCKET}/`, ''));
  }

  async createUploadUrl(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }): Promise<string> {
    const url = await new S3DocumentStorage(this.s3).createUploadUrl(input);
    this.signed.push({ kind: 'upload', url, key: input.key });
    return url;
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const url = await new S3DocumentStorage(this.s3).createDownloadUrl(key, expiresInSeconds);
    this.signed.push({ kind: 'download', url, key });
    return url;
  }

  async objectSize(key: string): Promise<number | null> {
    return this.objects.get(key) ?? null;
  }

  /** Mô phỏng trình duyệt `PUT` lên URL ký: kho từ chối khi URL hết hạn hoặc số byte khác số đã ghim. */
  put(url: string, bytes: number, now = Date.now()): void {
    const params = new URL(url).searchParams;
    const signedAt = Date.parse(params.get('X-Amz-Date')!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    if (now > signedAt + Number(params.get('X-Amz-Expires')) * 1000) throw new Error('Request has expired');
    expect(params.get('X-Amz-SignedHeaders')).toContain('content-length');
    this.objects.set(this.keyOf(url), bytes);
  }
}

/**
 * Kho tài liệu CRM (GĐ C, P2C-01..06, P2C-11 phần backend) trên PostgreSQL thật. S3 là bản giả cục bộ
 * (`FakeObjectStorage`): URL ký thật, không có MinIO.
 */
integration('Bán hàng GĐ C: tài liệu, phạm vi, quyền và điều kiện DOCUMENT_TYPE (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  let other: CrmTestDatabaseHandle;
  let storage: FakeObjectStorage;
  let documents: DocumentService;
  let types: DocumentTypeService;
  let opportunities: OpportunityService;
  let otherDocuments: DocumentService;
  let config: CachedPipelineConfig;
  let docStore: PostgresDocumentStore;
  let customerId: string;
  let oppId: string;
  const tenantId = randomUUID();
  const actorOf = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    canWriteDocument: true,
    ...extra,
  });
  const nv1 = actorOf(NV1);
  const nv3 = actorOf(NV3);
  const tn = actorOf(TN);
  const reader = actorOf(NV1, { canWriteDocument: false });
  const manager = actorOf(QL, { canManage: true, canReadAll: true });
  const deleter = actorOf(QL, { canManage: true, canReadAll: true, canDeleteDocument: true });

  const query = async <T>(text: string, values: unknown[] = []): Promise<T[]> => (await handle.pool.query(text, values)).rows as T[];
  const typeId = async (code: string): Promise<string> =>
    (await query<{ id: string }>(`SELECT id FROM crm_schema.document_types WHERE code = $1`, [code]))[0].id;
  const auditActions = async (id: string): Promise<string[]> =>
    (await query<{ action: string }>(`SELECT action FROM crm_schema.audit_log WHERE entity_type = 'document' AND entity_id = $1 ORDER BY at, id`, [id])).map(
      (row) => row.action,
    );
  const pdf = (extra: Record<string, unknown> = {}) => ({
    entityType: 'opportunity' as const,
    entityId: oppId,
    fileName: 'ho-so.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1000,
    ...extra,
  });
  /** Tạo tài liệu, mô phỏng PUT rồi xác nhận: trả tài liệu đã có phiên bản hiện hành. */
  async function uploaded(actor: CrmActor, extra: Record<string, unknown> = {}) {
    const created = await documents.create(actor, pdf(extra));
    storage.put(created.uploadUrl, (extra['sizeBytes'] as number | undefined) ?? 1000);
    await documents.completeUpload(actor, created.document.id, created.version.id, { sizeBytes: (extra['sizeBytes'] as number | undefined) ?? 1000 });
    return created;
  }

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    other = await createCrmTestDatabase();
    storage = new FakeObjectStorage();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const organization = { snapshot: async () => ORGANIZATION, people: async () => PEOPLE };
    docStore = new PostgresDocumentStore(handle.database);
    documents = new DocumentService(docStore, storage, scopes);
    types = new DocumentTypeService(new PostgresDocumentStore(handle.database));
    otherDocuments = new DocumentService(new PostgresDocumentStore(other.database), new FakeObjectStorage(), scopes);
    const customerStore = new PostgresCustomerStore(handle.database);
    config = new CachedPipelineConfig(new PostgresPipelineConfigReader(handle.database), 60_000);
    opportunities = new OpportunityService(
      new PostgresOpportunityStore(handle.database),
      customerStore,
      scopes,
      config,
      undefined,
      new PostgresOpportunityDocumentChecker(handle.database),
      new StageAssigneeResolver(organization),
      organization,
    );
    customerId = (await new CustomerService(customerStore, scopes).create(manager, { name: 'Khách tài liệu', ownerUserId: NV1 })).id;
    oppId = (await opportunities.create(nv1, { customerId, name: 'Dự án tài liệu' })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
    await other?.drop();
  }, 60_000);

  it('TC-P2MIG-03 / TC-DOC-01 (DB): migration tạo đủ bảng, bộ loại tài liệu mẫu, chạy lại được, object_key duy nhất', async () => {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm_schema'
        AND table_name IN ('document_types', 'document_folders', 'documents', 'document_versions')`,
    );
    expect(tables).toHaveLength(4);
    const seeded = await query<{ code: string; name: string }>(`SELECT code, name FROM crm_schema.document_types ORDER BY sort_order`);
    expect(seeded.map((row) => row.name)).toEqual([
      'Hồ sơ mời thầu', 'Hồ sơ pháp lý', 'Dự toán', 'Phương án kinh doanh', 'Hợp đồng mẫu', 'Biên bản khảo sát', 'Biên bản nghiệm thu',
    ]);
    // Chạy lại nguyên file migration trên DB đã có dữ liệu: không lỗi, không nhân đôi.
    const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm/0020-documents.sql'), 'utf8');
    await handle.pool.query(sql);
    expect(await query(`SELECT 1 FROM crm_schema.document_types`)).toHaveLength(7);
    const unique = await query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'crm_schema.document_versions'::regclass AND contype = 'u'`,
    );
    expect(unique.map((row) => row.conname)).toContain('uq_crm_document_versions_object_key');
  });

  it('TC-DOC-01: xin URL, PUT (giả), xác nhận, danh sách; URL ký 300 giây ghim độ dài; không có bước nhận byte', async () => {
    const created = await documents.create(nv1, pdf({ documentTypeId: await typeId('TENDER_DOSSIER'), name: 'HSMT gói A' }));
    expect(created.expiresInSeconds).toBe(300);
    const params = new URL(created.uploadUrl).searchParams;
    expect(params.get('X-Amz-Expires')).toBe('300');
    expect(params.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(storage.keyOf(created.uploadUrl)).toMatch(new RegExp(`^tenants/${tenantId}/crm/documents/opportunity/[0-9a-f-]{36}/v1-ho-so\\.pdf$`));

    // Chưa xác nhận: chưa có phiên bản hiện hành, chưa tải xuống được, điều kiện "còn hiệu lực" chưa tính.
    const before = await documents.list(nv1, { entityType: 'opportunity', entityId: oppId });
    expect(before.find((doc) => doc.id === created.document.id)).toMatchObject({ currentVersionNo: null, sizeBytes: null });
    await expect(documents.download(nv1, created.document.id)).rejects.toMatchObject({ statusCode: 404 });
    // Xác nhận khi kho chưa có object: từ chối.
    await expect(documents.completeUpload(nv1, created.document.id, created.version.id, { sizeBytes: 1000 })).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' });

    storage.put(created.uploadUrl, 1000);
    // Kho có 1000 byte nhưng người dùng báo khác: từ chối.
    await expect(documents.completeUpload(nv1, created.document.id, created.version.id, { sizeBytes: 999 })).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });
    const done = await documents.completeUpload(nv1, created.document.id, created.version.id, { sizeBytes: 1000 });
    expect(done).toMatchObject({ versionNo: 1, sizeBytes: 1000 });
    expect(done.uploadedAt).not.toBeNull();

    const listed = (await documents.list(nv1, { entityType: 'opportunity', entityId: oppId })).find((doc) => doc.id === created.document.id)!;
    expect(listed).toMatchObject({
      name: 'HSMT gói A', fileName: 'ho-so.pdf', sizeBytes: 1000, currentVersionNo: 1, createdBy: NV1, audience: 'internal',
      documentType: { code: 'TENDER_DOSSIER', name: 'Hồ sơ mời thầu' },
    });
    const ticket = await documents.download(nv1, created.document.id);
    expect(new URL(ticket.downloadUrl).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(ticket.fileName).toBe('ho-so.pdf');
  });

  it('TC-DOC-02/03: .exe hoặc 51 MB bị từ chối 400, không tạo bản ghi, không ký URL', async () => {
    const count = async () => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.documents`))[0].n;
    const before = count();
    const signedBefore = storage.signed.length;
    await expect(documents.create(nv1, pdf({ fileName: 'a.exe', contentType: 'application/x-msdownload' }))).rejects.toMatchObject({ statusCode: 400, code: 'UNSUPPORTED_CONTENT_TYPE' });
    await expect(documents.create(nv1, pdf({ sizeBytes: 51 * 1024 * 1024 }))).rejects.toMatchObject({ statusCode: 400, code: 'FILE_TOO_LARGE' });
    expect(await count()).toBe(await before);
    expect(storage.signed.length).toBe(signedBefore);
  });

  it('TC-DOC-04: phiên bản mới; danh sách phiên bản có 2, bản mới hiện hành, bản cũ vẫn tải được', async () => {
    const first = await uploaded(nv1, { fileName: 'bao-gia-v1.pdf' });
    const second = await documents.addVersion(nv1, first.document.id, { fileName: 'bao-gia-v2.pdf', contentType: 'application/pdf', sizeBytes: 2000, changeNote: 'Cập nhật giá' });
    expect(second.version.versionNo).toBe(2);
    // Chưa xác nhận bản 2: bản hiện hành vẫn là 1.
    expect((await documents.get(nv1, first.document.id)).currentVersionNo).toBe(1);
    storage.put(second.uploadUrl, 2000);
    await documents.completeUpload(nv1, first.document.id, second.version.id, { sizeBytes: 2000 });
    const detail = await documents.get(nv1, first.document.id);
    expect(detail.versions.map((version) => version.versionNo)).toEqual([2, 1]);
    expect(detail).toMatchObject({ currentVersionNo: 2, fileName: 'bao-gia-v2.pdf', sizeBytes: 2000 });
    expect((await documents.download(nv1, first.document.id)).versionNo).toBe(2);
    const old = await documents.download(nv1, first.document.id, 1);
    expect(old).toMatchObject({ versionNo: 1, fileName: 'bao-gia-v1.pdf' });
    await expect(documents.addVersion(nv1, first.document.id, { fileName: 'x.pdf', contentType: 'application/pdf', sizeBytes: 1, changeNote: '  ' })).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.keyOf(second.uploadUrl)).toContain('/v2-bao-gia-v2.pdf');
  });

  it('TC-DOC-05: khoá và mở khoá; khi khoá người khác không tải bản mới, chỉ người khoá hoặc quản lý mở', async () => {
    const doc = await uploaded(nv1);
    const locked = await documents.lock(nv1, doc.document.id);
    expect(locked.lockedByUserId).toBe(NV1);
    // TN thấy dự án của NV1 (cấp trên), ghi được, nhưng bị khoá chặn.
    await expect(documents.addVersion(tn, doc.document.id, { fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 5, changeNote: 'thử' })).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_LOCKED' });
    await expect(documents.lock(tn, doc.document.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(documents.unlock(tn, doc.document.id)).rejects.toMatchObject({ statusCode: 403 });
    expect((await documents.unlock(nv1, doc.document.id)).lockedByUserId).toBeNull();
    await documents.lock(nv1, doc.document.id);
    expect((await documents.unlock(manager, doc.document.id)).lockedByUserId).toBeNull();
    expect(await auditActions(doc.document.id)).toEqual(expect.arrayContaining(['lock', 'unlock']));
  });

  it('TC-DOC-06: đổi đối tượng xem internal/customer, ghi nhật ký trước/sau; lọc theo audience', async () => {
    const doc = await uploaded(nv1);
    expect((await documents.setAudience(nv1, doc.document.id, { audience: 'customer' })).audience).toBe('customer');
    const forCustomer = await documents.list(nv1, { entityType: 'opportunity', entityId: oppId, audience: 'customer' });
    expect(forCustomer.map((entry) => entry.id)).toContain(doc.document.id);
    expect((await documents.list(nv1, { entityType: 'opportunity', entityId: oppId, audience: 'internal' })).map((entry) => entry.id)).not.toContain(doc.document.id);
    await documents.setAudience(nv1, doc.document.id, { audience: 'internal' });
    await expect(documents.setAudience(nv1, doc.document.id, { audience: 'public' as never })).rejects.toMatchObject({ statusCode: 400 });
    const rows = await query<{ from_status: string; to_status: string }>(
      `SELECT from_status, to_status FROM crm_schema.audit_log WHERE entity_id = $1 AND action = 'audience' ORDER BY at, id`,
      [doc.document.id],
    );
    expect(rows.map((row) => [row.from_status, row.to_status])).toEqual([['internal', 'customer'], ['customer', 'internal']]);
  });

  it('TC-DOC-07: URL ký hết hạn sau 300 giây (mô phỏng đồng hồ); URL tải xuống cũng ký 300 giây', async () => {
    const created = await documents.create(nv1, pdf());
    expect(() => storage.put(created.uploadUrl, 1000, Date.now() + 299_000)).not.toThrow();
    expect(() => storage.put(created.uploadUrl, 1000, Date.now() + 301_000)).toThrow('expired');
    storage.put(created.uploadUrl, 1000);
    await documents.completeUpload(nv1, created.document.id, created.version.id, { sizeBytes: 1000 });
    const ticket = await documents.download(nv1, created.document.id);
    expect(new URL(ticket.downloadUrl).searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('TC-DOC-08: người ngoài phạm vi (NV3) nhận 404 cho danh sách, tạo, xin URL tải, phiên bản, khoá, xoá', async () => {
    const doc = await uploaded(nv1);
    const stranger = actorOf(NV3, { canDeleteDocument: true });
    await expect(documents.list(nv3, { entityType: 'opportunity', entityId: oppId })).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.create(nv3, pdf())).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.get(nv3, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.download(nv3, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.addVersion(nv3, doc.document.id, { fileName: 'x.pdf', contentType: 'application/pdf', sizeBytes: 1, changeNote: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.lock(nv3, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.remove(stranger, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.listFolders(nv3, 'opportunity', oppId)).rejects.toMatchObject({ statusCode: 404 });
    // Tài liệu của khách (đối tượng khác) cũng ngoài phạm vi NV3.
    await expect(documents.list(nv3, { entityType: 'customer', entityId: customerId })).rejects.toMatchObject({ statusCode: 404 });
    // Trong phạm vi: chủ, cấp trên (TN), quản lý (toàn bộ).
    for (const viewer of [nv1, tn, manager]) {
      expect((await documents.list(viewer, { entityType: 'opportunity', entityId: oppId })).length).toBeGreaterThan(0);
    }
  });

  it('TC-DOC-08 / ASG-02: người được gán giai đoạn thấy tài liệu của dự án đó, không thấy tài liệu của khách', async () => {
    const created = await opportunities.create(nv1, { customerId, name: 'Dự án giao NV3' });
    const doc = await documents.create(nv1, pdf({ entityId: created.id }));
    storage.put(doc.uploadUrl, 1000);
    await documents.completeUpload(nv1, doc.document.id, doc.version.id, { sizeBytes: 1000 });
    const customerDoc = await documents.create(nv1, pdf({ entityType: 'customer', entityId: customerId }));
    await expect(documents.get(nv3, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });

    const stage = (await query<{ id: string }>(`SELECT stage_id AS id FROM crm_schema.opportunity_stage_plan WHERE opportunity_id = $1 AND status = 'ACTIVE'`, [created.id]))[0].id;
    await opportunities.updateStageAssignee(nv1, created.id, stage, { assigneeUserId: NV3 });
    expect((await documents.get(nv3, doc.document.id)).id).toBe(doc.document.id);
    expect((await documents.download(nv3, doc.document.id)).versionNo).toBe(1);
    // Chỉ dự án được giao; khách và dự án khác của khách vẫn ngoài phạm vi.
    await expect(documents.get(nv3, customerDoc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(documents.list(nv3, { entityType: 'opportunity', entityId: oppId })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('phạm vi theo loại đối tượng: lead, khách, báo giá của cơ hội; mọi bảng đích truy vấn được', async () => {
    const lead = await new LeadService(new PostgresLeadStore(handle.database), new CrmDataScopeService({ snapshot: async () => ORGANIZATION })).create(nv1, { name: 'Lead tài liệu' });
    const leadDoc = await documents.create(nv1, pdf({ entityType: 'lead', entityId: lead.id }));
    await expect(documents.get(nv3, leadDoc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await documents.get(tn, leadDoc.document.id)).entityType).toBe('lead');

    const quote = (await query<{ id: string }>(
      `INSERT INTO crm_schema.quotes (code, opportunity_id, customer_id, owner_user_id) VALUES ('BG-DOC-1', $1, $2, $3) RETURNING id`,
      [oppId, customerId, NV1],
    ))[0].id;
    const quoteDoc = await documents.create(nv1, pdf({ entityType: 'quote', entityId: quote }));
    await expect(documents.get(nv3, quoteDoc.document.id)).rejects.toMatchObject({ statusCode: 404 });

    // Hợp đồng, đơn bán, bảo hành: SQL phạm vi hợp lệ (đối tượng không tồn tại thì 404).
    for (const entityType of ['contract', 'sales_order', 'warranty_case'] as const) {
      await expect(documents.list(manager, { entityType, entityId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    }
    await expect(documents.list(manager, { entityType: 'invoice' as never, entityId: oppId })).rejects.toMatchObject({ statusCode: 400 });
    // Id không phải UUID: pg ném 22P02 (runCrm của controller đổi thành 404).
    await expect(documents.list(manager, { entityType: 'customer', entityId: 'khong-phai-uuid' })).rejects.toMatchObject({ code: '22P02' });
  });

  it('TC-DOC-09: cách ly tenant: id tài liệu của tenant này ở tenant khác là 404, không có URL ký', async () => {
    const doc = await uploaded(nv1);
    const signedBefore = storage.signed.length;
    await expect(otherDocuments.get(manager, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(otherDocuments.download(manager, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(otherDocuments.remove(deleter, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(storage.signed.length).toBe(signedBefore);
    await expect(otherDocuments.list(manager, { entityType: 'opportunity', entityId: oppId })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-DOC-10: thư mục lồng tới độ sâu 5 thành công, cấp 6 lỗi tiếng Việt; tên trùng bị chặn; tài liệu vào thư mục', async () => {
    let parentId: string | null = null;
    const ids: string[] = [];
    for (let depth = 1; depth <= 5; depth += 1) {
      const folder: { id: string; depth: number } = await documents.createFolder(nv1, { entityType: 'opportunity', entityId: oppId, parentId, name: `Cấp ${depth}` });
      expect(folder.depth).toBe(depth);
      parentId = folder.id;
      ids.push(folder.id);
    }
    await expect(documents.createFolder(nv1, { entityType: 'opportunity', entityId: oppId, parentId, name: 'Cấp 6' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Thư mục chỉ lồng tối đa 5 cấp.',
    });
    await expect(documents.createFolder(nv1, { entityType: 'opportunity', entityId: oppId, parentId: null, name: 'cấp 1' })).rejects.toMatchObject({ statusCode: 409 });
    expect((await documents.listFolders(nv1, 'opportunity', oppId)).map((folder) => folder.depth)).toEqual([1, 2, 3, 4, 5]);
    // Thư mục của đối tượng khác không dùng được.
    await expect(documents.createFolder(nv1, { entityType: 'customer', entityId: customerId, parentId: ids[0], name: 'Lạc' })).rejects.toMatchObject({ statusCode: 404 });
    const inFolder = await documents.create(nv1, pdf({ folderId: ids[1] }));
    expect(inFolder.document.folderId).toBe(ids[1]);
    expect((await documents.list(nv1, { entityType: 'opportunity', entityId: oppId, folderId: ids[1] })).map((doc) => doc.id)).toEqual([inFolder.document.id]);
    await expect(documents.create(nv1, pdf({ folderId: randomUUID() }))).rejects.toMatchObject({ statusCode: 404 });
    // DB cũng giữ ràng buộc: không cho hai thư mục cùng tên (không phân biệt hoa thường) trong cùng cha.
    await expect(query(`INSERT INTO crm_schema.document_folders (entity_type, entity_id, parent_id, name, depth, created_by) VALUES ('opportunity', $1, NULL, 'CẤP 1', 1, $2)`, [oppId, NV1])).rejects.toMatchObject({ code: '23505' });
  });

  it('TC-DOC-12: loại tài liệu tắt: không chọn mới, tài liệu cũ vẫn xem và tải; chỉ crm.manage quản lý loại', async () => {
    const created = await types.create(manager, { code: 'sample_x', name: 'Loại thử X' });
    expect(created.code).toBe('SAMPLE_X');
    const old = await uploaded(nv1, { documentTypeId: created.id });
    expect((await types.update(manager, created.id, { active: false })).active).toBe(false);
    await expect(documents.create(nv1, pdf({ documentTypeId: created.id }))).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_INACTIVE' });
    await expect(documents.update(nv1, old.document.id, { documentTypeId: created.id })).resolves.toBeDefined(); // đổi về đúng loại cũ: không kiểm lại
    expect((await documents.get(nv1, old.document.id)).documentType).toMatchObject({ code: 'SAMPLE_X' });
    expect((await documents.download(nv1, old.document.id)).versionNo).toBe(1);
    expect((await types.list(nv1)).map((type) => type.code)).not.toContain('SAMPLE_X');
    expect((await types.list(manager, true)).map((type) => type.code)).toContain('SAMPLE_X');
    expect((await types.list(nv1, true)).map((type) => type.code)).not.toContain('SAMPLE_X');
    await expect(types.create(manager, { code: 'SAMPLE_X', name: 'Trùng' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(types.create(nv1, { code: 'NEW_ONE', name: 'Không quyền' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(types.update(tn, created.id, { name: 'Đổi' })).rejects.toMatchObject({ statusCode: 403 });
    await types.update(manager, created.id, { name: 'Loại thử X (đổi tên)', active: true });
    expect((await types.list(nv1)).find((type) => type.code === 'SAMPLE_X')?.name).toBe('Loại thử X (đổi tên)');
  });

  it('TC-DOC-13 / TC-DOC-18: nhật ký mỗi thao tác; xoá chỉ xoá bản ghi, object còn trên kho, khoá object ghi trong audit', async () => {
    const doc = await uploaded(nv1);
    const keyV1 = storage.signed.filter((entry) => entry.kind === 'upload').at(-1)!.key;
    const v2 = await documents.addVersion(nv1, doc.document.id, { fileName: 'v2.pdf', contentType: 'application/pdf', sizeBytes: 50, changeNote: 'Bản 2' });
    storage.put(v2.uploadUrl, 50);
    await documents.completeUpload(nv1, doc.document.id, v2.version.id, { sizeBytes: 50 });
    await documents.lock(nv1, doc.document.id);
    await documents.setAudience(nv1, doc.document.id, { audience: 'customer' });
    await documents.unlock(nv1, doc.document.id);

    await expect(documents.remove(nv1, doc.document.id)).rejects.toMatchObject({ statusCode: 403 });
    await documents.remove(deleter, doc.document.id);
    await expect(documents.get(manager, doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await query(`SELECT 1 FROM crm_schema.document_versions WHERE document_id = $1`, [doc.document.id])).toHaveLength(0);
    expect(storage.objects.has(keyV1)).toBe(true);

    expect(await auditActions(doc.document.id)).toEqual(['upload', 'upload-complete', 'version', 'upload-complete', 'lock', 'audience', 'unlock', 'delete']);
    const removed = (await query<{ actor_id: string; metadata: { orphanedObjectKeys: string[] } }>(
      `SELECT actor_id, metadata FROM crm_schema.audit_log WHERE entity_id = $1 AND action = 'delete'`,
      [doc.document.id],
    ))[0];
    expect(removed.actor_id).toBe(QL);
    expect(removed.metadata.orphanedObjectKeys).toHaveLength(2);
    expect(removed.metadata.orphanedObjectKeys).toContain(keyV1);
  });

  it('TC-DOC-13: audit cùng transaction: ghi tài liệu lỗi giữa chừng (FK) thì không còn dòng tài liệu, phiên bản hay nhật ký', async () => {
    const count = async (table: string) => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.${table}`))[0].n;
    const before = [await count('documents'), await count('document_versions'), await count('audit_log')];
    const id = randomUUID();
    await expect(
      docStore.createDocument(
        tenantId,
        NV1,
        {
          id, versionId: randomUUID(), entityType: 'opportunity', entityId: oppId, folderId: null, documentTypeId: randomUUID(),
          name: 'Lỗi', description: null, audience: 'internal', fileName: 'a.pdf', contentType: 'application/pdf',
          declaredSizeBytes: 1, changeNote: null, objectKey: `tenants/${tenantId}/crm/documents/opportunity/${id}/v1-a.pdf`,
        },
        { entityType: 'document', entityId: id, action: 'upload', actorId: NV1 },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect([await count('documents'), await count('document_versions'), await count('audit_log')]).toEqual(before);
  });

  it('TC-DOC-20: tên file có dấu, "/", tên rất dài: tên hiển thị giữ, object_key đã làm sạch, không chứa tên thô', async () => {
    const accent = await documents.create(nv1, pdf({ fileName: 'Hồ sơ pháp lý / Đà Nẵng.pdf' }));
    expect(accent.version.fileName).toBe('Hồ sơ pháp lý _ Đà Nẵng.pdf');
    const key = (await query<{ object_key: string }>(`SELECT object_key FROM crm_schema.document_versions WHERE id = $1`, [accent.version.id]))[0].object_key;
    expect(key).toMatch(/\/v1-Ho-so-phap-ly-_?-?Da-Nang\.pdf$|\/v1-Ho-so-phap-ly-_-Da-Nang\.pdf$/);
    expect(key).not.toMatch(/[^\x20-\x7e]/);
    expect(key.split('/')).toHaveLength(7);
    expect(key).toBe(storage.keyOf(accent.uploadUrl));

    const traversal = await documents.create(nv1, pdf({ fileName: '../../../etc/passwd.txt', contentType: 'text/plain' }));
    const traversalKey = (await query<{ object_key: string }>(`SELECT object_key FROM crm_schema.document_versions WHERE id = $1`, [traversal.version.id]))[0].object_key;
    expect(traversalKey.startsWith(`tenants/${tenantId}/crm/documents/opportunity/`)).toBe(true);
    expect(traversalKey).not.toContain('..' + '/');
    expect(traversalKey.split('/')).toHaveLength(7);

    await expect(documents.create(nv1, pdf({ fileName: `${'a'.repeat(300)}.pdf` }))).rejects.toMatchObject({ statusCode: 400, code: 'FILE_NAME_TOO_LONG' });
    const long = await documents.create(nv1, pdf({ fileName: `${'b'.repeat(250)}.pdf` }));
    const longKey = storage.keyOf(long.uploadUrl);
    expect(longKey.split('/').at(-1)!.length).toBeLessThanOrEqual(83);
    expect(longKey.endsWith('.pdf')).toBe(true);
    expect(new Set((await query<{ object_key: string }>(`SELECT object_key FROM crm_schema.document_versions`)).map((row) => row.object_key)).size).toBe(
      (await query(`SELECT 1 FROM crm_schema.document_versions`)).length,
    );
  });

  it('TC-P2PERM-01 (phần tài liệu): ma trận quyền: đọc thì xem; ghi cần crm.document.write; xoá cần crm.document.delete', async () => {
    const doc = await uploaded(nv1);
    // Người chỉ có crm.read trong phạm vi: xem và tải được, mọi thao tác ghi 403.
    expect((await documents.get(reader, doc.document.id)).id).toBe(doc.document.id);
    expect((await documents.download(reader, doc.document.id)).versionNo).toBe(1);
    await expect(documents.create(reader, pdf())).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.addVersion(reader, doc.document.id, { fileName: 'x.pdf', contentType: 'application/pdf', sizeBytes: 1, changeNote: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.lock(reader, doc.document.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.setAudience(reader, doc.document.id, { audience: 'customer' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.update(reader, doc.document.id, { name: 'Đổi' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.createFolder(reader, { entityType: 'opportunity', entityId: oppId, name: 'Mới' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.completeUpload(reader, doc.document.id, doc.version.id, { sizeBytes: 1 })).rejects.toMatchObject({ statusCode: 403 });
    // Có quyền ghi vẫn không xoá được; quản lý (crm.manage kéo theo ghi) cũng không xoá nếu chưa được cấp xoá.
    await expect(documents.remove(nv1, doc.document.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(documents.remove(manager, doc.document.id)).rejects.toMatchObject({ statusCode: 403 });
    // Người ngoài phạm vi có đủ quyền vẫn 404 (đã kiểm ở TC-DOC-08).
    await expect(documents.get(actorOf(NV3, { canDeleteDocument: true }), doc.document.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-PL-10 / TC-PL-20 / TC-DOC-19: điều kiện DOCUMENT_TYPE: bắt buộc thiếu thì 409 nêu tên loại; không bắt buộc chỉ là gợi ý', async () => {
    const pipelineId = (await query<{ id: string }>(`SELECT id FROM crm_schema.pipelines WHERE is_default`))[0].id;
    const stageId = (await query<{ id: string }>(`SELECT id FROM crm_schema.pipeline_stages WHERE pipeline_id = $1 AND code = 'DISCOVERY'`, [pipelineId]))[0].id;
    await query(
      `INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order) VALUES
         ($1, 'DOCUMENT_TYPE', 'LEGAL_DOSSIER', true, 'Cần có hồ sơ trước khi sang Khảo sát.', 1),
         ($1, 'DOCUMENT_TYPE', 'ESTIMATE', false, 'Nên có dự toán.', 2)`,
      [stageId],
    );
    config.invalidate();
    const created = await opportunities.create(nv1, { customerId, name: 'Dự án điều kiện tài liệu' });
    await opportunities.changeStage(nv1, created.id, { stage: 'CONTACTED' });

    // Bước 1: thiếu A (bắt buộc) -> 409 nêu tên loại; B không bắt buộc không có trong lý do chặn.
    const blocked = await opportunities.changeStage(nv1, created.id, { stage: 'DISCOVERY' }).catch((error) => error);
    expect(blocked).toMatchObject({ statusCode: 409 });
    expect(blocked.message).toContain('Hồ sơ pháp lý');
    expect(blocked.message).not.toContain('Nên có dự toán');
    const needs = await opportunities.stageRequirements(nv1, created.id, 'DISCOVERY');
    expect(needs.map((need) => [need.ref, need.required, need.met])).toEqual([['LEGAL_DOSSIER', true, false], ['ESTIMATE', false, false]]);

    // Tài liệu đã tạo nhưng chưa xác nhận tải lên: chưa tính còn hiệu lực. Loại khác (HSMT) không thay thế.
    const legalType = await typeId('LEGAL_DOSSIER');
    const pending = await documents.create(nv1, pdf({ entityId: created.id, documentTypeId: legalType }));
    await documents.create(nv1, pdf({ entityId: created.id, documentTypeId: await typeId('TENDER_DOSSIER') }));
    await expect(opportunities.changeStage(nv1, created.id, { stage: 'DISCOVERY' })).rejects.toMatchObject({ statusCode: 409 });

    // Bước 2: xác nhận tải lên A -> chuyển được dù thiếu B; B vẫn là gợi ý.
    storage.put(pending.uploadUrl, 1000);
    await documents.completeUpload(nv1, pending.document.id, pending.version.id, { sizeBytes: 1000 });
    const need = await opportunities.stageRequirements(nv1, created.id, 'DISCOVERY');
    expect(need.map((entry) => [entry.ref, entry.met])).toEqual([['LEGAL_DOSSIER', true], ['ESTIMATE', false]]);
    await expect(opportunities.changeStage(nv1, created.id, { stage: 'DISCOVERY' })).resolves.toMatchObject({ stage: 'DISCOVERY' });
    // Xoá tài liệu thì hết hiệu lực (kiểm ở cơ hội khác cùng cấu hình).
    const other2 = await opportunities.create(nv1, { customerId, name: 'Cơ hội khác' });
    await opportunities.changeStage(nv1, other2.id, { stage: 'CONTACTED' });
    await expect(opportunities.changeStage(nv1, other2.id, { stage: 'DISCOVERY' })).rejects.toMatchObject({ statusCode: 409 });
  });
});
