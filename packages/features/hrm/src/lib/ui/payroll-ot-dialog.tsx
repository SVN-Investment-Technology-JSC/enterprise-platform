'use client';
import { DatePickerInput } from './date-picker-input';
import { TimeTextInput } from './time-text-input';
import { useId, useState } from 'react';
import { Loader2, Moon, Percent, Timer } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { IconTile, InfoNote, SettingsField } from './settings-kit';
import {
  OT_REFERENCES,
  minutesToTime,
  otReferenceWarnings,
  timeToMinutes,
} from '../hrm-payroll-config';

export const otNumberFields = [
  ['dailyLimitMinutes', 'Giới hạn phút / ngày'],
  ['weeklyLimitMinutes', 'Giới hạn phút / tuần'],
  ['monthlyLimitMinutes', 'Giới hạn phút / tháng'],
  ['yearlyLimitMinutes', 'Giới hạn phút / năm'],
  ['weekdayRate', 'Hệ số ngày thường'],
  ['offRate', 'Hệ số ngày OFF'],
  ['holidayRate', 'Hệ số lễ / Tết'],
  ['nightRate', 'Hệ số ban đêm'],
  ['nightOffRate', 'Hệ số ban đêm ngày OFF'],
  ['nightHolidayRate', 'Hệ số ban đêm lễ / Tết'],
] as const;

const LIMIT_FIELDS = otNumberFields.filter(([key]) => key.endsWith('Minutes'));
const RATE_FIELDS = otNumberFields.filter(([key]) => !key.endsWith('Minutes'));

const referenceByKey = Object.fromEntries(OT_REFERENCES.map((r) => [r.key, r]));

export interface OtDialogProps {
  /** Phiên bản gốc để nạp giá trị (sửa hoặc tạo bản kế tiếp). */
  base?: { config_json: Record<string, unknown>; effective_from: string; updated_at: string; id: string };
  /** true: sửa trực tiếp phiên bản chưa dùng; false: tạo phiên bản mới. */
  editing: boolean;
  onSubmit: (path: string, body: Record<string, unknown>, method: 'POST' | 'PATCH') => Promise<void>;
  onClose: () => void;
}

