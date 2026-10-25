'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmRequestTimeRule, HrmRequestTimeRules } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { InfoNote } from '../ui/settings-kit';
import { toast } from '../ui/toast';

type Field = 'minNoticeDays' | 'maxBackdateDays' | 'escalateAfterDays';

const FIELDS: readonly { field: Field; label: string; min: number; max: number; hint: string }[] = [
  { field: 'minNoticeDays', label: 'Báo trước tối thiểu (ngày)', min: 0, max: 365, hint: 'Tạo đơn trước ngày bắt đầu' },
  { field: 'maxBackdateDays', label: 'Tạo lùi tối đa (ngày)', min: 0, max: 365, hint: 'Cho ngày đã qua' },
  { field: 'escalateAfterDays', label: 'Chuyển dự phòng sau (ngày)', min: 1, max: 90, hint: 'Đơn chờ quá số ngày này' },
];

/** Kiểu đơn không có ngày bắt đầu trong tương lai nên không áp dụng báo trước. */
const NO_NOTICE = new Set(['correction', 'advance', 'profile_correction']);

/** Giá trị ô nhập: rỗng là chưa dùng, ngược lại phải là số nguyên trong khoảng. Trả về thông báo lỗi hoặc null. */
export function timeRuleInputError(value: string, min: number, max: number): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) return 'Nhập số nguyên hoặc để trống';
  const n = Number(text);
  return n < min || n > max ? `Từ ${min} đến ${max}` : null;
}

const toDraft = (value: number | null) => (value === null ? '' : String(value));
const keyOf = (kind: string, field: Field) => `${kind}:${field}`;

function draftsOf(items: readonly HrmRequestTimeRule[]): Record<string, string> {
  return Object.fromEntries(items.flatMap((item) => FIELDS.map(({ field }) => [keyOf(item.requestKind, field), toDraft(item[field])])));
}

/**
 * Quy tắc thời gian riêng cho từng loại đơn: báo trước tối thiểu, tạo lùi tối đa, chuyển cho người duyệt dự phòng sau
 * N ngày. Mọi ô để trống là chưa dùng (mặc định).
 */
export default function RequestTimeRulesScreen() {
  const [saved, setSaved] = useState<HrmRequestTimeRules | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((rules: HrmRequestTimeRules) => {
    setSaved(rules);
    setDrafts(draftsOf(rules.items));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      apply((await hrmFetch<{ data: HrmRequestTimeRules }>('/request-time-rules')).data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được quy tắc thời gian');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const changedKinds = useMemo(
    () =>
      (saved?.items ?? []).filter((item) =>
        FIELDS.some(({ field }) => (drafts[keyOf(item.requestKind, field)] ?? '').trim() !== toDraft(item[field])),
      ),
    [saved, drafts],
  );
  const invalid = changedKinds.some((item) =>
    FIELDS.some(({ field, min, max }) => timeRuleInputError(drafts[keyOf(item.requestKind, field)] ?? '', min, max)),
  );

  async function save() {
    if (invalid) {
      toast.error('Có giá trị chưa hợp lệ');
      return;
    }
    setBusy(true);
    try {
      const res = await hrmFetch<{ data: HrmRequestTimeRules }>('/request-time-rules', {
        method: 'PUT',
        body: JSON.stringify({
          items: changedKinds.map((item) => ({
            requestKind: item.requestKind,
            ...Object.fromEntries(
              FIELDS.map(({ field }) => {
                const text = (drafts[keyOf(item.requestKind, field)] ?? '').trim();
                return [field, text ? Number(text) : null];
              }),
            ),
          })),
        }),
      });
      apply(res.data);
      toast.success('Đã lưu quy tắc thời gian');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được quy tắc thời gian');
    } finally {
      setBusy(false);
    }
  }

  const notReady = saved !== null && !saved.ready;

  return (
    <div className="space-y-4" data-testid="request-time-rules">
      <PageTitle
        title="Quy tắc thời gian đơn"
        description="Báo trước, tạo lùi và chuyển người duyệt dự phòng theo số ngày, đặt riêng cho từng loại đơn."
      />

      <InfoNote>
        Ô để trống là chưa dùng quy tắc đó. Báo trước và tạo lùi tính theo ngày bắt đầu ghi trên đơn, chặn ngay lúc tạo đơn
        (kể cả đơn tạo hộ). Chuyển dự phòng: khi đặt, người giữ chức danh dự phòng chỉ được xử lý đơn sau khi đơn chờ đủ
        số ngày; không đặt thì dự phòng xử lý ngay như hiện nay.
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
          Cơ sở dữ liệu HRM chưa được cập nhật cho tính năng này (migration 0076-hrm-request-time-rules). Quản trị cần chạy
          migration trước khi đặt quy tắc.
        </InfoNote>
      ) : null}

      <section aria-label="Quy tắc thời gian theo loại đơn" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
              <th className="px-4 py-2">Loại đơn</th>
              {FIELDS.map(({ field, label }) => (
                <th key={field} className="w-48 px-4 py-2">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(saved?.items ?? []).map((item) => (
              <tr key={item.requestKind} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium text-slate-900">{item.label}</td>
                {FIELDS.map(({ field, label, min, max }) => {
                  const key = keyOf(item.requestKind, field);
                  const value = drafts[key] ?? '';
                  const message = timeRuleInputError(value, min, max);
                  const unavailable = field === 'minNoticeDays' && NO_NOTICE.has(item.requestKind);
                  return (
                    <td key={field} className="px-4 py-2 align-top">
                      <Input
                        inputMode="numeric"
                        aria-label={`${label} của ${item.label}`}
                        aria-invalid={message ? true : undefined}
                        placeholder={unavailable ? 'Không áp dụng' : 'Chưa dùng'}
                        value={unavailable ? '' : value}
                        disabled={loading || busy || notReady || unavailable}
                        onChange={(e) => setDrafts((current) => ({ ...current, [key]: e.target.value }))}
                      />
                      {message ? <div className="mt-1 text-xs text-rose-600">{message}</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 border-t border-slate-200 p-4">
          <Button
            type="button"
            disabled={busy || loading || notReady || changedKinds.length === 0 || invalid}
            onClick={() => void save()}
          >
            Lưu quy tắc
          </Button>
        </div>
      </section>
    </div>
  );
}
