import { Module } from '@nestjs/common';
import {
  AsyncLocalTenantContext,
  TENANT_CONTEXT,
} from './context/async-local-tenant-context.js';

@Module({
  controllers: [],
  providers: [
    AsyncLocalTenantContext,
    {
      provide: TENANT_CONTEXT,
      useExisting: AsyncLocalTenantContext,
    },
  ],
  exports: [AsyncLocalTenantContext, TENANT_CONTEXT],
})
export class PlatformTenancyModule {}
