import {
  inTransaction,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { Pool, PoolClient } from 'pg';
import type { CrmDiagnostics, CrmSchemaStatus } from '../application/crm-store.port.js';

/**
 * Lối vào DB của tenant cho mọi store của Bán hàng.
 *
 * Guard đăng ký database của tenant sau access-decision; ở đây chỉ tra lại.
 * Store ghi nhiều bảng dùng `transaction` để nhật ký (`writeAuditLog`) và
 * outbox nằm cùng transaction với thay đổi dữ liệu. Test integration thay lớp
 * này bằng `TestCrmDatabase` (pool của DB tạm).
 */
export class CrmDatabase implements CrmDiagnostics {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async pool(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return inTransaction(await this.pool(tenantId), work);
  }

  async schemaStatus(tenantId: string): Promise<CrmSchemaStatus> {
    const pool = await this.pool(tenantId);
    const result = await pool.query<{ schema_exists: boolean; tables_ready: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'crm_schema') AS schema_exists,
              to_regclass('crm_schema.audit_log') IS NOT NULL AS tables_ready`,
    );
    return {
      schemaExists: result.rows[0]?.schema_exists ?? false,
      tablesReady: result.rows[0]?.tables_ready ?? false,
    };
  }
}
