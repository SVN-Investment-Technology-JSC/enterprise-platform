import {
  DEFAULT_DISCOUNT_CAP_PERCENT,
  DEFAULT_PRICE_LIST_CODE,
  DEFAULT_PRICE_LIST_NAME,
  DEFAULT_VAT_RATE,
  PRICE_LIST_RATIO_DEFAULT,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type DiscountStacking,
  type PriceListDetail,
  type PriceListItem,
  type PriceListSummary,
  type PriceListSyncResult,
  type PriceListType,
  type PriceMode,
  type PricingStatus,
} from '@enterprise-platform/contracts-crm';
import type { Pool, PoolClient } from 'pg';
import { priceListReadOnly } from '../application/price-list.service.js';
import type {
  CatalogSyncState,
  DiscountPolicyRecord,
  DiscountPolicyStore,
  PriceListItemRecord,
  PriceListRecord,
  PriceListRef,
  PriceListStore,
  PriceListSyncStore,
  PricedMaterial,
  PricedMaterialsQuery,
  PricingStore,
  SyncDefaultPriceListInput,
} from '../application/pricing-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import {
  ratioPrice,
  type PricingContractPrice,
  type PricingPolicy,
  type PricingPriceList,
} from '../domain/pricing-engine.js';
import type { CrmDatabase } from './crm.database.js';
import { constraintViolation, containsPattern, toDateOnly, toIso } from './sql-helpers.js';

/** Khoá cấu hình trần chiết khấu tổng (migration 0005 ghi giá trị mặc định). */
export const DISCOUNT_CAP_SETTING_KEY = 'pricing.discountCap';
/** Khoá dấu vân tay danh mục Kho ở lần đồng bộ bảng giá mặc định gần nhất. */
export const CATALOG_SYNC_SETTING_KEY = 'pricing.catalogSync';

/**
 * Khoá tư vấn giữ trong transaction khi ghi bảng mặc định hoặc bảng theo tỷ lệ: đồng bộ Kho, tạo bảng, đổi tỷ lệ, nhập
 * hoặc bỏ giá tay, sửa thuế suất chạy lần lượt, không ghi đè nhau.
 */
const PRICE_LIST_SYNC_LOCK = 'crm_schema.price_lists.sync';

interface PriceListRow {
  id: string;
  code: string;
  name: string;
  is_standard: boolean;
  list_type: PriceListType;
  ratio_percent: string | null;
  valid_from: string | Date;
  valid_to: string | Date | null;
  status: PricingStatus;
  note: string | null;
  item_count: number;
  usage_count: number;
  updated_at: Date;
}

interface PriceListItemRow {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  price: string | null;
  vat_rate: string;
  price_mode: PriceMode;
  source_active: boolean;
}

/** Số phiên bản báo giá và đơn bán dùng bảng giá `listId` (biểu thức SQL). */
const USAGE_COUNT_SQL = (listId: string) => `
  ((SELECT count(*) FROM crm_schema.quote_versions v WHERE v.price_list_id = ${listId})
   + (SELECT count(*) FROM crm_schema.sales_orders o WHERE o.price_list_id = ${listId}))::int`;

const PRICE_LIST_COLUMNS = `
  l.id, l.code, l.name, l.is_standard, l.list_type, l.ratio_percent, l.valid_from, l.valid_to, l.status, l.note,
  l.updated_at,
  (SELECT count(*)::int FROM crm_schema.price_list_items i WHERE i.price_list_id = l.id) AS item_count,
  ${USAGE_COUNT_SQL('l.id')} AS usage_count`;

const PRICE_LIST_CODE_EXISTS = () => new CrmConflictError('PRICE_LIST_CODE_EXISTS', 'Mã bảng giá đã tồn tại.');
const ITEM_EXISTS = () =>
  new CrmConflictError('PRICE_LIST_ITEM_EXISTS', 'Mặt hàng với đơn vị tính này đã có trong bảng giá.');
const DEFAULT_PRICE_LIST_MISSING = () =>
  new CrmConflictError(
    'DEFAULT_PRICE_LIST_MISSING',
    'Chưa có bảng giá mặc định. Vui lòng đồng bộ bảng giá với Kho trước.',
  );
