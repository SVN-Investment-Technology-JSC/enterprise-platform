'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { FinanceDashboard } from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch } from '../finance-api';
import { dateVn, money } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { useFinancePermissions } from '../finance-permissions';
import { Button } from '../ui/button';
import { CashflowChart } from '../ui/cashflow-chart';
import { EmptyState, ErrorBanner, StatusBadge } from '../ui/form-parts';
import { cn } from '../utils';

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn('mt-1 text-xl font-semibold tabular-nums text-slate-900', tone === 'good' && 'text-emerald-700', tone === 'bad' && 'text-red-600')}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { capabilities } = useFinancePermissions();
  const [data, setData] = useState<FinanceDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    financeFetch<FinanceDashboard>('/dashboard')
      .then((result) => active && setData(result))
      .catch((e) => active && setError(financeErrorMessage(e, 'Không tải được tổng quan.')));
    return () => {
      active = false;
    };
  }, []);

  const showMoney = Boolean(data && (data.accounts.length > 0 || data.cashflow.length > 0));
  const create = (kind: 'RECEIPT' | 'PAYMENT' | 'TRANSFER') => {
    const key = kind === 'RECEIPT' ? 'receipt' : kind === 'PAYMENT' ? 'payment' : 'transfer';
    return capabilities?.[key].create ? (
      <Button key={kind} type="button" variant="outline" onClick={() => router.push(`${FINANCE_KIND_CONFIG[kind].path}/new`)}>
        <Plus aria-hidden /> {FINANCE_KIND_CONFIG[kind].createTitle.replace('Tạo mới ', 'Tạo ')}
      </Button>
    ) : null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Tổng quan tài chính</h1>
        <div className="flex gap-2">{(['RECEIPT', 'PAYMENT', 'TRANSFER'] as const).map(create)}</div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4">
        <ErrorBanner message={error} />
        {!data && !error ? <div role="status" className="p-6 text-sm text-slate-500">Đang tải tổng quan…</div> : null}
        {data ? (
          <>
            {showMoney ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Thu trong tháng" value={money(data.monthReceipts)} tone="good" hint={`${dateVn(data.monthFrom)} - ${dateVn(data.monthTo)}`} />
                <Kpi label="Chi trong tháng" value={money(data.monthPayments)} tone="bad" />
                <Kpi label="Chênh lệch tháng" value={money(data.monthNet)} tone={data.monthNet < 0 ? 'bad' : 'good'} />
                <Kpi label="Tổng số dư tài khoản" value={money(data.totalBalance)} />
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Kpi label="Phiếu chờ bạn duyệt" value={String(data.pendingApprovalCount)} hint={data.pendingApprovalCount ? `Tổng ${money(data.pendingApprovalAmount)}` : 'Không có phiếu nào đang chờ'} />
              <Kpi label="Phiếu nháp hoặc bị từ chối của bạn" value={String(data.myDraftCount)} hint="Cần sửa và gửi duyệt" />
            </div>

            {showMoney ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <Card title="Dòng tiền 6 tháng gần nhất"><CashflowChart points={data.cashflow} /></Card>
                <Card title="Số dư tài khoản" action={<button type="button" className="text-xs font-medium text-link hover:underline" onClick={() => router.push('/accounts')}>Xem tất cả</button>}>
                  {data.accounts.length ? (
                    <ul className="divide-y divide-slate-100">
                      {data.accounts.map((account) => (
                        <li key={account.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                          <span className="min-w-0 truncate">{account.name}</span>
                          <span className="text-right">
                            <span className={cn('font-semibold tabular-nums', (account.balance ?? 0) < 0 && 'text-red-600')}>{money(account.balance)}</span>
                            {account.pendingOut ? <span className="block text-xs text-amber-700">Chờ chi {money(account.pendingOut)}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState>Chưa có tài khoản nào.</EmptyState>
                  )}
                </Card>
              </div>
            ) : null}

            <Card title="Phiếu gần đây">
              {data.recent.length ? (
                <ul className="divide-y divide-slate-100">
                  {data.recent.map((voucher) => (
                    <li key={voucher.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <button type="button" className="min-w-0 text-left" onClick={() => router.push(`${FINANCE_KIND_CONFIG[voucher.kind].path}/${voucher.id}`)}>
                        <span className="font-medium text-link hover:underline">{voucher.code}</span>
                        <span className="ml-2 text-slate-600">{voucher.content}</span>
                      </button>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">{money(voucher.totalAmount)}</span>
                        <StatusBadge status={voucher.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Chưa có phiếu nào.</EmptyState>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
