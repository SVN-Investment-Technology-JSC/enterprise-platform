import type {
  CrmPage,
  CustomerContact,
  CustomerDetail,
  CustomerKind,
  CustomerSummary,
  TaxCodeMatch,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type { CrmCustomerReference } from '@enterprise-platform/contracts-integration';
import type {
  ContactRecord,
  CustomerFilter,
  CustomerLookupQuery,
  CustomerRecord,
  CustomerStore,
} from '../application/sales-store.port.js';
import { CrmConflictError, CrmStaleVersionError, CrmValidationError } from '../domain/crm.error.js';
import { CUSTOMER_CODE_SETTING_KEY, formatCustomerCode, parseCustomerCodeRule } from '../domain/customer-code.js';
import type { CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCustomerEvent } from './crm-outbox.js';
import {
  SqlConditions,
  constraintViolation,
  cursorAt,
  keysetPage,
  prefixPattern,
  prefixTsQuery,
  toIso,
  toNumber,
} from './sql-helpers.js';

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  tax_code: string | null;
  address: string | null;
  province: string | null;
  region: string | null;
  industry: string | null;
  phone: string | null;
  email: string | null;
  group_id: string | null;
  group_name: string | null;
  kind: CustomerKind;
  credit_limit: string | null;
  payment_term_days: number | null;
  note: string | null;
  owner_user_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  primary_contact_name: string | null;
  cursor_at: string;
}

interface ContactRow {
  id: string;
  customer_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  is_primary: boolean;
}

const CUSTOMER_COLUMNS = `
  c.id, c.code, c.name, c.tax_code, c.address, c.province, c.region, c.industry, c.phone, c.email,
  c.group_id, g.name AS group_name, c.kind, c.credit_limit, c.payment_term_days, c.note,
  c.owner_user_id, c.version, c.created_at, c.updated_at, pc.full_name AS primary_contact_name,
  ${cursorAt('c.updated_at')} AS cursor_at`;

const CUSTOMER_FROM = `
  FROM crm_schema.customers c
  LEFT JOIN crm_schema.customer_groups g ON g.id = c.group_id
  LEFT JOIN crm_schema.customer_contacts pc ON pc.customer_id = c.id AND pc.is_primary`;

/** Số lần thử lấy số kế tiếp khi mã sinh ra đã bị ai đó nhập tay. */
const CODE_GENERATION_ATTEMPTS = 50;

const CODE_EXISTS = () => new CrmConflictError('CUSTOMER_CODE_EXISTS', 'Mã khách hàng đã tồn tại.');
const GROUP_MISSING = () => new CrmValidationError('GROUP_NOT_FOUND', 'Nhóm khách hàng không tồn tại.');

/**
 * Khách hàng và người liên hệ trên `crm_schema`.
 *
 * Danh sách phân trang keyset theo `(updated_at DESC, id DESC)` và tìm kiếm
 * dùng index (xem `0002-customers.sql`): đầu mã, đầu MST, đầu từ trong tên
 * (full-text `simple`). Không dùng `ILIKE '%...%'` để danh sách 50.000 khách
 * không quét cả bảng.
 */
export class PostgresCustomerStore implements CustomerStore {
  constructor(private readonly database: CrmDatabase) {}

  async listCustomers(
    tenantId: string,
    scope: CrmDataScope,
    filter: CustomerFilter,
  ): Promise<CrmPage<CustomerSummary>> {
    const where = new SqlConditions();
    where.scope(scope, 'c.owner_user_id');
    if (filter.groupId) where.add(`c.group_id = ${where.param(filter.groupId)}::uuid`);
    if (filter.kind) where.add(`c.kind = ${where.param(filter.kind)}`);
    if (filter.ownerUserId) where.add(`c.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.q) addCustomerSearch(where, filter.q);
    where.after(filter.cursor, 'c.updated_at', 'c.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} ${CUSTOMER_FROM} ${where.where()}
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toSummary);
  }

  async getCustomer(tenantId: string, scope: CrmDataScope, id: string): Promise<CustomerDetail | undefined> {
    const where = new SqlConditions();
    where.add(`c.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'c.owner_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} ${CUSTOMER_FROM} ${where.where()}`, where.params);
    const row = result.rows[0];
    if (!row) return undefined;
    const contacts = await pool.query<ContactRow>(
      `SELECT id, customer_id, full_name, title, phone, email, note, is_primary
         FROM crm_schema.customer_contacts
        WHERE customer_id = $1
        ORDER BY is_primary DESC, created_at, id`,
      [id],
    );
    return toDetail(row, contacts.rows.map(toContact));
  }

  async findByTaxCode(tenantId: string, taxCode: string, excludeId?: string): Promise<TaxCodeMatch[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TaxCodeMatch>(
      `SELECT id, code, name FROM crm_schema.customers
        WHERE tax_code = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
        ORDER BY created_at
        LIMIT 5`,
      [taxCode, excludeId ?? null],
    );
    return result.rows;
  }

  createCustomer(tenantId: string, code: string | null, record: CustomerRecord, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, (client) => insertCustomer(client, tenantId, code, record, actorId));
  }

