import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FulfilRequisitionRequest } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import type { ProcedureInstanceReader } from './application/procedure-instance-reader.port.js';
import { RequisitionFulfilmentService } from './application/requisition-fulfilment.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresTraceabilityStore } from './infrastructure/postgres-traceability.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase, purchaseSource } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

integration('Cấp vật tư theo yêu cầu Quy trình trên PostgreSQL (ISS-BE-031)', () => {
  const tenantId = randomUUID();
  const warehouse = 'YC-KHO';
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let service: RequisitionFulfilmentService;
  let sequence = 0;
  /** Hồ sơ Quy trình giả: mã yêu cầu → id hồ sơ đã hoàn thành. */
  const instances = new Map<string, string>();

  const admin: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
    canApproveDocuments: true,
  };
  /** Thủ kho: chỉ có quyền ghi phát sinh. */
  const keeper: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Thủ kho',
    canManage: false,
    canWriteTransactions: true,
  };

  const procedures: ProcedureInstanceReader = {
    async instanceState(_tenant, instanceId) {
      const code = [...instances.entries()].find(([, id]) => id === instanceId)?.[0];
      return code ? { instanceId, instanceCode: code, status: 'completed' } : null;
    },
  };

  function order(): { code: string; instanceId: string } {
    sequence += 1;
    const code = `PR-TEST-${sequence}`;
    const instanceId = randomUUID();
    instances.set(code, instanceId);
    return { code, instanceId };
  }

  async function material(prefix: string, quantity: number, serials?: string[]): Promise<string> {
    sequence += 1;
    const code = `${prefix}-${sequence}`;
    await app.createMaterial(admin, {
      code,
      name: `Vật tư ${code}`,
      category: serials ? 'SPARE_PART' : 'CONSUMABLE',
      unit: 'Cái',
      isSerialized: Boolean(serials),
    });
    await app.receiveStock(admin, {
      ...purchaseSource(),
      warehouseCode: warehouse,
      materialCode: code,
      quantity,
      unitCost: 100,
      ...(serials ? { serials } : {}),
    });
    return code;
  }

  async function onHand(materialCode: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT b.quantity FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2 AND b.location_id IS NULL`,
      [warehouse, materialCode],
    );
    return Number((rows[0] as { quantity?: string } | undefined)?.quantity ?? 0);
  }

  async function documentsOf(orderCode: string) {
    const { rows } = await pool.query(
      `SELECT d.code, d.doc_type, d.status, d.source_type, d.source_id, d.idempotency_key,
              (SELECT count(*)::int FROM inventory_schema.stock_document_lines l WHERE l.document_id = d.id) AS lines
         FROM inventory_schema.stock_documents d
        WHERE d.idempotency_key = $1 OR d.idempotency_key LIKE $2
        ORDER BY d.idempotency_key`,
      [`procedure-requisition:${orderCode}`, `procedure-requisition:${orderCode}:%`],
    );
    return rows as {
      code: string;
      doc_type: string;
      status: string;
      source_type: string;
      source_id: string;
      idempotency_key: string;
      lines: number;
    }[];
  }

  async function rejection(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string; message: string };
    }
    throw new Error('expected rejection');
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    const traceability = new PostgresTraceabilityStore(database.references, database.pools);
    app = new InventoryApplication(store, documentStore, traceability);
    service = new RequisitionFulfilmentService(documentStore, store, app, procedures);
    await app.createWarehouse(admin, { code: warehouse, name: 'Kho cấp vật tư' });
    await app.createAsset(admin, { code: 'YC-TB-01', name: 'Máy bơm thử', type: 'Thiết bị' });
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('hai lần cấp song song cùng mã: đúng một chứng từ, tồn trừ một lần', async () => {
    const a = await material('YC-A', 10);
    const b = await material('YC-B', 10);
    const { code, instanceId } = order();
    const body: FulfilRequisitionRequest = {
      instanceId,
      warehouseCode: warehouse,
      lines: [
        { materialCode: a, quantity: 2 },
        { materialCode: b, quantity: 3 },
      ],
    };

    const results = await Promise.all([
      service.fulfil(keeper, code, body),
      service.fulfil(keeper, code, body),
      service.fulfil(keeper, code, body),
    ]);

    const docs = await documentsOf(code);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      doc_type: 'ISSUE_PROJECT',
      status: 'POSTED',
      source_type: 'procedure_instance',
      source_id: instanceId,
      lines: 2,
    });
    expect(new Set(results.map((result) => result.documentCode))).toEqual(new Set([docs[0].code]));
    expect(await onHand(a)).toBe(8);
    expect(await onHand(b)).toBe(7);

    // Gọi lại tuần tự: trả chứng từ cũ; khác nội dung: 409.
    await expect(service.fulfil(keeper, code, body)).resolves.toMatchObject({ replayed: true, documentCode: docs[0].code });
    const conflict = await rejection(
      service.fulfil(keeper, code, { ...body, lines: [{ materialCode: a, quantity: 5 }] }),
    );
    expect([conflict.statusCode, conflict.code]).toEqual([409, 'IDEMPOTENCY_KEY_CONFLICT']);
    expect(await documentsOf(code)).toHaveLength(1);
    expect(await onHand(a)).toBe(8);

    const status = await service.status(keeper, [code, 'PR-CHUA-CO']);
    expect(status.items).toEqual([
      { orderCode: code, status: 'FULFILLED', documentCode: docs[0].code, documentCodes: [docs[0].code] },
      { orderCode: 'PR-CHUA-CO', status: 'OPEN', documentCodes: [] },
    ]);
  });

  it('một dòng thiếu tồn: 400, không dòng nào được ghi', async () => {
    const a = await material('YC-C', 10);
    const b = await material('YC-D', 1);
    const { code, instanceId } = order();
    const failure = await rejection(
      service.fulfil(keeper, code, {
        instanceId,
        warehouseCode: warehouse,
        lines: [
          { materialCode: a, quantity: 2 },
          { materialCode: b, quantity: 5 },
        ],
      }),
    );
    expect([failure.statusCode, failure.code]).toEqual([400, 'INSUFFICIENT_STOCK']);
    expect(await documentsOf(code)).toHaveLength(0);
    expect(await onHand(a)).toBe(10);
    expect(await onHand(b)).toBe(1);
  });

  it('hàng theo serial: thiếu serial bị chặn; đủ serial thì serial chuyển Đã xuất', async () => {
    const serial = await material('YC-SR', 2, ['YC-S1', 'YC-S2']);
    const { code, instanceId } = order();
    const body = { instanceId, warehouseCode: warehouse, lines: [{ materialCode: serial, quantity: 1 }] };
    const missing = await rejection(service.fulfil(keeper, code, body));
    expect([missing.statusCode, missing.code]).toEqual([400, 'SERIALS_REQUIRED']);

    await service.fulfil(keeper, code, { ...body, lines: [{ materialCode: serial, quantity: 1, serials: ['YC-S2'] }] });
    const { rows } = await pool.query(
      `SELECT stock_state FROM inventory_schema.serial_tracking WHERE serial_number = 'YC-S2'`,
    );
    expect((rows[0] as { stock_state: string }).stock_state).toBe('ISSUED');
    expect(await onHand(serial)).toBe(1);
  });

  it('lắp vào thiết bị: thủ kho lắp từng dòng cùng tiền tố khoá; song song vẫn không lắp hai lần', async () => {
    const a = await material('YC-E', 5);
    const b = await material('YC-F', 5);
    const { code, instanceId } = order();
    const body: FulfilRequisitionRequest = {
      instanceId,
      warehouseCode: warehouse,
      assetCode: 'YC-TB-01',
      lines: [
        { materialCode: a, quantity: 1 },
        { materialCode: b, quantity: 2 },
      ],
    };

    const results = await Promise.allSettled([service.fulfil(keeper, code, body), service.fulfil(keeper, code, body)]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    // Bên thua (nếu có) gọi lại là cấp nốt hoặc nhận chứng từ cũ.
    await service.fulfil(keeper, code, body);

    const docs = await documentsOf(code);
    expect(docs.map((doc) => doc.idempotency_key)).toEqual([
      `procedure-requisition:${code}:install:1/2`,
      `procedure-requisition:${code}:install:2/2`,
    ]);
    expect(docs.every((doc) => doc.status === 'POSTED' && doc.source_type === 'asset')).toBe(true);
    expect(await onHand(a)).toBe(4);
    expect(await onHand(b)).toBe(3);
    // Đơn vị lắp thừa của bên thua đã được dọn: mỗi vật tư đúng một đơn vị đang lắp.
    const installed = (await app.listInstalled(admin)).filter((line) => line.materialCode === a || line.materialCode === b);
    expect(installed).toHaveLength(2);
    expect((await service.status(keeper, [code])).items[0]).toMatchObject({ status: 'FULFILLED' });
  });
});
