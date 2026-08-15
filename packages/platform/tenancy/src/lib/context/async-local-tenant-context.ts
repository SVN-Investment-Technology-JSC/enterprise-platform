import type { TenantRequestContext } from '@enterprise-platform/contracts-tenancy';
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContextAccessor {
  get(): TenantRequestContext | undefined;
  getRequired(): TenantRequestContext;
  run<TValue>(context: TenantRequestContext, operation: () => TValue): TValue;
}

@Injectable()
export class AsyncLocalTenantContext implements TenantContextAccessor {
  private readonly storage = new AsyncLocalStorage<TenantRequestContext>();

  get(): TenantRequestContext | undefined {
    return this.storage.getStore();
  }

  getRequired(): TenantRequestContext {
    const context = this.get();

    if (!context) {
      throw new Error('Tenant context is not available for this execution.');
    }

    return context;
  }

  run<TValue>(context: TenantRequestContext, operation: () => TValue): TValue {
    return this.storage.run(context, operation);
  }
}
