import type { CustomerGroup, CustomerKindOption } from '@enterprise-platform/contracts-crm';
import type {
  CustomerGroupRecord,
  CustomerGroupStore,
  CustomerKindRecord,
  CustomerKindStore,
  SettingsStore,
} from '../application/sales-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import {
  CUSTOMER_CODE_SETTING_KEY,
  parseCustomerCodeRule,
  type CustomerCodeRule,
} from '../domain/customer-code.js';
import type { CrmDatabase } from './crm.database.js';
import { constraintViolation } from './sql-helpers.js';

/** Khoá cấu hình nhắc hoạt động; notification-worker đọc cùng khoá này. */
export const ACTIVITY_REMINDER_SETTING_KEY = 'activity.reminder';
export const DEFAULT_ACTIVITY_REMINDER_MINUTES = 30;

interface GroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  customer_count: number;
}

const GROUP_CODE_EXISTS = () => new CrmConflictError('GROUP_CODE_EXISTS', 'Mã nhóm khách hàng đã tồn tại.');

export class PostgresCustomerGroupStore implements CustomerGroupStore {
  constructor(private readonly database: CrmDatabase) {}

  async listGroups(tenantId: string): Promise<CustomerGroup[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<GroupRow>(
      `SELECT g.id, g.code, g.name, g.description,
              (SELECT count(*)::int FROM crm_schema.customers c WHERE c.group_id = g.id) AS customer_count
         FROM crm_schema.customer_groups g
        ORDER BY g.name, g.code`,
    );
    return result.rows.map(toGroup);
  }

  async createGroup(tenantId: string, record: CustomerGroupRecord, actorId: string): Promise<CustomerGroup> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query<GroupRow>(
        `INSERT INTO crm_schema.customer_groups (code, name, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         RETURNING id, code, name, description, 0 AS customer_count`,
        [record.code, record.name, record.description, actorId],
      );
      return toGroup(result.rows[0]);
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_customer_groups_code')) throw GROUP_CODE_EXISTS();
      throw error;
    }
  }

  async updateGroup(
    tenantId: string,
    id: string,
    record: CustomerGroupRecord,
    actorId: string,
  ): Promise<CustomerGroup | undefined> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query<GroupRow>(
        `UPDATE crm_schema.customer_groups g
            SET code = $2, name = $3, description = $4, updated_at = now(), updated_by = $5
          WHERE g.id = $1
          RETURNING g.id, g.code, g.name, g.description,
                    (SELECT count(*)::int FROM crm_schema.customers c WHERE c.group_id = g.id) AS customer_count`,
        [id, record.code, record.name, record.description, actorId],
      );
      return result.rows[0] ? toGroup(result.rows[0]) : undefined;
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_customer_groups_code')) throw GROUP_CODE_EXISTS();
      throw error;
    }
  }

  async deleteGroup(tenantId: string, id: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query(`DELETE FROM crm_schema.customer_groups WHERE id = $1`, [id]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      // Khoá ngoại RESTRICT từ `customers.group_id`: còn khách thuộc nhóm.
      if (constraintViolation(error, '23503')) {
        throw new CrmConflictError('GROUP_IN_USE', 'Nhóm đang được dùng cho khách hàng, không xoá được.');
      }
      throw error;
    }
  }
}

interface KindRow {
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number;
  customer_count: number;
}

const KIND_CODE_EXISTS = () => new CrmConflictError('KIND_CODE_EXISTS', 'Mã phân loại khách hàng đã tồn tại.');
const KIND_COLUMNS = `k.code, k.name, k.description, k.is_system, k.sort_order,
  (SELECT count(*)::int FROM crm_schema.customers c WHERE c.kind = k.code) AS customer_count`;

export class PostgresCustomerKindStore implements CustomerKindStore {
  constructor(private readonly database: CrmDatabase) {}

  async listKinds(tenantId: string): Promise<CustomerKindOption[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<KindRow>(
      `SELECT ${KIND_COLUMNS} FROM crm_schema.customer_kinds k ORDER BY k.sort_order, k.name, k.code`,
    );
    return result.rows.map(toKind);
  }

