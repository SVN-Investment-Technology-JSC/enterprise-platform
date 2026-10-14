'use client';
import { useId, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  Calculator,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Layers,
  Users,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  AnnualLeavePolicyResponse,
  HrmLeaveAccrualBasis,
  SaveAnnualLeavePolicyRequest,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Input } from './input';
import { LeaveField, LeaveSwitch } from './leave-form-controls';

const BASIS_OPTIONS: { value: HrmLeaveAccrualBasis; label: string }[] = [
  { value: 'JOIN_DATE', label: 'Ngày vào làm' },
  { value: 'CONTRACT_SIGN_DATE', label: 'Ngày ký HĐLĐ chính thức' },
];

const REASON_MAX_LENGTH = 1000;

interface TierRow {
  minYears: string;
  bonusDays: string;
}
export interface PolicyForm {
  /** Chỉ dùng khi hệ thống chưa có phép năm. */
  leaveTypeId: string;
  accrualBasis: HrmLeaveAccrualBasis;
  annualDays: string;
  startOffsetMonths: string;
  advanceAllowed: boolean;
  tiers: TierRow[];
  /** Năm áp dụng (luôn từ 01/01) hoặc rỗng để hệ thống tự chọn. */
  effectiveYear: string;
  /** Ghi chú thay đổi (nhật ký kiểm toán), khác với lý do nghỉ và mô tả đơn. */
  reason: string;
}

/** Giá trị ban đầu của biểu mẫu: chính sách hiện hành, hoặc mặc định khi chưa cấu hình. */
function toForm(data: AnnualLeavePolicyResponse | null): PolicyForm {
  const policy = data?.policy ?? null;
  return {
    leaveTypeId: '',
    accrualBasis: policy?.accrualBasis ?? 'CONTRACT_SIGN_DATE',
    annualDays: String(policy?.annualDays ?? 12),
    startOffsetMonths: String(policy?.startOffsetMonths ?? 0),
    advanceAllowed: policy?.advanceAllowed ?? false,
    // Phép thâm niên chỉ có MỘT mốc (dòng trống = không áp dụng).
    tiers: policy
      ? policy.seniorityTiers.slice(0, 1).map((t) => ({
          minYears: String(t.minYears),
          bonusDays: String(t.bonusDays),
        }))
      : [{ minYears: '5', bonusDays: '1' }],
    effectiveYear: '',
    reason: '',
  };
}

const toNumber = (value: string) =>
  value.trim() === '' ? Number.NaN : Number(value);

/**
 * Chuyển biểu mẫu thành nội dung `PUT /annual-leave-policy`. Chỉ kiểm tra những gì cần để gửi được
 * (thiếu, không phải số); khoảng giá trị và ràng buộc theo căn cứ do server kiểm tra và báo lỗi.
 */
export function buildPolicyRequest(
  form: PolicyForm,
  data: AnnualLeavePolicyResponse,
): { request: SaveAnnualLeavePolicyRequest } | { error: string } {
  if (!data.leaveType && !form.leaveTypeId)
    return { error: 'Cần chọn lý do nghỉ dùng làm phép năm' };
  const annualDays = toNumber(form.annualDays);
  if (!Number.isFinite(annualDays))
    return { error: 'Cần nhập Số ngày phép mỗi năm' };
  const startOffsetMonths = toNumber(form.startOffsetMonths);
  if (!Number.isFinite(startOffsetMonths))
    return { error: 'Cần nhập Bắt đầu cộng sau (tháng)' };
  const tiers: { minYears: number; bonusDays: number }[] = [];
  for (const row of form.tiers) {
    if (!row.minYears.trim() && !row.bonusDays.trim()) continue;
    const minYears = toNumber(row.minYears);
    const bonusDays = toNumber(row.bonusDays);
    if (!Number.isFinite(minYears) || !Number.isFinite(bonusDays))
      return { error: 'Mỗi mốc thâm niên cần nhập đủ số năm và số ngày' };
    tiers.push({ minYears, bonusDays });
  }
  tiers.sort((a, b) => a.minYears - b.minYears);
  const reason = form.reason.trim();
  if (!reason) return { error: 'Cần nhập Ghi chú thay đổi' };
  const request: SaveAnnualLeavePolicyRequest = {
    ...(data.leaveType ? {} : { leaveTypeId: form.leaveTypeId }),
    accrualBasis: form.accrualBasis,
    annualDays,
    startOffsetMonths,
    advanceAllowed: form.advanceAllowed,
    seniorityTiers: tiers,
    ...(form.effectiveYear ? { effectiveFrom: `${form.effectiveYear}-01-01` } : {}),
    reason,
    ...(data.policy ? { expectedUpdatedAt: data.policy.updatedAt } : {}),
  };
  return { request };
}

