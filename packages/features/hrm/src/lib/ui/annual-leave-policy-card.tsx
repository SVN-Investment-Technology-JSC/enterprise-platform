'use client';
import { useId, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Info,
  Plus,
  Trash2,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  AnnualLeavePolicyResponse,
  HrmLeaveAccrualBasis,
  SaveAnnualLeavePolicyRequest,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';
import { LeaveField, LeaveSwitch } from './leave-form-controls';

const BASIS_OPTIONS: { value: HrmLeaveAccrualBasis; label: string }[] = [
  { value: 'JOIN_DATE', label: 'Ngày vào làm' },
  { value: 'CONTRACT_SIGN_DATE', label: 'Ngày ký HĐLĐ chính thức' },
];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: `Hết tháng ${i + 1}`,
}));
const DEFAULT_EXPIRY_MONTH = 3;

interface TierRow {
  minYears: string;
  bonusDays: string;
}
interface PolicyForm {
  /** Chỉ dùng khi hệ thống chưa có phép năm. */
  leaveTypeId: string;
  accrualBasis: HrmLeaveAccrualBasis;
  annualDays: string;
  startOffsetMonths: string;
  advanceAllowed: boolean;
  tiers: TierRow[];
  maxCarryoverDays: string;
  carryoverExpiryMonth: string;
  /** YYYY-MM hoặc rỗng (để hệ thống tự chọn). */
  effectiveMonth: string;
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
    tiers: policy
      ? policy.seniorityTiers.map((t) => ({
          minYears: String(t.minYears),
          bonusDays: String(t.bonusDays),
        }))
      : [{ minYears: '5', bonusDays: '1' }],
    maxCarryoverDays: String(policy?.carryover.maxDays ?? 0),
    carryoverExpiryMonth: String(
      policy?.carryover.expiryMonth ?? DEFAULT_EXPIRY_MONTH,
    ),
    effectiveMonth: '',
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
    return { error: 'Cần nhập Số ngày phép một năm' };
  const startOffsetMonths = toNumber(form.startOffsetMonths);
  if (!Number.isFinite(startOffsetMonths))
    return { error: 'Cần nhập Bắt đầu cộng sau (tháng)' };
  const maxCarryoverDays = toNumber(form.maxCarryoverDays);
  if (!Number.isFinite(maxCarryoverDays))
    return { error: 'Cần nhập Số ngày chuyển tối đa (nhập 0 nếu không chuyển)' };
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
    ...(form.effectiveMonth ? { effectiveFrom: `${form.effectiveMonth}-01` } : {}),
    maxCarryoverDays,
    carryoverExpiryMonth: Number(form.carryoverExpiryMonth),
    reason,
    ...(data.policy ? { expectedUpdatedAt: data.policy.updatedAt } : {}),
  };
  return { request };
}

function monthVn(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate);
  return match ? `${match[2]}/${match[1]}` : isoDate;
}
function dateTimeVn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('vi-VN');
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Chính sách phép năm: MỘT biểu mẫu duy nhất cho cả hệ thống (không danh sách lịch, không phiên bản).
 * Khi chưa có phép năm, bước đầu là chọn lý do nghỉ dùng làm phép năm.
 */
