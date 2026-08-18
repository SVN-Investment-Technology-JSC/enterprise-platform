import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { InventoryApplication } from './application/inventory.application.js';
import { INVENTORY_STORE, type InventoryStore } from './application/inventory-store.port.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { InventoryController } from './presentation/inventory.controller.js';

@Module({
  controllers: [InventoryController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresInventoryStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresInventoryStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: INVENTORY_STORE, useExisting: PostgresInventoryStore },
    {
      provide: InventoryApplication,
      useFactory: (store: InventoryStore) => new InventoryApplication(store),
      inject: [INVENTORY_STORE],
    },
  ],
  exports: [InventoryApplication, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class InventoryModule {}