export interface PolicySummary {
  base: string;
  start: string;
  seniority: string;
  carryover: string;
}

/**
 * Tóm tắt chính sách từ giá trị đang có trong biểu mẫu (nạp từ chính sách hiện hành, đổi theo khi sửa).
 * Phép năm không chuyển sang năm sau: tác vụ chốt cuối năm reset phần còn lại về 0.
 */
export function buildPolicySummary(form: PolicyForm): PolicySummary {
  const days = toNumber(form.annualDays);
  const offset = toNumber(form.startOffsetMonths);
  const basis =
    form.accrualBasis === 'JOIN_DATE'
      ? 'Theo ngày vào làm'
      : 'Theo ngày ký HĐLĐ';
  const tiers = form.tiers
    .map((row) => ({
      minYears: toNumber(row.minYears),
      bonusDays: toNumber(row.bonusDays),
    }))
    .filter((t) => Number.isFinite(t.minYears) && Number.isFinite(t.bonusDays))
    .sort((a, b) => a.minYears - b.minYears);
  let seniority = 'Không có';
  if (tiers.length === 1) {
    seniority = `+${tiers[0].bonusDays} ngày mỗi năm từ đủ ${tiers[0].minYears} năm`;
  } else if (tiers.length > 1) {
    const shown = tiers
      .slice(0, 3)
      .map((t) => `+${t.bonusDays} ngày từ đủ ${t.minYears} năm`)
      .join('; ');
    seniority =
      tiers.length > 3
        ? `${shown}; và ${tiers.length - 3} mốc khác`
        : shown;
  }
  return {
    base: Number.isFinite(days) ? `${days} ngày mỗi năm` : 'Chưa nhập',
    start:
      Number.isFinite(offset) && offset > 0
        ? `${basis}, sau ${offset} tháng`
        : basis,
    seniority,
    carryover: 'Không chuyển sang năm sau',
  };
}

function dateVn(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}

/** Các năm có thể chọn làm mốc áp dụng chính sách (luôn từ 01/01). */
function effectiveYearOptions() {
  const year = new Date().getFullYear();
  return [year, year + 1, year + 2].map((y) => ({
    value: String(y),
    label: `Từ 01/01/${y}`,
  }));
}
function dateTimeVn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('vi-VN');
}

/** Trạng thái hiệu lực để hiện nhãn ở tiêu đề màn hình. */
export function policyStatus(
  data: AnnualLeavePolicyResponse | null,
): 'active' | 'scheduled' | 'none' {
  const policy = data?.policy ?? null;
  if (!policy) return 'none';
  const today = new Date().toLocaleDateString('en-CA');
  return policy.effectiveFrom > today ? 'scheduled' : 'active';
}

/**
 * Trạng thái và thao tác lưu của chính sách phép năm (MỘT biểu mẫu cho cả hệ thống). Tách khỏi phần
 * hiển thị để nút "Lưu thay đổi" ở tiêu đề màn hình dùng chung đúng luồng lưu với biểu mẫu.
 */
