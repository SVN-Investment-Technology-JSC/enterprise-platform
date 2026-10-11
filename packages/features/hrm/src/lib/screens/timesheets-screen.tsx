'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Calculator, Download, Loader2, Lock, LockKeyhole, Unlock } from 'lucide-react';
import type {
  HrmMonthCloseState,
  HrmTimesheetBoard,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { downloadCsv } from '../hrm-csv';
import { currentMonthVn, isMonthKey } from '../hrm-timesheet-format';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { BoardMonthPicker, TimesheetBoard } from '../ui/timesheet-board';
import {
  anomalyLabel,
  buildBoardCsv,
  monthStateLabel,
  monthStateTimestamp,
} from '../ui/timesheet-board-format';
import { formatDateVn } from '../hrm-timesheet-format';

const PAGE_SIZE = 50;

type CloseKind = 'requests' | 'lock' | 'reopen';

const CLOSE_TEXT: Record<
  CloseKind,
  { title: string; confirm: string; path: string; description: string }
> = {
  requests: {
    title: 'Chốt đơn từ',
    confirm: 'Xác nhận chốt đơn từ',
    path: 'close-requests',
    description:
      'Từ lúc chốt, không tạo, sửa hay duyệt đơn nào có ngày thuộc tháng này.',
  },
  lock: {
    title: 'Chốt công',
    confirm: 'Xác nhận chốt công',
    path: 'close',
    description:
      'Tính lại và khóa bảng công của tháng để phục vụ tính lương. Sau khi chốt không thể chỉnh sửa.',
  },
  reopen: {
    title: 'Mở lại tháng công',
    confirm: 'Xác nhận mở lại',
    path: 'reopen',
    description:
      'Mở lại công và đơn từ của tháng. Không thực hiện được nếu kỳ lương đã chốt.',
  },
};

function MonthCloseDialog({
  month,
  kind,
  onClose,
  onDone,
  onJump,
}: {
  month: string;
  kind: CloseKind;
  onClose: () => void;
  onDone: () => void;
  /** Mở thẳng ô công đang vướng trên bảng công. */
  onJump?: (item: { employeeId: string; employeeCode: string; date: string }) => void;
}) {
  const text = CLOSE_TEXT[kind];
  const [state, setState] = useState<HrmMonthCloseState | null>(null);
  const [loading, setLoading] = useState(kind !== 'reopen');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (kind === 'reopen') return;
    let live = true;
    hrmFetch<{ data: HrmMonthCloseState }>(`/timesheet-months/${month}/close-state`)
      .then((result) => {
        if (live) setState(result.data);
      })
      .catch((e: unknown) => {
        if (live)
          setError(
            e instanceof Error ? e.message : 'Không tải được điều kiện chốt.',
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [kind, month]);

  const blockers =
    kind === 'requests'
      ? (state?.blockersForRequests ?? [])
      : kind === 'lock'
        ? (state?.blockersForLock ?? [])
        : [];
  const stateUnknown = kind !== 'reopen' && !state;
  const missingReason = kind === 'reopen' && !reason.trim();
  const disabled =
    busy || loading || stateUnknown || blockers.length > 0 || missingReason;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(`/timesheet-months/${month}/${text.path}`, {
        method: 'POST',
        body: JSON.stringify(kind === 'reopen' ? { reason: reason.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg gap-0">
        <DialogHeader className="border-b border-slate-200 p-5">
          <DialogTitle>
            {text.title} tháng {month}
          </DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-5 text-xs">
          {loading && (
            <div role="status" className="flex items-center gap-2 text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              <span>Đang kiểm tra điều kiện...</span>
            </div>
          )}
          {blockers.length > 0 && (
            <div
              data-testid="close-blockers"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900"
            >
              <p className="mb-1 font-semibold">Còn vướng, chưa thể thực hiện:</p>
              <ul className="list-disc space-y-1 pl-4">
                {blockers.map((b) => (
                  <li key={b.code}>
                    {b.message}
                    {b.count > 0 ? ` (${b.count})` : ''}
                    {b.items && b.items.length > 0 && (
                      <ul data-testid={`blocker-items-${b.code}`} className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pl-2">
                        {b.items.map((item) => (
                          <li key={`${item.employeeId}-${item.date}`} className="flex items-center justify-between gap-2">
                            <span>
                              {item.employeeCode} - {item.employeeName} - {formatDateVn(item.date)}:{' '}
                              {item.codes.map(anomalyLabel).join('; ') || 'Cần xử lý'}
                            </span>
                            {onJump && (
                              <button
                                type="button"
                                className="shrink-0 font-semibold text-blue-700 hover:underline"
                                aria-label={`Mở ô công ${item.employeeCode} ngày ${formatDateVn(item.date)}`}
                                onClick={() => onJump(item)}
                              >
                                Mở ô công
                              </button>
                            )}
                          </li>
                        ))}
                        {b.count > b.items.length && (
                          <li className="text-amber-800">Và {b.count - b.items.length} ngày khác...</li>
                        )}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!loading && !stateUnknown && kind !== 'reopen' && blockers.length === 0 && (
            <p className="text-emerald-700">Đủ điều kiện thực hiện.</p>
          )}
          {kind === 'reopen' && (
            <label className="block space-y-1">
              <span className="font-semibold text-slate-700">Lý do mở lại (bắt buộc)</span>
              <Input
                aria-label="Lý do mở lại"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do mở lại tháng công"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Bỏ qua
          </Button>
          <Button disabled={disabled} onClick={() => void submit()}>
            {busy ? 'Đang xử lý...' : text.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TimesheetsScreen() {
  const [month, setMonth] = useState(() => currentMonthVn());
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [board, setBoard] = useState<HrmTimesheetBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [closing, setClosing] = useState<CloseKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [notice, setNotice] = useState('');
  const [focus, setFocus] = useState<{ employeeId: string; date: string } | null>(null);
  const firstSearch = useRef(true);

  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!isMonthKey(month)) return;
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      month,
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    if (query) params.set('q', query);
    hrmFetch<{ data: HrmTimesheetBoard }>(`/timesheet-board?${params}`)
      .then((result) => {
        if (live) setBoard(result.data);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setBoard(null);
        setError(e instanceof Error ? e.message : 'Không tải được bảng công.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [month, page, query, reloadKey]);

  const changeMonth = useCallback((value: string) => {
    setMonth(value);
    setPage(1);
  }, []);

  const exportCsv = useCallback(async () => {
    if (!board) return;
    setExporting(true);
    try {
      const all = [...board.employees];
      let nextPage = 1;
      if (board.meta.total > board.employees.length) {
        all.length = 0;
        while (all.length < board.meta.total && nextPage <= 200) {
          const params = new URLSearchParams({
            month,
            page: String(nextPage),
            page_size: String(PAGE_SIZE),
          });
          if (query) params.set('q', query);
          const result = await hrmFetch<{ data: HrmTimesheetBoard }>(
            `/timesheet-board?${params}`,
          );
          if (result.data.employees.length === 0) break;
          all.push(...result.data.employees);
          nextPage += 1;
        }
      }
      downloadCsv(`bang-cong-${month}`, buildBoardCsv(board, all));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xuất được bảng công.');
    } finally {
      setExporting(false);
    }
  }, [board, month, query]);

  const calculate = useCallback(async () => {
    setCalculating(true);
    setError('');
    setNotice('');
    try {
      const result = await hrmFetch<{ data: { result: { count: number; abnormal: number } } }>(
        `/timesheet-months/${month}/calculate`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const { count, abnormal } = result.data.result;
      setNotice(
        abnormal > 0
          ? `Đã tính công ${count} dòng, còn ${abnormal} dòng bất thường cần xử lý trước khi chốt.`
          : `Đã tính công ${count} dòng, không có dòng bất thường.`,
      );
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tính được công.');
    } finally {
      setCalculating(false);
    }
  }, [month]);

  const state = board?.month.state ?? 'OPEN';
  const canViewAll = board?.canViewAll ?? false;
  const stamp = board ? monthStateTimestamp(board.month) : '';
  const totalPages = board
    ? Math.max(1, Math.ceil(board.meta.total / (board.meta.pageSize || PAGE_SIZE)))
    : 1;

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            Bảng công
          </h1>
          <BoardMonthPicker month={month} onChange={changeMonth} />
          {canViewAll && (
            <Input
              aria-label="Tìm nhân viên trong bảng công"
              className="w-64"
              placeholder="Tìm theo mã hoặc tên nhân viên"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {board && (
            <Badge
              data-testid="month-state"
              variant="outline"
              className={
                state === 'LOCKED'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : state === 'REQUESTS_CLOSED'
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
              }
            >
              {monthStateLabel(state)}
              {stamp ? ` - ${stamp}` : ''}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canViewAll && (
            <>
              <Button
                permission="hrm.timesheet.calculate"
                variant="outline"
                disabled={state !== 'OPEN'}
                onClick={() => setClosing('requests')}
              >
                <Lock className="size-3.5" />
                <span>Chốt đơn từ</span>
              </Button>
              <Button
                permission="hrm.timesheet.calculate"
                variant="outline"
                disabled={state === 'LOCKED' || calculating}
                onClick={() => void calculate()}
              >
                {calculating ? <Loader2 className="size-3.5 animate-spin" /> : <Calculator className="size-3.5" />}
                <span>Tính công</span>
              </Button>
              <Button
                permission="hrm.timesheet.calculate"
                disabled={state === 'LOCKED'}
                onClick={() => setClosing('lock')}
              >
                <LockKeyhole className="size-3.5" />
                <span>Chốt công</span>
              </Button>
              <Button
                permission="hrm.timesheet.reopen"
                variant="outline"
                disabled={state === 'OPEN'}
                onClick={() => setClosing('reopen')}
                className="text-amber-700"
              >
                <Unlock className="size-3.5" />
                <span>Mở lại</span>
              </Button>
              <Button
                permission="hrm.timesheet.export"
                variant="outline"
                disabled={!board?.employees.length || exporting}
                onClick={() => void exportCsv()}
              >
                <Download className="size-3.5" />
                <span>Xuất CSV</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Tải lại
          </Button>
        </div>
      )}

      {loading && !board ? (
        <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          <span>Đang tải bảng công...</span>
        </div>
      ) : board && board.employees.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Không có nhân viên nào trong bảng công tháng này.
        </p>
      ) : board ? (
        <TimesheetBoard
          board={board}
          focus={focus}
          onFocusHandled={() => setFocus(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      ) : null}

      {board && canViewAll && board.meta.total > PAGE_SIZE && (
        <div className="flex shrink-0 items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
          <span>
            Trang {board.meta.page}/{totalPages} - {board.meta.total} nhân viên
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Trang trước
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Trang sau
            </Button>
          </div>
        </div>
      )}

      {closing && (
        <MonthCloseDialog
          month={month}
          kind={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            setReloadKey((k) => k + 1);
          }}
          onJump={(item) => {
            setClosing(null);
            setSearch(item.employeeCode);
            setFocus({ employeeId: item.employeeId, date: item.date });
          }}
        />
      )}
    </div>
  );
}
