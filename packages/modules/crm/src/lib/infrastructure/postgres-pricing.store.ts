import {
  DEFAULT_DISCOUNT_CAP_PERCENT,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type DiscountStacking,
  type PriceListDetail,
  type PriceListGroupRef,
  type PriceListItem,
  type PriceListSummary,
  type PricingStatus,
} from '@enterprise-platform/contracts-crm';
import type { Pool, PoolClient } from 'pg';
import type {
  DiscountPolicyRecord,
  DiscountPolicyStore,
  PriceListItemRecord,
  PriceListRecord,
  PriceListStore,
  PricingStore,
} from '../application/pricing-store.port.js';
import { CrmConflictError, CrmValidationError } from '../domain/crm.error.js';
import type { PricingPolicy, PricingPriceList } from '../domain/pricing-engine.js';
import type { CrmDatabase } from './crm.database.js';
import { constraintViolation, toDateOnly, toIso } from './sql-helpers.js';

/** Khoá cấu hình trần chiết khấu tổng (migration 0005 ghi giá trị mặc định). */
export const DISCOUNT_CAP_SETTING_KEY = 'pricing.discountCap';

/** Khoá tư vấn giữ trong transaction khi ghi bảng giá chuẩn (bảng chuẩn không có dòng nhóm để khoá). */
const STANDARD_LIST_LOCK = 'crm_schema.price_lists.standard';

interface PriceListRow {
  id: string;
  code: string;
  name: string;
  is_standard: boolean;
  valid_from: string | Date;
  valid_to: string | Date | null;
  status: PricingStatus;
  note: string | null;
  item_count: number;
  customer_groups: PriceListGroupRef[] | null;
  updated_at: Date;
}

interface PriceListItemRow {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  price: string;
  vat_rate: string;
}

const PRICE_LIST_COLUMNS = `
  l.id, l.code, l.name, l.is_standard, l.valid_from, l.valid_to, l.status, l.note, l.updated_at,
  (SELECT count(*)::int FROM crm_schema.price_list_items i WHERE i.price_list_id = l.id) AS item_count,
  (SELECT json_agg(json_build_object('id', g.id, 'code', g.code, 'name', g.name) ORDER BY g.name, g.code)
     FROM crm_schema.price_list_customer_groups pg
     JOIN crm_schema.customer_groups g ON g.id = pg.customer_group_id
    WHERE pg.price_list_id = l.id) AS customer_groups`;

const PRICE_LIST_CODE_EXISTS = () => new CrmConflictError('PRICE_LIST_CODE_EXISTS', 'Mã bảng giá đã tồn tại.');
const ITEM_EXISTS = () =>
  new CrmConflictError('PRICE_LIST_ITEM_EXISTS', 'Mặt hàng với đơn vị tính này đã có trong bảng giá.');

export class PostgresPriceListStore implements PriceListStore {
  constructor(private readonly database: CrmDatabase) {}

  async listPriceLists(tenantId: string): Promise<PriceListSummary[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PriceListRow>(
      `SELECT ${PRICE_LIST_COLUMNS} FROM crm_schema.price_lists l
        ORDER BY l.is_standard DESC, l.valid_from DESC, l.code`,
    );
    return result.rows.map(toPriceListSummary);
  }

  async getPriceList(tenantId: string, id: string): Promise<PriceListDetail | undefined> {
    const pool = await this.database.pool(tenantId);
    const header = await pool.query<PriceListRow>(
      `SELECT ${PRICE_LIST_COLUMNS} FROM crm_schema.price_lists l WHERE l.id = $1`,
      [id],
    );
    if (!header.rows[0]) return undefined;
    const items = await pool.query<PriceListItemRow>(
      `SELECT id, material_id, material_code, material_name, unit, price, vat_rate
         FROM crm_schema.price_list_items
        WHERE price_list_id = $1
        ORDER BY material_code, unit`,
      [id],
    );
    return { ...toPriceListSummary(header.rows[0]), items: items.rows.map(toItem) };
  }

