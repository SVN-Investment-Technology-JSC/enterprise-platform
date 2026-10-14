import { randomUUID } from 'node:crypto';
import type {
  FinanceApprovalBinding,
  FinanceApprovalMode,
  FinanceProcedureProgress,
  FinanceVoucherKind,
  SaveFinanceApprovalBindingRequest,
} from '@enterprise-platform/contracts-finance';
import { FINANCE_VOUCHER_KINDS } from '@enterprise-platform/contracts-finance';
import type { ProcedureDefinition, ProcedureInstanceProgress } from '@enterprise-platform/contracts-procedure-engine';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { FinanceError, conflict, invalid, invalidMany, notFound } from '../domain/finance.error.js';
import {
  FINANCE_SOURCE_TYPE,
  FINANCE_SYSTEM_ACTOR_ID,
  planProcedureAttributes,
  procedureTitle,
  startStepWarnings,
  unsupportedRequiredAttributes,
  type VoucherProcedureFacts,
} from '../domain/procedure-attributes.js';
import { optStr, num, dateOnly, type Db } from './finance.database.js';
import {
  fetchPublishedProcedureDefinition,
  fetchProcedureProgress,
  isProcedureReachable,
  startProcedureInstance,
} from './procedure-api.js';
import { closeWithoutPosting, lockVoucherRow, notificationFacts, postApproval, type Decider } from './voucher-workflow.js';
import { notifyNeedsAttention } from './finance-notification-events.js';
import { addEvent, type Row } from './vouchers.store.js';

type R = QueryResultRow & Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Người duyệt thật từ sự kiện của Procedure; thiếu hoặc là tài khoản hệ thống của Procedure thì dùng tài khoản hệ thống của Tài chính. */
export function resolveDeciderId(actorId?: string | null): string {
  return typeof actorId === 'string' && UUID.test(actorId) && actorId !== '00000000-0000-4000-8000-000000000001' ? actorId : FINANCE_SYSTEM_ACTOR_ID;
}

export const PROCEDURE_DECIDER_NAME = 'Quy trình duyệt';

/* ------------------------- Cấu hình duyệt theo loại phiếu ------------------------- */

export async function listBindings(db: Db, tenantId: string): Promise<FinanceApprovalBinding[]> {
  const rows = (await db.query(`SELECT * FROM finance_schema.approval_bindings WHERE tenant_id=$1`, [tenantId])).rows as R[];
  const byKind = new Map(rows.map((row) => [String(row.kind), row]));
  return FINANCE_VOUCHER_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return {
      kind,
      mode: (row?.mode as FinanceApprovalMode | undefined) ?? 'DIRECT',
      procedureDefinitionId: optStr(row?.procedure_definition_id),
      procedureDefinitionName: optStr(row?.procedure_definition_name),
      isActive: true,
    };
  });
}

export async function bindingFor(db: Db, tenantId: string, kind: FinanceVoucherKind): Promise<FinanceApprovalBinding> {
  return (await listBindings(db, tenantId)).find((binding) => binding.kind === kind) as FinanceApprovalBinding;
}

export interface BindingResult {
  binding: FinanceApprovalBinding;
  warnings: string[];
}

/**
 * Chọn cách duyệt cho một loại phiếu. Gán quy trình thì kiểm: Procedure khả dụng, quy trình đã công bố,
 * và mọi thuộc tính bắt buộc đều là thứ Tài chính tự điền được (nếu không, phiếu sẽ không gửi được).
 */
