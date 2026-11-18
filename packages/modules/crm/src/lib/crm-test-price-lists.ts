import type { Pool } from 'pg';

/** Dòng giá nạp sẵn cho integration test. `price` rỗng là "Chưa nhập giá ở Kho". */
export interface SeedPriceListItem {
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly price: number | null;
  readonly vatRate?: number;
}

export interface SeedPriceList {
  readonly code: string;
  readonly name?: string;
  readonly validFrom?: string;
  readonly validTo?: string | null;
  readonly status?: 'ACTIVE' | 'INACTIVE';
  /** Bảng chuẩn cũ (chỉ để dựng dữ liệu trước migration 0039). */
  readonly isStandard?: boolean;
  readonly items: readonly SeedPriceListItem[];
}

/**
 * Nạp một bảng giá nhập tay (`MANUAL`, như bảng cũ trước khi có bảng mặc định) thẳng bằng SQL, để test báo giá, đơn
 * bán có bảng giá chọn được mà không cần đồng bộ bảng mặc định với Kho. Chạy được cả trên schema trước 0039 (không ghi
 * cột mới). Trả id bảng giá.
 */
export async function seedPriceList(pool: Pick<Pool, 'query'>, list: SeedPriceList): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO crm_schema.price_lists (code, name, is_standard, valid_from, valid_to, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [list.code, list.name ?? list.code, list.isStandard ?? false, list.validFrom ?? '2026-01-01', list.validTo ?? null, list.status ?? 'ACTIVE'],
  );
  const id = inserted.rows[0].id;
  for (const item of list.items) {
    await pool.query(
      `INSERT INTO crm_schema.price_list_items (price_list_id, material_id, material_code, material_name, unit, price, vat_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, item.materialId, item.materialCode, item.materialName, item.unit, item.price, item.vatRate ?? 10],
    );
  }
  return id;
}
