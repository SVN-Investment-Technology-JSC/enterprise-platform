import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Client, type Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

function migrationFile(): string {
  let candidate = process.cwd();
  while (!existsSync(join(candidate, 'nx.json'))) candidate = dirname(candidate);
  return resolve(candidate, 'migrations/tenant/inventory/0028-material-tracking-mode.sql');
}

type ModeRow = { code: string; tracking_mode: string; is_serialized: boolean };

/**
 * Migration 0027: cột `tracking_mode`, backfill từ dữ liệu thật (không suy từ nhóm), ràng buộc, trigger đồng bộ
 * `is_serialized`, tự bật công tắc cho tenant đã có dữ liệu.
 */
integration('Migration 0027 material tracking_mode', () => {
  let database: TestInventoryDatabase;
  let pool: Pool;
  const notices: string[] = [];

  /** Chạy file migration bằng kết nối riêng để bắt NOTICE (danh sách mặt hàng xung đột). */
  async function runMigrationWithNotices(): Promise<void> {
    const client = new Client({ connectionString: database.url });
    client.on('notice', (notice) => {
      if (notice?.message) notices.push(notice.message);
    });
    await client.connect();
    try {
      await client.query(await readFile(migrationFile(), 'utf8'));
    } finally {
      await client.end();
    }
  }

  async function modes(): Promise<Map<string, ModeRow>> {
    const { rows } = await pool.query<ModeRow>(
      `SELECT code, tracking_mode, is_serialized FROM inventory_schema.materials ORDER BY code`,
    );
    return new Map(rows.map((row) => [row.code, row]));
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string, {
      stopBefore: '0028-material-tracking-mode',
    });
    pool = database.pool;
    // Dữ liệu trước 0027: chưa có cột tracking_mode. Nhóm CONSUMABLE KHÔNG được thành theo lô.
    await pool.query(
      `INSERT INTO inventory_schema.materials (code, name, category, unit, is_serialized)
       VALUES ('TM-SER', 'Máy bơm', 'SPARE_PART', 'Cái', true),
              ('TM-LOT', 'Dầu', 'CONSUMABLE', 'Lít', false),
              ('TM-CON', 'Vít tiêu hao', 'CONSUMABLE', 'Cái', false),
              ('TM-BOTH', 'Máy có cả lô', 'SPARE_PART', 'Cái', true),
              ('TM-NONE', 'Phụ tùng thường', 'SPARE_PART', 'Cái', false)`,
    );
    // Dịch vụ cũ lọt is_serialized = true (đường cập nhật trước đây không ép).
    await pool.query(
      `INSERT INTO inventory_schema.materials (code, name, kind, unit, is_serialized)
       VALUES ('TM-SVC', 'Dịch vụ lắp đặt', 'SERVICE', 'Gói', true)`,
    );
    await pool.query(
      `INSERT INTO inventory_schema.lots (material_id, lot_no, created_by)
       SELECT id, 'L-001', $1 FROM inventory_schema.materials WHERE code IN ('TM-LOT', 'TM-BOTH')`,
      [randomUUID()],
    );
    await pool.query(
      `INSERT INTO inventory_schema.serial_tracking (material_id, serial_number, current_status, location_type)
       SELECT id, 'SN-1', 'OPERATING', 'WAREHOUSE' FROM inventory_schema.materials WHERE code = 'TM-SER'`,
    );
    await runMigrationWithNotices();
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('backfill: is_serialized thành SERIAL, đã có lô thành LOT, còn lại NONE; không suy từ nhóm', async () => {
    const result = await modes();
    expect(result.get('TM-SER')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
    expect(result.get('TM-LOT')).toMatchObject({ tracking_mode: 'LOT', is_serialized: false });
    // Nhóm CONSUMABLE nhưng chưa có lô nào: vẫn NONE.
    expect(result.get('TM-CON')).toMatchObject({ tracking_mode: 'NONE', is_serialized: false });
    expect(result.get('TM-NONE')).toMatchObject({ tracking_mode: 'NONE', is_serialized: false });
  });

  it('xung đột (vừa serial vừa có lô): lấy SERIAL và in danh sách mã ở NOTICE', async () => {
    expect((await modes()).get('TM-BOTH')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
    expect(notices.some((message) => message.includes('TM-BOTH') && !message.includes('TM-SER,'))).toBe(true);
    // Lô cũ vẫn đọc được.
    const lots = await pool.query(
      `SELECT 1 FROM inventory_schema.lots l JOIN inventory_schema.materials m ON m.id = l.material_id WHERE m.code = 'TM-BOTH'`,
    );
    expect(lots.rowCount).toBe(1);
  });

  it('dịch vụ cũ có is_serialized = true ở NONE, qua được ràng buộc', async () => {
    expect((await modes()).get('TM-SVC')?.tracking_mode).toBe('NONE');
  });

  it('tenant đã có dữ liệu thì tự bật công tắc tương ứng', async () => {
    const { rows } = await pool.query<{ key: string; value: { enabled: boolean } }>(
      `SELECT key, value FROM inventory_schema.module_settings WHERE key LIKE 'tracking.%' ORDER BY key`,
    );
    expect(rows).toEqual([
      { key: 'tracking.lot.enabled', value: { enabled: true } },
      { key: 'tracking.serial.enabled', value: { enabled: true } },
    ]);
  });

  it('ràng buộc: ba giá trị, dịch vụ chỉ NONE', async () => {
    await expect(
      pool.query(`UPDATE inventory_schema.materials SET tracking_mode = 'BOTH' WHERE code = 'TM-NONE'`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(`UPDATE inventory_schema.materials SET tracking_mode = 'LOT' WHERE code = 'TM-SVC'`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('trigger đồng bộ is_serialized với tracking_mode cho cả bản app cũ lẫn mới', async () => {
    // Bản cũ tạo mặt hàng chỉ với is_serialized = true.
    await pool.query(
      `INSERT INTO inventory_schema.materials (code, name, category, unit, is_serialized)
       VALUES ('TG-OLD', 'Tạo bởi bản cũ', 'SPARE_PART', 'Cái', true)`,
    );
    // Bản mới tạo với tracking_mode, không đụng is_serialized.
    await pool.query(
      `INSERT INTO inventory_schema.materials (code, name, category, unit, tracking_mode)
       VALUES ('TG-NEW', 'Tạo bởi bản mới', 'SPARE_PART', 'Cái', 'SERIAL'),
              ('TG-LOT', 'Theo lô', 'SPARE_PART', 'Cái', 'LOT')`,
    );
    let result = await modes();
    expect(result.get('TG-OLD')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
    expect(result.get('TG-NEW')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
    expect(result.get('TG-LOT')).toMatchObject({ tracking_mode: 'LOT', is_serialized: false });

    // Bản cũ bật cờ: NONE thành SERIAL. Tắt cờ: SERIAL về NONE. Tắt cờ trên LOT: giữ LOT.
    await pool.query(`UPDATE inventory_schema.materials SET is_serialized = true WHERE code = 'TM-NONE'`);
    await pool.query(`UPDATE inventory_schema.materials SET is_serialized = false WHERE code = 'TG-OLD'`);
    await pool.query(`UPDATE inventory_schema.materials SET is_serialized = false WHERE code = 'TG-LOT'`);
    result = await modes();
    expect(result.get('TM-NONE')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
    expect(result.get('TG-OLD')).toMatchObject({ tracking_mode: 'NONE', is_serialized: false });
    expect(result.get('TG-LOT')).toMatchObject({ tracking_mode: 'LOT', is_serialized: false });

    // Bản mới đổi tracking_mode: is_serialized đi theo.
    await pool.query(`UPDATE inventory_schema.materials SET tracking_mode = 'LOT' WHERE code = 'TM-NONE'`);
    await pool.query(`UPDATE inventory_schema.materials SET tracking_mode = 'SERIAL' WHERE code = 'TG-LOT'`);
    result = await modes();
    expect(result.get('TM-NONE')).toMatchObject({ tracking_mode: 'LOT', is_serialized: false });
    expect(result.get('TG-LOT')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
  });

  it('chạy lại được: không đổi dữ liệu và không lỗi', async () => {
    const before = [...(await modes()).values()];
    await runMigrationWithNotices();
    expect([...(await modes()).values()]).toEqual(before);
    const history = await pool.query(`SELECT 1 FROM inventory_schema.material_tracking_history`);
    expect(history.rowCount).toBe(0);
  });
});

/** Đường ghi qua InventoryApplication và store thật: công tắc, đổi cách theo dõi, lịch sử, chặn tắt công tắc. */
integration('Cách theo dõi của mặt hàng qua InventoryApplication (DB thật)', () => {
  const tenantId = randomUUID();
  const admin: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
  };
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;

  const base = { category: 'SPARE_PART', unit: 'Cái' } as const;

  async function row(code: string): Promise<ModeRow> {
    const { rows } = await pool.query<ModeRow>(
      `SELECT code, tracking_mode, is_serialized FROM inventory_schema.materials WHERE code = $1`,
      [code],
    );
    return rows[0];
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    app = new InventoryApplication(
      new PostgresInventoryStore(database.references, database.pools),
      new PostgresStockDocumentStore(database.references, database.pools),
    );
    await app.createWarehouse(admin, { code: 'TK-KHO', name: 'Kho theo dõi' });
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('công tắc tắt (mặc định): chọn LOT hoặc SERIAL bị từ chối; NONE và đường cũ isSerialized vẫn được', async () => {
    await expect(app.createMaterial(admin, { ...base, code: 'TK-A', name: 'A', trackingMode: 'LOT' })).rejects.toThrow(
      'Tenant chưa bật quản lý theo lô.',
    );
    await app.createMaterial(admin, { ...base, code: 'TK-B', name: 'B', trackingMode: 'NONE' });
    await app.createMaterial(admin, { ...base, code: 'TK-C', name: 'C', isSerialized: true });
    expect(await row('TK-A')).toBeUndefined();
    expect(await row('TK-B')).toMatchObject({ tracking_mode: 'NONE', is_serialized: false });
    expect(await row('TK-C')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
  });

  it('bật công tắc rồi tạo theo lô: lưu LOT; nhóm tiêu hao không tự thành theo lô', async () => {
    await app.updateSetting(admin, 'tracking.lot.enabled', { value: { enabled: true } });
    await app.createMaterial(admin, { ...base, code: 'TK-LOT', name: 'Dầu', trackingMode: 'LOT' });
    await app.createMaterial(admin, { ...base, code: 'TK-CON', name: 'Vít', category: 'CONSUMABLE' });
    expect(await row('TK-LOT')).toMatchObject({ tracking_mode: 'LOT', is_serialized: false });
    expect(await row('TK-CON')).toMatchObject({ tracking_mode: 'NONE', is_serialized: false });
    const read = await app.getMaterial(admin, 'TK-LOT');
    expect(read.trackingMode).toBe('LOT');
  });

  it('đổi cách theo dõi khi chưa có dấu vết: được, ghi lịch sử kèm người đổi và lý do', async () => {
    const updated = await app.updateMaterial(admin, 'TK-LOT', { trackingMode: 'NONE', trackingChangeReason: 'Khai nhầm' });
    expect(updated.trackingMode).toBe('NONE');
    expect(await row('TK-LOT')).toMatchObject({ tracking_mode: 'NONE', is_serialized: false });
    const history = await pool.query(
      `SELECT h.from_mode, h.to_mode, h.reason, h.changed_by::text AS changed_by
         FROM inventory_schema.material_tracking_history h
         JOIN inventory_schema.materials m ON m.id = h.material_id
        WHERE m.code = 'TK-LOT'`,
    );
    expect(history.rows).toEqual([
      { from_mode: 'LOT', to_mode: 'NONE', reason: 'Khai nhầm', changed_by: admin.userId },
    ]);
  });

  it('đổi lại thành LOT ghi thêm dòng lịch sử thứ hai', async () => {
    await app.updateMaterial(admin, 'TK-LOT', { trackingMode: 'LOT' });
    const { rows } = await pool.query(
      `SELECT h.from_mode, h.to_mode FROM inventory_schema.material_tracking_history h
         JOIN inventory_schema.materials m ON m.id = h.material_id
        WHERE m.code = 'TK-LOT' ORDER BY h.changed_at, h.to_mode`,
    );
    expect(rows).toHaveLength(2);
  });

  it('đã có tồn: không đổi được cách theo dõi', async () => {
    await app.receiveStock(admin, { warehouseCode: 'TK-KHO', materialCode: 'TK-LOT', quantity: 4 });
    await expect(app.updateMaterial(admin, 'TK-LOT', { trackingMode: 'NONE' })).rejects.toThrow(
      'Mã TK-LOT đã có tồn, bút toán, chứng từ, giữ hàng, lô hoặc serial; không đổi được cách theo dõi.',
    );
    expect((await row('TK-LOT')).tracking_mode).toBe('LOT');
  });

  it('chỉ có lô, chưa có tồn hay bút toán: vẫn không đổi được (dấu vết lô)', async () => {
    await app.createMaterial(admin, { ...base, code: 'TK-ONLYLOT', name: 'Chỉ có lô', trackingMode: 'LOT' });
    await pool.query(
      `INSERT INTO inventory_schema.lots (material_id, lot_no, created_by)
       SELECT id, 'L-9', $1 FROM inventory_schema.materials WHERE code = 'TK-ONLYLOT'`,
      [admin.userId],
    );
    await expect(app.updateMaterial(admin, 'TK-ONLYLOT', { trackingMode: 'NONE' })).rejects.toThrow(
      'không đổi được cách theo dõi',
    );
  });

  it('không tắt được công tắc lô khi còn mặt hàng theo lô có tồn; tắt được khi hết', async () => {
    await expect(
      app.updateSetting(admin, 'tracking.lot.enabled', { value: { enabled: false } }),
    ).rejects.toThrow('Còn 1 mặt hàng đang theo dõi theo lô và có tồn; chưa tắt được.');
    // Xuất hết hàng thì tắt được.
    await app.issueStock(admin, { warehouseCode: 'TK-KHO', materialCode: 'TK-LOT', quantity: 4 });
    const saved = await app.updateSetting(admin, 'tracking.lot.enabled', { value: { enabled: false } });
    expect(saved.value).toEqual({ enabled: false });
  });

  it('khai serial cho mặt hàng đang theo lô thì từ chối', async () => {
    await expect(
      app.registerSerials(admin, { materialCode: 'TK-LOT', serialNumbers: ['SN-1'] }),
    ).rejects.toThrow('đang theo dõi theo lô nên không khai serial');
  });

  it('khai serial cho mặt hàng thường: thành SERIAL, is_serialized true (đường cũ vẫn chạy)', async () => {
    await app.registerSerials(admin, { materialCode: 'TK-B', serialNumbers: ['SN-B1'] });
    expect(await row('TK-B')).toMatchObject({ tracking_mode: 'SERIAL', is_serialized: true });
  });
});
