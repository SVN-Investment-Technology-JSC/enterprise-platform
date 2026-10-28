import { createHash } from 'node:crypto';
import {
  FINANCE_EXTERNAL_SOURCE_MODULES,
  FINANCE_MAX_AMOUNT,
  roundMoney,
  type CreateFinanceVoucherSourceRequest,
  type FinanceExternalSourceModule,
  type FinanceSourceLockedField,
  type FinanceSourceModule,
  type FinanceVoucherSourceState,
  type FinanceVoucherSourceStatus,
} from '@enterprise-platform/contracts-finance';
import type { FinanceActor } from '../domain/finance.access.js';
import { FINANCE_SYSTEM_ACTOR_ID } from '../domain/procedure-attributes.js';
import { conflict, invalid, notFound } from '../domain/finance.error.js';
import { isValidDate, type NormalizedVoucher } from '../domain/voucher.rules.js';
import { iso, num, todayVn, type Db } from './finance.database.js';
import { addEvent, allocationColumns, createVoucher, type ResolvedWorkspaceLinks, type Row } from './vouchers.store.js';
import { closeWithoutPosting } from './voucher-workflow.js';

/**
 * Phiếu có nguồn do phân hệ khác yêu cầu qua API nội bộ (trước mắt: phiếu thu từ lần thu tiền của Bán hàng).
 *
 * Cùng cơ chế với phiếu từ bước Tài chính của quy trình (`approval_mode = 'INHERITED'`, bảng `voucher_sources`): phiếu là nháp,
 * số tiền, nội dung, đối tượng và ngày lấy từ nguồn nên bị khoá; kế toán chọn tài khoản rồi ghi sổ hoặc trả lại. Khác ở chỗ không có
 * hồ sơ quy trình (`instance_id` NULL), nên không hỏi Procedure ai được thao tác: người có quyền duyệt phiếu thu là được, trừ người
 * lập khi cài đặt không cho tự duyệt.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nhãn phân hệ nguồn trong nhật ký phiếu. */
const SOURCE_MODULE_LABELS: Readonly<Record<FinanceExternalSourceModule, string>> = { crm: 'Bán hàng' };

/** Yêu cầu đã kiểm và chuẩn hoá. */
export interface ExternalSourceRequest {
  idempotencyKey: string;
  sourceModule: FinanceExternalSourceModule;
  sourceRef: string;
  sourceCode: string;
  kind: 'RECEIPT';
  amount: number;
  content: string;
  counterpartyName: string;
  voucherDate: string;
  initiatedBy: string;
  initiatedByName: string | null;
  description: string | null;
  projectId: string | null;
  /** sha256 của phần nội dung quyết định phiếu (không gồm tên hiển thị): cùng khoá mà khác hash thì từ chối. */
  requestHash: string;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** Kiểm yêu cầu tạo phiếu từ nguồn ngoài; sai thì ném 422 kèm lý do để bên gọi sửa (không thử lại vô ích). */
export function parseExternalSourceRequest(raw: unknown): ExternalSourceRequest {
  const p = (raw ?? {}) as Partial<Record<keyof CreateFinanceVoucherSourceRequest, unknown>>;
  const errors: string[] = [];
  const idempotencyKey = text(p.idempotencyKey, 1_000);
  if (!idempotencyKey || idempotencyKey.length > 200) errors.push('Thiếu khoá chống lặp (tối đa 200 ký tự).');
  const sourceModule = String(p.sourceModule ?? '');
  if (!(FINANCE_EXTERNAL_SOURCE_MODULES as readonly string[]).includes(sourceModule)) errors.push('Phân hệ nguồn không hợp lệ.');
  const sourceRef = text(p.sourceRef, 1_000);
  if (!sourceRef || sourceRef.length > 100) errors.push('Thiếu mã bản ghi nguồn (tối đa 100 ký tự).');
  if (p.kind !== 'RECEIPT') errors.push('Chỉ tạo được phiếu thu từ nguồn này.');
  const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) ? roundMoney(p.amount) : null;
  if (amount === null || !(amount > 0) || amount > FINANCE_MAX_AMOUNT) errors.push('Số tiền phải lớn hơn 0 và trong giới hạn cho phép.');
  const content = text(p.content, 500);
  if (!content) errors.push('Thiếu nội dung phiếu.');
  const counterpartyName = text(p.counterpartyName, 255);
  if (!counterpartyName) errors.push('Thiếu tên đối tượng nộp tiền.');
  const voucherDate = typeof p.voucherDate === 'string' && isValidDate(p.voucherDate) ? p.voucherDate : null;
  if (!voucherDate) errors.push('Ngày chứng từ không hợp lệ.');
  const initiatedBy = typeof p.initiatedBy === 'string' && UUID.test(p.initiatedBy) ? p.initiatedBy.toLowerCase() : null;
  if (!initiatedBy) errors.push('Thiếu người ghi nhận hợp lệ.');
  let projectId: string | null = null;
  if (p.projectId !== undefined && p.projectId !== null && p.projectId !== '') {
    if (typeof p.projectId === 'string' && UUID.test(p.projectId)) projectId = p.projectId.toLowerCase();
    else errors.push('Dự án không hợp lệ.');
  }
  if (errors.length) throw invalid(errors.join(' '));

