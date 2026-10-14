'use client';
import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmTimesheetStandardMode,
  HrmTimesheetStandardPolicies,
  HrmTimesheetStandardPolicy,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { InfoNote } from '../ui/settings-kit';
import { toast } from '../ui/toast';

const MODE_OPTIONS: { value: HrmTimesheetStandardMode; label: string }[] = [
  { value: 'DYNAMIC', label: 'Động theo lịch ca' },
  { value: 'FIXED', label: 'Cố định số ngày công' },
];

export interface Draft {
  effectiveMonth: string;
  mode: HrmTimesheetStandardMode;
  workdays: string;
  note: string;
}

/** Kiểm tra form ban hành trước khi gửi; trả thông báo lỗi hoặc null (khớp quy tắc của máy chủ). */
export function draftError(draft: Draft, currentMonth: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.effectiveMonth)) return 'Chọn tháng bắt đầu áp dụng';
  if (draft.effectiveMonth < currentMonth) return 'Tháng áp dụng không được ở quá khứ';
  if (draft.mode === 'DYNAMIC') return null;
  const n = Number(draft.workdays);
  if (!draft.workdays.trim() || !Number.isFinite(n) || n < 1 || n > 31 || Math.round(n * 2) !== n * 2)
    return 'Công chuẩn cố định phải từ 1 đến 31 ngày, bước 0,5';
  return null;
}

const monthLabel = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

/** Số tháng cho chọn, tính từ tháng hiện tại (không ban hành vào quá khứ). */
const MONTH_OPTION_COUNT = 24;

/** Các tháng cho chọn dạng "Tháng 10/2026", từ tháng hiện tại trở đi. */
export function monthOptions(currentMonth: string, count = MONTH_OPTION_COUNT): { value: string; label: string }[] {
  const match = /^(\d{4})-(\d{2})$/.exec(currentMonth);
  if (!match) return [];
  const start = Number(match[1]) * 12 + Number(match[2]) - 1;
  return Array.from({ length: count }, (_, i) => {
    const index = start + i;
    const year = Math.floor(index / 12);
    const month = String((index % 12) + 1).padStart(2, '0');
    return { value: `${year}-${month}`, label: `Tháng ${Number(month)}/${year}` };
  });
}
const modeText = (p: HrmTimesheetStandardPolicy) =>
  p.mode === 'FIXED' ? `Cố định ${p.workdays} ngày công` : 'Động theo lịch ca';

type PolicyState = 'current' | 'upcoming' | 'replaced';

/**
 * Chính sách công chuẩn của bảng công: mỗi chính sách có hiệu lực từ một tháng đến khi có chính sách mới thay thế.
 * Động: tổng sức chứa công của các ngày có ca (ca sáng T7 là 0,5); cố định: số ngày công nhập tay.
 * Tách khỏi công chuẩn trong chính sách lương (chỉ dùng cho tính lương).
 */