export function AnnualLeavePolicyCard({
  data,
  loadError,
  canManage,
  onSaved,
  onReload,
}: {
  /** null khi đang tải hoặc tải lỗi. */
  data: AnnualLeavePolicyResponse | null;
  loadError: string;
  canManage: boolean;
  onSaved: (data: AnnualLeavePolicyResponse) => void | Promise<void>;
  onReload: () => void;
}) {
  const uid = useId();
  const headingId = `${uid}-heading`;
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
  const editable = canManage && !busy;
  const policy = data?.policy ?? null;
  const joinDate = form.accrualBasis === 'JOIN_DATE';
  const monthlyDays = Number(form.annualDays);
  const todayMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
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

  const candidates = data?.candidates ?? [];

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <CalendarDays className="size-5" />
          </div>
          <div>
            <h2
              id={headingId}
              className="text-base font-bold tracking-tight text-slate-900"
            >
              Chính sách phép năm
            </h2>
            <p className="max-w-[90ch] text-xs text-slate-500">
              Một cấu hình duy nhất cho toàn bộ nhân viên.
              {data?.leaveType ? (
                <>
                  {' '}
                  Áp dụng cho lý do nghỉ{' '}
                  <strong className="font-semibold text-slate-700">
                    {data.leaveType.name}
                  </strong>{' '}
                  ({data.leaveType.code}); chỉ lý do này trừ quỹ phép năm.
                </>
              ) : null}
            </p>
          </div>
        </div>
        {!canManage && data ? (
          <Badge className="border-slate-200 bg-slate-100 text-xs text-slate-600">
            Chỉ xem
          </Badge>
        ) : null}
      </header>

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
        <form onSubmit={submit} noValidate className="space-y-4">
          {!data.leaveType ? (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Chọn lý do nghỉ dùng làm phép năm
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Hệ thống chưa có phép năm. Chọn một lý do nghỉ đang dùng; khi
                  lưu, lý do này trở thành phép năm duy nhất (luôn có lương và
                  trừ quỹ phép). Lý do nghỉ khác không bao giờ trừ quỹ phép.
                </p>
              </div>
              {candidates.length === 0 ? (
                <p
                  role="note"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                >
                  Chưa có lý do nghỉ phù hợp, hãy thêm lý do nghỉ có lương ở bảng
                  bên dưới trước.
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

          <Section title="Cách tính phép">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <LeaveField label="Căn cứ tính phép" required>
                <SearchableSelect
                  value={form.accrualBasis}
                  placeholder="Chọn căn cứ tính phép"
                  disabled={!editable}
                  clearable={false}
                  options={BASIS_OPTIONS}
                  onChange={(value) =>
                    patch({
                      accrualBasis:
                        (value as HrmLeaveAccrualBasis) || 'CONTRACT_SIGN_DATE',
                    })
                  }
                />
              </LeaveField>
              <LeaveField
                label="Số ngày phép một năm"
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
                hint="0 là cộng ngay từ tháng căn cứ; 2 là bắt đầu cộng sau 2 tháng kể từ ngày căn cứ."
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
                  onChange={(e) => patch({ startOffsetMonths: e.target.value })}
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
                  Căn cứ Ngày vào làm chỉ hỗ trợ cộng ngay từ tháng đầu (Bắt đầu
                  cộng sau = 0) và mốc thâm niên đều chu kỳ, ví dụ 5 năm thêm 1
                  ngày, 10 năm thêm 2 ngày, 15 năm thêm 3 ngày.
                </span>
              </p>
            ) : null}
            <div className="flex items-start gap-3">
              <LeaveSwitch
                label="Cho ứng phép"
                checked={form.advanceAllowed}
                disabled={!editable}
                onChange={(next) => patch({ advanceAllowed: next })}
              />
              <div>
                <p className="text-xs font-medium text-slate-700">Cho ứng phép</p>
                <p className="text-[11px] leading-snug text-slate-500">
                  {form.advanceAllowed
                    ? 'Được dùng trước phần phép chưa cộng, đến hết năm.'
                    : 'Chỉ được dùng số phép đã cộng đến tháng hiện tại.'}
                </p>
              </div>
            </div>
          </Section>

          <Section
            title="Thâm niên"
            description="Đạt N năm kể từ ngày căn cứ thì được thêm M ngày phép mỗi năm. Hệ thống lấy mốc cao nhất đã đạt, không cộng dồn các mốc."
          >
            {form.tiers.length === 0 ? (
              <p className="text-xs text-slate-500">
                Không áp dụng phép thâm niên.
              </p>
            ) : null}
            {form.tiers.map((tier, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 text-xs text-slate-700"
              >
                <span>Đạt</span>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step="1"
                  aria-label={`Số năm mốc ${index + 1}`}
                  className="h-9 w-24 text-xs"
                  disabled={!editable}
                  value={tier.minYears}
                  onChange={(e) =>
                    patch({
                      tiers: form.tiers.map((t, i) =>
                        i === index ? { ...t, minYears: e.target.value } : t,
                      ),
                    })
                  }
                />
                <span>năm thì thêm</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  aria-label={`Số ngày mốc ${index + 1}`}
                  className="h-9 w-24 text-xs"
                  disabled={!editable}
                  value={tier.bonusDays}
                  onChange={(e) =>
                    patch({
                      tiers: form.tiers.map((t, i) =>
                        i === index ? { ...t, bonusDays: e.target.value } : t,
                      ),
                    })
                  }
                />
                <span>ngày phép mỗi năm</span>
                {canManage ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Xóa mốc ${index + 1}`}
                    disabled={busy}
                    onClick={() =>
                      patch({ tiers: form.tiers.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
            {canManage ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || form.tiers.length >= 20}
                onClick={() =>
                  patch({
                    tiers: [...form.tiers, { minYears: '', bonusDays: '' }],
                  })
                }
                className="text-xs"
              >
                <Plus className="size-3.5" />
                Thêm mốc thâm niên
              </Button>
            ) : null}
          </Section>

          <Section
            title="Chuyển phép sang năm sau"
            description="Số ngày phép còn lại cuối năm được chuyển sang năm sau, tối đa theo cấu hình. Nhập 0 ngày nếu không cho chuyển."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <LeaveField
                label="Số ngày chuyển tối đa"
                required
                htmlFor={`${uid}-carry-days`}
                hint="0 ngày là không chuyển phép sang năm sau."
              >
                <Input
                  id={`${uid}-carry-days`}
                  type="number"
                  min={0}
                  max={366}
                  step="0.5"
                  className="h-9 text-xs"
                  disabled={!editable}
                  value={form.maxCarryoverDays}
                  onChange={(e) => patch({ maxCarryoverDays: e.target.value })}
                />
              </LeaveField>
              <LeaveField
                label="Hạn dùng phép chuyển"
                hint="Phép chuyển phải dùng hết trước cuối tháng này của năm nhận phép, quá hạn sẽ hết hiệu lực."
              >
                <SearchableSelect
                  value={form.carryoverExpiryMonth}
                  placeholder="Chọn tháng hết hạn"
                  disabled={!editable || !(toNumber(form.maxCarryoverDays) > 0)}
                  clearable={false}
                  options={MONTH_OPTIONS}
                  onChange={(value) =>
                    patch({
                      carryoverExpiryMonth: value || String(DEFAULT_EXPIRY_MONTH),
                    })
                  }
                />
              </LeaveField>
            </div>
          </Section>

          {canManage ? (
            <Section title="Hiệu lực và ghi chú">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <LeaveField
                  label="Hiệu lực từ tháng (tùy chọn)"
                  htmlFor={`${uid}-effective`}
                  hint="Để trống để hệ thống tự chọn: lần đầu từ ngày 1/1 năm nay; đã cộng phép rồi thì từ tháng sau tháng đã cộng."
                >
                  <Input
                    id={`${uid}-effective`}
                    type="month"
                    className="h-9 text-xs"
                    disabled={busy}
                    value={form.effectiveMonth}
                    onChange={(e) => patch({ effectiveMonth: e.target.value })}
                  />
                </LeaveField>
                <LeaveField
                  label="Ghi chú thay đổi"
                  required
                  htmlFor={`${uid}-reason`}
                  className="md:col-span-2"
                  hint="Ghi vào nhật ký kiểm toán để biết vì sao đổi chính sách. Đây là ghi chú của quản trị, khác với Lý do nghỉ và Mô tả ở đơn nghỉ."
                >
                  <Input
                    id={`${uid}-reason`}
                    maxLength={1000}
                    className="h-9 text-xs"
                    placeholder="Ví dụ: Tăng phép năm lên 14 ngày theo quy chế mới"
                    disabled={busy}
                    value={form.reason}
                    onChange={(e) => patch({ reason: e.target.value })}
                  />
                </LeaveField>
              </div>
            </Section>
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
                    setError('');
                    setStale(false);
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

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              {policy
                ? `${
                    policy.effectiveFrom.slice(0, 7) > todayMonth
                      ? 'Sẽ áp dụng từ'
                      : 'Đang áp dụng từ'
                  } tháng ${monthVn(policy.effectiveFrom)} (cập nhật lúc ${dateTimeVn(policy.updatedAt)}).`
                : 'Chưa có chính sách phép năm. Nhập biểu mẫu và lưu để áp dụng.'}
            </p>
            <Button
              permission="hrm.leave.manage"
              type="submit"
              disabled={busy}
              className="h-8 bg-blue-600 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              {busy ? 'Đang lưu...' : 'Lưu chính sách'}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