  const request = {
    idempotencyKey: idempotencyKey as string,
    sourceModule: sourceModule as FinanceExternalSourceModule,
    sourceRef: sourceRef as string,
    sourceCode: text(p.sourceCode, 80) ?? (sourceRef as string).slice(0, 80),
    kind: 'RECEIPT' as const,
    amount: amount as number,
    content: content as string,
    counterpartyName: counterpartyName as string,
    voucherDate: voucherDate as string,
    initiatedBy: initiatedBy as string,
    initiatedByName: text(p.initiatedByName, 255),
    description: text(p.description, 500),
    projectId,
  };
  return { ...request, requestHash: externalRequestHash(request) };
}

/** Hash nội dung quyết định phiếu. Thứ tự trường cố định; tên hiển thị không tính để bên gọi đổi nhãn không bị coi là khác yêu cầu. */
export function externalRequestHash(r: Omit<ExternalSourceRequest, 'requestHash' | 'idempotencyKey'>): string {
  const canonical = [r.sourceModule, r.sourceRef, r.kind, r.amount.toFixed(2), r.content, r.counterpartyName, r.voucherDate, r.initiatedBy, r.description, r.projectId];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Phiếu dựng từ yêu cầu, cùng hạch toán đã xác nhận với Workspace (nếu có). */
export interface ExternalVoucherPlan {
  voucher: NormalizedVoucher;
  links: ResolvedWorkspaceLinks;
  lockedFields: FinanceSourceLockedField[];
  allocationNote: string | null;
}

/**
 * Dựng phiếu thu nháp. `resolveProject` hỏi Workspace NGOÀI giao dịch; không xác nhận được thì để trống hạch toán, không khoá,
 * và ghi chú để kế toán tự chọn (phiếu vẫn được tạo, bên gọi không phải thử lại).
 */
export async function planExternalVoucher(
  request: ExternalSourceRequest,
  resolveProject: (allocation: NormalizedVoucher['allocation']) => Promise<ResolvedWorkspaceLinks>,
  today: string = todayVn(),
): Promise<ExternalVoucherPlan> {
  const lockedFields: FinanceSourceLockedField[] = ['amount', 'content', 'counterpartyName', 'voucherDate'];
  let links: ResolvedWorkspaceLinks = { allocation: null, relatedProjects: [] };
  let allocationNote: string | null = null;
  if (request.projectId) {
    try {
      links = await resolveProject({ type: 'PROJECT', projectId: request.projectId, workItemId: null });
      if (links.allocation) lockedFields.push('allocation');
    } catch (error) {
      links = { allocation: null, relatedProjects: [] };
      const reason = error instanceof Error ? error.message : 'không rõ lý do';
      allocationNote = `Chưa xác nhận được dự án của nguồn (${reason}); kế toán chọn hạch toán.`;
    }
  }
  return {
    voucher: {
      kind: 'RECEIPT',
      voucherDate: request.voucherDate,
      postingDate: today,
      content: request.content,
      reasonId: null,
      accountId: null,
      destAccountId: null,
      counterpartyGroupId: null,
      counterpartyName: request.counterpartyName,
      counterpartyAccountNo: null,
      counterpartyBank: null,
      allocation: links.allocation ? { type: links.allocation.type, projectId: links.allocation.projectId, workItemId: links.allocation.workItemId } : null,
      taxIncluded: false,
      taxRate: 0,
      note: null,
      totalAmount: request.amount,
      lines: [{ lineNo: 1, description: request.description ?? request.content, quantity: 1, unitAmount: request.amount, total: request.amount }],
      invoices: [],
      relatedProjectIds: [],
    },
    links,
    lockedFields,
    allocationNote,
  };
}

const snapshotOf = (request: ExternalSourceRequest) =>
  JSON.stringify({
    values: {
      amount: request.amount,
      content: request.content,
      counterpartyName: request.counterpartyName,
      counterpartyAccountNo: null,
      counterpartyBank: null,
      voucherDate: request.voucherDate,
    },
    projectId: request.projectId,
    workItemId: null,
    description: request.description,
    requestedAt: new Date().toISOString(),
  });

export type ExternalSourceOutcome = 'created' | 'replayed' | 'reopened';

const UNIQUE_VIOLATION = '23505';

/**
 * Nhận yêu cầu tạo phiếu (trong giao dịch). Khoá tư vấn theo khoá chống lặp rồi theo bản ghi nguồn, nên hai lần gọi song song cùng
 * khoá chỉ tạo một phiếu; ràng buộc unique là lớp chặn cuối.
 * - cùng khoá, cùng nội dung: trả lại phiếu cũ; cùng khoá, khác nội dung: 409;
 * - bản ghi nguồn đã có phiếu (khoá khác): phiếu đang bị trả lại và còn nháp thì cập nhật theo yêu cầu mới và mở lại; còn lại 409.
 */
export async function applyExternalSourceRequest(
  db: Db,
  tenantId: string,
  request: ExternalSourceRequest,
  plan: ExternalVoucherPlan,
): Promise<{ voucherId: string; outcome: ExternalSourceOutcome }> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`finance:voucher-source-key:${tenantId}:${request.idempotencyKey}`]);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `finance:voucher-source-ref:${tenantId}:${request.sourceModule}:${request.sourceRef}`,
  ]);

  const byKey = (
    await db.query(`SELECT voucher_id, request_hash FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND idempotency_key=$2`, [
      tenantId,
      request.idempotencyKey,
    ])
  ).rows[0] as Row | undefined;
  if (byKey) {
    if (byKey.request_hash !== request.requestHash) throw idempotencyConflict();
    return { voucherId: String(byKey.voucher_id), outcome: 'replayed' };
  }

  const byRef = (
    await db.query(`SELECT * FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND source_module=$2 AND source_ref=$3 FOR UPDATE`, [
      tenantId,
      request.sourceModule,
      request.sourceRef,
    ])
  ).rows[0] as Row | undefined;
  if (byRef) return { voucherId: await reopenReturned(db, tenantId, byRef, request, plan), outcome: 'reopened' };

  const label = SOURCE_MODULE_LABELS[request.sourceModule];
  const creator: FinanceActor = {
    tenantId,
    userId: request.initiatedBy,
    displayName: request.initiatedByName ?? `Người ghi nhận (${label})`,
    permissions: [],
  };
  await db.query('SAVEPOINT finance_external_source');
  try {
    const voucherId = await createVoucher(db, tenantId, creator, plan.voucher, plan.links);
    await db.query(`UPDATE finance_schema.vouchers SET approval_mode='INHERITED' WHERE tenant_id=$1 AND id=$2`, [tenantId, voucherId]);
    await db.query(`UPDATE finance_schema.voucher_events SET note=$2 WHERE voucher_id=$1 AND action='CREATED'`, [
      voucherId,
      `Tạo từ ${request.sourceCode} của ${label}`,
    ]);
    if (plan.allocationNote) await addEvent(db, tenantId, voucherId, 'UPDATED', null, plan.allocationNote);
    await db.query(
      `INSERT INTO finance_schema.voucher_sources
         (voucher_id, tenant_id, source_module, source_ref, idempotency_key, request_hash, instance_id, instance_code, instance_title,
          step_instance_id, activation, snapshot, locked_fields)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,NULL,1,$9::jsonb,$10)`,
      [
        voucherId, tenantId, request.sourceModule, request.sourceRef, request.idempotencyKey, request.requestHash, request.sourceCode,
        request.content.slice(0, 255), snapshotOf(request), plan.lockedFields,
      ],
    );
    await db.query('RELEASE SAVEPOINT finance_external_source');
    return { voucherId, outcome: 'created' };
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    // Chỉ xảy ra khi hai yêu cầu khác bản ghi nguồn dùng chung một khoá chống lặp cùng lúc.
    await db.query('ROLLBACK TO SAVEPOINT finance_external_source');
    throw idempotencyConflict();
  }
}

