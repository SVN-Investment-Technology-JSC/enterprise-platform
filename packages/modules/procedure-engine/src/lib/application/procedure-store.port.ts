import type {
  ProcedureDefinition,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';

export const PROCEDURE_STORE = Symbol('PROCEDURE_STORE');
export const PROCEDURE_CLOCK = Symbol('PROCEDURE_CLOCK');
export const PROCEDURE_ID_GENERATOR = Symbol('PROCEDURE_ID_GENERATOR');

export interface ProcedureTenantState {
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
  idempotency: Record<string, string>;
}

export interface ProcedureStore {
  read(tenantId: string): Promise<ProcedureTenantState>;
  transaction<TValue>(
    tenantId: string,
    operation: (state: ProcedureTenantState) => Promise<TValue> | TValue,
  ): Promise<TValue>;
}

export interface ProcedureClock {
  now(): Date;
}

export interface ProcedureIdGenerator {
  next(): string;
}
