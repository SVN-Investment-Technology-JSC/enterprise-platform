'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  HrmScheduleConflictMode,
  HrmScheduleTemplate,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import {
  WEEKDAY_LABELS,
  blockingConflicts,
  buildApplyRequest,
  buildExceptionPattern,
  classifyScheduleError,
  isOpenEnded,
  isRuleApplyResult,
  isRulePreview,
  summarizePattern,
  writableCount,
  type AnyApplyResult,
  type AnySchedulePreview,
  type AssignDraft,
  type ScheduleErrorInfo,
} from '../../hrm-work-schedule-model';
import { applySchedule, previewSchedule } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { toast } from '../toast';
import { ConflictModePicker } from './conflict-mode-picker';
import { Checkbox, Notice, Spinner } from './common';
import {
  ConflictTable,
  PreviewPanel,
  RequestConflictTable,
  RuleChangesList,
  RulePreviewPanel,
  SummaryStats,
} from './preview-panel';

/**
 * Luồng phân ca dùng chung cho hộp thoại (4 bước) và biểu mẫu trong trang: bản nháp, xem trước, xung đột, xác nhận, lưu.
 * Không đổi nghiệp vụ: vẫn xem trước (previewSchedule) rồi mới lưu (applySchedule), chặn khi xung đột hoặc kỳ công khoá,
 * và cần xác nhận khi máy chủ hoặc phạm vi toàn công ty yêu cầu.
 */
export function useAssignFlow(makeDraft: () => AssignDraft, onDone: () => void) {
  const [draft, setDraft] = useState<AssignDraft>(makeDraft);
  const [stepError, setStepError] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: AnySchedulePreview } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [problem, setProblem] = useState<ScheduleErrorInfo | null>(null);
  const [serverReasons, setServerReasons] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [conflictSeen, setConflictSeen] = useState(false);
  const [result, setResult] = useState<AnyApplyResult | null>(null);
  const requestSeq = useRef(0);
  const makeDraftRef = useRef(makeDraft);
  makeDraftRef.current = makeDraft;

  /** Bản nháp sạch và bỏ mọi kết quả xem trước, lỗi, xác nhận. */
  const reset = useCallback(() => {
    requestSeq.current++;
    setDraft(makeDraftRef.current());
    setStepError('');
    setPreview(null);
    setPreviewing(false);
    setProblem(null);
    setServerReasons([]);
    setConfirmed(false);
    setResult(null);
    setConflictSeen(false);
  }, []);

  const requestKey = useMemo(() => JSON.stringify(buildApplyRequest(draft)), [draft]);
  const patch = (next: Partial<AssignDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
    setServerReasons([]);
    setConfirmed(false);
    setStepError('');
  };

  const runPreview = useCallback(async (target: AssignDraft) => {
    const seq = ++requestSeq.current;
    setPreviewing(true);
    setProblem(null);
    try {
      const res = await previewSchedule(buildApplyRequest(target));
      if (seq !== requestSeq.current) return;
      setPreview({ key: JSON.stringify(buildApplyRequest(target)), data: res.data });
      if (blockingConflicts(res.data, 'REPORT') > 0) setConflictSeen(true);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setPreview(null);
      setProblem(classifyScheduleError(error));
    } finally {
      if (seq === requestSeq.current) setPreviewing(false);
    }
  }, []);

  const previewData = preview && preview.key === requestKey ? preview.data : null;
  const isCompany = draft.scope.type === 'COMPANY';
  const reasons = useMemo(() => {
    const list = [...(previewData?.confirmReasons ?? []), ...serverReasons];
    if (isCompany && !list.some((r) => /toàn công ty/i.test(r))) list.push('Áp dụng cho toàn công ty');
    return [...new Set(list)];
  }, [previewData, serverReasons, isCompany]);
  const needsConfirm = Boolean(previewData?.requiresConfirmation) || serverReasons.length > 0 || isCompany;
  const openEnded = isOpenEnded(draft);
  const writable = previewData ? writableCount(previewData) : 0;
  const hasConflicts =
    (previewData ? blockingConflicts(previewData, draft.conflictMode) > 0 : false) ||
    (previewData && !isRulePreview(previewData) ? (previewData.blockingRequestConflictTotal ?? 0) > 0 : false) ||
    problem?.kind === 'REQUEST_CONFLICT' ||
    problem?.kind === 'CONFLICT' ||
    problem?.kind === 'RULE_CONFLICT';
  const locked = (previewData?.lockedPeriods.length ?? 0) > 0 || problem?.kind === 'LOCKED';
  /** Đủ điều kiện lưu (chưa kể "đang ở bước xem trước" của hộp thoại). */
  const canSave =
    !!previewData && !previewing && !applying && !hasConflicts && !locked && writable > 0 && (!needsConfirm || confirmed);

  async function save() {
    if (!canSave) return;
    setApplying(true);
    setProblem(null);
    try {
      const res = await applySchedule(buildApplyRequest(draft, needsConfirm));
      setResult(res.data);
      toast.success(
        isRuleApplyResult(res.data)
          ? `Đã lưu ${res.data.ruleCount} lịch định kỳ cho ${res.data.employeeCount} nhân viên.`
          : `Đã lưu phân ca cho ${res.data.employeeCount} nhân viên (${res.data.appliedDays} ngày).`,
      );
      onDone();
    } catch (error) {
      const info = classifyScheduleError(error);
      if (info.kind === 'CONFIRM_REQUIRED') {
        setServerReasons(info.reasons);
        setConfirmed(false);
      } else {
        if (info.kind === 'CONFLICT' || info.kind === 'RULE_CONFLICT') setConflictSeen(true);
        setProblem(info);
      }
    } finally {
      setApplying(false);
    }
  }

  function changeConflictMode(conflictMode: HrmScheduleConflictMode) {
    const next = { ...draft, conflictMode };
    patch({ conflictMode });
    void runPreview(next);
  }

  return {
    draft,
    patch,
    stepError,
    setStepError,
    preview,
    previewData,
    previewing,
    problem,
    confirmed,
    setConfirmed,
    applying,
    conflictSeen,
    setConflictSeen,
    setServerReasons,
    result,
    reasons,
    needsConfirm,
    openEnded,
    writable,
    hasConflicts,
    locked,
    canSave,
    runPreview,
    save,
    changeConflictMode,
    reset,
    setResult,
  };
}

