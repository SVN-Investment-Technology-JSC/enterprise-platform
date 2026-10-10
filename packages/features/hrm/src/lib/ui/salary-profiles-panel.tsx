'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, UserCheck } from 'lucide-react';
import type {
  HrmEmployeeSalaryProfile,
  HrmSalaryGrade,
  HrmSalaryGradeStep,
} from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import {
  SALARY_PROFILE_STATUS_LABELS,
  SALARY_TYPE_LABELS,
  buildSalaryProfilePayload,
  formatMoneyVnd,
} from '../hrm-salary-format';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from './badge';
import { Button } from './button';
import { DatePickerInput } from './date-picker-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input } from './input';
import { toast } from './toast';

type Profile = Omit<HrmEmployeeSalaryProfile, 'baseSalary'> & {
  /** Null khi API ẩn mức lương với người xem. */
  baseSalary: number | null;
};

const SALARY_TYPE_OPTIONS = [
  { value: 'GROSS', label: SALARY_TYPE_LABELS.GROSS },
  { value: 'NET', label: SALARY_TYPE_LABELS.NET },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function dateVn(value?: string | null) {
  if (!value) return '----';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(value);
}

/** Hồ sơ lương theo nhân viên: lịch sử các phiên bản mức lương và thêm phiên bản mới. */
export function SalaryProfilesPanel() {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.salary.manage');
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([]);
  const [grades, setGrades] = useState<HrmSalaryGrade[]>([]);
  const [stepsByGrade, setStepsByGrade] = useState<Record<string, HrmSalaryGradeStep[]>>({});
  const [employee, setEmployee] = useState('');
  const [rows, setRows] = useState<Profile[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [stepId, setStepId] = useState('');
  const [salaryType, setSalaryType] = useState('GROSS');
  const [baseSalary, setBaseSalary] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [changeReason, setChangeReason] = useState('');

  const loadSteps = useCallback(async (id: string) => {
    if (!id) return [] as HrmSalaryGradeStep[];
    try {
      const result = await hrmFetch<{ data: HrmSalaryGradeStep[] }>(
        `/salary-grades/${id}/steps`,
      );
      const list = result.data ?? [];
      setStepsByGrade((prev) => ({ ...prev, [id]: list }));
      return list;
    } catch {
      return [] as HrmSalaryGradeStep[];
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      hrmEmployeeOptions(),
      hrmFetch<{ data: HrmSalaryGrade[] }>('/salary-grades'),
    ])
      .then(([options, g]) => {
        if (!alive) return;
        setEmployees(options);
        setGrades(g.data ?? []);
      })
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : 'Không tải được dữ liệu hồ sơ lương');
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadRows = useCallback(
    async (id: string) => {
      const result = await hrmFetch<{ data: Profile[] }>(
        `/employees/${id}/salary-profiles`,
      );
      const list = result.data ?? [];
      setRows(list);
      const gradeIds = [
        ...new Set(list.map((r) => r.salaryGradeId).filter((v): v is string => !!v)),
      ];
      await Promise.all(gradeIds.map((g) => loadSteps(g)));
    },
    [loadSteps],
  );

  useEffect(() => {
    let alive = true;
    setRows([]);
    setError('');
    if (!employee) return;
    setLoadingRows(true);
    void loadRows(employee)
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : 'Không tải được hồ sơ lương');
      })
      .finally(() => {
        if (alive) setLoadingRows(false);
      });
    return () => {
      alive = false;
    };
  }, [employee, loadRows]);

  const gradeLabel = useMemo(
    () => new Map(grades.map((g) => [g.id, `${g.code} - ${g.name}`])),
    [grades],
  );
  const stepNo = useCallback(
    (profile: Profile) =>
      profile.salaryStepId && profile.salaryGradeId
        ? (stepsByGrade[profile.salaryGradeId] ?? []).find((s) => s.id === profile.salaryStepId)
            ?.stepNo
        : undefined,
    [stepsByGrade],
  );
  const activeProfile = rows.find((r) => r.status === 'ACTIVE');
  const formSteps = stepsByGrade[gradeId] ?? [];

  function openForm() {
    const active = activeProfile;
    setGradeId(active?.salaryGradeId ?? '');
    setStepId(active?.salaryStepId ?? '');
    setSalaryType(active?.salaryType ?? 'GROSS');
    setBaseSalary(active && active.baseSalary !== null ? String(active.baseSalary) : '');
    setEffectiveFrom(todayIso());
    setChangeReason('');
    setFormError('');
    if (active?.salaryGradeId) void loadSteps(active.salaryGradeId);
    setOpen(true);
  }

  async function submit() {
    const built = buildSalaryProfilePayload({
      salaryGradeId: gradeId,
      salaryStepId: stepId,
      salaryType,
      baseSalary,
      effectiveFrom,
      changeReason,
    });
    if (!built.ok) return setFormError(built.error);
    setSaving(true);
    setFormError('');
    try {
      await hrmFetch(`/employees/${employee}/salary-profiles`, {
        method: 'POST',
        body: JSON.stringify(built.body),
      });
      toast.success('Đã lưu hồ sơ lương');
      setOpen(false);
      void loadRows(employee).catch((e) =>
        setError(
          `Đã lưu nhưng không tải lại được: ${e instanceof Error ? e.message : 'lỗi không xác định'}`,
        ),
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Không lưu được hồ sơ lương');
    } finally {
      setSaving(false);
    }
  }

  const employeeName = employees.find((e) => e.value === employee)?.label ?? '';

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <UserCheck className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Hồ sơ lương nhân viên
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Nơi nhập mức lương, ngạch và bậc của từng nhân viên. Mỗi lần lưu tạo phiên bản mới và kết thúc phiên bản đang hiệu lực.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-72">
            <SearchableSelect
              value={employee}
              onChange={(v) => setEmployee(v || '')}
              options={employees}
              placeholder="Chọn nhân viên..."
            />
          </div>
          <Button
            permission="hrm.salary.manage"
            disabled={!employee}
            onClick={openForm}
            className="flex h-9 items-center gap-1.5 bg-blue-600 text-xs text-white shadow-xs hover:bg-blue-700"
          >
            <Plus className="size-3.5" />
            <span>Thêm hồ sơ lương</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {employee && activeProfile && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs md:grid-cols-4">
          <div>
            <span className="block text-[11px] text-slate-500">Mức lương hiện hành</span>
            <strong className="font-mono text-blue-700">
              {activeProfile.baseSalary === null ? (
                <span title="Bạn không có quyền xem mức lương">Ẩn</span>
              ) : (
                formatMoneyVnd(activeProfile.baseSalary)
              )}
            </strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500">Loại lương</span>
            <strong>{SALARY_TYPE_LABELS[activeProfile.salaryType] ?? activeProfile.salaryType}</strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500">Ngạch và bậc</span>
            <strong>
              {activeProfile.salaryGradeId
                ? `${gradeLabel.get(activeProfile.salaryGradeId) ?? 'Ngạch đã chọn'}${stepNo(activeProfile) ? ` / Bậc ${stepNo(activeProfile)}` : ''}`
                : 'Chưa gán ngạch'}
            </strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500">Hiệu lực từ</span>
            <strong>{dateVn(activeProfile.effectiveFrom)}</strong>
          </div>
        </div>
      )}

      <div className="max-h-[calc(100vh-24rem)] min-h-40 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-4 py-3">Hiệu lực từ</th>
              <th className="px-4 py-3">Hiệu lực đến</th>
              <th className="px-4 py-3">Ngạch và bậc</th>
              <th className="px-4 py-3">Loại lương</th>
              <th className="px-4 py-3 text-right">Mức lương</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Căn cứ thay đổi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loadingRows ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Đang tải hồ sơ lương...
                  </span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  {employee
                    ? 'Nhân viên chưa có hồ sơ lương.'
                    : 'Chọn nhân viên để xem hồ sơ lương.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-semibold text-slate-900">{dateVn(r.effectiveFrom)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.effectiveTo ? dateVn(r.effectiveTo) : 'Đến nay'}</td>
                  <td className="px-4 py-3">
                    {r.salaryGradeId
                      ? `${gradeLabel.get(r.salaryGradeId) ?? 'Ngạch đã chọn'}${stepNo(r) ? ` / Bậc ${stepNo(r)}` : ''}`
                      : '----'}
                  </td>
                  <td className="px-4 py-3">{SALARY_TYPE_LABELS[r.salaryType] ?? r.salaryType}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">
                    {r.baseSalary === null ? (
                      <span title="Bạn không có quyền xem mức lương">Ẩn</span>
                    ) : (
                      formatMoneyVnd(r.baseSalary)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        r.status === 'ACTIVE'
                          ? 'border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700'
                          : 'border-slate-200 bg-slate-100 text-[10px] text-slate-600'
                      }
                    >
                      {SALARY_PROFILE_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.changeReason || '----'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg space-y-4 bg-white p-6">
          <DialogHeader>
            <DialogTitle>Thêm hồ sơ lương</DialogTitle>
            <DialogDescription>
              {employeeName ? `Nhân viên: ${employeeName}. ` : ''}Phiên bản mới có hiệu lực từ ngày chọn và kết thúc phiên bản trước.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <span className="mb-1 block font-semibold text-slate-700">Ngạch lương</span>
              <SearchableSelect
                value={gradeId}
                clearable
                placeholder="Chọn ngạch lương..."
                options={grades
                  .filter((g) => g.status === 'ACTIVE' || g.id === gradeId)
                  .map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))}
                onChange={(v) => {
                  setGradeId(v || '');
                  setStepId('');
                  if (v) void loadSteps(v);
                }}
              />
            </div>
            <div>
              <span className="mb-1 block font-semibold text-slate-700">Bậc lương</span>
              <SearchableSelect
                value={stepId}
                clearable
                placeholder={gradeId ? 'Chọn bậc lương...' : 'Chọn ngạch trước'}
                options={formSteps
                  .filter((s) => s.status === 'ACTIVE' || s.id === stepId)
                  .map((s) => ({
                    value: s.id,
                    label: `Bậc ${s.stepNo} - cơ bản ${formatMoneyVnd(s.baseSalary)}`,
                  }))}
                onChange={(v) => {
                  setStepId(v || '');
                  const step = formSteps.find((s) => s.id === v);
                  if (step) setBaseSalary(String(step.baseSalary));
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold text-slate-700">
                Mức lương tháng (VND) *
                <Input
                  type="number"
                  min={0}
                  value={baseSalary}
                  onChange={(e) => setBaseSalary(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs font-bold text-blue-700"
                />
              </label>
              <div>
                <span className="mb-1 block font-semibold text-slate-700">Loại lương</span>
                <SearchableSelect
                  value={salaryType}
                  clearable={false}
                  options={SALARY_TYPE_OPTIONS}
                  onChange={(v) => setSalaryType(v || 'GROSS')}
                />
              </div>
            </div>
            <div>
              <span className="mb-1 block font-semibold text-slate-700">Hiệu lực từ *</span>
              <DatePickerInput value={effectiveFrom} onChange={(v: string) => setEffectiveFrom(v)} />
            </div>
            <label className="block font-semibold text-slate-700">
              Căn cứ thay đổi *
              <Input
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="Ví dụ: Điều chỉnh sau thử việc, tăng lương định kỳ"
                className="mt-1 h-8 text-xs"
              />
            </label>
          </div>
          {formError && (
            <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 bg-[#021E73] text-xs font-semibold text-white hover:bg-blue-900"
              disabled={saving || !canManage}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Lưu hồ sơ lương'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
