'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type {
  HrmJobDescriptionItem,
  HrmPersonnelDecision,
  HrmPersonnelDecisionType,
  HrmSalaryGrade,
  HrmSalaryGradeStep,
} from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import {
  createPersonnelDecision,
  updatePersonnelDecision,
  useAppointmentContext,
} from '../hrm-personnel-decisions-api';
import {
  DECISION_TYPES,
  DECISION_TYPE_LABELS,
  buildDecisionPayload,
  decisionToForm,
  emptyDecisionForm,
  formatMoney,
  isPositionChanging,
  showsTargetPosition,
  validateDecisionForm,
  type DecisionFormState,
} from '../personnel-decision-rules';
import { Button } from './button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { DatePickerInput } from './date-picker-input';
import { toast } from './toast';

const typeOptions: SearchableSelectOption[] = DECISION_TYPES.map((t) => ({
  value: t,
  label: DECISION_TYPE_LABELS[t],
}));

const salaryTypeOptions: SearchableSelectOption[] = [
  { value: 'GROSS', label: 'Gross' },
  { value: 'NET', label: 'Net' },
];

const labelCls = 'block text-xs font-semibold text-slate-700 space-y-1';
const inputCls =
  'w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={labelCls}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function CompareRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-1.5 pr-2 text-slate-500">{label}</td>
      <td className="py-1.5 pr-2 font-semibold text-slate-800">{before}</td>
      <td
        className={`py-1.5 font-semibold ${changed ? 'text-blue-700' : 'text-slate-800'}`}
      >
        {after}
      </td>
    </tr>
  );
}

export interface PersonnelDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nhân viên điền sẵn khi tạo mới. */
  initialEmployeeId?: string;
  /** Có giá trị: chỉnh sửa quyết định nháp. */
  decision?: HrmPersonnelDecision | null;
  onSaved?: (decision: HrmPersonnelDecision) => void;
}

