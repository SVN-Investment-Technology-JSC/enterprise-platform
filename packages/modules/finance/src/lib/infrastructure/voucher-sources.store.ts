import { randomUUID } from 'node:crypto';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import {
  FINANCE_MAX_AMOUNT,
  FINANCE_SOURCE_HANDLING_TTL_MINUTES,
  FINANCE_STEP_VOUCHER_KINDS,
  FINANCE_VOUCHER_LINKED,
  FINANCE_VOUCHER_POSTED,
  FINANCE_VOUCHER_RETURNED,
  roundMoney,
  type FinanceSourceLockedField,
  type FinanceStepAssigneeSubject,
  type FinanceStepVoucherRequestedPayload,
  type FinanceStepVoucherRequestedValues,
  type FinanceInstanceReversalCheck,
  type FinanceVoucherKind,
  type FinanceVoucherLinkedPayload,
  type FinanceVoucherPostedPayload,
  type FinanceVoucherReturnedPayload,
  type FinanceVoucherSource,
  type FinanceVoucherSourceStatus,
} from '@enterprise-platform/contracts-finance';
import { canApprove, type FinanceActor } from '../domain/finance.access.js';
import { FinanceError, conflict, forbidden, invalid, invalidMany, notFound } from '../domain/finance.error.js';
import { FINANCE_SYSTEM_ACTOR_ID } from '../domain/procedure-attributes.js';
import { isValidDate, type NormalizedVoucher } from '../domain/voucher.rules.js';
import { dateOnly, iso, num, optStr, todayVn, type Db } from './finance.database.js';
import { closeWithoutPosting, postApproval, postReversal, reversalBlocker, submitErrors, type Decider } from './voucher-workflow.js';
import {
  addEvent,
  allocationColumns,
  canViewVoucher,
  createVoucher,
  loadVoucherRecord,
  replaceChildren,
  type ResolvedWorkspaceLinks,
  type Row,
} from './vouchers.store.js';

/**
 * Phiếu tạo từ bước Tài chính của một hồ sơ quy trình (`approval_mode = 'INHERITED'`).
 *
 * - Hồ sơ sở hữu dữ liệu đề nghị (số tiền, nội dung, người nhận...): các trường này bị khoá trên phiếu, muốn sửa thì trả hồ sơ về.
 * - Phiếu sở hữu dữ liệu kế toán (tài khoản, lý do, ngày hạch toán, hoá đơn...).
 * - Một hồ sơ = một phiếu. Hồ sơ quay lại bước Tài chính thì cập nhật đúng phiếu nháp đó.
 * - Kết quả (ghi sổ / trả hồ sơ) báo cho Procedure bằng sự kiện ghi vào outbox CÙNG giao dịch với thay đổi của phiếu.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bảng nguồn đã có (migration 0006): worker chờ migration trước khi nhận yêu cầu tạo phiếu. */
export async function financeVoucherSourcesReady(pool: Db): Promise<boolean> {
  return Boolean((await pool.query(`SELECT to_regclass('finance_schema.voucher_sources') AS relation`)).rows[0]?.relation);
}

/* --------------------------------- Payload --------------------------------- */

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** Kiểm và chuẩn hoá payload yêu cầu; sai cấu trúc thì ném lỗi (sự kiện hỏng, không thử lại được). */
export function parseVoucherRequested(raw: unknown): FinanceStepVoucherRequestedPayload {
  const p = (raw ?? {}) as Partial<FinanceStepVoucherRequestedPayload> & { values?: Partial<FinanceStepVoucherRequestedValues> };
  if (typeof p.instanceId !== 'string' || !UUID.test(p.instanceId)) throw new Error('Yêu cầu tạo phiếu thiếu instanceId hợp lệ.');
  if (typeof p.stepInstanceId !== 'string' || !p.stepInstanceId || p.stepInstanceId.length > 100)
    throw new Error('Yêu cầu tạo phiếu thiếu stepInstanceId hợp lệ.');
  if (!Number.isInteger(p.activation) || (p.activation as number) < 1) throw new Error('Yêu cầu tạo phiếu thiếu activation hợp lệ.');
  if (!(FINANCE_STEP_VOUCHER_KINDS as readonly string[]).includes(String(p.voucherKind))) throw new Error('Loại phiếu của bước Tài chính không hợp lệ.');
  if (typeof p.initiatedBy !== 'string' || !UUID.test(p.initiatedBy)) throw new Error('Yêu cầu tạo phiếu thiếu người khởi tạo hồ sơ.');
  const values: Partial<FinanceStepVoucherRequestedValues> = p.values ?? {};
  const amount = typeof values.amount === 'number' && Number.isFinite(values.amount) ? values.amount : null;
  const subjects = Array.isArray(p.assigneeSubjects)
    ? p.assigneeSubjects
        .filter((s): s is FinanceStepAssigneeSubject => Boolean(s) && typeof s.subjectType === 'string' && typeof s.subjectId === 'string')
        .slice(0, 50)
        .map((s) => ({ subjectType: s.subjectType, subjectId: s.subjectId, ...(s.subjectLabel ? { subjectLabel: String(s.subjectLabel).slice(0, 255) } : {}) }))
    : [];
  return {
    instanceId: p.instanceId.toLowerCase(),
    instanceCode: clip(p.instanceCode, 80) ?? p.instanceId.slice(0, 8),
    instanceTitle: clip(p.instanceTitle, 255) ?? '',
    definitionId: typeof p.definitionId === 'string' && UUID.test(p.definitionId) ? p.definitionId : '',
    definitionName: clip(p.definitionName, 255) ?? '',
    stepInstanceId: p.stepInstanceId,
    stepName: clip(p.stepName, 255) ?? '',
    activation: p.activation as number,
    voucherKind: p.voucherKind as FinanceStepVoucherRequestedPayload['voucherKind'],
    values: {
      amount,
      content: clip(values.content, 500),
      counterpartyName: clip(values.counterpartyName, 255),
      counterpartyAccountNo: clip(values.counterpartyAccountNo, 60),
      counterpartyBank: clip(values.counterpartyBank, 120),
      voucherDate: typeof values.voucherDate === 'string' && isValidDate(values.voucherDate) ? values.voucherDate : null,
    },
    ...(typeof p.projectId === 'string' && UUID.test(p.projectId) ? { projectId: p.projectId.toLowerCase() } : {}),
    ...(typeof p.workItemId === 'string' && UUID.test(p.workItemId) ? { workItemId: p.workItemId.toLowerCase() } : {}),
    initiatedBy: p.initiatedBy,
    ...(clip(p.initiatedByName, 255) ? { initiatedByName: clip(p.initiatedByName, 255) as string } : {}),
    assigneeIds: Array.isArray(p.assigneeIds) ? p.assigneeIds.filter((id) => typeof id === 'string' && UUID.test(id)).slice(0, 200) : [],
    assigneeSubjects: subjects,
    ...(clip(p.assigneeLabel, 255) ? { assigneeLabel: clip(p.assigneeLabel, 255) as string } : {}),
    requestedAt: typeof p.requestedAt === 'string' ? p.requestedAt : new Date().toISOString(),
  };
}

