import type {
  Asset,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  StockDocument,
} from '@enterprise-platform/contracts-inventory';
import { canReadCost } from './cost-visibility.js';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryReportStore } from './inventory-report-store.port.js';
import { InventoryReportService } from './inventory-report.service.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { StockDocumentStore } from './stock-document-store.port.js';
import { StockDocumentService } from './stock-document.service.js';

const base: InventoryActor = { tenantId: 't', userId: 'u', displayName: 'Người dùng', canManage: false };
const basic: InventoryActor = { ...base, canReadCost: false };
const costReader: InventoryActor = { ...base, canReadCost: true };

const stockRow: MaterialInventory = {
  id: 's1',
  warehouseId: 'w',
  materialId: 'm',
  quantity: 10,
  quantityReserved: 2,
  quantityBlocked: 0,
  available: 8,
  avgCost: 1500,
  updatedAt: new Date(0).toISOString(),
};

const transaction: InventoryTransaction = {
  id: 'tx',
  transactionCode: 'TXN-1',
  warehouseId: 'w',
  materialId: 'm',
  type: 'EXPORT',
  quantity: -1,
  unitCost: 1500,
  workflowStatus: 'APPROVED',
  createdBy: 'u',
  createdAt: new Date(0).toISOString(),
};

const reservation: Reservation = {
  id: 'r',
  reservationCode: 'GH-1',
  referenceType: 'CRM_CONTRACT',
  referenceId: 'hop-dong-khach-a',
  sourceType: 'CRM_CONTRACT',
  sourceId: '6f0c3c2e-0000-4000-8000-000000000001',
  idempotencyKey: 'contract-1',
  status: 'RESERVED',
  createdBy: 'u',
  createdAt: new Date(0).toISOString(),
};

const document = {
  id: 'd',
  code: 'PN-1',
  docType: 'RECEIPT_PURCHASE',
  status: 'POSTED',
  warehouseId: 'w',
  warehouseCode: 'KHO-A',
  documentDate: '2026-11-01',
  createdBy: 'u',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  lines: [
    {
      id: 'l',
      lineNo: 1,
      materialId: 'm',
      materialCode: 'VT',
      materialName: 'Vật tư',
      quantity: 2,
      direction: 'IN',
      unitCost: 1500,
      costAmount: 3000,
    },
  ],
} as unknown as StockDocument;

function application() {
  const store = {
    inventory: { listByWarehouse: async () => [stockRow], findByMaterialAndWarehouse: async () => stockRow },
    transaction: { listRecent: async () => [transaction], listByMaterial: async () => [transaction] },
    reservation: { list: async () => [reservation], findByCode: async () => reservation },
    material: { findByCode: async () => ({ code: 'VT' }) },
  } as unknown as InventoryStore;
  return new InventoryApplication(store, {} as StockDocumentStore);
}

function reports() {
  const amounts = { quantityIn: 2, quantityOut: 0, valueIn: 3000, valueOut: 0, entries: 1 };
  const store = {
    stockByWarehouse: async () => ({
      rows: [
        {
          warehouseId: 'w',
          warehouseCode: 'KHO-A',
          warehouseName: 'Kho A',
          materialId: 'm',
          materialCode: 'VT',
          materialName: 'Vật tư',
          onHand: 10,
          reserved: 2,
          blocked: 0,
          available: 8,
          avgCost: 1500,
          stockValue: 15000,
        },
      ],
      total: 1,
      totals: { onHand: 10, reserved: 2, blocked: 0, available: 8, stockValue: 15000 },
    }),
    movementGroups: async () => [
      { docType: 'RECEIPT_PURCHASE', isReversal: false, ledgerType: 'IMPORT', warehouseCode: 'KHO-A', warehouseName: 'Kho A', ...amounts },
    ],
    movementLines: async () => ({
      rows: [
        {
          transactionId: 'tx',
          transactionCode: 'TXN-1',
          postedAt: new Date(0).toISOString(),
          ledgerType: 'IMPORT',
          isReversal: false,
          docType: 'RECEIPT_PURCHASE',
          warehouseCode: 'KHO-A',
          warehouseName: 'Kho A',
          materialCode: 'VT',
          materialName: 'Vật tư',
          quantity: 2,
          unitCost: 1500,
          value: 3000,
          createdBy: 'u',
        },
      ],
      total: 1,
    }),
    approvals: async () => ({ rows: [{ documentCode: 'NK-1', value: 3000, quantityIn: 2, quantityOut: 0 }], total: 1 }),
  } as unknown as InventoryReportStore;
  return new InventoryReportService(store, () => '2026-11-15');
}

