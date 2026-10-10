'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HrmOrgUnitOption,
  HrmScheduleDay,
  HrmScheduleEmployee,
  HrmScheduleGrid,
  HrmScheduleListRow,
  HrmScheduleTemplate,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { cn } from '../utils';
import { useHrmPermissions } from '../hrm-permissions';
import {
  SCHEDULE_PAGE_SIZE,
  fetchScheduleExport,
  fetchScheduleGrid,
  fetchScheduleList,
  fetchShifts,
  fetchTemplates,
  fetchUnits,
  hrmEmployeeOptions,
  type ScheduleFilters,
} from '../hrm-work-schedule-api';
import {
  NOT_MIGRATED_NOTICE,
  addDays,
  buildScheduleCsv,
  classifyScheduleError,
  downloadCsvText,
  endOfMonth,
  formatRangeLabel,
  formatVnDate,
  rangeFor,
  shiftAnchor,
  startOfMonth,
  todayIso,
  validateDateRange,
  type ScheduleGridView,
} from '../hrm-work-schedule-model';
import { Button } from '../ui/button';
import { DatePickerInput } from '../ui/date-picker-input';
import { Input } from '../ui/input';
import { toast } from '../ui/toast';
import { AssignDialog } from '../ui/work-schedule/assign-dialog';
import { AuditDrawer } from '../ui/work-schedule/audit-drawer';
import { CancelScheduleDialog } from '../ui/work-schedule/cancel-dialog';
import { Checkbox, Notice } from '../ui/work-schedule/common';
import { CopyScheduleDialog } from '../ui/work-schedule/copy-dialog';
import { EmployeeDetailPanel } from '../ui/work-schedule/employee-detail-panel';
import { HolidaysManager } from '../ui/work-schedule/holidays-manager';
import { RulesManager } from '../ui/work-schedule/rules-manager';
import { ScheduleGridView as ScheduleGridTable, ScheduleLegend } from '../ui/work-schedule/schedule-grid';
import { ScheduleListView } from '../ui/work-schedule/schedule-list';
import { TemplatesManager } from '../ui/work-schedule/templates-manager';

type ViewKey = ScheduleGridView | 'list';

const VIEW_TABS: { key: ViewKey; label: string }[] = [
  { key: 'month', label: 'Lịch tháng' },
  { key: 'week', label: 'Lịch tuần' },
  { key: 'list', label: 'Danh sách phân ca' },
];

