import {
  SALES_ORGANIZATION_CODE_EXISTS_CODE,
  SALES_ORGANIZATION_NAME_EXISTS_CODE,
  type QuoteSeller,
  type SalesOrganization,
  type SalesOrganizationSummary,
} from '@enterprise-platform/contracts-crm';
import type {
  SalesOrganizationRecord,
  SalesOrganizationRemoval,
  SalesOrganizationStore,
} from '../application/sales-organization-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { constraintViolation, toIso } from './sql-helpers.js';

/** Khoá thực thể ghi `audit_log` cho danh mục tổ chức báo giá. */
export const SALES_ORGANIZATION_AUDIT_ENTITY = 'sales_organization';

/** Cột chữ của tổ chức, đủ để dựng `QuoteSeller` (dùng cả khi chép tổ chức mặc định vào báo giá tự tạo). */
export const SALES_ORGANIZATION_SELLER_COLUMNS =
  'name, short_name, address, tax_code, phone, email, website, bank_account, bank_name, representative, representative_title';

export interface SalesOrganizationSellerRow {
  name: string;
  short_name: string | null;
  address: string;
  tax_code: string;
  phone: string;
  email: string;
  website: string | null;
  bank_account: string | null;
  bank_name: string | null;
  representative: string | null;
  representative_title: string | null;
}

interface OrganizationRow extends SalesOrganizationSellerRow {
  id: string;
  code: string | null;
  has_logo: boolean;
  logo?: string | null;
  is_default: boolean;
  active: boolean;
  sort_order: number;
  in_use: boolean;
  updated_at: Date;
}