  async createPriceList(
    tenantId: string,
    record: PriceListRecord,
    customerGroupIds: readonly string[],
    actorId: string,
  ): Promise<string> {
    const groups = record.isStandard ? [] : customerGroupIds;
    try {
      return await this.database.transaction(tenantId, async (client) => {
        await assertNoOverlap(client, null, record, groups);
        const result = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.price_lists
             (code, name, is_standard, valid_from, valid_to, status, note, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           RETURNING id`,
          [record.code, record.name, record.isStandard, record.validFrom, record.validTo, record.status, record.note, actorId],
        );
        const id = result.rows[0].id;
        await replaceGroups(client, id, groups, actorId);
        return id;
      });
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_price_lists_code')) throw PRICE_LIST_CODE_EXISTS();
      throw error;
    }
  }

  async updatePriceList(
    tenantId: string,
    id: string,
    record: PriceListRecord,
    customerGroupIds: readonly string[] | undefined,
    actorId: string,
  ): Promise<boolean> {
    try {
      return await this.database.transaction(tenantId, async (client) => {
        const current = await client.query<{ id: string }>(
          `SELECT id FROM crm_schema.price_lists WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!current.rows[0]) return false;
        let groups: readonly string[];
        if (record.isStandard) groups = [];
        else if (customerGroupIds) groups = customerGroupIds;
        else {
          const existing = await client.query<{ id: string }>(
            `SELECT customer_group_id::text AS id FROM crm_schema.price_list_customer_groups WHERE price_list_id = $1`,
            [id],
          );
          groups = existing.rows.map((row) => row.id);
        }
        await assertNoOverlap(client, id, record, groups);
        await client.query(
          `UPDATE crm_schema.price_lists
              SET code = $2, name = $3, is_standard = $4, valid_from = $5, valid_to = $6, status = $7,
                  note = $8, updated_at = now(), updated_by = $9
            WHERE id = $1`,
          [id, record.code, record.name, record.isStandard, record.validFrom, record.validTo, record.status, record.note, actorId],
        );
        await replaceGroups(client, id, groups, actorId);
        return true;
      });
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_price_lists_code')) throw PRICE_LIST_CODE_EXISTS();
      throw error;
    }
  }