const PRICE_LIST_IN_USE = () =>
  new CrmConflictError(
    'PRICE_LIST_IN_USE',
    'Bảng giá đang được dùng trong báo giá hoặc đơn bán; hãy chuyển sang Ngừng áp dụng.',
  );

/** Ngày bắt đầu hiệu lực của bảng giá mặc định (bảng không có thời hạn). */
const DEFAULT_PRICE_LIST_VALID_FROM = '2000-01-01';

export class PostgresPriceListStore implements PriceListStore {
  constructor(private readonly database: CrmDatabase) {}

  async listPriceLists(tenantId: string): Promise<PriceListSummary[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PriceListRow>(
      `SELECT ${PRICE_LIST_COLUMNS} FROM crm_schema.price_lists l
        ORDER BY (l.list_type = 'DEFAULT') DESC, l.valid_from DESC, l.code`,
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
      `SELECT id, material_id, material_code, material_name, unit, price, vat_rate, price_mode, source_active
         FROM crm_schema.price_list_items
        WHERE price_list_id = $1
        ORDER BY material_code, unit`,
      [id],
    );
    return { ...toPriceListSummary(header.rows[0]), items: items.rows.map(toItem) };
  }

  async priceListRef(tenantId: string, id: string): Promise<PriceListRef | undefined> {
    return findPriceListRef(await this.database.pool(tenantId), id);
  }