function GroupTitle({ icon, title, hint }: { icon: typeof Timer; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <IconTile icon={icon} tone="amber" size="sm" />
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

export function PayrollOtDialog({ base, editing, onSubmit, onClose }: OtDialogProps) {
  const uid = useId();
  const config = base?.config_json ?? {};
  const [numbers, setNumbers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      otNumberFields.map(([key]) => [key, config[key] === undefined ? '' : String(config[key])]),
    ),
  );
  const [nightStart, setNightStart] = useState(
    minutesToTime(config['nightStartMinute'] as number | undefined) || '22:00',
  );
  const [nightEnd, setNightEnd] = useState(
    minutesToTime(config['nightEndMinute'] as number | undefined) || '06:00',
  );
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const startMinute = timeToMinutes(nightStart);
  const endMinute = timeToMinutes(nightEnd);
  const warnings = otReferenceWarnings({
    ...numbers,
    nightStartMinute: startMinute ?? '',
    nightEndMinute: endMinute ?? '',
  });
  const warningFor = (key: string) => warnings.find((w) => w.key === key);

  const numberField = ([key, label]: readonly [string, string]) => {
    const ref = referenceByKey[key];
    const warn = warningFor(key);
    return (
      <SettingsField
        key={key}
        label={label}
        htmlFor={`${uid}-${key}`}
        hint={ref ? `Tham chiếu ${ref.value}${ref.kind === 'limit' ? ' phút' : ''}: ${ref.note}` : undefined}
      >
        <Input
          id={`${uid}-${key}`}
          type="number"
          min={0}
          step={key.endsWith('Minutes') ? '1' : '0.01'}
          value={numbers[key]}
          onChange={(e) => setNumbers({ ...numbers, [key]: e.target.value })}
          placeholder={ref ? `Tham chiếu: ${ref.value}` : undefined}
          className={`h-9 text-xs ${warn ? 'border-amber-400' : ''}`}
        />
      </SettingsField>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="@container flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden bg-white p-0 sm:max-w-[900px]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-4 pr-12 @xl:px-5">
          <DialogTitle className="text-base font-bold text-slate-900">
            {editing ? 'Sửa quy định OT' : 'Phiên bản quy định OT'}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {editing
              ? 'Chỉ sửa phiên bản chưa được sử dụng. Quy định đã áp dụng cần phiên bản kế tiếp.'
              : 'Giờ ban đêm chọn theo HH:mm. Mức tham chiếu chỉ để đối chiếu, cần HR/pháp chế xác nhận theo văn bản hiện hành.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (startMinute === null || endMinute === null)
              return setError('Cần chọn giờ bắt đầu và kết thúc khung đêm (HH:mm)');
            if (!reason.trim()) return setError('Cần nhập lý do thay đổi');
            for (const [key, label] of otNumberFields)
              if (key.endsWith('Minutes') || ['weekdayRate', 'offRate', 'holidayRate', 'nightRate'].includes(key))
                if (numbers[key] === '' || !Number.isFinite(Number(numbers[key])))
                  return setError(`Cần nhập ${label}`);
            setBusy(true);
            try {
              const body: Record<string, unknown> = {
                ...Object.fromEntries(
                  otNumberFields
                    .filter(([key]) => numbers[key] !== '')
                    .map(([key]) => [key, Number(numbers[key])]),
                ),
                nightStartMinute: startMinute,
                nightEndMinute: endMinute,
                effectiveFrom: editing ? base!.effective_from.slice(0, 10) : effectiveFrom,
                reason: reason.trim(),
                ...(editing ? { expectedUpdatedAt: base!.updated_at } : {}),
              };
              if (!editing && !effectiveFrom) throw new Error('Cần nhập ngày hiệu lực');
              await onSubmit(editing ? `/payroll-configuration/${base!.id}` : '/ot-configuration', body, editing ? 'PATCH' : 'POST');
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Không lưu được');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 @xl:p-5">
            {!editing && (
              <SettingsField label="Ngày hiệu lực" required className="max-w-xs">
                <DatePickerInput height={36} required value={effectiveFrom} onChange={(v: string) => setEffectiveFrom(v)} />
              </SettingsField>
            )}

            <section aria-label="Giới hạn OT" className="space-y-3">
              <GroupTitle icon={Timer} title="Giới hạn OT" hint="Số phút làm thêm tối đa theo từng chu kỳ." />
              <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">{LIMIT_FIELDS.map(numberField)}</div>
            </section>

            <section aria-label="Hệ số OT" className="space-y-3">
              <GroupTitle icon={Percent} title="Hệ số OT" hint="Hệ số nhân với đơn giá giờ thường (từ 1 đến 10)." />
              <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">{RATE_FIELDS.map(numberField)}</div>
            </section>

            <section aria-label="Khung giờ đêm" className="space-y-3">
              <GroupTitle icon={Moon} title="Khung giờ đêm" hint="Khung đêm phải qua 00:00 (giờ bắt đầu sau giờ kết thúc)." />
              <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                <SettingsField label="Bắt đầu giờ đêm" required hint="Mặc định 22:00">
                  <TimeTextInput required value={nightStart} onChange={(v: string) => setNightStart(v)} className="h-9 text-xs" />
                </SettingsField>
                <SettingsField label="Kết thúc giờ đêm" required hint="Mặc định 06:00 (ngày hôm sau)">
                  <TimeTextInput required value={nightEnd} onChange={(v: string) => setNightEnd(v)} className="h-9 text-xs" />
                </SettingsField>
              </div>
            </section>

            {warnings.length > 0 && (
              <InfoNote tone="amber" role="status">
                <div className="font-semibold">Cảnh báo so với mức tham chiếu (không chặn lưu)</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {warnings.map((w) => (
                    <li key={w.key}>{w.message}</li>
                  ))}
                </ul>
              </InfoNote>
            )}

            <SettingsField label="Lý do thay đổi" required htmlFor={`${uid}-reason`}>
              <Input
                id={`${uid}-reason`}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do (ghi vào nhật ký kiểm toán)"
                className="h-9 text-xs"
              />
            </SettingsField>
          </div>
          <div className="shrink-0 space-y-2 border-t border-slate-200 bg-slate-50 p-3 @xl:px-5">
            {error && (
              <InfoNote tone="red" role="alert">
                {error}
              </InfoNote>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="h-9 px-4 text-xs">
                Hủy
              </Button>
              <Button type="submit" disabled={busy} className="h-9 gap-1.5 px-4 text-xs font-semibold">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {busy ? 'Đang lưu…' : 'Lưu quy định OT'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
