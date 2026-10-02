import { NotificationMaintenanceLoop } from './notification-maintenance';

describe('periodic notification maintenance', () => {
  it('retries a busy or failed tenant on the next tick without repeating a healthy tenant schedule scan', async () => {
    let time = new Date('2026-10-02T00:00:00Z');
    const maintain = jest.fn().mockImplementation(async (id: string) => id !== 'busy');
    const loop = new NotificationMaintenanceLoop({ listActiveTenantIds: async () => ['busy', 'healthy'], maintain }, jest.fn(), () => time);
    await loop.tick();
    time = new Date(time.getTime() + 1000);
    await loop.tick();
    expect(maintain.mock.calls.at(-2)).toEqual(['busy', { schedule: true, cleanup: true }, time]);
    expect(maintain.mock.calls.at(-1)).toEqual(['healthy', { schedule: false, cleanup: false }, time]);
  });
  it('drains deliveries without a domain event and scans schedules and retention at separate intervals', async () => {
    let time = new Date('2026-10-02T00:00:00Z');
    const maintain = jest.fn().mockResolvedValue(undefined);
    const tenants = { listActiveTenantIds: async () => ['tenant-a'], maintain };
    const loop = new NotificationMaintenanceLoop(tenants, jest.fn(), () => time);
    await loop.tick();
    expect(maintain).toHaveBeenLastCalledWith('tenant-a', { schedule: true, cleanup: true }, time);
    time = new Date(time.getTime() + 1000);
    await loop.tick();
    expect(maintain).toHaveBeenLastCalledWith('tenant-a', { schedule: false, cleanup: false }, time);
    time = new Date(time.getTime() + 30000);
    await loop.tick();
    expect(maintain).toHaveBeenLastCalledWith('tenant-a', { schedule: true, cleanup: false }, time);
  });

  it('does not overlap ticks or let one tenant failure prevent another tenant from draining', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const maintain = jest.fn().mockImplementation(async (id: string) => {
      if (id === 'tenant-a') { await blocked; throw new Error('Broker unavailable'); }
    });
    const onError = jest.fn();
    const loop = new NotificationMaintenanceLoop({ listActiveTenantIds: async () => ['tenant-a', 'tenant-b'], maintain }, onError);
    const first = loop.tick();
    await Promise.resolve();
    const second = loop.tick();
    finish();
    await Promise.all([first, second]);
    expect(maintain.mock.calls.map(([id]) => id)).toEqual(['tenant-a', 'tenant-b']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'tenant-a');
  });
});