  async createPriceList(tenantId: string, record: PriceListRecord, actorId: string): Promise<string> {
    try {
      return await this.database.transaction(tenantId, async (client) => {
        await lockPriceLists(client);
        const defaultId = await findDefaultId(client);
        if (!defaultId) throw DEFAULT_PRICE_LIST_MISSING();
        const ratio = record.ratioPercent ?? PRICE_LIST_RATIO_DEFAULT;
        const base = await loadItems(client, [defaultId]);
        // Tính trước khi ghi: giá vượt giới hạn thì không ghi gì.
        const rows = base.map((row) => ({ ...row, listId: '', price: ratioPrice(row.price, ratio), mode: 'RATIO' as const }));
        const result = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.price_lists
             (code, name, is_standard, list_type, ratio_percent, valid_from, valid_to, status, note, created_by, updated_by)
           VALUES ($1, $2, FALSE, 'DERIVED', $3, $4, $5, $6, $7, $8, $8)
           RETURNING id`,
          [record.code, record.name, ratio, record.validFrom, record.validTo, record.status, record.note, actorId],
        );
        const id = result.rows[0].id;
        await insertItems(client, rows.map((row) => ({ ...row, listId: id })), actorId);
        return id;
      });
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_price_lists_code')) throw PRICE_LIST_CODE_EXISTS();
      throw error;
    }
  }

  async updatePriceList(tenantId: string, id: string, record: PriceListRecord, actorId: string): Promise<boolean> {
    try {
      return await this.database.transaction(tenantId, async (client) => {
        await lockPriceLists(client);
        const current = await client.query<{ list_type: PriceListType; ratio_percent: string | null }>(
          `SELECT list_type, ratio_percent FROM crm_schema.price_lists WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) return false;
        if (row.list_type === 'DEFAULT') throw priceListReadOnly('DEFAULT');
        const oldRatio = row.ratio_percent === null ? null : Number(row.ratio_percent);
        const ratio = row.list_type === 'DERIVED' ? (record.ratioPercent ?? oldRatio) : null;
        await client.query(
          `UPDATE crm_schema.price_lists
              SET code = $2, name = $3, ratio_percent = $4, valid_from = $5, valid_to = $6, status = $7,
                  note = $8, updated_at = now(), updated_by = $9
            WHERE id = $1`,
          [id, record.code, record.name, ratio, record.validFrom, record.validTo, record.status, record.note, actorId],
        );
        if (row.list_type === 'DERIVED' && ratio !== null && ratio !== oldRatio) {
          await recomputeRatioRows(client, id, ratio, actorId);
        }
        return true;
      });
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_price_lists_code')) throw PRICE_LIST_CODE_EXISTS();
      throw error;
    }
  }

  async deletePriceList(tenantId: string, id: string): Promise<boolean> {
    try {
      return await this.database.transaction(tenantId, async (client) => {
        const usage = await client.query<{ usage_count: number }>(`SELECT ${USAGE_COUNT_SQL('$1::uuid')} AS usage_count`, [id]);
        if (Number(usage.rows[0]?.usage_count ?? 0) > 0) throw PRICE_LIST_IN_USE();
        const result = await client.query(`DELETE FROM crm_schema.price_lists WHERE id = $1`, [id]);
        return (result.rowCount ?? 0) > 0;
      });
    } catch (error) {
      // Báo giá, đơn vừa chọn bảng này sau khi đếm: khoá ngoại chặn.
      if (constraintViolation(error, '23503')) throw PRICE_LIST_IN_USE();
      throw error;
    }
  }

  async setManualPrice(tenantId: string, priceListId: string, itemId: string, price: number, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      await lockPriceLists(client);
      const result = await client.query(
        `UPDATE crm_schema.price_list_items i
            SET price = $3, price_mode = 'MANUAL', updated_at = now(), updated_by = $4
           FROM crm_schema.price_lists l
          WHERE i.id = $2 AND i.price_list_id = $1 AND l.id = i.price_list_id AND l.list_type = 'DERIVED'`,
        [priceListId, itemId, price, actorId],
      );
      const saved = (result.rowCount ?? 0) > 0;
      if (saved) await touch(client, priceListId, actorId);
      return saved;
    });
  }

  async clearManualPrice(tenantId: string, priceListId: string, itemId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      await lockPriceLists(client);
      const found = await client.query<{ price_mode: PriceMode; material_id: string; ratio_percent: string | null }>(
        `SELECT i.price_mode, i.material_id, l.ratio_percent
           FROM crm_schema.price_list_items i
           JOIN crm_schema.price_lists l ON l.id = i.price_list_id
          WHERE i.id = $2 AND i.price_list_id = $1 AND l.list_type = 'DERIVED'
          FOR UPDATE OF i`,
        [priceListId, itemId],
      );
      const row = found.rows[0];
      if (!row) return false;
      if (row.price_mode === 'RATIO') return true;
      const base = await client.query<{ price: string | null }>(
        `SELECT d.price FROM crm_schema.price_list_items d
           JOIN crm_schema.price_lists dl ON dl.id = d.price_list_id AND dl.list_type = 'DEFAULT'
          WHERE d.material_id = $1 LIMIT 1`,
        [row.material_id],
      );
      const price = ratioPrice(toPrice(base.rows[0]?.price ?? null), Number(row.ratio_percent ?? PRICE_LIST_RATIO_DEFAULT));
      await client.query(
        `UPDATE crm_schema.price_list_items SET price = $2, price_mode = 'RATIO', updated_at = now(), updated_by = $3 WHERE id = $1`,
        [itemId, price, actorId],
      );
      await touch(client, priceListId, actorId);
      return true;
    });
  }

  async setVatRate(tenantId: string, priceListId: string, itemId: string, vatRate: number, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      await lockPriceLists(client);
      const updated = await client.query<{ material_id: string }>(
        `UPDATE crm_schema.price_list_items i
            SET vat_rate = $3, updated_at = now(), updated_by = $4
           FROM crm_schema.price_lists l
          WHERE i.id = $2 AND i.price_list_id = $1 AND l.id = i.price_list_id AND l.list_type = 'DEFAULT'
          RETURNING i.material_id`,
        [priceListId, itemId, vatRate, actorId],
      );
      const materialId = updated.rows[0]?.material_id;
      if (!materialId) return false;
      // Bảng theo tỷ lệ lấy thuế suất theo bảng mặc định (D8).
      await client.query(
        `UPDATE crm_schema.price_list_items i
            SET vat_rate = $2, updated_at = now(), updated_by = $3
           FROM crm_schema.price_lists l
          WHERE l.id = i.price_list_id AND l.list_type = 'DERIVED' AND i.material_id = $1 AND i.vat_rate <> $2`,
        [materialId, vatRate, actorId],
      );
      await touch(client, priceListId, actorId);
      return true;
    });
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

type Queryable = Pick<Pool, 'query'> | PoolClient;

async function lockPriceLists(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [PRICE_LIST_SYNC_LOCK]);
}

