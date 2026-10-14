'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '../ui/date-picker-input';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { HrmApiError, hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import {
  approvalKindFromType,
  approvalListPath,
  approvalSourcesFor,
  isPendingStatus,
  splitEmployeeLabel,
} from '../hrm-approval-kinds';
import { formatRequestDuration, formatRequestPeriod } from '../request-time-format';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useProcedureProgress } from '../ui/procedure-progress-panel';
import { ApprovalDetailPanel } from '../ui/approvals/approval-detail-panel';
import {
  approvalCounts,
  filterApprovals,
  initialsOf,
  isOverdue,
  isUnpaidOt,
  kindChip,
  pageOf,
  reasonColumns,
  rowKindLabel,
  states,
  statusTone,
  type ActionAbility,
  type ApprovalFilter,
  type ApprovalTab,
  type Link,
  type Raw,
  type Row,
} from '../ui/approvals/approvals-model';
import {
  approvalErrorMessage,
  procedureActionBody,
  procedureFieldsOf,
  workflowFilterQuery,
  isTerminalProcedureStatus,
  type ProcedureActionKind,
} from '../procedure-progress-view';

const PAGE_SIZE = 20;
const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

const DECISION_OF: Partial<Record<ProcedureActionKind, string>> = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  RETURN: 'RETURN',
};

export default function ApprovalsScreen() {
  // useSearchParams cần ranh giới Suspense để trang vẫn prerender được.
  return (
    <Suspense fallback={null}>
      <ApprovalsContent />
    </Suspense>
  );
}

