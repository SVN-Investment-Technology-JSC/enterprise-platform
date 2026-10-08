'use client';
import { useEffect, useState } from 'react';
import { Calculator, Loader2, X } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import type { PayrollComponentDraft } from '../hrm-payroll-config';

interface RunOption {
  id: string;
  runNo: number;
  status: string;
  periodCode: string;
}
interface EmployeeOption {
  employeeId: string;
  fullName: string;
  employeeCode: string;
}
interface DryRunEmployee {
  employeeId: string;
  fullName: string;
  employeeCode: string;
  items: { code: string; name: string; type: string; amount: number }[];
  gross: number;
  deductions: number;
  net: number;
  netMismatch: number;
  warnings: string[];
}

const money = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

/** Trạng thái lần tính lương được phép dùng để tính thử. */
const RUN_STATUS_LABEL: Record<string, string> = {
  CALCULATED: 'Đã tính',
  APPROVED: 'Đã duyệt',
  FINALIZED: 'Đã chốt',
};

/** Tính thử công thức đang soạn trên kỳ lương đã tính. Không ghi dữ liệu. */
export function PayrollDryRunPanel({
  components,
  inputs,
}: {
  components: PayrollComponentDraft[];
  inputs: () => Record<string, number>;
}) {
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [runId, setRunId] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [results, setResults] = useState<DryRunEmployee[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    hrmFetch<{ data: RunOption[] }>('/payroll-dry-run/runs')
      .then((r) => setRuns(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được kỳ lương'));
  }, []);

  useEffect(() => {
    setPicked([]);
    setResults([]);
    setEmployees([]);
    if (!runId) return;
    hrmFetch<{ data: EmployeeOption[] }>(`/payroll-dry-run/runs/${runId}/employees`)
      .then((r) => setEmployees(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được nhân viên'));
  }, [runId]);

  async function run() {
    setBusy(true);
    setError('');
    try {
      const res = await hrmFetch<{ data: DryRunEmployee[] }>('/payroll-dry-run', {
        method: 'POST',
        body: JSON.stringify({ runId, employeeIds: picked, components, inputs: inputs() }),
      });
      setResults(res.data);
    } catch (e) {
      setResults([]);
      setError(e instanceof Error ? e.message : 'Không tính thử được');
    } finally {
      setBusy(false);
    }
  }

  const available = employees.filter((e) => !picked.includes(e.employeeId));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
        <Calculator className="size-3.5" />
        Tính thử (không ghi dữ liệu)
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block space-y-1 text-xs font-medium text-slate-700">
          <span>Kỳ lương đã tính</span>
          <SearchableSelect
            value={runId}
            clearable
            placeholder="Chọn kỳ"
            options={runs.map((r) => ({
              value: r.id,
              label: `${r.periodCode} - lần ${r.runNo} (${RUN_STATUS_LABEL[r.status] ?? 'Khác'})`,
            }))}
            onChange={(v) => setRunId(v || '')}
          />
        </label>
        <label className="block space-y-1 text-xs font-medium text-slate-700">
          <span>Thêm nhân viên (tối đa 3)</span>
          <SearchableSelect
            value={pending}
            clearable
            placeholder={picked.length >= 3 ? 'Đã đủ 3 nhân viên' : 'Chọn nhân viên'}
            options={picked.length >= 3 ? [] : available.map((e) => ({ value: e.employeeId, label: `${e.employeeCode} - ${e.fullName}` }))}
            onChange={(v) => {
              if (v) setPicked((p) => [...p, v].slice(0, 3));
              setPending('');
            }}
          />
        </label>
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((id) => {
            const e = employees.find((x) => x.employeeId === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white pl-2 pr-0.5 py-0.5 text-[11px]">
                {e ? `${e.employeeCode} - ${e.fullName}` : 'Nhân viên đã chọn'}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Bỏ nhân viên"
                  className="size-4 rounded-full text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setPicked((p) => p.filter((x) => x !== id))}
                >
                  <X className="size-3" />
                </Button>
              </span>
            );
          })}
        </div>
      )}
      <Button type="button" variant="outline" disabled={busy || !runId || !picked.length} onClick={run} className="text-xs h-8">
        {busy ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Calculator className="size-3.5 mr-1.5" />}
        Tính thử
      </Button>
      {error && (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </p>
      )}
      {results.map((r) => (
        <div key={r.employeeId} className="rounded border border-slate-200 bg-white p-2.5 text-xs space-y-1.5">
          <div className="font-semibold text-slate-900">
            {r.employeeCode} - {r.fullName}
          </div>
          <table className="w-full">
            <tbody>
              {r.items.map((i) => (
                <tr key={i.code} className="border-b border-slate-100">
                  <td className="py-0.5 pr-2">
                    {i.name} <span className="font-mono text-slate-500">({i.code})</span>
                  </td>
                  <td className="py-0.5 text-right font-mono">{money(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-x-4 text-slate-700">
            <span>Tổng thu nhập: <b>{money(r.gross)}</b></span>
            <span>Tổng khấu trừ: <b>{money(r.deductions)}</b></span>
            <span>Thực lĩnh: <b>{money(r.net)}</b></span>
          </div>
          {r.warnings.map((w) => (
            <p key={w} className="text-amber-700">{w}</p>
          ))}
        </div>
      ))}
    </div>
  );
}
