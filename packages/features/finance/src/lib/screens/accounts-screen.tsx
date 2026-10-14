'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Download, Pencil, Plus, RefreshCw } from 'lucide-react';
import { Drawer, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  FINANCE_ACCOUNT_TYPE_LABELS,
  FINANCE_BANKS,
  type FinanceAccount,
  type FinanceAccountType,
  type FinanceLedgerEntry,
  type FinancePage,
  type SaveFinanceAccountRequest,
} from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, financePost, financePut, toQuery } from '../finance-api';
import { buildCsv, downloadCsv } from '../finance-csv';
import { dateVn, money, todayVn } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { useFinancePermissions } from '../finance-permissions';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { ErrorBanner, Field, MoneyInput } from '../ui/form-parts';
import { cn } from '../utils';

interface AccountForm {
  code: string;
  name: string;
  accountType: FinanceAccountType;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  branch: string;
  openingBalance: number;
  openingDate: string;
  allowNegative: boolean;
  isActive: boolean;
  note: string;
}

const blank = (): AccountForm => ({
  code: '',
  name: '',
  accountType: 'BANK',
  bankName: '',
  accountNumber: '',
  accountHolder: '',
  branch: '',
  openingBalance: 0,
  openingDate: todayVn(),
  allowNegative: false,
  isActive: true,
  note: '',
});

const toForm = (a: FinanceAccount): AccountForm => ({
  code: a.code,
  name: a.name,
  accountType: a.accountType,
  bankName: a.bankName ?? '',
  accountNumber: a.accountNumber ?? '',
  accountHolder: a.accountHolder ?? '',
  branch: a.branch ?? '',
  openingBalance: a.openingBalance,
  openingDate: a.openingDate,
  allowNegative: a.allowNegative,
  isActive: a.isActive,
  note: a.note ?? '',
});

const hasMovements = (a: FinanceAccount) => (a.totalReceipts ?? 0) > 0 || (a.totalPayments ?? 0) > 0;

const typeOptions = (Object.keys(FINANCE_ACCOUNT_TYPE_LABELS) as FinanceAccountType[]).map((value) => ({ value, label: FINANCE_ACCOUNT_TYPE_LABELS[value] }));
const bankOptions = FINANCE_BANKS.map((bank) => ({ value: bank, label: bank }));

