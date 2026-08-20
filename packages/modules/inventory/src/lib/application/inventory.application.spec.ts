import { InventoryApplication } from './inventory.application.js';
import type { InventoryActor, InventoryStore } from './inventory-store.port.js';

describe('InventoryApplication and Validation Logic', () => {
  let app: InventoryApplication;
  let mockStore: jest.Mocked<InventoryStore>;

  const adminActor: InventoryActor = {
    tenantId: 'minh-long',
    userId: 'u3333333-3333-4333-8333-333333333333',
    displayName: 'Quản trị Minh Long',
    canRead: true,
    canManage: true,
    canAdjust: true,
  };

  beforeEach(() => {
    mockStore = {
      workspace: jest.fn(),
      createWarehouse: jest.fn(),
      createItem: jest.fn(),
      createAsset: jest.fn(),
      updateAssetSpecs: jest.fn(),
      uploadAssetDocument: jest.fn(),
      createMaintenanceEvent: jest.fn(),
      createMaintenanceProcedure: jest.fn(),
      deleteAsset: jest.fn(),
      getAssetStatuses: jest.fn(),
      createAssetStatus: jest.fn(),
      importStock: jest.fn(),
      exportStock: jest.fn(),
    };
    app = new InventoryApplication(mockStore);
  });

  describe('Import Stock (Nhập kho)', () => {
    it('cho phép nhập kho với vật tư đã có sẵn (itemId)', async () => {
      const payload = {
        receiptNo: 'NK-001',
        warehouseId: 'wh-1',
        lines: [{ itemId: 'item-1', quantity: 10, unitCost: 100000 }],
      };

      await app.importStock(adminActor, payload);
      expect(mockStore.importStock).toHaveBeenCalledWith('minh-long', adminActor.userId, payload);
    });

    it('cho phép nhập kho với phụ tùng mới hoàn toàn (newItem)', async () => {
      const payload = {
        receiptNo: 'NK-002',
        warehouseId: 'wh-1',
        sourceOrigin: 'Nhà cung cấp Siemens',
        lines: [
          {
            newItem: {
              code: 'VT-NEW-01',
              name: 'Van điện từ 24VDC',
              uomCode: 'Bộ',
              category: 'SPARE_PART',
              manufacturer: 'Siemens',
              minStock: 2,
            },
            quantity: 5,
            unitCost: 500000,
          },
        ],
      };

      await app.importStock(adminActor, payload);
      expect(mockStore.importStock).toHaveBeenCalledWith('minh-long', adminActor.userId, payload);
    });

    it('báo lỗi nếu số lượng nhập <= 0 hoặc không hợp lệ', async () => {
      const payload = {
        receiptNo: 'NK-003',
        warehouseId: 'wh-1',
        lines: [{ itemId: 'item-1', quantity: 0 }],
      };

      expect(() => app.importStock(adminActor, payload)).toThrow('Phiếu phải có dòng vật tư hợp lệ với số lượng lớn hơn 0.');
    });

    it('báo lỗi nếu không có cả itemId và newItem', async () => {
      const payload = {
        receiptNo: 'NK-004',
        warehouseId: 'wh-1',
        lines: [{ quantity: 5 } as any],
      };

      expect(() => app.importStock(adminActor, payload)).toThrow('Phiếu phải có dòng vật tư hợp lệ với số lượng lớn hơn 0.');
    });
  });

  describe('Export Stock (Xuất kho)', () => {
    it('cho phép xuất kho khi đủ thông tin và số lượng hợp lệ', async () => {
      const payload = {
        issueNo: 'XK-001',
        warehouseId: 'wh-1',
        destination: 'Gian máy tổ H1',
        referenceType: 'WORK_ORDER',
        referenceId: 'WO-2026-01',
        lines: [{ itemId: 'item-1', quantity: 2 }],
      };

      await app.exportStock(adminActor, payload);
      expect(mockStore.exportStock).toHaveBeenCalledWith('minh-long', adminActor.userId, payload);
    });

    it('báo lỗi khi số lượng xuất <= 0', async () => {
      const payload = {
        issueNo: 'XK-002',
        warehouseId: 'wh-1',
        destination: 'Gian máy tổ H1',
        lines: [{ itemId: 'item-1', quantity: -1 }],
      };

      expect(() => app.exportStock(adminActor, payload)).toThrow('Phiếu phải có dòng vật tư hợp lệ với số lượng lớn hơn 0.');
    });

    it('báo lỗi phân quyền khi actor không có quyền canAdjust', async () => {
      const readonlyActor: InventoryActor = {
        ...adminActor,
        canAdjust: false,
        canManage: false,
      };

      const payload = {
        issueNo: 'XK-003',
        warehouseId: 'wh-1',
        destination: 'Gian máy tổ H1',
        lines: [{ itemId: 'item-1', quantity: 1 }],
      };

      expect(() => app.exportStock(readonlyActor, payload)).toThrow('Bạn không có quyền nhập/xuất kho.');
    });
  });

  describe('Create Asset (Tạo tài sản / Nhà máy / Phân cấp linh hoạt)', () => {
    it('cho phép tạo tài sản với các loại phân cấp linh hoạt (PLANT, AREA, SYSTEM, SUBSYSTEM, EQUIPMENT, ASSEMBLY, COMPONENT, PART, CUSTOM)', async () => {
      const payload = {
        code: 'AREA-01',
        name: 'Gian máy chính',
        type: 'AREA',
        criticality: 'HIGH' as const,
        specs: { DienTich: '500m2' },
      };

      await app.createAsset(adminActor, payload);
      expect(mockStore.createAsset).toHaveBeenCalledWith('minh-long', payload);
    });

    it('báo lỗi khi thiếu mã, tên hoặc loại phân cấp', async () => {
      const invalidPayload = {
        code: '',
        name: 'Nhà máy',
        type: 'PLANT',
      };

      expect(() => app.createAsset(adminActor, invalidPayload)).toThrow('Các trường bắt buộc chưa đầy đủ.');
    });

    it('báo lỗi khi độ quan trọng không hợp lệ', async () => {
      const invalidPayload = {
        code: 'EQ-01',
        name: 'Máy phát',
        type: 'EQUIPMENT',
        criticality: 'INVALID_CRITICALITY' as any,
      };

      expect(() => app.createAsset(adminActor, invalidPayload)).toThrow('Độ quan trọng của tài sản không hợp lệ.');
    });
  });

  describe('Delete Asset (Xóa tài sản / Đơn vị con)', () => {
    it('cho phép người quản trị xóa tài sản theo ID', async () => {
      mockStore.deleteAsset.mockResolvedValue({ deletedIds: ['asset-1', 'asset-1-sub'] });
      const result = await app.deleteAsset(adminActor, 'asset-1');
      expect(mockStore.deleteAsset).toHaveBeenCalledWith('minh-long', 'asset-1');
      expect(result.deletedIds).toEqual(['asset-1', 'asset-1-sub']);
    });

    it('báo lỗi khi không truyền ID', async () => {
      expect(() => app.deleteAsset(adminActor, '')).toThrow('Các trường bắt buộc chưa đầy đủ.');
    });
  });

  describe('Asset Statuses (Danh mục trạng thái tài sản động)', () => {
    it('cho phép đọc danh sách trạng thái', async () => {
      mockStore.getAssetStatuses.mockResolvedValue([
        { code: 'OPERATING', name: 'Đang chạy', color: '#10b981' },
      ]);
      const result = await app.getAssetStatuses(adminActor);
      expect(mockStore.getAssetStatuses).toHaveBeenCalledWith('minh-long');
      expect(result).toHaveLength(1);
    });

    it('cho phép tạo mới trạng thái tài sản', async () => {
      const payload = { code: 'CUSTOM_ST', name: 'Trạng thái tùy chỉnh', color: '#8b5cf6' };
      mockStore.createAssetStatus.mockResolvedValue({ ...payload, isSystem: false });
      const result = await app.createAssetStatus(adminActor, payload);
      expect(mockStore.createAssetStatus).toHaveBeenCalledWith('minh-long', payload);
      expect(result.code).toBe('CUSTOM_ST');
    });
  });
});