  async createKind(tenantId: string, record: CustomerKindRecord, actorId: string): Promise<CustomerKindOption> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query<KindRow>(
        `INSERT INTO crm_schema.customer_kinds AS k (code, name, description, sort_order, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING ${KIND_COLUMNS}`,
        [record.code, record.name, record.description, record.sortOrder, actorId],
      );
      return toKind(result.rows[0]);
    } catch (error) {
      if (constraintViolation(error, '23505', 'customer_kinds_pkey')) throw KIND_CODE_EXISTS();
      throw error;
    }
  }

  async updateKind(
    tenantId: string,
    code: string,
    record: CustomerKindRecord,
    actorId: string,
  ): Promise<CustomerKindOption | undefined> {
    const pool = await this.database.pool(tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ is_system: boolean }>(
        `SELECT is_system FROM crm_schema.customer_kinds WHERE code = $1 FOR UPDATE`,
        [code],
      );
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return undefined;
      }
      if (current.rows[0].is_system && record.code !== code) {
        throw new CrmConflictError('SYSTEM_KIND_CODE', 'Không đổi được mã của phân loại hệ thống.');
      }
      // Đổi mã: khoá ngoại ON UPDATE CASCADE đổi theo ở khách. Cascade chạy sau câu UPDATE nên đếm khách bằng câu
      // đọc riêng, không đếm trong RETURNING.
      await client.query(
        `UPDATE crm_schema.customer_kinds
            SET code = $2, name = $3, description = $4, sort_order = $5, updated_at = now(), updated_by = $6
          WHERE code = $1`,
        [code, record.code, record.name, record.description, record.sortOrder, actorId],
      );
      const result = await client.query<KindRow>(
        `SELECT ${KIND_COLUMNS} FROM crm_schema.customer_kinds k WHERE k.code = $1`,
        [record.code],
      );
      await client.query('COMMIT');
      return toKind(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (constraintViolation(error, '23505', 'customer_kinds_pkey')) throw KIND_CODE_EXISTS();
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteKind(tenantId: string, code: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const current = await pool.query<{ is_system: boolean }>(
      `SELECT is_system FROM crm_schema.customer_kinds WHERE code = $1`,
      [code],
    );
    if (!current.rows[0]) return false;
    if (current.rows[0].is_system) {
      throw new CrmConflictError('SYSTEM_KIND', 'Phân loại hệ thống không xoá được.');
    }
    try {
      const result = await pool.query(`DELETE FROM crm_schema.customer_kinds WHERE code = $1 AND NOT is_system`, [code]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      // Khoá ngoại RESTRICT từ `customers.kind`: còn khách thuộc phân loại.
      if (constraintViolation(error, '23503')) {
        throw new CrmConflictError('KIND_IN_USE', 'Phân loại đang được dùng cho khách hàng, không xoá được.');
      }
      throw error;
    }
  }
}

export class PostgresSettingsStore implements SettingsStore {
  constructor(private readonly database: CrmDatabase) {}

  async customerCodeRule(tenantId: string): Promise<CustomerCodeRule> {
    return parseCustomerCodeRule(await this.read(tenantId, CUSTOMER_CODE_SETTING_KEY));
  }

  saveCustomerCodeRule(tenantId: string, rule: CustomerCodeRule, actorId: string): Promise<void> {
    return this.write(tenantId, CUSTOMER_CODE_SETTING_KEY, rule, actorId);
  }

  async activityReminderMinutes(tenantId: string): Promise<number> {
    return parseReminderMinutes(await this.read(tenantId, ACTIVITY_REMINDER_SETTING_KEY));
  }

  saveActivityReminderMinutes(tenantId: string, minutes: number, actorId: string): Promise<void> {
    return this.write(tenantId, ACTIVITY_REMINDER_SETTING_KEY, { leadMinutes: minutes }, actorId);
  }

  private async read(tenantId: string, key: string): Promise<unknown> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [key]);
    return result.rows[0]?.value;
  }

  private async write(tenantId: string, key: string, value: unknown, actorId: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(
      `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
             updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), actorId],
    );
  }
}

export function parseReminderMinutes(value: unknown): number {
  const minutes = Number((value as { leadMinutes?: unknown } | null | undefined)?.leadMinutes);
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : DEFAULT_ACTIVITY_REMINDER_MINUTES;
}

function toGroup(row: GroupRow): CustomerGroup {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    customerCount: Number(row.customer_count),
  };
}

function toKind(row: KindRow): CustomerKindOption {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    sortOrder: Number(row.sort_order),
    customerCount: Number(row.customer_count),
  };
}