  async deletePriceList(tenantId: string, id: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(`DELETE FROM crm_schema.price_lists WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async addItem(
    tenantId: string,
    priceListId: string,
    record: PriceListItemRecord,
    actorId: string,
  ): Promise<string | undefined> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.price_list_items
           (price_list_id, material_id, material_code, material_name, unit, price, vat_rate, created_by, updated_by)
         SELECT l.id, $2, $3, $4, $5, $6, $7, $8, $8 FROM crm_schema.price_lists l WHERE l.id = $1
         RETURNING id`,
        [priceListId, ...itemValues(record), actorId],
      );
      if (result.rows[0]) await touch(pool, priceListId, actorId);
      return result.rows[0]?.id;
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_price_list_items_material')) throw ITEM_EXISTS();
      throw error;
    }
  }

  async updateItem(
    tenantId: string,
    priceListId: string,
    itemId: string,
    record: PriceListItemRecord,
    actorId: string,
  ): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query(
        `UPDATE crm_schema.price_list_items
            SET material_id = $3, material_code = $4, material_name = $5, unit = $6, price = $7, vat_rate = $8,
                updated_at = now(), updated_by = $9
          WHERE id = $2 AND price_list_id = $1`,
        [priceListId, itemId, ...itemValues(record), actorId],
      );
      const updated = (result.rowCount ?? 0) > 0;
      if (updated) await touch(pool, priceListId, actorId);
      return updated;
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_price_list_items_material')) throw ITEM_EXISTS();
      throw error;
    }
  }

  async deleteItem(tenantId: string, priceListId: string, itemId: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(
      `DELETE FROM crm_schema.price_list_items WHERE id = $2 AND price_list_id = $1`,
      [priceListId, itemId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async upsertItems(
    tenantId: string,
    priceListId: string,
    records: readonly PriceListItemRecord[],
    actorId: string,
  ): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const list = await client.query(`SELECT id FROM crm_schema.price_lists WHERE id = $1 FOR UPDATE`, [priceListId]);
      if (!list.rows[0]) return false;
      // Một câu lệnh cho mọi dòng; trùng (mặt hàng, đơn vị) thì cập nhật giá.
      await client.query(
        `INSERT INTO crm_schema.price_list_items
           (price_list_id, material_id, material_code, material_name, unit, price, vat_rate, created_by, updated_by)
         SELECT $1, r.material_id, r.material_code, r.material_name, r.unit, r.price, r.vat_rate, $3, $3
           FROM jsonb_to_recordset($2::jsonb) AS r(
                  material_id uuid, material_code text, material_name text, unit text, price numeric, vat_rate numeric)
         ON CONFLICT ON CONSTRAINT uq_crm_price_list_items_material DO UPDATE
           SET material_code = EXCLUDED.material_code, material_name = EXCLUDED.material_name,
               price = EXCLUDED.price, vat_rate = EXCLUDED.vat_rate, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [
          priceListId,
          JSON.stringify(
            records.map((record) => ({
              material_id: record.materialId,
              material_code: record.materialCode,
              material_name: record.materialName,
              unit: record.unit,
              price: record.price,
              vat_rate: record.vatRate,
            })),
          ),
          actorId,
        ],
      );
      await client.query(
        `UPDATE crm_schema.price_lists SET updated_at = now(), updated_by = $2 WHERE id = $1`,
        [priceListId, actorId],
      );
      return true;
    });
  }
}

/**
 * Chặn chồng hiệu lực trong transaction đang mở.
 *
 * Khoá dòng nhóm khách (`FOR UPDATE`) trước khi kiểm, nên hai người cùng gán
 * bảng cho một nhóm phải chờ nhau và người sau thấy bảng của người trước.
 * Bảng chuẩn không có nhóm nên khoá bằng khoá tư vấn cố định. Bảng ngừng áp
 * dụng không bị chặn (vẫn kiểm nhóm tồn tại).
 */
async function assertNoOverlap(
  client: PoolClient,
  id: string | null,
  record: PriceListRecord,
  groupIds: readonly string[],
): Promise<void> {
  if (record.isStandard) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [STANDARD_LIST_LOCK]);
  } else if (groupIds.length) {
    const locked = await client.query<{ id: string }>(
      `SELECT id FROM crm_schema.customer_groups WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [groupIds],
    );
    if (locked.rows.length !== groupIds.length) {
      throw new CrmValidationError('INVALID_REFERENCE', 'Nhóm khách hàng không tồn tại.');
    }
  }
  if (record.status !== 'ACTIVE' || (!record.isStandard && !groupIds.length)) return;

  const overlap = `daterange(l.valid_from, l.valid_to, '[]') && daterange($2::date, $3::date, '[]')`;
  const result = record.isStandard
    ? await client.query<{ code: string }>(
        `SELECT l.code FROM crm_schema.price_lists l
          WHERE l.is_standard AND l.status = 'ACTIVE' AND ($1::uuid IS NULL OR l.id <> $1) AND ${overlap}
          ORDER BY l.valid_from, l.code LIMIT 1`,
        [id, record.validFrom, record.validTo],
      )
    : await client.query<{ code: string }>(
        `SELECT l.code FROM crm_schema.price_lists l
          WHERE NOT l.is_standard AND l.status = 'ACTIVE' AND ($1::uuid IS NULL OR l.id <> $1) AND ${overlap}
            AND EXISTS (SELECT 1 FROM crm_schema.price_list_customer_groups g
                         WHERE g.price_list_id = l.id AND g.customer_group_id = ANY($4::uuid[]))
          ORDER BY l.valid_from, l.code LIMIT 1`,
        [id, record.validFrom, record.validTo, groupIds],
      );
  const conflict = result.rows[0];
  if (conflict) {
    throw new CrmConflictError('PRICE_LIST_OVERLAP', `Trùng thời gian hiệu lực với bảng giá ${conflict.code}`, {
      conflictCode: conflict.code,
    });
  }
}

async function replaceGroups(client: PoolClient, id: string, groupIds: readonly string[], actorId: string): Promise<void> {
  await client.query(
    `DELETE FROM crm_schema.price_list_customer_groups WHERE price_list_id = $1 AND NOT (customer_group_id = ANY($2::uuid[]))`,
    [id, groupIds],
  );
  if (!groupIds.length) return;
  await client.query(
    `INSERT INTO crm_schema.price_list_customer_groups (price_list_id, customer_group_id, created_by)
     SELECT $1, unnest($2::uuid[]), $3
     ON CONFLICT DO NOTHING`,
    [id, groupIds, actorId],
  );
}

async function touch(pool: Pool, priceListId: string, actorId: string): Promise<void> {
  await pool.query(`UPDATE crm_schema.price_lists SET updated_at = now(), updated_by = $2 WHERE id = $1`, [
    priceListId,
    actorId,
  ]);
}

function itemValues(record: PriceListItemRecord): unknown[] {
  return [record.materialId, record.materialCode, record.materialName, record.unit, record.price, record.vatRate];
}

function toPriceListSummary(row: PriceListRow): PriceListSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isStandard: row.is_standard,
    currency: 'VND',
    validFrom: toDateOnly(row.valid_from) as string,
    validTo: toDateOnly(row.valid_to),
    status: row.status,
    note: row.note,
    itemCount: Number(row.item_count),
    customerGroups: row.customer_groups ?? [],
    updatedAt: toIso(row.updated_at) as string,
  };
}

