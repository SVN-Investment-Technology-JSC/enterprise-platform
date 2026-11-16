'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  FINANCE_VOUCHER_KIND_LABELS,
  type FinanceApprovalBinding,
  type FinanceBindingMode,
  type FinanceCatalogs,
  type FinanceConfigAuditEntry,
  type FinancePage,
  type FinanceSettings,
  type FinanceVoucherKind,
  type SaveFinanceApprovalBindingResponse,
} from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, financePost, financePut, toQuery } from '../finance-api';
import { dateTimeVn, dateVn, money } from '../finance-format';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { EmptyState, ErrorBanner, Field } from '../ui/form-parts';
import { cn } from '../utils';

type TabId = 'receipt-reasons' | 'payment-reasons' | 'groups' | 'approval' | 'books' | 'history';

const TABS: { id: TabId; label: string }[] = [
  { id: 'receipt-reasons', label: 'Lý do thu' },
  { id: 'payment-reasons', label: 'Lý do chi' },
  { id: 'groups', label: 'Đối tượng thu chi' },
  { id: 'approval', label: 'Quy trình duyệt' },
  { id: 'books', label: 'Khoá sổ và duyệt' },
  { id: 'history', label: 'Lịch sử thay đổi' },
];

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** Chỉ lý do thu/chi: bắt buộc chọn dự án khi dùng lý do này. */
  requireProject?: boolean;
}

interface CatalogForm {
  code: string;
  name: string;
  isActive: boolean;
  requireProject: boolean;
}