function Kpi({ tone, icon, label, value, testId }: { tone: 'orange' | 'blue' | 'red' | 'green'; icon: React.ReactNode; label: string; value: number; testId: string }) {
  const tile = { orange: 'bg-orange-50 text-orange-500', blue: 'bg-blue-50 text-[#2563eb]', red: 'bg-rose-50 text-rose-500', green: 'bg-emerald-50 text-emerald-600' }[tone];
  const text = { orange: 'text-orange-500', blue: 'text-[#2563eb]', red: 'text-rose-600', green: 'text-emerald-600' }[tone];
  return (
    <div className={`${CARD} flex items-center gap-3 px-4 py-3.5`} data-testid={testId}>
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tile}`}>{icon}</span>
      <div>
        <p className="text-[12.5px] text-slate-500">{label}</p>
        <p className={`text-[26px] font-extrabold leading-tight ${text}`}>{value}</p>
      </div>
    </div>
  );
}

function FilterBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[140px] flex-1">
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function ApprovalsContent() {
  const searchParams = useSearchParams();
  const kindFromQuery = approvalKindFromType(searchParams?.get('type'));
  const permissions = useHrmPermissions(),
    permissionKey = permissions.actions.join('|');
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [panelError, setPanelError] = useState(''),
    [filter, setFilter] = useState<ApprovalFilter>({ tab: 'ALL', kind: kindFromQuery, department: '', status: '', search: '', from: '', to: '' }),
    [currentStep, setCurrentStep] = useState(''),
    [page, setPage] = useState(1),
    [detailKey, setDetailKey] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [threadRefresh, setThreadRefresh] = useState(0),
    [action, setAction] = useState<HrmAction | null>(null);
  const patch = (next: Partial<ApprovalFilter>) => {
    setFilter((f) => ({ ...f, ...next }));
    setPage(1);
  };
  const [linkedId, setLinkedId] = useState('');
  // Cảnh báo khi người duyệt không có cấp dưới do thiếu "Báo cáo cho"/trưởng đơn vị.
  const [scopeWarning, setScopeWarning] = useState('');
  useEffect(() => {
    let active = true;
    hrmFetch<{ data: { noReportingLine: boolean; message: string | null } }>('/approval-scope')
      .then((res) => {
        if (active) setScopeWarning(res.data.noReportingLine ? (res.data.message ?? '') : '');
      })
      .catch(() => {
        if (active) setScopeWarning('');
      });
    return () => {
      active = false;
    };
  }, []);
  // Bước đã gặp: giữ lại để danh sách chọn không co lại sau khi lọc.
  const [stepOptions, setStepOptions] = useState<string[]>([]);
  // ?type=<loại đơn> từ liên kết ở Bàn làm việc: chọn sẵn bộ lọc loại đơn.
  useEffect(() => {
    if (kindFromQuery) patch({ kind: kindFromQuery });
  }, [kindFromQuery]);
  const availableSources = useMemo(
    () => approvalSourcesFor(permissionKey ? permissionKey.split('|') : []),
    [permissionKey],
  );
  const [linkedRequestId, setLinkedRequestId] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('request');
    if (id) setLinkedRequestId(id);
  }, []);
  useEffect(() => {
    if (!linkedRequestId) return;
    const row = rows.find((item) => item.id === linkedRequestId);
    if (row) {
      setDetailKey(row.key);
      setLinkedRequestId('');
    }
  }, [rows, linkedRequestId]);
  useEffect(
    () => setLinkedId(new URLSearchParams(window.location.search).get('workflow') || ''),
    [],
  );
  useEffect(() => {
    if (!linkedId) return;
    const row = rows.find((r) => r.link?.id === linkedId);
    if (row) {
      setDetailKey(row.key);
      setLinkedId('');
    }
  }, [rows, linkedId]);

  /**
   * Tải trước các đơn đang chờ (nhanh, đủ để hiện việc cần xử lý), rồi tải nốt lịch sử ở nền cho tab Đã xử lý.
   * Danh sách nhân viên và liên kết quy trình chỉ lấy một lần cho cả hai lượt.
   */
  const load = useCallback(async () => {
    const available = availableSources;
    const progressQuery = workflowFilterQuery({ currentStep });
    const [employees, links, reversals] = await Promise.all([
      hrmEmployeeOptions(true).catch(() => []),
      hrmFetch<{ data: Link[] }>('/request-workflows').catch(() => ({ data: [] as Link[] })),
      // Không đọc được thì vẫn hiện danh sách, chỉ thiếu nhãn "Đã hủy hiệu lực".
      Promise.resolve(hrmFetch<{ data: { requestId: string; reason: string }[] }>('/request-reversals')).then(
        (res) => res?.data ?? [],
        () => [] as { requestId: string; reason: string }[],
      ),
    ]);
    const reversedReasons = new Map(reversals.map((r) => [r.requestId, r.reason]));
    const people = new Map(employees.map((e) => [e.value, { ...splitEmployeeLabel(e.label), department: e.department ?? '' }]));
    const linkOf = new Map(links.data.map((l) => [`${l.request_kind}:${l.request_id}`, l]));
    const text = (value: unknown) => (typeof value === 'string' && value ? value : '');
    const fetchLists = (pendingOnly: boolean) =>
      Promise.all(
        available.map((s) =>
          hrmFetch<{ data: Raw[] }>(
            // Đổi ca có thêm trạng thái PEER_CONFIRMED nên không lọc phía máy chủ.
            approvalListPath(s, [progressQuery, pendingOnly && s.kind !== 'SHIFT_CHANGE' ? 'status=PENDING' : '']),
          ).then(
            (res) => ({ ok: true as const, data: res.data }),
            (reason: unknown) => ({ ok: false as const, reason }),
          ),
        ),
      );
    const build = (settled: Awaited<ReturnType<typeof fetchLists>>): Row[] => {
      const lists = settled.map((item) => (item.ok ? item.data : []));
      const seenSteps = lists.flatMap((list) => list.map((r) => procedureFieldsOf(r).currentStepName).filter((name): name is string => Boolean(name)));
      if (seenSteps.length)
        setStepOptions((prev) => [...new Set([...prev, ...seenSteps])].sort((a, b) => a.localeCompare(b, 'vi')));
      return lists
        .flatMap((list, i) =>
          list.map((r): Row => {
            const employeeId = r.employeeId || r.employee_id || '';
            const person = people.get(employeeId);
            return {
              ...r,
              // Đơn đã duyệt rồi bị huỷ hiệu lực: tách khỏi "Đã rút / hủy".
              status: r.status === 'CANCELLED' && reversedReasons.has(r.id) ? 'REVERSED' : r.status,
              reversalReason: reversedReasons.get(r.id),
              key: `${available[i].kind}:${r.id}`,
              source: available[i],
              employeeName: text(r.employee_name) || text(r.employeeName) || person?.name || employeeId || '—',
              employeeCode: text(r.employee_code) || text(r.employeeCode) || person?.code || '',
              department: person?.department ?? '',
              created: r.createdAt || r.created_at || '',
              period: formatRequestPeriod(r),
              ...reasonColumns(available[i].kind, r),
              link: linkOf.get(`${available[i].kind}:${r.id}`),
            };
          }),
        )
        .sort((a, b) => b.created.localeCompare(a.created));
    };
    const failureOf = (settled: Awaited<ReturnType<typeof fetchLists>>) =>
      // Loại đơn không đọc được (403) bị bỏ qua; lỗi khác được báo sau khi hiển thị phần tải được.
      settled.find((item) => !item.ok && !(item.reason instanceof HrmApiError && item.reason.status === 403));
    const first = await fetchLists(true);
    setRows(build(first));
    setLoading(false);
    const firstFailure = failureOf(first);
    if (firstFailure && !firstFailure.ok) throw firstFailure.reason;
    const full = await fetchLists(false);
    setRows(build(full));
    const fullFailure = failureOf(full);
    if (fullFailure && !fullFailure.ok) throw fullFailure.reason;
  }, [availableSources, currentStep]);
  useEffect(() => {
    void load().catch((e) => {
      setLoading(false);
      setError(e.message);
    });
  }, [load]);

  const detail = useMemo(() => rows.find((r) => r.key === detailKey) ?? null, [rows, detailKey]);

  const hasProcedure = (r: Row) => Boolean(r.link) || Boolean(procedureFieldsOf(r).syncStatus || procedureFieldsOf(r).instanceId);
  const eligible = (r: Row) => permissions.can(r.source.permission) && isPendingStatus(r.status) && !hasProcedure(r);
  const procedureActionable = (r: Row) =>
    permissions.can(r.source.permission) &&
    isPendingStatus(r.status) &&
    (r.link?.status === 'RUNNING' || procedureFieldsOf(r).syncStatus === 'RUNNING');
  const ability: ActionAbility = { eligible, procedureActionable };
  const instanceIdOf = (r: Row) => procedureFieldsOf(r).instanceId ?? r.link?.instance_id;
  const {
    progress: detailProgress,
    loading: detailProgressLoading,
    refresh: refreshDetailProgress,
  } = useProcedureProgress({
    instanceId: detail ? instanceIdOf(detail) : undefined,
    kind: detail?.source.kind ?? '',
    requestId: detail?.id ?? '',
    open: Boolean(detail),
  });

  /** Ghi ý kiến kèm quyết định vào luồng trao đổi của đơn; không chặn quyết định nếu ghi lỗi. */
  async function recordDecision(r: Row, decision: string, note: string) {
    if (!note.trim()) return;
    try {
      await hrmFetch('/request-comments', {
        method: 'POST',
        body: JSON.stringify({ kind: r.source.kind, requestId: r.id, body: note.trim(), commentKind: 'DECISION', decision }),
      });
    } catch {
      /* quyết định đã có hiệu lực; ý kiến vẫn nằm trong bước xử lý/lý do từ chối */
    }
    setThreadRefresh((n) => n + 1);
  }

  async function procedureAction(r: Row, act: ProcedureActionKind, comment: string) {
    setBusy(true);
    setPanelError('');
    try {
      await hrmFetch(`/requests/${r.source.kind}/${r.id}/actions`, {
        method: 'POST',
        body: JSON.stringify(
          procedureActionBody(act, { comment, idempotencyKey: crypto.randomUUID(), revision: procedureFieldsOf(r).revision ?? r.link?.revision }),
        ),
      });
      const decision = DECISION_OF[act];
      if (decision) await recordDecision(r, decision, comment);
      await Promise.all([refreshDetailProgress(true), load()]);
    } catch (e) {
      setPanelError(approvalErrorMessage(e, 'procedure'));
      // 403/409: tiến độ có thể đã đổi (đã có người xử lý), làm mới để phản ánh.
      void refreshDetailProgress(true);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function transition(r: Row, target: 'approve' | 'reject', body: unknown = {}) {
    await hrmFetch(`/${r.source.path}/${r.id}/${target}`, { method: 'POST', body: JSON.stringify(body) });
  }
  async function approve(r: Row, note: string) {
    setBusy(true);
    setPanelError('');
    try {
      await transition(r, 'approve');
      await recordDecision(r, 'APPROVE', note);
      await load();
    } catch (e) {
      setPanelError(approvalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reject(r: Row, note: string) {
    setBusy(true);
    setPanelError('');
    try {
      await transition(r, 'reject', { reason: note });
      await recordDecision(r, 'REJECT', note);
      await load();
    } catch (e) {
      setPanelError(approvalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function batch() {
    setBusy(true);
    setError('');
    let done = 0;
    try {
      for (const r of rows.filter((r) => selected.includes(r.key) && eligible(r))) {
        await transition(r, 'approve');
        done++;
      }
      setSelected([]);
      await load();
    } catch (e) {
      setError(`Đã duyệt ${done} đơn; dừng tại lỗi: ${approvalErrorMessage(e)}`);
      await load();
    } finally {
      setBusy(false);
    }
  }
  function reverse(r: Row) {
    const kind = r.source.kind === 'ATTENDANCE' ? 'correction' : r.source.kind.toLowerCase();
    setAction({
      title: `Hủy hiệu lực ${r.source.label.toLowerCase()}`,
      description:
        'Giữ lịch sử phê duyệt, đảo hiệu lực nghiệp vụ và yêu cầu tính lại kỳ công. Kỳ đã khóa hoặc tạm ứng đã chi không thể hủy.',
      confirmTitle: 'Xác nhận hủy hiệu lực đơn đã duyệt?',
      fields: [{ key: 'reason', label: 'Lý do hủy hiệu lực' }],
      submit: async (v) => {
        await hrmFetch(`/requests/${kind}/${r.id}/reverse`, {
          method: 'POST',
          body: JSON.stringify({ reason: v.reason, expectedUpdatedAt: r.updatedAt || r.updated_at }),
        });
        setDetailKey('');
        await load();
      },
    });
  }

  const counts = useMemo(() => approvalCounts(rows, ability), [rows, permissionKey]);
  const visible = useMemo(() => filterApprovals(rows, filter, ability), [rows, filter, permissionKey]);
  const paged = pageOf(visible, page, PAGE_SIZE);
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [rows]);
  const selectable = paged.items.filter((r) => eligible(r));
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.includes(r.key));

  const tabs: { id: ApprovalTab; label: string; count: number }[] = [
    { id: 'ALL', label: 'Tất cả', count: counts.all },
    { id: 'MINE', label: 'Chờ tôi duyệt', count: counts.mine },
    { id: 'PROCESSING', label: 'Đang xử lý', count: counts.processing },
    { id: 'DONE', label: 'Đã xử lý', count: counts.done },
  ];
  const amountText = (r: Row) =>
    r.requestedAmount !== undefined
      ? `${Number(r.requestedAmount).toLocaleString('vi-VN')} đ`
      : r.plannedMinutes !== undefined
        ? `${r.plannedMinutes} phút`
        : typeof r.durationMinutes === 'number'
          ? formatRequestDuration({ durationMinutes: r.durationMinutes })
          : r.duration !== undefined
            ? String(r.duration)
            : '';

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">Đơn từ cần xử lý</h1>
          <p className="text-[13px] text-slate-500">Theo dõi và phê duyệt các yêu cầu đang chờ xử lý.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void load().catch((e) => setError(e.message))} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            <span>Làm mới</span>
          </Button>
          {permissions.can('hrm.leave.read') && (
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#2563eb] hover:bg-slate-50"
              href="/modules/hrm/leave?view=balances"
            >
              Quỹ phép
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số xử lý đơn">
        <Kpi tone="orange" icon={<TriangleAlert className="size-6" />} label="Chờ tôi duyệt" value={counts.mine} testId="kpi-mine" />
        <Kpi tone="blue" icon={<Clock className="size-6" />} label="Đang xử lý" value={counts.processing} testId="kpi-processing" />
        <Kpi tone="red" icon={<TriangleAlert className="size-6" />} label="Quá hạn" value={counts.overdue} testId="kpi-overdue" />
        <Kpi tone="green" icon={<CheckCircle2 className="size-6" />} label="Đã xử lý tháng này" value={counts.doneThisMonth} testId="kpi-done" />
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}
      {scopeWarning && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          {scopeWarning}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2.5" aria-label="Bộ lọc">
        <FilterBox label="Tìm kiếm">
          <div className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input
              aria-label="Tìm đơn"
              placeholder="Tên nhân viên, mã đơn, lý do..."
              value={filter.search}
              onChange={(e) => patch({ search: e.target.value })}
              className="h-full w-full bg-transparent text-[13.5px] outline-none placeholder:text-slate-400"
            />
          </div>
        </FilterBox>
        <FilterBox label="Loại đơn">
          <SearchableSelect
            value={filter.kind}
            onChange={(v) => patch({ kind: v || '' })}
            clearable
            placeholder="Tất cả"
            options={availableSources.map((s) => ({ value: s.kind, label: s.label }))}
          />
        </FilterBox>
        <FilterBox label="Phòng ban">
          <SearchableSelect
            value={filter.department}
            onChange={(v) => patch({ department: v || '' })}
            clearable
            placeholder="Tất cả"
            options={departments.map((d) => ({ value: d, label: d }))}
          />
        </FilterBox>
        <FilterBox label="Bước duyệt">
          <SearchableSelect
            value={currentStep}
            onChange={(v) => setCurrentStep(v || '')}
            clearable
            placeholder="Tất cả"
            options={stepOptions.map((name) => ({ value: name, label: name }))}
          />
        </FilterBox>
        <FilterBox label="Trạng thái">
          <SearchableSelect
            value={filter.status}
            onChange={(v) => patch({ status: v || '' })}
            clearable
            placeholder="Tất cả"
            options={Object.entries(states)
              .filter(([v]) => v !== 'PEER_CONFIRMED')
              .map(([value, label]) => ({ value, label }))}
          />
        </FilterBox>
        <FilterBox label="Từ ngày">
          <DatePickerInput aria-label="Từ ngày" height={38} value={filter.from} max={filter.to || undefined} onChange={(v: string) => patch({ from: v })} />
        </FilterBox>
        <FilterBox label="Đến ngày">
          <DatePickerInput aria-label="Đến ngày" height={38} value={filter.to} min={filter.from || undefined} onChange={(v: string) => patch({ to: v })} />
        </FilterBox>
      </div>

      <div className="grid gap-3 xl:h-[calc(100dvh-420px)] xl:min-h-[520px] xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className={`${CARD} flex min-h-[420px] min-w-0 flex-col overflow-hidden`} aria-label="Danh sách đơn">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3">
            <div className="flex gap-1 text-[13px]" aria-label="Nhóm đơn">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={filter.tab === t.id}
                  data-testid={`tab-${t.id}`}
                  onClick={() => patch({ tab: t.id })}
                  className={`-mb-px border-b-2 px-3 py-3 font-medium transition-colors ${filter.tab === t.id ? 'border-[#2563eb] text-[#2563eb]' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
            <Popconfirm title={`Duyệt ${selected.length} đơn đã chọn?`} description="Các đơn liên kết Procedure được xử lý tại quy trình tương ứng." onConfirm={batch}>
              <Button disabled={busy || !selected.length} className="h-8 gap-1.5 border-0 bg-emerald-600 text-xs text-white hover:bg-emerald-700">
                <CheckCircle2 className="size-3.5" />
                Duyệt đã chọn ({selected.length})
              </Button>
            </Popconfirm>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]" aria-label="Danh sách đơn từ">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[12.5px] font-semibold text-slate-700">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả đơn được duyệt trong trang"
                      checked={allSelected}
                      disabled={busy || selectable.length === 0}
                      onChange={(e) =>
                        setSelected((prev) => [
                          ...prev.filter((k) => !selectable.some((r) => r.key === k)),
                          ...(e.target.checked ? selectable.map((r) => r.key) : []),
                        ])
                      }
                    />
                  </th>
                  <th className="px-2 py-2.5">Nhân viên</th>
                  <th className="px-2 py-2.5">Loại đơn</th>
                  <th className="px-2 py-2.5">Thời gian</th>
                  <th className="px-2 py-2.5">Lý do</th>
                  <th className="px-2 py-2.5">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500" role="status">
                      Đang tải danh sách đơn...
                    </td>
                  </tr>
                ) : paged.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                      Không có đơn nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  paged.items.map((r) => {
                    const active = r.key === detailKey;
                    const amount = amountText(r);
                    return (
                      <tr
                        key={r.key}
                        data-testid={`approval-row-${r.id}`}
                        aria-selected={active}
                        onClick={() => {
                          setDetailKey(r.key);
                          setPanelError('');
                        }}
                        className={`cursor-pointer border-b border-slate-100 align-middle transition-colors ${active ? 'bg-amber-50/70' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Chọn đơn của ${r.employeeName}`}
                            checked={selected.includes(r.key)}
                            disabled={busy || !eligible(r)}
                            onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, r.key] : prev.filter((k) => k !== r.key)))}
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11.5px] font-bold text-slate-600">{initialsOf(r.employeeName)}</span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-900">{r.employeeName}</p>
                              <p className="truncate text-[11.5px] text-slate-500">{[r.employeeCode, r.department].filter(Boolean).join(' · ')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={`inline-flex max-w-[170px] items-center truncate rounded-lg px-2.5 py-1 text-[12px] font-semibold ${kindChip(r.source.kind)}`}>{rowKindLabel(r)}</span>
                        </td>
                        <td className="px-2 py-2.5">
                          <p className="font-medium text-slate-900">{r.period || '—'}</p>
                          {amount ? <p className="text-[11.5px] text-slate-500">{amount}</p> : null}
                        </td>
                        <td className="max-w-[200px] px-2 py-2.5">
                          <p className="truncate text-slate-800" title={r.reasonLabel}>
                            {r.reasonLabel}
                            {isUnpaidOt(r) ? <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-800">Không lương</span> : null}
                          </p>
                        </td>
                        <td className="px-2 py-2.5">
                          <span
                            className={`inline-flex rounded-lg px-2.5 py-1 text-[12px] font-semibold ${statusTone(r.status)}`}
                            title={r.reversalReason ? `Lý do: ${r.reversalReason}` : undefined}
                          >
                            {states[r.status] || r.status}
                          </span>
                          {isOverdue(r) ? <span className="ml-1.5 text-[10.5px] font-semibold text-rose-600">Quá hạn</span> : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5 text-[12.5px] text-slate-600">
            <span>
              Hiển thị {paged.from}–{paged.to} trên {visible.length} đơn
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40">
                <ChevronLeft className="size-4" />
              </button>
              <span className="flex size-8 items-center justify-center rounded-lg bg-amber-100 text-[12.5px] font-bold text-amber-900">{Math.min(page, paged.pages)}</span>
              <button type="button" aria-label="Trang sau" disabled={page >= paged.pages} onClick={() => setPage((p) => Math.min(paged.pages, p + 1))} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </section>

        <div className="min-h-[420px] xl:min-h-0">
          <ApprovalDetailPanel
            row={detail}
            progress={detailProgress}
            progressLoading={detailProgressLoading}
            onRefreshProgress={(silent) => void refreshDetailProgress(silent)}
            busy={busy}
            error={panelError}
            canDecide={detail ? eligible(detail) : false}
            canProcedure={detail ? procedureActionable(detail) && !isTerminalProcedureStatus(detailProgress?.status) : false}
            canReverse={Boolean(
              detail &&
                detail.status === 'APPROVED' &&
                ['LEAVE', 'OT', 'BUSINESS_TRIP', 'ATTENDANCE', 'ADVANCE'].includes(detail.source.kind) &&
                permissions.can(detail.source.permission),
            )}
            onApprove={(note) => (detail ? approve(detail, note) : Promise.resolve())}
            onReject={(note) => (detail ? reject(detail, note) : Promise.resolve())}
            onProcedureAction={(act, comment) => (detail ? procedureAction(detail, act, comment) : Promise.resolve())}
            onReverse={() => detail && reverse(detail)}
            onError={setPanelError}
            threadRefresh={threadRefresh}
          />
        </div>
      </div>
      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
    </div>
  );
}
