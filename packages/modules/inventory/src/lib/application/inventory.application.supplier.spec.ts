import type {
  Material,
  MovementCounterparty,
  SettingsEntry,
  StockDocumentLotInput,
} from '@enterprise-platform/contracts-inventory';
import type { LegacySupplierValue } from '../domain/supplier-catalog.js';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { NewStockDocumentInput, StockDocumentStore } from './stock-document-store.port.js';

const manager: InventoryActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Hải',
  canManage: true,
  canWriteTransactions: true,
};

const clerk: InventoryActor = { ...manager, userId: 'u2', canManage: false };

const entry = (key: string, value: unknown): SettingsEntry<unknown> => ({
  key,
  value,
  version: 1,
  updatedAt: new Date(0).toISOString(),
});

interface Config {
  readonly suppliers?: readonly string[];
  readonly mode?: 'CATALOG_ONLY' | 'CATALOG_OR_FREE';
  readonly current?: Partial<Material>;
  readonly legacy?: LegacySupplierValue[];
}

function setup(config: Config = {}) {
  const stored = new Map<string, SettingsEntry<unknown>>();
  if (config.suppliers) stored.set('catalog.supplier', entry('catalog.supplier', { suppliers: config.suppliers }));
  if (config.mode) stored.set('supplier.input', entry('supplier.input', { mode: config.mode }));
  const settings = {
    get: jest.fn(async (_tenantId: string, key: string) => stored.get(key) ?? null),
    list: jest.fn(async () => [...stored.values()]),
    put: jest.fn(async (_t: string, key: string, value: unknown) => entry(key, value)),
  };
  const material = {
    findAnyByCode: jest.fn(
      async (): Promise<Material | null> =>
        config.current ? ({ code: 'VT-1', kind: 'STOCK', ...config.current } as Material) : null,
    ),
    create: jest.fn(async (_t: string, input: { code: string }) => ({ ...input }) as unknown as Material),
    update: jest.fn(async () => ({ code: 'VT-1', kind: 'STOCK' }) as unknown as Material),
    hasStockFootprint: jest.fn(async () => false),
  };
  const suppliers = { listLegacyValues: jest.fn(async () => config.legacy ?? []) };
  const calls: NewStockDocumentInput[] = [];
  const documents = {
    createAndPost: jest.fn(async (_t: string, input: NewStockDocumentInput) => {
      calls.push(input);
      return { document: {}, transactions: [{ transactionCode: 'TXN-1' }] };
    }),
  } as unknown as StockDocumentStore;
  const store = { material, settings, suppliers } as unknown as InventoryStore;
  return { app: new InventoryApplication(store, documents), material, settings, suppliers, calls };
}

const base = { code: 'vt-1', name: 'Đinh', category: 'CONSUMABLE', unit: 'Cái' } as const;
const catalog = ['Công ty A', 'ABB Việt Nam'];