function toItem(row: PriceListItemRow): PriceListItem {
  return {
    id: row.id,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    unit: row.unit,
    price: Number(row.price),
    vatRate: Number(row.vat_rate),
  };
}

// ---------------------------------------------------------------------------
// Chính sách chiết khấu
// ---------------------------------------------------------------------------

interface PolicyRow {
  id: string;
  code: string;
  name: string;
  priority: number;
  stacking: DiscountStacking;
  exclusive: boolean;
  percent: string | null;
  valid_from: string | Date;
  valid_to: string | Date | null;
  status: PricingStatus;
  applies_to_all_customers: boolean;
  note: string | null;
  updated_at: Date;
  rules: RuleJson[] | null;
}

interface RuleJson {
  criterion: DiscountPolicyRule['criterion'];
  min_qty: number | null;
  max_qty: number | null;
  ref_id: string | null;
  ref_text: string | null;
  from_date: string | null;
  to_date: string | null;
  percent: number | null;
}

const POLICY_COLUMNS = `
  p.id, p.code, p.name, p.priority, p.stacking, p.exclusive, p.percent, p.valid_from, p.valid_to, p.status,
  p.applies_to_all_customers, p.note, p.updated_at,
  (SELECT json_agg(json_build_object(
            'criterion', r.criterion, 'min_qty', r.min_qty, 'max_qty', r.max_qty, 'ref_id', r.ref_id,
            'ref_text', r.ref_text, 'from_date', r.from_date, 'to_date', r.to_date, 'percent', r.percent)
          ORDER BY r.position)
     FROM crm_schema.discount_policy_rules r WHERE r.policy_id = p.id) AS rules`;

const POLICY_CODE_EXISTS = () => new CrmConflictError('POLICY_CODE_EXISTS', 'Mã chính sách đã tồn tại.');

export class PostgresDiscountPolicyStore implements DiscountPolicyStore {
  constructor(private readonly database: CrmDatabase) {}

  async listPolicies(tenantId: string): Promise<DiscountPolicy[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PolicyRow>(
      `SELECT ${POLICY_COLUMNS} FROM crm_schema.discount_policies p ORDER BY p.priority, p.code`,
    );
    return result.rows.map(toPolicy);
  }

