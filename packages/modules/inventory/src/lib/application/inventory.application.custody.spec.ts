import type { Asset, Material } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { StockDocumentStore } from './stock-document-store.port.js';

const stockKeeper: InventoryActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Thủ kho',
  canManage: false,
  canWriteTransactions: true,
};
const reader: InventoryActor = { ...stockKeeper, canWriteTransactions: false };
const manager: InventoryActor = { ...stockKeeper, canManage: true };

const EMP_A = '00000000-0000-4000-8000-0000000000a1';
const EMP_B = '00000000-0000-4000-8000-0000000000b2';

const material = (patch: Partial<Material> = {}): Material =>
  ({
    id: 'm1',
    code: 'TS-001',
    name: 'Laptop Dell',
    kind: 'STOCK',
    isActive: true,
    status: 'OPERATING',
    assetCategory: 'IT_OFFICE',
    ...patch,
  }) as unknown as Material;

function setup(found: Material | null, assignResult: Material | null | 'echo' = 'echo') {
  const custody = {
    find: jest.fn(async () => found),
    assign: jest.fn(async (_t: string, _c: string, employeeId: string | null) =>
      assignResult === 'echo' ? { ...(found ?? material()), assignedEmployeeId: employeeId ?? undefined } : assignResult,
    ),
    listAssignable: jest.fn(async () => (found ? [found] : [])),
    listByEmployee: jest.fn(async () => (found ? [found] : [])),
    listAssigned: jest.fn(async () => []),
  };
  const asset = {
    findAnyByCode: jest.fn(async () => ({ id: 'm1' })),
    countChildren: jest.fn(async () => 0),
    update: jest.fn(async () => ({ code: 'TS-001' }) as unknown as Asset),
  };
  const store = { custody, asset } as unknown as InventoryStore;
  return { app: new InventoryApplication(store, {} as StockDocumentStore), custody, asset };
}

