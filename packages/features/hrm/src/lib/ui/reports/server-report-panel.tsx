'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Search } from 'lucide-react';
import type { HrmReportKind, HrmReportRequestKind, HrmReportResult } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../../hrm-api';
import { downloadXlsx } from '../../hrm-xlsx';
import {
  buildReportRows,
  defaultColumnKeys,
  reportFileName,
  reportQuery,
  reportRangeProblem,
  selectedColumns,
  toggleColumn,
} from '../../report-model';
import { Button } from '../button';
import { toast } from '../toast';
import { EmptyRow, Notice, TableShell, td, tdRight, th, thRight } from '../comp-off/comp-off-kit';
import { MultiPicker } from './multi-picker';
import { ReportScopeBar, initialScope, scopeRange, useReportOptions, type ReportScope } from './report-scope';

const PREVIEW_ROWS = 100;

interface AppliedFilters {
  from: string;
  to: string;
  departmentIds: string[];
  employeeIds: string[];
  statuses: string[];
  requestKinds: string[];
  leaveTypeIds: string[];
}

const STATUS_OPTIONS = [
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'REJECTED', label: 'Từ chối' },
  { value: 'CANCELLED', label: 'Đã hủy' },
];

const REQUEST_KIND_OPTIONS: { value: HrmReportRequestKind; label: string }[] = [
  { value: 'leave', label: 'Đơn xin nghỉ' },
  { value: 'ot', label: 'Đơn làm thêm giờ' },
  { value: 'business_trip', label: 'Đơn công tác' },
  { value: 'shift_change', label: 'Đơn đổi ca' },
  { value: 'correction', label: 'Đơn giải trình công' },
];

export interface ServerReportPanelProps {
  readonly kind: HrmReportKind;
  /** Nhãn dùng đặt tên file và tên trang tính. */
  readonly label: string;
  readonly description: string;
  /** Có ô lọc trạng thái đơn. */
  readonly statusFilter?: boolean;
  /** Có ô lọc loại đơn (báo cáo tổng hợp). */
  readonly kindFilter?: boolean;
  /** Có ô lọc loại phép. */
  readonly leaveTypeFilter?: boolean;
  /** Thêm cột STT ở đầu file Excel (theo mẫu báo cáo công tác). */
  readonly withIndex?: boolean;
}

/**
 * Một báo cáo do máy chủ dựng: chọn phạm vi (tháng hoặc khoảng ngày), đối tượng (phòng ban, nhân viên), bộ lọc riêng và
 * các cột cần xuất; xem trước vài dòng đầu rồi tải file Excel gồm toàn bộ dòng khớp.
 */
