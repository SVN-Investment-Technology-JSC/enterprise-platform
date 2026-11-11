import type { MaintenanceStore } from './maintenance-store.port.js';
import { MaintenanceApplication } from './maintenance.application.js';

describe('MaintenanceApplication', () => {
  it('computes dashboard metrics from the normalized snapshot', async () => {
    const store = { read: jest.fn().mockResolvedValue({ assets: [], jobPlans: [], schedules: [], occurrences: [], procedureCatalog: [] }) } as unknown as MaintenanceStore;
    const app = new MaintenanceApplication(store);
    const workspace = await app.workspace({ tenantId: 'tenant', userId: 'user', displayName: 'Admin', canManage: true });
    expect(workspace.metrics.activeSchedules).toBe(0);
    expect(workspace.permissions.canManageSchedules).toBe(true);
  });

  it('rejects an unknown incident priority with a validation error instead of reaching the database', async () => {
    const createIncident = jest.fn().mockResolvedValue({ id: 'incident-1' });
    const store = { createIncident } as unknown as MaintenanceStore;
    const app = new MaintenanceApplication(store);
    const actor = { tenantId: 'tenant', userId: 'user', displayName: 'Admin', canManage: true };

    await expect(
      app.createIncident(actor, { assetCode: 'TN-MEGGER', title: 'Sự cố', priority: 'high' as never }),
    ).rejects.toMatchObject({ name: 'MaintenanceError' });
    expect(createIncident).not.toHaveBeenCalled();

    await app.createIncident(actor, { assetCode: 'TN-MEGGER', title: 'Sự cố', priority: 'High' });
    expect(createIncident).toHaveBeenCalledTimes(1);
  });

  describe('dashboard cards của từng người', () => {
    const actor = { tenantId: 'tenant', userId: 'user-1', displayName: 'Người dùng', canManage: false };

    it('trả null khi người dùng chưa tuỳ chỉnh', async () => {
      const store = { getUserPreference: jest.fn().mockResolvedValue(undefined) } as unknown as MaintenanceStore;
      await expect(new MaintenanceApplication(store).getMyDashboardCards(actor)).resolves.toEqual({ cardIds: null });
    });

    it('chuẩn hoá danh sách trước khi ghi, không cần quyền quản lý', async () => {
      const setUserPreference = jest.fn().mockResolvedValue(undefined);
      const store = { setUserPreference } as unknown as MaintenanceStore;
      const result = await new MaintenanceApplication(store).setMyDashboardCards(actor, {
        cardIds: ['metric.upcoming', ' metric.upcoming ', 7, 'list.priority'],
      });
      expect(result.cardIds).toEqual(['metric.upcoming', 'list.priority']);
      expect(setUserPreference).toHaveBeenCalledWith('tenant', 'user-1', 'dashboard.cards', {
        cardIds: ['metric.upcoming', 'list.priority'],
      });
    });

    it('cardIds null xoá tuỳ chỉnh; kiểu sai bị từ chối', async () => {
      const deleteUserPreference = jest.fn().mockResolvedValue(undefined);
      const app = new MaintenanceApplication({ deleteUserPreference } as unknown as MaintenanceStore);
      await expect(app.setMyDashboardCards(actor, { cardIds: null })).resolves.toEqual({ cardIds: null });
      expect(deleteUserPreference).toHaveBeenCalledWith('tenant', 'user-1', 'dashboard.cards');
      await expect(app.setMyDashboardCards(actor, { cardIds: 'x' })).rejects.toMatchObject({ name: 'MaintenanceError' });
    });
  });

  describe('ma trận: lịch nháp, tạm dừng và bật lại', () => {
    const actor = { tenantId: 'tenant', userId: 'user', displayName: 'Admin', canManage: true };
    const schedule = (overrides: Record<string, unknown>) => ({
      id: 'sch-1',
      code: 'SCH-1',
      title: 'Bảo trì MBA-T1',
      assetCode: 'MBA-T1',
      frequency: 'week',
      priority: 'Normal',
      status: 'active',
      startDate: '2026-01-01',
      timezone: 'Asia/Ho_Chi_Minh',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('lịch nháp (thiết bị vừa thêm từ Kho) không được tick sẵn', async () => {
      const store = {
        read: jest.fn().mockResolvedValue({
          assets: [], jobPlans: [], occurrences: [], procedureCatalog: [],
          schedules: [schedule({ status: 'draft' }), schedule({ id: 'sch-2', frequency: 'month', status: 'active' })],
        }),
      } as unknown as MaintenanceStore;
      const matrix = await new MaintenanceApplication(store).getMatrix(actor);
      expect(Object.keys(matrix.rows[0].cells)).toEqual(['month']);
    });

    it('bật lại lịch tạm dừng thì truyền ngày bắt đầu người dùng chọn', async () => {
      const updateSchedule = jest.fn().mockResolvedValue({});
      const store = {
        read: jest.fn().mockResolvedValue({
          assets: [], jobPlans: [], occurrences: [], procedureCatalog: [],
          schedules: [schedule({ status: 'paused' })],
        }),
        updateSchedule,
      } as unknown as MaintenanceStore;
      await new MaintenanceApplication(store).saveMatrix(actor, {
        entries: [{ assetCode: 'MBA-T1', frequencies: ['week'], startDates: { week: '2026-11-20' } }],
      });
      expect(updateSchedule).toHaveBeenCalledWith('tenant', 'sch-1', { status: 'active' }, { nextDueAt: '2026-11-20' });
    });

    it('giao người phụ trách: lịch mới tạo mang theo người đó, lịch đang chạy được cập nhật khi đổi', async () => {
      const createSchedule = jest.fn().mockResolvedValue({});
      const updateSchedule = jest.fn().mockResolvedValue({});
      const store = {
        read: jest.fn().mockResolvedValue({
          assets: [], jobPlans: [], occurrences: [], procedureCatalog: [],
          schedules: [schedule({ status: 'active', assigneeId: 'u-old', assigneeName: 'Cũ' })],
        }),
        createSchedule,
        updateSchedule,
      } as unknown as MaintenanceStore;
      await new MaintenanceApplication(store).saveMatrix(actor, {
        entries: [
          {
            assetCode: 'MBA-T1',
            frequencies: ['week', 'month'],
            assigneeId: 'u-new',
            assigneeName: 'Mới',
            startDates: { month: '2026-12-01' },
          },
        ],
      });
      expect(createSchedule).toHaveBeenCalledWith('tenant', expect.objectContaining({ frequency: 'month', assigneeId: 'u-new', assigneeName: 'Mới' }));
      expect(updateSchedule).toHaveBeenCalledWith('tenant', 'sch-1', { assigneeId: 'u-new', assigneeName: 'Mới' }, undefined);
    });

    it('không gửi assigneeId (client cũ) thì giữ nguyên người phụ trách; gửi null là bỏ', async () => {
      const updateSchedule = jest.fn().mockResolvedValue({});
      const store = {
        read: jest.fn().mockResolvedValue({
          assets: [], jobPlans: [], occurrences: [], procedureCatalog: [],
          schedules: [schedule({ status: 'active', assigneeId: 'u-old', assigneeName: 'Cũ' })],
        }),
        updateSchedule,
      } as unknown as MaintenanceStore;
      const app = new MaintenanceApplication(store);
      await app.saveMatrix(actor, { entries: [{ assetCode: 'MBA-T1', frequencies: ['week'] }] });
      expect(updateSchedule).not.toHaveBeenCalled();
      await app.saveMatrix(actor, { entries: [{ assetCode: 'MBA-T1', frequencies: ['week'], assigneeId: null }] });
      expect(updateSchedule).toHaveBeenCalledWith('tenant', 'sch-1', { assigneeId: null, assigneeName: null }, undefined);
    });

    it('ma trận trả người phụ trách của thiết bị', async () => {
      const store = {
        read: jest.fn().mockResolvedValue({
          assets: [], jobPlans: [], occurrences: [], procedureCatalog: [],
          schedules: [schedule({ status: 'active', assigneeId: 'u1', assigneeName: 'Tài' })],
        }),
      } as unknown as MaintenanceStore;
      const matrix = await new MaintenanceApplication(store).getMatrix(actor);
      expect(matrix.rows[0]).toMatchObject({ assigneeId: 'u1', assigneeName: 'Tài' });
    });

    it('sửa ưu tiên của lịch đang chạy không đụng tới hạn', async () => {
      const updateSchedule = jest.fn().mockResolvedValue({});
      const store = {
        read: jest.fn().mockResolvedValue({
          assets: [], jobPlans: [], occurrences: [], procedureCatalog: [],
          schedules: [schedule({ status: 'active' })],
        }),
        updateSchedule,
      } as unknown as MaintenanceStore;
      await new MaintenanceApplication(store).saveMatrix(actor, {
        entries: [{ assetCode: 'MBA-T1', frequencies: ['week'], priority: 'High', startDates: { week: '2026-11-20' } }],
      });
      expect(updateSchedule).toHaveBeenCalledWith('tenant', 'sch-1', { priority: 'High' }, undefined);
    });
  });

  it('runs maintenance now for a specific frequency', async () => {
    const store = {
      markSchedulesDueNow: jest.fn().mockResolvedValue(1),
      generateDueOccurrences: jest.fn().mockResolvedValue(1),
    } as unknown as MaintenanceStore;
    const app = new MaintenanceApplication(store);
    const result = await app.runMaintenanceNow(
      { tenantId: 'tenant', userId: 'user', displayName: 'Admin', canManage: true },
      'MBA-T2',
      'year',
    );
    expect(store.markSchedulesDueNow).toHaveBeenCalledWith('tenant', 'MBA-T2', 'year');
    expect(store.generateDueOccurrences).toHaveBeenCalledTimes(1);
    expect(result.generated).toBe(1);
  });
});
