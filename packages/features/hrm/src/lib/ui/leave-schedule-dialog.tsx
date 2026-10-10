'use client';
import { useState } from 'react';
// import { Plus, Trash2 } from 'lucide-react'; // dùng cho nhiều mốc thâm niên (đang ẩn)
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveAccrualBasis,
  HrmLeaveAccrualSchedule,
  HrmLeaveType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { Button } from './button';

export const accrualBasisOptions: {
  value: HrmLeaveAccrualBasis;
  label: string;
}[] = [
  {
    value: 'CONTRACT_SIGN_DATE',
    label: 'Ngày ký HĐLĐ chính thức đầu tiên',
  },
  // Ẩn theo yêu cầu: bỏ option "Ngày vào làm" (lịch cũ), chỉ giữ ngày ký HĐLĐ chính thức đầu tiên.
  // Bỏ comment dòng dưới để dùng lại.
  // { value: 'JOIN_DATE', label: 'Ngày vào làm (lịch cũ)' },
];
/** Chỉ hiện cho lịch cũ đã tồn tại theo ngày vào làm khi sửa/tạo phiên bản, để hiển thị đúng giá trị. */
const legacyJoinDateOption = {
  value: 'JOIN_DATE' as HrmLeaveAccrualBasis,
  label: 'Ngày vào làm (lịch cũ)',
};

const MAX_SENIORITY_YEARS = 60;
/**
 * Mốc thâm niên theo một chu kỳ duy nhất: mỗi N năm cộng thêm X ngày (cộng dồn).
 * VD N=5, X=1: 5 năm +1, 10 năm +2, 15 năm +3... Sinh ra các mốc để dùng với chính sách hiện có.
 */
export function buildSeniorityTiers(cycleYears: number, cycleDays: number) {
  const tiers: { minYears: number; bonusDays: number }[] = [];
  for (let k = 1; k * cycleYears <= MAX_SENIORITY_YEARS; k++)
    tiers.push({ minYears: k * cycleYears, bonusDays: k * cycleDays });
  return tiers;
}
/** Nhận diện lịch thâm niên theo chu kỳ (mốc đầu = chu kỳ, các mốc sau là bội số). */
export function detectSeniorityCycle(
  tiers: readonly { minYears: number; bonusDays: number }[],
): { cycleYears: number; cycleDays: number } | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minYears - b.minYears);
  return { cycleYears: sorted[0].minYears, cycleDays: sorted[0].bonusDays };
}
const frequencies = [
  { value: 'MONTHLY', label: 'Hàng tháng' },
  { value: 'QUARTERLY', label: 'Hàng quý' },
  { value: 'YEARLY', label: 'Hàng năm' },
];
const yesNo = [
  { value: 'true', label: 'Cho phép ứng phép' },
  { value: 'false', label: 'Không cho ứng phép' },
];
const startModes = [
  { value: 'SIGN_MONTH', label: 'Ngay từ tháng ký HĐ' },
  { value: 'AFTER_N', label: 'Sau N tháng kể từ ngày ký HĐ' },
];

// type Tier = { minYears: string; bonusDays: string }; // dùng cho nhiều mốc thâm niên (đang ẩn)
type Mode = 'create' | 'edit' | 'version';

function nextMonthStart() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d.toLocaleDateString('en-CA');
}

/**
 * Tạo/sửa/tạo phiên bản lịch cộng phép. Lịch theo HĐLĐ có định mức năm, mốc bắt
 * đầu sau N tháng, tuỳ chọn ứng phép và nhiều mốc thâm niên.
 */
