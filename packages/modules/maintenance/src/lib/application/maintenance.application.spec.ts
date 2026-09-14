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
