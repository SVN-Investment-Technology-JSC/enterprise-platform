'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Calculator, Download, Loader2, Lock, LockKeyhole, Maximize2, Minimize2, Search, Unlock } from 'lucide-react';
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
import { TimesheetBoard } from '../ui/timesheet-board';
import { MonthStepper } from '../ui/month-stepper';
import { PageTitle } from '../ui/page-title';
import { BoardPagination } from '../ui/board-pagination';
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
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
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
      page_size: String(pageSize),
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
  }, [month, page, pageSize, query, reloadKey]);

  const changeMonth = useCallback((value: string) => {
    setMonth(value);
    setPage(1);
    setSelectedIds(new Set());
  }, []);
  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  // Toàn màn hình: phủ kín khung làm việc và (nếu trình duyệt cho phép) cả màn hình; Esc để thoát.
  const toggleFullscreen = useCallback(() => {
    setFullscreen((on) => {
      const next = !on;
      try {
        if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined);
        else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      } catch {
        // Trình duyệt không hỗ trợ: vẫn dùng chế độ phủ kín bằng giao diện.
      }
      return next;
    });
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  // Ctrl K đưa con trỏ vào ô tìm nhân viên.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && searchRef.current) {
        event.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      const chosen = selectedIds.size > 0 ? all.filter((e) => selectedIds.has(e.employeeId)) : all;
      downloadCsv(`bang-cong-${month}`, buildBoardCsv(board, chosen));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xuất được bảng công.');
    } finally {
      setExporting(false);
    }
  }, [board, month, query, selectedIds]);

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

  return (
    <div
      data-testid="timesheets-root"
      className={
        fullscreen
          ? 'fixed inset-0 z-[45] flex flex-col gap-2 overflow-hidden bg-slate-50 p-3'
          : 'flex min-h-[calc(100dvh-11rem)] flex-col gap-3'
      }
    >
      {!fullscreen && (
        <PageTitle
          withTabs
          title="Bảng công"
          description="Theo dõi và tổng hợp công, phép, tăng ca của nhân viên trong tháng."
          badge={
            board ? (
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
                <span
                  aria-hidden="true"
                  className={`mr-1.5 inline-block size-1.5 rounded-full ${
                    state === 'LOCKED' ? 'bg-emerald-500' : state === 'REQUESTS_CLOSED' ? 'bg-sky-500' : 'bg-amber-500'
                  }`}
                />
                {monthStateLabel(state)}
                {stamp ? ` - ${stamp}` : ''}
              </Badge>
            ) : null
          }
        />
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        {fullscreen && <h1 className="mr-1 text-base font-bold text-slate-900">Bảng công</h1>}
        <MonthStepper month={month} onChange={changeMonth} />
        {canViewAll && (
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              ref={searchRef}
              aria-label="Tìm nhân viên trong bảng công"
              className="h-9 w-full pl-9 pr-16"
              placeholder="Tìm theo mã hoặc tên nhân viên..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
              Ctrl K
            </kbd>
          </div>
        )}
        {canViewAll && (
          <div className="flex flex-wrap items-center gap-2">
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
              title={selectedIds.size > 0 ? `Xuất ${selectedIds.size} nhân viên đã chọn` : 'Xuất cả danh sách đang lọc'}
              onClick={() => void exportCsv()}
            >
              <Download className="size-3.5" />
              <span>Xuất CSV{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
            </Button>
          </div>
        )}
        <Button
          variant="outline"
          aria-pressed={fullscreen}
          aria-label={fullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
          title={fullscreen ? 'Thoát toàn màn hình (Esc)' : 'Xem bảng công toàn màn hình'}
          onClick={toggleFullscreen}
          className="ml-auto"
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          <span className="hidden md:inline">{fullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}</span>
        </Button>
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
          selectedIds={selectedIds}
          onSelectedChange={setSelectedIds}
          fullscreen={fullscreen}
          footer={
            canViewAll ? (
              <BoardPagination
                page={board.meta.page}
                pageSize={board.meta.pageSize || pageSize}
                total={board.meta.total}
                loading={loading}
                onPage={setPage}
                onPageSize={changePageSize}
              />
            ) : undefined
          }
        />
      ) : null}

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