export function LeaveScheduleDialog({
  mode,
  types,
  leaveTypeId,
  schedule,
  onClose,
  onSaved,
}: {
  mode: Mode;
  types: HrmLeaveType[];
  leaveTypeId?: string;
  schedule?: HrmLeaveAccrualSchedule;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [typeId, setTypeId] = useState(leaveTypeId || '');
  const [basis, setBasis] = useState<HrmLeaveAccrualBasis>(
    schedule?.accrualBasis ?? 'CONTRACT_SIGN_DATE',
  );
  const [annualDays, setAnnualDays] = useState(
    String(schedule?.annualDays ?? 12),
  );
  const [startMode, setStartMode] = useState(
    schedule?.startOffsetMonths ? 'AFTER_N' : 'SIGN_MONTH',
  );
  const [offset, setOffset] = useState(
    String(schedule?.startOffsetMonths || 1),
  );
  const [advance, setAdvance] = useState(
    String(schedule?.advanceAllowed ?? false),
  );
  // Mốc thâm niên chỉ có 1 chu kỳ: mỗi N năm cộng thêm X ngày.
  const initialCycle = detectSeniorityCycle(schedule?.seniorityTiers ?? []);
  const [cycleYears, setCycleYears] = useState(
    initialCycle ? String(initialCycle.cycleYears) : mode === 'create' ? '5' : '',
  );
  const [cycleDays, setCycleDays] = useState(
    initialCycle ? String(initialCycle.cycleDays) : mode === 'create' ? '1' : '',
  );
  // Nhiều mốc thâm niên (đang ẩn, bỏ comment cùng khối giao diện bên dưới để dùng lại):
  // const [tiers, setTiers] = useState<Tier[]>(
  //   schedule?.seniorityTiers.length
  //     ? schedule.seniorityTiers.map((t) => ({
  //         minYears: String(t.minYears),
  //         bonusDays: String(t.bonusDays),
  //       }))
  //     : mode === 'create'
  //       ? [{ minYears: '5', bonusDays: '1' }]
  //       : [],
  // );
  const [frequency, setFrequency] = useState(
    schedule?.accrualFrequency ?? 'MONTHLY',
  );
  const [amount, setAmount] = useState(String(schedule?.accrualAmount ?? 1));
  const [proration, setProration] = useState(
    schedule?.prorationRule === 'NONE' ? 'NONE' : 'BY_JOIN_DATE',
  );
  const [legacyYears, setLegacyYears] = useState(
    String(schedule?.seniorityBonusYears ?? 0),
  );
  const [legacyDays, setLegacyDays] = useState(
    String(schedule?.seniorityBonusDays ?? 0),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(
    mode === 'version'
      ? nextMonthStart()
      : (schedule?.effectiveFrom ?? `${new Date().getFullYear()}-01-01`),
  );
  const [effectiveTo, setEffectiveTo] = useState(
    mode === 'version' ? '' : (schedule?.effectiveTo ?? ''),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const contract = basis === 'CONTRACT_SIGN_DATE';

  function body() {
    if (!typeId) throw new Error('Cần chọn loại nghỉ');
    if (!effectiveFrom) throw new Error('Cần nhập ngày hiệu lực');
    if (mode !== 'create' && !reason.trim()) throw new Error('Cần nhập lý do');
    const common = {
      effectiveFrom,
      effectiveTo: effectiveTo || null,
      ...(mode === 'create'
        ? {}
        : { expectedUpdatedAt: schedule?.updatedAt, reason }),
    };
    if (!contract)
      return {
        ...common,
        accrualBasis: 'JOIN_DATE',
        accrualFrequency: frequency,
        accrualAmount: Number(amount),
        prorationRule: proration,
        seniorityBonusYears: Number(legacyYears),
        seniorityBonusDays: Number(legacyDays),
        seniorityTiers: [],
      };
    const days = Number(annualDays);
    if (!Number.isFinite(days) || days < 0 || days > 366)
      throw new Error('Định mức phép năm phải từ 0 đến 366 ngày');
    const n = startMode === 'AFTER_N' ? Number(offset) : 0;
    if (!Number.isInteger(n) || n < 0 || n > 120)
      throw new Error('Số tháng N phải là số nguyên từ 0 đến 120');
    const hasCycle = cycleYears.trim() !== '' || cycleDays.trim() !== '';
    const years = Number(cycleYears);
    const bonus = Number(cycleDays);
    if (
      hasCycle &&
      (!Number.isInteger(years) ||
        years < 1 ||
        years > MAX_SENIORITY_YEARS ||
        !Number.isFinite(bonus) ||
        bonus < 0)
    )
      throw new Error(
        'Mốc thâm niên cần số năm nguyên từ 1 đến 60 và số ngày cộng thêm ≥ 0',
      );
    const parsed = hasCycle && bonus > 0 ? buildSeniorityTiers(years, bonus) : [];
    if (parsed.some((t) => t.bonusDays > 100))
      throw new Error(
        'Tổng ngày thâm niên cộng dồn vượt 100 ngày, hãy giảm số ngày mỗi chu kỳ',
      );
    // Nhiều mốc (đang ẩn) - bỏ comment để dùng lại cùng khối giao diện nhiều mốc:
    // const parsed = tiers
    //   .filter((t) => t.minYears.trim() || t.bonusDays.trim())
    //   .map((t) => ({
    //     minYears: Number(t.minYears),
    //     bonusDays: Number(t.bonusDays),
    //   }));
    // if (
    //   parsed.some(
    //     (t) =>
    //       !Number.isInteger(t.minYears) ||
    //       t.minYears < 1 ||
    //       !Number.isFinite(t.bonusDays) ||
    //       t.bonusDays < 0,
    //   )
    // )
    //   throw new Error(
    //     'Mốc thâm niên cần số năm nguyên ≥ 1 và số ngày cộng thêm ≥ 0',
    //   );
    return {
      ...common,
      accrualBasis: 'CONTRACT_SIGN_DATE',
      accrualFrequency: 'MONTHLY',
      accrualAmount: Math.round((days / 12) * 100) / 100,
      annualDays: days,
      startOffsetMonths: n,
      advanceAllowed: advance === 'true',
      seniorityTiers: parsed.sort((a, b) => a.minYears - b.minYears),
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = body();
      const base = `/leave-types/${typeId}/accrual-schedules`;
      await hrmFetch(
        mode === 'create' || !schedule
          ? base
          : `${base}/${schedule.id}${mode === 'version' ? '/version' : ''}`,
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      await onSaved(
        mode === 'create'
          ? 'Đã tạo lịch cộng phép.'
          : mode === 'edit'
            ? 'Đã cập nhật lịch cộng phép.'
            : 'Đã tạo phiên bản lịch cộng phép mới.',
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được dữ liệu');
    } finally {
      setBusy(false);
    }
  }

  const label = 'block space-y-1 text-xs font-medium text-slate-700';
  const required = (
    <span className="ml-1 font-bold text-red-500" aria-hidden="true">
      *
    </span>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[840px] max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle className="text-base font-bold text-slate-900">
            {mode === 'create'
              ? 'Lập lịch cộng phép'
              : mode === 'edit'
                ? 'Sửa lịch chưa cộng phép'
                : 'Tạo phiên bản lịch cộng phép'}
          </DialogTitle>
          <p className="mt-1 text-xs text-slate-500">
            {contract
              ? 'Phép được +1 từ ngày 1 hàng tháng (gồm tháng hiện tại). Tháng bắt đầu, tháng đạt mốc thâm niên và tháng nghỉ việc được tính đủ nếu có hiệu lực bất kỳ ngày nào trong tháng (không còn ngưỡng 15 ngày).'
              : 'Lịch cũ tính theo ngày vào làm; giữ nguyên để không ảnh hưởng dữ liệu đã cộng.'}
          </p>
        </DialogHeader>
        <form
          onSubmit={submit}
          className="flex flex-1 min-h-0 flex-col overflow-hidden"
        >
          <div className="grid flex-1 min-h-0 grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
            <label className={label}>
              <span>Loại nghỉ{required}</span>
              <SearchableSelect
                value={typeId}
                disabled={mode !== 'create'}
                clearable={false}
                options={types
                  .filter((t) => t.active || t.id === typeId)
                  .map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))}
                onChange={(v) => setTypeId(v || '')}
              />
            </label>
            <label className={label}>
              <span>Mốc tính phép{required}</span>
              <SearchableSelect
                value={basis}
                clearable={false}
                options={
                  schedule?.accrualBasis === 'JOIN_DATE'
                    ? [...accrualBasisOptions, legacyJoinDateOption]
                    : accrualBasisOptions
                }
                onChange={(v) =>
                  setBasis((v as HrmLeaveAccrualBasis) || 'CONTRACT_SIGN_DATE')
                }
              />
            </label>
            <label className={label}>
              <span>Hiệu lực từ{required}</span>
              <Input
                type="date"
                className="h-9 text-xs"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <label className={label}>
              <span>Hiệu lực đến (để trống nếu không giới hạn)</span>
              <Input
                type="date"
                className="h-9 text-xs"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </label>

            {contract ? (
              <>
                <h3 className="col-span-full border-b border-slate-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Định mức và mốc bắt đầu
                </h3>
                <label className={label}>
                  <span>Định mức phép năm (ngày){required}</span>
                  <Input
                    type="number"
                    min={0}
                    max={366}
                    step="0.5"
                    className="h-9 text-xs"
                    value={annualDays}
                    onChange={(e) => setAnnualDays(e.target.value)}
                  />
                  <span className="block text-[11px] font-normal text-slate-500">
                    Cộng mỗi tháng {Number(annualDays) ? Math.round((Number(annualDays) / 12) * 100) / 100 : 0} ngày.
                  </span>
                </label>
                <label className={label}>
                  <span>Ứng phép{required}</span>
                  <SearchableSelect
                    value={advance}
                    clearable={false}
                    options={yesNo}
                    onChange={(v) => setAdvance(v || 'false')}
                  />
                  <span className="block text-[11px] font-normal text-slate-500">
                    {advance === 'true'
                      ? 'Được dùng trước quỹ từ tháng bắt đầu đến hết tháng 12.'
                      : 'Chỉ dùng số phép đã tích luỹ đến tháng hiện tại.'}
                  </span>
                </label>
                <label className={label}>
                  <span>Bắt đầu tính phép{required}</span>
                  <SearchableSelect
                    value={startMode}
                    clearable={false}
                    options={startModes}
                    onChange={(v) => setStartMode(v || 'SIGN_MONTH')}
                  />
                </label>
                {startMode === 'AFTER_N' && (
                  <label className={label}>
                    <span>Số tháng N sau ngày ký HĐ{required}</span>
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      step="1"
                      className="h-9 text-xs"
                      value={offset}
                      onChange={(e) => setOffset(e.target.value)}
                    />
                  </label>
                )}
                <div className="col-span-full space-y-2">
                  <h3 className="border-b border-slate-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mốc thâm niên (tính từ ngày ký HĐ, cộng nguyên ngày khi đủ mỗi chu kỳ)
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className={label}>
                      <span>Chu kỳ (năm)</span>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        step="1"
                        className="h-9 text-xs"
                        aria-label="Chu kỳ thâm niên (năm)"
                        value={cycleYears}
                        onChange={(e) => setCycleYears(e.target.value)}
                      />
                    </label>
                    <label className={label}>
                      <span>Cộng thêm mỗi chu kỳ (ngày/năm)</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        className="h-9 text-xs"
                        aria-label="Số ngày cộng thêm mỗi chu kỳ"
                        value={cycleDays}
                        onChange={(e) => setCycleDays(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {Number(cycleYears) >= 1 && Number(cycleDays) > 0
                      ? `Đủ ${cycleYears} năm +${cycleDays} ngày, đủ ${Number(cycleYears) * 2} năm +${Number(cycleDays) * 2} ngày, ... (mỗi chu kỳ cộng thêm ${cycleDays} ngày). Để trống nếu không áp dụng phép thâm niên.`
                      : 'Không áp dụng phép thâm niên.'}
                  </p>
                </div>
                {/* Ẩn theo yêu cầu: chỉ dùng 1 mốc thâm niên theo chu kỳ, không cho nhiều mốc (bỏ comment để dùng lại).
                <div className="col-span-full space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1 pt-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Mốc thâm niên (tính từ ngày ký HĐ, lấy mốc cao nhất đã đạt)
                    </h3>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        setTiers([...tiers, { minYears: '', bonusDays: '' }])
                      }
                    >
                      <Plus className="size-3.5" />
                      Thêm mốc
                    </Button>
                  </div>
                  {tiers.length === 0 && (
                    <p className="text-xs text-slate-500">
                      Không áp dụng phép thâm niên.
                    </p>
                  )}
                  {tiers.map((tier, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                    >
                      <label className={label}>
                        <span>Đủ số năm</span>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          step="1"
                          className="h-9 text-xs"
                          aria-label={`Số năm mốc ${index + 1}`}
                          value={tier.minYears}
                          onChange={(e) =>
                            setTiers(
                              tiers.map((t, i) =>
                                i === index
                                  ? { ...t, minYears: e.target.value }
                                  : t,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className={label}>
                        <span>Cộng thêm (ngày/năm)</span>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          className="h-9 text-xs"
                          aria-label={`Số ngày mốc ${index + 1}`}
                          value={tier.bonusDays}
                          onChange={(e) =>
                            setTiers(
                              tiers.map((t, i) =>
                                i === index
                                  ? { ...t, bonusDays: e.target.value }
                                  : t,
                              ),
                            )
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-label={`Xoá mốc ${index + 1}`}
                        className="h-9"
                        onClick={() =>
                          setTiers(tiers.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                */}
              </>
            ) : (
              <>
                <h3 className="col-span-full border-b border-slate-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Lịch theo ngày vào làm
                </h3>
                <label className={label}>
                  <span>Chu kỳ{required}</span>
                  <SearchableSelect
                    value={frequency}
                    clearable={false}
                    options={frequencies}
                    onChange={(v) =>
                      setFrequency(
                        (v as HrmLeaveAccrualSchedule['accrualFrequency']) ||
                          'MONTHLY',
                      )
                    }
                  />
                </label>
                <label className={label}>
                  <span>Số lượng mỗi chu kỳ{required}</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="h-9 text-xs"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className={label}>
                  <span>Phân bổ{required}</span>
                  <SearchableSelect
                    value={proration}
                    clearable={false}
                    options={[
                      { value: 'BY_JOIN_DATE', label: 'Theo thời gian thực tế' },
                      { value: 'NONE', label: 'Không phân bổ' },
                    ]}
                    onChange={(v) => setProration(v || 'BY_JOIN_DATE')}
                  />
                </label>
                <label className={label}>
                  <span>Mỗi bao nhiêu năm thâm niên (0: tắt)</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-9 text-xs"
                    value={legacyYears}
                    onChange={(e) => setLegacyYears(e.target.value)}
                  />
                </label>
                <label className={label}>
                  <span>Số ngày phép thâm niên</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    className="h-9 text-xs"
                    value={legacyDays}
                    onChange={(e) => setLegacyDays(e.target.value)}
                  />
                </label>
              </>
            )}
            {mode !== 'create' && (
              <label className={`${label} col-span-full`}>
                <span>Lý do{required}</span>
                <Input
                  className="h-9 text-xs"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
          </div>
          {error && (
            <div className="px-5 py-2">
              <p
                role="alert"
                className="rounded border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600"
              >
                {error}
              </p>
            </div>
          )}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="h-8 text-xs"
            >
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-8 bg-blue-600 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              {busy ? 'Đang xử lý…' : 'Lưu lịch cộng phép'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
