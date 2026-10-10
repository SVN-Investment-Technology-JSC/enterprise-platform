'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers, Loader2, Pencil, Plus } from 'lucide-react';
import type {
  HrmSalaryGrade,
  HrmSalaryGradeStep,
} from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { formatMoneyVnd } from '../hrm-salary-format';
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
import { GradeLifecycleActions, SalaryStepActions } from './hrm-lifecycle-actions';
import { Input } from './input';
import { toast } from './toast';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Ngạch và bậc lương: danh mục ngạch, các bậc (min/base/max) và vòng đời của chúng. */
export function SalaryGradesPanel() {
  const [grades, setGrades] = useState<HrmSalaryGrade[]>([]);
  const [steps, setSteps] = useState<HrmSalaryGradeStep[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [gradeOpen, setGradeOpen] = useState(false);
  const [editing, setEditing] = useState<HrmSalaryGrade | null>(null);
  const [gradeCode, setGradeCode] = useState('');
  const [gradeName, setGradeName] = useState('');
  const [gradeDescription, setGradeDescription] = useState('');
  const [gradeStatus, setGradeStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [gradeError, setGradeError] = useState('');

  const [stepOpen, setStepOpen] = useState(false);
  const [stepNo, setStepNo] = useState('1');
  const [minSalary, setMinSalary] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [maxSalary, setMaxSalary] = useState('');
  const [stepFrom, setStepFrom] = useState(todayIso());
  const [stepError, setStepError] = useState('');

  const activeGrade = useMemo(
    () => grades.find((g) => g.id === selectedId) ?? grades[0],
    [grades, selectedId],
  );

  const loadGrades = useCallback(async (preferId?: string) => {
    try {
      const result = await hrmFetch<{ data: HrmSalaryGrade[] }>('/salary-grades');
      const list = result.data ?? [];
      setGrades(list);
      setError('');
      setSelectedId((current) => {
        const wanted = preferId || current;
        return list.some((g) => g.id === wanted) ? wanted : (list[0]?.id ?? '');
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được ngạch lương');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSteps = useCallback(async (gradeId: string) => {
    if (!gradeId) {
      setSteps([]);
      return;
    }
    setStepsLoading(true);
    try {
      const result = await hrmFetch<{ data: HrmSalaryGradeStep[] }>(
        `/salary-grades/${gradeId}/steps`,
      );
      setSteps(result.data ?? []);
      setError('');
    } catch (e) {
      setSteps([]);
      setError(e instanceof Error ? e.message : 'Không tải được bậc lương');
    } finally {
      setStepsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  const activeId = activeGrade?.id ?? '';
  useEffect(() => {
    void loadSteps(activeId);
  }, [activeId, loadSteps]);

  function openCreateGrade() {
    setEditing(null);
    setGradeCode('');
    setGradeName('');
    setGradeDescription('');
    setGradeStatus('ACTIVE');
    setGradeError('');
    setGradeOpen(true);
  }

  function openEditGrade(grade: HrmSalaryGrade) {
    setEditing(grade);
    setGradeCode(grade.code);
    setGradeName(grade.name);
    setGradeDescription(grade.description || '');
    setGradeStatus(grade.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
    setGradeError('');
    setGradeOpen(true);
  }

  async function saveGrade() {
    if (!gradeName.trim()) return setGradeError('Vui lòng nhập tên ngạch lương.');
    if (!editing && !gradeCode.trim())
      return setGradeError('Vui lòng nhập mã ngạch lương (ví dụ GR-ENG).');
    setSaving(true);
    setGradeError('');
    try {
      if (editing) {
        await hrmFetch(`/salary-grades/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: gradeName.trim(),
            description: gradeDescription.trim() || undefined,
            status: gradeStatus,
            expectedUpdatedAt: editing.updatedAt,
          }),
        });
        toast.success(`Đã cập nhật ngạch ${editing.code}`);
        setGradeOpen(false);
        await loadGrades();
      } else {
        const created = await hrmFetch<{ data?: { id?: string } }>(
          '/salary-grades',
          {
            method: 'POST',
            body: JSON.stringify({
              code: gradeCode.trim().toUpperCase(),
              name: gradeName.trim(),
              description: gradeDescription.trim() || undefined,
              status: gradeStatus,
            }),
          },
        );
        toast.success(`Đã tạo ngạch ${gradeCode.trim().toUpperCase()}`);
        setGradeOpen(false);
        await loadGrades(created.data?.id);
      }
    } catch (e) {
      setGradeError(
        e instanceof Error ? e.message : 'Không lưu được ngạch lương',
      );
    } finally {
      setSaving(false);
    }
  }

  function openCreateStep() {
    const next = steps.reduce((max, s) => Math.max(max, Number(s.stepNo) || 0), 0) + 1;
    setStepNo(String(next));
    setMinSalary('');
    setBaseSalary('');
    setMaxSalary('');
    setStepFrom(todayIso());
    setStepError('');
    setStepOpen(true);
  }

  async function saveStep() {
    if (!activeGrade) return setStepError('Chưa chọn ngạch lương.');
    const min = Number(minSalary);
    const base = Number(baseSalary);
    const max = Number(maxSalary);
    const no = Number.parseInt(stepNo, 10);
    if (!Number.isInteger(no) || no < 1)
      return setStepError('Số thứ tự bậc phải là số nguyên từ 1.');
    if (
      [minSalary, baseSalary, maxSalary].some((v) => v.trim() === '') ||
      ![min, base, max].every((v) => Number.isFinite(v) && v >= 0)
    )
      return setStepError('Nhập đủ mức sàn, mức cơ bản và mức trần (số không âm).');
    if (min > base || base > max)
      return setStepError(
        'Mức sàn phải nhỏ hơn hoặc bằng mức cơ bản, mức cơ bản phải nhỏ hơn hoặc bằng mức trần.',
      );
    if (!stepFrom) return setStepError('Chọn ngày bắt đầu hiệu lực.');
    setSaving(true);
    setStepError('');
    try {
      await hrmFetch(`/salary-grades/${activeGrade.id}/steps`, {
        method: 'POST',
        body: JSON.stringify({
          stepNo: no,
          minSalary: min,
          midSalary: (min + max) / 2,
          maxSalary: max,
          baseSalary: base,
          effectiveFrom: stepFrom,
        }),
      });
      toast.success(`Đã thêm bậc ${no} cho ngạch ${activeGrade.code}`);
      setStepOpen(false);
      await loadSteps(activeGrade.id);
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Không thêm được bậc lương');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs lg:col-span-4">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-blue-700" />
              <h3 className="text-sm font-bold text-slate-900">Ngạch lương</h3>
              <Badge className="bg-blue-100 text-[10px] font-bold text-blue-800">
                {grades.length} ngạch
              </Badge>
            </div>
            <Button
              permission="hrm.salary.manage"
              size="sm"
              variant="outline"
              className="h-7 border-blue-300 px-2 text-xs text-blue-700 hover:bg-blue-50"
              onClick={openCreateGrade}
            >
              <Plus className="mr-1 size-3.5" />
              <span>Thêm ngạch</span>
            </Button>
          </div>
          <div className="max-h-[calc(100vh-22rem)] min-h-40 space-y-2.5 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-400">
                <Loader2 className="size-4 animate-spin" />
                <span>Đang tải ngạch lương...</span>
              </div>
            ) : grades.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-400">
                Chưa có ngạch lương nào.
              </p>
            ) : (
              grades.map((g) => {
                const selected = g.id === activeGrade?.id;
                return (
                  <div
                    key={g.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => setSelectedId(g.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(g.id);
                      }
                    }}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                      selected
                        ? 'border-blue-600 bg-blue-50/40 shadow-xs ring-1 ring-blue-600/30'
                        : 'border-slate-200 bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-md border border-blue-200/80 bg-blue-50 px-2 py-0.5 font-mono text-xs font-bold text-blue-700">
                            {g.code}
                          </span>
                          <Badge
                            className={
                              g.status === 'ACTIVE'
                                ? 'border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-[10px] text-slate-600'
                            }
                          >
                            {g.status === 'ACTIVE' ? 'Đang dùng' : 'Đã ngừng'}
                          </Badge>
                        </div>
                        <h4 className="pt-0.5 text-xs font-semibold text-slate-900">
                          {g.name}
                        </h4>
                      </div>
                      <Button
                        permission="hrm.salary.manage"
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Sửa ngạch ${g.code}`}
                        className="size-7 shrink-0 rounded-md p-0 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditGrade(g);
                        }}
                        title="Chỉnh sửa ngạch lương"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                    {g.description && (
                      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                        {g.description}
                      </p>
                    )}
                    <div className="mt-2.5 flex items-center justify-end border-t border-slate-100 pt-2.5">
                      <GradeLifecycleActions grade={g} onChanged={() => loadGrades()} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs lg:col-span-8">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Bậc lương của ngạch{' '}
                <span className="font-mono text-blue-700">{activeGrade?.code}</span>
              </h3>
              <p className="text-xs text-slate-500">{activeGrade?.name}</p>
            </div>
            <Button
              permission="hrm.salary.manage"
              size="sm"
              disabled={!activeGrade}
              className="h-8 gap-1.5 bg-[#021E73] text-xs font-semibold text-white hover:bg-blue-900"
              onClick={openCreateStep}
            >
              <Plus className="size-3.5" />
              <span>Thêm bậc lương</span>
            </Button>
          </div>
          <div className="max-h-[calc(100vh-22rem)] min-h-40 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3.5">Bậc</th>
                  <th className="px-4 py-3.5 text-right">Mức sàn</th>
                  <th className="px-4 py-3.5 text-right">Cơ bản chuẩn</th>
                  <th className="px-4 py-3.5 text-right">Mức trần</th>
                  <th className="px-4 py-3.5">Ngày hiệu lực</th>
                  <th className="px-4 py-3.5">Trạng thái và thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {stepsLoading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Đang tải bậc lương...
                    </td>
                  </tr>
                ) : steps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Ngạch này chưa có bậc lương nào được thiết lập.
                    </td>
                  </tr>
                ) : (
                  steps.map((step) => (
                    <tr key={step.id} className="transition-colors hover:bg-slate-50/80">
                      <td className="px-4 py-3.5">
                        <Badge className="bg-blue-100 font-mono text-xs font-bold text-blue-800">
                          Bậc {step.stepNo}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-600">
                        {formatMoneyVnd(step.minSalary)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-blue-700">
                        {formatMoneyVnd(step.baseSalary)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-600">
                        {formatMoneyVnd(step.maxSalary)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-500">
                        {step.effectiveFrom
                          ? String(step.effectiveFrom).slice(0, 10)
                          : 'Vô thời hạn'}
                      </td>
                      <td className="px-3 py-2">
                        <SalaryStepActions
                          step={step}
                          onChanged={() => loadSteps(step.salaryGradeId)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Dialog
        open={stepOpen}
        onOpenChange={(open) => {
          if (!saving) setStepOpen(open);
        }}
      >
        <DialogContent className="max-w-md space-y-4 bg-white p-6">
          <DialogHeader>
            <DialogTitle>Thêm bậc lương cho ngạch {activeGrade?.code ?? ''}</DialogTitle>
            <DialogDescription>
              Ràng buộc: mức sàn nhỏ hơn hoặc bằng mức cơ bản, mức cơ bản nhỏ hơn hoặc bằng mức trần.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <label className="block font-semibold text-slate-700">
              Số thứ tự bậc *
              <Input
                type="number"
                min={1}
                value={stepNo}
                onChange={(e) => setStepNo(e.target.value)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </label>
            <label className="block font-semibold text-slate-700">
              Mức sàn (VND) *
              <Input
                type="number"
                min={0}
                value={minSalary}
                onChange={(e) => setMinSalary(e.target.value)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </label>
            <label className="block font-semibold text-slate-700">
              Lương cơ bản chuẩn (VND) *
              <Input
                type="number"
                min={0}
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                className="mt-1 h-8 font-mono text-xs font-bold text-blue-700"
              />
            </label>
            <label className="block font-semibold text-slate-700">
              Mức trần (VND) *
              <Input
                type="number"
                min={0}
                value={maxSalary}
                onChange={(e) => setMaxSalary(e.target.value)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </label>
            <div>
              <span className="mb-1 block font-semibold text-slate-700">
                Ngày bắt đầu hiệu lực *
              </span>
              <DatePickerInput value={stepFrom} onChange={(v: string) => setStepFrom(v)} />
            </div>
          </div>
          {stepError && (
            <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {stepError}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setStepOpen(false)}
              disabled={saving}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 bg-[#021E73] text-xs font-semibold text-white hover:bg-blue-900"
              permission="hrm.salary.manage"
              onClick={() => void saveStep()}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Lưu bậc lương'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={gradeOpen}
        onOpenChange={(open) => {
          if (!saving) setGradeOpen(open);
        }}
      >
        <DialogContent className="max-w-md space-y-4 bg-white p-6">
          <DialogHeader>
            <DialogTitle>{editing ? 'Chỉnh sửa ngạch lương' : 'Thêm ngạch lương mới'}</DialogTitle>
            <DialogDescription>
              Danh mục ngạch lương dùng để gắn với chức danh và thang bậc.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <label className="block font-semibold text-slate-700">
              Mã ngạch lương *
              <Input
                value={gradeCode}
                onChange={(e) => setGradeCode(e.target.value.toUpperCase())}
                placeholder="Ví dụ: GR-ENG"
                disabled={Boolean(editing)}
                className="mt-1 h-8 font-mono text-xs font-bold"
              />
            </label>
            <label className="block font-semibold text-slate-700">
              Tên ngạch lương *
              <Input
                value={gradeName}
                onChange={(e) => setGradeName(e.target.value)}
                placeholder="Ví dụ: Ngạch kỹ sư phần mềm"
                className="mt-1 h-8 text-xs"
              />
            </label>
            <label className="block font-semibold text-slate-700">
              Mô tả ngạch
              <Input
                value={gradeDescription}
                onChange={(e) => setGradeDescription(e.target.value)}
                placeholder="Ví dụ: Dành cho các vị trí kỹ thuật công nghệ"
                className="mt-1 h-8 text-xs"
              />
            </label>
            <div>
              <span className="mb-1 block font-semibold text-slate-700">Trạng thái ngạch</span>
              <SearchableSelect
                value={gradeStatus}
                clearable={false}
                onChange={(value) => setGradeStatus(value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')}
                options={[
                  { value: 'ACTIVE', label: 'Đang dùng' },
                  { value: 'INACTIVE', label: 'Ngừng hoạt động' },
                ]}
              />
            </div>
          </div>
          {gradeError && (
            <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {gradeError}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setGradeOpen(false)}
              disabled={saving}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 bg-[#021E73] text-xs font-semibold text-white hover:bg-blue-900"
              permission="hrm.salary.manage"
              onClick={() => void saveGrade()}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : editing ? 'Lưu thay đổi' : 'Tạo ngạch lương'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
