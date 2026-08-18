import { InventoryModule } from '@enterprise-platform/module-inventory';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { InventoryAccessGuard } from './inventory-access.guard';

@Module({
  imports: [InventoryModule],
  providers: [{ provide: APP_GUARD, useClass: InventoryAccessGuard }],
})
export class InventoryApiModule {}
