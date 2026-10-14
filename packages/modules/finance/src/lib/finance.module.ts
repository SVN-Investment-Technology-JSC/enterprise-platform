import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { FinanceApplication } from './application/finance.application.js';
import { FinanceDatabase } from './infrastructure/finance.database.js';
import { FinanceController } from './presentation/finance.controller.js';

@Module({
  controllers: [FinanceController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: FinanceDatabase,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) => new FinanceDatabase(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    {
      provide: FinanceApplication,
      useFactory: (database: FinanceDatabase) => new FinanceApplication(database),
      inject: [FinanceDatabase],
    },
  ],
  exports: [FinanceApplication, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class FinanceModule {}
