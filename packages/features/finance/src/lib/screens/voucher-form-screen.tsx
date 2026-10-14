'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  FINANCE_BANKS,
  financeIncludedTax,
  financeLineTotal,
  financeLinesTotal,
  type FinanceAccount,
  type FinanceCatalogs,
  type FinanceVoucher,
  type FinanceVoucherAttachment,
  type FinanceVoucherKind,
  type SaveFinanceVoucherRequest,
} from '@enterprise-platform/contracts-finance';
import { removeFinanceAttachment, uploadFinanceAttachment } from '../attachment-upload';
import { financeErrorMessage, financeFetch, financePost, financePut, toQuery } from '../finance-api';
import { useFinanceCrumbs } from '../finance-crumbs';
import { money, todayVn } from '../finance-format';
import { FINANCE_KIND_CONFIG } from '../finance-kinds';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { AttachmentsField } from '../ui/attachments-field';
import { ErrorBanner, Field, FormSection, MoneyInput } from '../ui/form-parts';

interface LineState {
  key: number;
  description: string;
  quantity: number;
  unitAmount: number;
}
interface InvoiceState {
  key: number;
  invoiceNo: string;
  invoiceDate: string;
  taxCode: string;
  amount: number;
}
interface RelatedState {
  key: number;
  label: string;
}

interface FormState {
  voucherDate: string;
  postingDate: string;
  content: string;
  reasonId: string;
  accountId: string;
  destAccountId: string;
  counterpartyGroupId: string;
  counterpartyName: string;
  counterpartyAccountNo: string;
  counterpartyBank: string;
  costCenterId: string;
  taxIncluded: boolean;
  taxRate: number;
  note: string;
  amount: number;
  lines: LineState[];
  invoices: InvoiceState[];
  related: RelatedState[];
}

let keySeed = 0;
const nextKey = () => (keySeed += 1);
const blankLine = (): LineState => ({ key: nextKey(), description: '', quantity: 1, unitAmount: 0 });

function emptyState(): FormState {
  const today = todayVn();
  return {
    voucherDate: today,
    postingDate: today,
    content: '',
    reasonId: '',
    accountId: '',
    destAccountId: '',
    counterpartyGroupId: '',
    counterpartyName: '',
    counterpartyAccountNo: '',
    counterpartyBank: '',
    costCenterId: '',
    taxIncluded: false,
    taxRate: 0,
    note: '',
    amount: 0,
    lines: [blankLine()],
    invoices: [],
    related: [],
  };
}

function fromVoucher(voucher: FinanceVoucher): FormState {
  return {
    voucherDate: voucher.voucherDate,
    postingDate: voucher.postingDate,
    content: voucher.content,
    reasonId: voucher.reasonId ?? '',
    accountId: voucher.accountId ?? '',
    destAccountId: voucher.destAccountId ?? '',
    counterpartyGroupId: voucher.counterpartyGroupId ?? '',
    counterpartyName: voucher.counterpartyName ?? '',
    counterpartyAccountNo: voucher.counterpartyAccountNo ?? '',
    counterpartyBank: voucher.counterpartyBank ?? '',
    costCenterId: voucher.costCenterId ?? '',
    taxIncluded: voucher.taxIncluded,
    taxRate: voucher.taxRate,
    note: voucher.note ?? '',
    amount: voucher.kind === 'TRANSFER' ? voucher.totalAmount : 0,
    lines: voucher.lines.length
      ? voucher.lines.map((line) => ({ key: nextKey(), description: line.description, quantity: line.quantity, unitAmount: line.unitAmount }))
      : [blankLine()],
    invoices: voucher.invoices.map((invoice) => ({
      key: nextKey(),
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate ?? '',
      taxCode: invoice.taxCode ?? '',
      amount: invoice.amount,
    })),
    related: voucher.related.filter((r) => r.kind === 'REFERENCE').map((r) => ({ key: nextKey(), label: r.label })),
  };
}