describe('canReadCost', () => {
  it('theo cờ của actor; actor cũ không có cờ thì suy theo canManage', () => {
    expect(canReadCost(basic)).toBe(false);
    expect(canReadCost(costReader)).toBe(true);
    expect(canReadCost({ ...base, canManage: true })).toBe(true);
    expect(canReadCost(base)).toBe(false);
  });
});

// SEC-BE013-02: tầng application bỏ giá vốn, giá trị tồn, nguồn giữ hàng khi canReadCost=false.
describe('InventoryApplication: giá vốn theo inventory.cost.read', () => {
  it('tồn kho: không quyền thì không có avgCost, số lượng vẫn đủ', async () => {
    const [row] = await application().listStockByWarehouse(basic, 'KHO-A');
    expect(row).not.toHaveProperty('avgCost');
    expect(row).toMatchObject({ quantity: 10, available: 8 });
    const level = await application().getStockLevel(basic, 'VT', 'KHO-A');
    expect(level).not.toHaveProperty('avgCost');
    expect((await application().listStockByWarehouse(costReader, 'KHO-A'))[0].avgCost).toBe(1500);
  });

  it('giao dịch, lịch sử vật tư: không quyền thì không có unitCost', async () => {
    expect((await application().listRecentTransactions(basic))[0]).not.toHaveProperty('unitCost');
    expect((await application().listMaterialHistory(basic, 'VT'))[0]).not.toHaveProperty('unitCost');
    expect((await application().listRecentTransactions(costReader))[0].unitCost).toBe(1500);
  });

  it('giữ hàng: không quyền thì không thấy hợp đồng, đơn nguồn', async () => {
    for (const row of [
      (await application().listReservations(basic))[0],
      await application().getReservation(basic, 'GH-1'),
    ]) {
      expect(row).not.toHaveProperty('referenceId');
      expect(row).not.toHaveProperty('sourceId');
      expect(row).not.toHaveProperty('idempotencyKey');
      expect(row).toMatchObject({ reservationCode: 'GH-1', status: 'RESERVED' });
    }
    expect(await application().getReservation(costReader, 'GH-1')).toMatchObject({
      referenceId: 'hop-dong-khach-a',
      sourceId: reservation.sourceId,
    });
  });
});

describe('StockDocumentService: giá vốn dòng chứng từ', () => {
  const service = () =>
    new StockDocumentService(
      { get: async () => document, list: async () => ({ items: [document], total: 1, limit: 50, offset: 0 }) } as unknown as StockDocumentStore,
      {} as InventoryStore,
    );

  it('không quyền thì dòng không có unitCost, costAmount', async () => {
    const hidden = await service().get(basic, 'PN-1');
    expect(hidden.lines[0]).not.toHaveProperty('unitCost');
    expect(hidden.lines[0]).not.toHaveProperty('costAmount');
    expect(hidden.lines[0]).toMatchObject({ quantity: 2 });
    const page = await service().list(basic, {});
    expect(page.items[0].lines[0]).not.toHaveProperty('unitCost');
    expect((await service().get(costReader, 'PN-1')).lines[0]).toMatchObject({ unitCost: 1500, costAmount: 3000 });
  });
});

