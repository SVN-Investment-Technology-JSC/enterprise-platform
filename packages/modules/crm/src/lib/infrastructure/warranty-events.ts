import { CRM_WARRANTY_SOURCE_TYPE, WARRANTY_AUDIT_ENTITY } from '../application/warranty.port.js';
import { isUuid } from '../domain/fields.js';
import { receiveIdempotencyKey } from '../domain/warranty-case.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { lockWarrantyCase, transitionWarrantyCase, upsertWarrantyDocument } from './postgres-warranty.store.js';

/** Kho phát khi ghi sổ nhập trả hàng bán (khai ở contracts-inventory; chép tên, không đổi). */
export const INVENTORY_STOCK_RETURNED = 'inventory.stock.returned';

/** Phần payload `inventory.stock.returned`, `inventory.stock.issued` bảo hành đọc. */
export interface WarrantyStockEventPayload {
  readonly documentId?: string;
  readonly documentCode?: string;
  readonly docType?: string;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
  readonly reversesDocumentId?: string | null;
  readonly postedAt?: string;
  readonly qualityStatus?: string;
  readonly lines?: readonly {
    readonly materialId?: string;
    readonly materialCode?: string;
    readonly quantity?: number | string;
    readonly direction?: string;
    readonly lotId?: string | null;
    readonly lotNo?: string | null;
    readonly serials?: readonly string[];
  }[];
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Kho đã ghi sổ nhập trả của yêu cầu bảo hành (T6-04, TC-INT-17): ghi chứng từ
 * nhập trả, đánh dấu dòng đã nhận (lô riêng của lần trả với hàng không theo
 * serial) và chuyển Chờ nhận hàng → Đang kiểm định. Nhận trùng (hoặc yêu cầu đã
 * qua bước này) thì bỏ qua.
 */
export async function applyWarrantyReturned(
  database: CrmDatabase,
  tenantId: string,
  payload: WarrantyStockEventPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_WARRANTY_SOURCE_TYPE || !isUuid(payload.sourceId) || !isUuid(payload.documentId)) return 'ignored';
  if (payload.reversesDocumentId) return 'ignored';
  const caseId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const exists = await client.query(`SELECT 1 FROM crm_schema.warranty_cases WHERE id = $1`, [caseId]);
    if (!exists.rows.length) return 'ignored';
    const locked = await lockWarrantyCase(client, caseId, null);
    await upsertWarrantyDocument(client, caseId, {
      lineId: null,
      kind: 'RETURN_RECEIPT',
      idempotencyKey: receiveIdempotencyKey(caseId),
      status: 'POSTED',
      documentId: payload.documentId,
      documentCode: (payload.documentCode ?? '').slice(0, 100) || null,
      lastError: null,
    });
    if (locked.status !== 'AWAITING_GOODS') return 'ignored';
    const receivedAt = isoOrNull(payload.postedAt);
    await client.query(
      `UPDATE crm_schema.warranty_case_lines SET received_at = COALESCE($2::timestamptz, now())
        WHERE case_id = $1 AND serial IS NOT NULL AND received_at IS NULL`,
      [caseId, receivedAt],
    );
    // Hàng không theo serial: mỗi dòng nhập trả có lô riêng; ghép theo mặt hàng, thứ tự dòng.
    const lots = (payload.lines ?? []).filter((line) => !line.serials?.length && isUuid(line.lotId));
    const pending = await client.query<{ id: string; material_id: string }>(
      `SELECT id, material_id FROM crm_schema.warranty_case_lines
        WHERE case_id = $1 AND serial IS NULL AND received_at IS NULL ORDER BY line_no`,
      [caseId],
    );
    const used = new Set<number>();
    for (const line of pending.rows) {
      const index = lots.findIndex((lot, position) => !used.has(position) && String(lot.materialId ?? '').toLowerCase() === line.material_id);
      if (index >= 0) used.add(index);
      const lot = index >= 0 ? lots[index] : undefined;
      await client.query(
        `UPDATE crm_schema.warranty_case_lines
            SET received_at = COALESCE($2::timestamptz, now()), received_lot_id = $3, received_lot_no = $4
          WHERE id = $1`,
        [line.id, receivedAt, lot?.lotId ?? null, lot?.lotNo ?? null],
      );
    }
    await client.query(
      `UPDATE crm_schema.warranty_cases SET received_at = COALESCE(received_at, $2::timestamptz, now()) WHERE id = $1`,
      [caseId, receivedAt],
    );
    await transitionWarrantyCase(client, caseId, locked.status, 'INSPECTING', {
      action: 'goods-received',
      actorId: null,
      metadata: { documentCode: payload.documentCode ?? null, qualityStatus: payload.qualityStatus ?? null },
    });
    return 'applied';
  });
}