export default function AccountsScreen() {
  const router = useRouter();
  const { capabilities } = useFinancePermissions();
  const canManage = Boolean(capabilities?.canManageAccounts);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinanceAccount | 'new' | null>(null);
  const [ledgerFor, setLedgerFor] = useState<FinanceAccount | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await financeFetch<FinanceAccount[]>(`/accounts${toQuery({ includeInactive: showInactive })}`));
      setError(null);
    } catch (e) {
      setError(financeErrorMessage(e, 'Không tải được danh sách tài khoản.'));
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const openVouchers = (kind: 'RECEIPT' | 'PAYMENT' | 'TRANSFER', account: FinanceAccount) =>
    router.push(`${FINANCE_KIND_CONFIG[kind].path}${toQuery({ accountId: account.id, month: 'all' })}`);

  const count = (value: number | null, kind: 'RECEIPT' | 'PAYMENT' | 'TRANSFER', account: FinanceAccount) =>
    value ? (
      <button type="button" onClick={() => openVouchers(kind, account)} className="font-medium text-link tabular-nums hover:underline" aria-label={`${value} ${FINANCE_KIND_CONFIG[kind].singular} của ${account.name}`}>
        {value}
      </button>
    ) : (
      <span className="tabular-nums text-slate-500">{value ?? '-'}</span>
    );

  const columns: ColumnsType<FinanceAccount> = [
    {
      title: 'Tên tài khoản',
      key: 'name',
      width: 300,
      render: (_: unknown, a) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{a.name}</div>
          <div className="truncate text-xs text-slate-500">{a.accountType === 'CASH' ? 'Tiền mặt' : a.accountNumber}</div>
          {a.accountType === 'BANK' && a.bankName ? <div className="truncate text-xs text-slate-500">{a.bankName}</div> : null}
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'isActive',
      width: 110,
      render: (active: boolean) => (
        <span className={cn('inline-flex h-5 items-center rounded px-2 text-xs font-medium', active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
          {active ? 'Hoạt động' : 'Ngừng dùng'}
        </span>
      ),
    },
    { title: 'Phiếu thu', dataIndex: 'receiptCount', width: 90, align: 'center', render: (v: number | null, a) => count(v, 'RECEIPT', a) },
    { title: 'Phiếu chi', dataIndex: 'paymentCount', width: 90, align: 'center', render: (v: number | null, a) => count(v, 'PAYMENT', a) },
    { title: 'Phiếu chuyển tiền', dataIndex: 'transferCount', width: 130, align: 'center', render: (v: number | null, a) => count(v, 'TRANSFER', a) },
    { title: 'Số dư đầu kỳ', dataIndex: 'openingBalance', width: 140, align: 'right', render: (v: number) => <span className="tabular-nums">{v ? money(v) : '--'}</span> },
    { title: 'Tiền thu', dataIndex: 'totalReceipts', width: 140, align: 'right', render: (v: number | null) => <span className="tabular-nums">{money(v)}</span> },
    { title: 'Tiền chi', dataIndex: 'totalPayments', width: 140, align: 'right', render: (v: number | null) => <span className="tabular-nums">{money(v)}</span> },
    {
      title: 'Tổng tiền',
      dataIndex: 'balance',
      width: 150,
      align: 'right',
      render: (v: number | null, a) => (
        <div>
          <span className={cn('font-semibold tabular-nums', (v ?? 0) < 0 && 'text-red-600')}>{money(v)}</span>
          {a.pendingOut ? <div className="text-xs text-amber-700">Chờ chi {money(a.pendingOut)}</div> : null}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, a) => (
        <div className="flex gap-1">
          <button type="button" aria-label={`Sổ tài khoản ${a.name}`} title="Sổ tài khoản" onClick={() => setLedgerFor(a)} className="flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">
            <BookOpen className="size-4" aria-hidden />
          </button>
          {canManage ? (
            <button type="button" aria-label={`Sửa ${a.name}`} title="Sửa" onClick={() => setEditing(a)} className="flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">
              <Pencil className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  function exportCsv() {
    downloadCsv(
      `tai-khoan-${todayVn()}`,
      buildCsv([
        ['Tên tài khoản', 'Loại', 'Số tài khoản', 'Ngân hàng', 'Trạng thái', 'Phiếu thu', 'Phiếu chi', 'Phiếu chuyển tiền', 'Số dư đầu kỳ', 'Tiền thu', 'Tiền chi', 'Tổng tiền'],
        ...accounts.map((a) => [a.name, FINANCE_ACCOUNT_TYPE_LABELS[a.accountType], a.accountNumber ?? '', a.bankName ?? '', a.isActive ? 'Hoạt động' : 'Ngừng dùng', a.receiptCount ?? '', a.paymentCount ?? '', a.transferCount ?? '', a.openingBalance, a.totalReceipts ?? '', a.totalPayments ?? '', a.balance ?? '']),
      ]),
    );
  }

  const totalBalance = useMemo(() => accounts.filter((a) => a.isActive).reduce((sum, a) => sum + (a.balance ?? 0), 0), [accounts]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Danh sách tài khoản</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 rounded border-slate-300" />
            Hiện tài khoản ngừng dùng
          </label>
          <Button type="button" variant="outline" onClick={() => void load()}><RefreshCw aria-hidden /> Làm mới</Button>
          <Button type="button" variant="outline" disabled={!accounts.length} onClick={exportCsv}><Download aria-hidden /> Xuất Excel</Button>
          {canManage ? <Button type="button" onClick={() => setEditing('new')}><Plus aria-hidden /> Thêm tài khoản</Button> : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <ErrorBanner message={error} />
          <p className="mb-2 text-sm text-slate-600">
            Hiển thị {accounts.length} bản ghi. Tổng số dư các tài khoản đang hoạt động:{' '}
            <span className="font-semibold tabular-nums text-slate-900">{money(totalBalance)}</span>
          </p>
          <Table<FinanceAccount>
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={accounts}
            pagination={false}
            scroll={{ x: 1250 }}
            locale={{ emptyText: loading ? 'Đang tải…' : 'Chưa có tài khoản nào.' }}
          />
        </div>
      </div>

      {editing ? (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      {ledgerFor ? <LedgerDrawer account={ledgerFor} onClose={() => setLedgerFor(null)} /> : null}
    </div>
  );
}

function AccountDialog({ account, onClose, onSaved }: { account: FinanceAccount | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AccountForm>(account ? toForm(account) : blank());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = account ? hasMovements(account) : false;
  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const bank = form.accountType === 'BANK';

  async function submit() {
    setSaving(true);
    setError(null);
    const body: SaveFinanceAccountRequest = {
      code: form.code,
      name: form.name,
      accountType: form.accountType,
      bankName: bank ? form.bankName : null,
      accountNumber: bank ? form.accountNumber : null,
      accountHolder: bank ? form.accountHolder : null,
      branch: bank ? form.branch : null,
      allowNegative: form.allowNegative,
      isActive: form.isActive,
      note: form.note || null,
      ...(locked ? {} : { openingBalance: form.openingBalance, openingDate: form.openingDate }),
    };
    try {
      if (account) await financePut(`/accounts/${account.id}`, body);
      else await financePost('/accounts', body);
      toast.success(account ? 'Đã cập nhật tài khoản' : 'Đã thêm tài khoản');
      onSaved();
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="border-b border-slate-100 px-5 py-4">
          <DialogTitle>{account ? 'Sửa tài khoản' : 'Thêm tài khoản'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <ErrorBanner message={error} />
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Mã tài khoản" required>{(id) => <Input id={id} value={form.code} maxLength={50} onChange={(e) => set('code', e.target.value)} />}</Field>
            <Field label="Loại tài khoản" required>
              {(id) => <SearchableSelect name={id} options={typeOptions} value={form.accountType} onChange={(v) => v && set('accountType', v as AccountFormType)} height={32} disabled={locked} />}
            </Field>
            <Field label="Tên tài khoản" required className="sm:col-span-2">{(id) => <Input id={id} value={form.name} maxLength={255} onChange={(e) => set('name', e.target.value)} />}</Field>
            {bank ? (
              <>
                <Field label="Ngân hàng" required>
                  {(id) => <SearchableSelect name={id} options={bankOptions} value={form.bankName} onChange={(v) => set('bankName', v)} placeholder="Chọn ngân hàng" clearable height={32} />}
                </Field>
                <Field label="Số tài khoản" required>{(id) => <Input id={id} value={form.accountNumber} maxLength={60} onChange={(e) => set('accountNumber', e.target.value)} />}</Field>
                <Field label="Chủ tài khoản">{(id) => <Input id={id} value={form.accountHolder} maxLength={255} onChange={(e) => set('accountHolder', e.target.value)} />}</Field>
                <Field label="Chi nhánh">{(id) => <Input id={id} value={form.branch} maxLength={255} onChange={(e) => set('branch', e.target.value)} />}</Field>
              </>
            ) : null}
            <Field label="Số dư đầu kỳ" hint={locked ? 'Tài khoản đã có bút toán nên không đổi được.' : undefined}>
              {(id) => <MoneyInput id={id} value={form.openingBalance} disabled={locked} allowNegative onChange={(v) => set('openingBalance', v)} />}
            </Field>
            <Field label="Ngày bắt đầu sử dụng" hint={locked ? 'Tài khoản đã có bút toán nên không đổi được.' : 'Phiếu có ngày hạch toán trước ngày này không được ghi sổ.'}>
              {(id) => <DatePickerInput id={id} value={form.openingDate} onChange={(v) => set('openingDate', v)} disabled={locked} />}
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.allowNegative} onChange={(e) => set('allowNegative', e.target.checked)} className="size-4 rounded border-slate-300" />
              Cho phép số dư âm (thấu chi)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4 rounded border-slate-300" />
              Đang hoạt động
            </label>
            <Field label="Ghi chú" className="sm:col-span-2">{(id) => <Input id={id} value={form.note} maxLength={2000} onChange={(e) => set('note', e.target.value)} />}</Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Hủy bỏ</Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>{account ? 'Cập nhật' : 'Thêm tài khoản'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AccountFormType = FinanceAccountType;

function LedgerDrawer({ account, onClose }: { account: FinanceAccount; onClose: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(FinancePage<FinanceLedgerEntry> & { openingBalance: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    financeFetch<FinancePage<FinanceLedgerEntry> & { openingBalance: number }>(`/accounts/${account.id}/ledger${toQuery({ from, to, page, pageSize: 20 })}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((e) => active && setError(financeErrorMessage(e, 'Không tải được sổ tài khoản.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [account.id, from, to, page]);

  const columns: ColumnsType<FinanceLedgerEntry> = [
    { title: 'Ngày', dataIndex: 'postedDate', width: 100, render: (v: string) => dateVn(v) },
    {
      title: 'Phiếu',
      dataIndex: 'voucherCode',
      render: (code: string, row) => (
        <button type="button" className="font-medium text-link hover:underline" onClick={() => router.push(`${FINANCE_KIND_CONFIG[row.voucherKind].path}/${row.voucherId}`)}>
          {code}
          {row.isReversal ? <span className="ml-1 text-xs text-red-600">(đảo)</span> : null}
        </button>
      ),
    },
    {
      title: 'Phát sinh',
      dataIndex: 'amount',
      align: 'right',
      width: 130,
      render: (v: number) => <span className={cn('tabular-nums', v < 0 ? 'text-red-600' : 'text-emerald-700')}>{v > 0 ? '+' : ''}{money(v)}</span>,
    },
    { title: 'Số dư sau', dataIndex: 'balanceAfter', align: 'right', width: 130, render: (v: number) => <span className="tabular-nums">{money(v)}</span> },
  ];

  return (
    <Drawer open onClose={onClose} size={680} title={`Sổ tài khoản: ${account.name}`} destroyOnHidden>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-36"><DatePickerInput aria-label="Từ ngày" value={from} onChange={(v) => { setFrom(v); setPage(1); }} placeholder="Từ ngày" /></div>
        <div className="w-36"><DatePickerInput aria-label="Đến ngày" value={to} onChange={(v) => { setTo(v); setPage(1); }} placeholder="Đến ngày" /></div>
        <span className="ml-auto text-sm text-slate-600">Số dư đầu kỳ: <span className="font-semibold tabular-nums">{money(data?.openingBalance ?? account.openingBalance)}</span></span>
      </div>
      <ErrorBanner message={error} />
      <Table<FinanceLedgerEntry>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data?.items ?? []}
        locale={{ emptyText: 'Chưa có bút toán nào.' }}
        pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
      />
    </Drawer>
  );
}
