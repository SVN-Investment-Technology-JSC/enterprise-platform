import type { Material, SettingsEntry } from '@enterprise-platform/contracts-inventory';
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

type SettingValue = Record<string, unknown>;

function setup(options: { stored?: Record<string, SettingValue> } = {}) {
  const stored: Record<string, SettingValue> = { ...options.stored };
  const material = {
    findAnyByCode: jest.fn(async (_tenantId?: string, _code?: string): Promise<Material | null> => null),
    create: jest.fn(async (_t: string, input: { code: string }) => ({ ...input }) as unknown as Material),
    update: jest.fn(async () => ({ code: 'VT-1', kind: 'STOCK' }) as unknown as Material),
    hasStockFootprint: jest.fn(async () => false),
    hasTrackingFootprint: jest.fn(async () => false),
    changeTrackingMode: jest.fn(async () => undefined),
    unserializedStock: jest.fn(async () => []),
  };
  const settings = {
    get: jest.fn(async (_tenantId: string, key: string): Promise<SettingsEntry<unknown> | null> =>
      stored[key]
        ? { key, value: stored[key], version: 1, updatedAt: new Date(0).toISOString() }
        : null,
    ),
    put: jest.fn(async (_t: string, key: string, value: unknown): Promise<SettingsEntry<unknown> | null> => ({
      key,
      value,
      version: 2,
      updatedAt: new Date(0).toISOString(),
    })),
  };
  const store = { material, settings } as unknown as InventoryStore;
  return { app: new InventoryApplication(store, {} as StockDocumentStore), material, settings };
}

const base = { code: 'vt-1', name: 'Vòng bi', category: 'SPARE_PART', unit: 'Cái' } as const;
const existing = (patch: Partial<Material> = {}) =>
  ({ code: 'VT-1', kind: 'STOCK', isActive: true, minStock: 0, maxStock: 0, trackingMode: 'NONE', isSerialized: false, ...patch }) as unknown as Material;

describe('InventoryApplication cách theo dõi: tạo mặt hàng', () => {
  it('chọn LOT: lưu trackingMode LOT, is_serialized false', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, trackingMode: 'LOT' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ code: 'VT-1', trackingMode: 'LOT', isSerialized: false }),
      'Hải',
      undefined,
    );
  });

  it('chọn SERIAL: lưu trackingMode SERIAL, is_serialized true', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, trackingMode: 'SERIAL' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ trackingMode: 'SERIAL', isSerialized: true }),
      'Hải',
      undefined,
    );
  });

  it('chọn LOT và SERIAL được ngay, không cần bật gì ở Cài đặt (cách theo dõi là thuộc tính của từng mặt hàng)', async () => {
    const { app, material, settings } = setup();
    await app.createMaterial(manager, { ...base, trackingMode: 'LOT' });
    await app.createMaterial(manager, { ...base, code: 'vt-2', trackingMode: 'SERIAL' });
    expect(settings.get).not.toHaveBeenCalled();
    expect(material.create).toHaveBeenCalledTimes(2);
  });

  it('NONE chọn được và không đọc cài đặt nào', async () => {
    const { app, material, settings } = setup();
    await app.createMaterial(manager, { ...base, trackingMode: 'NONE' });
    expect(settings.get).not.toHaveBeenCalled();
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ trackingMode: 'NONE', isSerialized: false }),
      'Hải',
      undefined,
    );
  });

  it('không gửi gì và không suy từ nhóm: vật tư tiêu hao vẫn NONE', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, category: 'CONSUMABLE' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ trackingMode: 'NONE', isSerialized: false }),
      'Hải',
      undefined,
    );
  });

  it('đường cũ chỉ gửi isSerialized: SERIAL, giữ nguyên hành vi nhập từ hệ cũ', async () => {
    const { app, material, settings } = setup();
    await app.createMaterial(manager, { ...base, isSerialized: true });
    expect(settings.get).not.toHaveBeenCalled();
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ trackingMode: 'SERIAL', isSerialized: true }),
      'Hải',
      undefined,
    );
  });

  it('trackingMode và isSerialized lệch nhau thì từ chối', async () => {
    const { app } = setup();
    await expect(app.createMaterial(manager, { ...base, trackingMode: 'LOT', isSerialized: true })).rejects.toThrow(
      'không khớp',
    );
  });

  it('trackingMode ngoài ba giá trị thì từ chối', async () => {
    const { app } = setup();
    await expect(app.createMaterial(manager, { ...base, trackingMode: 'LOT_AND_SERIAL' as never })).rejects.toThrow(
      'Cách theo dõi phải là một trong',
    );
  });

  it('dịch vụ luôn NONE; chọn LOT cho dịch vụ thì từ chối', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, kind: 'SERVICE' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ trackingMode: 'NONE', isSerialized: false }),
      'Hải',
      undefined,
    );
    await expect(app.createMaterial(manager, { ...base, code: 'dv-2', kind: 'SERVICE', trackingMode: 'LOT' })).rejects.toThrow(
      'Mặt hàng dịch vụ không theo dõi lô hoặc serial.',
    );
  });
});