/**
 * Kho đã ghi sổ (hoặc đảo) một chứng từ xuất của yêu cầu bảo hành: xuất khác
 * loại bỏ đã duyệt, xuất bảo hành hàng thay thế. Xuất thay thế ghi serial mới
 * lên dòng và hạn bảo hành kế thừa đúng ngày hết hạn của serial cũ (Q9,
 * TC-WAR-10). Chứng từ đảo chuyển chứng từ gốc sang Đã đảo.
 */
export async function applyWarrantyIssued(
  database: CrmDatabase,
  tenantId: string,
  payload: WarrantyStockEventPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_WARRANTY_SOURCE_TYPE || !isUuid(payload.sourceId) || !isUuid(payload.documentId)) return 'ignored';
  const caseId = payload.sourceId;
  const reverses = isUuid(payload.reversesDocumentId) ? payload.reversesDocumentId : null;
  return database.transaction(tenantId, async (client) => {
    const target = (
      await client.query<{ id: string; line_id: string | null; kind: string; status: string }>(
        `SELECT id, line_id, kind, status FROM crm_schema.warranty_documents
          WHERE case_id = $1 AND document_id = $2 FOR UPDATE`,
        [caseId, reverses ?? payload.documentId],
      )
    ).rows[0];
    if (!target) return 'ignored';
    await lockWarrantyCase(client, caseId, null);
    if (reverses) {
      if (target.status === 'REVERSED') return 'ignored';
      await client.query(`UPDATE crm_schema.warranty_documents SET status = 'REVERSED', updated_at = now() WHERE id = $1`, [target.id]);
      await client.query(`UPDATE crm_schema.warranty_cases SET revision = revision + 1, updated_at = now() WHERE id = $1`, [caseId]);
      await writeAuditLog(client, {
        entityType: WARRANTY_AUDIT_ENTITY,
        entityId: caseId,
        action: 'document-reversed',
        actorId: null,
        metadata: { documentCode: payload.documentCode ?? null, kind: target.kind },
      });
      return 'applied';
    }
    if (target.status === 'POSTED') return 'ignored';
    const postedAt = isoOrNull(payload.postedAt);
    await client.query(
      `UPDATE crm_schema.warranty_documents
          SET status = 'POSTED', posted_at = COALESCE($2::timestamptz, now()), last_error = NULL, updated_at = now()
        WHERE id = $1`,
      [target.id, postedAt],
    );
    const metadata: Record<string, unknown> = { documentCode: payload.documentCode ?? null, kind: target.kind };
    if (target.kind === 'REPLACEMENT' && target.line_id) {
      const serials = (payload.lines ?? [])
        .filter((line) => line.direction !== 'IN')
        .flatMap((line) => (Array.isArray(line.serials) ? line.serials.filter((serial) => typeof serial === 'string') : []));
      const line = (
        await client.query<{ serial: string | null; warranty_until: string | null }>(
          `UPDATE crm_schema.warranty_case_lines
              SET replacement_serials = $2::text[], replacement_warranty_until = warranty_until
            WHERE id = $1
            RETURNING serial, warranty_until::text AS warranty_until`,
          [target.line_id, serials],
        )
      ).rows[0];
      Object.assign(metadata, { replacedSerial: line?.serial ?? null, replacementSerials: serials, warrantyUntil: line?.warranty_until ?? null });
    }
    await client.query(`UPDATE crm_schema.warranty_cases SET revision = revision + 1, updated_at = now() WHERE id = $1`, [caseId]);
    await writeAuditLog(client, {
      entityType: WARRANTY_AUDIT_ENTITY,
      entityId: caseId,
      action: target.kind === 'REPLACEMENT' ? 'replacement-issued' : 'document-posted',
      actorId: null,
      metadata,
    });
    return 'applied';
  });
}