export async function saveBinding(
  db: Db,
  tenantId: string,
  actorId: string,
  kind: FinanceVoucherKind,
  input: SaveFinanceApprovalBindingRequest,
): Promise<BindingResult> {
  if (!FINANCE_VOUCHER_KINDS.includes(kind)) throw invalid('Loại phiếu không hợp lệ.');
  if (input.mode !== 'DIRECT' && input.mode !== 'PROCEDURE') throw invalid('Cách duyệt không hợp lệ.');
  let name: string | null = null;
  let definitionId: string | null = null;
  let warnings: string[] = [];
  if (input.mode === 'PROCEDURE') {
    definitionId = input.procedureDefinitionId ?? null;
    if (!definitionId || !UUID.test(definitionId)) throw invalid('Chọn quy trình duyệt.');
    if (!(await isProcedureReachable(tenantId))) throw new FinanceError('FINANCE_PROCEDURE_UNAVAILABLE', 'Procedure Engine đang không khả dụng; chưa gán được quy trình.', 409);
    const definition = await fetchPublishedProcedureDefinition(tenantId, definitionId);
    const unsupported = unsupportedRequiredAttributes(definition);
    if (unsupported.length)
      throw invalidMany('FINANCE_PROCEDURE_ATTRIBUTES', [
        `Quy trình yêu cầu thuộc tính mà phiếu tài chính không cung cấp được: ${unsupported.map((s) => `${s.name} (${s.code})`).join(', ')}.`,
        'Bỏ tính bắt buộc của các thuộc tính này hoặc đổi sang mã Tài chính hỗ trợ (so_tien, noi_dung, ma_phieu, loai_phieu, ly_do, tai_khoan, doi_tuong...).',
      ]);
    warnings = startStepWarnings(definition);
    name = definition.name;
  }
  await db.query(
    `INSERT INTO finance_schema.approval_bindings (tenant_id, kind, mode, procedure_definition_id, procedure_definition_name, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (tenant_id, kind) DO UPDATE SET mode=EXCLUDED.mode, procedure_definition_id=EXCLUDED.procedure_definition_id,
       procedure_definition_name=EXCLUDED.procedure_definition_name, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [tenantId, kind, input.mode, definitionId, name, actorId],
  );
  return { binding: await bindingFor(db, tenantId, kind), warnings };
}

/* ------------------------------ Liên kết lần gửi ------------------------------ */

export function factsOf(row: Row): VoucherProcedureFacts {
  return {
    kind: row.kind as FinanceVoucherKind,
    code: String(row.code),
    content: String(row.content),
    totalAmount: num(row.total_amount),
    postingDate: dateOnly(row.posting_date),
    voucherDate: dateOnly(row.voucher_date),
    reasonName: optStr(row.reason_name),
    accountName: optStr(row.account_name),
    destAccountName: optStr(row.dest_account_name),
    counterpartyGroupName: optStr(row.group_name),
    counterpartyName: optStr(row.counterparty_name),
    costCenterName: optStr(row.cost_center_name),
  };
}

/**
 * Tạo liên kết cho một lần gửi duyệt qua quy trình (cùng giao dịch với việc chuyển phiếu sang chờ duyệt).
 * Thuộc tính bắt buộc mà phiếu không điền được làm lần gửi thất bại ngay, trước khi trạng thái phiếu đổi.
 */
export async function createProcedureLink(
  db: Db,
  tenantId: string,
  row: Row,
  definition: ProcedureDefinition,
  initiatedBy: string,
): Promise<string> {
  const facts = factsOf(row);
  const plan = planProcedureAttributes(definition, facts);
  if (plan.missingRequired.length)
    throw invalidMany('FINANCE_PROCEDURE_ATTRIBUTES', [
      `Quy trình yêu cầu thuộc tính mà phiếu không cung cấp được: ${plan.missingRequired.map((s) => `${s.name} (${s.code})`).join(', ')}.`,
      'Nhờ quản trị điều chỉnh quy trình hoặc chuyển loại phiếu này sang duyệt trực tiếp.',
    ]);
  // Lần gửi trước còn dang dở (đã huỷ/bị từ chối) thì đóng lại để sự kiện muộn của nó bị bỏ qua.
  await db.query(
    `UPDATE finance_schema.procedure_links SET sync_status='CLOSED', updated_at=now()
      WHERE voucher_id=$1 AND sync_status NOT IN ('APPLIED','CLOSED')`,
    [String(row.id)],
  );
  const id = randomUUID();
  await db.query(
    `INSERT INTO finance_schema.procedure_links
       (id, tenant_id, voucher_id, revision, definition_id, definition_snapshot, title, attributes, initiated_by, start_idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      tenantId,
      String(row.id),
      num(row.revision),
      definition.id,
      JSON.stringify(definition),
      procedureTitle(facts),
      JSON.stringify(plan.values),
      initiatedBy,
      `finance:${id}`,
    ],
  );
  return id;
}

