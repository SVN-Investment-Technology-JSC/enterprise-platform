import { Module } from '@nestjs/common';
import { InventoryEngineModule } from '@enterprise-platform/module-inventory';

@Module({
  imports: [
    InventoryEngineModule.register(
      process.env.DATABASE_URL || 'postgresql://tenant:tenant@localhost:55435/minhlong'
    ),
  ],
})
export class InventoryApiModule {}
