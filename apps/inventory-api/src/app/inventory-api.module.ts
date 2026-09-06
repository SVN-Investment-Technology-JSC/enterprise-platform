import { InventoryModule } from '@enterprise-platform/module-inventory';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { InventoryAccessGuard } from './inventory-access.guard';
import { HealthController } from './health.controller';
import { InventoryDataImportController } from './inventory-data-import.controller';

@Module({
  imports: [InventoryModule],
  controllers: [HealthController, InventoryDataImportController],
  providers: [{ provide: APP_GUARD, useClass: InventoryAccessGuard }],
})
export class InventoryApiModule {}