export function ServerReportPanel({
  kind,
  label,
  description,
  statusFilter = false,
  kindFilter = false,
  leaveTypeFilter = false,
  withIndex = false,
}: ServerReportPanelProps) {
  const { options, error: optionsError } = useReportOptions();
  const [scope, setScope] = useState<ReportScope>(initialScope);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [requestKinds, setRequestKinds] = useState<string[]>([]);
  const [leaveTypeIds, setLeaveTypeIds] = useState<string[]>([]);
  const [columnKeys, setColumnKeys] = useState<string[] | null>(null);
  const [result, setResult] = useState<HrmReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);

  const range = scopeRange(scope);
  const problem = reportRangeProblem(range.from, range.to);

  // Bộ lọc đang áp dụng cho dữ liệu hiển thị; chỉ đổi khi bấm "Xem báo cáo" nên chỉnh ô lọc không gọi máy chủ liên tục.
  const [applied, setApplied] = useState<AppliedFilters>(() => ({
    ...scopeRange(initialScope()),
    departmentIds: [],
    employeeIds: [],
    statuses: [],
    requestKinds: [],
    leaveTypeIds: [],
  }));

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    const query = reportQuery({
      ...applied,
      statuses: statusFilter ? applied.statuses : undefined,
      requestKinds: kindFilter ? applied.requestKinds : undefined,
      leaveTypeIds: leaveTypeFilter ? applied.leaveTypeIds : undefined,
    });
    hrmFetch<{ data: HrmReportResult }>(`/reports/${kind}?${query}`)
      .then((response) => {
        if (seq !== requestSeq.current) return;
        setResult(response.data);
        setColumnKeys((current) => current ?? defaultColumnKeys(response.data.columns));
      })
      .catch((e: unknown) => {
        if (seq !== requestSeq.current) return;
        setResult(null);
        setError(e instanceof Error ? e.message : 'Không tải được báo cáo');
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [kind, applied, statusFilter, kindFilter, leaveTypeFilter]);

  function apply() {
    if (problem) return;
    setApplied({ ...range, departmentIds: scope.departmentIds, employeeIds: scope.employeeIds, statuses, requestKinds, leaveTypeIds });
  }

  const shown = useMemo(() => (result && columnKeys ? selectedColumns(result.columns, columnKeys) : []), [result, columnKeys]);
  const columnOptions = useMemo(() => (result?.columns ?? []).map((c) => ({ value: c.key, label: c.label })), [result]);

  function exportExcel() {
    if (!result || !columnKeys) return;
    const rows = buildReportRows(result, columnKeys, { withIndex });
    downloadXlsx(reportFileName(label, applied.from, applied.to), rows, label, 60);
    toast.success(`Đã xuất ${result.rows.length} dòng`);
  }

  const leaveTypeOptions = (options?.leaveTypes ?? []).map((t) => ({ value: t.id, label: t.name }));

  return (
    <div className="space-y-3">
      <p className="max-w-[90ch] text-xs text-slate-500">{description}</p>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <ReportScopeBar scope={scope} onChange={setScope} options={options} />
        {statusFilter ? <MultiPicker label="Trạng thái đơn" options={STATUS_OPTIONS} selected={statuses} onChange={setStatuses} width="w-44" /> : null}
        {kindFilter ? <MultiPicker label="Loại đơn" options={REQUEST_KIND_OPTIONS} selected={requestKinds} onChange={setRequestKinds} width="w-48" /> : null}
        {leaveTypeFilter ? <MultiPicker label="Loại phép" options={leaveTypeOptions} selected={leaveTypeIds} onChange={setLeaveTypeIds} searchable width="w-48" /> : null}
        {result ? (
          <MultiPicker
            label="Cột xuất"
            options={columnOptions}
            selected={columnKeys ?? []}
            minSelected={1}
            emptyLabel="Mặc định"
            onChange={(next) => setColumnKeys(next.length ? next : defaultColumnKeys(result.columns))}
            width="w-44"
          />
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={apply} disabled={loading || Boolean(problem)}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Xem báo cáo
          </Button>
          <Button variant="outline" onClick={exportExcel} disabled={!result || result.rows.length === 0 || loading}>
            <Download className="size-4" />
            Xuất Excel
          </Button>
        </div>
      </div>
      {problem ? <Notice tone="warn">{problem}</Notice> : null}
      {error || optionsError ? <Notice tone="error">{error || optionsError}</Notice> : null}
      {result?.truncated ? (
        <Notice tone="warn">
          Có {result.total} dòng khớp nhưng chỉ lấy {result.rows.length} dòng đầu. Hãy thu hẹp thời gian hoặc đối tượng để lấy đủ.
        </Notice>
      ) : null}
      <TableShell label={label}>
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>STT</th>
            {shown.map((c) => (
              <th key={c.key} className={c.type === 'number' ? thRight : th}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {!result && !error && !problem ? <EmptyRow colSpan={shown.length + 1}>Đang tải...</EmptyRow> : null}
          {result && result.rows.length === 0 ? <EmptyRow colSpan={shown.length + 1}>Không có dữ liệu trong phạm vi đã chọn.</EmptyRow> : null}
          {(result?.rows ?? []).slice(0, PREVIEW_ROWS).map((row, index) => (
            <tr key={index}>
              <td className={td}>{index + 1}</td>
              {shown.map((c) => (
                <td key={c.key} className={c.type === 'number' ? tdRight : `${td} whitespace-pre-line`}>
                  {row[c.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableShell>
      {result && result.rows.length > 0 ? (
        <p className="text-[11px] text-slate-500">
          Xem trước {Math.min(PREVIEW_ROWS, result.rows.length)} / {result.total} dòng. File Excel gồm tất cả {result.rows.length} dòng đã tải và chỉ các cột đã chọn.
        </p>
      ) : null}
    </div>
  );
}