export function useAnnualLeavePolicyForm({
  data,
  canManage,
  onSaved,
}: {
  /** null khi đang tải hoặc tải lỗi. */
  data: AnnualLeavePolicyResponse | null;
  canManage: boolean;
  onSaved: (data: AnnualLeavePolicyResponse) => void | Promise<void>;
}) {
  const [form, setForm] = useState<PolicyForm>(() => toForm(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState('');

  // Dữ liệu mới từ server (tải lần đầu hoặc sau khi lưu): nạp lại biểu mẫu ngay trong lần vẽ này
  // (không chờ effect, tránh nháy giá trị mặc định) và xóa ghi chú đã nhập.
  const [source, setSource] = useState(data);
  if (source !== data) {
    setSource(data);
    setForm(toForm(data));
  }

  const patch = (next: Partial<PolicyForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setSaved('');
  };
  const dirty = data
    ? JSON.stringify(form) !== JSON.stringify(toForm(data))
    : false;

  async function save() {
    if (!data || busy || !canManage) return;
    setError('');
    setStale(false);
    setSaved('');
    const built = buildPolicyRequest(form, data);
    if ('error' in built) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      const result = await hrmFetch<{ data: AnnualLeavePolicyResponse }>(
        '/annual-leave-policy',
        { method: 'PUT', body: JSON.stringify(built.request) },
      );
      await onSaved(result.data);
      const closed = result.data.closedOtherSchedules ?? 0;
      setSaved(
        closed > 0
          ? `Đã lưu chính sách phép năm. Đã dừng ${closed} lịch cộng phép cũ của các lý do nghỉ khác.`
          : 'Đã lưu chính sách phép năm.',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không lưu được chính sách phép năm',
      );
      setStale(err instanceof HrmApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return {
    data,
    canManage,
    form,
    patch,
    busy,
    error,
    stale,
    saved,
    dirty,
    /** Nút lưu ở tiêu đề chỉ bấm được khi đã tải chính sách, có thay đổi và không đang lưu. */
    canSave: Boolean(data) && canManage && dirty && !busy,
    save,
    clearError: () => {
      setError('');
      setStale(false);
    },
  };
}

export type AnnualLeavePolicyController = ReturnType<
  typeof useAnnualLeavePolicyForm
>;

const TONE = {
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  green: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-600',
} as const;
type Tone = keyof typeof TONE;

function CardHeader({
  icon,
  title,
  description,
  id,
  tone = 'blue',
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  id?: string;
  tone?: Tone;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONE[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <h2
          id={id}
          className="text-base font-bold tracking-tight text-slate-900"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

const cardClass =
  'space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs';

function SummaryItem({
  icon,
  label,
  value,
  tone = 'blue',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${TONE[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-semibold leading-snug text-slate-900">
          {value}
        </p>
      </div>
    </div>
  );
}

/**
 * Chính sách phép năm: hai cột. Trái là biểu mẫu (Cách tính phép, Phép thâm niên, Hiệu lực và ghi chú),
 * phải là thẻ Tóm tắt chính sách và Lưu ý khi thay đổi. Trạng thái và thao tác lưu do `useAnnualLeavePolicyForm`
 * điều khiển ở màn hình cha.
 */
export function AnnualLeavePolicyCard({
  controller,
  loadError,
  onReload,
}: {
  controller: AnnualLeavePolicyController;
  loadError: string;
  onReload: () => void;
}) {
  const uid = useId();
  const { data, canManage, form, patch, busy, error, stale, saved } =
    controller;
  const editable = canManage && !busy;
  const policy = data?.policy ?? null;
  const joinDate = form.accrualBasis === 'JOIN_DATE';
  const monthlyDays = Number(form.annualDays);
  const candidates = data?.candidates ?? [];
  const summary = buildPolicySummary(form);
  const status = policyStatus(data);

  return (
    <div className="space-y-4">
      {loadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-red-600" />
            {loadError}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onReload}
            className="text-xs"
          >
            Tải lại
          </Button>
        </div>
      ) : null}

      {!data && !loadError ? (
        <p role="status" className="py-6 text-center text-xs text-slate-500">
          Đang tải chính sách phép năm...
        </p>
      ) : null}

      {data ? (
        <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void controller.save();
            }}
            noValidate
            className="space-y-4"
          >
            {!data.leaveType ? (
              <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Chọn lý do nghỉ dùng làm phép năm
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Hệ thống chưa có phép năm. Chọn một lý do nghỉ đang dùng;
                    khi lưu, lý do này trở thành phép năm duy nhất (luôn có
                    lương và trừ quỹ phép). Lý do nghỉ khác không bao giờ trừ
                    quỹ phép.
                  </p>
                </div>
                {candidates.length === 0 ? (
                  <p
                    role="note"
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                  >
                    Chưa có lý do nghỉ phù hợp, hãy thêm lý do nghỉ có lương ở
                    màn Lý do nghỉ trước.
                  </p>
                ) : (
                  <LeaveField label="Lý do nghỉ làm phép năm" required>
                    <SearchableSelect
                      value={form.leaveTypeId}
                      placeholder="Chọn lý do nghỉ làm phép năm"
                      disabled={!editable}
                      clearable={false}
                      options={candidates.map((c) => ({
                        value: c.id,
                        label: `${c.code} · ${c.name}`,
                        description: c.paid
                          ? 'Có lương'
                          : 'Không lương, sẽ được đổi thành có lương khi dùng làm phép năm',
                      }))}
                      onChange={(value) => patch({ leaveTypeId: value || '' })}
                    />
                  </LeaveField>
                )}
              </div>
            ) : null}

            <section className={cardClass} aria-labelledby={`${uid}-calc`}>
              <CardHeader
                id={`${uid}-calc`}
                icon={<Calculator className="size-5" />}
                title="Cách tính phép"
                description="Chọn mốc thời gian và số ngày phép năm cơ bản cho toàn bộ nhân viên."
              />
              <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-3">
                <LeaveField
                  label="Căn cứ tính phép"
                  required
                  hint="Mốc thời gian để bắt đầu tính và tích lũy phép năm."
                >
                  <SearchableSelect
                    value={form.accrualBasis}
                    placeholder="Chọn căn cứ tính phép"
                    disabled={!editable}
                    clearable={false}
                    options={BASIS_OPTIONS}
                    onChange={(value) =>
                      patch({
                        accrualBasis:
                          (value as HrmLeaveAccrualBasis) ||
                          'CONTRACT_SIGN_DATE',
                      })
                    }
                  />
                </LeaveField>
                <LeaveField
                  label="Số ngày phép mỗi năm"
                  required
                  htmlFor={`${uid}-annual-days`}
                  hint={`Cộng mỗi tháng ${
                    Number.isFinite(monthlyDays)
                      ? Math.round((monthlyDays / 12) * 100) / 100
                      : 0
                  } ngày (số ngày một năm chia 12).`}
                >
                  <Input
                    id={`${uid}-annual-days`}
                    type="number"
                    min={0}
                    max={366}
                    step="0.5"
                    className="h-9 text-xs"
                    disabled={!editable}
                    value={form.annualDays}
                    onChange={(e) => patch({ annualDays: e.target.value })}
                  />
                </LeaveField>
                <LeaveField
                  label="Bắt đầu cộng sau (tháng)"
                  required
                  htmlFor={`${uid}-offset`}
                  hint="Số tháng kể từ mốc trên để bắt đầu cộng (0 là cộng ngay từ tháng căn cứ)."
                >
                  <Input
                    id={`${uid}-offset`}
                    type="number"
                    min={0}
                    max={120}
                    step="1"
                    className="h-9 text-xs"
                    disabled={!editable}
                    value={form.startOffsetMonths}
                    onChange={(e) =>
                      patch({ startOffsetMonths: e.target.value })
                    }
                  />
                </LeaveField>
              </div>
              {joinDate ? (
                <p
                  role="note"
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                >
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Căn cứ Ngày vào làm chỉ hỗ trợ cộng ngay từ tháng đầu (Bắt
                    đầu cộng sau = 0) và mốc thâm niên đều chu kỳ, ví dụ 5 năm
                    thêm 1 ngày, 10 năm thêm 2 ngày, 15 năm thêm 3 ngày.
                  </span>
                </p>
              ) : null}
              <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
                <LeaveSwitch
                  label="Cho ứng phép"
                  checked={form.advanceAllowed}
                  disabled={!editable}
                  onChange={(next) => patch({ advanceAllowed: next })}
                />
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    Cho ứng phép
                  </p>
                  <p className="text-[11px] leading-snug text-slate-500">
                    {form.advanceAllowed
                      ? 'Được dùng trước phần phép chưa cộng, đến hết năm.'
                      : 'Chỉ được dùng số phép đã cộng đến tháng hiện tại.'}
                  </p>
                </div>
              </div>
            </section>

            <section className={cardClass} aria-labelledby={`${uid}-tiers`}>
              <CardHeader
                id={`${uid}-tiers`}
                icon={<Layers className="size-5" />}
                tone="amber"
                title="Phép thâm niên"
                description="Cộng thêm số ngày phép theo thâm niên làm việc."
              />
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <span>Thâm niên từ đủ (năm)</span>
                  <span>Phép cộng thêm / năm</span>
                </div>
                {(form.tiers.length ? form.tiers.slice(0, 1) : [{ minYears: '', bonusDays: '' }]).map(
                  (tier) => (
                    <div
                      key="tier"
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-t border-slate-100 px-3 py-2"
                    >
                      <div className="relative">
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          step="1"
                          aria-label="Số năm mốc 1"
                          className="h-9 pr-12 text-xs"
                          disabled={!editable}
                          value={tier.minYears}
                          onChange={(e) =>
                            patch({
                              tiers: [{ ...tier, minYears: e.target.value }],
                            })
                          }
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                          năm
                        </span>
                      </div>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          aria-label="Số ngày mốc 1"
                          className="h-9 pr-14 text-xs"
                          disabled={!editable}
                          value={tier.bonusDays}
                          onChange={(e) =>
                            patch({
                              tiers: [{ ...tier, bonusDays: e.target.value }],
                            })
                          }
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                          ngày
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
              <p
                role="note"
                className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
              >
                <Info className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
                <span>
                  Chỉ có một mốc: đạt N năm kể từ ngày căn cứ thì được thêm M
                  ngày phép mỗi năm. Để trống cả hai ô nếu không áp dụng phép
                  thâm niên.
                </span>
              </p>
            </section>

            {canManage ? (
              <section className={cardClass} aria-labelledby={`${uid}-effect`}>
                <CardHeader
                  id={`${uid}-effect`}
                  icon={<FileText className="size-5" />}
                  tone="violet"
                  title="Hiệu lực & ghi chú"
                  description="Thiết lập thời gian áp dụng và ghi chú thay đổi chính sách."
                />
                <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-5">
                  <LeaveField
                    label="Áp dụng từ năm"
                    className="@2xl:col-span-2"
                    hint="Chính sách luôn có hiệu lực từ ngày 01/01. Để trống thì áp dụng từ 01/01 năm nay. Khi lưu, quỹ phép đã ghi sổ của năm áp dụng được tính lại theo chính sách mới."
                  >
                    <SearchableSelect
                      value={form.effectiveYear}
                      placeholder="Tự động"
                      disabled={busy}
                      options={effectiveYearOptions()}
                      onChange={(value) =>
                        patch({ effectiveYear: value ?? '' })
                      }
                    />
                  </LeaveField>
                  <LeaveField
                    label="Ghi chú thay đổi"
                    required
                    htmlFor={`${uid}-reason`}
                    className="@2xl:col-span-3"
                    hint="Ghi rõ nội dung thay đổi để dễ theo dõi (lưu vào nhật ký kiểm toán)."
                  >
                    <Input
                      id={`${uid}-reason`}
                      maxLength={REASON_MAX_LENGTH}
                      className="h-9 text-xs"
                      placeholder="Ví dụ: Tăng phép năm lên 14 ngày theo quy chế mới"
                      disabled={busy}
                      value={form.reason}
                      onChange={(e) => patch({ reason: e.target.value })}
                    />
                    <p
                      data-testid="reason-counter"
                      className="text-right text-[11px] text-slate-400"
                    >
                      {form.reason.length}/{REASON_MAX_LENGTH}
                    </p>
                  </LeaveField>
                </div>
              </section>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-red-600" />
                  {error}
                </span>
                {stale ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      controller.clearError();
                      onReload();
                    }}
                    className="text-xs"
                  >
                    Tải lại chính sách
                  </Button>
                ) : null}
              </div>
            ) : null}
            {saved ? (
              <p
                role="status"
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"
              >
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                {saved}
              </p>
            ) : null}
          </form>

          <aside className="space-y-4">
            <section
              aria-labelledby={`${uid}-summary`}
              className={cardClass}
              data-testid="policy-summary"
            >
              <CardHeader
                id={`${uid}-summary`}
                icon={<BookOpen className="size-5" />}
                title="Tóm tắt chính sách"
                tone="amber"
                description="Thông tin tóm tắt quy tắc phép năm hiện tại."
              />
              <div className="space-y-2">
                <SummaryItem
                  icon={<CalendarDays className="size-4.5" />}
                  label="Phép cơ bản"
                  value={summary.base}
                />
                <SummaryItem
                  icon={<Clock className="size-4.5" />}
                  label="Bắt đầu tích lũy"
                  tone="green"
                  value={summary.start}
                />
                <SummaryItem
                  icon={<Users className="size-4.5" />}
                  label="Phép thâm niên"
                  tone="violet"
                  value={summary.seniority}
                />
                <SummaryItem
                  icon={<ArrowLeftRight className="size-4.5" />}
                  label="Chuyển phép cuối năm"
                  tone="orange"
                  value={summary.carryover}
                />
              </div>
              <div className="space-y-1.5 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-600">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-blue-600" />
                  <span>
                    Chính sách này áp dụng cho toàn bộ nhân viên trong công ty.
                    Phép năm không chuyển sang năm sau: phần còn lại cuối năm
                    được reset về 0.
                  </span>
                </p>
                {data.leaveType ? (
                  <p className="pl-5.5 text-slate-500">
                    Áp dụng cho lý do nghỉ {data.leaveType.name} (
                    {data.leaveType.code}); chỉ lý do này trừ quỹ phép năm.
                  </p>
                ) : null}
                <p className="pl-5.5 text-slate-500">
                  {policy
                    ? `${
                        status === 'scheduled'
                          ? 'Sẽ áp dụng từ'
                          : 'Đang áp dụng từ'
                      } ngày ${dateVn(policy.effectiveFrom)} (cập nhật lúc ${dateTimeVn(policy.updatedAt)}).`
                    : 'Chưa có chính sách phép năm. Nhập biểu mẫu và lưu để áp dụng.'}
                </p>
              </div>
            </section>

            <section
              aria-labelledby={`${uid}-warning`}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-xs"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h2
                    id={`${uid}-warning`}
                    className="text-sm font-bold text-slate-900"
                  >
                    Lưu ý khi thay đổi
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Việc thay đổi cấu hình có thể ảnh hưởng đến số phép tích lũy
                    và cách tính phép của nhân viên trong tương lai. Vui lòng
                    kiểm tra kỹ trước khi lưu thay đổi.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
