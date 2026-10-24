'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { isPendingStatus } from '../../hrm-approval-kinds';
import { dashboardPlan } from '../../hrm-dashboard-access';
import { HrmPermissionsProvider, useHrmPermissions } from '../../hrm-permissions';
import {
  isTerminalProcedureStatus,
  procedureFieldsOf,
  type ProcedureActionKind,
} from '../../procedure-progress-view';
import { ApprovalDetailPanel } from '../approvals/approval-detail-panel';
import {
  approvalErrorMessage,
  decideApproval,
  loadPendingApprovals,
  procedureApprovalAction,
} from '../approvals/approval-queue';
import { kindChip, rowKindLabel, type Row } from '../approvals/approvals-model';
import { Button } from '../button';
import { useProcedureProgress } from '../procedure-progress-panel';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../sheet';
import { OnBehalfName } from '../on-behalf-name';

const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]';
/** Số đơn hiển thị ngay trên thẻ; phần còn lại xem ở trang Đơn từ cần xử lý. */
const VISIBLE_ROWS = 5;
/**
 * Đơn đi qua Procedure: thao tác chỉ ghi vào Procedure, còn trạng thái đơn HRM do hộp thư bền áp dụng sau đó vài giây
 * ("No HRM status/effect is written here"). Tải lại ngay sau khi duyệt vẫn thấy đơn ở trạng thái chờ, nên người dùng phải
 * bấm lần nữa mới hết. Vì vậy đơn vừa xử lý được ẩn tạm và danh sách được tải lại vài lần cho tới khi HRM đồng bộ xong.
 */
const SYNC_HIDE_MS = 20_000;
const SYNC_RELOAD_MS = [1_500, 4_000, 8_000, 20_500] as const;

/**
 * Khu vực "Duyệt đơn nhanh" đặt ngoài Dashboard của Tenant Portal. Tự lấy quyền HRM của người dùng nên không
 * hiện gì khi tenant không dùng HRM hoặc người dùng không có quyền duyệt đơn.
 */
export function HrmQuickWork() {
  return (
    <HrmPermissionsProvider>
      <QuickWorkContent />
    </HrmPermissionsProvider>
  );
}

function QuickWorkContent() {
  const permissions = useHrmPermissions();
  const actionKey = permissions.actions.join('|');
  const plan = useMemo(() => dashboardPlan(actionKey ? actionKey.split('|') : []), [actionKey]);
  if (permissions.loading || permissions.error) return null;
  if (plan.approvals.length === 0) return null;
  return (
    <QuickApprovals sources={plan.approvals} />
  );
}

