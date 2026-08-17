import { Module, DynamicModule } from '@nestjs/common';
import { InventoryApplication } from './application/inventory.application';
import { InventoryController } from './presentation/inventory.controller';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store';
import { INVENTORY_STORE } from './application/inventory-store.port';

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
          useFactory: () => {
            return new PostgresInventoryStore(databaseUrl);
          },
        },
      ],
      exports: [InventoryApplication, INVENTORY_STORE],
    };
  }
}
