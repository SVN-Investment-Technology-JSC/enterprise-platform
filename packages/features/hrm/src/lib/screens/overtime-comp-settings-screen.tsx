'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmOvertimeCompSettings, HrmOvertimeCompVersionSummary, HrmPolicyConflictMode } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../hrm-comp-off-api';
import {
  ACCRUAL_OFFSET_OPTIONS,
  COMP_VERSION_PHASE_LABELS,
  compVersionPhase,
  configToForm,
  currentMonthKey,
  formatCompDate,
  formToConfig,
  nextFreeEffectiveFrom,
  overlapEffects,
  overtimeCompFormProblem,
  removableCompVersionId,
  ROUNDING_OPTIONS,
  RULE_SET_OPTIONS,
  type OvertimeCompForm,
} from '../comp-off-model';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import { MonthPickerInput } from '../ui/date-picker-input';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { toast } from '../ui/toast';
import { errorText, Field, Notice } from '../ui/comp-off/comp-off-kit';

const HISTORY_PREFIXES = ['OVERTIME_COMP_'] as const;

const CONFLICT_OPTIONS: { value: HrmPolicyConflictMode; label: string; hint: string }[] = [
  { value: 'REPORT', label: 'Chỉ báo xung đột, không ghi', hint: 'Mặc định: nếu khoảng mới giao với phiên bản đã có, hệ thống báo lỗi và không lưu gì.' },
  {
    value: 'OVERWRITE',
    label: 'Ghi đè theo thời gian',
    hint: 'Phiên bản mới thay phần giao nhau: phiên bản bắt đầu trước được kết thúc vào ngày liền trước, phiên bản nằm trọn trong khoảng mới bị thay thế. Chỉ làm được với tháng chưa chốt công và phiên bản chưa có dữ liệu tham chiếu.',
  },
];

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
  const [saveError, setSaveError] = useState('');
  const [onConflict, setOnConflict] = useState<HrmPolicyConflictMode>('REPORT');
  const [versionError, setVersionError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveSectionRef = useRef<HTMLElement>(null);

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
  const overlaps = useMemo(() => overlapEffects(settings?.versions ?? [], effectiveFrom), [settings, effectiveFrom]);
  // Chỉ phiên bản đang chạy mở đầu mà bắt đầu trước ngày mới thì được tự kết thúc; còn lại là giao thật sự.
  const hardOverlaps = overlaps.filter((o) => o.effect === 'REPLACE' || o.effectiveTo !== null);
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
    setSaveError('');
    try {
      const saved = await compOffApi.saveSettings({ effectiveFrom, config: formToConfig(form), reason: reason.trim(), onConflict });
      toast.success('Đã tạo phiên bản chính sách làm thêm và nghỉ bù mới.');
      setSettings(saved);
      setReason('');
      setOnConflict('REPORT');
      setEffectiveFrom(nextFreeEffectiveFrom(saved.versions, new Date().toLocaleDateString('en-CA')));
    } catch (e) {
      // Lỗi hiện ngay cạnh nút Lưu và qua toast, không đẩy lên đầu trang nơi người dùng phải cuộn mới thấy.
      const message = errorText(e, 'Không lưu được cấu hình');
      setSaveError(message);
      toast.error(message);
      saveSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toLocaleDateString('en-CA');
  const phaseOf = (v: Pick<HrmOvertimeCompVersionSummary, 'effectiveFrom' | 'effectiveTo'>) => compVersionPhase(v, today);
  const removableId = removableCompVersionId(settings?.versions ?? [], today);

  async function removeVersion(v: HrmOvertimeCompVersionSummary, why: string) {
    setVersionError('');
    try {
      const saved = await compOffApi.removeVersion(v.id, { reason: why.trim(), expectedUpdatedAt: v.updatedAt ?? '' });
      toast.success(`Đã xóa phiên bản ${v.versionNo}. Phiên bản liền trước được mở lại nếu có.`);
      setSettings(saved);
      setEffectiveFrom(nextFreeEffectiveFrom(saved.versions, today));
      await load();
    } catch (e) {
      // Lỗi hiện ngay tại danh sách vừa thao tác, kèm toast.
      const message = errorText(e, 'Không xóa được phiên bản');
      setVersionError(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
      <PageTitle
        actions={
          can('hrm.audit.read') ? (
            <Button type="button" variant="outline" onClick={() => setHistoryOpen(true)} className="h-9 gap-1.5 px-3 text-xs font-semibold">
              <History className="size-4" />
              Lịch sử thay đổi
            </Button>
          ) : null
        }
        title="Làm thêm và nghỉ bù"
        description="Cách phân loại làm thêm và ca đêm, trần giờ làm thêm tính lương và quy đổi giờ dư thành ngày nghỉ bù. Mỗi thay đổi là một phiên bản có hiệu lực từ mùng 1 của một tháng; tháng đã chốt công không đổi."
        badge={
          settings?.current ? (
            <Badge variant={settings.current.config.enabled || settings.current.config.fundEnabled ? 'default' : 'outline'}>
              {settings.current.config.enabled
                ? 'Đang áp dụng đầy đủ'
                : settings.current.config.fundEnabled
                  ? 'Chỉ quản lý quỹ nghỉ bù'
                  : 'Đang tắt'}
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
          <Section title="Sử dụng quỹ nghỉ bù">
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <Check
                label="Bật quản lý quỹ nghỉ bù"
                checked={form.fundEnabled}
                disabled={!canManage || form.enabled}
                onChange={(v) => set('fundEnabled', v)}
              />
              <p className="pl-6 text-[12px] text-slate-500">
                Đơn có lý do Nghỉ bù hiện số dư, giữ chỗ và bị chặn khi quỹ không đủ; duyệt đơn thì trừ quỹ, từ chối hoặc hủy thì hoàn.
                Quỹ lấy từ Import Excel và điều chỉnh thủ công ở tab Quỹ nghỉ bù.
                {form.enabled ? ' Đang bật công thức tính nên quỹ luôn được bật.' : ''}
              </p>
            </div>
            {text('usageStepDays', 'Bước dùng tối thiểu khi tạo đơn (ngày)')}
          </Section>
          <Section title="Công thức tính từ làm thêm / ca đêm">
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <Check
                label="Bật công thức tính (cắt trần làm thêm và cộng quỹ khi chốt công tháng)"
                checked={form.enabled}
                disabled={!canManage}
                onChange={(v) =>
                  setForm((f) => (f ? { ...f, enabled: v, fundEnabled: v ? true : f.fundEnabled } : f))
                }
              />
              <p className="pl-6 text-[12px] text-slate-500">
                {form.enabled
                  ? 'Cuối mỗi tháng, giờ làm thêm vượt trần và ca đêm được quy đổi và cộng vào quỹ nghỉ bù theo các thiết lập bên dưới.'
                  : 'Đang tắt: không cắt trần làm thêm, không đổi công thức lương và không tự cộng quỹ khi chốt công. Các thiết lập bên dưới chưa được áp dụng.'}
              </p>
            </div>
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
            ) : null}
            <Check
              label="Đơn công tác khai giờ theo ngày: giờ làm thêm trong khung đêm tính là giờ đêm"
              checked={form.declaredNightWindow}
              disabled={!canManage}
              onChange={(v) => set('declaredNightWindow', v)}
            />
            {form.ruleSet === 'CLOCK_WINDOW' || form.declaredNightWindow ? (
              <>
                <Field label="Khung giờ đêm: từ" hint="Dạng HH:mm, sau 12:00">
                  <Input value={form.nightStart} disabled={!canManage} onChange={(e) => set('nightStart', e.target.value)} />
                </Field>
                <Field label="Khung giờ đêm: đến" hint="Dạng HH:mm, trước 12:00">
                  <Input value={form.nightEnd} disabled={!canManage} onChange={(e) => set('nightEnd', e.target.value)} />
                </Field>
              </>
            ) : null}
          </Section>
          <Section title="Công thức: trần làm thêm và trả lương">
            {text('monthlyCapHours', 'Trần làm thêm theo tháng (giờ)')}
            {text('yearlyCapHours', 'Trần làm thêm theo năm (giờ)', 'Để trống nếu không giới hạn')}
            <Check label="Ca đêm cũng bị cắt trần" checked={form.nightCapped} disabled={!canManage} onChange={(v) => set('nightCapped', v)} />
          </Section>
          <Section title="Công thức: quy đổi nghỉ bù">
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
            <section ref={saveSectionRef} className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <h2 className="text-sm font-bold text-slate-900">Phiên bản mới</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Hiệu lực từ tháng" hint="Áp dụng từ mùng 1 của tháng được chọn">
                  <MonthPickerInput
                    aria-label="Hiệu lực từ tháng"
                    height={36}
                    allowClear={false}
                    value={effectiveFrom.slice(0, 7)}
                    onChange={(month) => setEffectiveFrom(month ? `${month}-01` : '')}
                    min={currentMonthKey()}
                  />
                </Field>
                <Field label="Lý do thay đổi">
                  <Input value={reason} maxLength={2000} placeholder="Bắt buộc" onChange={(e) => setReason(e.target.value)} />
                </Field>
              </div>
              {hardOverlaps.length > 0 ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs font-semibold text-slate-700">Khi giao với phiên bản đã có</legend>
                  {CONFLICT_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                        onConflict === o.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="overtime-comp-conflict"
                        className="mt-0.5 accent-blue-600"
                        checked={onConflict === o.value}
                        onChange={() => setOnConflict(o.value)}
                      />
                      <span>
                        <span className="font-semibold text-slate-900">{o.label}</span>
                        <span className="block text-[12px] text-slate-500">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                  <ul className="space-y-0.5 pt-1 text-xs text-slate-700">
                    {overlaps.map((o) => (
                      <li key={o.versionNo}>
                        Phiên bản {o.versionNo} ({formatCompDate(o.effectiveFrom)} - {o.effectiveTo ? formatCompDate(o.effectiveTo) : 'chưa kết thúc'}):{' '}
                        {onConflict === 'OVERWRITE'
                          ? o.effect === 'REPLACE'
                            ? 'sẽ bị thay thế'
                            : `sẽ kết thúc ngày ${formatCompDate(o.newEffectiveTo)}`
                          : 'đang giao, sẽ báo lỗi khi lưu'}
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ) : null}
              {saveError ? (
                <Notice tone="error">
                  {saveError}
                  {hardOverlaps.length > 0 && onConflict === 'REPORT' ? ' Chọn "Ghi đè" ở trên để thay các phiên bản này.' : ''}
                </Notice>
              ) : null}
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
          {versionError ? <Notice tone="error">{versionError}</Notice> : null}
          <ul className="divide-y divide-slate-100 text-sm">
            {settings.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-semibold">Phiên bản {v.versionNo}</span>
                <span className="text-slate-600">
                  {formatCompDate(v.effectiveFrom)} - {v.effectiveTo ? formatCompDate(v.effectiveTo) : 'chưa kết thúc'}
                </span>
                <Badge variant={phaseOf(v) === 'CURRENT' ? 'default' : 'outline'}>{COMP_VERSION_PHASE_LABELS[phaseOf(v)]}</Badge>
                <Badge variant={v.config.enabled ? 'default' : 'outline'}>{v.config.enabled ? 'Bật' : 'Tắt'}</Badge>
                <span className="text-xs text-slate-500">
                  {v.config.ruleSet === 'NIGHT_REST' ? 'Theo ngày nghỉ sau ca đêm' : 'Theo khung giờ đêm'} · trần {v.config.monthlyCapHours} giờ/tháng · hệ số{' '}
                  {v.config.compFactor}
                </span>
                {canManage && v.id === removableId ? (
                  <Popconfirm
                    title="Xóa phiên bản chưa có hiệu lực?"
                    description="Chỉ xóa được phiên bản mới nhất, chưa có hiệu lực và chưa có dữ liệu tham chiếu. Phiên bản liền trước sẽ được mở lại."
                    okText="Xóa phiên bản"
                    cancelText="Không"
                    okType="danger"
                    placement="left"
                    reasonRequired
                    reasonLabel="Lý do xóa"
                    onConfirm={(why) => removeVersion(v, why ?? '')}
                  >
                    <Button size="sm" variant="destructive" className="ml-auto">
                      Xóa
                    </Button>
                  </Popconfirm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {can('hrm.audit.read') ? (
        <ConfigHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title="Lịch sử thay đổi làm thêm và nghỉ bù"
          description="Các lần lưu phiên bản (kèm ghi đè) và xóa phiên bản, có người thực hiện và lý do (tối đa 100 bản ghi, mới nhất ở trên)."
          actionPrefixes={HISTORY_PREFIXES}
        />
      ) : null}
    </div>
  );
}
