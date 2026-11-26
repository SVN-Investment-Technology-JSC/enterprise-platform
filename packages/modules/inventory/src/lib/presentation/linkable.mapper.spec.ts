import type { Asset, Material, StockDocument, StocktakeSession } from '@enterprise-platform/contracts-inventory';
import {
  INVENTORY_LINKABLE_KIND_LIST,
  assetObject,
  documentCandidate,
  documentKindOf,
  documentObject,
  inventoryLaunchUrl,
  isInventoryLinkableKind,
  materialObject,
  matchesSearch,
  newestFirst,
  stocktakeObject,
} from './linkable.mapper.js';

const SAFE_URL = /^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/;
const KIND_PATTERN = /^inventory\.[a-z][a-z0-9-]*$/;

const document: StockDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'PNK-2026-00012',
  docType: 'RECEIPT_PURCHASE',
  status: 'POSTED',
  warehouseId: 'w-1',
  warehouseCode: 'KHO01',
  documentDate: '2026-11-20',
  note: 'Nhập tủ điện cho công trình A',
  createdBy: 'u-1',
  postedAt: '2026-11-21T03:00:00.000Z',
  createdAt: '2026-11-20T02:00:00.000Z',
  updatedAt: '2026-11-21T03:00:00.000Z',
  lines: [
    {
      id: 'l-1',
      lineNo: 1,
      materialId: 'm-1',
      materialCode: 'VT001',
      materialName: 'Tủ điện tổng',
      quantity: 2,
      direction: 'IN',
      unitCost: 15_000_000,
      costAmount: 30_000_000,
    },
    {
      id: 'l-2',
      lineNo: 2,
      materialId: 'm-2',
      materialCode: 'VT002',
      materialName: 'Cáp đồng',
      quantity: 0.5,
      direction: 'IN',
      unitCost: 1_000_000,
    },
  ],
};