  async updateCustomer(
    tenantId: string,
    id: string,
    code: string,
    record: CustomerRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    try {
      // Sự kiện `crm.customer.updated` ghi cùng transaction với thay đổi (D1: Workspace giữ bản sao).
      await this.database.transaction(tenantId, async (client) => {
        const result = await client.query(
          `UPDATE crm_schema.customers
              SET code = $3, name = $4, tax_code = $5, address = $6, province = $7, region = $8, industry = $9,
                  phone = $10, email = $11, group_id = $12, kind = $13, credit_limit = $14,
                  payment_term_days = $15, note = $16, owner_user_id = $17,
                  version = version + 1, updated_at = now(), updated_by = $18
            WHERE id = $1 AND version = $2`,
          [id, expectedVersion, code, ...customerValues(record), actorId],
        );
        if (!result.rowCount) throw new CrmStaleVersionError();
        await writeCustomerEvent(client, tenantId, id, 'updated', actorId);
      });
    } catch (error) {
      throw translateCustomerError(error);
    }
  }

  addContact(tenantId: string, customerId: string, record: ContactRecord, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, (client) => insertContact(client, customerId, record, actorId));
  }

  updateContact(
    tenantId: string,
    customerId: string,
    contactId: string,
    record: ContactRecord,
    actorId: string,
  ): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      await lockCustomer(client, customerId);
      const current = await client.query<{ is_primary: boolean }>(
        `SELECT is_primary FROM crm_schema.customer_contacts WHERE id = $1 AND customer_id = $2`,
        [contactId, customerId],
      );
      if (!current.rows[0]) return false;
      // Không bỏ cờ của người chính bằng cách sửa: phải chọn người khác làm chính.
      const isPrimary = record.isPrimary || current.rows[0].is_primary;
      if (isPrimary && !current.rows[0].is_primary) await clearPrimary(client, customerId);
      await client.query(
        `UPDATE crm_schema.customer_contacts
            SET full_name = $3, title = $4, phone = $5, email = $6, note = $7, is_primary = $8,
                updated_at = now(), updated_by = $9
          WHERE id = $1 AND customer_id = $2`,
        [contactId, customerId, record.fullName, record.title, record.phone, record.email, record.note, isPrimary, actorId],
      );
      return true;
    });
  }

  deleteContact(tenantId: string, customerId: string, contactId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      await lockCustomer(client, customerId);
      const deleted = await client.query<{ is_primary: boolean }>(
        `DELETE FROM crm_schema.customer_contacts WHERE id = $1 AND customer_id = $2 RETURNING is_primary`,
        [contactId, customerId],
      );
      if (!deleted.rows[0]) return false;
      if (deleted.rows[0].is_primary) {
        await client.query(
          `UPDATE crm_schema.customer_contacts SET is_primary = TRUE, updated_at = now()
            WHERE id = (SELECT id FROM crm_schema.customer_contacts WHERE customer_id = $1
                         ORDER BY created_at, id LIMIT 1)`,
          [customerId],
        );
      }
      return true;
    });
  }

  async lookupCustomers(tenantId: string, query: CustomerLookupQuery): Promise<CrmCustomerReference[]> {
    const where = new SqlConditions();
    if (query.ids?.length) where.add(`c.id = ANY(${where.param(query.ids)}::uuid[])`);
    if (query.q) addCustomerSearch(where, query.q);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string; code: string; name: string; tax_code: string | null; version: number }>(
      `SELECT c.id, c.code, c.name, c.tax_code, c.version FROM crm_schema.customers c ${where.where()}
        ORDER BY c.code, c.id
        LIMIT ${where.param(query.limit)}`,
      where.params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      taxCode: row.tax_code,
      version: Number(row.version),
    }));
  }
}

/**
 * Tìm theo mã, MST, tên: khớp đầu mã, đầu MST, hoặc đầu từ trong tên. Mỗi nhánh
 * có index riêng nên PostgreSQL ghép bằng BitmapOr.
 */
function addCustomerSearch(where: SqlConditions, q: string): void {
  const branches = [`lower(c.code) LIKE ${where.param(prefixPattern(q.toLowerCase()))}`];
  const digits = q.replace(/\s+/g, '');
  if (/^[\d-]+$/.test(digits)) branches.push(`c.tax_code LIKE ${where.param(prefixPattern(digits))}`);
  const tsQuery = prefixTsQuery(q);
  if (tsQuery) {
    branches.push(
      `to_tsvector('simple'::regconfig, c.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)})`,
    );
  }
  where.add(`(${branches.join(' OR ')})`);
}

/**
 * Ghi một khách trong transaction của bên gọi (tạo khách, chuyển đổi lead).
 * `code` rỗng thì sinh: tiền tố + số thứ tự từ sequence, bỏ qua số đã có người
 * nhập tay. Trùng mã người dùng nhập: 409. Sự kiện `crm.customer.created` ghi
 * vào outbox trong cùng transaction.
 */