const idempotencyConflict = () => conflict('FINANCE_IDEMPOTENCY_CONFLICT', 'Khoá chống lặp đã được dùng cho một yêu cầu khác.');

/** Bản ghi nguồn gửi lại bằng khoá mới: chỉ nhận khi phiếu đã bị trả lại và còn nháp (bên nguồn đã sửa và gửi lại). */
async function reopenReturned(db: Db, tenantId: string, source: Row, request: ExternalSourceRequest, plan: ExternalVoucherPlan): Promise<string> {
  const voucherId = String(source.voucher_id);
  const voucher = (await db.query(`SELECT status FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, voucherId]))
    .rows[0] as Row | undefined;
  if (source.status !== 'RETURNED' || voucher?.status !== 'DRAFT')
    throw conflict('FINANCE_SOURCE_REF_CONFLICT', `${String(source.instance_code)} đã có phiếu thu; chỉ gửi lại được khi phiếu đã bị trả lại.`);
  const v = plan.voucher;
  await db.query(
    `UPDATE finance_schema.vouchers SET content=$3, voucher_date=$4, counterparty_name=$5, total_amount=$6, revision=revision+1, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, voucherId, v.content, v.voucherDate, v.counterpartyName, v.totalAmount],
  );
  if (plan.lockedFields.includes('allocation'))
    await db.query(
      `UPDATE finance_schema.vouchers SET alloc_type=$3, alloc_project_id=$4, alloc_project_code=$5, alloc_project_name=$6,
              alloc_work_item_id=$7, alloc_work_item_code=$8, alloc_work_item_title=$9 WHERE tenant_id=$1 AND id=$2`,
      [tenantId, voucherId, ...allocationColumns(plan.links)],
    );
  await db.query(`DELETE FROM finance_schema.voucher_lines WHERE voucher_id=$1`, [voucherId]);
  for (const line of v.lines)
    await db.query(
      `INSERT INTO finance_schema.voucher_lines (tenant_id, voucher_id, line_no, description, quantity, unit_amount, total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, voucherId, line.lineNo, line.description, line.quantity, line.unitAmount, line.total],
    );
  await db.query(
    `UPDATE finance_schema.voucher_sources SET idempotency_key=$3, request_hash=$4, instance_code=$5, instance_title=$6, snapshot=$7::jsonb,
            locked_fields=$8, activation=activation+1, status='OPEN', handling_by=NULL, handling_by_name=NULL, handling_since=NULL, updated_at=now()
      WHERE tenant_id=$1 AND voucher_id=$2`,
    [
      tenantId, voucherId, request.idempotencyKey, request.requestHash, request.sourceCode, request.content.slice(0, 255), snapshotOf(request),
      plan.lockedFields,
    ],
  );
  await addEvent(
    db,
    tenantId,
    voucherId,
    'UPDATED',
    null,
    `${request.sourceCode} được gửi lại từ ${SOURCE_MODULE_LABELS[request.sourceModule]}; cập nhật theo nguồn.${plan.allocationNote ? ` ${plan.allocationNote}` : ''}`,
  );
  return voucherId;
}

const STATE_SELECT = `SELECT s.voucher_id, s.status AS source_status, s.source_module, s.source_ref, v.code, v.status, v.total_amount, v.posted_at
  FROM finance_schema.voucher_sources s JOIN finance_schema.vouchers v ON v.id = s.voucher_id`;

function stateOf(row: Row | undefined): FinanceVoucherSourceState {
  if (!row) throw notFound('phiếu của bản ghi nguồn');
  return {
    voucherId: String(row.voucher_id),
    voucherCode: String(row.code),
    status: String(row.status),
    sourceStatus: row.source_status as FinanceVoucherSourceStatus,
    sourceModule: row.source_module as FinanceSourceModule,
    sourceRef: String(row.source_ref),
    amount: num(row.total_amount),
    postedAt: row.posted_at ? iso(row.posted_at) : null,
  };
}

/** Trạng thái phiếu của một bản ghi nguồn, để bên nguồn đối soát khi mất sự kiện. */
export async function externalSourceState(db: Db, tenantId: string, sourceModule: string, sourceRef: string): Promise<FinanceVoucherSourceState> {
  if (!(FINANCE_EXTERNAL_SOURCE_MODULES as readonly string[]).includes(sourceModule)) throw invalid('Phân hệ nguồn không hợp lệ.');
  return stateOf(
    (await db.query(`${STATE_SELECT} WHERE s.tenant_id=$1 AND s.source_module=$2 AND s.source_ref=$3`, [tenantId, sourceModule, sourceRef])).rows[0] as
      | Row
      | undefined,
  );
}

/** Trạng thái theo phiếu (trả cho bên gọi sau khi tạo), cùng hình dạng với `externalSourceState`. */
export async function externalSourceStateOfVoucher(db: Db, tenantId: string, voucherId: string): Promise<FinanceVoucherSourceState> {
  return stateOf((await db.query(`${STATE_SELECT} WHERE s.tenant_id=$1 AND s.voucher_id=$2`, [tenantId, voucherId])).rows[0] as Row | undefined);
}

/**
 * Bên nguồn huỷ bản ghi nguồn (Bán hàng huỷ lần thu bị trả lại, T5-15): phiếu còn nháp thì ĐÃ HUỶ (không bút toán), nguồn đóng.
 * Gọi lại với phiếu đã huỷ trả trạng thái hiện tại (idempotent). Phiếu đã gửi duyệt hoặc đã ghi sổ thì 409: kế toán xử lý bên Tài chính.
 */
export async function cancelExternalSource(
  db: Db,
  tenantId: string,
  sourceModule: string,
  sourceRef: string,
  reason: string | null,
): Promise<FinanceVoucherSourceState> {
  if (!(FINANCE_EXTERNAL_SOURCE_MODULES as readonly string[]).includes(sourceModule)) throw invalid('Phân hệ nguồn không hợp lệ.');
  const source = (
    await db.query(`SELECT voucher_id, instance_code FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND source_module=$2 AND source_ref=$3 FOR UPDATE`, [
      tenantId,
      sourceModule,
      sourceRef,
    ])
  ).rows[0] as Row | undefined;
  if (!source) throw notFound('phiếu của bản ghi nguồn');
  const voucherId = String(source.voucher_id);
  const voucher = (await db.query(`SELECT code, status FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, voucherId]))
    .rows[0] as Row | undefined;
  if (!voucher) throw notFound('phiếu của bản ghi nguồn');
  if (voucher.status === 'DRAFT') {
    const label = SOURCE_MODULE_LABELS[sourceModule as FinanceExternalSourceModule];
    const note = `${String(source.instance_code)} đã bị huỷ bên ${label}${reason?.trim() ? `: ${reason.trim()}` : ''}`.slice(0, 2000);
    await closeWithoutPosting(db, tenantId, voucherId, 'CANCELLED', { userId: FINANCE_SYSTEM_ACTOR_ID, displayName: label }, note);
    await db.query(
      `UPDATE finance_schema.voucher_sources SET status='CLOSED', handling_by=NULL, handling_by_name=NULL, handling_since=NULL, updated_at=now()
        WHERE tenant_id=$1 AND voucher_id=$2`,
      [tenantId, voucherId],
    );
  } else if (voucher.status !== 'CANCELLED') {
    throw conflict(
      'FINANCE_SOURCE_NOT_CANCELLABLE',
      `Phiếu ${String(voucher.code)} không còn là nháp (đã gửi duyệt hoặc đã ghi sổ); huỷ hoặc đảo phiếu bên Tài chính.`,
    );
  }
  return externalSourceStateOfVoucher(db, tenantId, voucherId);
}