/** Phiếu dựng từ hồ sơ, cùng hạch toán đã xác nhận với Workspace (nếu có) và các trường bị khoá. */
export interface RequestedVoucherPlan {
  voucher: NormalizedVoucher;
  links: ResolvedWorkspaceLinks;
  lockedFields: FinanceSourceLockedField[];
  /** Ghi chú khi hồ sơ có dự án/công việc mà không xác nhận được với Workspace: kế toán tự chọn hạch toán. */
  allocationNote: string | null;
}

/** Số tiền dùng được của hồ sơ: dương và trong giới hạn; còn lại coi như 0 (phiếu không ghi sổ được, kế toán trả hồ sơ về). */
export function requestedAmount(amount: number | null): number {
  if (amount === null || !(amount > 0) || amount > FINANCE_MAX_AMOUNT) return 0;
  return roundMoney(amount);
}

/**
 * Dựng phiếu nháp từ payload. Hạch toán lấy theo thứ tự công việc > dự án > để trống; `resolveAllocation` hỏi Workspace (gọi
 * NGOÀI giao dịch). Không xác nhận được thì để trống, không khoá, và ghi chú để kế toán tự chọn.
 */
export async function planRequestedVoucher(
  payload: FinanceStepVoucherRequestedPayload,
  resolveAllocation: (allocation: NormalizedVoucher['allocation']) => Promise<ResolvedWorkspaceLinks>,
  findWorkItemProject: (workItemId: string) => Promise<string | null>,
  today: string = todayVn(),
): Promise<RequestedVoucherPlan> {
  const v = payload.values;
  const amount = requestedAmount(v.amount);
  const content = v.content ?? (payload.instanceTitle || `Hồ sơ ${payload.instanceCode}`).slice(0, 500);
  const lockedFields: FinanceSourceLockedField[] = ['amount', 'content'];
  if (v.counterpartyName) lockedFields.push('counterpartyName');
  if (v.counterpartyAccountNo) lockedFields.push('counterpartyAccountNo');
  if (v.counterpartyBank) lockedFields.push('counterpartyBank');
  if (v.voucherDate) lockedFields.push('voucherDate');

  let links: ResolvedWorkspaceLinks = { allocation: null, relatedProjects: [] };
  let allocationNote: string | null = null;
  if (payload.workItemId || payload.projectId) {
    try {
      let allocation: NormalizedVoucher['allocation'] = null;
      if (payload.workItemId) {
        const projectId = await findWorkItemProject(payload.workItemId);
        if (!projectId) throw invalid('Công việc của hồ sơ không còn tồn tại.');
        allocation = { type: 'WORK_ITEM', projectId, workItemId: payload.workItemId };
      } else if (payload.projectId) {
        allocation = { type: 'PROJECT', projectId: payload.projectId, workItemId: null };
      }
      links = await resolveAllocation(allocation);
      if (links.allocation) lockedFields.push('allocation');
    } catch (error) {
      links = { allocation: null, relatedProjects: [] };
      const reason = error instanceof Error ? error.message : 'không rõ lý do';
      allocationNote = `Chưa xác nhận được dự án/công việc của hồ sơ (${reason}); kế toán chọn hạch toán.`;
    }
  }

  return {
    voucher: {
      kind: payload.voucherKind,
      voucherDate: v.voucherDate ?? today,
      postingDate: today,
      content,
      reasonId: null,
      accountId: null,
      destAccountId: null,
      counterpartyGroupId: null,
      counterpartyName: v.counterpartyName,
      counterpartyAccountNo: v.counterpartyAccountNo,
      counterpartyBank: v.counterpartyBank,
      allocation: links.allocation
        ? { type: links.allocation.type, projectId: links.allocation.projectId, workItemId: links.allocation.workItemId }
        : null,
      taxIncluded: false,
      taxRate: 0,
      note: null,
      totalAmount: amount,
      lines: amount > 0 ? [{ lineNo: 1, description: content, quantity: 1, unitAmount: amount, total: amount }] : [],
      invoices: [],
      relatedProjectIds: [],
    },
    links,
    lockedFields,
    allocationNote,
  };
}