describe('InventoryApplication cấp phát tài sản cho nhân sự', () => {
  it('cấp tài sản đang hoạt động, chưa có người giữ', async () => {
    const { app, custody } = setup(material());
    await app.assignCustody(stockKeeper, 'TS-001', EMP_A);
    expect(custody.assign).toHaveBeenCalledWith('t1', 'TS-001', EMP_A);
  });

  it('từ chối người chỉ đọc', async () => {
    const { app, custody } = setup(material());
    await expect(app.assignCustody(reader, 'TS-001', EMP_A)).rejects.toThrow('quyền');
    expect(custody.assign).not.toHaveBeenCalled();
  });

  it('không cấp đè lên người khác, nêu rõ cần thu hồi trước', async () => {
    const { app, custody } = setup(material({ assignedEmployeeId: EMP_B }));
    await expect(app.assignCustody(stockKeeper, 'TS-001', EMP_A)).rejects.toMatchObject({
      code: 'CUSTODY_ALREADY_ASSIGNED',
      statusCode: 409,
    });
    expect(custody.assign).not.toHaveBeenCalled();
  });

  it.each(['MAINTENANCE', 'STOPPED', 'DISPOSED'])('không cấp tài sản đang ở trạng thái %s', async (status) => {
    const { app, custody } = setup(material({ status }));
    await expect(app.assignCustody(stockKeeper, 'TS-001', EMP_A)).rejects.toMatchObject({
      code: 'CUSTODY_ASSET_UNAVAILABLE',
    });
    expect(custody.assign).not.toHaveBeenCalled();
  });

  it('mã không phải tài sản thì báo không tìm thấy', async () => {
    const { app } = setup(null);
    await expect(app.assignCustody(stockKeeper, 'NOPE', EMP_A)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('cấp lại cho đúng người đang giữ không lỗi', async () => {
    const { app, custody } = setup(material({ assignedEmployeeId: EMP_A }));
    await app.assignCustody(stockKeeper, 'TS-001', EMP_A);
    expect(custody.assign).toHaveBeenCalled();
  });

  it('báo xung đột khi vừa bị đổi giữa lúc kiểm và ghi', async () => {
    const { app } = setup(material(), null);
    await expect(app.assignCustody(stockKeeper, 'TS-001', EMP_A)).rejects.toMatchObject({ code: 'CUSTODY_CONFLICT' });
  });

  it('thu hồi không đòi trạng thái hoạt động', async () => {
    const { app, custody } = setup(material({ status: 'MAINTENANCE', assignedEmployeeId: EMP_A }));
    await app.assignCustody(stockKeeper, 'TS-001', null);
    expect(custody.find).not.toHaveBeenCalled();
    expect(custody.assign).toHaveBeenCalledWith('t1', 'TS-001', null);
  });

  it('danh sách cho HRM là bản rút gọn, không lộ giá hay kho', async () => {
    const { app } = setup(
      material({ purchasePrice: 25_000_000, serialNumber: 'DL-1', assignedEmployeeId: EMP_A } as Partial<Material>),
    );
    const [item] = await app.listEmployeeCustodyAssets(stockKeeper, EMP_A);
    expect(item).toEqual({
      id: 'm1',
      code: 'TS-001',
      name: 'Laptop Dell',
      assetCategory: 'IT_OFFICE',
      serialNumber: 'DL-1',
      status: 'OPERATING',
      assignedEmployeeId: EMP_A,
      assignedAt: undefined,
    });
    expect(Object.keys(item)).not.toContain('purchasePrice');
  });
});

describe('InventoryApplication khóa tài sản đang cấp phát', () => {
  it('không đổi trạng thái sang bảo trì khi tài sản còn gán cho nhân sự', async () => {
    const { app, asset } = setup(material({ assignedEmployeeId: EMP_A }));
    await expect(app.updateAsset(stockKeeper, 'TS-001', { status: 'MAINTENANCE' })).rejects.toMatchObject({
      code: 'ASSET_IN_CUSTODY',
      statusCode: 409,
    });
    expect(asset.update).not.toHaveBeenCalled();
  });

  it('đổi trạng thái được sau khi đã thu hồi', async () => {
    const { app, asset } = setup(material());
    await app.updateAsset(stockKeeper, 'TS-001', { status: 'MAINTENANCE' });
    expect(asset.update).toHaveBeenCalled();
  });

  it('sửa thông tin khác (không đổi trạng thái) vẫn được khi đang gán', async () => {
    const { app, asset } = setup(material({ assignedEmployeeId: EMP_A }));
    await app.updateAsset(stockKeeper, 'TS-001', { name: 'Laptop Dell 5440' });
    expect(asset.update).toHaveBeenCalled();
  });

  it('không thanh lý tài sản đang gán', async () => {
    const { app, asset } = setup(material({ assignedEmployeeId: EMP_A }));
    await expect(app.retireAsset(manager, 'TS-001')).rejects.toMatchObject({ code: 'ASSET_IN_CUSTODY' });
    expect(asset.update).not.toHaveBeenCalled();
  });
});

describe('InventoryApplication khai báo tài sản ở tab Tài sản', () => {
  function declareSetup() {
    const create = jest.fn(async () => ({ code: 'TS-NEW-001' }) as unknown as Asset);
    const store = {
      asset: { findAnyByCode: jest.fn(async () => null), create },
      custody: { listAll: jest.fn(async () => [material(), material({ code: 'TS-002' })]) },
    } as unknown as InventoryStore;
    return { app: new InventoryApplication(store, {} as StockDocumentStore), create, store };
  }
  const input = { code: 'ts-new-001', name: 'Laptop Lenovo', type: 'EQUIPMENT' as const };

  it('chuyển nhóm tài sản xuống kho dữ liệu và viết hoa mã', async () => {
    const { app, create } = declareSetup();
    await app.createAsset(manager, { ...input, assetCategory: 'IT_OFFICE' });
    expect(create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ code: 'TS-NEW-001', assetCategory: 'IT_OFFICE' }),
      undefined,
    );
  });

  it('từ chối nhóm tài sản lạ trước khi ghi', async () => {
    const { app, create } = declareSetup();
    await expect(
      app.createAsset(manager, { ...input, assetCategory: 'SPACESHIP' as unknown as 'VEHICLE' }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: 'Nhóm tài sản không hợp lệ.' });
    expect(create).not.toHaveBeenCalled();
  });

  it('chỉ người có quyền quản lý khai báo được', async () => {
    const { app, create } = declareSetup();
    await expect(app.createAsset(stockKeeper, input)).rejects.toThrow('quyền');
    expect(create).not.toHaveBeenCalled();
  });

  it('sổ tài sản trả mọi tài sản của tenant', async () => {
    const { app, store } = declareSetup();
    const rows = await app.listCustodyAssets(stockKeeper);
    expect(rows).toHaveLength(2);
    expect(store.custody.listAll).toHaveBeenCalledWith('t1');
  });
});
