'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HrmScheduleRule } from '@enterprise-platform/contracts-hrm';
import {
  Popconfirm,
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  RULE_SCOPE_LABELS,
  canChangeRule,
  classifyScheduleError,
  formatVnDate,
  isIsoDate,
  ruleRangeText,
  summarizeRuleDays,
  todayIso,
} from '../../hrm-work-schedule-model';
import { cancelRule, endRule, fetchRules } from '../../hrm-work-schedule-api';
import { cn } from '../../utils';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { toast } from '../toast';
import { EmptyState, Field, Notice, Spinner, textareaClass } from './common';

const STATUS_OPTIONS: SearchableSelectOption[] = [
  { value: 'ACTIVE', label: 'Đang áp dụng' },
  { value: 'CANCELLED', label: 'Đã hủy' },
  { value: 'ALL', label: 'Tất cả trạng thái' },
];
const SCOPE_OPTIONS: SearchableSelectOption[] = [
  { value: 'ALL', label: 'Mọi phạm vi' },
  { value: 'EMPLOYEE', label: RULE_SCOPE_LABELS.EMPLOYEE },
  { value: 'UNIT', label: RULE_SCOPE_LABELS.UNIT },
  { value: 'COMPANY', label: RULE_SCOPE_LABELS.COMPANY },
];