/* --------------------------------- Sự kiện --------------------------------- */

/** Ghi sự kiện cho Procedure vào outbox trong giao dịch hiện tại. */
async function emit(
  db: Db,
  tenantId: string,
  type: string,
  voucherId: string,
  payload: FinanceVoucherLinkedPayload | FinanceVoucherPostedPayload | FinanceVoucherReturnedPayload,
): Promise<void> {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type,
    version: 1,
    tenantId,
    source: 'finance',
    correlationId: payload.instanceId,
    payload,
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'finance-voucher', $2, $3, $4, $5::jsonb, $6)`,
    [event.id, voucherId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

/* ------------------------------ Nguồn của phiếu ------------------------------ */

export async function loadSourceRow(db: Db, tenantId: string, voucherId: string, lock = false): Promise<Row | undefined> {
  return (
    await db.query(`SELECT * FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND voucher_id=$2${lock ? ' FOR UPDATE' : ''}`, [tenantId, voucherId])
  ).rows[0] as Row | undefined;
}

/** Khoá mềm còn hiệu lực: ai đó đã thao tác trong vòng TTL. */
export function activeHandler(source: Row, now: Date = new Date()): { userId: string; name: string | null; since: string } | null {
  if (!source.handling_by || !source.handling_since) return null;
  const since = new Date(String(source.handling_since instanceof Date ? source.handling_since.toISOString() : source.handling_since));
  if (now.getTime() - since.getTime() > FINANCE_SOURCE_HANDLING_TTL_MINUTES * 60_000) return null;
  return { userId: String(source.handling_by), name: optStr(source.handling_by_name), since: iso(source.handling_since) };
}

export function mapSource(source: Row, canAct: boolean | null, canActReason: string | null, now: Date = new Date()): FinanceVoucherSource {
  const snapshot = (source.snapshot ?? {}) as { values?: FinanceStepVoucherRequestedValues; projectId?: string; workItemId?: string };
  const handler = activeHandler(source, now);
  return {
    instanceId: String(source.instance_id),
    instanceCode: String(source.instance_code),
    instanceTitle: optStr(source.instance_title),
    definitionName: optStr(source.definition_name),
    stepName: optStr(source.step_name),
    activation: num(source.activation),
    status: source.status as FinanceVoucherSourceStatus,
    values: {
      amount: snapshot.values?.amount ?? null,
      content: snapshot.values?.content ?? null,
      counterpartyName: snapshot.values?.counterpartyName ?? null,
      counterpartyAccountNo: snapshot.values?.counterpartyAccountNo ?? null,
      counterpartyBank: snapshot.values?.counterpartyBank ?? null,
      voucherDate: snapshot.values?.voucherDate ?? null,
    },
    requestedProjectId: snapshot.projectId ?? null,
    requestedWorkItemId: snapshot.workItemId ?? null,
    lockedFields: ((source.locked_fields as string[] | null) ?? []) as FinanceSourceLockedField[],
    assigneeLabel: optStr(source.assignee_label),
    handlingBy: handler?.userId ?? null,
    handlingByName: handler?.name ?? null,
    handlingSince: handler?.since ?? null,
    canAct,
    canActReason,
    reversalReason: optStr(source.reversal_reason),
    reversalError: optStr(source.reversal_error),
  };
}

const snapshotOf = (payload: FinanceStepVoucherRequestedPayload) =>
  JSON.stringify({ values: payload.values, projectId: payload.projectId ?? null, workItemId: payload.workItemId ?? null, requestedAt: payload.requestedAt });

function linkedPayload(payload: FinanceStepVoucherRequestedPayload, voucher: Row): FinanceVoucherLinkedPayload {
  return {
    instanceId: payload.instanceId,
    stepInstanceId: payload.stepInstanceId,
    activation: payload.activation,
    voucherId: String(voucher.id),
    code: String(voucher.code),
    status: String(voucher.status),
    amount: num(voucher.total_amount),
  };
}

export type VoucherRequestedOutcome = 'created' | 'updated' | 'relinked' | 'reposted' | 'ignored';

/**
 * Nhận yêu cầu tạo phiếu của bước Tài chính (trong giao dịch, sau khi đã giành hộp thư). Một hồ sơ = một phiếu:
 * - chưa có phiếu: tạo phiếu nháp INHERITED và nguồn;
 * - có phiếu nháp và lần kích hoạt mới hơn: cập nhật các trường lấy từ hồ sơ, giữ phần kế toán đã nhập;
 * - cùng lần kích hoạt (giao lại): báo lại `linked`;
 * - phiếu đã ghi sổ: báo lại `posted` (bù sự kiện bị mất); phiếu đã huỷ: bỏ qua.
 */
export async function applyVoucherRequested(
  db: Db,
  tenantId: string,
  payload: FinanceStepVoucherRequestedPayload,
  plan: RequestedVoucherPlan,
): Promise<VoucherRequestedOutcome> {
  const existing = (
    await db.query(`SELECT * FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND instance_id=$2 FOR UPDATE`, [tenantId, payload.instanceId])
  ).rows[0] as Row | undefined;
  const assignees = [payload.assigneeIds, JSON.stringify(payload.assigneeSubjects), payload.assigneeLabel ?? null];

  if (!existing) {
    const creator: FinanceActor = {
      tenantId,
      userId: payload.initiatedBy,
      displayName: payload.initiatedByName ?? 'Người khởi tạo hồ sơ',
      permissions: [],
    };
    const voucherId = await createVoucher(db, tenantId, creator, plan.voucher, plan.links);
    await db.query(`UPDATE finance_schema.vouchers SET approval_mode='INHERITED' WHERE tenant_id=$1 AND id=$2`, [tenantId, voucherId]);
    await db.query(
      `UPDATE finance_schema.voucher_events SET note=$2 WHERE voucher_id=$1 AND action='CREATED'`,
      [voucherId, `Tạo từ hồ sơ ${payload.instanceCode}${payload.stepName ? ` (bước ${payload.stepName})` : ''}`],
    );
    if (plan.allocationNote) await addEvent(db, tenantId, voucherId, 'UPDATED', null, plan.allocationNote);
    await db.query(
      `INSERT INTO finance_schema.voucher_sources
         (voucher_id, tenant_id, instance_id, instance_code, instance_title, definition_id, definition_name, step_instance_id, step_name,
          activation, snapshot, locked_fields, assignee_ids, assignee_subjects, assignee_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15)`,
      [
        voucherId, tenantId, payload.instanceId, payload.instanceCode, payload.instanceTitle || null, payload.definitionId || null,
        payload.definitionName || null, payload.stepInstanceId, payload.stepName || null, payload.activation, snapshotOf(payload),
        plan.lockedFields, ...assignees,
      ],
    );
    const voucher = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE id=$1`, [voucherId])).rows[0] as Row;
    await emit(db, tenantId, FINANCE_VOUCHER_LINKED, voucherId, linkedPayload(payload, voucher));
    return 'created';
  }

  const voucherId = String(existing.voucher_id);
  const voucher = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, voucherId])).rows[0] as Row;
  if (voucher.status === 'APPROVED' && existing.status === 'POSTED') {
    await emit(db, tenantId, FINANCE_VOUCHER_POSTED, voucherId, {
      instanceId: payload.instanceId,
      stepInstanceId: payload.stepInstanceId,
      activation: payload.activation,
      voucherId,
      code: String(voucher.code),
      amount: num(voucher.total_amount),
      postedAt: iso(voucher.posted_at ?? voucher.decided_at ?? new Date()),
      postedBy: String(voucher.decided_by ?? payload.initiatedBy),
      ...(voucher.decided_by_name ? { postedByName: String(voucher.decided_by_name) } : {}),
    });
    return 'reposted';
  }
  if (voucher.status !== 'DRAFT' || existing.status === 'CLOSED') return 'ignored';
  if (payload.activation < num(existing.activation)) return 'ignored';
  if (payload.activation === num(existing.activation)) {
    // Đã trả hồ sơ về ở lần này: sự kiện giao lại của chính lần đó không mở lại phiếu.
    if (existing.status !== 'OPEN') return 'ignored';
    await emit(db, tenantId, FINANCE_VOUCHER_LINKED, voucherId, linkedPayload(payload, voucher));
    return 'relinked';
  }

  // Hồ sơ quay lại bước Tài chính: cập nhật đúng phiếu nháp này theo giá trị mới của hồ sơ.
  const v = plan.voucher;
  const allocation = plan.lockedFields.includes('allocation') ? allocationColumns(plan.links) : null;
  await db.query(
    `UPDATE finance_schema.vouchers SET content=$3, voucher_date=$4, counterparty_name=$5, counterparty_account_no=$6, counterparty_bank=$7,
            total_amount=$8, revision=revision+1, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, voucherId, v.content, v.voucherDate, v.counterpartyName, v.counterpartyAccountNo, v.counterpartyBank, v.totalAmount],
  );
  if (allocation)
    await db.query(
      `UPDATE finance_schema.vouchers SET alloc_type=$3, alloc_project_id=$4, alloc_project_code=$5, alloc_project_name=$6,
              alloc_work_item_id=$7, alloc_work_item_code=$8, alloc_work_item_title=$9 WHERE tenant_id=$1 AND id=$2`,
      [tenantId, voucherId, ...allocation],
    );
  await db.query(`DELETE FROM finance_schema.voucher_lines WHERE voucher_id=$1`, [voucherId]);
  for (const line of v.lines)
    await db.query(
      `INSERT INTO finance_schema.voucher_lines (tenant_id, voucher_id, line_no, description, quantity, unit_amount, total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, voucherId, line.lineNo, line.description, line.quantity, line.unitAmount, line.total],
    );
  const locked = new Set(plan.lockedFields);
  // Hạch toán do kế toán tự chọn lần trước (hồ sơ không có dự án) vẫn được giữ, không khoá.
  if (!allocation) locked.delete('allocation');
  await db.query(
    `UPDATE finance_schema.voucher_sources SET activation=$3, step_instance_id=$4, step_name=$5, snapshot=$6::jsonb, locked_fields=$7,
            assignee_ids=$8, assignee_subjects=$9::jsonb, assignee_label=$10, status='OPEN',
            handling_by=NULL, handling_by_name=NULL, handling_since=NULL, updated_at=now()
      WHERE tenant_id=$1 AND voucher_id=$2`,
    [tenantId, voucherId, payload.activation, payload.stepInstanceId, payload.stepName || null, snapshotOf(payload), [...locked], ...assignees],
  );
  await addEvent(
    db,
    tenantId,
    voucherId,
    'UPDATED',
    null,
    `Hồ sơ ${payload.instanceCode} quay lại bước Tài chính (lần ${payload.activation}); cập nhật theo hồ sơ.${plan.allocationNote ? ` ${plan.allocationNote}` : ''}`,
  );
  const updated = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE id=$1`, [voucherId])).rows[0] as Row;
  await emit(db, tenantId, FINANCE_VOUCHER_LINKED, voucherId, linkedPayload(payload, updated));
  return 'updated';
}

/* --------------------------- Thao tác của kế toán --------------------------- */

/** Bối cảnh thao tác đã được Procedure xác nhận (`can-act`) ngoài giao dịch. */
export interface SourcedAction {
  /** Lần kích hoạt mà `can-act` đã xác nhận; phiếu đã sang lần khác thì từ chối. */
  activation: number;
  /** Phiên bản phiếu người dùng đang xem (khoá lạc quan). */
  revision?: number;
}

interface LockedSourced {
  row: Row;
  source: Row;
  kind: FinanceVoucherKind;
}

/** Khoá phiếu và nguồn, kiểm điều kiện chung của mọi thao tác kế toán trên phiếu có nguồn. */
async function lockSourced(db: Db, tenantId: string, actor: FinanceActor, voucherId: string, action: SourcedAction, requireHandler: boolean): Promise<LockedSourced> {
  const row = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, voucherId])).rows[0] as
    | Row
    | undefined;
  if (!row || !canViewVoucher(actor, row)) throw notFound('phiếu');
  const kind = row.kind as FinanceVoucherKind;
  const source = await loadSourceRow(db, tenantId, voucherId, true);
  if (row.approval_mode !== 'INHERITED' || !source) throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu không tạo từ hồ sơ quy trình.');
  if (!canApprove(actor, kind)) throw forbidden('Bạn không có quyền ghi sổ loại phiếu này.');
  if (row.status !== 'DRAFT' || source.status !== 'OPEN')
    throw conflict(
      'FINANCE_SOURCE_STATE',
      row.status === 'APPROVED'
        ? `Phiếu đã được ghi sổ${row.decided_by_name ? ` bởi ${String(row.decided_by_name)}` : ''}.`
        : source.status === 'RETURNED'
          ? 'Hồ sơ đã được trả về; chờ hồ sơ quay lại bước Tài chính.'
          : 'Phiếu không còn chờ ghi sổ.',
    );
  if (num(source.activation) !== action.activation)
    throw conflict('FINANCE_SOURCE_STALE', 'Hồ sơ đã chuyển sang lần xử lý khác; tải lại phiếu.');
  if (action.revision !== undefined && action.revision !== num(row.revision))
    throw conflict('FINANCE_REVISION_CONFLICT', 'Phiếu đã được thay đổi bởi lần lưu khác; tải lại trước khi thao tác.');
  if (requireHandler) {
    const handler = activeHandler(source);
    if (handler && handler.userId !== actor.userId)
      throw conflict('FINANCE_SOURCE_HANDLED', `${handler.name ?? 'Người khác'} đang xử lý phiếu này; dùng "Nhận xử lý thay" nếu cần.`);
  }
  return { row, source, kind };
}

async function markHandling(db: Db, tenantId: string, voucherId: string, actor: FinanceActor): Promise<void> {
  await db.query(
    `UPDATE finance_schema.voucher_sources SET handling_by=$3, handling_by_name=$4, handling_since=now(), updated_at=now() WHERE tenant_id=$1 AND voucher_id=$2`,
    [tenantId, voucherId, actor.userId, actor.displayName],
  );
}

/**
 * Kế toán lưu phần được nhập. Các trường lấy từ hồ sơ (và dòng chi tiết, tổng tiền) luôn giữ nguyên như đang lưu, dù client gửi
 * gì. Lưu cũng là nhận xử lý phiếu (khoá mềm).
 */
export async function updateSourcedVoucher(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  voucherId: string,
  input: NormalizedVoucher,
  links: ResolvedWorkspaceLinks,
  action: SourcedAction,
): Promise<void> {
  const { row, source, kind } = await lockSourced(db, tenantId, actor, voucherId, action, true);
  if (input.kind !== kind) throw invalid('Không đổi được loại phiếu.');
  const locked = new Set(((source.locked_fields as string[] | null) ?? []) as FinanceSourceLockedField[]);
  const record = await loadVoucherRecord(db, tenantId, voucherId);
  const merged: NormalizedVoucher = {
    ...input,
    content: String(row.content),
    voucherDate: locked.has('voucherDate') ? dateOnly(row.voucher_date) : input.voucherDate,
    counterpartyName: locked.has('counterpartyName') ? optStr(row.counterparty_name) : input.counterpartyName,
    counterpartyAccountNo: locked.has('counterpartyAccountNo') ? optStr(row.counterparty_account_no) : input.counterpartyAccountNo,
    counterpartyBank: locked.has('counterpartyBank') ? optStr(row.counterparty_bank) : input.counterpartyBank,
    totalAmount: num(row.total_amount),
    lines: record.lines.map((line) => ({
      lineNo: num(line.line_no),
      description: String(line.description),
      quantity: num(line.quantity),
      unitAmount: num(line.unit_amount),
      total: num(line.total),
    })),
  };
  await db.query(
    `UPDATE finance_schema.vouchers SET voucher_date=$3, posting_date=$4, reason_id=$5, account_id=$6, counterparty_group_id=$7,
            counterparty_name=$8, counterparty_account_no=$9, counterparty_bank=$10, tax_included=$11, tax_rate=$12, note=$13,
            alloc_type=$14, alloc_project_id=$15, alloc_project_code=$16, alloc_project_name=$17,
            alloc_work_item_id=$18, alloc_work_item_code=$19, alloc_work_item_title=$20,
            revision=revision+1, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [
      tenantId, voucherId, merged.voucherDate, merged.postingDate, merged.reasonId, merged.accountId, merged.counterpartyGroupId,
      merged.counterpartyName, merged.counterpartyAccountNo, merged.counterpartyBank, merged.taxIncluded, merged.taxRate, merged.note,
      ...allocationColumns(links),
    ],
  );
  await replaceChildren(db, tenantId, voucherId, merged, links);
  await markHandling(db, tenantId, voucherId, actor);
  await addEvent(db, tenantId, voucherId, 'UPDATED', actor);
}