describe('Kho công bố đối tượng liên kết', () => {
  it('loại đều thuộc module inventory, đúng mẫu khoá, không điền sẵn', () => {
    expect(INVENTORY_LINKABLE_KIND_LIST.map((kind) => kind.key)).toEqual([
      'inventory.receipt',
      'inventory.issue',
      'inventory.transfer',
      'inventory.adjustment',
      'inventory.stocktake',
      'inventory.material',
      'inventory.asset',
    ]);
    for (const kind of INVENTORY_LINKABLE_KIND_LIST) {
      expect(kind.key).toMatch(KIND_PATTERN);
      expect(kind.moduleLabel).toBe('Kho');
      expect(kind.prefill).toBe(false);
    }
    expect(isInventoryLinkableKind('inventory.receipt')).toBe(true);
    expect(isInventoryLinkableKind('crm.contract')).toBe(false);
  });

  it('chứng từ chia nhóm theo loại như báo cáo xuất nhập', () => {
    expect(documentKindOf('RECEIPT_SALES_RETURN')).toBe('inventory.receipt');
    expect(documentKindOf('ISSUE_PROJECT')).toBe('inventory.issue');
    expect(documentKindOf('TRANSFER')).toBe('inventory.transfer');
    expect(documentKindOf('ISSUE_TRANSFER')).toBe('inventory.transfer');
    expect(documentKindOf('ADJUSTMENT')).toBe('inventory.adjustment');
  });

  it('đường dẫn mở hồ sơ là đường dẫn nội bộ an toàn của Kho', () => {
    expect(inventoryLaunchUrl('inventory.issue', 'd 1')).toBe('/modules/inventory#stock/movements/d%201');
    expect(inventoryLaunchUrl('inventory.asset', "TB(01)!")).toBe('/modules/inventory#assets/TB%2801%29%21');
    expect(inventoryLaunchUrl('inventory.stocktake', 's-1')).toBe('/modules/inventory#stock');
    expect(inventoryLaunchUrl('inventory.material', 'VT001')).toBe('/modules/inventory#stock');
    for (const kind of INVENTORY_LINKABLE_KIND_LIST) {
      expect(inventoryLaunchUrl(kind.key as never, "mã có dấu & 'nháy'")).toMatch(SAFE_URL);
    }
  });

  it('phiếu nhập: nhãn không chứa số tiền, tổng số lượng và giá trị nằm ở fields', () => {
    const object = documentObject(document);
    expect(object.kind).toBe('inventory.receipt');
    expect(object.label).toBe('PNK-2026-00012 — Nhập mua hàng');
    expect(object.label).not.toMatch(/30\.?000\.?000|30500000/);
    expect(object.status).toBe('Đã ghi sổ');
    expect(object.hint).toBe('Kho KHO01 · 2026-11-20');
    expect(object.launchUrl).toBe('/modules/inventory#stock/movements/11111111-1111-4111-8111-111111111111');
    const field = (key: string) => object.fields.find((item) => item.key === key);
    expect(field('lineCount')?.value).toBe('2');
    expect(field('totalQuantity')?.value).toBe('2.5');
    expect(field('totalValue')).toEqual({ key: 'totalValue', label: 'Giá trị', type: 'money', value: 30_500_000 });
    expect(field('documentDate')).toEqual({ key: 'documentDate', label: 'Ngày chứng từ', type: 'date', value: '2026-11-20' });
    expect(field('postedAt')?.value).toBe('2026-11-21');
    expect(field('source')?.value).toBe('Thủ công');
    expect(object.upstream).toEqual([]);
    expect(object.prefill).toBeUndefined();
  });

  it('phiếu chuyển kho ghi cả kho nhận; phiếu điều chỉnh từ kiểm kê và chứng từ đảo trỏ về hồ sơ gốc', () => {
    const transfer = documentCandidate({ ...document, docType: 'TRANSFER', targetWarehouseCode: 'KHO02' });
    expect(transfer.kind).toBe('inventory.transfer');
    expect(transfer.hint).toBe('Kho KHO01 → KHO02 · 2026-11-20');

    const adjustment = documentObject({
      ...document,
      docType: 'ADJUSTMENT',
      sourceType: 'stocktake',
      sourceId: 's-1',
    });
    expect(adjustment.upstream).toEqual([{ kind: 'inventory.stocktake', id: 's-1', label: 'Đợt kiểm kê' }]);
    expect(adjustment.fields.find((item) => item.key === 'source')?.value).toBe('Kiểm kê');

    const reversal = documentObject({ ...document, docType: 'ISSUE_OTHER', reversesDocumentId: 'd-0' });
    expect(reversal.upstream).toEqual([{ kind: 'inventory.issue', id: 'd-0', label: 'Chứng từ gốc' }]);
  });

  it('phiếu kiểm kê: trạng thái đã dịch, giá trị chênh lệch là tiền', () => {
    const session: StocktakeSession = {
      id: 's-1',
      code: 'KK-2026-00003',
      title: 'Kiểm kê cuối năm',
      warehouseId: 'w-1',
      warehouseCode: 'KHO01',
      warehouseName: 'Kho tổng',
      status: 'PENDING_APPROVAL',
      scopeType: 'ALL',
      stocktakeDate: '2026-11-25',
      leadAuditor: 'Nguyễn Văn A',
      totalItems: 120,
      countedItems: 118,
      differenceItems: 3,
      totalVarianceValue: -2_500_000,
      createdAt: '2026-11-24T01:00:00.000Z',
      updatedAt: '2026-11-25T01:00:00.000Z',
    };
    const object = stocktakeObject(session);
    expect(object.label).toBe('KK-2026-00003 — Kiểm kê cuối năm');
    expect(object.status).toBe('Chờ duyệt');
    expect(object.fields.find((item) => item.key === 'warehouse')?.value).toBe('KHO01 — Kho tổng');
    expect(object.fields.find((item) => item.key === 'totalVarianceValue')).toEqual({
      key: 'totalVarianceValue',
      label: 'Giá trị chênh lệch',
      type: 'money',
      value: -2_500_000,
    });
  });

  it('vật tư và tài sản lấy mã làm id; giá chỉ ở fields', () => {
    const material: Material = {
      id: 'm-1',
      code: 'VT001',
      name: 'Tủ điện tổng',
      category: 'SPARE_PART',
      unit: 'Cái',
      minStock: 1,
      maxStock: 10,
      isSerialized: true,
      isActive: true,
      kind: 'STOCK',
      supplier: 'Công ty B',
      purchasePrice: 15_000_000,
    };
    const object = materialObject(material);
    expect(object.id).toBe('VT001');
    expect(object.label).toBe('VT001 — Tủ điện tổng');
    expect(object.hint).toBe('Phụ tùng · ĐVT Cái');
    expect(object.fields.find((item) => item.key === 'purchasePrice')?.type).toBe('money');
    expect(object.fields.find((item) => item.key === 'supplier')?.value).toBe('Công ty B');

    const asset: Asset = {
      id: 'a-1',
      code: 'TB001',
      name: 'Máy biến áp T1',
      type: 'Máy biến áp',
      status: 'OPERATING',
      criticality: 'CRITICAL',
      taskTemplate: [],
      serialNumber: 'SN-9',
      purchasePrice: 900_000_000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const assigned = assetObject(asset, {
      assignedEmployeeId: 'e-1',
      assignedAt: '2026-11-01T08:00:00.000Z',
      assetCategory: 'IT_OFFICE',
    });
    expect(assigned.id).toBe('TB001');
    expect(assigned.status).toBe('Đang vận hành');
    expect(assigned.label).not.toMatch(/900/);
    expect(assigned.launchUrl).toBe('/modules/inventory#assets/TB001');
    expect(assigned.fields.find((item) => item.key === 'custody')?.value).toBe('Đang cấp phát cho nhân sự');
    expect(assigned.fields.find((item) => item.key === 'assignedAt')?.value).toBe('2026-11-01');
    expect(assetObject(asset).fields.find((item) => item.key === 'custody')?.value).toBe('Chưa cấp phát');
  });

  it('tìm không phân biệt hoa thường và dấu; danh mục không có chữ tìm thì mới nhất trước', () => {
    expect(matchesSearch('tu dien vt001', ['VT001', 'Tủ điện tổng'])).toBe(true);
    expect(matchesSearch('đồng', ['VT002', 'Cáp đồng'])).toBe(true);
    expect(matchesSearch('nhôm', ['VT002', 'Cáp đồng'])).toBe(false);
    expect(
      newestFirst([
        { code: 'A', createdAt: '2026-01-01' },
        { code: 'B' },
        { code: 'C', createdAt: '2026-06-01' },
      ]).map((row) => row.code),
    ).toEqual(['C', 'A', 'B']);
  });
});
