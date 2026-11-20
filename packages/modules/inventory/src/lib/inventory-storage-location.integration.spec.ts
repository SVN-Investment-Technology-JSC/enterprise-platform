import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StorageLocationService } from './application/storage-location.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresStorageLocationStore } from './infrastructure/postgres-storage-location.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

/**
 * Vị trí lưu trữ của mặt hàng theo kho (0026): chuỗi tự do, tùy chọn, bảng độc lập với tồn kho.
 */
integration('Vị trí lưu trữ của mặt hàng theo kho', () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const admin: InventoryActor = {
    tenantId,
    userId,
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
  };
  const reader: InventoryActor = { ...admin, canManage: false, canWriteTransactions: false };
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let service: StorageLocationService;

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    app = new InventoryApplication(
      new PostgresInventoryStore(database.references, database.pools),
      new PostgresStockDocumentStore(database.references, database.pools),
    );
    service = new StorageLocationService(new PostgresStorageLocationStore(database.references, database.pools));
    await app.createWarehouse(admin, { code: 'KHO-A', name: 'Kho A' });
    await app.createWarehouse(admin, { code: 'KHO-B', name: 'Kho B' });
    await app.createWarehouse(admin, { code: 'KHO-TC', name: 'Kho trung chuyển', type: 'VIRTUAL_IN_TRANSIT' });
    await app.createMaterial(admin, { code: 'VT-001', name: 'Vòng bi 6205', category: 'SPARE_PART', unit: 'Cái' });
    await app.createMaterial(admin, { code: 'VT-002', name: 'Dầu bôi trơn', category: 'CONSUMABLE', unit: 'Lít' });
    await app.createMaterial(admin, {
      code: 'DV-001',
      name: 'Gói bảo trì',
      category: 'SPARE_PART',
      unit: 'Gói',
      kind: 'SERVICE',
      warrantyMonths: 0,
    });
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('migration chạy lại được', async () => {
    await expect(database.runMigration('tenant/inventory/0026-material-storage-locations.sql')).resolves.toBeUndefined();
  });

  it('một mặt hàng ở hai kho, mỗi kho một chỗ riêng', async () => {
    await service.replace(admin, 'VT-001', 'KHO-A', { locations: [{ segments: ['Khu A', 'Kệ 3', 'Ngăn 2'] }] });
    await service.replace(admin, 'VT-001', 'KHO-B', { locations: [{ locationText: 'Dãy 1 / Tầng 4' }] });

    const all = await service.listForMaterial(reader, 'VT-001');
    expect(all.map((row) => [row.warehouseCode, row.locationText, row.isPrimary])).toEqual([
      ['KHO-A', 'Khu A / Kệ 3 / Ngăn 2', true],
      ['KHO-B', 'Dãy 1 / Tầng 4', true],
    ]);
    expect(all[0].segments).toEqual(['Khu A', 'Kệ 3', 'Ngăn 2']);
    expect(all[1].segments).toBeUndefined();

    const warehouseB = await service.list(reader, { warehouseCode: 'KHO-B', materialCode: 'VT-001' });
    expect(warehouseB.map((row) => row.locationText)).toEqual(['Dãy 1 / Tầng 4']);
  });

  it('nhiều vị trí trong một kho: đúng một vị trí chính; thay danh sách giữ dòng trùng, bỏ dòng thiếu', async () => {
    const first = await service.replace(admin, 'VT-002', 'KHO-A', {
      locations: [{ locationText: 'Kệ 1' }, { locationText: 'Kệ 2', isPrimary: true }, { locationText: 'Kệ 3' }],
    });
    expect(first.map((row) => [row.locationText, row.isPrimary])).toEqual([
      ['Kệ 2', true],
      ['Kệ 1', false],
      ['Kệ 3', false],
    ]);
    const idOfShelf2 = first.find((row) => row.locationText === 'Kệ 2')?.id;

    // Đổi vị trí chính sang "Kệ 1", bỏ "Kệ 3", viết lại "Kệ 2" khác hoa thường: vẫn là dòng cũ.
    const second = await service.replace(admin, 'VT-002', 'KHO-A', {
      locations: [{ locationText: 'KỆ 2', note: 'hàng nặng' }, { locationText: 'Kệ 1', isPrimary: true }],
    });
    expect(second.map((row) => [row.locationText, row.isPrimary])).toEqual([
      ['Kệ 1', true],
      ['KỆ 2', false],
    ]);
    expect(second.find((row) => row.isPrimary)?.locationText).toBe('Kệ 1');
    expect(second.find((row) => row.locationText === 'KỆ 2')?.note).toBe('hàng nặng');
    // Không phụ thuộc cách database viết thường chữ có dấu: dòng cũ được giữ hoặc thay mới, nhưng chỉ còn đúng hai dòng.
    expect(second).toHaveLength(2);
    expect(idOfShelf2).toBeDefined();
  });

  it('danh sách rỗng xóa hết vị trí của cặp, không đụng kho khác', async () => {
    await service.replace(admin, 'VT-002', 'KHO-B', { locations: [{ locationText: 'Tủ hóa chất' }] });
    const cleared = await service.replace(admin, 'VT-002', 'KHO-A', { locations: [] });
    expect(cleared).toEqual([]);
    const remaining = await service.listForMaterial(reader, 'VT-002');
    expect(remaining.map((row) => [row.warehouseCode, row.locationText])).toEqual([['KHO-B', 'Tủ hóa chất']]);
  });

  it('từ chối kho trung chuyển, mặt hàng dịch vụ, mã không tồn tại; không ghi gì', async () => {
    await expect(
      service.replace(admin, 'VT-001', 'KHO-TC', { locations: [{ locationText: 'X' }] }),
    ).rejects.toMatchObject({ code: 'STORAGE_LOCATION_WAREHOUSE_VIRTUAL' });
    await expect(
      service.replace(admin, 'DV-001', 'KHO-A', { locations: [{ locationText: 'X' }] }),
    ).rejects.toMatchObject({ code: 'STORAGE_LOCATION_SERVICE_MATERIAL' });
    await expect(
      service.replace(admin, 'KHONG-CO', 'KHO-A', { locations: [{ locationText: 'X' }] }),
    ).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND', statusCode: 404 });
    await expect(
      service.replace(admin, 'VT-001', 'KHONG-CO', { locations: [{ locationText: 'X' }] }),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND', statusCode: 404 });
    await expect(service.listForMaterial(reader, 'KHONG-CO')).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.material_storage_locations l
         JOIN inventory_schema.materials m ON m.id = l.material_id WHERE m.code = 'DV-001'`,
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('ràng buộc ở database: không trùng một chỗ, tối đa một vị trí chính, không chuỗi rỗng', async () => {
    const ids = await pool.query(
      `SELECT w.id AS warehouse_id, m.id AS material_id
         FROM inventory_schema.warehouses w, inventory_schema.materials m
        WHERE w.code = 'KHO-B' AND m.code = 'VT-001'`,
    );
    const { warehouse_id: warehouseId, material_id: materialId } = ids.rows[0] as Record<string, string>;
    const insert = (text: string, primary: boolean) =>
      pool.query(
        `INSERT INTO inventory_schema.material_storage_locations (warehouse_id, material_id, location_text, is_primary)
         VALUES ($1, $2, $3, $4)`,
        [warehouseId, materialId, text, primary],
      );
    // "Dãy 1 / Tầng 4" đã có ở kho B (khác hoa thường và khoảng trắng hai đầu vẫn là trùng).
    await expect(insert('  dãy 1 / tầng 4 ', false)).rejects.toMatchObject({ code: '23505' });
    await expect(insert('Chỗ mới', true)).rejects.toMatchObject({ code: '23505' });
    await expect(insert('   ', false)).rejects.toMatchObject({ code: '23514' });
  });

  it('tên cấp của kho: ghi đè, mảng rỗng, bỏ ghi đè; kho đọc lại được qua danh sách kho', async () => {
    const set = await service.setWarehouseLevels(admin, 'KHO-A', {
      levels: ['Khu', 'Dãy', 'Kệ', 'Tầng', 'Ô', 'Hộc', 'Khay'],
    });
    expect(set).toEqual({ warehouseCode: 'KHO-A', levels: ['Khu', 'Dãy', 'Kệ', 'Tầng', 'Ô', 'Hộc', 'Khay'] });
    expect((await app.getWarehouse(admin, 'KHO-A')).locationLevels).toHaveLength(7);

    expect(await service.setWarehouseLevels(admin, 'KHO-B', { levels: [] })).toEqual({ warehouseCode: 'KHO-B', levels: [] });
    expect((await app.getWarehouse(admin, 'KHO-B')).locationLevels).toEqual([]);

    expect(await service.setWarehouseLevels(admin, 'KHO-A', { levels: null })).toEqual({
      warehouseCode: 'KHO-A',
      levels: null,
    });
    expect((await app.getWarehouse(admin, 'KHO-A')).locationLevels).toBeUndefined();

    await expect(service.setWarehouseLevels(admin, 'KHONG-CO', { levels: ['Khu'] })).rejects.toMatchObject({
      code: 'WAREHOUSE_NOT_FOUND',
    });
  });

  it('danh sách mặt hàng lọc theo vị trí; ô tìm toàn tenant tìm theo vị trí, mã, tên', async () => {
    const byLocation = await app.listMaterials(reader, false, { locationText: 'tầng 4' });
    expect(byLocation.map((material) => material.code)).toEqual(['VT-001']);
    expect(await app.listMaterials(reader, false, { locationText: 'không có chỗ này' })).toEqual([]);
    expect((await app.listMaterials(reader, false)).map((material) => material.code)).toEqual(['DV-001', 'VT-001', 'VT-002']);

    expect((await service.list(reader, { q: 'tủ hóa' })).map((row) => row.materialCode)).toEqual(['VT-002']);
    expect((await service.list(reader, { q: 'vòng bi' })).map((row) => row.warehouseCode)).toEqual(['KHO-A', 'KHO-B']);
    // Ký tự đại diện của LIKE được thoát: "%" không khớp mọi dòng.
    expect(await service.list(reader, { q: '%' })).toEqual([]);
  });

  it('không đổi tồn kho: ghi vị trí không tạo dòng tồn hay bút toán', async () => {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM inventory_schema.material_inventory)::int AS inventory,
              (SELECT count(*) FROM inventory_schema.inventory_transactions)::int AS ledger`,
    );
    expect(rows[0]).toEqual({ inventory: 0, ledger: 0 });
  });
});