/** Người khác đang giữ khoá mềm: nhận xử lý thay, ghi vào nhật ký phiếu. */
export async function takeOverSourcedVoucher(db: Db, tenantId: string, actor: FinanceActor, voucherId: string, action: SourcedAction): Promise<void> {
  const { source } = await lockSourced(db, tenantId, actor, voucherId, action, false);
  const handler = activeHandler(source);
  await markHandling(db, tenantId, voucherId, actor);
  if (handler && handler.userId !== actor.userId)
    await addEvent(db, tenantId, voucherId, 'TAKEN_OVER', actor, `Nhận xử lý thay ${handler.name ?? 'người đang xử lý'}`);
}

/**
 * Ghi sổ phiếu có nguồn: kiểm đủ điều kiện như gửi duyệt, rồi ghi sổ y như duyệt trực tiếp (khoá sổ, số dư, cấp mã chính thức)
 * và báo Procedure đóng bước — tất cả trong một giao dịch.
 */
export async function postSourcedVoucher(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  voucherId: string,
  action: SourcedAction,
  note?: string,
): Promise<void> {
  const { row, source } = await lockSourced(db, tenantId, actor, voucherId, action, true);
  const errors = await submitErrors(db, tenantId, await loadVoucherRecord(db, tenantId, voucherId));
  if (errors.length) throw invalidMany('FINANCE_POST_INVALID', errors);
  await postApproval(db, tenantId, row, actor, note);
  const posted = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [tenantId, voucherId])).rows[0] as Row;
  await db.query(
    `UPDATE finance_schema.voucher_sources SET status='POSTED', handling_by=NULL, handling_by_name=NULL, handling_since=NULL, updated_at=now()
      WHERE tenant_id=$1 AND voucher_id=$2`,
    [tenantId, voucherId],
  );
  await emit(db, tenantId, FINANCE_VOUCHER_POSTED, voucherId, {
    instanceId: String(source.instance_id),
    stepInstanceId: String(source.step_instance_id),
    activation: num(source.activation),
    voucherId,
    code: String(posted.code),
    amount: num(posted.total_amount),
    postedAt: iso(posted.posted_at),
    postedBy: actor.userId,
    postedByName: actor.displayName,
  });
}

