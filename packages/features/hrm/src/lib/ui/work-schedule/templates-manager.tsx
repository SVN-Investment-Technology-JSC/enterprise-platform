'use client';

import { useEffect, useState } from 'react';
import type {
  HrmApplyScheduleResult,
  HrmSchedulePreview,
  HrmScheduleTemplate,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  addDays,
  classifyScheduleError,
  patternFromRules,
  patternToRules,
  summarizePattern,
  todayIso,
  validateDateRange,
  validatePattern,
  type PatternRow,
} from '../../hrm-work-schedule-model';
import {
  copyTemplate,
  createTemplate,
  deactivateTemplate,
  reapplyTemplate,
  updateTemplate,
} from '../../hrm-work-schedule-api';
import { cn } from '../../utils';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { toast } from '../toast';
import { Checkbox, EmptyState, Field, Notice, Spinner, textareaClass } from './common';
import { PreviewPanel } from './preview-panel';
import { WeeklyPatternEditor } from './weekly-pattern-editor';

type View =
  | { name: 'list' }
  | { name: 'edit'; template: HrmScheduleTemplate | null }
  | { name: 'copy'; template: HrmScheduleTemplate }
  | { name: 'reapply'; template: HrmScheduleTemplate };

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

function TemplateForm({
  template,
  shifts,
  onSaved,
  onCancel,
}: {
  template: HrmScheduleTemplate | null;
  shifts: readonly HrmShiftDefinition[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(template?.code ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(template?.status ?? 'ACTIVE');
  const [pattern, setPattern] = useState<PatternRow[]>(patternFromRules(template?.days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const invalid =
      (!code.trim()
        ? 'Nhập mã mẫu lịch.'
        : !CODE_PATTERN.test(code.trim())
          ? 'Mã mẫu chỉ gồm chữ không dấu, số, gạch ngang và gạch dưới.'
          : null) ??
      (!name.trim() ? 'Nhập tên mẫu lịch.' : null) ??
      validatePattern(pattern);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim() || null,
      status,
      days: patternToRules(pattern),
    };
    try {
      if (template) await updateTemplate(template.id, body);
      else await createTemplate(body);
      toast.success(template ? 'Đã cập nhật mẫu lịch tuần.' : 'Đã tạo mẫu lịch tuần.');
      onSaved();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <div className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Mã mẫu">
            <Input aria-label="Mã mẫu" value={code} maxLength={50} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Tên mẫu">
            <Input aria-label="Tên mẫu" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Mô tả (tuỳ chọn)" className="max-w-2xl">
          <textarea className={textareaClass} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Checkbox
          checked={status === 'ACTIVE'}
          onChange={(on) => setStatus(on ? 'ACTIVE' : 'INACTIVE')}
          label="Đang hoạt động (cho phép chọn khi phân ca)"
        />
        <WeeklyPatternEditor pattern={pattern} onChange={setPattern} shifts={shifts} />
        {template ? (
          <Notice tone="info">
            Sửa mẫu không làm đổi lịch đã gán trước đó. Muốn áp mẫu mới cho lịch đã gán, dùng hành động Áp lại mẫu.
          </Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <Button variant="outline" onClick={onCancel}>
          Quay lại danh sách
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu mẫu lịch'}
        </Button>
      </div>
    </div>
  );
}

function CopyForm({
  template,
  onSaved,
  onCancel,
}: {
  template: HrmScheduleTemplate;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(`${template.code}_COPY`);
  const [name, setName] = useState(`${template.name} (bản sao)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!code.trim() || !CODE_PATTERN.test(code.trim()) || !name.trim()) {
      setError('Nhập mã (chữ không dấu, số, gạch ngang, gạch dưới) và tên cho bản sao.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await copyTemplate(template.id, { code: code.trim().toUpperCase(), name: name.trim() });
      toast.success('Đã sao chép mẫu lịch tuần.');
      onSaved();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 px-6 py-4">
        <p className="text-xs text-slate-600">
          Sao chép từ mẫu <strong>{template.name}</strong> ({template.code}).
        </p>
        <div className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Mã mẫu mới">
            <Input aria-label="Mã mẫu mới" value={code} maxLength={50} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Tên mẫu mới">
            <Input aria-label="Tên mẫu mới" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <Button variant="outline" onClick={onCancel}>
          Quay lại danh sách
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          Sao chép
        </Button>
      </div>
    </div>
  );
}

function ReapplyForm({
  template,
  onSaved,
  onCancel,
}: {
  template: HrmScheduleTemplate;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(addDays(todayIso(), 29));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: HrmSchedulePreview } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = JSON.stringify([fromDate, toDate]);
  const current = preview && preview.key === key ? preview.data : null;

  async function inspect() {
    const invalid = validateDateRange(fromDate, toDate);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    setConfirmed(false);
    try {
      const res = await reapplyTemplate(template.id, { fromDate, toDate, dryRun: true, reason: reason.trim() || undefined });
      setPreview({ key, data: res.data as HrmSchedulePreview });
    } catch (e) {
      setPreview(null);
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const writable = current ? current.summary.insert + current.summary.replace : 0;
  const canSave =
    !!current &&
    !busy &&
    writable > 0 &&
    current.summary.conflicts === 0 &&
    current.lockedPeriods.length === 0 &&
    confirmed;

  async function apply() {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const res = await reapplyTemplate(template.id, {
        fromDate,
        toDate,
        confirm: true,
        dryRun: false,
        reason: reason.trim() || undefined,
      });
      const data = res.data as HrmApplyScheduleResult;
      toast.success(`Đã áp lại mẫu cho ${data.employeeCount} nhân viên (${data.appliedDays} ngày).`);
      onSaved();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <Notice tone="warn" title="Áp lại mẫu cho lịch đã gán">
          Chỉ áp cho nhân viên từng được gán từ mẫu <strong>{template.name}</strong> trong khoảng ngày bên dưới; các
          ngày ngoại lệ và ngày lễ được giữ nguyên. Lịch cũ trong khoảng này sẽ bị thay bằng nội dung hiện tại của mẫu.
        </Notice>
        <div className="grid max-w-xl grid-cols-2 gap-4">
          <Field label="Từ ngày">
            <DatePickerInput aria-label="Từ ngày" value={fromDate} onChange={setFromDate} />
          </Field>
          <Field label="Đến ngày">
            <DatePickerInput aria-label="Đến ngày" value={toDate} onChange={setToDate} />
          </Field>
        </div>
        <Field label="Lý do (tuỳ chọn)" className="max-w-xl">
          <textarea className={textareaClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {busy && !current ? <Spinner label="Đang xem trước…" /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {current ? (
          <div className="flex flex-col gap-3">
            <PreviewPanel preview={current} />
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <ul className="list-disc pl-5 text-xs text-amber-800">
                {(current.confirmReasons.length
                  ? current.confirmReasons
                  : [`Ghi lại ${writable} ngày lịch của ${current.employeeCount} nhân viên`]
                ).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <Checkbox checked={confirmed} onChange={setConfirmed} label="Tôi đã xem lại phạm vi và đồng ý áp lại mẫu" />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <Button variant="outline" onClick={onCancel}>
          Quay lại danh sách
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void inspect()}>
            {current ? 'Xem trước lại' : 'Xem trước'}
          </Button>
          <Button disabled={!canSave} onClick={() => void apply()}>
            Áp lại mẫu
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TemplatesManager({
  open,
  onOpenChange,
  templates,
  loading,
  error,
  shifts,
  canManage,
  canBulk,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly HrmScheduleTemplate[];
  loading: boolean;
  error: string;
  shifts: readonly HrmShiftDefinition[];
  canManage: boolean;
  canBulk: boolean;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>({ name: 'list' });
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (open) {
      setView({ name: 'list' });
      setActionError('');
    }
  }, [open]);

  const back = () => setView({ name: 'list' });
  const saved = () => {
    onChanged();
    back();
  };

  async function deactivate(template: HrmScheduleTemplate) {
    setActionError('');
    try {
      await deactivateTemplate(template.id);
      toast.success(`Đã ngừng dùng mẫu ${template.code}.`);
      onChanged();
    } catch (e) {
      setActionError(classifyScheduleError(e).message);
    }
  }

  const title =
    view.name === 'edit'
      ? view.template
        ? 'Sửa mẫu lịch tuần'
        : 'Tạo mẫu lịch tuần'
      : view.name === 'copy'
        ? 'Sao chép mẫu lịch tuần'
        : view.name === 'reapply'
          ? 'Áp lại mẫu lịch tuần'
          : 'Mẫu lịch tuần';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88dvh,760px)] max-w-5xl" aria-label="Mẫu lịch tuần">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>
            Mẫu lịch tuần là cấu hình T2-CN dùng lại khi phân ca. Ca luôn lấy từ danh mục ca hiện có.
          </DialogDescription>
        </DialogHeader>

        {view.name === 'edit' ? (
          <TemplateForm template={view.template} shifts={shifts} onSaved={saved} onCancel={back} />
        ) : view.name === 'copy' ? (
          <CopyForm template={view.template} onSaved={saved} onCancel={back} />
        ) : view.name === 'reapply' ? (
          <ReapplyForm template={view.template} onSaved={saved} onCancel={back} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-2 px-6 pt-4">
              <Notice tone="info">
                Sửa một mẫu lịch không làm thay đổi lịch đã được gán trước đó (lịch đã sinh sẵn từng ngày). Dùng Áp lại
                để cập nhật lịch đã gán theo nội dung mới của mẫu.
              </Notice>
              {actionError ? <Notice tone="error">{actionError}</Notice> : null}
              {error ? <Notice tone="error">{error}</Notice> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
              {loading && templates.length === 0 ? (
                <EmptyState>
                  <Spinner label="Đang tải mẫu lịch…" />
                </EmptyState>
              ) : templates.length === 0 ? (
                <EmptyState>Chưa có mẫu lịch tuần nào. Tạo mẫu đầu tiên để dùng lại khi phân ca.</EmptyState>
              ) : (
                <table className="w-full border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr className="text-left text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                      {['Mã', 'Tên mẫu', 'Lịch trong tuần', 'Trạng thái', 'Thao tác'].map((h) => (
                        <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2 font-mono font-semibold text-blue-700">{t.code}</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <div className="font-semibold text-slate-900">{t.name}</div>
                          {t.description ? <div className="text-[11px] text-slate-500">{t.description}</div> : null}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                          {summarizePattern(t.days, shifts)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                              t.status === 'ACTIVE'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-500',
                            )}
                          >
                            {t.status === 'ACTIVE' ? 'Đang hoạt động' : 'Ngừng dùng'}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {canManage ? (
                              <>
                                <Button size="sm" variant="outline" onClick={() => setView({ name: 'edit', template: t })}>
                                  Sửa
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setView({ name: 'copy', template: t })}>
                                  Sao chép
                                </Button>
                              </>
                            ) : null}
                            {canBulk ? (
                              <Button size="sm" variant="outline" onClick={() => setView({ name: 'reapply', template: t })}>
                                Áp lại
                              </Button>
                            ) : null}
                            {canManage && t.status === 'ACTIVE' ? (
                              <Popconfirm
                                title={`Ngừng dùng mẫu ${t.code}?`}
                                description="Mẫu sẽ không còn xuất hiện khi phân ca. Lịch đã gán vẫn được giữ nguyên."
                                okText="Ngừng dùng"
                                cancelText="Không"
                                okType="danger"
                                placement="left"
                                onConfirm={() => deactivate(t)}
                              >
                                <Button size="sm" variant="destructive">
                                  Ngừng dùng
                                </Button>
                              </Popconfirm>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
              {canManage ? <Button onClick={() => setView({ name: 'edit', template: null })}>Tạo mẫu lịch</Button> : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
