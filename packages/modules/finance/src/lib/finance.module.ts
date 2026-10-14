import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { FinanceApplication } from './application/finance.application.js';
import { FINANCE_STORAGE, createFinanceStorage } from './infrastructure/attachments.store.js';
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
    { provide: FINANCE_STORAGE, useFactory: createFinanceStorage },
    {
      provide: FinanceApplication,
      useFactory: (database: FinanceDatabase, storage: ReturnType<typeof createFinanceStorage>) => new FinanceApplication(database, storage),
      inject: [FinanceDatabase, FINANCE_STORAGE],
    },
  ],
  exports: [FinanceApplication, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class FinanceModule {}
