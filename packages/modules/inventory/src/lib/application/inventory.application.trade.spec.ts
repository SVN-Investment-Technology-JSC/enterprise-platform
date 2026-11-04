import type { Material } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { StockDocumentStore } from './stock-document-store.port.js';

const manager: InventoryActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Hải',
  canManage: true,
  canWriteTransactions: true,
};

function setup() {
  const material = {
    findAnyByCode: jest.fn(async (_tenantId?: string, _code?: string): Promise<Material | null> => null),
    create: jest.fn(async (_t: string, input: { code: string }) => ({ ...input }) as unknown as Material),
    update: jest.fn(async () => ({ code: 'VT-1', kind: 'STOCK' }) as unknown as Material),
    hasStockFootprint: jest.fn(async () => false),
    listLinks: jest.fn(async (): Promise<{ label: string; count: number }[]> => []),
    delete: jest.fn(async () => true),
  };
  const store = { material } as unknown as InventoryStore;
  return { app: new InventoryApplication(store, {} as StockDocumentStore), material };
}

const base = { code: 'vt-1', name: 'Cáp', category: 'CONSUMABLE', unit: 'Mét' } as const;

describe('InventoryApplication hình thức kinh doanh và giá bán', () => {
  it('tạo: ghi tên người tạo và truyền hình thức, giá bán xuống kho dữ liệu', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, tradeMode: 'SALE_ONLY', salePrice: 45000 });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ code: 'VT-1', tradeMode: 'SALE_ONLY', salePrice: 45000 }),
      'Hải',
      undefined,
    );
  });

  it('tạo: nhận cách sử dụng và phân loại tự khai, truyền xuống kho dữ liệu', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, tradeMode: 'Đi kèm combo', tradeCategory: 'Cáp điện' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ tradeMode: 'Đi kèm combo', tradeCategory: 'Cáp điện' }),
      'Hải',
      undefined,
    );
  });

  it('nhập từ hệ cũ: giữ người tạo, ngày tạo, trạng thái; người tạo trống thì không ghi ai; dòng lỗi không chặn dòng khác', async () => {
    const { app, material } = setup();
    const result = await app.importMaterials(manager, {
      rows: [
        { ...base, line: 2, code: 'DV-1', createdBy: 'Cao Khánh Ngọc', createdAt: '2022-09-13T00:00:00+07:00', isActive: false, description: 'ghi chú' },
        { ...base, line: 3, code: 'DV-2', createdBy: '' },
        { ...base, line: 4, code: 'DV-3', createdAt: 'không phải ngày' },
        { ...base, line: 5, code: 'DV-4', salePrice: -1 },
      ],
    });
    expect(result.created).toBe(2);
    expect(result.failures).toEqual([
      { line: 4, message: 'Ngày tạo không hợp lệ.' },
      { line: 5, message: 'Giá bán phải là số không âm.' },
    ]);
    expect(material.create).toHaveBeenNthCalledWith(
      1,
      't1',
      expect.objectContaining({ code: 'DV-1', description: 'ghi chú' }),
      'Cao Khánh Ngọc',
      { createdAt: '2022-09-13T00:00:00+07:00', isActive: false },
    );
    // Trống nghĩa là không ghi người tạo, không rơi về người đang nhập (Hải).
    expect(material.create).toHaveBeenNthCalledWith(2, 't1', expect.anything(), undefined, {
      createdAt: undefined,
      isActive: undefined,
    });
  });

  describe('nhập từ hệ cũ: mã đã có trong Kho', () => {
    const existing = (patch: Partial<Material> = {}) =>
      ({ code: 'DV-1', kind: 'SERVICE', isActive: true, minStock: 0, maxStock: 0, ...patch }) as unknown as Material;
    const row = { ...base, line: 2, code: 'dv-1', name: 'Tên mới', unit: 'Gói', salePrice: 100, createdBy: 'Cao Khánh Ngọc', createdAt: '2022-09-13T00:00:00+07:00' };

    it('mặc định báo lỗi trùng mã và không đụng tới bản cũ', async () => {
      const { app, material } = setup();
      material.findAnyByCode.mockResolvedValue(existing());
      const result = await app.importMaterials(manager, { rows: [row] });
      expect(result).toMatchObject({ created: 0, updated: 0, failures: [{ line: 2, message: 'Mã vật tư DV-1 đã tồn tại.', duplicate: true }] });
      expect(material.update).not.toHaveBeenCalled();
    });

    it('bỏ qua: giữ bản cũ, báo rõ dòng nào bị bỏ qua, không tính là lỗi', async () => {
      const { app, material } = setup();
      material.findAnyByCode.mockResolvedValue(existing());
      const result = await app.importMaterials(manager, { rows: [row], onConflict: 'SKIP' });
      expect(result).toMatchObject({ created: 0, updated: 0, failures: [], skipped: [{ line: 2, message: 'Mã DV-1 đã có, giữ bản cũ.' }] });
      expect(material.create).not.toHaveBeenCalled();
      expect(material.update).not.toHaveBeenCalled();
    });

    it('cập nhật: chỉ ghi ô có giá trị, kèm dấu vết hệ cũ; mã chưa có thì vẫn tạo mới', async () => {
      const { app, material } = setup();
      material.findAnyByCode.mockImplementation(async (_t?: string, code?: string) => (code === 'DV-1' ? existing() : null));
      const result = await app.importMaterials(manager, {
        rows: [row, { ...base, line: 3, code: 'DV-NEW' }],
        onConflict: 'UPDATE',
      });
      expect(result).toMatchObject({ created: 1, updated: 1, failures: [], skipped: [] });
      expect(material.update).toHaveBeenCalledWith(
        't1',
        'DV-1',
        { name: 'Tên mới', unit: 'Gói', salePrice: 100 },
        { createdBy: 'Cao Khánh Ngọc', createdAt: '2022-09-13T00:00:00+07:00' },
      );
      expect(material.create).toHaveBeenCalledTimes(1);
    });

    it('cập nhật: mã đã ngừng dùng thì bỏ qua, không tự dùng lại', async () => {
      const { app, material } = setup();
      material.findAnyByCode.mockResolvedValue(existing({ isActive: false }));
      const result = await app.importMaterials(manager, { rows: [row], onConflict: 'UPDATE' });
      expect(result.skipped).toEqual([{ line: 2, message: 'Mã DV-1 đã ngừng dùng, không cập nhật.' }]);
      expect(material.update).not.toHaveBeenCalled();
    });

    it('từ chối cách xử lý lạ', async () => {
      const { app } = setup();
      await expect(app.importMaterials(manager, { rows: [row], onConflict: 'DELETE' as never })).rejects.toThrow('Cách xử lý');
    });
  });

  it('nhập từ hệ cũ: tên quá 255 ký tự báo đúng lý do thay vì lỗi chung của DB', async () => {
    const { app, material } = setup();
    const result = await app.importMaterials(manager, { rows: [{ ...base, line: 277, code: 'X1', name: 'x'.repeat(261) }] });
    expect(result.failures).toEqual([{ line: 277, message: 'Tên tối đa 255 ký tự (hiện 261).' }]);
    expect(material.create).not.toHaveBeenCalled();
  });

  it('nhập từ hệ cũ: không có dòng, quá nhiều dòng hoặc không đủ quyền thì từ chối', async () => {
    const { app } = setup();
    await expect(app.importMaterials(manager, { rows: [] })).rejects.toThrow('Không có dòng nào');
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ ...base, line: i + 2, code: `X-${i}` }));
    await expect(app.importMaterials(manager, { rows: tooMany })).rejects.toThrow('tối đa 1000');
  });

  it('mô tả: lưu chuỗi đã cắt khoảng trắng và từ chối quá 2000 ký tự', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, description: '  Theo định mức  ' });
    expect(material.create).toHaveBeenCalledWith('t1', expect.objectContaining({ description: '  Theo định mức  ' }), 'Hải', undefined);
    await expect(app.createMaterial(manager, { ...base, code: 'VT-2', description: 'x'.repeat(2001) })).rejects.toThrow('Mô tả tối đa');
  });

  it('tạo: từ chối cách sử dụng, phân loại rỗng hoặc quá dài và giá bán âm', async () => {
    const { app, material } = setup();
    await expect(app.createMaterial(manager, { ...base, tradeMode: '   ' })).rejects.toThrow('Cách sử dụng');
    await expect(app.createMaterial(manager, { ...base, tradeMode: 'x'.repeat(101) })).rejects.toThrow('Cách sử dụng');
    await expect(app.createMaterial(manager, { ...base, tradeCategory: 'y'.repeat(101) })).rejects.toThrow('Phân loại');
    await expect(app.createMaterial(manager, { ...base, tradeMode: 5 as never })).rejects.toThrow('Cách sử dụng');
    await expect(app.createMaterial(manager, { ...base, salePrice: -1 })).rejects.toThrow('Giá bán');
    expect(material.create).not.toHaveBeenCalled();
  });

  it('sửa: cũng chặn nhãn không hợp lệ và giá bán không phải số, vẫn nhận mã cũ', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue({ code: 'VT-1', kind: 'STOCK', minStock: 0, maxStock: 0 } as unknown as Material);
    await expect(app.updateMaterial(manager, 'VT-1', { tradeMode: '' })).rejects.toThrow('Cách sử dụng');
    await expect(app.updateMaterial(manager, 'VT-1', { tradeCategory: '  ' })).rejects.toThrow('Phân loại');
    await expect(app.updateMaterial(manager, 'VT-1', { salePrice: Number.NaN })).rejects.toThrow('Giá bán');
    await app.updateMaterial(manager, 'VT-1', { tradeMode: 'GIFT_ONLY', salePrice: 0 });
    expect(material.update).toHaveBeenCalledTimes(1);
  });

  it('sửa mã đã ngừng dùng: bị chặn, trừ khi chỉ để dùng lại', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue({ code: 'VT-1', kind: 'STOCK', isActive: false, minStock: 0, maxStock: 0 } as unknown as Material);
    await expect(app.updateMaterial(manager, 'VT-1', { name: 'Tên mới' })).rejects.toThrow('đã ngừng dùng');
    expect(material.update).not.toHaveBeenCalled();
    await app.updateMaterial(manager, 'VT-1', { isActive: true });
    expect(material.update).toHaveBeenCalledWith('t1', 'VT-1', { isActive: true });
  });
});