async function findDefaultId(client: Queryable): Promise<string | null> {
  const result = await client.query<{ id: string }>(`SELECT id FROM crm_schema.price_lists WHERE list_type = 'DEFAULT'`);
  return result.rows[0]?.id ?? null;
}

async function findPriceListRef(client: Queryable, id: string): Promise<PriceListRef | undefined> {
  const result = await client.query<{
    id: string;
    code: string;
    name: string;
    list_type: PriceListType;
    status: PricingStatus;
    valid_from: string | Date;
    valid_to: string | Date | null;
  }>(
    `SELECT id, code, name, list_type, status, valid_from, valid_to FROM crm_schema.price_lists WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        code: row.code,
        name: row.name,
        listType: row.list_type,
        status: row.status,
        validFrom: toDateOnly(row.valid_from) as string,
        validTo: toDateOnly(row.valid_to),
      }
    : undefined;
}

/** Dòng giá như trong DB, để so và ghi hàng loạt. */
interface ItemState {
  readonly id: string;
  readonly listId: string;
  readonly materialId: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly price: number | null;
  readonly vatRate: number;
  readonly mode: PriceMode;
  readonly sourceActive: boolean;
}

type ItemWrite = Omit<ItemState, 'id'>;

function toPrice(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

async function loadItems(client: PoolClient, listIds: readonly string[]): Promise<ItemState[]> {
  if (!listIds.length) return [];
  const result = await client.query<PriceListItemRow & { price_list_id: string }>(
    `SELECT id, price_list_id, material_id, material_code, material_name, unit, price, vat_rate, price_mode, source_active
       FROM crm_schema.price_list_items
      WHERE price_list_id = ANY($1::uuid[])
      ORDER BY price_list_id, material_id, created_at, id`,
    [listIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    listId: row.price_list_id,
    materialId: row.material_id,
    code: row.material_code,
    name: row.material_name,
    unit: row.unit,
    price: toPrice(row.price),
    vatRate: Number(row.vat_rate),
    mode: row.price_mode,
    sourceActive: row.source_active,
  }));
}

/** Một câu lệnh cho mọi dòng, có thể thuộc nhiều bảng. */
async function insertItems(client: PoolClient, rows: readonly ItemWrite[], actorId: string): Promise<void> {
  if (!rows.length) return;
  await client.query(
    `INSERT INTO crm_schema.price_list_items
       (price_list_id, material_id, material_code, material_name, unit, price, vat_rate, price_mode, source_active,
        created_by, updated_by)
     SELECT u.list_id, u.material_id, u.code, u.name, u.unit, u.price, u.vat_rate, u.mode, u.active, $10, $10
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[],
                   $9::boolean[]) AS u(list_id, material_id, code, name, unit, price, vat_rate, mode, active)`,
    [
      rows.map((row) => row.listId),
      rows.map((row) => row.materialId),
      rows.map((row) => row.code),
      rows.map((row) => row.name),
      rows.map((row) => row.unit),
      rows.map((row) => row.price),
      rows.map((row) => row.vatRate),
      rows.map((row) => row.mode),
      rows.map((row) => row.sourceActive),
      actorId,
    ],
  );
}

/** Cập nhật theo id dòng (đổi đơn vị tại chỗ, không đụng khoá duy nhất theo mặt hàng của dòng khác). */
async function updateItems(client: PoolClient, rows: readonly ItemState[], actorId: string): Promise<void> {
  if (!rows.length) return;
  await client.query(
    `UPDATE crm_schema.price_list_items i
        SET material_code = u.code, material_name = u.name, unit = u.unit, price = u.price, vat_rate = u.vat_rate,
            price_mode = u.mode, source_active = u.active, updated_at = now(), updated_by = $9
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::text[],
                   $8::boolean[]) AS u(id, code, name, unit, price, vat_rate, mode, active)
      WHERE i.id = u.id`,
    [
      rows.map((row) => row.id),
      rows.map((row) => row.code),
      rows.map((row) => row.name),
      rows.map((row) => row.unit),
      rows.map((row) => row.price),
      rows.map((row) => row.vatRate),
      rows.map((row) => row.mode),
      rows.map((row) => row.sourceActive),
      actorId,
    ],
  );
}

async function deleteItems(client: PoolClient, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await client.query(`DELETE FROM crm_schema.price_list_items WHERE id = ANY($1::uuid[])`, [ids]);
}

function sameItem(left: ItemState, right: ItemState): boolean {
  return (
    left.code === right.code &&
    left.name === right.name &&
    left.unit === right.unit &&
    left.price === right.price &&
    left.vatRate === right.vatRate &&
    left.mode === right.mode &&
    left.sourceActive === right.sourceActive
  );
}

/** Đổi tỷ lệ bảng `DERIVED`: tính lại dòng `RATIO` theo bảng mặc định, giữ dòng giá tay. */
async function recomputeRatioRows(client: PoolClient, listId: string, ratio: number, actorId: string): Promise<void> {
  const defaultId = await findDefaultId(client);
  const base = new Map((defaultId ? await loadItems(client, [defaultId]) : []).map((row) => [row.materialId, row]));
  const updates: ItemState[] = [];
  for (const row of await loadItems(client, [listId])) {
    if (row.mode !== 'RATIO') continue;
    const price = ratioPrice(base.get(row.materialId)?.price ?? null, ratio);
    if (price !== row.price) updates.push({ ...row, price });
  }
  await updateItems(client, updates, actorId);
}

/**
 * Khớp dòng của một bảng `DERIVED` 1-1 với dòng bảng mặc định theo `material_id`: dòng `RATIO` tính lại giá; dòng
 * `MANUAL` giữ giá; cả hai lấy mã, tên, đơn vị, thuế suất, trạng thái Kho theo bảng mặc định. Trả các dòng cần ghi.
 */
function planDerived(
  listId: string,
  ratio: number,
  base: readonly ItemState[],
  items: readonly ItemState[],
): { inserts: ItemWrite[]; updates: ItemState[]; deletes: string[]; manualRemoved: number } {
  const byMaterial = new Map<string, ItemState>();
  const deletes: string[] = [];
  let manualRemoved = 0;
  for (const item of items) {
    if (byMaterial.has(item.materialId)) deletes.push(item.id);
    else byMaterial.set(item.materialId, item);
  }
  const inserts: ItemWrite[] = [];
  const updates: ItemState[] = [];
  const baseMaterials = new Set<string>();
  for (const row of base) {
    baseMaterials.add(row.materialId);
    const current = byMaterial.get(row.materialId);
    const shared = { code: row.code, name: row.name, unit: row.unit, vatRate: row.vatRate, sourceActive: row.sourceActive };
    if (!current) {
      inserts.push({ ...shared, listId, materialId: row.materialId, price: ratioPrice(row.price, ratio), mode: 'RATIO' });
      continue;
    }
    const next: ItemState = {
      ...current,
      ...shared,
      price: current.mode === 'MANUAL' ? current.price : ratioPrice(row.price, ratio),
      mode: current.mode === 'MANUAL' ? 'MANUAL' : 'RATIO',
    };
    if (!sameItem(current, next)) updates.push(next);
  }
  for (const item of byMaterial.values()) {
    if (baseMaterials.has(item.materialId)) continue;
    deletes.push(item.id);
    if (item.mode === 'MANUAL') manualRemoved += 1;
  }
  return { inserts, updates, deletes, manualRemoved };
}

async function touch(client: Queryable, priceListId: string, actorId: string): Promise<void> {
  await client.query(`UPDATE crm_schema.price_lists SET updated_at = now(), updated_by = $2 WHERE id = $1`, [
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
    listType: row.list_type,
    ratioPercent: row.ratio_percent === null ? null : Number(row.ratio_percent),
    isStandard: row.is_standard,
    currency: 'VND',
    validFrom: toDateOnly(row.valid_from) as string,
    validTo: toDateOnly(row.valid_to),
    status: row.status,
    note: row.note,
    itemCount: Number(row.item_count),
    usageCount: Number(row.usage_count ?? 0),
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
    price: toPrice(row.price),
    vatRate: Number(row.vat_rate),
    priceMode: row.price_mode,
    sourceActive: row.source_active,
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
    priceListId: string | null,
    materialIds: readonly string[],
  ): Promise<PricingPriceList[]> {
    if (!priceListId) return [];
    const pool = await this.database.pool(tenantId);
    const lists = await pool.query<{
      id: string;
      code: string;
      is_standard: boolean;
      valid_from: string | Date;
      valid_to: string | Date | null;
      status: PricingStatus;
    }>(
      `SELECT l.id, l.code, l.is_standard, l.valid_from, l.valid_to, l.status
         FROM crm_schema.price_lists l
        WHERE l.status = 'ACTIVE' AND l.valid_from <= $1::date AND (l.valid_to IS NULL OR l.valid_to >= $1::date)
          AND l.id = $2::uuid`,
      [date, priceListId],
    );
    if (!lists.rows.length || !materialIds.length) {
      return lists.rows.map((row) => toPricingList(row, []));
    }
    const items = await pool.query<{ price_list_id: string; material_id: string; unit: string; price: string | null; vat_rate: string }>(
      `SELECT price_list_id, material_id, unit, price, vat_rate FROM crm_schema.price_list_items
        WHERE price_list_id = ANY($1::uuid[]) AND material_id = ANY($2::uuid[])`,
      [lists.rows.map((row) => row.id), materialIds],
    );
    return lists.rows.map((row) =>
      toPricingList(
        row,
        items.rows
          .filter((item) => item.price_list_id === row.id)
          .map((item) => ({ materialId: item.material_id, unit: item.unit, price: toPrice(item.price), vatRate: Number(item.vat_rate) })),
      ),
    );
  }

  async priceListRef(tenantId: string, id: string): Promise<PriceListRef | undefined> {
    return findPriceListRef(await this.database.pool(tenantId), id);
  }

  async pricedMaterials(tenantId: string, query: PricedMaterialsQuery): Promise<PricedMaterial[]> {
    // Chưa chọn bảng giá: không lộ mặt hàng nào (chưa thêm được dòng hàng).
    if (!query.priceListId) return [];
    const pool = await this.database.pool(tenantId);
    const search = query.search.trim();
    const result = await pool.query<{ material_id: string; code: string; units: string[] }>(
      `WITH priced AS (
         SELECT i.material_id, i.material_code AS code, i.material_name AS name, i.unit
           FROM crm_schema.price_list_items i
           JOIN crm_schema.price_lists l ON l.id = i.price_list_id
          WHERE l.status = 'ACTIVE' AND l.valid_from <= $1::date AND (l.valid_to IS NULL OR l.valid_to >= $1::date)
            AND l.id = $2::uuid
         UNION ALL
         SELECT cl.material_id, cl.material_code, cl.material_name, cl.unit
           FROM crm_schema.contracts c
           JOIN crm_schema.contract_lines cl ON cl.contract_id = c.id
          WHERE $3::uuid IS NOT NULL AND c.customer_id = $3::uuid AND c.type IN ('FRAMEWORK', 'PRINCIPLE')
            AND c.status = 'ACTIVE' AND c.valid_from <= $1::date AND (c.valid_to IS NULL OR c.valid_to >= $1::date)
       )
       SELECT material_id, min(code) AS code, array_agg(DISTINCT lower(btrim(unit))) AS units
         FROM priced
        WHERE $4::text IS NULL OR code ILIKE $4 OR name ILIKE $4
        GROUP BY material_id
       HAVING $6::text IS NULL OR min(code) > $6
        ORDER BY min(code), material_id
        LIMIT $5`,
      [query.date, query.priceListId, query.customerId, search ? containsPattern(search) : null, query.limit, query.cursor ?? null],
    );
    return result.rows.map((row) => ({ materialId: row.material_id, code: row.code, units: row.units }));
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

  async contractPricesForPricing(
    tenantId: string,
    date: string,
    customerId: string | null,
    materialIds: readonly string[],
    contractId?: string | null,
  ): Promise<PricingContractPrice[]> {
    if (!materialIds.length || (!customerId && !contractId)) return [];
    const pool = await this.database.pool(tenantId);
    // Đơn từ hợp đồng: đúng hợp đồng đó; còn lại: hợp đồng khung, nguyên tắc của khách.
    const result = await pool.query<{
      contract_id: string;
      code: string;
      material_id: string;
      unit: string;
      unit_price: string;
      vat_rate: string;
      valid_from: string | Date;
      valid_to: string | Date | null;
    }>(
      `SELECT c.id AS contract_id, c.code, l.material_id, l.unit, l.unit_price, l.vat_rate, c.valid_from, c.valid_to
         FROM crm_schema.contracts c
         JOIN crm_schema.contract_lines l ON l.contract_id = c.id
        WHERE c.status = 'ACTIVE' AND c.valid_from <= $1::date AND (c.valid_to IS NULL OR c.valid_to >= $1::date)
          AND l.material_id = ANY($2::uuid[])
          AND (CASE WHEN $3::uuid IS NOT NULL THEN c.id = $3::uuid
                    ELSE c.customer_id = $4::uuid AND c.type IN ('FRAMEWORK', 'PRINCIPLE') END)
        ORDER BY c.valid_from DESC, c.code`,
      [date, materialIds, contractId ?? null, customerId],
    );
    return result.rows.map((row) => ({
      contractId: row.contract_id,
      contractCode: row.code,
      materialId: row.material_id,
      unit: row.unit,
      price: Number(row.unit_price),
      vatRate: Number(row.vat_rate),
      validFrom: toDateOnly(row.valid_from) as string,
      validTo: toDateOnly(row.valid_to),
    }));
  }
}

function toPricingList(
  row: { id: string; code: string; is_standard: boolean; valid_from: string | Date; valid_to: string | Date | null; status: PricingStatus },
  items: PricingPriceList['items'],
): PricingPriceList {
  return {
    id: row.id,
    code: row.code,
    isStandard: row.is_standard,
    validFrom: toDateOnly(row.valid_from) as string,
    validTo: toDateOnly(row.valid_to),
    status: row.status,
    items,
  };
}

export function parseDiscountCap(value: unknown): number {
  const percent = Number((value as { percent?: unknown } | null | undefined)?.percent);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : DEFAULT_DISCOUNT_CAP_PERCENT;
}

// ---------------------------------------------------------------------------
// Đồng bộ bảng giá mặc định với Kho
// ---------------------------------------------------------------------------

/** Mã cho bảng mặc định mới: `BG-MAC-DINH`, trùng thì `-1`, `-2`... */
async function nextDefaultCode(client: PoolClient): Promise<string> {
  const taken = await client.query<{ code: string }>(
    `SELECT code FROM crm_schema.price_lists WHERE code = $1 OR code LIKE $2`,
    [DEFAULT_PRICE_LIST_CODE, `${DEFAULT_PRICE_LIST_CODE}-%`],
  );
  const codes = new Set(taken.rows.map((row) => row.code));
  if (!codes.has(DEFAULT_PRICE_LIST_CODE)) return DEFAULT_PRICE_LIST_CODE;
  for (let suffix = 1; ; suffix += 1) {
    const code = `${DEFAULT_PRICE_LIST_CODE}-${suffix}`;
    if (!codes.has(code)) return code;
  }
}

function parseCatalogSyncState(value: unknown): CatalogSyncState | null {
  const raw = value as Partial<Record<keyof CatalogSyncState, unknown>> | null | undefined;
  if (!raw || typeof raw.fingerprint !== 'string' || typeof raw.syncedAt !== 'string') return null;
  return {
    fingerprint: raw.fingerprint,
    count: Number(raw.count) || 0,
    syncedAt: raw.syncedAt,
    syncedBy: typeof raw.syncedBy === 'string' ? raw.syncedBy : null,
  };
}

export class PostgresPriceListSyncStore implements PriceListSyncStore {
  constructor(private readonly database: CrmDatabase) {}

  async defaultPriceListId(tenantId: string): Promise<string | null> {
    return findDefaultId(await this.database.pool(tenantId));
  }

  async catalogSyncState(tenantId: string): Promise<CatalogSyncState | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
      CATALOG_SYNC_SETTING_KEY,
    ]);
    return parseCatalogSyncState(result.rows[0]?.value);
  }

  async syncDefaultPriceList(tenantId: string, input: SyncDefaultPriceListInput, actorId: string): Promise<PriceListSyncResult> {
    return this.database.transaction(tenantId, async (client) => {
      await client.query(`SET LOCAL statement_timeout = '60s'`);
      await lockPriceLists(client);

      let defaultId = await findDefaultId(client);
      if (!defaultId) {
        // Bảng mặc định không có thời hạn: hiệu lực từ mốc xa để báo giá có ngày tính giá trước lần đồng bộ đầu vẫn chọn được.
        const created = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.price_lists (code, name, is_standard, list_type, valid_from, status, created_by, updated_by)
           VALUES ($1, $2, FALSE, 'DEFAULT', $3, 'ACTIVE', $4, $4)
           RETURNING id`,
          [await nextDefaultCode(client), DEFAULT_PRICE_LIST_NAME, DEFAULT_PRICE_LIST_VALID_FROM, actorId],
        );
        defaultId = created.rows[0].id;
      }

      // Bảng mặc định: một dòng mỗi mặt hàng, khoá theo material_id; giữ thuế suất đã sửa.
      const existing = new Map<string, ItemState>();
      const defaultDeletes: string[] = [];
      for (const row of await loadItems(client, [defaultId])) {
        if (existing.has(row.materialId)) defaultDeletes.push(row.id);
        else existing.set(row.materialId, row);
      }
      const inserts: ItemWrite[] = [];
      const updates: ItemState[] = [];
      const seen = new Set<string>();
      for (const material of input.materials) {
        if (seen.has(material.id)) continue;
        seen.add(material.id);
        const synced = {
          code: material.code,
          name: material.name,
          unit: material.unit,
          price: material.salePrice,
          sourceActive: material.isActive,
          mode: 'SYNCED' as const,
        };
        const current = existing.get(material.id);
        if (!current) {
          inserts.push({ ...synced, listId: defaultId, materialId: material.id, vatRate: DEFAULT_VAT_RATE });
          continue;
        }
        const next: ItemState = { ...current, ...synced };
        if (!sameItem(current, next)) updates.push(next);
      }
      for (const row of existing.values()) if (!seen.has(row.materialId)) defaultDeletes.push(row.id);
      await deleteItems(client, defaultDeletes);
      await updateItems(client, updates, actorId);
      await insertItems(client, inserts, actorId);
      const defaultChanged = defaultDeletes.length + updates.length + inserts.length > 0;
      if (defaultChanged) await touch(client, defaultId, actorId);

      // Mọi bảng theo tỷ lệ (kể cả ngừng áp dụng, hết hiệu lực): khớp 1-1 với bảng mặc định.
      const base = await loadItems(client, [defaultId]);
      const derived = await client.query<{ id: string; ratio_percent: string }>(
        `SELECT id, ratio_percent FROM crm_schema.price_lists WHERE list_type = 'DERIVED' ORDER BY id FOR UPDATE`,
      );
      const derivedItems = await loadItems(client, derived.rows.map((row) => row.id));
      const derivedInserts: ItemWrite[] = [];
      const derivedUpdates: ItemState[] = [];
      const derivedDeletes: string[] = [];
      let manualPricesRemoved = 0;
      let derivedListsUpdated = 0;
      for (const list of derived.rows) {
        const plan = planDerived(
          list.id,
          Number(list.ratio_percent),
          base,
          derivedItems.filter((item) => item.listId === list.id),
        );
        derivedInserts.push(...plan.inserts);
        derivedUpdates.push(...plan.updates);
        derivedDeletes.push(...plan.deletes);
        manualPricesRemoved += plan.manualRemoved;
        if (plan.inserts.length + plan.updates.length + plan.deletes.length > 0) {
          derivedListsUpdated += 1;
          await touch(client, list.id, actorId);
        }
      }
      await deleteItems(client, derivedDeletes);
      await updateItems(client, derivedUpdates, actorId);
      await insertItems(client, derivedInserts, actorId);

      const syncedAt = new Date().toISOString();
      const state: CatalogSyncState = {
        fingerprint: input.fingerprint.fingerprint,
        count: input.fingerprint.count,
        syncedAt,
        syncedBy: actorId,
      };
      await client.query(
        `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
               updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [CATALOG_SYNC_SETTING_KEY, JSON.stringify(state), actorId],
      );
      return {
        defaultPriceListId: defaultId,
        added: inserts.length,
        updated: updates.length,
        removed: defaultDeletes.length,
        skippedWithoutUnit: input.skippedWithoutUnit,
        derivedListsUpdated,
        manualPricesRemoved,
        syncedAt,
      };
    });
  }
}