/** Trả hồ sơ về: phiếu vẫn là nháp, chỉ xem được cho tới khi hồ sơ quay lại bước Tài chính. Bắt buộc lý do. */
export async function returnSourcedVoucher(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  voucherId: string,
  action: SourcedAction,
  reason: string | undefined,
): Promise<void> {
  const text = reason?.trim();
  if (!text) throw invalid('Nhập lý do trả hồ sơ.');
  const { source } = await lockSourced(db, tenantId, actor, voucherId, action, true);
  await db.query(
    `UPDATE finance_schema.voucher_sources SET status='RETURNED', handling_by=NULL, handling_by_name=NULL, handling_since=NULL, updated_at=now()
      WHERE tenant_id=$1 AND voucher_id=$2`,
    [tenantId, voucherId],
  );
  await addEvent(db, tenantId, voucherId, 'RETURNED', actor, text.slice(0, 2000));
  await emit(db, tenantId, FINANCE_VOUCHER_RETURNED, voucherId, {
    instanceId: String(source.instance_id),
    stepInstanceId: String(source.step_instance_id),
    activation: num(source.activation),
    voucherId,
    reason: text.slice(0, 2000),
    actorId: actor.userId,
    actorName: actor.displayName,
  });
}

/** Ứng viên cho bộ lọc "Chờ tôi ghi sổ": phiếu nháp có nguồn đang chờ của một loại phiếu, mới nhất trước. */
export async function openSourceCandidates(db: Db, tenantId: string, kind: FinanceVoucherKind, limit: number): Promise<Row[]> {
  return (
    await db.query(
      `SELECT s.voucher_id, s.instance_id, s.step_instance_id, s.activation, s.assignee_ids, s.assignee_subjects
         FROM finance_schema.voucher_sources s JOIN finance_schema.vouchers v ON v.id = s.voucher_id
        WHERE s.tenant_id=$1 AND v.kind=$2 AND s.status='OPEN' AND v.status='DRAFT'
        ORDER BY s.updated_at DESC LIMIT $3`,
      [tenantId, kind, limit],
    )
  ).rows as Row[];
}

