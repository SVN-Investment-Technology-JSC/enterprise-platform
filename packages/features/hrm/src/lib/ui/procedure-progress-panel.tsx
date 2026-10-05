'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { Badge } from './badge';
import { Button } from './button';
import {
  PROCEDURE_POLL_INTERVAL_MS,
  procedureSyncNotice,
  shouldPollProcedureProgress,
  waitingApproverLabel,
  type ProcedureProgressData,
  type ProcedureSubmittedAttribute,
} from '../procedure-progress-view';

export function useProcedureProgress(input: {
  instanceId?: string;
  kind: string;
  requestId: string;
  open: boolean;
  /** Gọi sau mỗi lần tải được tiến độ (previousStatus = trạng thái lần trước). */
  onLoaded?: (data: ProcedureProgressData, previousStatus?: string) => void;
}) {
  const { instanceId, kind, requestId, open } = input;
  const [progress, setProgress] = useState<ProcedureProgressData | null>(null);
  const [loading, setLoading] = useState(false);
  const statusRef = useRef<string | undefined>(undefined);
  const onLoadedRef = useRef(input.onLoaded);
  onLoadedRef.current = input.onLoaded;

  const refresh = useCallback(
    async (silent = false) => {
      if (!instanceId) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(
          `/api/hrm/v1/procedure-progress/${instanceId}?kind=${encodeURIComponent(kind)}&request_id=${encodeURIComponent(requestId)}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) return;
        const payload = await res.json();
        const data = payload.data as ProcedureProgressData;
        const previous = statusRef.current;
        statusRef.current = data.status;
        setProgress(data);
        onLoadedRef.current?.(data, previous);
      } catch (err) {
        console.error('Không thể lấy tiến độ quy trình:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [instanceId, kind, requestId],
  );

  useEffect(() => {
    statusRef.current = undefined;
    setProgress(null);
    if (open && instanceId) void refresh(false);
  }, [open, instanceId, refresh]);

  useEffect(() => {
    if (!open || !instanceId) return;
    const tick = () => {
      if (
        shouldPollProcedureProgress({
          open,
          hasInstance: true,
          status: statusRef.current,
          hidden: typeof document !== 'undefined' && document.hidden,
        })
      )
        void refresh(true);
    };
    const timer = setInterval(tick, PROCEDURE_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [open, instanceId, refresh]);

  return { progress, loading, refresh };
}

function formatDate(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      });
}

export interface ProcedureProgressPanelProps {
  progress: ProcedureProgressData | null;
  loading: boolean;
  onRefresh?: () => void;
  /** Trạng thái liên kết (START_PENDING/FAILED) khi chưa có tiến độ hoặc để báo lỗi. */
  syncStatus?: string | null;
  lastError?: string | null;
  /** Dự phòng khi API tiến độ chưa trả người/bước hiện tại. */
  fallbackStepName?: string | null;
  fallbackAssigneeName?: string | null;
  hasInstance?: boolean;
  /** Nội dung hiển thị khi đơn chưa có quy trình (không có instance). */
  emptyFallback?: React.ReactNode;
  showActivity?: boolean;
}

/** Khối tiến độ quy trình dùng chung cho chi tiết đơn nhân viên và màn Duyệt đơn. */
export function ProcedureProgressPanel({
  progress,
  loading,
  onRefresh,
  syncStatus,
  lastError,
  fallbackStepName,
  fallbackAssigneeName,
  hasInstance = true,
  emptyFallback,
  showActivity = true,
}: ProcedureProgressPanelProps) {
  const notice = procedureSyncNotice(
    progress?.syncStatus ?? syncStatus,
    progress?.lastError ?? lastError,
  );
  const running =
    progress && !['completed', 'rejected', 'cancelled'].includes(progress.status);
  const waiting = running
    ? waitingApproverLabel({
        assigneeName: progress.currentAssigneeName ?? fallbackAssigneeName,
        stepName: progress.currentStepName ?? fallbackStepName,
      })
    : null;

  return (
    <div className="space-y-2.5" data-testid="procedure-progress-panel">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-blue-900">
          Tiến độ quy trình
        </span>
        {hasInstance && onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-blue-700 hover:bg-blue-50 gap-1"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
            Làm mới tiến độ
          </Button>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-lg border p-2.5 text-xs ${
            notice.tone === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-blue-200 bg-blue-50 text-blue-900'
          }`}
        >
          <strong>{notice.title}</strong>
          {notice.detail && <p className="mt-0.5">{notice.detail}</p>}
        </div>
      )}

      {waiting && (
        <div className="rounded-lg border border-blue-200 bg-white p-2.5 text-xs font-semibold text-blue-900">
          {waiting}
        </div>
      )}

      {loading && !progress ? (
        <div className="bg-slate-50 rounded-lg p-6 border border-slate-200 flex items-center justify-center gap-2 text-slate-500 text-xs">
          <Loader2 className="size-4 animate-spin text-[#021E73]" />
          Đang đồng bộ tiến độ từ Procedure Engine...
        </div>
      ) : progress && progress.steps.length > 0 ? (
        <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 text-[11px]">
            <div className="text-slate-600">
              Mã phiếu PE:{' '}
              <strong className="font-mono text-blue-900">
                {progress.instanceCode || progress.instanceId.slice(0, 8)}
              </strong>
            </div>
            <Badge
              className={
                progress.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-800'
                  : progress.status === 'rejected'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
              }
            >
              {progress.status === 'completed'
                ? 'Đã hoàn thành'
                : progress.status === 'rejected'
                  ? 'Đã từ chối'
                  : progress.status === 'cancelled'
                    ? 'Đã hủy'
                    : 'Đang xử lý'}
            </Badge>
          </div>

          <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {progress.steps.map((st, idx) => {
              const isCompleted = st.status === 'completed';
              const isRejected = st.status === 'rejected';
              const isActive = st.status === 'active' || st.status === 'ready';
              return (
                <div
                  key={st.id || idx}
                  className="flex items-start gap-3 relative pl-1"
                >
                  <div
                    className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 z-10 ${
                      isCompleted
                        ? 'bg-emerald-100 text-emerald-700 ring-2 ring-white'
                        : isRejected
                          ? 'bg-rose-100 text-rose-700 ring-2 ring-white'
                          : isActive
                            ? 'bg-blue-600 text-white ring-2 ring-white shadow-xs'
                            : 'bg-slate-200 text-slate-500 ring-2 ring-white'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="size-3.5" />
                    ) : isRejected ? (
                      <X className="size-3.5" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <div className="flex-1 space-y-0.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-semibold text-xs ${isActive ? 'text-blue-900 font-bold' : 'text-slate-800'}`}
                      >
                        {st.name}
                      </span>
                      {st.roleTitle && (
                        <span
                          className="text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded font-medium"
                          title="Người xử lý"
                        >
                          {st.roleTitle}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                      <span>
                        {isCompleted
                          ? `Đã xong${st.completedAt ? ` (${formatDate(st.completedAt)})` : ''}`
                          : isRejected
                            ? 'Đã từ chối tại bước này'
                            : isActive
                              ? 'Đang tiến hành xét duyệt'
                              : 'Chờ đến lượt'}
                      </span>
                      {Boolean(st.slaHours) && !isCompleted && !isRejected && (
                        <span className="text-amber-700 font-medium">
                          SLA: {st.slaHours}h
                          {st.slaDueAt && formatDate(st.slaDueAt)
                            ? ` (hạn ${formatDate(st.slaDueAt)})`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {showActivity && progress.activity.length > 0 && (
            <div className="pt-2 border-t border-slate-200/80 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Nhật ký phê duyệt & Ý kiến
              </span>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {progress.activity.map((act) => (
                  <div
                    key={act.id}
                    className="p-2 rounded bg-white border border-slate-200/70 text-[11px] space-y-0.5"
                  >
                    <div className="flex items-center justify-between text-slate-600">
                      <strong>{act.actorName}</strong>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {formatDate(act.createdAt)}
                      </span>
                    </div>
                    <p className="text-slate-700">{act.summary}</p>
                    {act.comment && (
                      <p className="text-blue-900 bg-blue-50/60 p-1 rounded font-medium mt-1">
                        &quot;{act.comment}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        emptyFallback ?? null
      )}

      {progress?.submittedAttributes && progress.submittedAttributes.length > 0 && (
        <SubmittedAttributesBlock items={progress.submittedAttributes} />
      )}
    </div>
  );
}

/** Thông tin bổ sung đã nhập khi nộp đơn; tệp tải qua cơ chế đính kèm HRM (kiểm quyền ở máy chủ). */
export function SubmittedAttributesBlock({
  items,
}: {
  items: ProcedureSubmittedAttribute[];
}) {
  const [error, setError] = useState<string | null>(null);
  const download = async (id: string) => {
    setError(null);
    try {
      const file = await hrmFetch<{ data: { url: string } }>(
        `/attachments/${id}/download`,
      );
      window.open(file.data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được tệp');
    }
  };
  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
      data-testid="submitted-attributes"
    >
      <span className="text-[11px] font-bold uppercase tracking-wide text-blue-900 block">
        Thông tin bổ sung đã nhập
      </span>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {items.map((item) => (
          <div key={item.key} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase text-slate-500">
              {item.name}
              {item.stepName ? ` (${item.stepName})` : ''}
            </dt>
            <dd className="text-slate-800 break-words">
              {item.type === 'file' && item.files ? (
                <ul className="space-y-1">
                  {item.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2">
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline shrink-0"
                        onClick={() => void download(f.id)}
                      >
                        <Download className="size-3" />
                        Tải tệp
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                item.display
              )}
            </dd>
          </div>
        ))}
      </dl>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
