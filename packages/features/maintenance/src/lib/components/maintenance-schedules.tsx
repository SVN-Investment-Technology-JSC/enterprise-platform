'use client';

import type {
  MaintenanceFrequency,
  MaintenancePriority,
  MaintenanceSchedule,
} from '@enterprise-platform/contracts-maintenance';
import {
  formatDateTime as formatSharedDateTime,
  SearchableSelect,
} from '@enterprise-platform/shared-ui';
import { ListFilter, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { TablePagerBar } from '../ui/table-pager-bar';
import { Tip } from '../ui/tooltip';
import { SELECT_CLASS } from '../ui/select-class';
import { useFillViewportHeight } from '../ui/use-fill-viewport';
import { cn } from '../utils';

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

const PRIORITY_CLASS: Record<MaintenancePriority, string> = {
  High: 'border-red-200 bg-red-50 text-red-700',
  Normal: 'border-blue-200 bg-blue-50 text-blue-700',
  Low: 'border-slate-200 bg-slate-100 text-slate-600',
};

const STATUS_CLASS: Record<string, string> = {
  active: 'text-green-800',
  paused: 'text-amber-600',
  draft: 'text-slate-500',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang kích hoạt' },
  { value: 'paused', label: 'Ngưng tạo lịch' },
  { value: 'draft', label: 'Bản nháp' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'Tất cả mức ưu tiên' },
  { value: 'High', label: 'Cao' },
  { value: 'Normal', label: 'Thường' },
  { value: 'Low', label: 'Thấp' },
];

const PAGE_SIZES = [15, 30, 45, 60];

const TH =
  'sticky top-0 z-10 whitespace-nowrap border-b border-slate-300 bg-[#e9eef5] px-3 py-2.5 text-left text-xs font-bold text-slate-700';
const TD = 'border-b border-slate-100 px-3 py-2.5 align-middle';

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return formatSharedDateTime(value, '—');
}