/** Danh mục dùng chung một giao diện: mã, tên, trạng thái; tạo mới và sửa trong hộp thoại, ngừng dùng thay cho xoá. */
function CatalogPanel({
  title,
  rows,
  basePath,
  extra,
  supportsProject,
  onChanged,
}: {
  title: string;
  rows: CatalogRow[];
  basePath: string;
  /** Danh mục lý do: có ô "Bắt buộc chọn dự án". */
  supportsProject?: boolean;
  /** Trường cố định thêm vào mỗi lần lưu (ví dụ loại lý do). */
  extra?: Record<string, unknown>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CatalogRow | 'new' | null>(null);
  const [form, setForm] = useState<CatalogForm>({ code: '', name: '', isActive: true, requireProject: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(row: CatalogRow | 'new') {
    setForm(
      row === 'new'
        ? { code: '', name: '', isActive: true, requireProject: false }
        : { code: row.code, name: row.name, isActive: row.isActive, requireProject: Boolean(row.requireProject) },
    );
    setError(null);
    setEditing(row);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { requireProject, ...rest } = form;
    const body = { ...rest, ...(supportsProject ? { requireProject } : {}), ...extra };
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
              {supportsProject ? <th className="font-medium">Dự án</th> : null}
              <th className="font-medium">Trạng thái</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-50">
                <td className="py-1.5 font-mono text-xs">{row.code}</td>
                <td>{row.name}</td>
                {supportsProject ? <td className="text-xs text-slate-600">{row.requireProject ? 'Bắt buộc chọn' : '—'}</td> : null}
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
              {supportsProject ? (
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.requireProject} onChange={(e) => setForm({ ...form, requireProject: e.target.checked })} className="mt-0.5 size-4 rounded border-slate-300" />
                  <span>
                    Bắt buộc chọn dự án
                    <span className="block text-xs text-slate-500">Phiếu dùng lý do này phải hạch toán cho một dự án mới gửi duyệt và ghi sổ được (ví dụ lý do "Chi theo dự án").</span>
                  </span>
                </label>
              ) : null}
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

const MODE_OPTIONS: { value: FinanceBindingMode; label: string }[] = [
  { value: 'DIRECT', label: 'Duyệt trực tiếp (người có quyền duyệt)' },
  { value: 'PROCEDURE', label: 'Duyệt qua quy trình (Procedure)' },
];

/** Mỗi loại phiếu chọn cách duyệt: trực tiếp bởi người có quyền, hoặc chạy theo một quy trình đã công bố trong Procedure. */
function ApprovalPanel() {
  const [bindings, setBindings] = useState<FinanceApprovalBinding[] | null>(null);
  const [definitions, setDefinitions] = useState<{ id: string; code: string; name: string }[] | null>(null);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<FinanceVoucherKind, { mode: FinanceBindingMode; definitionId: string }>>>({});
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
                    onChange={(mode) => mode && setDraft({ ...draft, [binding.kind]: { ...value, mode: mode as FinanceBindingMode } })}
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
  const [requireAllocation, setRequireAllocation] = useState(Boolean(settings.requireAllocation));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await financePut<FinanceSettings>('/settings', {
        booksLockedUntil: lock || null,
        allowSelfApproval: selfApproval,
        requireAllocation,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason('');
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
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={requireAllocation} onChange={(e) => setRequireAllocation(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300" />
        <span>
          Bắt buộc hạch toán dự án cho mọi phiếu thu/chi
          <span className="block text-xs text-slate-500">Bật thì mọi phiếu thu/chi phải chọn dự án mới gửi duyệt và ghi sổ được, kể cả phiếu từ hồ sơ Quy trình. Muốn chỉ bắt buộc với một số khoản, để tắt ở đây và bật "Bắt buộc chọn dự án" ở từng lý do thu/chi (mục Lý do thu, Lý do chi). Mặc định tắt.</span>
        </span>
      </label>
      <Field label="Lý do thay đổi" hint="Không bắt buộc; ghi vào lịch sử thay đổi cấu hình.">
        {(id) => <Input id={id} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Button type="button" disabled={saving} onClick={() => void save()}>Lưu cấu hình</Button>
    </section>
  );
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  allowSelfApproval: 'Cho phép tự duyệt',
  booksLockedUntil: 'Khoá sổ đến ngày',
  requireAllocation: 'Bắt buộc hạch toán dự án',
  code: 'Mã tài khoản',
  name: 'Tên tài khoản',
  accountType: 'Loại tài khoản',
  bankName: 'Ngân hàng',
  accountNumber: 'Số tài khoản',
  accountHolder: 'Chủ tài khoản',
  branch: 'Chi nhánh',
  openingBalance: 'Số dư đầu kỳ',
  openingDate: 'Ngày bắt đầu sử dụng',
  allowNegative: 'Cho phép số dư âm',
  isActive: 'Đang hoạt động',
  note: 'Ghi chú',
};

const AUDIT_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'SETTINGS', label: 'Cấu hình chung' },
  { value: 'ACCOUNT', label: 'Tài khoản' },
];

/** Giá trị lịch sử (chữ) về dạng đọc được theo trường. */
function auditValueText(field: string, value: string | null): string {
  if (value === null) return '(trống)';
  if (value === 'true') return 'Có';
  if (value === 'false') return 'Không';
  if (field === 'openingBalance') return money(Number(value));
  if (field === 'booksLockedUntil' || field === 'openingDate') return dateVn(value);
  return value;
}

const AUDIT_PAGE_SIZE = 50;

/** Lịch sử đổi cấu hình chung và tài khoản (chỉ người có `finance.settings.manage` mở được trang Tùy chỉnh). */
function HistoryPanel() {
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FinancePage<FinanceConfigAuditEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    financeFetch<FinancePage<FinanceConfigAuditEntry>>(
      `/settings/audit${toQuery({ entityType: filter === 'ALL' ? undefined : filter, page, pageSize: AUDIT_PAGE_SIZE })}`,
    )
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(financeErrorMessage(e, 'Không tải được lịch sử thay đổi.')));
    return () => {
      alive = false;
    };
  }, [filter, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section aria-label="Lịch sử thay đổi" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Đối tượng</span>
        <div className="w-48">
          <SearchableSelect
            name="audit-filter"
            options={AUDIT_FILTER_OPTIONS}
            value={filter}
            onChange={(v) => {
              setFilter(v || 'ALL');
              setPage(1);
            }}
            height={32}
          />
        </div>
        {data ? <span className="ml-auto text-sm text-slate-500">{data.total} thay đổi</span> : null}
      </div>
      <ErrorBanner message={error} />
      {data && !data.items.length ? <EmptyState>Chưa có thay đổi nào được ghi lại.</EmptyState> : null}
      {data && data.items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                <th className="px-2 py-2">Thời điểm</th>
                <th className="px-2 py-2">Người sửa</th>
                <th className="px-2 py-2">Đối tượng</th>
                <th className="px-2 py-2">Trường</th>
                <th className="px-2 py-2">Giá trị cũ</th>
                <th className="px-2 py-2">Giá trị mới</th>
                <th className="px-2 py-2">Lý do</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{dateTimeVn(row.createdAt)}</td>
                  <td className="px-2 py-2">{row.actorName ?? '--'}</td>
                  <td className="px-2 py-2">{row.entityType === 'SETTINGS' ? 'Cấu hình chung' : `Tài khoản ${row.entityLabel ?? ''}`.trim()}</td>
                  <td className="px-2 py-2">{AUDIT_FIELD_LABELS[row.field] ?? row.field}</td>
                  <td className="px-2 py-2 text-slate-600">{auditValueText(row.field, row.oldValue)}</td>
                  <td className="px-2 py-2 font-medium text-slate-900">{auditValueText(row.field, row.newValue)}</td>
                  <td className="px-2 py-2 text-slate-600">{row.reason ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trang trước</Button>
          <span className="text-slate-600">Trang {page}/{pages}</span>
          <Button type="button" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Trang sau</Button>
        </div>
      ) : null}
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
              <CatalogPanel title="Lý do thu" rows={catalogs.reasons.filter((r) => r.kind === 'RECEIPT')} basePath="/catalogs/reasons" supportsProject extra={{ kind: 'RECEIPT' }} onChanged={() => void load()} />
            ) : null}
            {tab === 'payment-reasons' ? (
              <CatalogPanel title="Lý do chi" rows={catalogs.reasons.filter((r) => r.kind === 'PAYMENT')} basePath="/catalogs/reasons" supportsProject extra={{ kind: 'PAYMENT' }} onChanged={() => void load()} />
            ) : null}
            {tab === 'groups' ? <CatalogPanel title="Đối tượng thu chi" rows={catalogs.counterpartyGroups} basePath="/catalogs/counterparty-groups" onChanged={() => void load()} /> : null}
            {tab === 'approval' ? <ApprovalPanel /> : null}
            {tab === 'books' ? <BooksPanel settings={settings} onSaved={setSettings} /> : null}
            {tab === 'history' ? <HistoryPanel /> : null}
          </>
        ) : !error ? (
          <div role="status" className="p-6 text-sm text-slate-500">Đang tải cấu hình…</div>
        ) : null}
      </div>
    </div>
  );
}
