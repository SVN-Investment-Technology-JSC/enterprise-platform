import { DynamicModule, Module } from '@nestjs/common';
import { InventoryApplication } from './application/inventory.application.js';
import { INVENTORY_STORE } from './application/inventory-store.port.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { InventoryController } from './presentation/inventory.controller.js';

@Module({})
export class InventoryModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: InventoryModule,
      controllers: [InventoryController],
      providers: [
        InventoryApplication,
        {
          provide: INVENTORY_STORE,
          useFactory: () => new PostgresInventoryStore(databaseUrl),
        },
      ],
      exports: [InventoryApplication, INVENTORY_STORE],
    };
  }
}
