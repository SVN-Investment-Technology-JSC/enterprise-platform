import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { Pool, PoolClient } from 'pg';
import { FINANCE_SOURCE_TYPE } from '../domain/procedure-attributes.js';
import { applyReversal, recordAndApplyResult, type ProcedureResult } from './procedure-links.store.js';

/** Sự kiện của Procedure mà Tài chính nhận: hồ sơ kết thúc, hoặc hồ sơ đã kết thúc bị huỷ hiệu lực. */
export const FINANCE_PROCEDURE_EVENT_TYPES = ['procedure.instance.completed', 'procedure.instance.reversed'] as const;
export const FINANCE_INTEGRATION_QUEUE = 'finance.integrations.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULTS: Readonly<Record<string, ProcedureResult>> = { completed: 'completed', rejected: 'rejected', cancelled: 'cancelled' };

interface Payload {
  instanceId?: string;
  instanceCode?: string;
  sourceType?: string;
  sourceId?: string;
  status?: string;
  actorId?: string;
  reason?: string;
}

/** Sự kiện này có thuộc về một phiếu tài chính không (để worker bỏ qua nhanh sự kiện của HRM, Bảo trì...). */
export function isFinanceProcedureEvent(event: IntegrationEventEnvelope): boolean {
  return (
    (FINANCE_PROCEDURE_EVENT_TYPES as readonly string[]).includes(event.type) &&
    (event.payload as Payload | undefined)?.sourceType === FINANCE_SOURCE_TYPE
  );
}

async function inTransaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Nhận kết quả của Procedure cho một phiếu tài chính và áp vào phiếu trong một giao dịch.
 *
 * - Chỉ nhận sự kiện do Procedure phát cho đúng tenant và đúng nguồn `finance_voucher`.
 * - Idempotent theo mã sự kiện (hộp thư `procedure_inbox`): broker giao lại không áp hai lần.
 * - Lỗi nghiệp vụ khi ghi sổ (số dư, khoá sổ) không ném ra ngoài: liên kết chuyển CONFLICT để người dùng xử lý rồi áp lại;
 *   chỉ lỗi hạ tầng (mất kết nối DB) mới ném để consumer thử lại.
 */
export async function receiveFinanceProcedureEvent(pool: Pool, tenantId: string, event: IntegrationEventEnvelope): Promise<'applied' | 'conflict' | 'ignored'> {
  const payload = (event.payload ?? {}) as Payload;
  if (
    !(FINANCE_PROCEDURE_EVENT_TYPES as readonly string[]).includes(event.type) ||
    event.source !== 'procedure-engine' ||
    event.tenantId !== tenantId ||
    payload.sourceType !== FINANCE_SOURCE_TYPE
  )
    return 'ignored';
  if (!UUID.test(event.id) || !payload.sourceId || !UUID.test(payload.sourceId)) throw new Error('Sự kiện Procedure của Tài chính không hợp lệ.');

  return inTransaction(pool, async (db) => {
    const claimed = await db.query(
      `INSERT INTO finance_schema.procedure_inbox (tenant_id, event_id, event_type, link_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING event_id`,
      [tenantId, event.id, event.type, payload.sourceId],
    );
    if (!claimed.rows.length) return 'ignored'; // đã xử lý
    if (event.type === 'procedure.instance.reversed') {
      await applyReversal(db, tenantId, payload.sourceId as string, payload.reason ?? null);
      return 'applied';
    }
    const result = RESULTS[payload.status ?? ''];
    if (!result) return 'ignored'; // trạng thái trung gian (đang chạy, huỷ hiệu lực...): không phải kết quả
    return recordAndApplyResult(db, tenantId, payload.sourceId as string, result, {
      actorId: payload.actorId ?? null,
      eventId: event.id,
      instanceId: payload.instanceId ?? null,
      instanceCode: payload.instanceCode ?? null,
    });
  });
}