describe('InventoryReportService: giá trị trong báo cáo', () => {
  it('báo cáo tồn theo kho: không quyền thì không có avgCost, stockValue', async () => {
    const report = await reports().stock(basic, {});
    if (report.groupBy !== 'WAREHOUSE') throw new Error('expected WAREHOUSE');
    expect(report.rows[0]).not.toHaveProperty('avgCost');
    expect(report.rows[0]).not.toHaveProperty('stockValue');
    expect(report.totals).not.toHaveProperty('stockValue');
    expect(report.totals.onHand).toBe(10);
    const full = await reports().stock(costReader, {});
    if (full.groupBy !== 'WAREHOUSE') throw new Error('expected WAREHOUSE');
    expect(full.rows[0]).toMatchObject({ avgCost: 1500, stockValue: 15000 });
  });

  it('báo cáo nhập xuất và lịch sử duyệt: không quyền thì không có giá trị', async () => {
    const movements = await reports().movements(basic, {});
    expect(movements.totals).not.toHaveProperty('valueIn');
    expect(movements.summary.every((row) => row.valueIn === undefined && row.valueOut === undefined)).toBe(true);
    expect(movements.breakdown.every((row) => row.valueIn === undefined)).toBe(true);
    expect(movements.lines[0]).not.toHaveProperty('unitCost');
    expect(movements.lines[0]).not.toHaveProperty('value');
    expect(movements.totals.quantityIn).toBe(2);
    expect((await reports().movements(costReader, {})).totals.valueIn).toBe(3000);

    const approvals = await reports().approvals(basic, {});
    expect(approvals.rows[0]).not.toHaveProperty('value');
    expect((await reports().approvals(costReader, {})).rows[0].value).toBe(3000);
  });
});

// ISS-BE-013: giá mua, giá bán ở danh mục vật tư, thiết bị theo cùng quyền inventory.cost.read.
describe('InventoryApplication: giá ở danh mục vật tư, thiết bị', () => {
  const material = {
    id: 'm',
    code: 'VT',
    name: 'Vật tư',
    category: 'SPARE_PART',
    unit: 'Cái',
    minStock: 0,
    maxStock: 0,
    isSerialized: false,
    isActive: true,
    kind: 'STOCK',
    purchasePrice: 1200,
    salePrice: 1800,
    currency: 'VND',
  } as Material;
  const asset = {
    id: 'a',
    code: 'TB',
    name: 'Thiết bị',
    type: 'MAY',
    status: 'OPERATING',
    criticality: 'HIGH',
    taskTemplate: [],
    purchasePrice: 50000,
    currency: 'VND',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } as Asset;

  function catalog() {
    const store = {
      material: { list: async () => [material], findByCode: async () => material },
      item: { findProfile: async () => asset },
      asset: { list: async () => [asset], findByCode: async () => asset },
      custody: {
        listAll: async () => [material],
        listAssigned: async () => [material],
        listByEmployee: async () => [material],
      },
    } as unknown as InventoryStore;
    return new InventoryApplication(store, {} as StockDocumentStore);
  }

  it('vật tư: không quyền thì không có purchasePrice, salePrice; các trường khác giữ nguyên', async () => {
    const app = catalog();
    const rows = [
      (await app.listMaterials(basic))[0],
      await app.getMaterial(basic, 'VT'),
      (await app.listCustodyAssets(basic))[0],
      (await app.listAssignedCustody(basic))[0],
      (await app.listEmployeeCustody(basic, 'e'))[0],
    ];
    for (const row of rows) {
      expect(row).not.toHaveProperty('purchasePrice');
      expect(row).not.toHaveProperty('salePrice');
      expect(row).toMatchObject({ code: 'VT', name: 'Vật tư', unit: 'Cái', currency: 'VND' });
    }
  });

  it('vật tư: có quyền xem giá (hoặc quản lý danh mục, hoặc bên gọi dịch vụ) thì nhận đủ giá', async () => {
    const app = catalog();
    for (const actor of [costReader, { ...base, canManage: true }]) {
      expect((await app.listMaterials(actor))[0]).toMatchObject({ purchasePrice: 1200, salePrice: 1800 });
      expect(await app.getMaterial(actor, 'VT')).toMatchObject({ purchasePrice: 1200, salePrice: 1800 });
    }
  });

  it('thiết bị, hồ sơ mã: không quyền thì không có purchasePrice', async () => {
    const app = catalog();
    for (const row of [
      (await app.listAssets(basic))[0],
      await app.getAsset(basic, 'TB'),
      await app.getItemProfile(basic, 'TB'),
    ]) {
      expect(row).not.toHaveProperty('purchasePrice');
      expect(row).toMatchObject({ code: 'TB', name: 'Thiết bị' });
    }
    expect((await app.listAssets(costReader))[0].purchasePrice).toBe(50000);
    expect((await app.getItemProfile(costReader, 'TB')).purchasePrice).toBe(50000);
  });

  it('không sửa bản ghi gốc của store', async () => {
    await catalog().listMaterials(basic);
    expect(material.purchasePrice).toBe(1200);
  });
});