/* ------------------------- Hồ sơ huỷ, từ chối, huỷ hiệu lực ------------------------- */

export type SourceInstanceOutcome = 'applied' | 'conflict' | 'ignored';

/** Tài khoản Procedure dùng khi không có người cụ thể; thay bằng tài khoản hệ thống của Tài chính. */
const PROCEDURE_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const SOURCE_DECIDER_NAME = 'Quy trình';

function deciderOf(actorId: string | null | undefined, actorName: string | null | undefined): Decider {
  const userId = typeof actorId === 'string' && UUID.test(actorId) && actorId !== PROCEDURE_SYSTEM_ACTOR_ID ? actorId : FINANCE_SYSTEM_ACTOR_ID;
  return { userId, displayName: (userId !== FINANCE_SYSTEM_ACTOR_ID && actorName?.trim()) || SOURCE_DECIDER_NAME };
}

/** Nguồn phiếu của một hồ sơ (một hồ sơ = một phiếu). */
export async function sourceOfInstance(db: Db, tenantId: string, instanceId: string, lock = false): Promise<Row | undefined> {
  return (
    await db.query(`SELECT * FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND instance_id=$2${lock ? ' FOR UPDATE' : ''}`, [
      tenantId,
      instanceId.toLowerCase(),
    ])
  ).rows[0] as Row | undefined;
}

