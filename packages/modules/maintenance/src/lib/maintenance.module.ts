import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MaintenanceApplication } from './application/maintenance.application.js';
import { MAINTENANCE_STORE, type MaintenanceStore } from './application/maintenance-store.port.js';
import { OccurrenceAttachmentService } from './application/occurrence-attachment.service.js';
import { HttpAssetDirectory } from './infrastructure/http-asset-directory.js';
import { PostgresMaintenanceStore } from './infrastructure/postgres-maintenance-store.js';
import { MaintenanceController } from './presentation/maintenance.controller.js';

@Injectable()
class MaintenanceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly app: MaintenanceApplication,
    private readonly databases: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    for (const database of this.databases.list()) {
      // Registry entries survive requests. Reauthorize scheduled work before
      // each tick so disabling/deleting a tenant also stops background work.
      const root = process.env.PLATFORM_TENANT_DATABASE_API_URL ?? process.env.PLATFORM_TENANT_DATABASE_URL ?? 'http://localhost:3333/api/platform/internal/v1/tenant-databases';
      try {
        const response = await fetch(`${root}/${encodeURIComponent(database.tenantId)}?moduleKey=maintenance`, {
          headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' }, signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          this.databases.unregister(database.tenantId);
          await this.pools.closeTenant(database.tenantId);
          continue;
        }
      } catch { continue; }
      try { await this.app.generateDueOccurrences(database.tenantId); }
      catch (error) { this.logger.warn(`Scheduler tenant ${database.tenantId}: ${error instanceof Error ? error.message : String(error)}`); }

      // Separate try: a reconcile failure must not stop the next tenant, and a
      // generate failure must not skip the reconcile.
      try {
        const recovered = await this.app.reconcileStuckDispatches(database.tenantId);
        if (recovered > 0) {
          this.logger.log(`Đã gửi lại ${recovered} occurrence kẹt cho tenant ${database.tenantId}.`);
        }
      } catch (error) {
        this.logger.warn(`Reconcile tenant ${database.tenantId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

@Module({
  controllers: [MaintenanceController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresMaintenanceStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) => new PostgresMaintenanceStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: MAINTENANCE_STORE, useExisting: PostgresMaintenanceStore },
    {
      provide: MaintenanceApplication,
      useFactory: (store: MaintenanceStore) =>
        new MaintenanceApplication(store, new HttpAssetDirectory()),
      inject: [MAINTENANCE_STORE],
    },
    OccurrenceAttachmentService,
    MaintenanceScheduler,
  ],
  exports: [MaintenanceApplication, OccurrenceAttachmentService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class MaintenanceModule {}
