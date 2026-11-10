'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmOvertimeCompSettings } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../hrm-comp-off-api';
import {
  ACCRUAL_OFFSET_OPTIONS,
  configToForm,
  currentMonthKey,
  formatCompDate,
  formToConfig,
  nextFreeEffectiveFrom,
  overtimeCompFormProblem,
  ROUNDING_OPTIONS,
  RULE_SET_OPTIONS,
  type OvertimeCompForm,
} from '../comp-off-model';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DatePickerInput } from '../ui/date-picker-input';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { toast } from '../ui/toast';
import { errorText, Field, Notice } from '../ui/comp-off/comp-off-kit';

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-800">
      <input type="checkbox" className="size-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * Cấu hình làm thêm và nghỉ bù: mỗi lần lưu tạo một phiên bản chính sách OT mới có hiệu lực từ mùng 1 của một tháng.
 * Chỉ hiện tham số của chế độ phân loại đang chọn.
 */
export default function OvertimeCompSettingsScreen() {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.policy.manage');
  const [settings, setSettings] = useState<HrmOvertimeCompSettings | null>(null);
  const [form, setForm] = useState<OvertimeCompForm | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await compOffApi.settings();
      setSettings(data);
      if (data.current) setForm(configToForm(data.current.config));
      setEffectiveFrom(nextFreeEffectiveFrom(data.versions, new Date().toLocaleDateString('en-CA')));
    } catch (e) {
      setError(errorText(e, 'Không tải được cấu hình làm thêm và nghỉ bù'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = useMemo(() => (form ? overtimeCompFormProblem(form, effectiveFrom, reason) : ''), [form, effectiveFrom, reason]);
  const set = <K extends keyof OvertimeCompForm>(key: K, value: OvertimeCompForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const text = (key: keyof OvertimeCompForm, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        inputMode="decimal"
        value={String(form?.[key] ?? '')}
        disabled={!canManage}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  );

  async function save() {
    if (!form || problem || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await compOffApi.saveSettings({ effectiveFrom, config: formToConfig(form), reason: reason.trim() });
      toast.success('Đã tạo phiên bản chính sách làm thêm và nghỉ bù mới.');
      setSettings(saved);
      setReason('');
      setEffectiveFrom(nextFreeEffectiveFrom(saved.versions, new Date().toLocaleDateString('en-CA')));
    } catch (e) {
      setError(errorText(e, 'Không lưu được cấu hình'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
      <PageTitle
        title="Làm thêm và nghỉ bù"
        description="Cách phân loại làm thêm và ca đêm, trần giờ làm thêm tính lương và quy đổi giờ dư thành ngày nghỉ bù. Mỗi thay đổi là một phiên bản có hiệu lực từ mùng 1 của một tháng; tháng đã chốt công không đổi."
        badge={
          settings?.current ? (
            <Badge variant={settings.current.config.enabled ? 'default' : 'outline'}>
              {settings.current.config.enabled ? 'Đang áp dụng' : 'Đang tắt'}
            </Badge>
          ) : null
        }
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {settings && !settings.current ? (
        <Notice tone="warn">Chưa có chính sách làm thêm (giới hạn giờ và hệ số). Cấu hình tăng ca ở mục Lương trước khi bật quy tắc này.</Notice>
      ) : null}
      {settings?.legalWarnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
      {form ? (
        <>
          <Section title="Áp dụng và phân loại">
            <Check label="Bật quy tắc trần làm thêm và nghỉ bù" checked={form.enabled} disabled={!canManage} onChange={(v) => set('enabled', v)} />
            <Field label="Chế độ phân loại làm thêm / ca đêm">
              <SearchableSelect
                height={36}
                value={form.ruleSet}
                options={RULE_SET_OPTIONS}
                clearable={false}
                disabled={!canManage}
                onChange={(v) => v && set('ruleSet', v as OvertimeCompForm['ruleSet'])}
              />
            </Field>
            {text('normalHoursPerDay', 'Số giờ chuẩn một ngày làm việc')}
            {form.ruleSet === 'NIGHT_REST' ? (
              <>
                {text('nightRestHoursPerDay', 'Số giờ ca đêm bù cho mỗi ngày nghỉ sau ca đêm')}
                <Check label="Cho phép nghỉ nửa ngày" checked={form.allowHalfDay} disabled={!canManage} onChange={(v) => set('allowHalfDay', v)} />
              </>
            ) : (
              <>
                <Field label="Khung giờ đêm: từ" hint="Dạng HH:mm, sau 12:00">
                  <Input value={form.nightStart} disabled={!canManage} onChange={(e) => set('nightStart', e.target.value)} />
                </Field>
                <Field label="Khung giờ đêm: đến" hint="Dạng HH:mm, trước 12:00">
                  <Input value={form.nightEnd} disabled={!canManage} onChange={(e) => set('nightEnd', e.target.value)} />
                </Field>
              </>
            )}
          </Section>
          <Section title="Trần làm thêm và trả lương">
            {text('monthlyCapHours', 'Trần làm thêm theo tháng (giờ)')}
            {text('yearlyCapHours', 'Trần làm thêm theo năm (giờ)', 'Để trống nếu không giới hạn')}
            <Check label="Ca đêm cũng bị cắt trần" checked={form.nightCapped} disabled={!canManage} onChange={(v) => set('nightCapped', v)} />
          </Section>
          <Section title="Quy đổi nghỉ bù">
            {text('compFactor', 'Hệ số quy đổi giờ dư thành nghỉ bù')}
            {text('dayBasisHours', 'Số giờ quy đổi một ngày nghỉ', 'Để trống là bằng số giờ chuẩn một ngày')}
            {text('decimals', 'Số chữ số thập phân khi lưu')}
            <Field label="Phương pháp làm tròn">
              <SearchableSelect
                height={36}
                value={form.rounding}
                options={ROUNDING_OPTIONS}
                clearable={false}
                disabled={!canManage}
                onChange={(v) => v && set('rounding', v as OvertimeCompForm['rounding'])}
              />
            </Field>
            {text('usageStepDays', 'Bước dùng tối thiểu khi tạo đơn (ngày)')}
            <Field label="Tháng cộng quỹ nghỉ bù">
              <SearchableSelect
                height={36}
                value={form.accrualMonthOffset}
                options={ACCRUAL_OFFSET_OPTIONS}
                clearable={false}
                disabled={!canManage}
                onChange={(v) => v && set('accrualMonthOffset', v as OvertimeCompForm['accrualMonthOffset'])}
              />
            </Field>
            {text('expiryMonths', 'Hạn dùng (số tháng kể từ tháng cộng quỹ)', '0 là không hạn')}
            {text('accumulationCapDays', 'Trần tích lũy tối đa (ngày)', 'Để trống nếu không giới hạn')}
          </Section>
          {canManage ? (
            <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <h2 className="text-sm font-bold text-slate-900">Phiên bản mới</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Hiệu lực từ (mùng 1 của tháng)">
                  <DatePickerInput value={effectiveFrom} onChange={setEffectiveFrom} min={`${currentMonthKey()}-01`} />
                </Field>
                <Field label="Lý do thay đổi">
                  <Input value={reason} maxLength={2000} placeholder="Bắt buộc" onChange={(e) => setReason(e.target.value)} />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                {problem && reason ? <span className="text-xs text-red-600">{problem}</span> : null}
                <Button onClick={() => void save()} disabled={Boolean(problem) || busy} title={problem || undefined}>
                  {busy ? 'Đang lưu…' : 'Lưu phiên bản mới'}
                </Button>
              </div>
            </section>
          ) : (
            <Notice>Bạn chỉ có quyền xem cấu hình này.</Notice>
          )}
        </>
      ) : null}
      {settings && settings.versions.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">Lịch sử phiên bản</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {settings.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-semibold">Phiên bản {v.versionNo}</span>
                <span className="text-slate-600">
                  {formatCompDate(v.effectiveFrom)} - {v.effectiveTo ? formatCompDate(v.effectiveTo) : 'chưa kết thúc'}
                </span>
                <Badge variant={v.config.enabled ? 'default' : 'outline'}>{v.config.enabled ? 'Bật' : 'Tắt'}</Badge>
                <span className="text-xs text-slate-500">
                  {v.config.ruleSet === 'NIGHT_REST' ? 'Theo ngày nghỉ sau ca đêm' : 'Theo khung giờ đêm'} · trần {v.config.monthlyCapHours} giờ/tháng · hệ số{' '}
                  {v.config.compFactor}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
