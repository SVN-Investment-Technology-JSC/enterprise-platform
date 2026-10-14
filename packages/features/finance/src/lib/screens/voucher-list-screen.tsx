'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Plus, RefreshCw, Search } from 'lucide-react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  FINANCE_VOUCHER_STATUSES,
  FINANCE_VOUCHER_STATUS_LABELS,
  type FinanceAccount,
  type FinanceCatalogs,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceVoucherStatus,
  type FinanceVoucherSummary,
} from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, toQuery } from '../finance-api';
import { buildCsv, downloadCsv } from '../finance-csv';
import { dateVn, money, voucherCsvRows } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { useFinancePermissions } from '../finance-permissions';
import { Button } from '../ui/button';
import { Avatar, ErrorBanner, StatusBadge } from '../ui/form-parts';
import { cn } from '../utils';

type Scope = 'all' | 'mine' | 'to-approve';

export default function VoucherListScreen({ kind }: { kind: FinanceVoucherKind }) {
  const config = FINANCE_KIND_CONFIG[kind];
  const router = useRouter();
  const params = useSearchParams();
  const { capabilities } = useFinancePermissions();
  const kindCaps = capabilities?.[kind === 'RECEIPT' ? 'receipt' : kind === 'PAYMENT' ? 'payment' : 'transfer'];

  const [status, setStatus] = useState<FinanceVoucherStatus | ''>('');
  const [scope, setScope] = useState<Scope>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [accountId, setAccountId] = useState(params.get('accountId') ?? '');
  const [reasonId, setReasonId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<FinanceVoucherList | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    void Promise.all([financeFetch<FinanceAccount[]>('/accounts'), financeFetch<FinanceCatalogs>('/catalogs')])
      .then(([loadedAccounts, loadedCatalogs]) => {
        if (!active) return;
        setAccounts(loadedAccounts);
        setCatalogs(loadedCatalogs);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setLoading(true);
    try {
      const result = await financeFetch<FinanceVoucherList>(
        `/vouchers${toQuery({ kind, status, scope: scope === 'all' ? undefined : scope, search: debouncedSearch, accountId, reasonId, from, to, page, pageSize })}`,
      );
      if (mine !== sequence.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mine === sequence.current) setError(financeErrorMessage(e, 'Không tải được danh sách.'));
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [kind, status, scope, debouncedSearch, accountId, reasonId, from, to, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // Đổi bộ lọc thì về trang 1.
  const filter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const accountOptions = useMemo(() => accounts.map((a) => ({ value: a.id, label: a.name })), [accounts]);
  const reasonOptions = useMemo(
    () => (catalogs?.reasons ?? []).filter((r) => r.kind === kind).map((r) => ({ value: r.id, label: r.name })),
    [catalogs, kind],
  );

  const total = data ? Object.values(data.statusCounts).reduce((sum, n) => sum + n, 0) : 0;

  const columns: ColumnsType<FinanceVoucherSummary> = [
    {
      title: 'Người tạo',
      dataIndex: 'createdByName',
      width: 96,
      align: 'center',
      render: (name: string | null) => <Avatar name={name} />,
    },
    {
      title: config.codeLabel,
      dataIndex: 'code',
      width: 170,
      render: (code: string, row) => (
        <a
          href={`${config.path}/${row.id}`}
          className="font-medium text-link hover:underline"
          onClick={(event) => {
            event.preventDefault();
            router.push(`${config.path}/${row.id}`);
          }}
        >
          {code}
        </a>
      ),
    },
    { title: config.dateLabel, dataIndex: 'voucherDate', width: 110, render: (value: string) => dateVn(value) },
    { title: config.contentLabel, dataIndex: 'content', ellipsis: true },
    kind === 'TRANSFER'
      ? {
          title: 'Từ tài khoản → Đến tài khoản',
          key: 'accounts',
          width: 260,
          ellipsis: true,
          render: (_: unknown, row: FinanceVoucherSummary) => `${row.accountName ?? ''} → ${row.destAccountName ?? ''}`,
        }
      : { title: config.reasonLabel, dataIndex: 'reasonName', width: 180, ellipsis: true },
    ...(kind === 'TRANSFER'
      ? []
      : [
          { title: 'Tài khoản', dataIndex: 'accountName', width: 180, ellipsis: true },
          { title: config.counterpartyLabel, dataIndex: 'counterpartyGroupName', width: 140, ellipsis: true },
        ]),
    {
      title: 'Số tiền',
      dataIndex: 'totalAmount',
      width: 140,
      align: 'right',
      render: (value: number) => <span className="tabular-nums font-medium">{money(value)}</span>,
    },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (value: FinanceVoucherStatus) => <StatusBadge status={value} /> },
  ];

  const scopes: { id: Scope; label: string; visible: boolean }[] = [
    { id: 'all', label: 'Tất cả phiếu', visible: true },
    { id: 'mine', label: 'Của tôi', visible: true },
    { id: 'to-approve', label: 'Chờ tôi duyệt', visible: Boolean(kindCaps?.approve) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">{config.listTitle}</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" aria-label="Làm mới" onClick={() => void load()}>
            <RefreshCw aria-hidden /> Làm mới
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!data?.items.length}
            onClick={() => downloadCsv(`${config.singular.replace(/\s+/g, '-')}-${dateVn(new Date().toISOString().slice(0, 10)).replace(/\//g, '-')}`, buildCsv(voucherCsvRows(data?.items ?? [])))}
          >
            <Download aria-hidden /> Xuất Excel
          </Button>
          {kindCaps?.create ? (
            <Button type="button" onClick={() => router.push(`${config.path}/new`)}>
              <Plus aria-hidden /> Tạo mới
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div role="tablist" aria-label="Trạng thái phiếu" className="flex flex-wrap gap-1 border-b border-slate-100 px-3 pt-2">
            {[{ id: '' as const, label: 'Tất cả', count: total }, ...FINANCE_VOUCHER_STATUSES.map((s) => ({ id: s, label: FINANCE_VOUCHER_STATUS_LABELS[s], count: data?.statusCounts[s] ?? 0 }))].map((tab) => (
              <button
                key={tab.id || 'all'}
                role="tab"
                type="button"
                aria-selected={status === tab.id}
                onClick={() => {
                  setStatus(tab.id);
                  setPage(1);
                }}
                className={cn(
                  'border-b-2 px-3 py-2 text-sm',
                  status === tab.id ? 'border-accent-strong font-semibold text-accent-text' : 'border-transparent text-slate-600 hover:text-slate-900',
                )}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-400" aria-hidden />
              <input
                aria-label="Tìm phiếu"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Tìm mã phiếu, nội dung, người tạo"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pr-2 pl-8 text-sm outline-none focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent-soft"
              />
            </div>
            <div className="w-52">
              <SearchableSelect options={accountOptions} value={accountId} onChange={filter(setAccountId)} placeholder="Mọi tài khoản" clearable height={32} />
            </div>
            {kind !== 'TRANSFER' ? (
              <div className="w-52">
                <SearchableSelect options={reasonOptions} value={reasonId} onChange={filter(setReasonId)} placeholder={`Mọi ${config.reasonLabel.toLowerCase()}`} clearable height={32} />
              </div>
            ) : null}
            <div className="w-36">
              <DatePickerInput aria-label="Từ ngày" value={from} onChange={filter(setFrom)} placeholder="Từ ngày" />
            </div>
            <div className="w-36">
              <DatePickerInput aria-label="Đến ngày" value={to} onChange={filter(setTo)} placeholder="Đến ngày" />
            </div>
            <div className="ml-auto flex gap-1">
              {scopes
                .filter((s) => s.visible)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={scope === s.id}
                    onClick={() => {
                      setScope(s.id);
                      setPage(1);
                    }}
                    className={cn('rounded-full border px-3 py-1 text-xs', scope === s.id ? 'border-accent-strong bg-accent-soft text-accent-text' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                  >
                    {s.label}
                  </button>
                ))}
            </div>
          </div>

          <div className="p-3">
            <ErrorBanner message={error} />
            <Table<FinanceVoucherSummary>
              size="small"
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={data?.items ?? []}
              scroll={{ x: 1100 }}
              locale={{ emptyText: loading ? 'Đang tải…' : `Chưa có ${config.singular} nào phù hợp.` }}
              pagination={{
                current: page,
                pageSize,
                total: status ? (data?.statusCounts[status] ?? 0) : total,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: (count, range) => `Hiển thị ${range[0]}-${range[1]} / ${count} bản ghi`,
                onChange: (nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                },
              }}
              onRow={(row) => ({ onDoubleClick: () => router.push(`${config.path}/${row.id}`) })}
            />
            {data ? (
              <p className="mt-1 text-right text-xs text-slate-500">
                Tổng tiền các phiếu đã duyệt trong bộ lọc: <span className="font-semibold tabular-nums text-slate-800">{money(data.approvedTotal)}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
