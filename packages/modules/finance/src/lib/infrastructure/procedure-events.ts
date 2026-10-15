import { FINANCE_STEP_VOUCHER_REQUESTED } from '@enterprise-platform/contracts-finance';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { Pool, PoolClient } from 'pg';
import { FINANCE_SOURCE_TYPE } from '../domain/procedure-attributes.js';
import { applyReversal, recordAndApplyResult, type ProcedureResult } from './procedure-links.store.js';
import {
  applySourceInstanceClosed,
  applySourceInstanceReversed,
  applyVoucherRequested,
  financeVoucherSourcesReady,
  parseVoucherRequested,
  planRequestedVoucher,
  sourceOfInstance,
  type VoucherRequestedOutcome,
} from './voucher-sources.store.js';
import { fetchWorkspaceWorkItem } from './workspace-api.js';
import { resolveWorkspaceLinks } from './workspace-links.js';

/**
 * Sự kiện của Procedure mà Tài chính nhận: hồ sơ kết thúc, hồ sơ đã kết thúc bị huỷ hiệu lực, và hồ sơ tới bước Tài chính
 * (yêu cầu tạo phiếu).
 */
export const FINANCE_PROCEDURE_EVENT_TYPES = [
  'procedure.instance.completed',
  'procedure.instance.reversed',
  FINANCE_STEP_VOUCHER_REQUESTED,
] as const;
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
  actorName?: string;
  reason?: string;
  reversedBy?: string;
  reversedByName?: string;
}

/**
 * Sự kiện kết thúc / huỷ hiệu lực của một hồ sơ KHÔNG do phiếu mở (`sourceType` khác `finance_voucher`). Hồ sơ như vậy có thể
 * có bước Tài chính đã tạo phiếu; tra `voucher_sources` theo `instanceId` mới biết (làm trong lúc nhận, không trong bộ lọc nhanh).
 */
export function isFinanceSourcedInstanceEvent(event: IntegrationEventEnvelope): boolean {
  return (
    (event.type === 'procedure.instance.completed' || event.type === 'procedure.instance.reversed') &&
    (event.payload as Payload | undefined)?.sourceType !== FINANCE_SOURCE_TYPE
  );
}

/**
 * Sự kiện này Tài chính có cần xem không (để worker bỏ qua nhanh sự kiện khác). Hồ sơ kết thúc / huỷ hiệu lực luôn cần xem:
 * hoặc do phiếu mở (`finance_voucher`), hoặc có thể có bước Tài chính.
 */
export function isFinanceProcedureEvent(event: IntegrationEventEnvelope): boolean {
  return (FINANCE_PROCEDURE_EVENT_TYPES as readonly string[]).includes(event.type);
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
export async function receiveFinanceProcedureEvent(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
): Promise<'applied' | 'conflict' | 'ignored' | VoucherRequestedOutcome> {
  if (event.type === FINANCE_STEP_VOUCHER_REQUESTED) return receiveVoucherRequested(pool, tenantId, event);
  if (isFinanceSourcedInstanceEvent(event)) return receiveSourcedInstanceEvent(pool, tenantId, event);
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

/**
 * Hồ sơ tới bước Tài chính: tạo (hoặc cập nhật) phiếu nháp INHERITED cho hồ sơ.
 *
 * Hỏi Workspace dự án/công việc của hồ sơ TRƯỚC và NGOÀI giao dịch (không giữ kết nối khi chờ mạng); Workspace không trả lời thì
 * vẫn tạo phiếu, chỉ để trống hạch toán cho kế toán chọn. Idempotent theo mã sự kiện (hộp thư) và theo hồ sơ (một hồ sơ = một phiếu).
 */
async function receiveVoucherRequested(pool: Pool, tenantId: string, event: IntegrationEventEnvelope): Promise<VoucherRequestedOutcome> {
  if (event.source !== 'procedure-engine' || event.tenantId !== tenantId) return 'ignored';
  if (!UUID.test(event.id)) throw new Error('Sự kiện yêu cầu tạo phiếu không hợp lệ.');
  const payload = parseVoucherRequested(event.payload);
  const plan = await planRequestedVoucher(
    payload,
    (allocation) => resolveWorkspaceLinks(tenantId, { allocation, relatedProjectIds: [] }, null),
    async (workItemId) => (await fetchWorkspaceWorkItem(tenantId, workItemId))?.project.id ?? null,
  );
  return inTransaction(pool, async (db) => {
    const claimed = await db.query(
      `INSERT INTO finance_schema.procedure_inbox (tenant_id, event_id, event_type, link_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING event_id`,
      [tenantId, event.id, event.type, payload.instanceId],
    );
    if (!claimed.rows.length) return 'ignored';
    return applyVoucherRequested(db, tenantId, payload, plan);
  });
}

/**
 * Hồ sơ có bước Tài chính kết thúc hoặc bị huỷ hiệu lực. Hồ sơ không có phiếu (đa số) bị bỏ qua mà không ghi hộp thư, để hộp thư
 * không phình theo mọi hồ sơ của tenant. Có phiếu thì giành hộp thư rồi áp trong cùng giao dịch.
 */
async function receiveSourcedInstanceEvent(pool: Pool, tenantId: string, event: IntegrationEventEnvelope): Promise<'applied' | 'conflict' | 'ignored'> {
  if (event.source !== 'procedure-engine' || event.tenantId !== tenantId) return 'ignored';
  const payload = (event.payload ?? {}) as Payload;
  if (!payload.instanceId || !UUID.test(payload.instanceId) || !UUID.test(event.id)) return 'ignored';
  const instanceId = payload.instanceId;
  const result = event.type === 'procedure.instance.completed' ? RESULTS[payload.status ?? ''] : undefined;
  // Hồ sơ hoàn tất bình thường: bước Tài chính đã đóng qua `finance.voucher.posted`, không còn gì để làm.
  if (event.type === 'procedure.instance.completed' && result !== 'rejected' && result !== 'cancelled') return 'ignored';
  if (!(await financeVoucherSourcesReady(pool))) return 'ignored';
  if (!(await sourceOfInstance(pool, tenantId, instanceId))) return 'ignored';

  return inTransaction(pool, async (db) => {
    const claimed = await db.query(
      `INSERT INTO finance_schema.procedure_inbox (tenant_id, event_id, event_type, link_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING event_id`,
      [tenantId, event.id, event.type, instanceId],
    );
    if (!claimed.rows.length) return 'ignored';
    if (event.type === 'procedure.instance.reversed')
      return applySourceInstanceReversed(db, tenantId, instanceId, {
        reason: payload.reason ?? null,
        actorId: payload.reversedBy ?? null,
        actorName: payload.reversedByName ?? null,
      });
    return applySourceInstanceClosed(db, tenantId, instanceId, result as 'rejected' | 'cancelled', {
      actorId: payload.actorId ?? null,
      actorName: payload.actorName ?? null,
    });
  });
}