/** Dữ liệu gửi lên server; server tính lại thành tiền và tổng. */
export function buildRequest(kind: FinanceVoucherKind, form: FormState, revision?: number): SaveFinanceVoucherRequest {
  const base: SaveFinanceVoucherRequest = {
    kind,
    voucherDate: form.voucherDate,
    postingDate: form.postingDate,
    content: form.content,
    accountId: form.accountId || null,
    note: form.note || null,
    related: form.related.filter((r) => r.label.trim()).map((r) => ({ kind: 'REFERENCE' as const, label: r.label.trim() })),
    revision,
  };
  if (kind === 'TRANSFER') return { ...base, destAccountId: form.destAccountId || null, amount: form.amount };
  return {
    ...base,
    reasonId: form.reasonId || null,
    counterpartyGroupId: form.counterpartyGroupId || null,
    counterpartyName: form.counterpartyName || null,
    counterpartyAccountNo: form.counterpartyAccountNo || null,
    counterpartyBank: form.counterpartyBank || null,
    costCenterId: form.costCenterId || null,
    taxIncluded: form.taxIncluded,
    taxRate: form.taxIncluded ? form.taxRate : 0,
    lines: form.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      total: financeLineTotal(line.quantity, line.unitAmount),
    })),
    invoices: form.invoices
      .filter((invoice) => invoice.invoiceNo.trim())
      .map((invoice) => ({ invoiceNo: invoice.invoiceNo, invoiceDate: invoice.invoiceDate || null, taxCode: invoice.taxCode || null, amount: invoice.amount })),
  };
}

