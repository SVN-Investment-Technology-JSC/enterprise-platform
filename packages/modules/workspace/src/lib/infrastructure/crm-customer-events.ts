import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { CrmCustomerReference } from '@enterprise-platform/contracts-integration';
import type { Customer } from '@enterprise-platform/contracts-workspace';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { CrmCustomerLinkService } from '../application/crm-customer-link.service.js';
import type { CrmCustomerCopyResult, CrmCustomerCopyStore } from '../application/crm-customer.port.js';
import { decideCrmCustomerSync } from '../domain/crm-customer-sync.js';
import { CrmCustomerLinkConflictError, CustomerNotFoundError } from '../domain/workspace.error.js';
import { HttpCrmCustomerDirectory } from './http-crm-customer-directory.js';

const COLUMNS = `id, code, name, note, created_by, created_at, updated_at, crm_customer_id`;

interface CustomerRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  note: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  crm_customer_id: string | null;
}

function toCustomer(row: CustomerRow): Customer {
  const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : String(value));
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ...(row.note == null ? {} : { note: row.note }),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.crm_customer_id == null ? {} : { crmCustomerId: row.crm_customer_id }),
  };
}

/**
 * Bản sao khách Bán hàng trong `workspace_schema.customers` (D1).
 *
 * Mỗi lần ghi chạy trong một transaction, khoá tư vấn theo id khách Bán hàng
 * để hai sự kiện của cùng một khách (hay sự kiện và thao tác chọn ở form) không
 * chạy chồng nhau. Phiên bản không mới hơn bản đang giữ thì bỏ qua, nên giao
 * lặp hay đến trễ đều không ghi đè.
 */
export class PostgresCrmCustomerCopies implements CrmCustomerCopyStore {
  constructor(private readonly poolFor: (tenantId: string) => Promise<Pool>) {}

  async ready(tenantId: string): Promise<boolean> {
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<{ ready: boolean }>(
      `SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'workspace_schema' AND table_name = 'customers'
                   AND column_name = 'crm_customer_id'
              ) AS ready`,
    );
    return result.rows[0]?.ready === true;
  }

  async linkedIds(tenantId: string, crmCustomerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (!crmCustomerIds.length) return new Map();
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<{ id: string; crm_customer_id: string }>(
      `SELECT id, crm_customer_id FROM workspace_schema.customers WHERE crm_customer_id = ANY($1::uuid[])`,
      [crmCustomerIds],
    );
    return new Map(result.rows.map((row) => [row.crm_customer_id, row.id]));
  }

  async apply(
    tenantId: string,
    reference: CrmCustomerReference,
    options: { readonly actorUserId: string; readonly targetCustomerId?: string },
  ): Promise<CrmCustomerCopyResult> {
    const pool = await this.poolFor(tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await applyInTransaction(client, reference, options);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string } | null)?.code === '23505') {
        throw new CrmCustomerLinkConflictError(
          `Mã khách hàng ${reference.code} đã có ở một khách hàng Workspace khác; chưa gắn được khách CRM.`,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function applyInTransaction(
  client: PoolClient,
  reference: CrmCustomerReference,
  options: { readonly actorUserId: string; readonly targetCustomerId?: string },
): Promise<CrmCustomerCopyResult> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('workspace.crm-customer:' || $1, 0))`, [
    reference.id,
  ]);
  const linked = await client.query<{ id: string; crm_version: number | null }>(
    `SELECT id, crm_version FROM workspace_schema.customers WHERE crm_customer_id = $1 FOR UPDATE`,
    [reference.id],
  );
  const current = linked.rows[0];
  // Ứng viên để gắn: khách chỉ định đích danh, hoặc (khi chưa có bản sao) khách cùng mã. Mã Bán hàng luôn viết
  // hoa; khách Workspace cũ chưa gắn có mã viết thường (`kh01`) vẫn được nhận, ưu tiên khách trùng mã y hệt.
  const candidate = options.targetCustomerId
    ? await client.query<{ id: string; crm_customer_id: string | null }>(
        `SELECT id, crm_customer_id FROM workspace_schema.customers WHERE id = $1 FOR UPDATE`,
        [options.targetCustomerId],
      )
    : current
      ? undefined
      : await client.query<{ id: string; crm_customer_id: string | null }>(
          `SELECT id, crm_customer_id FROM workspace_schema.customers
            WHERE code = $1 OR (crm_customer_id IS NULL AND upper(btrim(code)) = upper($1))
            ORDER BY (code = $1) DESC, created_at, id
            LIMIT 1
            FOR UPDATE`,
          [reference.code],
        );
  if (options.targetCustomerId && !candidate?.rows[0]) throw new CustomerNotFoundError();
  const match = candidate?.rows[0];
  const decision = decideCrmCustomerSync({
    crmCustomerId: reference.id,
    incomingVersion: reference.version,
    linked: current ? { id: current.id, crmVersion: current.crm_version } : undefined,
    candidate: match ? { id: match.id, crmCustomerId: match.crm_customer_id } : undefined,
  });

  switch (decision.kind) {
    case 'ignore':
      return { action: 'ignored', customer: await readCustomer(client, decision.customerId) };
    case 'conflict':
      throw new CrmCustomerLinkConflictError(
        options.targetCustomerId
          ? 'Khách hàng Workspace này đã gắn với một khách CRM khác, hoặc khách CRM đã có bản sao khác.'
          : `Mã khách hàng ${reference.code} đang thuộc bản sao của một khách CRM khác.`,
      );
    case 'update':
    case 'link': {
      const updated = await client.query<CustomerRow>(
        `UPDATE workspace_schema.customers
            SET crm_customer_id = $2, crm_version = $3, code = $4, name = $5, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        [decision.customerId, reference.id, reference.version, reference.code, reference.name],
      );
      return {
        action: decision.kind === 'link' ? 'linked' : 'updated',
        customer: toCustomer(updated.rows[0]),
      };
    }
    case 'create': {
      const inserted = await client.query<CustomerRow>(
        `INSERT INTO workspace_schema.customers (code, name, created_by, crm_customer_id, crm_version)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [reference.code, reference.name, options.actorUserId, reference.id, reference.version],
      );
      return { action: 'created', customer: toCustomer(inserted.rows[0]) };
    }
  }
}

async function readCustomer(client: PoolClient, id: string): Promise<Customer> {
  const result = await client.query<CustomerRow>(`SELECT ${COLUMNS} FROM workspace_schema.customers WHERE id = $1`, [
    id,
  ]);
  if (!result.rows[0]) throw new CustomerNotFoundError();
  return toCustomer(result.rows[0]);
}

/** Bộ xử lý sự kiện mà worker chạy cho hàng đợi `workspace.integrations.v1` (cùng hình dạng `LinkEventHandler`). */
export interface CrmCustomerEventHandler {
  ready(tenantId: string): Promise<boolean>;
  handle(tenantId: string, type: string, payload: unknown): Promise<void>;
}

/**
 * Dựng bộ xử lý `crm.customer.*` ngoài Nest (worker), dùng chung registry DB
 * của worker. Chỉ ghi `workspace_schema`.
 */
export function createWorkspaceCrmCustomerEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): CrmCustomerEventHandler {
  const copies = new PostgresCrmCustomerCopies(async (tenantId) =>
    pools.forTenant(references.require(tenantId)),
  );
  const service = new CrmCustomerLinkService(new HttpCrmCustomerDirectory(), copies);
  return {
    ready: (tenantId) => copies.ready(tenantId),
    handle: async (tenantId, type, payload) => {
      await service.handleEvent(tenantId, type, payload);
    },
  };
}
