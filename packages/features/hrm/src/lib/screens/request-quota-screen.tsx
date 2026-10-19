'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmRequestQuotaSettings } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { InfoNote } from '../ui/settings-kit';
import { toast } from '../ui/toast';

const MAX_LIMIT = 1000;

/** Giá trị ô nhập: rỗng là không giới hạn, ngược lại phải là số nguyên 1..1000. Trả về thông báo lỗi hoặc null. */
export function quotaInputError(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) return 'Nhập số nguyên dương hoặc để trống';
  const n = Number(text);
  return n < 1 || n > MAX_LIMIT ? `Hạn mức từ 1 đến ${MAX_LIMIT}` : null;
}

const toDraft = (limit: number | null) => (limit === null ? '' : String(limit));

/**
 * Hạn mức số đơn được duyệt mỗi tháng của một nhân viên, đặt riêng cho từng loại đơn. Để trống là không giới hạn. Đủ hạn
 * mức thì nhân viên không tạo thêm đơn loại đó, và đơn đang chờ duyệt của tháng đó cũng không duyệt được nữa.
 */
export default function RequestQuotaScreen() {
  const [saved, setSaved] = useState<HrmRequestQuotaSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((settings: HrmRequestQuotaSettings) => {
    setSaved(settings);
    setDrafts(Object.fromEntries(settings.items.map((item) => [item.typeCode, toDraft(item.monthlyLimit)])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      apply((await hrmFetch<{ data: HrmRequestQuotaSettings }>('/request-quota-settings')).data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được hạn mức đơn');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(
    () => (saved?.items ?? []).filter((item) => (drafts[item.typeCode] ?? '').trim() !== toDraft(item.monthlyLimit)),
    [saved, drafts],
  );
  const invalid = changed.some((item) => quotaInputError(drafts[item.typeCode] ?? ''));

  async function save() {
    if (invalid) {
      toast.error('Có hạn mức chưa hợp lệ');
      return;
    }
    setBusy(true);
    try {
      const res = await hrmFetch<{ data: HrmRequestQuotaSettings }>('/request-quota-settings', {
        method: 'PUT',
        body: JSON.stringify({
          items: changed.map((item) => {
            const text = (drafts[item.typeCode] ?? '').trim();
            return { typeCode: item.typeCode, monthlyLimit: text ? Number(text) : null };
          }),
        }),
      });
      apply(res.data);
      toast.success('Đã lưu hạn mức đơn');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được hạn mức đơn');
    } finally {
      setBusy(false);
    }
  }

  const notReady = saved !== null && !saved.ready;

  return (
    <div className="space-y-4" data-testid="request-quota">
      <PageTitle
        title="Hạn mức đơn"
        description="Giới hạn số đơn được duyệt mỗi tháng của một nhân viên, đặt riêng cho từng loại đơn."
      />

      <InfoNote>
        Chỉ tính đơn đã được duyệt, theo tháng tạo đơn. Khi đã đủ hạn mức, nhân viên không tạo thêm đơn loại đó trong tháng
        và các đơn cũ đang chờ duyệt của tháng đó sẽ không duyệt được nữa. Loại đơn để trống hạn mức là không giới hạn.
      </InfoNote>

      {error ? (
        <InfoNote tone="red" role="alert">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Tải lại
          </button>
        </InfoNote>
      ) : null}

      {notReady ? (
        <InfoNote tone="amber" role="alert">
          Cơ sở dữ liệu HRM chưa được cập nhật cho tính năng này (migration 0064-hrm-request-quota-settings). Quản trị cần chạy
          migration trước khi đặt hạn mức.
        </InfoNote>
      ) : null}

      <section aria-label="Hạn mức theo loại đơn" className="rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
              <th className="px-4 py-2">Loại đơn</th>
              <th className="w-56 px-4 py-2">Số đơn được duyệt tối đa mỗi tháng</th>
            </tr>
          </thead>
          <tbody>
            {(saved?.items ?? []).map((item) => {
              const value = drafts[item.typeCode] ?? '';
              const message = quotaInputError(value);
              return (
                <tr key={item.typeCode} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{item.typeName}</div>
                    <div className="text-xs text-slate-500">{item.typeCode}</div>
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      inputMode="numeric"
                      aria-label={`Hạn mức tháng của ${item.typeName}`}
                      aria-invalid={message ? true : undefined}
                      placeholder="Không giới hạn"
                      value={value}
                      disabled={loading || busy || notReady}
                      onChange={(e) => setDrafts((current) => ({ ...current, [item.typeCode]: e.target.value }))}
                    />
                    {message ? <div className="mt-1 text-xs text-rose-600">{message}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center gap-2 border-t border-slate-200 p-4">
          <Button
            type="button"
            disabled={busy || loading || notReady || changed.length === 0 || invalid}
            onClick={() => void save()}
          >
            Lưu hạn mức
          </Button>
        </div>
      </section>
    </div>
  );
}
