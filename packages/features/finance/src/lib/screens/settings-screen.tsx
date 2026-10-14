'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import type { FinanceCatalogs, FinanceSettings } from '@enterprise-platform/contracts-finance';
import { financeErrorMessage, financeFetch, financePost, financePut } from '../finance-api';
import { dateVn } from '../finance-format';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { EmptyState, ErrorBanner, Field } from '../ui/form-parts';
import { cn } from '../utils';

type TabId = 'receipt-reasons' | 'payment-reasons' | 'groups' | 'cost-centers' | 'books';

const TABS: { id: TabId; label: string }[] = [
  { id: 'receipt-reasons', label: 'Lý do thu' },
  { id: 'payment-reasons', label: 'Lý do chi' },
  { id: 'groups', label: 'Đối tượng thu chi' },
  { id: 'cost-centers', label: 'Hạch toán nội bộ' },
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
            {tab === 'books' ? <BooksPanel settings={settings} onSaved={setSettings} /> : null}
          </>
        ) : !error ? (
          <div role="status" className="p-6 text-sm text-slate-500">Đang tải cấu hình…</div>
        ) : null}
      </div>
    </div>
  );
}