describe('InventoryApplication xoá mã chưa có liên kết', () => {
  const found = { code: 'VT-1', kind: 'STOCK' } as unknown as Material;

  it('xoá được khi không còn liên kết nào', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(found);
    await expect(app.deleteMaterial(manager, 'VT-1')).resolves.toEqual({ code: 'VT-1', mode: 'deleted' });
    expect(material.delete).toHaveBeenCalledWith('t1', 'VT-1');
  });

  it('từ chối và nêu từng liên kết khi mã đã được dùng; không xoá gì', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(found);
    material.listLinks.mockResolvedValue([
      { label: 'bút toán kho', count: 7 },
      { label: 'crm_schema.quote_lines', count: 2 },
    ]);
    await expect(app.deleteMaterial(manager, 'VT-1')).rejects.toThrow(
      /bút toán kho \(7\), crm_schema\.quote_lines \(2\).*Ngừng dùng/,
    );
    expect(material.delete).not.toHaveBeenCalled();
  });

  it('chỉ người quản lý được xoá; mã không có thì báo không tìm thấy', async () => {
    const { app, material } = setup();
    await expect(app.deleteMaterial({ ...manager, canManage: false }, 'VT-1')).rejects.toThrow();
    expect(material.delete).not.toHaveBeenCalled();
    await expect(app.deleteMaterial(manager, 'KHONG-CO')).rejects.toThrow();
    expect(material.delete).not.toHaveBeenCalled();
  });
});
