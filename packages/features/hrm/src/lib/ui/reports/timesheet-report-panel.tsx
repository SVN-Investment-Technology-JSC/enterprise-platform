'use client';
import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { HrmBoardEmployee, HrmTimesheetBoard } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../../hrm-api';
import { downloadStyledXlsx } from '../../hrm-xlsx';
import { Button } from '../button';
import { toast } from '../toast';
import { Notice } from '../comp-off/comp-off-kit';
import { buildBoardSheet } from '../timesheet-board-format';
import { ReportScopeBar, initialScope, useReportOptions, type ReportScope } from './report-scope';

const PAGE_SIZE = 200;
const MAX_PAGES = 100;

/** Bảng chấm công của tháng theo mẫu bảng công, lọc theo phòng ban và nhân viên rồi xuất Excel. */
export function TimesheetReportPanel() {
  const { options, error: optionsError } = useReportOptions();
  const [scope, setScope] = useState<ReportScope>(initialScope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const departmentNames = useMemo(() => {
    const byId = new Map((options?.departments ?? []).map((d) => [d.id, d.name]));
    return new Set(scope.departmentIds.map((id) => byId.get(id)).filter((n): n is string => Boolean(n)));
  }, [options, scope.departmentIds]);

  async function exportExcel() {
    setBusy(true);
    setError('');
    try {
      const all: HrmBoardEmployee[] = [];
      let board: HrmTimesheetBoard | null = null;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const params = new URLSearchParams({ month: scope.month, page: String(page), page_size: String(PAGE_SIZE) });
        const response = await hrmFetch<{ data: HrmTimesheetBoard }>(`/timesheet-board?${params}`);
        board = response.data;
        all.push(...board.employees);
        if (board.employees.length === 0 || all.length >= board.meta.total) break;
      }
      if (!board) throw new Error('Không tải được bảng công');
      const chosen = all.filter(
        (e) =>
          (scope.employeeIds.length === 0 || scope.employeeIds.includes(e.employeeId)) &&
          (departmentNames.size === 0 || departmentNames.has((e.departmentName ?? '').trim())),
      );
      if (chosen.length === 0) {
        setError('Không có nhân viên nào khớp bộ lọc trong tháng này.');
        return;
      }
      downloadStyledXlsx(`bang-cham-cong-${scope.month}`, buildBoardSheet(board, chosen, scope.month), `Bang cong ${scope.month}`);
      toast.success(`Đã xuất bảng chấm công của ${chosen.length} nhân viên`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xuất được bảng chấm công');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <ReportScopeBar scope={scope} onChange={setScope} options={options} hideRange />
        <div className="ml-auto">
          <Button onClick={() => void exportExcel()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Xuất Excel
          </Button>
        </div>
      </div>
      {error || optionsError ? <Notice tone="error">{error || optionsError}</Notice> : null}
    </div>
  );
}
