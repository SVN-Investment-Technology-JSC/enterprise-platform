'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  FINANCE_VOUCHER_KIND_LABELS,
  type FinanceApprovalBinding,
  type FinanceApprovalMode,
  type FinanceCatalogs,
  type FinanceSettings,
  type FinanceVoucherKind,
  type SaveFinanceApprovalBindingResponse,
} from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, financePost, financePut } from '../finance-api';
import { dateVn } from '../finance-format';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { EmptyState, ErrorBanner, Field } from '../ui/form-parts';
import { cn } from '../utils';

type TabId = 'receipt-reasons' | 'payment-reasons' | 'groups' | 'cost-centers' | 'approval' | 'books';

const TABS: { id: TabId; label: string }[] = [
  { id: 'receipt-reasons', label: 'Lý do thu' },
  { id: 'payment-reasons', label: 'Lý do chi' },
  { id: 'groups', label: 'Đối tượng thu chi' },
  { id: 'cost-centers', label: 'Hạch toán nội bộ' },
  { id: 'approval', label: 'Quy trình duyệt' },
  { id: 'books', label: 'Khoá sổ và duyệt' },
];

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface CatalogForm {
  code: string;
  name: string;
  isActive: boolean;
}

/** Danh mục dùng chung một giao diện: mã, tên, trạng thái; tạo mới và sửa trong hộp thoại, ngừng dùng thay cho xoá. */
function CatalogPanel({
  title,
  rows,
  basePath,
  extra,
  onChanged,
}: {
  title: string;
  rows: CatalogRow[];
  basePath: string;
  /** Trường cố định thêm vào mỗi lần lưu (ví dụ loại lý do). */
  extra?: Record<string, unknown>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CatalogRow | 'new' | null>(null);
  const [form, setForm] = useState<CatalogForm>({ code: '', name: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(row: CatalogRow | 'new') {
    setForm(row === 'new' ? { code: '', name: '', isActive: true } : { code: row.code, name: row.name, isActive: row.isActive });
    setError(null);
    setEditing(row);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const body = { ...form, ...extra };
    try {
      if (editing && editing !== 'new') await financePut(`${basePath}/${editing.id}`, body);
      else await financePost(basePath, body);
      toast.success('Đã lưu');
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <Button type="button" size="sm" onClick={() => open('new')}><Plus aria-hidden /> Thêm</Button>
      </div>
      {rows.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="py-1.5 font-medium">Mã</th>
              <th className="font-medium">Tên</th>
              <th className="font-medium">Trạng thái</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-50">
                <td className="py-1.5 font-mono text-xs">{row.code}</td>
                <td>{row.name}</td>
                <td>
                  <span className={cn('inline-flex h-5 items-center rounded px-2 text-xs font-medium', row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                    {row.isActive ? 'Đang dùng' : 'Ngừng dùng'}
                  </span>
                </td>
                <td>
                  <button type="button" aria-label={`Sửa ${row.name}`} onClick={() => open(row)} className="flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">
                    <Pencil className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState>Chưa có mục nào. Chọn Thêm để tạo mục đầu tiên.</EmptyState>
      )}

      {editing ? (
        <Dialog open onOpenChange={(next) => !next && setEditing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader className="border-b border-slate-100 px-5 py-4">
              <DialogTitle>{editing === 'new' ? `Thêm: ${title}` : `Sửa: ${title}`}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 px-5 py-4">
              <ErrorBanner message={error} />
              <Field label="Mã" required>{(id) => <Input id={id} value={form.code} maxLength={50} onChange={(e) => setForm({ ...form, code: e.target.value })} />}</Field>
              <Field label="Tên" required>{(id) => <Input id={id} value={form.name} maxLength={255} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="size-4 rounded border-slate-300" />
                Đang dùng
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Hủy bỏ</Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>Lưu</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

const MODE_OPTIONS: { value: FinanceApprovalMode; label: string }[] = [
  { value: 'DIRECT', label: 'Duyệt trực tiếp (người có quyền duyệt)' },
  { value: 'PROCEDURE', label: 'Duyệt qua quy trình (Procedure)' },
];

/** Mỗi loại phiếu chọn cách duyệt: trực tiếp bởi người có quyền, hoặc chạy theo một quy trình đã công bố trong Procedure. */
function ApprovalPanel() {
  const [bindings, setBindings] = useState<FinanceApprovalBinding[] | null>(null);
  const [definitions, setDefinitions] = useState<{ id: string; code: string; name: string }[] | null>(null);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<FinanceVoucherKind, { mode: FinanceApprovalMode; definitionId: string }>>>({});
  const [warnings, setWarnings] = useState<Partial<Record<FinanceVoucherKind, string[]>>>({});
  const [savingKind, setSavingKind] = useState<FinanceVoucherKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    financeFetch<FinanceApprovalBinding[]>('/approval-bindings')
      .then((result) => active && setBindings(result))
      .catch((e) => active && setError(financeErrorMessage(e, 'Không tải được cấu hình duyệt.')));
    financeFetch<{ id: string; code: string; name: string }[]>('/approval-bindings/procedure-definitions')
      .then((result) => active && setDefinitions(result))
      .catch((e) => active && setDefinitionsError(financeErrorMessage(e, 'Không tải được danh sách quy trình.')));
    return () => {
      active = false;
    };
  }, []);

  if (!bindings) return error ? <ErrorBanner message={error} /> : <div role="status" className="p-6 text-sm text-slate-500">Đang tải cấu hình duyệt…</div>;

  const valueOf = (binding: FinanceApprovalBinding) => draft[binding.kind] ?? { mode: binding.mode, definitionId: binding.procedureDefinitionId ?? '' };
  const options = (binding: FinanceApprovalBinding) => {
    const list = (definitions ?? []).map((d) => ({ value: d.id, label: d.name, description: d.code }));
    // Quy trình đang gán nhưng đã không còn trong danh sách công bố: vẫn hiện để người dùng thấy đang dùng gì.
    if (binding.procedureDefinitionId && !list.some((o) => o.value === binding.procedureDefinitionId))
      list.unshift({ value: binding.procedureDefinitionId, label: binding.procedureDefinitionName ?? 'Quy trình đã gán', description: 'Không còn công bố' });
    return list;
  };

  async function save(binding: FinanceApprovalBinding) {
    const value = valueOf(binding);
    setSavingKind(binding.kind);
    setError(null);
    try {
      const result = await financePut<SaveFinanceApprovalBindingResponse>(`/approval-bindings/${binding.kind}`, {
        mode: value.mode,
        procedureDefinitionId: value.mode === 'PROCEDURE' ? value.definitionId || null : null,
      });
      setBindings((current) => (current ?? []).map((b) => (b.kind === binding.kind ? result.binding : b)));
      setDraft((current) => {
        const next = { ...current };
        delete next[binding.kind];
        return next;
      });
      setWarnings((current) => ({ ...current, [binding.kind]: result.warnings }));
      toast.success(`Đã lưu cách duyệt ${FINANCE_VOUCHER_KIND_LABELS[binding.kind].toLowerCase()}`);
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSavingKind(null);
    }
  }

  return (
    <section aria-label="Quy trình duyệt" className="space-y-3">
      <p className="text-sm text-slate-600">
        Chọn cách duyệt cho từng loại phiếu. Duyệt qua quy trình thì người duyệt do quy trình quyết định và tiền chỉ được ghi sổ khi quy trình hoàn tất.
        Phiếu đã gửi duyệt giữ nguyên cách duyệt lúc gửi.
      </p>
      <ErrorBanner message={error} />
      {definitionsError ? <p role="status" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{definitionsError}</p> : null}
      {bindings.map((binding) => {
        const value = valueOf(binding);
        const dirty = value.mode !== binding.mode || (value.mode === 'PROCEDURE' && value.definitionId !== (binding.procedureDefinitionId ?? ''));
        const invalid = value.mode === 'PROCEDURE' && !value.definitionId;
        return (
          <div key={binding.kind} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44 text-sm font-semibold text-slate-900">{FINANCE_VOUCHER_KIND_LABELS[binding.kind]}</div>
              <Field label="Cách duyệt" className="w-72">
                {(id) => (
                  <SearchableSelect
                    name={id}
                    options={MODE_OPTIONS}
                    value={value.mode}
                    onChange={(mode) => mode && setDraft({ ...draft, [binding.kind]: { ...value, mode: mode as FinanceApprovalMode } })}
                    height={32}
                  />
                )}
              </Field>
              {value.mode === 'PROCEDURE' ? (
                <Field label="Quy trình" className="w-80">
                  {(id) => (
                    <SearchableSelect
                      name={id}
                      options={options(binding)}
                      value={value.definitionId}
                      onChange={(definitionId) => setDraft({ ...draft, [binding.kind]: { ...value, definitionId } })}
                      placeholder="Chọn quy trình đã công bố"
                      clearable
                      height={32}
                    />
                  )}
                </Field>
              ) : null}
              <Button type="button" disabled={!dirty || invalid || savingKind === binding.kind} onClick={() => void save(binding)}>
                Lưu
              </Button>
            </div>
            {warnings[binding.kind]?.length ? (
              <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
                {warnings[binding.kind]?.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      <p className="text-xs text-slate-500">
        Quy trình có thể dùng các thuộc tính do phiếu tự điền: so_tien, noi_dung, ma_phieu, loai_phieu, ly_do, tai_khoan, tai_khoan_dich, doi_tuong,
        nguoi_nop_nhan, hach_toan_noi_bo, ngay_hach_toan, ngay_lap (đúng kiểu dữ liệu). Thuộc tính bắt buộc khác sẽ không được chấp nhận. Có thể dùng số tiền để
        rẽ nhánh thêm cấp duyệt cho phiếu lớn.
      </p>
    </section>
  );
}

function BooksPanel({ settings, onSaved }: { settings: FinanceSettings; onSaved: (next: FinanceSettings) => void }) {
  const [lock, setLock] = useState(settings.booksLockedUntil ?? '');
  const [selfApproval, setSelfApproval] = useState(settings.allowSelfApproval);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await financePut<FinanceSettings>('/settings', { booksLockedUntil: lock || null, allowSelfApproval: selfApproval });
      onSaved(next);
      toast.success('Đã lưu cấu hình');
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Khoá sổ và duyệt" className="max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <ErrorBanner message={error} />
      <Field
        label="Khoá sổ đến ngày"
        hint={
          settings.booksLockedUntil
            ? `Hiện đang khoá đến ${dateVn(settings.booksLockedUntil)}. Phiếu có ngày hạch toán từ ngày này trở về trước không được duyệt; huỷ phiếu đã ghi sổ ghi bút toán đảo vào kỳ đang mở.`
            : 'Chưa khoá sổ. Sau khi chốt kỳ kế toán, chọn ngày cuối kỳ để không ai ghi thêm vào kỳ đã chốt.'
        }
      >
        {(id) => (
          <div className="w-44">
            <DatePickerInput id={id} value={lock} onChange={setLock} placeholder="Chưa khoá" />
          </div>
        )}
      </Field>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={selfApproval} onChange={(e) => setSelfApproval(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300" />
        <span>
          Cho phép người lập tự duyệt phiếu của mình
          <span className="block text-xs text-slate-500">Mặc định tắt để tách người lập và người duyệt. Chỉ bật cho doanh nghiệp nhỏ chỉ có một kế toán.</span>
        </span>
      </label>
      <Button type="button" disabled={saving} onClick={() => void save()}>Lưu cấu hình</Button>
    </section>
  );
}

export default function SettingsScreen() {
  const [tab, setTab] = useState<TabId>('receipt-reasons');
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([financeFetch<FinanceCatalogs>('/catalogs?includeInactive=true'), financeFetch<FinanceSettings>('/settings')]);
      setCatalogs(c);
      setSettings(s);
      setError(null);
    } catch (e) {
      setError(financeErrorMessage(e, 'Không tải được cấu hình.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Tùy chỉnh</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4">
        <div role="tablist" aria-label="Nhóm cấu hình" className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn('border-b-2 px-3 py-2 text-sm', tab === item.id ? 'border-accent-strong font-semibold text-accent-text' : 'border-transparent text-slate-600 hover:text-slate-900')}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ErrorBanner message={error} />
        {catalogs && settings ? (
          <>
            {tab === 'receipt-reasons' ? (
              <CatalogPanel title="Lý do thu" rows={catalogs.reasons.filter((r) => r.kind === 'RECEIPT')} basePath="/catalogs/reasons" extra={{ kind: 'RECEIPT' }} onChanged={() => void load()} />
            ) : null}
            {tab === 'payment-reasons' ? (
              <CatalogPanel title="Lý do chi" rows={catalogs.reasons.filter((r) => r.kind === 'PAYMENT')} basePath="/catalogs/reasons" extra={{ kind: 'PAYMENT' }} onChanged={() => void load()} />
            ) : null}
            {tab === 'groups' ? <CatalogPanel title="Đối tượng thu chi" rows={catalogs.counterpartyGroups} basePath="/catalogs/counterparty-groups" onChanged={() => void load()} /> : null}
            {tab === 'cost-centers' ? <CatalogPanel title="Hạch toán nội bộ" rows={catalogs.costCenters} basePath="/catalogs/cost-centers" onChanged={() => void load()} /> : null}
            {tab === 'approval' ? <ApprovalPanel /> : null}
            {tab === 'books' ? <BooksPanel settings={settings} onSaved={setSettings} /> : null}
          </>
        ) : !error ? (
          <div role="status" className="p-6 text-sm text-slate-500">Đang tải cấu hình…</div>
        ) : null}
      </div>
    </div>
  );
}