export interface MaintenanceSchedulesTableProps {
  readonly schedules: readonly MaintenanceSchedule[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly frequencyLabel: (freq: MaintenanceFrequency) => string;
  /** Đổi trạng thái cả lô lịch trong MỘT lần gọi (màn hình cha nạp lại đúng một lần). */
  readonly onToggle: (ids: readonly string[], nextStatus: 'active' | 'paused') => void | Promise<void>;
  readonly onSkipOnce: (ids: readonly string[]) => void | Promise<void>;
  readonly onCreateSchedule: () => void;
  readonly onCreateIncident?: () => void;
}

export function MaintenanceSchedulesTable({
  schedules,
  canManage,
  busy,
  frequencyLabel,
  onToggle,
  onSkipOnce,
  onCreateSchedule,
}: MaintenanceSchedulesTableProps) {
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Chọn lịch trong bảng để thao tác hàng loạt; mỗi thao tác hỏi lại bằng hộp thoại xác nhận.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<'pause' | 'resume' | 'skip'>();
  const [running, setRunning] = useState(false);

  // Lọc dữ liệu
  const filtered = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return schedules.filter((s) => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (filterPriority !== 'all' && s.priority !== filterPriority) return false;
      if (!query) return true;
      return (
        s.code.toLowerCase().includes(query) ||
        s.assetCode.toLowerCase().includes(query) ||
        (s.title ?? '').toLowerCase().includes(query) ||
        (s.procedureDefinitionCode ?? '').toLowerCase().includes(query) ||
        (s.procedureDefinitionName ?? '').toLowerCase().includes(query)
      );
    });
  }, [schedules, filterText, filterStatus, filterPriority]);

  const totalRecords = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safeCurrentPage, pageSize]);

  const activeFilterCount = (filterStatus !== 'all' ? 1 : 0) + (filterPriority !== 'all' ? 1 : 0);
  const hasFilter = Boolean(filterText) || activeFilterCount > 0;
  const resetFilters = () => {
    setFilterText('');
    setFilterStatus('all');
    setFilterPriority('all');
    setCurrentPage(1);
  };

  const selected = useMemo(() => schedules.filter((s) => selectedIds.has(s.id)), [schedules, selectedIds]);
  const selectedActive = useMemo(() => selected.filter((s) => s.status === 'active'), [selected]);
  const selectedInactive = useMemo(() => selected.filter((s) => s.status !== 'active'), [selected]);
  /** Nút thứ nhất đổi theo phần đang chọn: có lịch đang chạy thì ngưng, chỉ toàn lịch đang dừng thì kích hoạt lại. */
  const toggleMode: 'pause' | 'resume' = selectedActive.length > 0 ? 'pause' : 'resume';
  const toggleTargets = toggleMode === 'pause' ? selectedActive : selectedInactive;
  const dialogTargets =
    confirming === 'skip' ? selectedActive : confirming === 'resume' ? selectedInactive : selectedActive;
  const allPageSelected = paginated.length > 0 && paginated.every((s) => selectedIds.has(s.id));
  const somePageSelected = !allPageSelected && paginated.some((s) => selectedIds.has(s.id));
  const toggleId = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const runBulk = async () => {
    const action = confirming;
    if (!action) return;
    setRunning(true);
    try {
      // Một lần gọi cho cả lô: màn hình cha chạy song song có giới hạn rồi nạp lại đúng một lần.
      const ids = dialogTargets.map((schedule) => schedule.id);
      if (action === 'skip') await onSkipOnce(ids);
      else await onToggle(ids, action === 'pause' ? 'paused' : 'active');
      setSelectedIds(new Set());
    } finally {
      setRunning(false);
      setConfirming(undefined);
    }
  };

  // Khung bảng chiếm đúng phần cao còn lại của màn hình; quá dài thì chỉ cuộn trong bảng.
  const cardRef = useRef<HTMLDivElement>(null);
  useFillViewportHeight(cardRef, 320, undefined, 16);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 mb-1 text-xl font-bold tracking-tight text-foreground">
            Lịch bảo trì
          </h2>
          <p className="m-0 text-sm leading-snug text-muted-foreground">
            Danh sách lịch bảo trì định kỳ, tần suất và thời điểm đến hạn kế tiếp của từng thiết bị.
          </p>
        </div>
        {canManage ? (
          <Button size="lg" className="rounded-md px-3" onClick={onCreateSchedule} disabled={busy}>
            <Plus />
            Tạo lịch bảo trì
          </Button>
        ) : null}
      </header>

      <div
        ref={cardRef}
        className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
          <div className="relative min-w-[180px] max-w-[320px] flex-1 basis-60">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              type="search"
              className="h-9 rounded-md pl-8 text-sm"
              placeholder="Tìm theo mã lịch, mã thiết bị, quy trình…"
              value={filterText}
              aria-label="Tìm lịch bảo trì"
              onChange={(event) => {
                setFilterText(event.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" size="lg" className="gap-1.5 rounded-md px-3" aria-label="Bộ lọc" />
              }
            >
              <ListFilter />
              Bộ lọc
              {activeFilterCount > 0 ? (
                <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-slate-700">Trạng thái</span>
                  <SearchableSelect
                    className={SELECT_CLASS}
                    height={36}
                    searchInDropdown
                    hideDropdownSearch
                    clearable={false}
                    value={filterStatus}
                    options={STATUS_OPTIONS}
                    onChange={(v) => {
                      setFilterStatus(v || 'all');
                      setCurrentPage(1);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-slate-700">Mức ưu tiên</span>
                  <SearchableSelect
                    className={SELECT_CLASS}
                    height={36}
                    searchInDropdown
                    hideDropdownSearch
                    clearable={false}
                    value={filterPriority}
                    options={PRIORITY_OPTIONS}
                    onChange={(v) => {
                      setFilterPriority(v || 'all');
                      setCurrentPage(1);
                    }}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {hasFilter ? (
            <Tip content="Đặt lại toàn bộ bộ lọc">
              <Button
                variant="outline"
                size="lg"
                className="rounded-md px-3"
                onClick={resetFilters}
              >
                Xoá bộ lọc
              </Button>
            </Tip>
          ) : null}

          {/* Thao tác hàng loạt: cùng hàng với bộ lọc nhưng dạt sang phải; chỉ dùng được khi đã tick lịch */}
          {canManage ? (
            <div className="ml-auto flex items-center gap-2">
              <Tip
                content={
                  selected.length === 0
                    ? 'Tick chọn lịch trong bảng trước.'
                    : toggleMode === 'pause'
                      ? 'Ngưng sinh phiếu mới từ các lịch đang chạy đã chọn'
                      : 'Cho các lịch đang dừng đã chọn chạy lại'
                }
              >
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="rounded-md px-3 text-blue-600"
                    disabled={busy || toggleTargets.length === 0}
                    onClick={() => setConfirming(toggleMode)}
                  >
                    {toggleMode === 'pause' ? 'Ngưng tạo lịch' : 'Kích hoạt lại'}
                    {toggleTargets.length > 0 ? ` (${toggleTargets.length})` : ''}
                  </Button>
                </span>
              </Tip>
              <Tip
                content={
                  selectedActive.length === 0
                    ? 'Tick chọn lịch đang chạy trong bảng trước.'
                    : 'Đẩy hạn các lịch đã chọn sang chu kỳ kế, không sinh phiếu lần này'
                }
              >
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="rounded-md px-3 text-slate-700 hover:text-amber-600"
                    disabled={busy || selectedActive.length === 0}
                    onClick={() => setConfirming('skip')}
                  >
                    Bỏ qua{selectedActive.length > 0 ? ` (${selectedActive.length})` : ''}
                  </Button>
                </span>
              </Tip>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 w-full flex-1 overflow-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
            <colgroup>
              {canManage ? <col style={{ width: '44px' }} /> : null}
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                {canManage ? (
                  <th className={cn(TH, 'text-center')}>
                    <Checkbox
                      aria-label="Chọn tất cả lịch trong trang"
                      checked={allPageSelected}
                      indeterminate={somePageSelected}
                      disabled={busy || paginated.length === 0}
                      onCheckedChange={(checked) =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          for (const s of paginated) {
                            if (checked) next.add(s.id);
                            else next.delete(s.id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                ) : null}
                <th className={TH}>Mã lịch</th>
                <th className={TH}>Thiết bị</th>
                <th className={TH}>Quy trình</th>
                <th className={TH}>Tần suất</th>
                <th className={TH}>Ưu tiên</th>
                <th className={TH}>Trạng thái</th>
                <th className={TH}>Đến hạn kế tiếp</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((schedule) => (
                <tr
                  key={schedule.id}
                  className={cn('hover:bg-muted', selectedIds.has(schedule.id) && 'bg-blue-50/60 hover:bg-blue-50/80')}
                >
                  {canManage ? (
                    <td className={cn(TD, 'text-center')}>
                      <Checkbox
                        aria-label={`Chọn lịch ${schedule.code}`}
                        checked={selectedIds.has(schedule.id)}
                        disabled={busy}
                        onCheckedChange={() => toggleId(schedule.id)}
                      />
                    </td>
                  ) : null}
                  <td className={cn(TD, 'truncate font-mono text-sm font-bold text-blue-800')}>
                    {schedule.code}
                  </td>
                  <td className={TD}>
                    <span className="inline-block max-w-full truncate rounded border border-border bg-slate-100 px-1.5 py-0.5 align-middle font-mono text-[0.8125rem] font-semibold text-slate-700">
                      {schedule.assetCode}
                    </span>
                  </td>
                  <td className={TD}>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <strong className="truncate text-sm text-foreground">
                        {schedule.procedureDefinitionCode ?? '—'}
                      </strong>
                      {schedule.procedureDefinitionName ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {schedule.procedureDefinitionName}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={TD}>
                    <span className="inline-block whitespace-nowrap rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[0.8125rem] font-semibold text-green-800">
                      {frequencyLabel(schedule.frequency)}
                    </span>
                  </td>
                  <td className={TD}>
                    <span
                      className={cn(
                        'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold',
                        PRIORITY_CLASS[schedule.priority],
                      )}
                    >
                      {PRIORITY_LABEL[schedule.priority]}
                    </span>
                  </td>
                  <td className={TD}>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap text-[0.8125rem] font-semibold',
                        STATUS_CLASS[schedule.status],
                      )}
                    >
                      {schedule.status === 'active'
                        ? '● Đang chạy'
                        : schedule.status === 'paused'
                          ? '● Tạm dừng'
                          : schedule.status}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-[0.8125rem] text-slate-600')}>
                    {formatDateTime(schedule.nextDueAt)}
                  </td>
                </tr>
              ))}
              {paginated.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 8 : 7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    {hasFilter
                      ? 'Không tìm thấy lịch bảo trì nào khớp bộ lọc.'
                      : 'Chưa có lịch bảo trì nào.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <TablePagerBar
          summary={
            <>
              Hiển thị{' '}
              <strong>
                {totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–
                {Math.min(safeCurrentPage * pageSize, totalRecords)}
              </strong>{' '}
              / <strong>{totalRecords}</strong> lịch
            </>
          }
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZES}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setCurrentPage(1);
          }}
        >
          <Tip content="Trang trước">
            <span className="inline-flex">
              <Button
                variant="outline"
                size="lg"
                className="rounded-md px-3"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                ← Trước
              </Button>
            </span>
          </Tip>
          <span className="px-1 text-sm font-bold text-foreground">
            {safeCurrentPage} / {totalPages}
          </span>
          <Tip content="Trang sau">
            <span className="inline-flex">
              <Button
                variant="outline"
                size="lg"
                className="rounded-md px-3"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Sau →
              </Button>
            </span>
          </Tip>
        </TablePagerBar>
      </div>
      <ConfirmDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title={
          confirming === 'skip'
            ? `Bỏ qua kỳ tới của ${dialogTargets.length} lịch?`
            : confirming === 'resume'
              ? `Kích hoạt lại ${dialogTargets.length} lịch?`
              : `Ngưng tạo lịch cho ${dialogTargets.length} lịch?`
        }
        description={
          confirming === 'skip'
            ? 'Hạn của các lịch đã chọn được đẩy sang chu kỳ kế tiếp, hệ thống không sinh phiếu bảo trì lần này.'
            : confirming === 'resume'
              ? 'Các lịch đã chọn sẽ chạy lại và tiếp tục sinh phiếu bảo trì khi đến hạn.'
              : 'Hệ thống sẽ ngừng sinh phiếu mới từ các lịch đã chọn. Các phiếu đã sinh không bị ảnh hưởng.'
        }
        confirmText={confirming === 'skip' ? 'Bỏ qua kỳ tới' : confirming === 'resume' ? 'Kích hoạt lại' : 'Ngưng tạo lịch'}
        destructive={confirming === 'pause'}
        busy={running}
        onConfirm={() => void runBulk()}
      >
        <ul className="m-0 max-h-48 list-none overflow-y-auto rounded-md border border-border bg-slate-50 p-0">
          {dialogTargets.map((schedule) => (
            <li
              key={schedule.id}
              className="flex items-baseline gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0"
            >
              <span className="font-mono text-[0.8125rem] font-semibold text-blue-800">{schedule.code}</span>
              <span className="min-w-0 truncate text-slate-900">{schedule.assetCode}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </section>
  );
}