export default function VoucherFormScreen({ kind, id }: { kind: FinanceVoucherKind; id?: string }) {
  const config = FINANCE_KIND_CONFIG[kind];
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyState);
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [code, setCode] = useState('');
  const [revision, setRevision] = useState<number | undefined>();
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [savedFiles, setSavedFiles] = useState<FinanceVoucherAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useFinanceCrumbs([config.singular.replace(/^./, (c) => c.toUpperCase()), id ? 'Sửa phiếu' : 'Tạo mới']);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [loadedCatalogs, loadedAccounts] = await Promise.all([
          financeFetch<FinanceCatalogs>('/catalogs'),
          financeFetch<FinanceAccount[]>('/accounts'),
        ]);
        if (!active) return;
        setCatalogs(loadedCatalogs);
        setAccounts(loadedAccounts);
        if (id) {
          const voucher = await financeFetch<FinanceVoucher>(`/vouchers/${id}`);
          if (!active) return;
          setForm(fromVoucher(voucher));
          setCode(voucher.code);
          setRevision(voucher.revision);
          setLocked(!voucher.permissions.canEdit);
          setSavedFiles(voucher.attachments);
        } else {
          const next = await financeFetch<{ code: string }>(`/vouchers/next-code${toQuery({ kind, date: todayVn() })}`);
          if (active) setCode(next.code);
        }
      } catch (e) {
        if (active) setError(financeErrorMessage(e, 'Không tải được dữ liệu.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, kind]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const patchLine = (key: number, patch: Partial<LineState>) =>
    setForm((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));

  const reasonOptions = useMemo(
    () => (catalogs?.reasons ?? []).filter((r) => r.kind === kind && r.isActive).map((r) => ({ value: r.id, label: r.name })),
    [catalogs, kind],
  );
  const groupOptions = useMemo(() => (catalogs?.counterpartyGroups ?? []).filter((g) => g.isActive).map((g) => ({ value: g.id, label: g.name })), [catalogs]);
  const centerOptions = useMemo(() => (catalogs?.costCenters ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name })), [catalogs]);
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.isActive)
        .map((a) => ({
          value: a.id,
          label: a.name,
          description: [a.accountType === 'CASH' ? 'Quỹ tiền mặt' : a.accountNumber, a.balance === null ? null : `Số dư ${money(a.balance)}`].filter(Boolean).join(' · '),
        })),
    [accounts],
  );
  const bankOptions = useMemo(() => FINANCE_BANKS.map((bank) => ({ value: bank, label: bank })), []);

  const total = config.hasLines ? financeLinesTotal(form.lines) : form.amount;
  const includedTax = form.taxIncluded ? financeIncludedTax(total, form.taxRate) : 0;

  /**
   * Lưu phiếu, tải các tệp đang chờ, rồi (nếu yêu cầu) gửi duyệt. Tệp phải lên TRƯỚC khi gửi duyệt vì phiếu đã gửi duyệt
   * không còn nhận tệp. Tải tệp lỗi thì dừng tại form (phiếu đã lưu, tệp lỗi còn trong danh sách để thử lại) và không gửi duyệt.
   */
  async function save(andSubmit: boolean) {
    setSaving(true);
    setError(null);
    const body = buildRequest(kind, form, revision);
    try {
      const saved = savedId
        ? await financePut<FinanceVoucher>(`/vouchers/${savedId}`, body)
        : await financePost<FinanceVoucher>('/vouchers', body);
      setSavedId(saved.id);
      setRevision(saved.revision);

      const failed: { file: File; message: string }[] = [];
      const uploaded: FinanceVoucherAttachment[] = [];
      for (const file of pendingFiles) {
        try {
          uploaded.push(await uploadFinanceAttachment(saved.id, file));
        } catch (e) {
          failed.push({ file, message: financeErrorMessage(e, `${file.name}: không tải lên được.`) });
        }
      }
      if (uploaded.length) setSavedFiles((current) => [...current, ...uploaded]);
      setPendingFiles(failed.map((item) => item.file));
      if (failed.length) {
        setError(`Phiếu ${saved.code} đã được lưu nhưng ${failed.length} tệp chưa tải lên được:\n${failed.map((item) => item.message).join('\n')}`);
        return;
      }

      if (andSubmit) {
        await financePost<FinanceVoucher>(`/vouchers/${saved.id}/submit`);
        toast.success(`Đã gửi duyệt ${saved.code}`);
      } else {
        toast.success(`Đã lưu ${saved.code}`);
      }
      router.push(`${config.path}/${saved.id}`);
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeSaved(file: FinanceVoucherAttachment) {
    if (!savedId) return;
    try {
      await removeFinanceAttachment(savedId, file.id);
      setSavedFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (e) {
      setError(financeErrorMessage(e));
    }
  }

  if (loading) return <div role="status" className="p-8 text-sm text-slate-500">Đang tải biểu mẫu…</div>;
  if (locked)
    return (
      <div role="alert" className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Phiếu này không còn sửa được (đã gửi duyệt hoặc đã xử lý).{' '}
        <button type="button" className="font-semibold underline" onClick={() => router.push(`${config.path}/${id}`)}>
          Xem phiếu
        </button>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">{id ? `Sửa ${config.singular}` : config.createTitle}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white px-5 shadow-sm">
          <ErrorBanner message={error} />

          <FormSection title="Thông tin chung">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={config.codeLabel}>{(fieldId) => <Input id={fieldId} value={code} disabled readOnly />}</Field>
              <Field label={config.dateLabel} required>
                {(fieldId) => <DatePickerInput id={fieldId} value={form.voucherDate} onChange={(value) => set('voucherDate', value)} />}
              </Field>
              <Field label="Ngày hạch toán" required>
                {(fieldId) => <DatePickerInput id={fieldId} value={form.postingDate} onChange={(value) => set('postingDate', value)} />}
              </Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={config.contentLabel} required className="sm:col-span-2">
                {(fieldId) => <Input id={fieldId} value={form.content} placeholder={config.contentPlaceholder} maxLength={500} onChange={(e) => set('content', e.target.value)} />}
              </Field>

              {config.hasLines ? (
                <>
                  <Field label={config.reasonLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={reasonOptions} value={form.reasonId} onChange={(v) => set('reasonId', v)} placeholder={`Chọn ${config.reasonLabel.toLowerCase()}`} clearable height={32} />}
                  </Field>
                  <Field label={config.accountLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={accountOptions} value={form.accountId} onChange={(v) => set('accountId', v)} placeholder={`Chọn ${config.accountLabel.toLowerCase()}`} clearable height={32} />}
                  </Field>
                  <Field label={config.counterpartyLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={groupOptions} value={form.counterpartyGroupId} onChange={(v) => set('counterpartyGroupId', v)} placeholder={`Chọn ${config.counterpartyLabel.toLowerCase()}`} clearable height={32} />}
                  </Field>
                  <Field label={config.personLabel}>
                    {(fieldId) => <Input id={fieldId} value={form.counterpartyName} maxLength={255} onChange={(e) => set('counterpartyName', e.target.value)} />}
                  </Field>
                  <Field label={config.personAccountLabel}>
                    {(fieldId) => <Input id={fieldId} value={form.counterpartyAccountNo} maxLength={60} onChange={(e) => set('counterpartyAccountNo', e.target.value)} />}
                  </Field>
                  <Field label={config.personBankLabel}>
                    {(fieldId) => <SearchableSelect name={fieldId} options={bankOptions} value={form.counterpartyBank} onChange={(v) => set('counterpartyBank', v)} placeholder="Chọn ngân hàng" clearable height={32} />}
                  </Field>
                  <Field label="Hạch toán nội bộ">
                    {(fieldId) => <SearchableSelect name={fieldId} options={centerOptions} value={form.costCenterId} onChange={(v) => set('costCenterId', v)} placeholder="Chọn đơn vị hạch toán" clearable height={32} />}
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Số tiền" required>{(fieldId) => <MoneyInput id={fieldId} value={form.amount} onChange={(v) => set('amount', v)} />}</Field>
                  <span className="hidden sm:block" />
                  <Field label={config.accountLabel} required>
                    {(fieldId) => <SearchableSelect name={fieldId} options={accountOptions} value={form.accountId} onChange={(v) => set('accountId', v)} placeholder="Chọn tài khoản nguồn" clearable height={32} />}
                  </Field>
                  <Field label="Tài khoản đích" required>
                    {(fieldId) => (
                      <SearchableSelect name={fieldId} options={accountOptions.filter((o) => o.value !== form.accountId)} value={form.destAccountId} onChange={(v) => set('destAccountId', v)} placeholder="Chọn tài khoản đích" clearable height={32} />
                    )}
                  </Field>
                </>
              )}
            </div>
          </FormSection>

          {config.hasLines ? (
            <>
              <FormSection title={config.detailTitle}>
                <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.taxIncluded} onChange={(e) => set('taxIncluded', e.target.checked)} className="size-4 rounded border-slate-300" />
                  Bao gồm thuế
                  {form.taxIncluded ? (
                    <span className="ml-3 flex items-center gap-1 text-xs text-slate-600">
                      Thuế suất
                      <input
                        aria-label="Thuế suất (%)"
                        inputMode="decimal"
                        value={form.taxRate || ''}
                        onChange={(e) => set('taxRate', Math.min(100, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)))}
                        className="h-7 w-16 rounded-md border border-slate-200 px-2 text-right"
                      />
                      %
                    </span>
                  ) : null}
                </label>

                <div role="table" aria-label="Chi tiết" className="grid gap-2">
                  <div role="row" className="hidden grid-cols-[1fr_90px_150px_150px_28px] gap-2 px-1 text-xs font-medium text-slate-500 sm:grid">
                    <span>Diễn giải <span className="text-red-500">*</span></span>
                    <span>Số lượng <span className="text-red-500">*</span></span>
                    <span>Số tiền <span className="text-red-500">*</span></span>
                    <span>Tổng tiền</span>
                    <span />
                  </div>
                  {form.lines.map((line, index) => (
                    <div role="row" key={line.key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_90px_150px_150px_28px]">
                      <Input aria-label={`Diễn giải dòng ${index + 1}`} className="col-span-2 sm:col-span-1" placeholder={config.lineDescriptionPlaceholder} value={line.description} maxLength={500} onChange={(e) => patchLine(line.key, { description: e.target.value })} />
                      <input
                        aria-label={`Số lượng dòng ${index + 1}`}
                        inputMode="decimal"
                        value={line.quantity || ''}
                        onChange={(e) => patchLine(line.key, { quantity: Number(e.target.value.replace(',', '.')) || 0 })}
                        className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-right text-sm"
                      />
                      <MoneyInput aria-label={`Số tiền dòng ${index + 1}`} value={line.unitAmount} onChange={(v) => patchLine(line.key, { unitAmount: v })} />
                      <div aria-label={`Thành tiền dòng ${index + 1}`} className="flex h-8 items-center justify-end rounded-lg bg-slate-50 px-2.5 text-sm tabular-nums text-slate-700">
                        {money(financeLineTotal(line.quantity, line.unitAmount))}
                      </div>
                      <button
                        type="button"
                        aria-label={`Xoá dòng ${index + 1}`}
                        disabled={form.lines.length === 1}
                        onClick={() => set('lines', form.lines.filter((l) => l.key !== line.key))}
                        className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Button type="button" variant="outline" size="sm" onClick={() => set('lines', [...form.lines, blankLine()])}>
                    <Plus aria-hidden /> Thêm dòng
                  </Button>
                  <div className="text-right text-sm">
                    <div className="font-semibold text-slate-900">Tổng tiền: <span data-testid="voucher-total" className="tabular-nums">{money(total)}</span></div>
                    {form.taxIncluded ? <div className="text-xs text-slate-500">Trong đó thuế: {money(includedTax)}</div> : null}
                  </div>
                </div>
              </FormSection>

              <FormSection title="Hóa đơn" defaultOpen={form.invoices.length > 0}>
                <div className="grid gap-2">
                  {form.invoices.map((invoice, index) => (
                    <div key={invoice.key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_150px_150px_150px_28px]">
                      <Input aria-label={`Số hoá đơn ${index + 1}`} placeholder="Số hóa đơn" value={invoice.invoiceNo} onChange={(e) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, invoiceNo: e.target.value } : i)))} />
                      <DatePickerInput aria-label={`Ngày hoá đơn ${index + 1}`} value={invoice.invoiceDate} onChange={(v) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, invoiceDate: v } : i)))} />
                      <Input aria-label={`Mã số thuế hoá đơn ${index + 1}`} placeholder="Mã số thuế" value={invoice.taxCode} onChange={(e) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, taxCode: e.target.value } : i)))} />
                      <MoneyInput aria-label={`Số tiền hoá đơn ${index + 1}`} value={invoice.amount} onChange={(v) => set('invoices', form.invoices.map((i) => (i.key === invoice.key ? { ...i, amount: v } : i)))} />
                      <button type="button" aria-label={`Xoá hoá đơn ${index + 1}`} onClick={() => set('invoices', form.invoices.filter((i) => i.key !== invoice.key))} className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set('invoices', [...form.invoices, { key: nextKey(), invoiceNo: '', invoiceDate: '', taxCode: '', amount: 0 }])}>
                  <Plus aria-hidden /> Thêm hóa đơn
                </Button>
              </FormSection>
            </>
          ) : null}

          <FormSection title="Đính kèm">
            <AttachmentsField
              voucherId={savedId}
              saved={savedFiles}
              pending={pendingFiles}
              disabled={saving}
              onAdd={(files) => setPendingFiles((current) => [...current, ...files])}
              onRemovePending={(index) => setPendingFiles((current) => current.filter((_, i) => i !== index))}
              onRemoveSaved={(file) => void removeSaved(file)}
              onProblem={setError}
            />
          </FormSection>

          <FormSection title="Ghi chú">
            <textarea
              aria-label="Ghi chú"
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Nhập ghi chú"
              className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent-soft"
            />
          </FormSection>

          <FormSection title="Đối tượng liên quan" defaultOpen={form.related.length > 0}>
            <div className="grid gap-2">
              {form.related.map((related, index) => (
                <div key={related.key} className="grid grid-cols-[1fr_28px] items-center gap-2">
                  <Input aria-label={`Đối tượng liên quan ${index + 1}`} placeholder="Hợp đồng, dự án, đơn hàng liên quan" value={related.label} maxLength={255} onChange={(e) => set('related', form.related.map((r) => (r.key === related.key ? { ...r, label: e.target.value } : r)))} />
                  <button type="button" aria-label={`Xoá đối tượng liên quan ${index + 1}`} onClick={() => set('related', form.related.filter((r) => r.key !== related.key))} className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set('related', [...form.related, { key: nextKey(), label: '' }])}>
              <Plus aria-hidden /> Thêm đối tượng liên quan
            </Button>
          </FormSection>
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button type="button" disabled={saving} onClick={() => void save(false)}>Lưu nháp</Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => void save(true)}>Lưu và gửi duyệt</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => router.push(config.path)}>Hủy bỏ</Button>
      </footer>
    </div>
  );
}
