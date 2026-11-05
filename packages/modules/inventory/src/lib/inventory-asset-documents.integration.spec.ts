import { randomUUID } from 'node:crypto';
import type { ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import type { Pool } from 'pg';
import { AssetDocumentService } from './application/asset-document.service.js';
import type { InventoryActor } from './application/inventory.application.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

integration('Tài liệu thiết bị cho dịch vụ khác đọc (TC-DOC-15) trên PostgreSQL', () => {
  const tenantId = randomUUID();
  const actor = { tenantId, userId: randomUUID(), displayName: 'Hệ thống', canManage: false } as InventoryActor;
  let database: TestInventoryDatabase;
  let pool: Pool;
  let service: AssetDocumentService;
  const storage: ObjectStoragePort = {
    createUploadUrl: async () => 'u',
    createDownloadUrl: async (key, ttl) => `https://s3.local/${key}?ttl=${ttl}`,
    putObject: async () => undefined,
  };

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    service = new AssetDocumentService(database.references, database.pools, storage);
  });
  afterAll(async () => database?.drop());

  async function asset(code: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO inventory_schema.materials (id, code, name, kind, status) VALUES ($1, $2, $3, 'ASSET', 'ACTIVE')`,
      [id, code, `Thiết bị ${code}`],
    );
    return id;
  }
  async function attach(assetId: string, fileName: string) {
    await pool.query(
      `INSERT INTO inventory_schema.asset_documents (id, asset_id, object_key, file_name, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, 'application/pdf', 42, $5)`,
      [randomUUID(), assetId, `tenants/${tenantId}/${randomUUID()}-${fileName}`, fileName, randomUUID()],
    );
  }

  it('trả siêu dữ liệu và URL tải ký 300 giây, không lộ object_key; chỉ của thiết bị được hỏi', async () => {
    const a = await asset('TB-DOC-1');
    const b = await asset('TB-DOC-2');
    await attach(a, 'huong-dan.pdf');
    await attach(b, 'khac.pdf');
    const result = await service.listForService(actor, a);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fileName: 'huong-dan.pdf', contentType: 'application/pdf', sizeBytes: 42, note: null, expiresInSeconds: 300 });
    expect(result[0].downloadUrl).toContain('ttl=300');
    expect(Object.keys(result[0])).not.toContain('objectKey');
    expect(Object.keys(result[0])).not.toContain('object_key');
  });

  it('id lạ, không phải UUID hoặc thiết bị chưa có tài liệu thì trả []', async () => {
    expect(await service.listForService(actor, randomUUID())).toEqual([]);
    expect(await service.listForService(actor, 'khong-phai-uuid')).toEqual([]);
    expect(await service.listForService(actor, await asset('TB-DOC-3'))).toEqual([]);
  });
});