function QuickApprovals({ sources, className }: { sources: ReturnType<typeof dashboardPlan>['approvals']; className?: string }) {
  const permissions = useHrmPermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [detailKey, setDetailKey] = useState('');
  const [panelError, setPanelError] = useState('');
  const [threadRefresh, setThreadRefresh] = useState(0);
  /** Đơn qua Procedure vừa xử lý (khóa đơn -> hạn ẩn), chờ HRM đồng bộ trạng thái. */
  const [syncing, setSyncing] = useState<Record<string, number>>({});
  const syncTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = syncTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  const load = useCallback(async (keepError = false) => {
    if (!keepError) setError('');
    try {
      const result = await loadPendingApprovals(sources);
      setRows(result.rows);
      if (result.failure) setError(approvalErrorMessage(result.failure));
    } catch (e) {
      setError(approvalErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [sources]);
  useEffect(() => {
    void load();
  }, [load]);

  const hasProcedure = (r: Row) => Boolean(r.link) || Boolean(procedureFieldsOf(r).syncStatus || procedureFieldsOf(r).instanceId);
  const eligible = (r: Row) => permissions.can(r.source.permission) && isPendingStatus(r.status) && !hasProcedure(r);
  const procedureActionable = (r: Row) =>
    permissions.can(r.source.permission) &&
    isPendingStatus(r.status) &&
    (r.link?.status === 'RUNNING' || procedureFieldsOf(r).syncStatus === 'RUNNING');
  const mine = useMemo(
    () =>
      rows.filter(
        (r) => !((syncing[r.key] ?? 0) > Date.now()) && isPendingStatus(r.status) && (eligible(r) || procedureActionable(r)),
      ),
    [rows, permissions, syncing],
  );
  const detail = useMemo(() => rows.find((r) => r.key === detailKey) ?? null, [rows, detailKey]);
  const {
    progress,
    loading: progressLoading,
    refresh,
  } = useProcedureProgress({
    instanceId: detail ? (procedureFieldsOf(detail).instanceId ?? detail.link?.instance_id) : undefined,
    kind: detail?.source.kind ?? '',
    requestId: detail?.id ?? '',
    open: Boolean(detail),
  });

  /** Ẩn đơn vừa xử lý qua Procedure và tải lại vài lần tới khi HRM áp dụng xong trạng thái. */
  function holdWhileSynced(key: string) {
    setSyncing((current) => ({ ...current, [key]: Date.now() + SYNC_HIDE_MS }));
    for (const delay of SYNC_RELOAD_MS) syncTimers.current.push(setTimeout(() => void load(true), delay));
  }

  async function run(r: Row, job: () => Promise<void>, fromPanel: boolean, rethrow = false) {
    const viaProcedure = procedureActionable(r);
    setBusyKey(r.key);
    if (fromPanel) setPanelError('');
    else setError('');
    try {
      await job();
      if (viaProcedure) holdWhileSynced(r.key);
      setThreadRefresh((n) => n + 1);
      await load();
      if (fromPanel) setDetailKey('');
    } catch (e) {
      const message = approvalErrorMessage(e, procedureActionable(r) ? 'procedure' : undefined);
      if (fromPanel) setPanelError(message);
      else setError(message);
      void load(true);
      if (rethrow) throw e;
    } finally {
      setBusyKey('');
    }
  }
  const approveQuick = (r: Row) =>
    run(r, () => (procedureActionable(r) ? procedureApprovalAction(r, 'APPROVE', '') : decideApproval(r, 'approve', '')), false);
  const rejectQuick = (r: Row) =>
    run(r, () => (procedureActionable(r) ? procedureApprovalAction(r, 'REJECT', '') : decideApproval(r, 'reject', '', true)), false);
  const approveFromPanel =(r: Row, note: string) =>
    run(r, () => (procedureActionable(r) ? procedureApprovalAction(r, 'APPROVE', note) : decideApproval(r, 'approve', note)), true);
  const rejectFromPanel = (r: Row, note: string) =>
    run(r, () => (procedureActionable(r) ? procedureApprovalAction(r, 'REJECT', note) : decideApproval(r, 'reject', note)), true);
  const procedureFromPanel = (r: Row, act: ProcedureActionKind, comment: string) =>
    run(r, () => procedureApprovalAction(r, act, comment), true, true);

  const shown = mine.slice(0, VISIBLE_ROWS);
  return (
    <section aria-label="Duyệt đơn nhanh" className={`${CARD} flex flex-col gap-3 p-5 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-[16px] font-bold text-slate-900">
          Duyệt đơn nhanh
          {mine.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-800">{mine.length} chờ bạn</span>
          ) : null}
        </h2>
        <Button variant="outline" size="sm" aria-label="Làm mới danh sách đơn" onClick={() => void load()} className="h-8 gap-1.5 px-2.5 text-xs">
          <RefreshCw className="size-3.5" />
        </Button>
        <a className="text-[13px] font-semibold text-blue-700 hover:text-blue-800" href="/modules/hrm/approvals">
          Xem tất cả
        </a>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="flex items-center gap-2 py-4 text-[13px] text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Đang tải đơn chờ duyệt…
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-slate-500">Không có đơn nào chờ bạn duyệt.</p>
      ) : (
        <ul aria-label="Đơn chờ bạn duyệt" className="divide-y divide-slate-100">
          {shown.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <button type="button" onClick={() => setDetailKey(r.key)} className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`Xem chi tiết đơn của ${r.employeeName}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${kindChip(r.source.kind)}`}>{rowKindLabel(r)}</span>
                  <span className="truncate text-[14px] font-semibold text-slate-900"><OnBehalfName name={r.employeeName} onBehalf={r.createdOnBehalf === true} byName={r.onBehalfByName} reason={r.onBehalfReason} /></span>
                  {r.createdOnBehalf === true ? (
                    <span
                      className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800"
                      title={`Tạo hộ bởi ${String(r.onBehalfByName || 'một người dùng')}. Lý do: ${String(r.onBehalfReason || '—')}`}
                    >
                      Tạo hộ
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-slate-500">
                  {[r.period, r.reasonLabel].filter(Boolean).join(' · ') || '—'}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  disabled={busyKey === r.key}
                  onClick={() => void approveQuick(r).catch(() => undefined)}
                  className="h-8 gap-1 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
                >
                  {busyKey === r.key ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  Duyệt
                </Button>
                <Popconfirm
                  title="Từ chối đơn này?"
                  description={`Đơn của ${r.employeeName} sẽ chuyển sang trạng thái từ chối.`}
                  okText="Từ chối"
                  cancelText="Quay lại"
                  okType="danger"
                  disabled={busyKey === r.key}
                  onConfirm={() => rejectQuick(r).catch(() => undefined)}
                >
                  <Button size="sm" variant="outline" disabled={busyKey === r.key} className="h-8 gap-1 px-3 text-xs text-rose-700">
                    <X className="size-3.5" />
                    Từ chối
                  </Button>
                </Popconfirm>
              </div>
            </li>
          ))}
        </ul>
      )}
      {mine.length > VISIBLE_ROWS ? (
        <p className="text-[12px] text-slate-500">Còn {mine.length - VISIBLE_ROWS} đơn nữa trong trang Đơn từ cần xử lý.</p>
      ) : null}

      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetailKey('')}>
        <SheetContent className="h-full max-h-screen w-full max-w-xl overflow-hidden bg-white p-0">
          <SheetHeader className="flex shrink-0 flex-row items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/80 p-5">
            <div className="min-w-0">
              <SheetTitle>Duyệt đơn</SheetTitle>
              <SheetDescription>Xem thông tin, trao đổi và phê duyệt hoặc từ chối.</SheetDescription>
            </div>
            <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Đóng" />}>
              <X className="size-4" />
            </SheetClose>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ApprovalDetailPanel
              row={detail}
              progress={progress}
              progressLoading={progressLoading}
              onRefreshProgress={(silent) => void refresh(silent)}
              busy={Boolean(detail && busyKey === detail.key)}
              error={panelError}
              canDecide={detail ? eligible(detail) : false}
              canProcedure={detail ? procedureActionable(detail) && !isTerminalProcedureStatus(progress?.status) : false}
              canReverse={false}
              onApprove={(note) => (detail ? approveFromPanel(detail, note) : Promise.resolve())}
              onReject={(note) => (detail ? rejectFromPanel(detail, note) : Promise.resolve())}
              onProcedureAction={(act, comment) => (detail ? procedureFromPanel(detail, act, comment) : Promise.resolve())}
              onReverse={() => undefined}
              onError={setPanelError}
              threadRefresh={threadRefresh}
            />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
