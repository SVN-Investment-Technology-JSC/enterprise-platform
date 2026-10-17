'use client';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Layers, ListOrdered, Loader2, Plus } from 'lucide-react';
import type { HrmSalaryGrade, HrmSalaryGradeStep } from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { formatMoneyVnd } from '../hrm-salary-format';
import { Button } from './button';
import { DatePickerInput } from './date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';
import { Input } from './input';
import { EmptyPanel, IconTile, InfoNote, SettingsField, StatusPill } from './settings-kit';
import { ActionMenu, DataList, type ActionItem, type DataColumn } from './payroll-settings/data-rows';
import { toast } from './toast';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Đổi trạng thái (Ngừng/Kích hoạt) và xóa một ngạch hoặc bậc: cùng API và xác nhận như bản cũ. */
function lifecycleItems({
  path,
  version,
  active,
  label,
  canManage,
  onChanged,
}: {
  path: string;
  version: string;
  active: boolean;
  label: string;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}): ActionItem[] {
  return [
    {
      key: 'status',
      label: active ? 'Ngừng sử dụng' : 'Kích hoạt lại',
      hidden: !canManage,
      confirm: {
        title: active ? 'Ngừng sử dụng cấu hình này?' : 'Kích hoạt lại cấu hình này?',
        okType: 'primary',
        onConfirm: async () => {
          try {
            await hrmFetch(path, {
              method: 'PATCH',
              body: JSON.stringify({ expectedUpdatedAt: version, status: active ? 'INACTIVE' : 'ACTIVE' }),
            });
            await onChanged();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Không thể đổi trạng thái');
          }
        },
      },
    },
    {
      key: 'remove',
      label: 'Xóa',
      tone: 'danger',
      hidden: !canManage,
      confirm: {
        title: `Xóa ${label}?`,
        description: 'Chỉ xóa cấu hình chưa được sử dụng. Bản ghi có lịch sử phải ngừng hiệu lực.',
        okText: 'Xóa',
        cancelText: 'Quay lại',
        okType: 'danger',
        onConfirm: async () => {
          try {
            await hrmFetch(path, { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: version }) });
            await onChanged();
            toast.success('Đã xóa cấu hình chưa sử dụng');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Không thể xóa');
          }
        },
      },
    },
  ];
}

