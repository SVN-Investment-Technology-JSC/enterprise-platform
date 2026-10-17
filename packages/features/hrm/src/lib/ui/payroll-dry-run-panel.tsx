'use client';
import { useEffect, useState } from 'react';
import { Calculator, FlaskConical, Loader2, X } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { InfoNote, SettingsField } from './settings-kit';
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
    <section
      aria-label="Tính thử"
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <FlaskConical className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Tính thử (không ghi dữ liệu)</h3>
          <p className="text-[12px] leading-snug text-slate-500">
            Áp công thức đang soạn lên kỳ lương đã tính để kiểm tra kết quả của tối đa 3 nhân viên.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <SettingsField label="Kỳ lương đã tính">
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
        </SettingsField>
        <SettingsField label="Thêm nhân viên (tối đa 3)">
          <SearchableSelect
            value={pending}
            clearable
            placeholder={picked.length >= 3 ? 'Đã đủ 3 nhân viên' : 'Chọn nhân viên'}
            options={
              picked.length >= 3
                ? []
                : available.map((e) => ({ value: e.employeeId, label: `${e.employeeCode} - ${e.fullName}` }))
            }
            onChange={(v) => {
              if (v) setPicked((p) => [...p, v].slice(0, 3));
              setPending('');
            }}
          />
        </SettingsField>
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((id) => {
            const e = employees.find((x) => x.employeeId === id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pr-0.5 pl-2 text-[12px]"
              >
                <span className="truncate">{e ? `${e.employeeCode} - ${e.fullName}` : 'Nhân viên đã chọn'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Bỏ nhân viên"
                  className="size-5 rounded-full text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setPicked((p) => p.filter((x) => x !== id))}
                >
                  <X className="size-3" />
                </Button>
              </span>
            );
          })}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy || !runId || !picked.length}
        onClick={run}
        className="h-9 w-full gap-1.5 text-xs font-semibold"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Calculator className="size-3.5" />}
        Tính thử
      </Button>
      {error && (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      )}
      {results.map((r) => (
        <div key={r.employeeId} className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
          <div className="font-semibold text-slate-900">
            {r.employeeCode} - {r.fullName}
          </div>
          <table className="w-full">
            <tbody>
              {r.items.map((i) => (
                <tr key={i.code} className="border-b border-slate-100 last:border-0">
                  <td className="min-w-0 py-1 pr-2 break-words">
                    {i.name} <span className="font-mono text-slate-500">({i.code})</span>
                  </td>
                  <td className="py-1 text-right font-mono whitespace-nowrap">{money(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="grid grid-cols-1 gap-1 rounded-md bg-slate-50 p-2 text-slate-700">
            <div className="flex justify-between gap-2">
              <dt>Tổng thu nhập</dt>
              <dd className="font-mono font-semibold">{money(r.gross)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Tổng khấu trừ</dt>
              <dd className="font-mono font-semibold">{money(r.deductions)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-200 pt-1">
              <dt className="font-semibold">Thực lĩnh</dt>
              <dd className="font-mono font-bold text-slate-900">{money(r.net)}</dd>
            </div>
          </dl>
          {r.warnings.map((w) => (
            <InfoNote key={w} tone="amber" className="p-2 text-[12px]">
              {w}
            </InfoNote>
          ))}
        </div>
      ))}
    </section>
  );
}