export default function TimesheetStandardScreen() {
  const [data, setData] = useState<HrmTimesheetStandardPolicies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({ effectiveMonth: '', mode: 'DYNAMIC', workdays: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hrmFetch<{ data: HrmTimesheetStandardPolicies }>('/timesheet-standards');
      setData(res.data);
      setDraft((current) => ({ ...current, effectiveMonth: current.effectiveMonth || res.data.currentMonth }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được chính sách công chuẩn');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentMonth = data?.currentMonth ?? '';
  const stateOf = (p: HrmTimesheetStandardPolicy): PolicyState =>
    p.id === data?.currentId ? 'current' : p.effectiveMonth > currentMonth ? 'upcoming' : 'replaced';

  async function issue() {
    const invalid = draftError(draft, currentMonth);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setBusy(true);
    try {
      await hrmFetch('/timesheet-standards', {
        method: 'POST',
        body: JSON.stringify({
          effectiveMonth: draft.effectiveMonth,
          mode: draft.mode,
          workdays: draft.mode === 'FIXED' ? Number(draft.workdays) : undefined,
          note: draft.note,
        }),
      });
      toast.success(`Đã ban hành chính sách công chuẩn từ tháng ${monthLabel(draft.effectiveMonth)}`);
      setDraft({ effectiveMonth: currentMonth, mode: 'DYNAMIC', workdays: '', note: '' });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không ban hành được chính sách');
    } finally {
      setBusy(false);
    }
  }

  async function remove(policy: HrmTimesheetStandardPolicy) {
    setBusy(true);
    try {
      await hrmFetch(`/timesheet-standards/${policy.id}`, { method: 'DELETE' });
      toast.success(`Đã xóa chính sách áp dụng từ tháng ${monthLabel(policy.effectiveMonth)}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xóa được chính sách');
    } finally {
      setBusy(false);
    }
  }

  const policies = data?.policies ?? [];
  const hasCurrent = Boolean(data?.currentId);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Công chuẩn của bảng công"
        description="Chính sách có hiệu lực từ tháng ban hành đến khi có chính sách mới thay thế. Cấu hình công chuẩn trong chính sách lương chỉ dùng để tính lương."
      />

      <InfoNote>
        <strong>Động theo lịch ca:</strong> công chuẩn của mỗi nhân viên là tổng sức chứa công của các ngày có ca trong tháng
        (ca đủ ngày là 1, ca sáng thứ Bảy 4 giờ là 0,5; ngày lễ có lịch ca vẫn tính). <strong>Cố định:</strong> mọi nhân viên
        dùng số ngày công nhập tay, ví dụ 24,5. Chưa có chính sách nào thì dùng công chuẩn động.
      </InfoNote>

      {error ? (
        <InfoNote tone="red" role="alert">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Tải lại
          </button>
        </InfoNote>
      ) : null}

      <section aria-label="Ban hành chính sách mới" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Ban hành chính sách mới</h2>
        <div className="grid gap-3 md:grid-cols-[160px_220px_150px_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1 text-xs font-medium text-slate-600">
            <span>Áp dụng từ tháng</span>
            <SearchableSelect
              value={draft.effectiveMonth}
              onChange={(v) => v && setDraft((d) => ({ ...d, effectiveMonth: v }))}
              options={monthOptions(currentMonth)}
              placeholder="Chọn tháng"
              aria-label="Tháng bắt đầu áp dụng"
            />
          </div>
          <div className="space-y-1 text-xs font-medium text-slate-600">
            <span>Cách tính</span>
            <SearchableSelect
              value={draft.mode}
              onChange={(v) => v && setDraft((d) => ({ ...d, mode: v as HrmTimesheetStandardMode }))}
              options={MODE_OPTIONS}
              aria-label="Cách tính công chuẩn"
            />
          </div>
          <label className="block space-y-1 text-xs font-medium text-slate-600">
            Số ngày công
            <Input
              type="number"
              step="0.5"
              min="1"
              max="31"
              inputMode="decimal"
              disabled={draft.mode !== 'FIXED'}
              value={draft.mode === 'FIXED' ? draft.workdays : ''}
              placeholder={draft.mode === 'FIXED' ? 'Ví dụ 24.5' : 'Theo lịch'}
              aria-label="Số ngày công chuẩn"
              onChange={(e) => setDraft((d) => ({ ...d, workdays: e.target.value }))}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium text-slate-600">
            Ghi chú
            <Input
              value={draft.note}
              maxLength={500}
              placeholder="Căn cứ ban hành (không bắt buộc)"
              aria-label="Ghi chú chính sách"
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </label>
          <Button type="button" disabled={busy || !data} onClick={() => void issue()}>
            Ban hành
          </Button>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-xs" aria-label="Các chính sách công chuẩn">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Áp dụng từ tháng</th>
              <th className="px-3 py-2">Cách tính</th>
              <th className="px-3 py-2">Ghi chú</th>
              <th className="w-36 px-3 py-2">Trạng thái</th>
              <th className="w-24 px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Đang tải…
                </td>
              </tr>
            ) : (
              <>
                {policies.map((policy) => {
                  const state = stateOf(policy);
                  return (
                    <tr key={policy.id} data-testid={`standard-policy-${policy.effectiveMonth}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-900">Tháng {monthLabel(policy.effectiveMonth)}</td>
                      <td className="px-3 py-2">{modeText(policy)}</td>
                      <td className="px-3 py-2 text-slate-600">{policy.note ?? '----'}</td>
                      <td className="px-3 py-2">
                        {state === 'current' ? (
                          <Badge className="border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Đang áp dụng</Badge>
                        ) : state === 'upcoming' ? (
                          <Badge className="border border-blue-200 bg-blue-50 text-[10px] text-blue-700">Sắp áp dụng</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-slate-500">Đã thay thế</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {state === 'upcoming' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Xóa chính sách từ tháng ${monthLabel(policy.effectiveMonth)}`}
                            onClick={() => void remove(policy)}
                          >
                            Xóa
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                <tr data-testid="standard-policy-default" className="border-t border-slate-100 bg-slate-50/60 text-slate-500">
                  <td className="px-3 py-2">Mặc định</td>
                  <td className="px-3 py-2">Động theo lịch ca</td>
                  <td className="px-3 py-2">Dùng khi chưa có chính sách nào có hiệu lực</td>
                  <td className="px-3 py-2">
                    {hasCurrent ? (
                      <Badge variant="outline" className="text-[10px] text-slate-500">Đã thay thế</Badge>
                    ) : (
                      <Badge className="border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Đang áp dụng</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
