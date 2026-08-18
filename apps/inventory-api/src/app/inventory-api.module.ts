import { Module } from '@nestjs/common';
import { InventoryModule } from '@enterprise-platform/module-inventory';

@Module({
  imports: [
    InventoryModule.register(
      process.env.DATABASE_URL || 'postgresql://tenant:tenant@localhost:55435/minhlong'
    ),
  ],
})
export class InventoryApiModule {}