async function closeSource(db: Db, tenantId: string, voucherId: string): Promise<void> {
  await db.query(
    `UPDATE finance_schema.voucher_sources SET status='CLOSED', reversal_error=NULL, handling_by=NULL, handling_by_name=NULL, handling_since=NULL,
            updated_at=now()
      WHERE tenant_id=$1 AND voucher_id=$2`,
    [tenantId, voucherId],
  );
}

/**
 * Thử ghi bút toán đảo cho phiếu đã ghi sổ của một nguồn. Lỗi nghiệp vụ (khoá sổ, số dư) không ném ra: hoàn tác phần đã làm
 * trong savepoint, chuyển nguồn REVERSAL_PENDING kèm lỗi để thử lại sau. Lỗi hạ tầng vẫn ném để người gọi thử lại.
 */
async function attemptSourceReversal(db: Db, tenantId: string, source: Row, voucher: Row, decider: Decider, reason: string): Promise<SourceInstanceOutcome> {
  const voucherId = String(voucher.id);
  await db.query('SAVEPOINT finance_source_reversal');
  try {
    await postReversal(db, tenantId, voucher, decider, reason);
    await db.query('RELEASE SAVEPOINT finance_source_reversal');
  } catch (error) {
    if (!(error instanceof FinanceError)) throw error;
    await db.query('ROLLBACK TO SAVEPOINT finance_source_reversal');
    const firstTime = source.status !== 'REVERSAL_PENDING';
    await db.query(
      `UPDATE finance_schema.voucher_sources SET status='REVERSAL_PENDING', reversal_reason=$3, reversal_by=$4, reversal_by_name=$5,
              reversal_error=$6, reversal_attempts=reversal_attempts+1, handling_by=NULL, handling_by_name=NULL, handling_since=NULL, updated_at=now()
        WHERE tenant_id=$1 AND voucher_id=$2`,
      [tenantId, voucherId, reason, decider.userId, decider.displayName, error.message],
    );
    if (firstTime) await addEvent(db, tenantId, voucherId, 'UPDATED', null, `Chưa đảo được phiếu theo hồ sơ ${String(source.instance_code)}: ${error.message}`);
    return 'conflict';
  }
  await closeSource(db, tenantId, voucherId);
  return 'applied';
}

