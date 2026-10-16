'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import type { FinanceAccount, FinanceBreakdownRow, FinanceReport } from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, toQuery } from '../finance-api';
import { buildCsv, downloadCsv } from '../finance-csv';
import { dateVn, money, periodPresets, todayVn } from '../finance-format';
import { LedgerReport } from './reports-ledger';
import { loadWorkspaceProjects, projectLabel, type WorkspaceProjectOption } from '../workspace-links';
import { Button } from '../ui/button';
import { CashflowChart } from '../ui/cashflow-chart';
import { EmptyState, ErrorBanner } from '../ui/form-parts';
import { cn } from '../utils';

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn('mt-1 text-xl font-semibold tabular-nums text-slate-900', tone === 'good' && 'text-emerald-700', tone === 'bad' && 'text-red-600')}>{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Breakdown({ rows, total }: { rows: readonly FinanceBreakdownRow[]; total: number }) {
  if (!rows.length) return <EmptyState>Chưa có phát sinh trong kỳ.</EmptyState>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
          <th className="py-1.5 font-medium">Hạng mục</th>
          <th className="text-right font-medium">Số phiếu</th>
          <th className="text-right font-medium">Số tiền</th>
          <th className="w-14 text-right font-medium">Tỷ lệ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id ?? row.name} className="border-b border-slate-50">
            <td className="py-1.5">{row.name}</td>
            <td className="text-right tabular-nums">{row.count}</td>
            <td className="text-right tabular-nums">{money(row.amount)}</td>
            <td className="text-right tabular-nums text-slate-500">{total > 0 ? `${Math.round((row.amount / total) * 1000) / 10}%` : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type ReportTab = 'ledger' | 'analysis';

function AnalysisView({ from, to, accountId, refreshKey }: { from: string; to: string; accountId: string; refreshKey: number }) {
  const [projectId, setProjectId] = useState('');
  // Dự án lấy từ Workspace; Workspace tắt hoặc chưa kết nối thì không có ô lọc dự án, báo cáo vẫn chạy bình thường.
  const [projects, setProjects] = useState<WorkspaceProjectOption[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadWorkspaceProjects().then((result) => setProjects(result.items)).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      setReport(await financeFetch<FinanceReport>(`/reports/summary${toQuery({ from, to, accountId, projectId })}`));
      setError(null);
    } catch (e) {
      setError(financeErrorMessage(e, 'Không tải được báo cáo.'));
    } finally {
      setLoading(false);
    }
  }, [from, to, accountId, projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function exportCsv() {
    if (!report) return;
    const section = (title: string, rows: readonly FinanceBreakdownRow[]) => [[title], ['Hạng mục', 'Số phiếu', 'Số tiền'], ...rows.map((r) => [r.name, r.count, r.amount]), []];
    downloadCsv(
      `bao-cao-thu-chi-${report.from}-${report.to}`,
      buildCsv([
        ['Báo cáo thu chi', `${dateVn(report.from)} - ${dateVn(report.to)}`],
        ['Tổng thu', report.totals.receipts],
        ['Tổng chi', report.totals.payments],
        ['Chênh lệch', report.totals.net],
        [],
        ['Dòng tiền theo kỳ'],
        ['Kỳ', 'Thu', 'Chi', 'Chênh lệch'],
        ...report.cashflow.map((p) => [p.period, p.receipts, p.payments, p.net]),
        [],
        ...section('Thu theo lý do', report.receiptsByReason),
        ...section('Chi theo lý do', report.paymentsByReason),
        ...section('Thu theo dự án', report.receiptsByProject),
        ...section('Chi theo dự án', report.paymentsByProject),
        ['Biến động tài khoản'],
        ['Tài khoản', 'Số dư đầu', 'Phiếu thu', 'Phiếu chi', 'Chuyển đến', 'Chuyển đi', 'Số dư cuối'],
        ...report.accounts.map((a) => [a.accountName, a.openingBalance, a.receipts, a.payments, a.transfersIn, a.transfersOut, a.closingBalance]),
      ]),
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {projects.length ? (
          <div className="w-60">
            <SearchableSelect options={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))} value={projectId} onChange={setProjectId} placeholder="Mọi dự án" clearable height={32} />
          </div>
        ) : (
          <span />
        )}
        <Button type="button" variant="outline" disabled={!report} onClick={exportCsv}><Download aria-hidden /> Xuất Excel</Button>
      </div>
      <ErrorBanner message={error} />
      {loading && !report ? <div role="status" className="p-6 text-sm text-slate-500">Đang tải báo cáo…</div> : null}
      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Tổng thu" value={money(report.totals.receipts)} tone="good" />
            <Kpi label="Tổng chi" value={money(report.totals.payments)} tone="bad" />
            <Kpi label="Chênh lệch thu - chi" value={money(report.totals.net)} tone={report.totals.net < 0 ? 'bad' : 'good'} />
            <Kpi label="Số phiếu thu / chi / chuyển" value={`${report.totals.receiptCount} / ${report.totals.paymentCount} / ${report.totals.transferCount}`} />
          </div>
          <Card title={`Dòng tiền theo ${report.granularity === 'month' ? 'tháng' : 'ngày'}`}>
            <CashflowChart points={report.cashflow} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Thu theo lý do"><Breakdown rows={report.receiptsByReason} total={report.totals.receipts} /></Card>
            <Card title="Chi theo lý do"><Breakdown rows={report.paymentsByReason} total={report.totals.payments} /></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Thu theo dự án"><Breakdown rows={report.receiptsByProject} total={report.totals.receipts} /></Card>
            <Card title="Chi theo dự án"><Breakdown rows={report.paymentsByProject} total={report.totals.payments} /></Card>
          </div>
          <Card title="Biến động tài khoản">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="py-1.5 font-medium">Tài khoản</th>
                    <th className="text-right font-medium">Số dư đầu</th>
                    <th className="text-right font-medium">Phiếu thu</th>
                    <th className="text-right font-medium">Phiếu chi</th>
                    <th className="text-right font-medium">Chuyển đến</th>
                    <th className="text-right font-medium">Chuyển đi</th>
                    <th className="text-right font-medium">Số dư cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {report.accounts.map((a) => (
                    <tr key={a.accountId} className="border-b border-slate-50">
                      <td className="py-1.5">{a.accountName}</td>
                      <td className="text-right tabular-nums">{money(a.openingBalance)}</td>
                      <td className="text-right tabular-nums text-emerald-700">{money(a.receipts)}</td>
                      <td className="text-right tabular-nums text-red-600">{money(a.payments)}</td>
                      <td className="text-right tabular-nums">{money(a.transfersIn)}</td>
                      <td className="text-right tabular-nums">{money(a.transfersOut)}</td>
                      <td className="text-right font-semibold tabular-nums">{money(a.closingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function ReportsScreen() {
  const today = todayVn();
  const presets = useMemo(() => periodPresets(today), [today]);
  const [from, setFrom] = useState(presets[0].from);
  const [to, setTo] = useState(presets[0].to);
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [tab, setTab] = useState<ReportTab>('ledger');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void financeFetch<FinanceAccount[]>('/accounts').then(setAccounts).catch(() => undefined);
  }, []);

  const activePreset = presets.find((p) => p.from === from && p.to === to)?.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Báo cáo thu chi</h1>
        <Button type="button" variant="outline" onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw aria-hidden /> Làm mới</Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div role="group" aria-label="Khoảng thời gian" className="flex flex-wrap gap-1">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={activePreset === preset.id}
                onClick={() => {
                  setFrom(preset.from);
                  setTo(preset.to);
                }}
                className={cn('rounded-full border px-3 py-1 text-xs', activePreset === preset.id ? 'border-accent-strong bg-accent-soft text-accent-text' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="w-36"><DatePickerInput aria-label="Từ ngày" value={from} onChange={setFrom} /></div>
          <div className="w-36"><DatePickerInput aria-label="Đến ngày" value={to} onChange={setTo} /></div>
          <div className="w-52">
            <SearchableSelect options={accounts.map((a) => ({ value: a.id, label: a.name }))} value={accountId} onChange={setAccountId} placeholder="Mọi tài khoản" clearable height={32} />
          </div>
          <div role="tablist" aria-label="Kiểu báo cáo" className="ml-auto flex gap-1">
            {([{ id: 'ledger', label: 'Sổ thu chi' }, { id: 'analysis', label: 'Phân tích' }] as const).map((item) => (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={cn('rounded-lg px-3 py-1 text-sm', tab === item.id ? 'bg-accent-soft font-semibold text-accent-text' : 'text-slate-600 hover:bg-slate-100')}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'ledger' ? <LedgerReport key={refreshKey} from={from} to={to} accountId={accountId} /> : <AnalysisView from={from} to={to} accountId={accountId} refreshKey={refreshKey} />}
      </div>
    </div>
  );
}