export type AssignFlow = ReturnType<typeof useAssignFlow>;

/** Khối "Lịch tuần sẽ lưu" + kết quả xem trước, xung đột, cách xử lý và xác nhận. Dùng ở bước 4 của hộp thoại và dưới biểu mẫu. */
export function AssignPreviewSection({
  flow,
  shifts,
  selectedTemplate,
  canCalendar,
  onUseFixedRange,
  hideConflictMode = false,
  hideConfirm = false,
}: {
  flow: AssignFlow;
  shifts: readonly HrmShiftDefinition[];
  selectedTemplate: HrmScheduleTemplate | undefined;
  canCalendar: boolean;
  /** Bấm "Phân ca theo khoảng ngày" khi chưa có bảng lịch định kỳ: bỏ "không có ngày kết thúc" và quay lại bước nhập thời gian. */
  onUseFixedRange: () => void;
  /** Cách xử lý ngày đã có lịch và khối xác nhận do nơi gọi tự hiển thị (hộp thoại xác nhận của biểu mẫu trong trang). */
  hideConflictMode?: boolean;
  hideConfirm?: boolean;
}) {
  const { draft, previewData, problem } = flow;
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="pattern-summary"
        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
      >
        <span className="font-semibold">Lịch tuần sẽ lưu: </span>
        {summarizePattern(
          draft.kind === 'EXCEPTION'
            ? buildExceptionPattern(
                draft.exception.dayType === 'OFF'
                  ? { dayType: 'OFF' }
                  : { dayType: 'SHIFT', shiftId: draft.exception.shiftId },
              )
            : draft.source === 'TEMPLATE'
              ? (selectedTemplate?.days ?? [])
              : draft.pattern,
          shifts,
        )}
        {draft.kind === 'ASSIGN' && draft.source !== 'TEMPLATE' && draft.pattern.some((r) => r.dayType === 'SKIP') ? (
          <span className="ml-1 text-amber-700">
            (ngày chưa chọn ca:{' '}
            {draft.pattern
              .filter((r) => r.dayType === 'SKIP')
              .map((r) => WEEKDAY_LABELS[r.weekday])
              .join(', ')}{' '}
            sẽ không có ca)
          </span>
        ) : null}
      </div>
      {flow.previewing ? <Spinner label="Đang tính toán xem trước…" /> : null}
      {problem &&
      problem.kind !== 'CONFLICT' &&
      problem.kind !== 'RULE_CONFLICT' &&
      problem.kind !== 'RULES_NOT_MIGRATED' ? (
        <Notice tone="error">{problem.message}</Notice>
      ) : null}
      {problem?.kind === 'REQUEST_CONFLICT' ? (
        <RequestConflictTable conflicts={problem.conflicts} total={problem.total} />
      ) : null}
      {problem?.kind === 'RULES_NOT_MIGRATED' ? (
        <div className="flex flex-col gap-2" data-testid="rules-not-migrated">
          <Notice tone="error" title="Chưa dùng được lịch định kỳ">
            {problem.message} Bỏ chọn Không có ngày kết thúc để phân ca theo khoảng ngày; lịch theo khoảng ngày vẫn hoạt
            động bình thường.
          </Notice>
          <div>
            <Button variant="outline" size="sm" onClick={onUseFixedRange}>
              Phân ca theo khoảng ngày
            </Button>
          </div>
        </div>
      ) : null}
      {problem?.kind === 'CONFLICT' ? (
        <Notice tone="warn" title="Có ngày đã có lịch khác">
          {problem.message}
        </Notice>
      ) : null}
      {problem?.kind === 'CONFLICT' && problem.conflicts.length > 0 ? (
        <ConflictTable conflicts={problem.conflicts} total={problem.conflictCount} />
      ) : null}
      {problem?.kind === 'RULE_CONFLICT' ? (
        <>
          <Notice tone="warn" title="Có phạm vi đã có lịch định kỳ còn hiệu lực">
            {problem.message}
          </Notice>
          <RuleChangesList rules={problem.rules} />
        </>
      ) : null}
      {previewData ? (
        isRulePreview(previewData) ? (
          <RulePreviewPanel preview={previewData} />
        ) : (
          <PreviewPanel preview={previewData} />
        )
      ) : null}
      {flow.conflictSeen && !hideConflictMode ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-800">
            {flow.openEnded
              ? 'Chọn cách xử lý lịch định kỳ đang có, hệ thống sẽ xem trước lại'
              : 'Chọn cách xử lý ngày đã có lịch, hệ thống sẽ xem trước lại'}
          </div>
          <ConflictModePicker
            value={draft.conflictMode}
            onChange={flow.changeConflictMode}
            canCalendar={canCalendar}
            openEnded={flow.openEnded}
            compact
          />
        </div>
      ) : null}
      {previewData && !flow.hasConflicts && !flow.locked && flow.writable === 0 ? (
        <Notice tone="info">Không có ngày nào cần ghi (lịch hiện có đã trùng hoặc bị bỏ qua).</Notice>
      ) : null}
      {previewData && flow.needsConfirm && !hideConfirm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-800">Cần xác nhận trước khi lưu</div>
          <ul className="list-disc pl-5 text-xs text-amber-800">
            {flow.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Checkbox
            checked={flow.confirmed}
            onChange={flow.setConfirmed}
            label="Tôi đã xem lại phạm vi và đồng ý áp dụng"
          />
        </div>
      ) : null}
    </div>
  );
}