export function PersonnelDecisionDialog({
  open,
  onOpenChange,
  initialEmployeeId,
  decision,
  onSaved,
}: PersonnelDecisionDialogProps) {
  const editing = Boolean(decision);
  const [form, setForm] = useState<DecisionFormState>(emptyDecisionForm());
  const [employees, setEmployees] = useState<SearchableSelectOption[]>([]);
  const [positions, setPositions] = useState<HrmJobDescriptionItem[]>([]);
  const [grades, setGrades] = useState<HrmSalaryGrade[]>([]);
  const [steps, setSteps] = useState<HrmSalaryGradeStep[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Khởi tạo form mỗi lần mở.
  useEffect(() => {
    if (!open) return;
    setShowErrors(false);
    setForm(
      decision ? decisionToForm(decision) : emptyDecisionForm(initialEmployeeId),
    );
  }, [open, decision, initialEmployeeId]);

  // Tải danh mục.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      hrmEmployeeOptions(),
      hrmFetch<{ data: HrmJobDescriptionItem[] }>('/positions'),
      hrmFetch<{ data: HrmSalaryGrade[] }>('/salary-grades'),
    ])
      .then(([e, p, g]) => {
        if (!active) return;
        setEmployees(e);
        setPositions(p.data ?? []);
        setGrades((g.data ?? []).filter((x) => x.status === 'ACTIVE'));
      })
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : 'Không tải được danh mục',
        ),
      );
    return () => {
      active = false;
    };
  }, [open]);

  // Bậc lương lọc theo ngạch.
  useEffect(() => {
    if (!open || !form.toSalaryGradeId) {
      setSteps([]);
      return;
    }
    let active = true;
    void hrmFetch<{ data: HrmSalaryGradeStep[] }>(
      `/salary-grades/${form.toSalaryGradeId}/steps`,
    )
      .then((r) => {
        if (active) setSteps(r.data ?? []);
      })
      .catch(() => {
        if (active) setSteps([]);
      });
    return () => {
      active = false;
    };
  }, [open, form.toSalaryGradeId]);

  const context = useAppointmentContext(open ? form.employeeId : null);
  const ctx = context.data;
  const noAccount =
    Boolean(ctx) && !ctx?.hasAccount && isPositionChanging(form.decisionType);

  const positionOptions = useMemo<SearchableSelectOption[]>(
    () =>
      positions
        .filter((p) => p.active)
        .map((p) => ({
          value: p.positionId,
          label: p.positionName,
          badge: p.positionCode,
          description: p.unit?.name,
        })),
    [positions],
  );
  const gradeOptions = useMemo<SearchableSelectOption[]>(
    () =>
      grades.map((g) => ({ value: g.id, label: g.name, badge: g.code })),
    [grades],
  );
  const stepOptions = useMemo<SearchableSelectOption[]>(
    () =>
      steps
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => ({
          value: s.id,
          label: `Bậc ${s.stepNo} - ${formatMoney(s.baseSalary)}`,
        })),
    [steps],
  );
  const errors = validateDecisionForm(form, {
    hasAccount: ctx ? ctx.hasAccount : undefined,
  });
  const blockedByAccount = noAccount;

  function patch(p: Partial<DecisionFormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function changeType(t: HrmPersonnelDecisionType) {
    patch({
      decisionType: t,
      toPositionNodeId: showsTargetPosition(t) ? form.toPositionNodeId : '',
    });
  }

  function changeStep(stepId: string) {
    const step = steps.find((s) => s.id === stepId);
    patch({
      toSalaryStepId: stepId,
      toBaseSalary:
        step && Number(step.baseSalary) > 0
          ? String(step.baseSalary)
          : form.toBaseSalary,
    });
  }

  const targetPosition = positions.find(
    (p) => p.positionId === form.toPositionNodeId,
  );
  const afterPosition = showsTargetPosition(form.decisionType)
    ? (targetPosition?.positionName ?? '----')
    : form.decisionType === 'DISMISS'
      ? 'Miễn nhiệm'
      : (ctx?.positionName ?? '----');

  async function submit() {
    setShowErrors(true);
    if (errors.length) return;
    setSubmitting(true);
    try {
      const payload = buildDecisionPayload(form);
      const saved =
        editing && decision
          ? await updatePersonnelDecision(decision.id, {
              ...payload,
              version: decision.version,
            })
          : await createPersonnelDecision(payload);
      toast.success(
        editing ? 'Đã cập nhật quyết định nháp' : 'Đã tạo quyết định nháp',
      );
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Không lưu được quyết định',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] p-0">
        <DialogHeader className="shrink-0 border-b border-slate-200 p-5">
          <DialogTitle className="text-base font-bold">
            {editing
              ? `Sửa quyết định ${decision?.decisionNo ?? ''}`
              : 'Tạo quyết định nhân sự'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Nhân viên">
              <SearchableSelect
                options={employees}
                value={form.employeeId}
                disabled={editing}
                placeholder="Chọn nhân viên"
                onChange={(v) => patch({ employeeId: v })}
              />
            </Field>
            <Field label="Loại quyết định">
              <SearchableSelect
                options={typeOptions}
                value={form.decisionType}
                disabled={editing}
                onChange={(v) => changeType(v as HrmPersonnelDecisionType)}
              />
            </Field>
            <Field label="Ngày hiệu lực">
              <DatePickerInput
                height={38}
                value={form.effectiveDate}
                onChange={(v) => patch({ effectiveDate: v })}
              />
            </Field>
            {showsTargetPosition(form.decisionType) && (
              <Field label="Chức danh mới">
                <SearchableSelect
                  options={positionOptions}
                  value={form.toPositionNodeId}
                  placeholder="Chọn chức danh"
                  clearable
                  onChange={(v) => patch({ toPositionNodeId: v })}
                />
              </Field>
            )}
          </div>

          <Field label="Lý do / căn cứ">
            <textarea
              className={`${inputCls} h-20 py-2`}
              value={form.reason}
              onChange={(e) => patch({ reason: e.target.value })}
              placeholder="Nhập lý do hoặc căn cứ ban hành quyết định"
            />
          </Field>

          {context.loading && (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              Đang tải hiện trạng nhân viên...
            </div>
          )}
          {context.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700"
            >
              {context.error}
            </div>
          )}
          {blockedByAccount && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-800"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Nhân viên chưa liên kết tài khoản nên không thể bổ nhiệm vào
                chức danh ở Core. Hãy liên kết tài khoản tại màn hình Nhân sự
                &amp; Chức danh trước khi tạo quyết định này.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <section className="rounded-lg border border-slate-200 p-3">
              <h4 className="mb-2 text-[11px] font-bold uppercase text-slate-700">
                Trước / Sau
              </h4>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-400">
                    <th className="w-24 pb-1" />
                    <th className="pb-1">Trước</th>
                    <th className="pb-1">Sau</th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow
                    label="Chức danh"
                    before={ctx?.positionName ?? '----'}
                    after={afterPosition}
                    changed={afterPosition !== (ctx?.positionName ?? '----')}
                  />
                  <CompareRow
                    label="Đơn vị"
                    before={ctx?.unitName ?? '----'}
                    after={
                      showsTargetPosition(form.decisionType)
                        ? (targetPosition?.unit?.name ?? '----')
                        : (ctx?.unitName ?? '----')
                    }
                    changed={showsTargetPosition(form.decisionType)}
                  />
                  <CompareRow
                    label="Lương cơ bản"
                    before={formatMoney(ctx?.salary?.baseSalary)}
                    after={
                      form.salaryChanged
                        ? formatMoney(Number(form.toBaseSalary) || null)
                        : formatMoney(ctx?.salary?.baseSalary)
                    }
                    changed={form.salaryChanged}
                  />
                </tbody>
              </table>
            </section>
          </div>

          <section className="space-y-3 rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <input
                type="checkbox"
                checked={form.salaryChanged}
                onChange={(e) => patch({ salaryChanged: e.target.checked })}
              />
              Thay đổi lương
            </label>
            {form.salaryChanged && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Field label="Ngạch lương">
                  <SearchableSelect
                    options={gradeOptions}
                    value={form.toSalaryGradeId}
                    placeholder="Chọn ngạch"
                    onChange={(v) =>
                      patch({
                        toSalaryGradeId: v,
                        toSalaryStepId: '',
                      })
                    }
                  />
                </Field>
                <Field label="Bậc lương">
                  <SearchableSelect
                    options={stepOptions}
                    value={form.toSalaryStepId}
                    disabled={!form.toSalaryGradeId}
                    placeholder="Chọn bậc"
                    onChange={changeStep}
                  />
                </Field>
                <Field label="Loại lương">
                  <SearchableSelect
                    options={salaryTypeOptions}
                    value={form.toSalaryType}
                    onChange={(v) =>
                      patch({ toSalaryType: v === 'NET' ? 'NET' : 'GROSS' })
                    }
                  />
                </Field>
                <Field label="Lương cơ bản (đ)">
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    value={form.toBaseSalary}
                    onChange={(e) => patch({ toBaseSalary: e.target.value })}
                  />
                </Field>
              </div>
            )}
          </section>

          {showErrors && errors.length > 0 && (
            <ul
              role="alert"
              className="list-disc space-y-0.5 rounded-lg border border-red-200 bg-red-50 p-3 pl-7 font-semibold text-red-700"
            >
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Đóng
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={submitting || blockedByAccount}
            onClick={() => void submit()}
          >
            {submitting ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Tạo quyết định'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