export async function insertCustomer(
  client: CrmSqlClient,
  tenantId: string,
  code: string | null,
  record: CustomerRecord,
  actorId: string,
): Promise<string> {
  const finalCode = code ?? (await nextCustomerCode(client));
  // Savepoint để lỗi trùng mã không làm hỏng transaction lớn hơn của bên gọi.
  await client.query('SAVEPOINT crm_insert_customer');
  let id: string | undefined;
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO crm_schema.customers
         (code, name, tax_code, address, province, region, industry, phone, email, group_id, kind,
          credit_limit, payment_term_days, note, owner_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
       RETURNING id`,
      [finalCode, ...customerValues(record), actorId],
    );
    await client.query('RELEASE SAVEPOINT crm_insert_customer');
    id = result.rows[0]?.id;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT crm_insert_customer');
    throw translateCustomerError(error);
  }
  if (!id) throw new Error('crm_schema.customers insert returned no row.');
  await writeCustomerEvent(client, tenantId, id, 'created', actorId);
  return id;
}

async function nextCustomerCode(client: CrmSqlClient): Promise<string> {
  const setting = await client.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
    CUSTOMER_CODE_SETTING_KEY,
  ]);
  const rule = parseCustomerCodeRule(setting.rows[0]?.value);
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const next = await client.query<{ value: string }>(`SELECT nextval('crm_schema.customer_code_seq')::text AS value`);
    const candidate = formatCustomerCode(rule, BigInt(next.rows[0].value));
    const taken = await client.query(`SELECT 1 FROM crm_schema.customers WHERE code = $1`, [candidate]);
    if (!taken.rows.length) return candidate;
  }
  throw new CrmConflictError(
    'CUSTOMER_CODE_EXHAUSTED',
    'Không sinh được mã khách hàng mới vì các mã kế tiếp đã có người dùng. Vui lòng nhập mã hoặc đổi quy tắc mã.',
  );
}

/** Thêm người liên hệ trong transaction của bên gọi; người đầu tiên luôn là người chính. */
export async function insertContact(
  client: CrmSqlClient,
  customerId: string,
  record: ContactRecord,
  actorId: string,
): Promise<string> {
  await lockCustomer(client, customerId);
  const existing = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM crm_schema.customer_contacts WHERE customer_id = $1`,
    [customerId],
  );
  const isPrimary = record.isPrimary || existing.rows[0]?.count === 0;
  if (isPrimary) await clearPrimary(client, customerId);
  const result = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.customer_contacts
       (customer_id, full_name, title, phone, email, note, is_primary, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING id`,
    [customerId, record.fullName, record.title, record.phone, record.email, record.note, isPrimary, actorId],
  );
  return result.rows[0].id;
}

/** Khoá dòng khách để hai thao tác đổi người liên hệ chính không chạy chồng nhau. */
async function lockCustomer(client: CrmSqlClient, customerId: string): Promise<void> {
  await client.query(`SELECT 1 FROM crm_schema.customers WHERE id = $1 FOR UPDATE`, [customerId]);
}

async function clearPrimary(client: CrmSqlClient, customerId: string): Promise<void> {
  await client.query(
    `UPDATE crm_schema.customer_contacts SET is_primary = FALSE, updated_at = now()
      WHERE customer_id = $1 AND is_primary`,
    [customerId],
  );
}

function customerValues(record: CustomerRecord): unknown[] {
  return [
    record.name,
    record.taxCode,
    record.address,
    record.province,
    record.region,
    record.industry,
    record.phone,
    record.email,
    record.groupId,
    record.kind,
    record.creditLimit,
    record.paymentTermDays,
    record.note,
    record.ownerUserId,
  ];
}

function translateCustomerError(error: unknown): unknown {
  if (constraintViolation(error, '23505', 'uq_crm_customers_code')) return CODE_EXISTS();
  if (constraintViolation(error, '23503')) return GROUP_MISSING();
  return error;
}

function toSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    taxCode: row.tax_code,
    province: row.province,
    region: row.region,
    kind: row.kind,
    groupId: row.group_id,
    groupName: row.group_name,
    ownerUserId: row.owner_user_id,
    primaryContactName: row.primary_contact_name,
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toDetail(row: CustomerRow, contacts: CustomerContact[]): CustomerDetail {
  return {
    ...toSummary(row),
    address: row.address,
    industry: row.industry,
    phone: row.phone,
    email: row.email,
    creditLimit: toNumber(row.credit_limit),
    paymentTermDays: row.payment_term_days,
    note: row.note,
    version: row.version,
    createdAt: toIso(row.created_at) ?? '',
    contacts,
  };
}

function toContact(row: ContactRow): CustomerContact {
  return {
    id: row.id,
    customerId: row.customer_id,
    fullName: row.full_name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    note: row.note,
    isPrimary: row.is_primary,
  };
}
