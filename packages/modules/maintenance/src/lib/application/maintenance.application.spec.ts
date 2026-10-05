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
