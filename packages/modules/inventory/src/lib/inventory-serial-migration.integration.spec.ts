import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;
const run = promisify(execFile);

function script(): string {
  let candidate = process.cwd();
  while (!existsSync(join(candidate, 'nx.json'))) candidate = dirname(candidate);
  return resolve(candidate, 'tools/inventory/find-duplicate-serials.mjs');
}

/**
 * TC-MIG-03: bản sao có serial trùng. Script T1-12 liệt kê đúng các cặp trùng,
 * migration 0013 dừng với thông báo rõ, xử lý xong thì chạy được.
 */
integration('Migration 0013 khi còn serial trùng (TC-MIG-03, T1-12)', () => {
  let database: TestInventoryDatabase;
  let pool: Pool;

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string, {
      stopBefore: '0013-serial-quality',
    });
    pool = database.pool;
    // Dữ liệu cũ trước 0013: chưa có unique, nên trùng được, kể cả khác hoa thường và khoảng trắng.
    const { rows } = await pool.query(
      `INSERT INTO inventory_schema.materials (code, name, category, unit, is_serialized)
       VALUES ('QA-KHO-LAP', 'Laptop', 'SPARE_PART', 'Cái', true),
              ('QA-KHO-MAY', 'Máy đo', 'SPARE_PART', 'Cái', true)
       RETURNING id, code`,
    );
    const id = (code: string) => (rows as { id: string; code: string }[]).find((row) => row.code === code)?.id;
    await pool.query(
      `INSERT INTO inventory_schema.serial_tracking (material_id, serial_number, current_status, location_type)
       VALUES ($1, 'SN001', 'OPERATING', 'WAREHOUSE'),
              ($1, ' sn001', 'OPERATING', 'WAREHOUSE'),
              ($1, 'SN002', 'OPERATING', 'WAREHOUSE'),
              ($1, 'SN002', 'OPERATING', 'WAREHOUSE'),
              ($1, 'SN003', 'OPERATING', 'WAREHOUSE'),
              -- Cùng số serial ở mặt hàng khác không phải trùng.
              ($2, 'SN001', 'OPERATING', 'WAREHOUSE')`,
      [id('QA-KHO-LAP'), id('QA-KHO-MAY')],
    );
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  async function duplicates(): Promise<{ stdout: string; stderr: string }> {
    return run(process.execPath, [script(), `--database-url=${database.url}`]);
  }

  it('script liệt kê đúng 2 cặp, chỉ đọc; migration dừng với thông báo; xử lý xong thì chạy được', async () => {
    const before = await duplicates();
    const lines = before.stdout.trim().split('\n');
    expect(lines[0]).toBe(
      'group_no,group_size,material_id,material_code,material_name,normalized_serial,serial_id,serial_number,internal_code,current_status,location_type,warehouse_code,current_asset_id,created_at',
    );
    const rows = lines.slice(1).map((line) => line.split(','));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row[0]))).toEqual(new Set(['1', '2']));
    expect(rows.map((row) => [row[3], row[5]])).toEqual([
      ['QA-KHO-LAP', 'SN001'],
      ['QA-KHO-LAP', 'SN001'],
      ['QA-KHO-LAP', 'SN002'],
      ['QA-KHO-LAP', 'SN002'],
    ]);
    // Serial có khoảng trắng đầu được bọc nháy để thủ kho thấy đúng giá trị đang lưu.
    expect(rows.map((row) => row[7])).toContain('" sn001"');
    expect(before.stderr).toContain('Có 2 nhóm serial trùng (4 bản ghi)');

    const [migration] = database.pendingMigrations;
    expect(migration).toBe('tenant/inventory/0013-serial-quality.sql');
    await expect(database.runMigration(migration)).rejects.toMatchObject({
      message:
        'Không chạy được migration 0013-serial-quality: còn 2 nhóm serial trùng trong cùng một mặt hàng (4 bản ghi).',
      hint: expect.stringContaining('node tools/inventory/find-duplicate-serials.mjs'),
    });
    // Migration lỗi không để lại gì: chưa có cột mới.
    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'inventory_schema' AND table_name = 'serial_tracking' AND column_name = 'quality_status'`,
    );
    expect(column.rowCount).toBe(0);

    // Thủ kho xử lý: xoá bản khai nhầm, sửa bản còn lại cho đúng số serial thật.
    await pool.query(`DELETE FROM inventory_schema.serial_tracking WHERE serial_number = ' sn001'`);
    await pool.query(
      `UPDATE inventory_schema.serial_tracking SET serial_number = 'SN004'
        WHERE id = (SELECT id FROM inventory_schema.serial_tracking WHERE serial_number = 'SN002' ORDER BY id LIMIT 1)`,
    );
    const after = await duplicates();
    expect(after.stdout.trim().split('\n')).toHaveLength(1);
    expect(after.stderr).toContain('Không có serial trùng');

    for (const path of database.pendingMigrations) await database.runMigration(path);
    // Chạy lại được.
    await database.runMigration(migration);
    await expect(
      pool.query(
        `INSERT INTO inventory_schema.serial_tracking (material_id, serial_number, current_status, location_type)
         SELECT material_id, ' sn003 ', 'OPERATING', 'WAREHOUSE' FROM inventory_schema.serial_tracking
          WHERE serial_number = 'SN003'`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  }, 60_000);
});