export interface ProcedureLinkRow {
  id: string;
  voucherId: string;
  revision: number;
  instanceId: string | null;
  instanceCode: string | null;
  syncStatus: string;
  result: string | null;
  lastError: string | null;
  initiatedBy: string;
}

const mapLink = (row: R): ProcedureLinkRow => ({
  id: String(row.id),
  voucherId: String(row.voucher_id),
  revision: num(row.revision),
  instanceId: optStr(row.instance_id),
  instanceCode: optStr(row.instance_code),
  syncStatus: String(row.sync_status),
  result: optStr(row.result),
  lastError: optStr(row.last_error),
  initiatedBy: String(row.initiated_by),
});

/** Liên kết của lần gửi hiện tại của phiếu (mới nhất chưa đóng). */
export async function currentLink(db: Db, tenantId: string, voucherId: string): Promise<ProcedureLinkRow | null> {
  const row = (
    await db.query(
      `SELECT * FROM finance_schema.procedure_links WHERE tenant_id=$1 AND voucher_id=$2 AND sync_status <> 'CLOSED' ORDER BY revision DESC, created_at DESC LIMIT 1`,
      [tenantId, voucherId],
    )
  ).rows[0] as R | undefined;
  return row ? mapLink(row) : null;
}

export async function linkById(db: Db, tenantId: string, linkId: string): Promise<ProcedureLinkRow | null> {
  const row = (await db.query(`SELECT * FROM finance_schema.procedure_links WHERE tenant_id=$1 AND id=$2`, [tenantId, linkId])).rows[0] as R | undefined;
  return row ? mapLink(row) : null;
}

/** Tiến độ hiển thị trên phiếu: trạng thái đồng bộ + tiến độ trực tiếp từ Procedure (nếu hỏi được). */
export async function procedureView(
  db: Db,
  tenantId: string,
  voucherId: string,
  actorUserId: string,
): Promise<FinanceProcedureProgress | null> {
  const link = await currentLink(db, tenantId, voucherId);
  if (!link) return null;
  let progress: ProcedureInstanceProgress | null = null;
  if (link.instanceId && link.syncStatus === 'RUNNING') {
    try {
      progress = await fetchProcedureProgress(tenantId, link.instanceId, actorUserId);
    } catch {
      progress = null; // Procedure tạm không trả lời: vẫn hiện trạng thái đã lưu.
    }
  }
  return {
    instanceId: link.instanceId,
    instanceCode: link.instanceCode,
    status: progress?.status ?? (link.result ?? 'running'),
    currentStepName: progress?.currentStepName ?? null,
    currentAssigneeName: progress?.currentAssigneeName ?? null,
    canAct: progress ? (progress.canAct ?? null) : null,
    syncStatus: link.syncStatus,
    lastError: link.lastError,
  };
}

/* -------------------------------- Khởi tạo hồ sơ -------------------------------- */

const MAX_ATTEMPTS = 30;
const LEASE_SECONDS = 30;

/**
 * Tạo hồ sơ trong Procedure cho một liên kết (gọi SAU khi giao dịch gửi duyệt đã commit).
 * Dùng khoá thuê ngắn để hai tiến trình không cùng tạo; idempotencyKey ở Procedure chặn hồ sơ trùng khi gọi lại.
 * Lỗi được ghi vào liên kết (FAILED) để tiến trình nền thử lại, không làm hỏng việc gửi duyệt.
 */
