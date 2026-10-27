import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { CRM_DIAGNOSTICS } from './application/crm-store.port.js';
import { CrmDataScopeService } from './application/data-scope.js';
import {
  REPORTING_LINE_READER,
  type ReportingLineReader,
} from './application/organization-scope.port.js';
import { CrmDatabase } from './infrastructure/crm.database.js';
import { HttpOrganizationScope } from './infrastructure/http-organization-scope.js';
import { CrmController } from './presentation/crm.controller.js';

/**
 * Composition root của Bán hàng.
 *
 * Dựng tường minh bằng `useFactory` như `SharedModule`: các lớp là lớp thường,
 * không gắn `@Injectable`. Export hai registry để guard của app đăng ký
 * database của tenant sau mỗi access-decision.
 */
@Module({
  controllers: [CrmController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: CrmDatabase,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new CrmDatabase(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: CRM_DIAGNOSTICS, useExisting: CrmDatabase },
    {
      // Một thực thể cho cả app: bản sao 60 giây của cơ cấu tổ chức nằm trong nó.
      provide: REPORTING_LINE_READER,
      useFactory: () => new HttpOrganizationScope(),
    },
    {
      provide: CrmDataScopeService,
      useFactory: (reportingLines: ReportingLineReader) => new CrmDataScopeService(reportingLines),
      inject: [REPORTING_LINE_READER],
    },
  ],
  exports: [CrmDatabase, CrmDataScopeService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class CrmModule {}