describe('InventoryApplication cách theo dõi: đổi cách theo dõi của mặt hàng', () => {
  it('đã có tồn, chứng từ, lô hay serial thì từ chối và không đổi gì', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(existing());
    material.hasTrackingFootprint.mockResolvedValue(true);
    await expect(app.updateMaterial(manager, 'VT-1', { trackingMode: 'LOT' })).rejects.toThrow(
      'Mã VT-1 đã có tồn, bút toán, chứng từ, giữ hàng, lô hoặc serial; không đổi được cách theo dõi.',
    );
    expect(material.changeTrackingMode).not.toHaveBeenCalled();
    expect(material.update).not.toHaveBeenCalled();
  });

  it('chưa có dấu vết thì đổi và ghi lịch sử (người đổi, lý do)', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(existing());
    await app.updateMaterial(manager, 'VT-1', { trackingMode: 'LOT', trackingChangeReason: 'Khai nhầm' });
    expect(material.changeTrackingMode).toHaveBeenCalledWith('t1', 'VT-1', {
      from: 'NONE',
      to: 'LOT',
      changedBy: 'u1',
      reason: 'Khai nhầm',
    });
  });

  it('đổi sang LOT được ngay khi chưa có dấu vết, không cần bật gì ở Cài đặt', async () => {
    const { app, material, settings } = setup();
    material.findAnyByCode.mockResolvedValue(existing());
    await app.updateMaterial(manager, 'VT-1', { trackingMode: 'LOT' });
    expect(settings.get).not.toHaveBeenCalled();
    expect(material.changeTrackingMode).toHaveBeenCalledWith(
      't1',
      'VT-1',
      expect.objectContaining({ from: 'NONE', to: 'LOT' }),
    );
  });

  it('gửi lại đúng cách theo dõi hiện tại: không kiểm dấu vết, không ghi lịch sử', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(existing({ trackingMode: 'LOT' }));
    await app.updateMaterial(manager, 'VT-1', { trackingMode: 'LOT', name: 'Tên mới' });
    expect(material.hasTrackingFootprint).not.toHaveBeenCalled();
    expect(material.changeTrackingMode).not.toHaveBeenCalled();
    expect(material.update).toHaveBeenCalled();
  });

  it('đổi nhóm không đổi cách theo dõi', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(existing({ trackingMode: 'LOT', category: 'SPARE_PART' }));
    await app.updateMaterial(manager, 'VT-1', { category: 'CONSUMABLE' });
    expect(material.changeTrackingMode).not.toHaveBeenCalled();
    expect(material.update).toHaveBeenCalledWith('t1', 'VT-1', { category: 'CONSUMABLE' });
  });

  it('đường cũ: bật isSerialized thành SERIAL, vẫn bị chặn khi đã có dấu vết, ', async () => {
    const { app, material, settings } = setup();
    material.findAnyByCode.mockResolvedValue(existing());
    await app.updateMaterial(manager, 'VT-1', { isSerialized: true });
    expect(settings.get).not.toHaveBeenCalled();
    expect(material.changeTrackingMode).toHaveBeenCalledWith(
      't1',
      'VT-1',
      expect.objectContaining({ from: 'NONE', to: 'SERIAL' }),
    );

    material.changeTrackingMode.mockClear();
    material.hasTrackingFootprint.mockResolvedValue(true);
    await expect(app.updateMaterial(manager, 'VT-1', { isSerialized: true })).rejects.toThrow('không đổi được cách theo dõi');
    expect(material.changeTrackingMode).not.toHaveBeenCalled();
  });

  it('đổi sang dịch vụ đưa cách theo dõi về NONE và ghi lịch sử', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(existing({ trackingMode: 'LOT' }));
    await app.updateMaterial(manager, 'VT-1', { kind: 'SERVICE' });
    expect(material.changeTrackingMode).toHaveBeenCalledWith(
      't1',
      'VT-1',
      expect.objectContaining({ from: 'LOT', to: 'NONE' }),
    );
  });

  it('khai serial cho mặt hàng đang theo lô thì từ chối (lô và serial loại trừ nhau)', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue(existing({ trackingMode: 'LOT' }));
    await expect(
      app.registerSerials(manager, { materialCode: 'vt-1', serialNumbers: ['SN1'] }),
    ).rejects.toThrow('đang theo dõi theo lô nên không khai serial');
  });
});

describe('InventoryApplication cách theo dõi: không còn công tắc toàn tenant', () => {
  it.each(['tracking.lot.enabled', 'tracking.serial.enabled'])('khoá cũ %s bị từ chối như khoá lạ', async (key) => {
    const { app, settings } = setup();
    await expect(app.updateSetting(manager, key as never, { value: { enabled: true } })).rejects.toThrow();
    expect(settings.put).not.toHaveBeenCalled();
  });
});