export async function startProcedureForLink(pool: Pool, tenantId: string, linkId: string): Promise<ProcedureLinkRow> {
  const lease = randomUUID();
  const claimed = (
    await pool.query(
      `UPDATE finance_schema.procedure_links
          SET lease_token=$3, lease_until=now() + ($4 || ' seconds')::interval, attempts=attempts+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND instance_id IS NULL AND sync_status IN ('START_PENDING','FAILED')
          AND (lease_until IS NULL OR lease_until < now())
        RETURNING *`,
      [tenantId, linkId, lease, String(LEASE_SECONDS)],
    )
  ).rows[0] as R | undefined;
  if (!claimed) return (await linkById(pool, tenantId, linkId)) ?? notFoundLink();

  try {
    const instance = await startProcedureInstance(tenantId, {
      definitionId: String(claimed.definition_id),
      title: String(claimed.title),
      sourceType: FINANCE_SOURCE_TYPE as never,
      sourceId: String(claimed.id),
      idempotencyKey: String(claimed.start_idempotency_key),
      initiatedBy: String(claimed.initiated_by),
      // Người lập là vai S của bước đầu: Procedure tự hoàn thành bước đó khi bước đầu chỉ có vai S.
      autoCompleteInitiatorStep: true,
      expectedDefinitionSnapshot: claimed.definition_snapshot as ProcedureDefinition,
      attributeValues: claimed.attributes as never,
    });
    await pool.query(
      `UPDATE finance_schema.procedure_links
          SET instance_id = COALESCE(instance_id, $4), instance_code = COALESCE(instance_code, $5),
              sync_status = CASE WHEN sync_status IN ('START_PENDING','FAILED') THEN 'RUNNING' ELSE sync_status END,
              last_error = NULL, lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE tenant_id=$1 AND id=$2 AND (lease_token=$3 OR lease_token IS NULL)`,
      [tenantId, linkId, lease, instance.id, instance.code ?? null],
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Không khởi tạo được quy trình.').slice(0, 2000);
    // Procedure từ chối dứt khoát (dữ liệu sai) thì không thử lại mãi; lỗi hạ tầng thử lại tới MAX_ATTEMPTS.
    const permanent = error instanceof FinanceError && error.code === 'FINANCE_PROCEDURE_REJECTED';
    await pool.query(
      `UPDATE finance_schema.procedure_links
          SET sync_status = 'FAILED', last_error=$4, lease_token=NULL, lease_until = CASE WHEN $5 THEN now() + interval '100 years' ELSE NULL END, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND lease_token=$3`,
      [tenantId, linkId, lease, message, permanent],
    );
  }
  return (await linkById(pool, tenantId, linkId)) ?? notFoundLink();
}

function notFoundLink(): never {
  throw notFound('liên kết quy trình');
}

/* --------------------------- Áp kết quả của quy trình --------------------------- */

export type ProcedureResult = 'completed' | 'rejected' | 'cancelled';

/**
 * Ghi kết quả của hồ sơ vào liên kết rồi áp vào phiếu trong cùng giao dịch.
 * - đã duyệt: ghi sổ như duyệt trực tiếp; không ghi sổ được (số dư, khoá sổ...) thì giữ phiếu chờ duyệt và đánh dấu CONFLICT
 *   kèm lý do để người có quyền xử lý rồi bấm "Áp lại";
 * - bị từ chối / huỷ: đóng phiếu tương ứng.
 * Lần gửi cũ (phiếu đã sửa và gửi lại) hoặc phiếu không còn chờ duyệt thì bỏ qua, không đụng vào sổ.
 */
export async function recordAndApplyResult(
  db: PoolClient,
  tenantId: string,
  linkId: string,
  result: ProcedureResult,
  info: { actorId?: string | null; eventId?: string | null; instanceId?: string | null; instanceCode?: string | null; actorName?: string | null },
): Promise<'applied' | 'conflict' | 'ignored'> {
  const link = (await db.query(`SELECT * FROM finance_schema.procedure_links WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, linkId])).rows[0] as R | undefined;
  if (!link) return 'ignored';
  if (link.sync_status === 'APPLIED' || link.sync_status === 'CLOSED') return 'ignored';
  if (link.instance_id && info.instanceId && link.instance_id !== info.instanceId) return 'ignored';

  await db.query(
    `UPDATE finance_schema.procedure_links
        SET result=$3, result_actor_id=$4, result_event_id=$5,
            instance_id=COALESCE(instance_id,$6), instance_code=COALESCE(instance_code,$7), updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, linkId, result, resolveDeciderId(info.actorId), info.eventId ?? null, info.instanceId ?? null, info.instanceCode ?? null],
  );
  return applyStoredResult(db, tenantId, linkId, info.actorName ?? null);
}

/** Áp kết quả đã lưu trong liên kết (dùng cả khi thử áp lại). */
export async function applyStoredResult(db: PoolClient, tenantId: string, linkId: string, actorName: string | null = null): Promise<'applied' | 'conflict' | 'ignored'> {
  const link = (await db.query(`SELECT * FROM finance_schema.procedure_links WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, linkId])).rows[0] as R | undefined;
  if (!link || !link.result || link.sync_status === 'APPLIED' || link.sync_status === 'CLOSED') return 'ignored';
  const voucher = await lockVoucherRow(db, tenantId, String(link.voucher_id));
  const stale = !voucher || num(voucher.revision) !== num(link.revision) || voucher.status !== 'PENDING' || voucher.approval_mode !== 'PROCEDURE';
  if (stale) {
    await db.query(`UPDATE finance_schema.procedure_links SET sync_status='CLOSED', updated_at=now() WHERE id=$1`, [linkId]);
    return 'ignored';
  }
  const decider: Decider = { userId: String(link.result_actor_id ?? FINANCE_SYSTEM_ACTOR_ID), displayName: actorName ?? PROCEDURE_DECIDER_NAME };
  const code = optStr(link.instance_code);
  const via = code ? `Theo quy trình ${code}` : 'Theo quy trình duyệt';

  if (link.result === 'completed') {
    await db.query('SAVEPOINT finance_apply_result');
    try {
      await postApproval(db, tenantId, voucher as Row, decider, via);
      await db.query('RELEASE SAVEPOINT finance_apply_result');
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT finance_apply_result');
      if (!(error instanceof FinanceError)) throw error;
      await db.query(
        `UPDATE finance_schema.procedure_links SET sync_status='CONFLICT', last_error=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, linkId, error.message.slice(0, 2000)],
      );
      // Báo một lần khi mới chuyển sang kẹt; các lần thử áp lại sau (nền hoặc bấm tay) mà vẫn kẹt thì không báo lặp.
      if (link.sync_status !== 'CONFLICT') await notifyNeedsAttention(db, notificationFacts(tenantId, voucher as Row), error.message);
      return 'conflict';
    }
  } else if (link.result === 'rejected') {
    await closeWithoutPosting(db, tenantId, String(link.voucher_id), 'REJECTED', decider, `${via}: bị từ chối`);
  } else {
    await closeWithoutPosting(db, tenantId, String(link.voucher_id), 'CANCELLED', decider, `${via}: đã huỷ`);
  }
  await db.query(`UPDATE finance_schema.procedure_links SET sync_status='APPLIED', last_error=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId, linkId]);
  return 'applied';
}

/**
 * Hồ sơ quy trình bị huỷ hiệu lực. Phiếu chưa ghi sổ (còn chờ vì không áp được) thì huỷ theo;
 * phiếu đã ghi sổ thì giữ nguyên (việc đảo sổ là quyết định riêng của người có quyền, ngay trong Tài chính).
 */
export async function applyReversal(db: PoolClient, tenantId: string, linkId: string, reason: string | null): Promise<void> {
  const link = (await db.query(`SELECT * FROM finance_schema.procedure_links WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, linkId])).rows[0] as R | undefined;
  if (!link) return;
  const voucher = await lockVoucherRow(db, tenantId, String(link.voucher_id));
  if (!voucher) return;
  const note = `Hồ sơ quy trình bị huỷ hiệu lực${reason ? `: ${reason}` : ''}`;
  if (voucher.status === 'PENDING' && num(voucher.revision) === num(link.revision)) {
    await closeWithoutPosting(db, tenantId, String(link.voucher_id), 'CANCELLED', { userId: FINANCE_SYSTEM_ACTOR_ID, displayName: PROCEDURE_DECIDER_NAME }, note);
    await db.query(`UPDATE finance_schema.procedure_links SET sync_status='CLOSED', last_error=NULL, updated_at=now() WHERE id=$1`, [linkId]);
    return;
  }
  await addEvent(db, tenantId, String(link.voucher_id), 'CANCELLED', null, `${note} (phiếu đã ghi sổ nên được giữ nguyên)`);
}

