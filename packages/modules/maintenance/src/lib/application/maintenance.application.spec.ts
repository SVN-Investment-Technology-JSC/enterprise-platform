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