type DialogState =
  | { kind: 'assign'; mode: 'single' | 'bulk'; initial?: { employeeId?: string } }
  | { kind: 'exception'; initial?: { employeeId?: string; date?: string } }
  | { kind: 'cancel'; initial?: { employeeId?: string } }
  | { kind: 'copy'; initial?: { employeeId?: string } }
  | { kind: 'templates' }
  | { kind: 'rules' }
  | { kind: 'holidays' }
  | null;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function WorkScheduleScreen() {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.schedule.manage');
  const canBulk = can('hrm.schedule.bulk');
  const canCalendar = can('hrm.schedule.calendar');
  const canException = canManage && canCalendar;

  const [view, setView] = useState<ViewKey>('month');
  const [anchor, setAnchor] = useState(() => todayIso());
  const [listFrom, setListFrom] = useState(() => startOfMonth(todayIso()));
  const [listTo, setListTo] = useState(() => endOfMonth(todayIso()));
  const [unitId, setUnitId] = useState('');
  const [includeChildUnits, setIncludeChildUnits] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const q = useDebounced(searchText, 300);

  const [shifts, setShifts] = useState<HrmShiftDefinition[]>([]);
  const [units, setUnits] = useState<HrmOrgUnitOption[]>([]);
  const [templates, setTemplates] = useState<HrmScheduleTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [metaError, setMetaError] = useState('');

  const [grid, setGrid] = useState<HrmScheduleGrid | null>(null);
  const [list, setList] = useState<{ rows: HrmScheduleListRow[]; total: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [notMigrated, setNotMigrated] = useState(false);

  const [selected, setSelected] = useState<HrmScheduleEmployee | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [auditOpen, setAuditOpen] = useState<{ employeeId?: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const [employeeOptions, setEmployeeOptions] = useState<SearchableSelectOption[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState('');
  const employeesRequested = useRef(false);

  const isGridView = view !== 'list';
  const range = useMemo(
    () => (view === 'list' ? { from: listFrom, to: listTo } : rangeFor(view, anchor)),
    [view, anchor, listFrom, listTo],
  );
  const filters: ScheduleFilters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      unitId,
      includeChildUnits,
      q,
      unassignedOnly,
    }),
    [range, unitId, includeChildUnits, q, unassignedOnly],
  );

  // Danh mục dùng chung: ca (GET shifts) và đơn vị (GET shift-units).
  useEffect(() => {
    let alive = true;
    Promise.all([fetchShifts(), fetchUnits()])
      .then(([s, u]) => {
        if (!alive) return;
        setShifts(s.data);
        setUnits(u.data);
        setMetaError('');
      })
      .catch((e) => alive && setMetaError(classifyScheduleError(e).message));
    return () => {
      alive = false;
    };
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetchTemplates();
      setTemplates(res.data);
      setTemplatesError('');
    } catch (e) {
      const info = classifyScheduleError(e);
      if (info.kind === 'NOT_MIGRATED') setNotMigrated(true);
      setTemplatesError(info.message);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // Nhân viên chỉ tải khi cần (mở hộp thoại chọn đối tượng).
  useEffect(() => {
    if (!dialog || employeesRequested.current) return;
    employeesRequested.current = true;
    setEmployeesLoading(true);
    hrmEmployeeOptions()
      .then((options) => {
        setEmployeeOptions(options);
        setEmployeesError('');
      })
      .catch((e) => {
        employeesRequested.current = false;
        setEmployeesError(
          e instanceof Error ? `Không tải được danh sách nhân viên: ${e.message}` : 'Không tải được danh sách nhân viên.',
        );
      })
      .finally(() => setEmployeesLoading(false));
  }, [dialog]);

  // Tải lưới / danh sách theo bộ lọc.
  const seq = useRef(0);
  useEffect(() => {
    const invalid = view === 'list' ? validateDateRange(listFrom, listTo) : null;
    if (invalid) {
      setDataError(invalid);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    setDataError('');
    const run = async () => {
      try {
        if (view === 'list') {
          const res = await fetchScheduleList(filters, page);
          if (id !== seq.current) return;
          setList({ rows: res.data, total: res.meta.total, pageSize: res.meta.pageSize || SCHEDULE_PAGE_SIZE });
        } else {
          const res = await fetchScheduleGrid(filters, page);
          if (id !== seq.current) return;
          setGrid(res);
        }
        setNotMigrated(false);
      } catch (e) {
        if (id !== seq.current) return;
        const info = classifyScheduleError(e);
        if (info.kind === 'NOT_MIGRATED') setNotMigrated(true);
        else setDataError(info.message);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    };
    void run();
  }, [view, filters, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((n) => n + 1), []);
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const unitOptions: SearchableSelectOption[] = useMemo(
    () => units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` })),
    [units],
  );

  const hasFilters = Boolean(unitId || searchText || unassignedOnly);
  const clearFilters = () => {
    setUnitId('');
    setSearchText('');
    setUnassignedOnly(false);
    setPage(1);
  };

  const selectedDays: HrmScheduleDay[] = useMemo(
    () => (selected && grid ? grid.days.filter((d) => d.employeeId === selected.employeeId) : []),
    [selected, grid],
  );

  async function exportCsv() {
    const invalid = validateDateRange(range.from, range.to);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setExporting(true);
    try {
      const res = await fetchScheduleExport(filters);
      if (!res.data.length) {
        toast.info('Không có dữ liệu phân ca để xuất trong phạm vi đã chọn.');
        return;
      }
      downloadCsvText(`phan-ca_${range.from}_${range.to}.csv`, buildScheduleCsv(res.data));
      toast.success(`Đã xuất ${res.data.length} dòng lịch.`);
    } catch (e) {
      toast.error(classifyScheduleError(e).message);
    } finally {
      setExporting(false);
    }
  }

  if (notMigrated)
    return (
      <div className="mx-auto mt-6 max-w-2xl">
        <Notice tone="warn" title="Chưa khởi tạo dữ liệu phân ca">
          {NOT_MIGRATED_NOTICE}
        </Notice>
      </div>
    );

  const sharedDialogProps = {
    units,
    employeeOptions,
    employeesLoading,
    employeesError,
  };
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[560px] flex-col gap-2.5">
      {/* Hàng 1: chế độ xem, kỳ xem, xuất và lịch sử */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Chế độ xem lịch" className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                onClick={() => {
                  setView(tab.key);
                  setPage(1);
                }}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  view === tab.key ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {isGridView ? (
            <div className="flex items-center gap-1.5" aria-label="Điều hướng kỳ xem">
              <Button
                variant="outline"
                size="sm"
                aria-label={view === 'month' ? 'Tháng trước' : 'Tuần trước'}
                onClick={() => {
                  setAnchor((a) => shiftAnchor(view, a, -1));
                  setPage(1);
                }}
              >
                ←
              </Button>
              <span className="min-w-40 text-center text-sm font-bold text-slate-900" aria-live="polite">
                {formatRangeLabel(view, anchor)}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={view === 'month' ? 'Tháng sau' : 'Tuần sau'}
                onClick={() => {
                  setAnchor((a) => shiftAnchor(view, a, 1));
                  setPage(1);
                }}
              >
                →
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAnchor(todayIso());
                  setPage(1);
                }}
              >
                {view === 'month' ? 'Tháng này' : 'Tuần này'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-36">
                <DatePickerInput aria-label="Từ ngày" value={listFrom} onChange={changeFilter(setListFrom)} />
              </div>
              <span className="text-xs text-slate-500">đến</span>
              <div className="w-36">
                <DatePickerInput aria-label="Đến ngày" value={listTo} onChange={changeFilter(setListTo)} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setListFrom(todayIso());
                  setListTo(addDays(todayIso(), 29));
                  setPage(1);
                }}
              >
                30 ngày tới
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" permission="hrm.schedule.read" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? 'Đang xuất…' : 'Xuất Excel'}
          </Button>
          <Button variant="outline" size="sm" permission="hrm.schedule.read" onClick={() => setAuditOpen({})}>
            Lịch sử thay đổi
          </Button>
        </div>
      </div>

      {/* Hàng 2: bộ lọc */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <div className="w-72 max-w-full">
          <SearchableSelect
            options={unitOptions}
            value={unitId}
            placeholder="Tất cả đơn vị"
            emptyText="Không tìm thấy đơn vị phù hợp"
            onChange={changeFilter(setUnitId)}
            clearable
          />
        </div>
        <Checkbox
          checked={includeChildUnits}
          onChange={changeFilter(setIncludeChildUnits)}
          label="Gồm đơn vị con"
          disabled={!unitId}
        />
        <div className="w-60 max-w-full">
          <Input
            aria-label="Tìm nhân viên theo mã hoặc tên"
            placeholder="Tìm mã hoặc tên nhân viên…"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Checkbox checked={unassignedOnly} onChange={changeFilter(setUnassignedOnly)} label="Chưa có lịch" />
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-3.5" aria-hidden /> Xóa bộ lọc
          </Button>
        ) : null}
        {metaError ? (
          <span role="alert" className="text-xs text-red-600">
            {metaError}
          </span>
        ) : null}
      </div>

      {/* Hàng 3: thao tác */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" permission="hrm.schedule.manage" onClick={() => setDialog({ kind: 'assign', mode: 'single' })}>
          Phân ca mới
        </Button>
        <Button size="sm" permission="hrm.schedule.bulk" onClick={() => setDialog({ kind: 'assign', mode: 'bulk' })}>
          Phân ca hàng loạt
        </Button>
        {canException ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'exception' })}>
            Thiết lập ngoại lệ
          </Button>
        ) : null}
        <Button size="sm" variant="outline" permission="hrm.schedule.manage" onClick={() => setDialog({ kind: 'cancel' })}>
          Hủy lịch
        </Button>
        <Button size="sm" variant="outline" permission="hrm.schedule.bulk" onClick={() => setDialog({ kind: 'copy' })}>
          Sao chép lịch
        </Button>
        <Button size="sm" variant="outline" permission="hrm.schedule.read" onClick={() => setDialog({ kind: 'templates' })}>
          Mẫu lịch tuần
        </Button>
        <Button size="sm" variant="outline" permission="hrm.schedule.read" onClick={() => setDialog({ kind: 'rules' })}>
          Lịch định kỳ
        </Button>
        <Button size="sm" variant="outline" permission="hrm.schedule.calendar" onClick={() => setDialog({ kind: 'holidays' })}>
          Lịch lễ/Tết
        </Button>
        {isGridView ? (
          <div className="ml-auto">
            <ScheduleLegend />
          </div>
        ) : null}
      </div>

      {/* Nội dung: lưới/danh sách (trái) và chi tiết nhân viên (phải) */}
      <div className="flex min-h-0 flex-1 gap-3">
        {isGridView ? (
          <ScheduleGridTable
            grid={grid}
            loading={loading}
            error={dataError}
            from={range.from}
            to={range.to}
            wide={view === 'week'}
            selectedEmployeeId={selected?.employeeId ?? null}
            canEditCell={canException}
            page={page}
            onPageChange={setPage}
            onSelectEmployee={(employee) =>
              setSelected((current) => (current?.employeeId === employee.employeeId ? null : employee))
            }
            onCellClick={(employee, date) =>
              setDialog({ kind: 'exception', initial: { employeeId: employee.employeeId, date } })
            }
          />
        ) : (
          <ScheduleListView
            rows={list?.rows ?? null}
            total={list?.total ?? 0}
            page={page}
            pageSize={list?.pageSize ?? SCHEDULE_PAGE_SIZE}
            loading={loading}
            error={dataError}
            onPageChange={setPage}
            onSelectEmployee={(employeeId) => setAuditOpen({ employeeId })}
          />
        )}
        {isGridView && selected ? (
          <EmployeeDetailPanel
            employee={selected}
            days={selectedDays}
            rangeText={`${formatVnDate(range.from)} - ${formatVnDate(range.to)}`}
            canException={canException}
            canCancel={canManage}
            canCopy={canBulk}
            onClose={() => setSelected(null)}
            onException={() => setDialog({ kind: 'exception', initial: { employeeId: selected.employeeId } })}
            onCancel={() => setDialog({ kind: 'cancel', initial: { employeeId: selected.employeeId } })}
            onCopy={() => setDialog({ kind: 'copy', initial: { employeeId: selected.employeeId } })}
          />
        ) : null}
      </div>

      {dialog?.kind === 'assign' ? (
        <AssignDialog
          open
          onOpenChange={closeDialog}
          mode={dialog.mode}
          shifts={shifts}
          templates={templates}
          canBulk={canBulk}
          canCalendar={canCalendar}
          initial={dialog.initial}
          onDone={reload}
          {...sharedDialogProps}
        />
      ) : null}
      {dialog?.kind === 'exception' ? (
        <AssignDialog
          open
          onOpenChange={closeDialog}
          mode="exception"
          shifts={shifts}
          templates={templates}
          canBulk={canBulk}
          canCalendar={canCalendar}
          initial={dialog.initial}
          onDone={reload}
          {...sharedDialogProps}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelScheduleDialog
          open
          onOpenChange={closeDialog}
          canBulk={canBulk}
          canCalendar={canCalendar}
          initial={dialog.initial}
          onDone={reload}
          {...sharedDialogProps}
        />
      ) : null}
      {dialog?.kind === 'copy' ? (
        <CopyScheduleDialog
          open
          onOpenChange={closeDialog}
          canCalendar={canCalendar}
          initial={dialog.initial}
          onDone={reload}
          {...sharedDialogProps}
        />
      ) : null}
      {dialog?.kind === 'templates' ? (
        <TemplatesManager
          open
          onOpenChange={closeDialog}
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          shifts={shifts}
          canManage={canManage}
          canBulk={canBulk}
          onChanged={() => {
            void loadTemplates();
            reload();
          }}
        />
      ) : null}
      {dialog?.kind === 'rules' ? (
        <RulesManager open onOpenChange={closeDialog} canManage={canManage} canBulk={canBulk} onChanged={reload} />
      ) : null}
      {dialog?.kind === 'holidays' ? (
        <HolidaysManager open onOpenChange={closeDialog} shifts={shifts} onChanged={reload} {...sharedDialogProps} />
      ) : null}

      <AuditDrawer
        open={auditOpen !== null}
        onOpenChange={(open) => !open && setAuditOpen(null)}
        employeeId={auditOpen?.employeeId}
        subtitle={
          auditOpen?.employeeId ? 'Lịch sử thay đổi phân ca của nhân viên đã chọn.' : undefined
        }
      />
    </div>
  );
}