/** Phiếu đứng sau hồ sơ có cho huỷ hiệu lực không: không khi đã ghi sổ (Procedure hỏi trước khi huỷ). */
export async function reversalCheck(db: Db, tenantId: string, linkId: string): Promise<{ allowed: boolean; reason?: string }> {
  const link = (await db.query(`SELECT voucher_id FROM finance_schema.procedure_links WHERE tenant_id=$1 AND id=$2`, [tenantId, linkId])).rows[0] as R | undefined;
  if (!link) return { allowed: true };
  const voucher = (await db.query(`SELECT code, status FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [tenantId, String(link.voucher_id)])).rows[0] as R | undefined;
  if (voucher?.status === 'APPROVED')
    return { allowed: false, reason: `Phiếu ${voucher.code} đã ghi sổ tài khoản. Huỷ bằng "Huỷ phiếu đã ghi sổ" trong Tài chính (ghi bút toán đảo) trước khi huỷ hiệu lực hồ sơ.` };
  return { allowed: true };
}

/* ------------------------------ Tra cứu phục vụ giao diện ------------------------------ */

/** Từ id lần gửi (sourceId trong Procedure) tìm ra phiếu, để liên kết ngược từ hồ sơ quy trình về phiếu. */
export async function voucherOfLink(db: Db, tenantId: string, linkId: string): Promise<{ id: string; kind: FinanceVoucherKind } | null> {
  const row = (
    await db.query(
      `SELECT v.id, v.kind FROM finance_schema.procedure_links l JOIN finance_schema.vouchers v ON v.id = l.voucher_id WHERE l.tenant_id=$1 AND l.id=$2`,
      [tenantId, linkId],
    )
  ).rows[0] as R | undefined;
  return row ? { id: String(row.id), kind: row.kind as FinanceVoucherKind } : null;
}

export async function financeProcedureReady(pool: Db): Promise<boolean> {
  return Boolean((await pool.query(`SELECT to_regclass('finance_schema.procedure_links') AS relation`)).rows[0]?.relation);
}

/* --------------------------------- Đối soát nền --------------------------------- */

/** Số lần/độ tuổi trước khi tiến trình nền thử lại các trạng thái chưa xong. */
const RECONCILE_RUNNING_AFTER = "interval '2 minutes'";
const RETRY_CONFLICT_AFTER = "interval '10 minutes'";

/**
 * Hỏi Procedure về hồ sơ đang chạy; đã kết thúc thì áp kết quả. Bù cho sự kiện bị mất hoặc đến muộn
 * và cho trường hợp Procedure vừa tự hoàn thành hồ sơ ngay lúc tạo.
 */
export async function reconcileLink(
  pool: Pool,
  tenantId: string,
  linkId: string,
  by?: { userId: string; displayName: string },
): Promise<'applied' | 'conflict' | 'ignored' | 'running'> {
  const link = await linkById(pool, tenantId, linkId);
  if (!link || !link.instanceId) return 'ignored';
  const progress = await fetchProcedureProgress(tenantId, link.instanceId);
  if (!progress) return 'ignored';
  const result = progress.status === 'completed' ? 'completed' : progress.status === 'rejected' ? 'rejected' : progress.status === 'cancelled' ? 'cancelled' : null;
  if (!result) return 'running';
  return withTransaction(pool, (db) =>
    recordAndApplyResult(db, tenantId, linkId, result, {
      instanceId: link.instanceId,
      instanceCode: link.instanceCode,
      actorId: by?.userId ?? null,
      actorName: by?.displayName ?? null,
    }),
  );
}

async function withTransaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> {
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
 * Một lượt đối soát cho một tenant (gọi định kỳ từ worker): tạo hồ sơ còn thiếu, đối soát hồ sơ đang chạy quá lâu,
 * và thử áp lại kết quả chưa áp được. Mỗi liên kết xử lý độc lập: một liên kết lỗi không chặn các liên kết khác.
 */
export async function processFinanceProcedureSync(pool: Pool, tenantId: string): Promise<{ started: number; reconciled: number; retried: number }> {
  if (!(await financeProcedureReady(pool))) return { started: 0, reconciled: 0, retried: 0 };
  const out = { started: 0, reconciled: 0, retried: 0 };

  const pending = (
    await pool.query(
      `SELECT id FROM finance_schema.procedure_links
        WHERE tenant_id=$1 AND instance_id IS NULL AND sync_status IN ('START_PENDING','FAILED') AND attempts < $2
          AND (lease_until IS NULL OR lease_until < now())
        ORDER BY updated_at LIMIT 20`,
      [tenantId, MAX_ATTEMPTS],
    )
  ).rows as R[];
  for (const row of pending) {
    try {
      await startProcedureForLink(pool, tenantId, String(row.id));
      out.started += 1;
    } catch {
      /* ghi lại ở lần sau */
    }
  }

  const running = (
    await pool.query(
      `SELECT id FROM finance_schema.procedure_links
        WHERE tenant_id=$1 AND sync_status='RUNNING' AND instance_id IS NOT NULL AND updated_at < now() - ${RECONCILE_RUNNING_AFTER}
        ORDER BY updated_at LIMIT 20`,
      [tenantId],
    )
  ).rows as R[];
  for (const row of running) {
    try {
      const outcome = await reconcileLink(pool, tenantId, String(row.id));
      if (outcome === 'running') await pool.query(`UPDATE finance_schema.procedure_links SET updated_at=now() WHERE id=$1`, [String(row.id)]);
      else out.reconciled += 1;
    } catch {
      /* Procedure tạm không trả lời: thử lại ở lượt sau */
    }
  }

  const conflicts = (
    await pool.query(
      `SELECT id FROM finance_schema.procedure_links
        WHERE tenant_id=$1 AND sync_status='CONFLICT' AND result IS NOT NULL AND updated_at < now() - ${RETRY_CONFLICT_AFTER}
        ORDER BY updated_at LIMIT 20`,
      [tenantId],
    )
  ).rows as R[];
  for (const row of conflicts) {
    try {
      await withTransaction(pool, (db) => applyStoredResult(db, tenantId, String(row.id)));
      out.retried += 1;
    } catch {
      /* giữ nguyên trạng thái để người dùng xử lý */
    }
  }
  return out;
}

/** Áp lại thủ công (nút "Áp lại" / "Thử lại" trên phiếu): tuỳ trạng thái mà tạo hồ sơ, đối soát hoặc áp kết quả đã lưu. */
export async function retryLink(pool: Pool, tenantId: string, linkId: string, by?: { userId: string; displayName: string }): Promise<ProcedureLinkRow> {
  const link = await linkById(pool, tenantId, linkId);
  if (!link) throw notFound('liên kết quy trình');
  if (link.syncStatus === 'START_PENDING' || link.syncStatus === 'FAILED') {
    // Cho phép thử lại tay kể cả khi đã hết số lần tự động hoặc bị khoá do Procedure từ chối.
    await pool.query(`UPDATE finance_schema.procedure_links SET lease_until=NULL, attempts=0, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND instance_id IS NULL`, [tenantId, linkId]);
    await startProcedureForLink(pool, tenantId, linkId);
    if (!(await linkById(pool, tenantId, linkId))?.instanceId) return (await linkById(pool, tenantId, linkId)) as ProcedureLinkRow;
    await reconcileLink(pool, tenantId, linkId, by).catch(() => undefined);
  } else if (link.syncStatus === 'RUNNING') {
    await reconcileLink(pool, tenantId, linkId, by);
  } else if (link.syncStatus === 'CONFLICT') {
    await withTransaction(pool, (db) => applyStoredResult(db, tenantId, linkId));
  } else {
    throw conflict('FINANCE_PROCEDURE_STATE', 'Lần gửi này đã xử lý xong.');
  }
  return (await linkById(pool, tenantId, linkId)) as ProcedureLinkRow;
}