/**
 * Hồ sơ bị huỷ hiệu lực: phiếu nháp chuyển ĐÃ HUỶ (không bút toán); phiếu đã ghi sổ được đảo vào hôm nay. Không đảo được
 * thì nguồn chuyển REVERSAL_PENDING (xung đột cần xử lý), sự kiện vẫn coi là đã nhận.
 */
export async function applySourceInstanceReversed(
  db: Db,
  tenantId: string,
  instanceId: string,
  input: { reason: string | null; actorId: string | null; actorName: string | null },
): Promise<SourceInstanceOutcome> {
  const source = await sourceOfInstance(db, tenantId, instanceId, true);
  if (!source) return 'ignored';
  const voucher = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, String(source.voucher_id)]))
    .rows[0] as Row | undefined;
  if (!voucher) return 'ignored';
  const reason = `Hồ sơ ${String(source.instance_code)} bị huỷ hiệu lực${input.reason?.trim() ? `: ${input.reason.trim()}` : ''}`.slice(0, 2000);
  const decider = deciderOf(input.actorId, input.actorName);
  if (voucher.status === 'DRAFT') {
    await closeWithoutPosting(db, tenantId, String(voucher.id), 'CANCELLED', decider, reason);
    await closeSource(db, tenantId, String(voucher.id));
    return 'applied';
  }
  if (voucher.status === 'APPROVED') return attemptSourceReversal(db, tenantId, source, voucher, decider, reason);
  return 'ignored';
}

/** Hồ sơ kết thúc mà không qua bước Tài chính thành công (bị huỷ hoặc từ chối): phiếu nháp chuyển ĐÃ HUỶ, nguồn đóng. */
export async function applySourceInstanceClosed(
  db: Db,
  tenantId: string,
  instanceId: string,
  result: 'rejected' | 'cancelled',
  input: { actorId: string | null; actorName: string | null },
): Promise<SourceInstanceOutcome> {
  const source = await sourceOfInstance(db, tenantId, instanceId, true);
  if (!source) return 'ignored';
  const voucher = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, String(source.voucher_id)]))
    .rows[0] as Row | undefined;
  if (!voucher || voucher.status !== 'DRAFT') return 'ignored';
  const note = `Hồ sơ ${String(source.instance_code)} ${result === 'rejected' ? 'bị từ chối' : 'đã huỷ'}`;
  await closeWithoutPosting(db, tenantId, String(voucher.id), 'CANCELLED', deciderOf(input.actorId, input.actorName), note);
  await closeSource(db, tenantId, String(voucher.id));
  return 'applied';
}

/** Thử đảo lại phiếu đang chờ đảo (thủ công: người có quyền ghi sổ bấm "Đảo lại"). Không có tiến trình nền tự thử lại. */
export async function retrySourceReversal(db: Db, tenantId: string, voucherId: string, by?: Decider): Promise<SourceInstanceOutcome> {
  const source = await loadSourceRow(db, tenantId, voucherId, true);
  if (!source || source.status !== 'REVERSAL_PENDING') throw conflict('FINANCE_SOURCE_STATE', 'Phiếu không chờ đảo theo hồ sơ.');
  const voucher = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, voucherId])).rows[0] as
    | Row
    | undefined;
  if (!voucher || voucher.status !== 'APPROVED') {
    await closeSource(db, tenantId, voucherId);
    return 'ignored';
  }
  const decider = by ?? deciderOf(optStr(source.reversal_by), optStr(source.reversal_by_name));
  return attemptSourceReversal(db, tenantId, source, voucher, decider, optStr(source.reversal_reason) ?? `Hồ sơ ${String(source.instance_code)} bị huỷ hiệu lực`);
}

/**
 * Procedure hỏi trước khi huỷ hiệu lực hồ sơ có bước Tài chính (chỉ đọc). Không có phiếu, hoặc phiếu chưa ghi sổ: cho phép.
 * Phiếu đã ghi sổ: chỉ cho phép khi đảo được ngay hôm nay (kỳ chưa khoá, đủ số dư), để hồ sơ không bị huỷ hiệu lực trong khi
 * tiền vẫn nằm trên sổ.
 */
export async function sourceReversalCheck(db: Db, tenantId: string, instanceId: string): Promise<FinanceInstanceReversalCheck> {
  if (!UUID.test(instanceId)) return { allowed: true };
  if (!(await financeVoucherSourcesReady(db))) return { allowed: true };
  const source = await sourceOfInstance(db, tenantId, instanceId);
  if (!source) return { allowed: true };
  const voucher = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [tenantId, String(source.voucher_id)])).rows[0] as
    | Row
    | undefined;
  if (!voucher || voucher.status !== 'APPROVED') return { allowed: true };
  const blocker = await reversalBlocker(db, tenantId, voucher);
  return blocker ? { allowed: false, reason: `${blocker} Mở khoá sổ hoặc bổ sung số dư rồi huỷ hiệu lực lại.` } : { allowed: true };
}
