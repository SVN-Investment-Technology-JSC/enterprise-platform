export interface NotificationMaintenancePort {
  listActiveTenantIds(): Promise<readonly string[]>;
  maintain(tenantId: string, options: { schedule: boolean; cleanup: boolean }, now: Date): Promise<void | boolean>;
}

export class NotificationMaintenanceLoop {
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private readonly nextRuns = new Map<string, { schedule: number; cleanup: number }>();
  constructor(
    private readonly tenants: NotificationMaintenancePort,
    private readonly onError: (error: unknown, tenantId?: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const run = async () => {
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(() => void run(), 500);
    };
    void run();
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runTick().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async runTick(): Promise<void> {
    const now = this.now();
    try {
      const ids = await this.tenants.listActiveTenantIds();
      const active = new Set(ids);
      for (const tenantId of this.nextRuns.keys()) if (!active.has(tenantId)) this.nextRuns.delete(tenantId);
      for (const tenantId of ids) {
        const next = this.nextRuns.get(tenantId) ?? { schedule: 0, cleanup: 0 };
        const options = { schedule: now.getTime() >= next.schedule, cleanup: now.getTime() >= next.cleanup };
        try {
          if (await this.tenants.maintain(tenantId, options, now) === false) continue;
          this.nextRuns.set(tenantId, {
            schedule: options.schedule ? now.getTime() + 30_000 : next.schedule,
            cleanup: options.cleanup ? now.getTime() + 60 * 60_000 : next.cleanup,
          });
        }
        catch (error) { this.onError(error, tenantId); }
      }
    } catch (error) { this.onError(error); }
  }
}
