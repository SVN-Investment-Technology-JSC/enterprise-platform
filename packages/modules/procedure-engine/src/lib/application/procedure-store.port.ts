import type { ProcedureSettingsEntry } from '@enterprise-platform/contracts-procedure-engine';
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
  /**
   * Cấu hình module nằm ngoài `ProcedureTenantState` một cách có chủ đích.
   *
   * State đó được ghi lại toàn bộ ở mỗi transaction runtime; nhét cấu hình vào
   * đó thì mỗi lần duyệt một bước cũng ghi đè cấu hình, và ngược lại.
   */
  listSettings(tenantId: string): Promise<ProcedureSettingsEntry<unknown>[]>;
  /**
   * Upsert kèm kiểm tra version. Trả `undefined` khi dòng đã tồn tại mà
   * `expectedVersion` không khớp — bên gọi biến nó thành 409 thay vì ghi đè im
   * lặng lên thay đổi của người khác.
   */
  putSetting(
    tenantId: string,
    key: string,
    value: unknown,
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<ProcedureSettingsEntry<unknown> | undefined>;
}

export interface ProcedureClock {
  now(): Date;
}

export interface ProcedureIdGenerator {
  next(): string;
}