/** Ngạch và bậc lương: danh mục ngạch, các bậc (min/base/max) và vòng đời của chúng. */
export function SalaryGradesPanel() {
  const { can } = useHrmPermissions();
  const canManage = can('hrm.salary.manage');
  const uid = useId();
  const [grades, setGrades] = useState<HrmSalaryGrade[]>([]);
  const [steps, setSteps] = useState<HrmSalaryGradeStep[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<HrmAction | null>(null);

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

  const activeGrade = useMemo(() => grades.find((g) => g.id === selectedId) ?? grades[0], [grades, selectedId]);

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
      const result = await hrmFetch<{ data: HrmSalaryGradeStep[] }>(`/salary-grades/${gradeId}/steps`);
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
    if (!editing && !gradeCode.trim()) return setGradeError('Vui lòng nhập mã ngạch lương (ví dụ GR-ENG).');
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
        const created = await hrmFetch<{ data?: { id?: string } }>('/salary-grades', {
          method: 'POST',
          body: JSON.stringify({
            code: gradeCode.trim().toUpperCase(),
            name: gradeName.trim(),
            description: gradeDescription.trim() || undefined,
            status: gradeStatus,
          }),
        });
        toast.success(`Đã tạo ngạch ${gradeCode.trim().toUpperCase()}`);
        setGradeOpen(false);
        await loadGrades(created.data?.id);
      }
    } catch (e) {
      setGradeError(e instanceof Error ? e.message : 'Không lưu được ngạch lương');
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
    if (!Number.isInteger(no) || no < 1) return setStepError('Số thứ tự bậc phải là số nguyên từ 1.');
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

  /** Sửa một bậc (PATCH như bản cũ) qua hộp thoại thao tác. */
  function editStep(step: HrmSalaryGradeStep) {
    const path = `/salary-grades/${step.salaryGradeId}/steps/${step.id}`;
    setAction({
      title: `Cập nhật bậc ${step.stepNo}`,
      columns: 2,
      fields: [
        { key: 'minSalary', label: 'Lương tối thiểu', type: 'number', min: 0, value: step.minSalary },
        { key: 'midSalary', label: 'Lương trung vị', type: 'number', min: 0, value: step.midSalary },
        { key: 'maxSalary', label: 'Lương tối đa', type: 'number', min: 0, value: step.maxSalary },
        { key: 'baseSalary', label: 'Lương cơ bản', type: 'number', min: 0, value: step.baseSalary },
        { key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date', value: step.effectiveFrom },
        { key: 'effectiveTo', label: 'Hiệu lực đến', type: 'date', value: step.effectiveTo || '', optional: true },
      ],
      submit: async (values) => {
        await hrmFetch(path, {
          method: 'PATCH',
          body: JSON.stringify({
            ...values,
            minSalary: Number(values.minSalary),
            midSalary: Number(values.midSalary),
            maxSalary: Number(values.maxSalary),
            baseSalary: Number(values.baseSalary),
            effectiveTo: values.effectiveTo || null,
            expectedUpdatedAt: step.updatedAt,
          }),
        });
        await loadSteps(step.salaryGradeId);
      },
    });
  }

  const stepColumns: DataColumn<HrmSalaryGradeStep>[] = [
    {
      key: 'step',
      header: 'Bậc',
      width: '90px',
      cardOrder: -1,
      cell: (s) => <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-800">Bậc {s.stepNo}</span>,
    },
    {
      key: 'min',
      header: 'Mức sàn',
      width: 'minmax(0,1fr)',
      align: 'right',
      cardLabel: true,
      cardOrder: 1,
      cell: (s) => <span className="font-mono text-slate-600">{formatMoneyVnd(s.minSalary)}</span>,
    },
    {
      key: 'base',
      header: 'Cơ bản chuẩn',
      width: 'minmax(0,1fr)',
      align: 'right',
      cardLabel: true,
      cardOrder: 1,
      cell: (s) => <span className="font-mono font-bold text-blue-700">{formatMoneyVnd(s.baseSalary)}</span>,
    },
    {
      key: 'max',
      header: 'Mức trần',
      width: 'minmax(0,1fr)',
      align: 'right',
      cardLabel: true,
      cardOrder: 1,
      cell: (s) => <span className="font-mono text-slate-600">{formatMoneyVnd(s.maxSalary)}</span>,
    },
    {
      key: 'from',
      header: 'Ngày hiệu lực',
      width: '120px',
      cardLabel: true,
      cardOrder: 2,
      cell: (s) => <span className="font-mono text-slate-500">{s.effectiveFrom ? String(s.effectiveFrom).slice(0, 10) : 'Vô thời hạn'}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '110px',
      cell: (s) => <StatusPill tone={s.status === 'ACTIVE' ? 'green' : 'slate'}>{s.status === 'ACTIVE' ? 'Đang dùng' : 'Đã ngừng'}</StatusPill>,
    },
    {
      key: 'actions',
      header: '',
      width: '48px',
      cardEnd: true,
      cell: (s) => (
        <ActionMenu
          label={`Thao tác bậc ${s.stepNo}`}
          items={[
            { key: 'edit', label: 'Sửa', hidden: !canManage, onSelect: () => editStep(s) },
            ...lifecycleItems({
              path: `/salary-grades/${s.salaryGradeId}/steps/${s.id}`,
              version: s.updatedAt,
              active: s.status === 'ACTIVE',
              label: `bậc ${s.stepNo}`,
              canManage,
              onChanged: () => loadSteps(s.salaryGradeId),
            }),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="@container space-y-4">
      {error && (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      )}

      <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[320px_minmax(0,1fr)]">
        <section aria-label="Ngạch lương" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <IconTile icon={Layers} size="sm" />
              <h3 className="text-sm font-bold text-slate-900">Ngạch lương</h3>
              <StatusPill tone="blue">{grades.length} ngạch</StatusPill>
            </div>
            <Button permission="hrm.salary.manage" variant="outline" className="h-8 gap-1 px-2.5 text-xs" onClick={openCreateGrade}>
              <Plus className="size-3.5" />
              <span>Thêm ngạch</span>
            </Button>
          </div>
          <div className="max-h-72 min-h-24 space-y-2 overflow-y-auto p-3 @4xl:max-h-[calc(100dvh-22rem)]">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-400">
                <Loader2 className="size-4 animate-spin" />
                <span>Đang tải ngạch lương...</span>
              </div>
            ) : grades.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-400">Chưa có ngạch lương nào.</p>
            ) : (
              grades.map((g) => {
                const selected = g.id === activeGrade?.id;
                return (
                  <div
                    key={g.id}
                    className={`flex items-start gap-1 rounded-xl border p-1.5 transition-colors ${
                      selected ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600/30' : 'border-slate-200 bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedId(g.id)}
                      className="min-w-0 flex-1 cursor-pointer rounded-lg p-1.5 text-left"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md border border-blue-200/80 bg-blue-50 px-2 py-0.5 font-mono text-xs font-bold text-blue-700">{g.code}</span>
                        <StatusPill tone={g.status === 'ACTIVE' ? 'green' : 'slate'}>{g.status === 'ACTIVE' ? 'Đang dùng' : 'Đã ngừng'}</StatusPill>
                      </span>
                      <span className="mt-1 block text-xs font-semibold break-words text-slate-900">{g.name}</span>
                      {g.description && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-slate-500">{g.description}</span>}
                    </button>
                    <ActionMenu
                      label={`Thao tác ngạch ${g.code}`}
                      items={[
                        { key: 'edit', label: 'Sửa ngạch', hidden: !canManage, onSelect: () => openEditGrade(g) },
                        ...lifecycleItems({
                          path: `/salary-grades/${g.id}`,
                          version: g.updatedAt,
                          active: g.status === 'ACTIVE',
                          label: g.code,
                          canManage,
                          onChanged: () => loadGrades(),
                        }),
                      ]}
                    />
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section aria-label="Bậc lương" className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 @xl:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <IconTile icon={ListOrdered} tone="violet" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">
                  Bậc lương của ngạch <span className="font-mono text-blue-700">{activeGrade?.code}</span>
                </h3>
                <p className="truncate text-xs text-slate-500">{activeGrade?.name}</p>
              </div>
            </div>
            <Button permission="hrm.salary.manage" disabled={!activeGrade} className="h-9 gap-1.5 px-3 text-xs font-semibold" onClick={openCreateStep}>
              <Plus className="size-3.5" />
              <span>Thêm bậc lương</span>
            </Button>
          </div>
          <div className="mt-3">
            {stepsLoading ? (
              <p className="p-8 text-center text-xs text-slate-400">Đang tải bậc lương...</p>
            ) : (
              <DataList
                label="Bậc lương"
                rows={steps}
                rowKey={(s) => s.id}
                columns={stepColumns}
                pageSize={10}
                empty={<EmptyPanel icon={ListOrdered} title="Ngạch này chưa có bậc lương nào được thiết lập." />}
              />
            )}
          </div>
        </section>
      </div>

      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}

      <Dialog open={stepOpen} onOpenChange={(open) => { if (!saving) setStepOpen(open); }}>
        <DialogContent className="@container flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-4 pr-12">
            <DialogTitle>Thêm bậc lương cho ngạch {activeGrade?.code ?? ''}</DialogTitle>
            <DialogDescription>
              Ràng buộc: mức sàn nhỏ hơn hoặc bằng mức cơ bản, mức cơ bản nhỏ hơn hoặc bằng mức trần.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
              <SettingsField label="Số thứ tự bậc" required htmlFor={`${uid}-no`}>
                <Input id={`${uid}-no`} type="number" min={1} value={stepNo} onChange={(e) => setStepNo(e.target.value)} className="h-9 font-mono text-xs" />
              </SettingsField>
              <SettingsField label="Ngày bắt đầu hiệu lực" required>
                <DatePickerInput height={36} value={stepFrom} onChange={(v: string) => setStepFrom(v)} />
              </SettingsField>
              <SettingsField label="Mức sàn (VND)" required htmlFor={`${uid}-min`}>
                <Input id={`${uid}-min`} type="number" min={0} value={minSalary} onChange={(e) => setMinSalary(e.target.value)} className="h-9 font-mono text-xs" />
              </SettingsField>
              <SettingsField label="Lương cơ bản chuẩn (VND)" required htmlFor={`${uid}-base`}>
                <Input id={`${uid}-base`} type="number" min={0} value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className="h-9 font-mono text-xs font-bold text-blue-700" />
              </SettingsField>
              <SettingsField label="Mức trần (VND)" required htmlFor={`${uid}-max`}>
                <Input id={`${uid}-max`} type="number" min={0} value={maxSalary} onChange={(e) => setMaxSalary(e.target.value)} className="h-9 font-mono text-xs" />
              </SettingsField>
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-t border-slate-200 bg-slate-50 p-3">
            {stepError && <InfoNote tone="red" role="alert">{stepError}</InfoNote>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="h-9 px-4 text-xs" onClick={() => setStepOpen(false)} disabled={saving}>Hủy</Button>
              <Button className="h-9 px-4 text-xs font-semibold" permission="hrm.salary.manage" onClick={() => void saveStep()} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Lưu bậc lương'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={gradeOpen} onOpenChange={(open) => { if (!saving) setGradeOpen(open); }}>
        <DialogContent className="@container flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden bg-white p-0">
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-4 pr-12">
            <DialogTitle>{editing ? 'Chỉnh sửa ngạch lương' : 'Thêm ngạch lương mới'}</DialogTitle>
            <DialogDescription>Danh mục ngạch lương dùng để gắn với chức danh và thang bậc.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <SettingsField label="Mã ngạch lương" required htmlFor={`${uid}-code`}>
              <Input
                id={`${uid}-code`}
                value={gradeCode}
                onChange={(e) => setGradeCode(e.target.value.toUpperCase())}
                placeholder="Ví dụ: GR-ENG"
                disabled={Boolean(editing)}
                className="h-9 font-mono text-xs font-bold"
              />
            </SettingsField>
            <SettingsField label="Tên ngạch lương" required htmlFor={`${uid}-name`}>
              <Input id={`${uid}-name`} value={gradeName} onChange={(e) => setGradeName(e.target.value)} placeholder="Ví dụ: Ngạch kỹ sư phần mềm" className="h-9 text-xs" />
            </SettingsField>
            <SettingsField label="Mô tả ngạch" htmlFor={`${uid}-desc`}>
              <Input id={`${uid}-desc`} value={gradeDescription} onChange={(e) => setGradeDescription(e.target.value)} placeholder="Ví dụ: Dành cho các vị trí kỹ thuật công nghệ" className="h-9 text-xs" />
            </SettingsField>
            <SettingsField label="Trạng thái ngạch">
              <SearchableSelect
                height={36}
                value={gradeStatus}
                clearable={false}
                onChange={(value) => setGradeStatus(value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')}
                options={[
                  { value: 'ACTIVE', label: 'Đang dùng' },
                  { value: 'INACTIVE', label: 'Ngừng hoạt động' },
                ]}
              />
            </SettingsField>
          </div>
          <div className="shrink-0 space-y-2 border-t border-slate-200 bg-slate-50 p-3">
            {gradeError && <InfoNote tone="red" role="alert">{gradeError}</InfoNote>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="h-9 px-4 text-xs" onClick={() => setGradeOpen(false)} disabled={saving}>Hủy</Button>
              <Button className="h-9 px-4 text-xs font-semibold" permission="hrm.salary.manage" onClick={() => void saveGrade()} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : editing ? 'Lưu thay đổi' : 'Tạo ngạch lương'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