  async getPolicy(tenantId: string, id: string): Promise<DiscountPolicy | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PolicyRow>(
      `SELECT ${POLICY_COLUMNS} FROM crm_schema.discount_policies p WHERE p.id = $1`,
      [id],
    );
    return result.rows[0] ? toPolicy(result.rows[0]) : undefined;
  }

  async createPolicy(tenantId: string, record: DiscountPolicyRecord, actorId: string): Promise<string> {
    try {
      return await this.database.transaction(tenantId, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.discount_policies
             (code, name, priority, stacking, exclusive, percent, valid_from, valid_to, status,
              applies_to_all_customers, note, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
           RETURNING id`,
          [...policyValues(record), actorId],
        );
        const id = result.rows[0].id;
        await insertRules(client, id, record.rules);
        return id;
      });
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_discount_policies_code')) throw POLICY_CODE_EXISTS();
      throw error;
    }
  }

  async updatePolicy(tenantId: string, id: string, record: DiscountPolicyRecord, actorId: string): Promise<boolean> {
    try {
      return await this.database.transaction(tenantId, async (client) => {
        const result = await client.query(
          `UPDATE crm_schema.discount_policies
              SET code = $2, name = $3, priority = $4, stacking = $5, exclusive = $6, percent = $7,
                  valid_from = $8, valid_to = $9, status = $10, applies_to_all_customers = $11, note = $12,
                  updated_at = now(), updated_by = $13
            WHERE id = $1`,
          [id, ...policyValues(record), actorId],
        );
        if (!result.rowCount) return false;
        await client.query(`DELETE FROM crm_schema.discount_policy_rules WHERE policy_id = $1`, [id]);
        await insertRules(client, id, record.rules);
        return true;
      });
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_discount_policies_code')) throw POLICY_CODE_EXISTS();
      throw error;
    }
  }

  async deletePolicy(tenantId: string, id: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query(`DELETE FROM crm_schema.discount_policies WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  missingCustomerGroups(tenantId: string, ids: readonly string[]): Promise<string[]> {
    return this.missing(tenantId, 'customer_groups', ids);
  }

  missingCustomers(tenantId: string, ids: readonly string[]): Promise<string[]> {
    return this.missing(tenantId, 'customers', ids);
  }

  private async missing(tenantId: string, table: 'customer_groups' | 'customers', ids: readonly string[]): Promise<string[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string }>(
      `SELECT wanted.id::text AS id FROM unnest($1::uuid[]) AS wanted(id)
        WHERE NOT EXISTS (SELECT 1 FROM crm_schema.${table} t WHERE t.id = wanted.id)`,
      [[...new Set(ids)]],
    );
    return result.rows.map((row) => row.id);
  }
}

function policyValues(record: DiscountPolicyRecord): unknown[] {
  return [
    record.code,
    record.name,
    record.priority,
    record.stacking,
    record.exclusive,
    record.percent,
    record.validFrom,
    record.validTo,
    record.status,
    record.appliesToAllCustomers,
    record.note,
  ];
}

async function insertRules(client: PoolClient, policyId: string, rules: readonly DiscountPolicyRule[]): Promise<void> {
  if (!rules.length) return;
  await client.query(
    `INSERT INTO crm_schema.discount_policy_rules
       (policy_id, criterion, min_qty, max_qty, ref_id, ref_text, from_date, to_date, percent, position)
     SELECT $1, r.criterion, r.min_qty, r.max_qty, r.ref_id, r.ref_text, r.from_date, r.to_date, r.percent, r.position
       FROM jsonb_to_recordset($2::jsonb) AS r(
              criterion text, min_qty numeric, max_qty numeric, ref_id uuid, ref_text text,
              from_date date, to_date date, percent numeric, position int)`,
    [
      policyId,
      JSON.stringify(
        rules.map((rule, position) => ({
          criterion: rule.criterion,
          min_qty: rule.minQty ?? null,
          max_qty: rule.maxQty ?? null,
          ref_id: rule.refId ?? null,
          ref_text: rule.refText ?? null,
          from_date: rule.fromDate ?? null,
          to_date: rule.toDate ?? null,
          percent: rule.percent ?? null,
          position,
        })),
      ),
    ],
  );
}

function toRule(rule: RuleJson): DiscountPolicyRule {
  const number = (value: number | string | null) => (value === null ? null : Number(value));
  return {
    criterion: rule.criterion,
    minQty: number(rule.min_qty),
    maxQty: number(rule.max_qty),
    refId: rule.ref_id,
    refText: rule.ref_text,
    fromDate: rule.from_date,
    toDate: rule.to_date,
    percent: number(rule.percent),
  };
}

function toPolicy(row: PolicyRow): DiscountPolicy {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priority: Number(row.priority),
    stacking: row.stacking,
    exclusive: row.exclusive,
    percent: row.percent === null ? null : Number(row.percent),
    validFrom: toDateOnly(row.valid_from) as string,
    validTo: toDateOnly(row.valid_to),
    status: row.status,
    appliesToAllCustomers: row.applies_to_all_customers,
    note: row.note,
    rules: (row.rules ?? []).map(toRule),
    updatedAt: toIso(row.updated_at) as string,
  };
}

// ---------------------------------------------------------------------------
// Dữ liệu cho engine giá
// ---------------------------------------------------------------------------

export class PostgresPricingStore implements PricingStore {
  constructor(private readonly database: CrmDatabase) {}

  async discountCapPercent(tenantId: string): Promise<number> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
      DISCOUNT_CAP_SETTING_KEY,
    ]);
    return parseDiscountCap(result.rows[0]?.value);
  }

  async saveDiscountCapPercent(tenantId: string, percent: number, actorId: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(
      `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
             updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [DISCOUNT_CAP_SETTING_KEY, JSON.stringify({ percent }), actorId],
    );
  }

  async priceListsForPricing(
    tenantId: string,
    date: string,
    customerGroupId: string | null,
    materialIds: readonly string[],
  ): Promise<PricingPriceList[]> {
    const pool = await this.database.pool(tenantId);
    const lists = await pool.query<{
      id: string;
      code: string;
      is_standard: boolean;
      valid_from: string | Date;
      valid_to: string | Date | null;
      status: PricingStatus;
      group_ids: string[];
    }>(
      `SELECT l.id, l.code, l.is_standard, l.valid_from, l.valid_to, l.status,
              COALESCE((SELECT array_agg(g.customer_group_id::text) FROM crm_schema.price_list_customer_groups g
                         WHERE g.price_list_id = l.id), '{}') AS group_ids
         FROM crm_schema.price_lists l
        WHERE l.status = 'ACTIVE' AND l.valid_from <= $1::date AND (l.valid_to IS NULL OR l.valid_to >= $1::date)
          AND (l.is_standard OR EXISTS (SELECT 1 FROM crm_schema.price_list_customer_groups g
                                         WHERE g.price_list_id = l.id AND g.customer_group_id = $2::uuid))`,
      [date, customerGroupId],
    );
    if (!lists.rows.length || !materialIds.length) {
      return lists.rows.map((row) => toPricingList(row, []));
    }
    const items = await pool.query<{ price_list_id: string; material_id: string; unit: string; price: string; vat_rate: string }>(
      `SELECT price_list_id, material_id, unit, price, vat_rate FROM crm_schema.price_list_items
        WHERE price_list_id = ANY($1::uuid[]) AND material_id = ANY($2::uuid[])`,
      [lists.rows.map((row) => row.id), materialIds],
    );
    return lists.rows.map((row) =>
      toPricingList(
        row,
        items.rows
          .filter((item) => item.price_list_id === row.id)
          .map((item) => ({ materialId: item.material_id, unit: item.unit, price: Number(item.price), vatRate: Number(item.vat_rate) })),
      ),
    );
  }

  async policiesForPricing(tenantId: string, date: string): Promise<PricingPolicy[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PolicyRow>(
      `SELECT ${POLICY_COLUMNS} FROM crm_schema.discount_policies p
        WHERE p.status = 'ACTIVE' AND p.valid_from <= $1::date AND (p.valid_to IS NULL OR p.valid_to >= $1::date)`,
      [date],
    );
    return result.rows.map(toPolicy);
  }
}

function toPricingList(
  row: { id: string; code: string; is_standard: boolean; valid_from: string | Date; valid_to: string | Date | null; status: PricingStatus; group_ids: string[] },
  items: PricingPriceList['items'],
): PricingPriceList {
  return {
    id: row.id,
    code: row.code,
    isStandard: row.is_standard,
    validFrom: toDateOnly(row.valid_from) as string,
    validTo: toDateOnly(row.valid_to),
    status: row.status,
    customerGroupIds: row.group_ids,
    items,
  };
}

export function parseDiscountCap(value: unknown): number {
  const percent = Number((value as { percent?: unknown } | null | undefined)?.percent);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : DEFAULT_DISCOUNT_CAP_PERCENT;
}