describe('nhà cung cấp trên hồ sơ mặt hàng', () => {
  it('không khai nhà cung cấp thì không đọc cấu hình (không thêm truy vấn cho đường cũ)', async () => {
    const { app, settings, material } = setup();
    await app.createMaterial(manager, base);
    expect(settings.get).not.toHaveBeenCalled();
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.not.objectContaining({ supplier: expect.anything() }),
      'Hải',
      undefined,
    );
  });

  it('danh mục rỗng: nhập tự do như trước dù mặc định là CATALOG_ONLY', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, supplier: ' Nhà bất kỳ ' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ supplier: 'Nhà bất kỳ' }),
      'Hải',
      undefined,
    );
  });

  it('đang chặn: tên khớp sau chuẩn hóa được ghi bằng đúng tên trong danh mục', async () => {
    const { app, material } = setup({ suppliers: catalog });
    await app.createMaterial(manager, { ...base, supplier: 'cong ty a' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ supplier: 'Công ty A' }),
      'Hải',
      undefined,
    );
  });

  it('đang chặn: nhà ngoài danh mục bị từ chối và không ghi mặt hàng', async () => {
    const { app, material } = setup({ suppliers: catalog });
    await expect(app.createMaterial(manager, { ...base, supplier: 'Nhà lạ' })).rejects.toMatchObject({
      code: 'SUPPLIER_NOT_IN_CATALOG',
      statusCode: 400,
      message: 'Nhà cung cấp "Nhà lạ" chưa có trong danh mục. Nhờ người quản lý thêm ở Cài đặt.',
    });
    expect(material.create).not.toHaveBeenCalled();
  });

  it('CATALOG_OR_FREE: nhà ngoài danh mục vẫn được ghi', async () => {
    const { app, material } = setup({ suppliers: catalog, mode: 'CATALOG_OR_FREE' });
    await app.createMaterial(manager, { ...base, supplier: 'Nhà lạ' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ supplier: 'Nhà lạ' }),
      'Hải',
      undefined,
    );
  });

  it('sửa: giữ nguyên giá trị cũ chữ tự do ngoài danh mục thì không bị chặn', async () => {
    const { app, material } = setup({ suppliers: catalog, current: { supplier: 'Cty cũ' } });
    await app.updateMaterial(manager, 'VT-1', { supplier: ' cty cũ ', name: 'Đinh mới' });
    expect(material.update).toHaveBeenCalledWith(
      't1',
      'VT-1',
      expect.objectContaining({ supplier: 'cty cũ' }),
    );
  });

  it('sửa: đổi sang nhà ngoài danh mục bị chặn; đổi sang nhà trong danh mục được ghi tên chuẩn', async () => {
    const { app, material } = setup({ suppliers: catalog, current: { supplier: 'Cty cũ' } });
    await expect(app.updateMaterial(manager, 'VT-1', { supplier: 'Nhà lạ' })).rejects.toMatchObject({
      code: 'SUPPLIER_NOT_IN_CATALOG',
    });
    expect(material.update).not.toHaveBeenCalled();
    await app.updateMaterial(manager, 'VT-1', { supplier: 'abb viet nam' });
    expect(material.update).toHaveBeenCalledWith(
      't1',
      'VT-1',
      expect.objectContaining({ supplier: 'ABB Việt Nam' }),
    );
  });

  it('sửa không đụng nhà cung cấp thì không đọc cấu hình', async () => {
    const { app, settings } = setup({ suppliers: catalog, current: {} });
    await app.updateMaterial(manager, 'VT-1', { name: 'Tên mới' });
    expect(settings.get).not.toHaveBeenCalled();
  });

  it('nhập hàng loạt: đọc cấu hình một lần cho cả tệp, dòng sai báo theo số dòng và không chặn dòng khác', async () => {
    const { app, settings, material } = setup({ suppliers: catalog });
    const result = await app.importMaterials(manager, {
      rows: [
        { ...base, line: 2, code: 'A1', supplier: 'công ty a' },
        { ...base, line: 3, code: 'A2', supplier: 'Nhà lạ' },
        { ...base, line: 4, code: 'A3', supplier: 'ABB Việt Nam' },
      ],
    });
    expect(result.created).toBe(2);
    expect(result.failures).toEqual([
      {
        line: 3,
        message: 'Nhà cung cấp "Nhà lạ" chưa có trong danh mục. Nhờ người quản lý thêm ở Cài đặt.',
      },
    ]);
    expect(material.create).toHaveBeenCalledTimes(2);
    // Mỗi dòng đọc hai khoá (danh mục và cách nhập); đọc một lần thì tổng đúng hai lần gọi.
    expect(settings.get).toHaveBeenCalledTimes(2);
  });
});