const SUMMARY_COLUMNS = `o.id, o.code, ${SALES_ORGANIZATION_SELLER_COLUMNS.split(', ')
  .map((column) => `o.${column}`)
  .join(', ')},
  (o.logo IS NOT NULL) AS has_logo, o.is_default, o.active, o.sort_order, o.updated_at,
  EXISTS (SELECT 1 FROM crm_schema.quote_versions v WHERE v.organization_id = o.id) AS in_use`;
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, o.logo`;

const NAME_EXISTS = () => new CrmConflictError(SALES_ORGANIZATION_NAME_EXISTS_CODE, 'Tên tổ chức đã tồn tại.');
const CODE_EXISTS = () => new CrmConflictError(SALES_ORGANIZATION_CODE_EXISTS_CODE, 'Mã tổ chức đã tồn tại.');

export class PostgresSalesOrganizationStore implements SalesOrganizationStore {
  constructor(private readonly database: CrmDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<SalesOrganizationSummary[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OrganizationRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM crm_schema.sales_organizations o
        WHERE $1::boolean OR o.active ORDER BY o.sort_order, o.name, o.id`,
      [includeInactive],
    );
    return result.rows.map(toSummary);
  }

  async get(tenantId: string, id: string): Promise<SalesOrganization | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OrganizationRow>(
      `SELECT ${DETAIL_COLUMNS} FROM crm_schema.sales_organizations o WHERE o.id = $1`,
      [id],
    );
    return result.rows[0] ? toDetail(result.rows[0]) : undefined;
  }

  async defaultOrganization(tenantId: string): Promise<SalesOrganization | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<OrganizationRow>(
      `SELECT ${DETAIL_COLUMNS} FROM crm_schema.sales_organizations o WHERE o.is_default AND o.active LIMIT 1`,
    );
    return result.rows[0] ? toDetail(result.rows[0]) : undefined;
  }

  create(tenantId: string, record: SalesOrganizationRecord, actorId: string): Promise<SalesOrganization> {
    return this.database
      .transaction(tenantId, async (client) => {
        if (record.isDefault) await client.query(`UPDATE crm_schema.sales_organizations SET is_default = FALSE WHERE is_default`);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.sales_organizations
             (code, name, short_name, address, tax_code, phone, email, website, bank_account, bank_name, representative,
              representative_title, logo, is_default, active, sort_order, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17) RETURNING id`,
          [...recordValues(record), actorId],
        );
        const organization = await readDetail(client, inserted.rows[0].id);
        await audit(client, organization.id, 'create', actorId, organization);
        return organization;
      })
      .catch(rethrowDuplicate);
  }

  update(tenantId: string, id: string, record: SalesOrganizationRecord, actorId: string): Promise<SalesOrganization | undefined> {
    return this.database
      .transaction(tenantId, async (client) => {
        if (record.isDefault) {
          await client.query(`UPDATE crm_schema.sales_organizations SET is_default = FALSE WHERE is_default AND id <> $1`, [id]);
        }
        const updated = await client.query<{ id: string }>(
          `UPDATE crm_schema.sales_organizations
              SET code = $2, name = $3, short_name = $4, address = $5, tax_code = $6, phone = $7, email = $8, website = $9,
                  bank_account = $10, bank_name = $11, representative = $12, representative_title = $13, logo = $14,
                  is_default = $15, active = $16, sort_order = $17, updated_at = now(), updated_by = $18
            WHERE id = $1 RETURNING id`,
          [id, ...recordValues(record), actorId],
        );
        if (!updated.rows[0]) return undefined;
        const organization = await readDetail(client, id);
        await audit(client, id, 'update', actorId, organization);
        return organization;
      })
      .catch(rethrowDuplicate);
  }

  remove(tenantId: string, id: string, actorId: string): Promise<SalesOrganizationRemoval> {
    return this.database
      .transaction(tenantId, async (client): Promise<SalesOrganizationRemoval> => {
        const current = await client.query<OrganizationRow>(
          `SELECT ${DETAIL_COLUMNS} FROM crm_schema.sales_organizations o WHERE o.id = $1 FOR UPDATE OF o`,
          [id],
        );
        const row = current.rows[0];
        if (!row) return 'not-found';
        if (row.in_use) return 'in-use';
        await client.query(`DELETE FROM crm_schema.sales_organizations WHERE id = $1`, [id]);
        await audit(client, id, 'delete', actorId, toDetail(row));
        return 'deleted';
      })
      .catch((error: unknown) => {
        // Báo giá vừa chọn tổ chức này giữa lúc kiểm và lúc xoá: khoá ngoại chặn, trả như đang dùng.
        if (constraintViolation(error, '23503')) return 'in-use';
        throw error;
      });
  }
}

/** Phần chữ của tổ chức thành `QuoteSeller` (chép vào phiên bản báo giá). */
export function sellerFromRow(row: SalesOrganizationSellerRow): QuoteSeller {
  return {
    name: row.name,
    shortName: row.short_name,
    address: row.address,
    taxCode: row.tax_code,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bankAccount: row.bank_account,
    bankName: row.bank_name,
    representative: row.representative,
    representativeTitle: row.representative_title,
  };
}

function recordValues(record: SalesOrganizationRecord): unknown[] {
  return [
    record.code,
    record.name,
    record.shortName,
    record.address,
    record.taxCode,
    record.phone,
    record.email,
    record.website,
    record.bankAccount,
    record.bankName,
    record.representative,
    record.representativeTitle,
    record.logo,
    record.isDefault,
    record.active,
    record.sortOrder,
  ];
}

async function readDetail(client: CrmSqlClient, id: string): Promise<SalesOrganization> {
  const result = await client.query<OrganizationRow>(`SELECT ${DETAIL_COLUMNS} FROM crm_schema.sales_organizations o WHERE o.id = $1`, [
    id,
  ]);
  return toDetail(result.rows[0]);
}

/** Nhật ký không chứa logo (có thể tới 300 KB): chỉ ghi có hay không. */
async function audit(client: CrmSqlClient, id: string, action: string, actorId: string, organization: SalesOrganization) {
  await writeAuditLog(client, {
    entityType: SALES_ORGANIZATION_AUDIT_ENTITY,
    entityId: id,
    action,
    actorId,
    metadata: {
      code: organization.code,
      name: organization.name,
      taxCode: organization.taxCode,
      isDefault: organization.isDefault,
      active: organization.active,
      hasLogo: organization.hasLogo,
    },
  });
}

function rethrowDuplicate(error: unknown): never {
  if (constraintViolation(error, '23505', 'uq_crm_sales_organizations_name')) throw NAME_EXISTS();
  if (constraintViolation(error, '23505', 'uq_crm_sales_organizations_code')) throw CODE_EXISTS();
  throw error;
}

function toSummary(row: OrganizationRow): SalesOrganizationSummary {
  return {
    id: row.id,
    code: row.code,
    ...sellerFromRow(row),
    hasLogo: row.has_logo,
    isDefault: row.is_default,
    active: row.active,
    sortOrder: row.sort_order,
    inUse: row.in_use,
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toDetail(row: OrganizationRow): SalesOrganization {
  return { ...toSummary(row), logo: row.logo ?? null };
}