function EndRuleForm({
  rule,
  onDone,
  onCancel,
}: {
  rule: HrmScheduleRule;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [endDate, setEndDate] = useState(() => {
    const suggested = todayIso();
    return suggested < rule.effectiveFrom ? rule.effectiveFrom : suggested;
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!isIsoDate(endDate)) return setError('Nhập ngày kết thúc.');
    if (endDate < rule.effectiveFrom)
      return setError(`Ngày kết thúc không được trước ngày bắt đầu (${formatVnDate(rule.effectiveFrom)}).`);
    if (rule.effectiveTo && endDate >= rule.effectiveTo)
      return setError(`Ngày kết thúc phải trước ngày kết thúc hiện tại (${formatVnDate(rule.effectiveTo)}).`);
    setBusy(true);
    setError('');
    try {
      await endRule(rule.id, { endDate, reason: reason.trim() || undefined });
      toast.success(`Đã kết thúc lịch định kỳ vào ${formatVnDate(endDate)}.`);
      onDone();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 px-6 py-4">
        <Notice tone="info">
          Lịch <strong>{rule.scopeLabel}</strong> ({summarizeRuleDays(rule.days)}) áp dụng từ{' '}
          {formatVnDate(rule.effectiveFrom)}. Sau ngày kết thúc, lịch này không còn tính cho các ngày tiếp theo; các
          ngày đã qua giữ nguyên.
        </Notice>
        <Field label="Ngày kết thúc (ngày làm việc cuối cùng theo lịch này)" className="max-w-xs">
          <DatePickerInput
            aria-label="Ngày kết thúc"
            value={endDate}
            min={rule.effectiveFrom}
            onChange={setEndDate}
          />
        </Field>
        <Field label="Lý do (tuỳ chọn)" className="max-w-xl">
          <textarea className={textareaClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <Button variant="outline" onClick={onCancel}>
          Quay lại danh sách
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Kết thúc lịch'}
        </Button>
      </div>
    </div>
  );
}

/** Danh sách các lịch định kỳ (không có ngày kết thúc) với thao tác Kết thúc và Hủy theo quyền. */
export function RulesManager({
  open,
  onOpenChange,
  canManage,
  canBulk,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  canBulk: boolean;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState('ACTIVE');
  const [scopeType, setScopeType] = useState('ALL');
  const [rows, setRows] = useState<HrmScheduleRule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ending, setEnding] = useState<HrmScheduleRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchRules({
        status: status === 'ALL' ? undefined : (status as 'ACTIVE' | 'CANCELLED'),
        scopeType: scopeType === 'ALL' ? undefined : (scopeType as 'EMPLOYEE' | 'UNIT' | 'COMPANY'),
      });
      setRows(res.data);
    } catch (e) {
      setRows(null);
      setError(classifyScheduleError(e).message);
    } finally {
      setLoading(false);
    }
  }, [status, scopeType]);

  useEffect(() => {
    if (open) setEnding(null);
  }, [open]);
  useEffect(() => {
    if (open && !ending) void load();
  }, [open, ending, load]);

  async function cancel(rule: HrmScheduleRule, reason?: string) {
    try {
      await cancelRule(rule.id, { reason: reason || undefined });
      toast.success(`Đã hủy lịch định kỳ của ${rule.scopeLabel}.`);
      onChanged();
      await load();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88dvh,760px)] max-w-6xl" aria-label="Lịch định kỳ">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <DialogTitle className="text-lg">{ending ? 'Kết thúc lịch định kỳ' : 'Lịch định kỳ'}</DialogTitle>
          <DialogDescription>
            Lịch gán một lần, không có ngày kết thúc, tự chạy đến khi bạn kết thúc hoặc hủy. Ngoại lệ, ngày lễ và lịch cố
            định theo khoảng ngày luôn ưu tiên hơn.
          </DialogDescription>
        </DialogHeader>
        {ending ? (
          <EndRuleForm
            rule={ending}
            onCancel={() => setEnding(null)}
            onDone={() => {
              onChanged();
              setEnding(null);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-4">
              <div className="w-52">
                <SearchableSelect options={STATUS_OPTIONS} value={status} clearable={false} onChange={(v) => setStatus(v || 'ACTIVE')} />
              </div>
              <div className="w-48">
                <SearchableSelect options={SCOPE_OPTIONS} value={scopeType} clearable={false} onChange={(v) => setScopeType(v || 'ALL')} />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
              {error ? <Notice tone="error">{error}</Notice> : null}
              {loading && !rows ? (
                <EmptyState>
                  <Spinner label="Đang tải lịch định kỳ…" />
                </EmptyState>
              ) : rows && rows.length === 0 ? (
                <EmptyState>Chưa có lịch định kỳ nào khớp bộ lọc.</EmptyState>
              ) : rows ? (
                <table className={cn('w-full border-separate border-spacing-0 text-xs', loading && 'opacity-60')}>
                  <thead>
                    <tr className="text-left text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                      {['Phạm vi', 'Từ ngày', 'Đến ngày', 'Mẫu lịch', 'Lịch trong tuần', 'Trạng thái', 'Thao tác'].map((h) => (
                        <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((rule) => {
                      const allowed = rule.status === 'ACTIVE' && canChangeRule(rule.scopeType, { manage: canManage, bulk: canBulk });
                      return (
                        <tr key={rule.id} className="hover:bg-slate-50">
                          <td className="border-b border-slate-100 px-3 py-2">
                            <div className="font-semibold text-slate-900">{rule.scopeLabel}</div>
                            <div className="text-[11px] text-slate-500">{RULE_SCOPE_LABELS[rule.scopeType]}</div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 whitespace-nowrap">{formatVnDate(rule.effectiveFrom)}</td>
                          <td className="border-b border-slate-100 px-3 py-2 whitespace-nowrap">
                            {rule.effectiveTo ? formatVnDate(rule.effectiveTo) : 'Không kết thúc'}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">{rule.templateName ?? 'Tự cấu hình'}</td>
                          <td className="border-b border-slate-100 px-3 py-2">{summarizeRuleDays(rule.days)}</td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <span
                              className={cn(
                                'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                                rule.status === 'ACTIVE'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 bg-slate-100 text-slate-500',
                              )}
                            >
                              {rule.status === 'ACTIVE' ? 'Đang áp dụng' : 'Đã hủy'}
                            </span>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            {allowed ? (
                              <div className="flex gap-1.5">
                                <Button size="sm" variant="outline" onClick={() => setEnding(rule)}>
                                  Kết thúc
                                </Button>
                                <Popconfirm
                                  title="Hủy lịch định kỳ này?"
                                  description={`Lịch ${rule.scopeLabel} (${ruleRangeText(rule.effectiveFrom, rule.effectiveTo)}) sẽ bị hủy hoàn toàn. Có thể nhập lý do.`}
                                  okText="Hủy lịch"
                                  cancelText="Không"
                                  okType="danger"
                                  placement="left"
                                  reasonRequired={false}
                                  reasonLabel="Lý do (tuỳ chọn)"
                                  onConfirm={(reason) => cancel(rule, reason)}
                                >
                                  <Button size="sm" variant="destructive">
                                    Hủy lịch
                                  </Button>
                                </Popconfirm>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
              <span className="text-[11px] text-slate-500">
                Gợi ý: để bắt đầu một lịch định kỳ mới, dùng Phân ca mới hoặc Phân ca hàng loạt và giữ tùy chọn Không có
                ngày kết thúc.
              </span>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