describe('nhà cung cấp trên đường nhập kho cũ (receiveStock)', () => {
  const receipt = {
    warehouseCode: 'KHO',
    materialCode: 'VT',
    quantity: 5,
  };

  it('lô nhập: nhà cung cấp của lô được đổi thành tên chuẩn của danh mục', async () => {
    const { app, calls } = setup({ suppliers: catalog });
    const lot: StockDocumentLotInput = { lotNo: 'L1', supplier: 'CÔNG TY A' };
    await app.receiveStock(clerk, { ...receipt, lot });
    expect(calls[0].lines[0].lot).toMatchObject({ lotNo: 'L1', supplier: 'Công ty A' });
  });

  it('lô nhập: nhà ngoài danh mục bị từ chối và chứng từ không được tạo', async () => {
    const { app, calls } = setup({ suppliers: catalog });
    await expect(
      app.receiveStock(clerk, { ...receipt, lot: { lotNo: 'L1', supplier: 'Nhà lạ' } }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_IN_CATALOG' });
    expect(calls).toHaveLength(0);
  });

  it('bên giao hàng loại SUPPLIER của phiếu cũng kiểm theo danh mục; loại khác không bị đụng tới', async () => {
    const { app, calls } = setup({ suppliers: catalog });
    const supplier: MovementCounterparty = { type: 'SUPPLIER', name: 'abb viet nam' };
    await app.receiveStock(clerk, { ...receipt, counterparty: supplier });
    expect(calls).toHaveLength(1);

    const department: MovementCounterparty = { type: 'DEPARTMENT', name: 'Phòng Kỹ thuật' };
    await app.receiveStock(clerk, { ...receipt, counterparty: department });
    expect(calls).toHaveLength(2);

    await expect(
      app.receiveStock(clerk, { ...receipt, counterparty: { type: 'SUPPLIER', name: 'Nhà lạ' } }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_IN_CATALOG' });
    expect(calls).toHaveLength(2);
  });

  it('không khai nhà cung cấp thì không đọc cấu hình', async () => {
    const { app, settings } = setup({ suppliers: catalog });
    await app.receiveStock(clerk, receipt);
    await app.receiveStock(clerk, { ...receipt, counterparty: { type: 'CUSTOMER', name: 'Khách' } });
    expect(settings.get).not.toHaveBeenCalled();
  });
});

describe('danh mục nhà cung cấp trong Cài đặt', () => {
  it('lưu: từ chối tên dài quá 180 ký tự và danh sách quá 500 mục thay vì lặng lẽ bỏ mục', async () => {
    const { app, settings } = setup();
    await expect(
      app.updateSetting(manager, 'catalog.supplier', { value: { suppliers: ['A'.repeat(181)] } }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('tối đa 180 ký tự') });
    await expect(
      app.updateSetting(manager, 'catalog.supplier', {
        value: { suppliers: Array.from({ length: 501 }, (_, index) => `Nhà ${index}`) },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('tối đa 500') });
    await expect(
      app.updateSetting(manager, 'catalog.supplier', { value: { suppliers: 'không phải danh sách' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(settings.put).not.toHaveBeenCalled();
  });

  it('lưu: ghi bản đã chuẩn hóa (bỏ trùng theo khóa so sánh)', async () => {
    const { app, settings } = setup();
    await app.updateSetting(manager, 'catalog.supplier', {
      value: { suppliers: ['Công ty A', 'CÔNG TY A', 'ABB'] },
      expectedVersion: 0,
    });
    expect(settings.put).toHaveBeenCalledWith(
      't1',
      'catalog.supplier',
      { suppliers: ['Công ty A', 'ABB'] },
      'u1',
      0,
    );
  });

  it('chỉ người có quyền quản lý mới sửa được danh mục', async () => {
    const { app } = setup();
    await expect(
      app.updateSetting(clerk, 'catalog.supplier', { value: { suppliers: ['A'] } }),
    ).rejects.toMatchObject({ message: 'Bạn không có quyền sửa danh mục kho.' });
  });
});

describe('nhập nhà cung cấp từ dữ liệu cũ', () => {
  const legacy: LegacySupplierValue[] = [
    { name: 'Công ty A', source: 'MATERIAL', count: 2 },
    { name: 'CONG TY A', source: 'LOT', count: 1 },
    { name: 'ABB Việt Nam', source: 'TRANSACTION', count: 4 },
  ];

  it('gộp biến thể, đánh dấu mục đã có trong danh mục', async () => {
    const { app } = setup({ suppliers: ['ABB Việt Nam'], legacy });
    const { candidates } = await app.listLegacySupplierCandidates(manager);
    expect(candidates).toEqual([
      expect.objectContaining({ name: 'ABB Việt Nam', transactionCount: 4, inCatalog: true }),
      expect.objectContaining({
        name: 'Công ty A',
        variants: ['Công ty A', 'CONG TY A'],
        materialCount: 2,
        lotCount: 1,
        inCatalog: false,
      }),
    ]);
  });

  it('người không có quyền quản lý bị từ chối và không đọc dữ liệu', async () => {
    const { app, suppliers } = setup({ legacy });
    await expect(app.listLegacySupplierCandidates(clerk)).rejects.toMatchObject({
      message: 'Bạn không có quyền sửa danh mục kho.',
    });
    expect(suppliers.listLegacyValues).not.toHaveBeenCalled();
  });
});