/** Kết quả sau khi lưu (lịch cố định hoặc lịch định kỳ). */
export function AssignResultSection({ result }: { result: AnyApplyResult }) {
  return (
    <div className="flex flex-col gap-3" data-testid="assign-result" data-batch-id={result.batchId}>
      {isRuleApplyResult(result) ? (
        <Notice tone="success" title="Đã lưu lịch định kỳ">
          Đã tạo {result.ruleCount} lịch định kỳ mới, áp dụng cho {result.employeeCount} nhân viên.
          {result.changedRules > 0 ? ` Có ${result.changedRules} lịch cũ được kết thúc hoặc hủy để nhường chỗ cho lịch mới.` : ''}
          {(result.replacedDays ?? 0) > 0
            ? ` ${result.replacedDays} ngày đã phân riêng được thay bằng lịch mới.`
            : ''}
          {result.skippedTargets > 0 ? ` ${result.skippedTargets} phạm vi bị bỏ qua.` : ''} Lịch sẽ tự chạy cho đến khi bạn
          kết thúc.
        </Notice>
      ) : (
        <>
          <Notice tone="success" title="Đã lưu phân ca">
            Đã ghi {result.appliedDays} ngày phân ca cho {result.employeeCount} nhân viên.
          </Notice>
          <SummaryStats summary={result.summary} employeeCount={result.employeeCount} />
        </>
      )}
      <p className="text-xs text-slate-500">Mọi thay đổi được ghi vào Lịch sử thay đổi. Lưới lịch đã được làm mới.</p>
    </div>
  );
}
