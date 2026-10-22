import { HrmApiError, hrmFetch, hrmEmployeeOptions } from '../../hrm-api';
import {
  approvalListPath,
  splitEmployeeLabel,
  type ApprovalSource,
} from '../../hrm-approval-kinds';
import { formatRequestPeriod } from '../../request-time-format';
import {
  approvalErrorMessage,
  procedureActionBody,
  procedureFieldsOf,
  type ProcedureActionKind,
} from '../../procedure-progress-view';
import { reasonColumns, type Link, type Raw, type Row } from './approvals-model';

/**
 * Hàng đợi duyệt đơn dùng cho khu vực "Duyệt đơn nhanh" ngoài Dashboard: cùng nguồn danh sách, cùng cách ghép nhân viên và
 * liên kết quy trình với màn "Đơn từ cần xử lý", nhưng chỉ lấy đơn đang chờ và không lọc theo bước. Các thao tác duyệt, từ
 * chối đi qua đúng API của màn đó (trực tiếp theo loại đơn, hoặc qua Procedure Engine khi đơn có quy trình).
 */

const text = (value: unknown) => (typeof value === 'string' && value ? value : '');

export interface PendingApprovalResult {
  rows: Row[];
  /** Lỗi đầu tiên không phải 403 (loại đơn không đọc được vì thiếu quyền thì bỏ qua). */
  failure?: unknown;
}

export async function loadPendingApprovals(sources: readonly ApprovalSource[]): Promise<PendingApprovalResult> {
  if (sources.length === 0) return { rows: [] };
  const [employees, links, reversals] = await Promise.all([
    hrmEmployeeOptions(true).catch(() => []),
    hrmFetch<{ data: Link[] }>('/request-workflows').catch(() => ({ data: [] as Link[] })),
    Promise.resolve(hrmFetch<{ data: { requestId: string; reason: string }[] }>('/request-reversals')).then(
      (res) => res?.data ?? [],
      () => [] as { requestId: string; reason: string }[],
    ),
  ]);
  const reversedReasons = new Map(reversals.map((r) => [r.requestId, r.reason]));
  const people = new Map(employees.map((e) => [e.value, { ...splitEmployeeLabel(e.label), department: e.department ?? '' }]));
  const linkOf = new Map(links.data.map((l) => [`${l.request_kind}:${l.request_id}`, l]));
  const settled = await Promise.all(
    sources.map((s) =>
      hrmFetch<{ data: Raw[] }>(
        // Đổi ca có thêm trạng thái PEER_CONFIRMED nên không lọc phía máy chủ.
        approvalListPath(s, [s.kind !== 'SHIFT_CHANGE' ? 'status=PENDING' : '']),
      ).then(
        (res) => ({ ok: true as const, data: res.data }),
        (reason: unknown) => ({ ok: false as const, reason }),
      ),
    ),
  );
  const rows = settled
    .flatMap((item, i) =>
      (item.ok ? item.data : [])
        .filter((r) => r.status !== 'CANCELLED' || reversedReasons.has(r.id))
        .map((r): Row => {
          const employeeId = r.employeeId || r.employee_id || '';
          const person = people.get(employeeId);
          return {
            ...r,
            status: r.status === 'CANCELLED' && reversedReasons.has(r.id) ? 'REVERSED' : r.status,
            reversalReason: reversedReasons.get(r.id),
            key: `${sources[i].kind}:${r.id}`,
            source: sources[i],
            employeeName: text(r.employee_name) || text(r.employeeName) || person?.name || employeeId || '—',
            employeeCode: text(r.employee_code) || text(r.employeeCode) || person?.code || '',
            department: person?.department ?? '',
            created: r.createdAt || r.created_at || '',
            period: formatRequestPeriod(r),
            ...reasonColumns(sources[i].kind, r),
            link: linkOf.get(`${sources[i].kind}:${r.id}`),
          };
        }),
    )
    .sort((a, b) => b.created.localeCompare(a.created));
  const failure = settled.find((item) => !item.ok && !(item.reason instanceof HrmApiError && item.reason.status === 403));
  return { rows, failure: failure && !failure.ok ? failure.reason : undefined };
}

/** Ghi ý kiến kèm quyết định vào luồng trao đổi của đơn; không chặn quyết định nếu ghi lỗi. */
export async function recordApprovalDecision(r: Row, decision: string, note: string): Promise<void> {
  if (!note.trim()) return;
  try {
    await hrmFetch('/request-comments', {
      method: 'POST',
      body: JSON.stringify({ kind: r.source.kind, requestId: r.id, body: note.trim(), commentKind: 'DECISION', decision }),
    });
  } catch {
    /* quyết định đã có hiệu lực; ý kiến vẫn nằm trong bước xử lý/lý do từ chối */
  }
}

/** Duyệt hoặc từ chối trực tiếp đơn không đi qua quy trình. */
export async function decideApproval(r: Row, target: 'approve' | 'reject', note: string): Promise<void> {
  await hrmFetch(`/${r.source.path}/${r.id}/${target}`, {
    method: 'POST',
    body: JSON.stringify(target === 'reject' ? { reason: note } : {}),
  });
  await recordApprovalDecision(r, target === 'approve' ? 'APPROVE' : 'REJECT', note);
}

const DECISION_OF: Partial<Record<ProcedureActionKind, string>> = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  RETURN: 'RETURN',
};

/** Thao tác của đơn đang chạy qua Procedure Engine (duyệt, từ chối, trả lại...). */
export async function procedureApprovalAction(r: Row, act: ProcedureActionKind, comment: string): Promise<void> {
  await hrmFetch(`/requests/${r.source.kind}/${r.id}/actions`, {
    method: 'POST',
    body: JSON.stringify(
      procedureActionBody(act, { comment, idempotencyKey: crypto.randomUUID(), revision: procedureFieldsOf(r).revision ?? r.link?.revision }),
    ),
  });
  const decision = DECISION_OF[act];
  if (decision) await recordApprovalDecision(r, decision, comment);
}

export { approvalErrorMessage };
