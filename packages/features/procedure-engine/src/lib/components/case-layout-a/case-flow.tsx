'use client';

import {
  type ProcedureActivity,
  type ProcedureAttachment,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { Check, ChevronUp, FileText, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatOverviewDateTime } from '../../procedure-overview';
import {
  peopleSummary,
  stepStageProgress,
  type StageProgress,
  type StageProgressStatus,
  type SubjectResolver,
} from '../../step-people';
import { instanceProgress, progressLabel, type TimelineEntry } from '../instance-flow-view';
import { financeVoucherCard } from '../rcsi/finance-step';
import { stepDetail } from '../step-detail-dialog';
import { ROLE_HUMAN_LABEL, STEP_STATUS_LABEL } from '../workspace-board-options';
import boardStyles from '../workspace-board.module.scss';
import styles from './case-layout-a.module.scss';

export const ESTIMATE_HINT = 'Còn điểm rẽ nhánh phía trước nên tổng số bước là ước lượng';

/** Thao tác có kết quả trên một bước; hoàn duyệt cũng tính để thấy bước đã được rút lại. */
const DECISION_ACTIONS: ReadonlySet<ProcedureActivity['action']> = new Set([
  'complete',
  'approve',
  'reject',
  'return',
  'withdraw',
]);

/** Kết quả của bước theo thao tác chốt cuối cùng. */
const DECISION_LABEL: Partial<Record<ProcedureActivity['action'], string>> = {
  approve: 'Đã duyệt',
  complete: 'Hoàn tất',
  return: 'Trả lại',
  reject: 'Từ chối',
  withdraw: 'Hoàn duyệt',
  start: 'Khởi tạo',
};

const DECISION_TONE: Partial<Record<ProcedureActivity['action'], string>> = {
  approve: 'decision_ok',
  complete: 'decision_ok',
  start: 'decision_ok',
  return: 'decision_warn',
  reject: 'decision_bad',
  withdraw: 'decision_info',
};

export type StepState = 'done' | 'rejected' | 'returned' | 'current' | 'upcoming';

export function stepStateOf(step: ProcedureInstanceStep, currentStepId: string | undefined): StepState {
  if (step.id === currentStepId) return 'current';
  if (step.status === 'completed') return 'done';
  if (step.status === 'rejected') return 'rejected';
  if (step.status === 'returned') return 'returned';
  return 'upcoming';
}

/** Bước đã có người xử lý (xong, từ chối, bị trả lại): hiện gọn một dòng, bấm mở thẻ đầy đủ. */
export function isPastState(state: StepState): boolean {
  return state === 'done' || state === 'rejected' || state === 'returned';
}

const STATE_LABEL: Record<StepState, string> = {
  done: 'Hoàn thành',
  rejected: 'Từ chối',
  returned: 'Trả lại',
  current: 'Đang xử lý',
  upcoming: 'Chờ',
};

function StateIcon({ state, order, size = 11 }: { state: StepState; order: number; size?: number }) {
  if (state === 'done') return <Check size={size} strokeWidth={3} />;
  if (state === 'rejected') return <X size={size} strokeWidth={3} />;
  if (state === 'returned') return <RotateCcw size={size} strokeWidth={3} />;
  return <span>{order}</span>;
}

/**
 * Các bước nằm ngang: mỗi bước có số / dấu, tên bước và trạng thái (Hoàn thành, Đang xử lý, Chờ, Trả lại, Từ chối). Quy trình
 * dài cuộn ngang, bước đang làm luôn được cuộn vào giữa. Bấm một bước thì nhảy tới bước đó trên tiến trình.
 */
export function CaseStepper({
  instance,
  entries,
  onPick,
  waitingTitle,
}: {
  instance: ProcedureInstance;
  entries: readonly TimelineEntry[];
  onPick: (stepId: string) => void;
  /** Đang chờ ai ở bước hiện tại (đủ danh sách), thêm vào gợi ý của bước đó. */
  waitingTitle?: string;
}) {
  const steps = entries.flatMap((entry) => (entry.kind === 'step' ? [entry.step] : []));
  const progress = instanceProgress(instance);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current) return;
    list.scrollLeft = Math.max(0, current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2);
  }, [instance.id, instance.currentStepId]);
  if (!steps.length) return null;
  return (
    <div className={styles.stepper}>
      <span className={styles.stepperProgress} title={progress.isEstimate ? ESTIMATE_HINT : undefined}>
        Bước {progressLabel(progress)}
      </span>
      <ol ref={listRef} className={styles.stepperList} aria-label="Các bước của hồ sơ">
        {steps.map((step, index) => {
          const state = stepStateOf(step, instance.currentStepId);
          const previousDone = index > 0 && steps[index - 1]?.status === 'completed';
          return (
            <li
              key={step.id}
              className={`${styles.stepperItem} ${styles[`step_${state}`] ?? ''}`}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {index > 0 ? (
                <span className={`${styles.stepperLine} ${previousDone ? styles.stepperLineDone : ''}`} aria-hidden />
              ) : null}
              <button
                type="button"
                className={styles.stepperBtn}
                title={`Bước ${step.order} · ${step.name} · ${STATE_LABEL[state]}${
                  state === 'current' && waitingTitle ? ` · Chờ ${waitingTitle}` : ''
                }`}
                onClick={() => onPick(step.id)}
              >
                <span className={styles.stepperDot} aria-hidden>
                  <StateIcon state={state} order={step.order} />
                </span>
                <span className={styles.stepperText}>
                  <span className={styles.stepperName}>{step.name}</span>
                  <span className={styles.stepperState}>{STATE_LABEL[state]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface CaseFlowProps {
  readonly instance: ProcedureInstance;
  readonly entries: readonly TimelineEntry[];
  readonly currentInTimeline: boolean;
  readonly actionPanel: ReactNode;
  /** Thẻ đầy đủ của một dòng tiến trình (đúng thẻ của giao diện cũ, có khung xử lý ở bước đang chạy). */
  readonly renderEntry: (entry: TimelineEntry) => ReactNode;
  readonly renderRoles: (step: ProcedureInstanceStep) => ReactNode;
  /** Vai của người đã chốt bước (theo phân công của bước), để hiện cạnh tên người xử lý. */
  readonly performerRole?: (step: ProcedureInstanceStep, actorId?: string, actorName?: string) => ProcedureRaciRole | undefined;
  readonly flowExtras: ReactNode;
  readonly attachments: readonly ProcedureAttachment[];
  readonly withdrawStepId?: string;
  /** Tra chức danh / đơn vị ra người đang giữ, để dòng "tiến độ từng người" hiện tên người chưa xử lý. */
  readonly resolveSubject?: SubjectResolver;
  /** Bước đã qua đang mở thẻ đầy đủ. */
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (stepId: string) => void;
}

/**
 * Tab "Tiến trình": MỌI bước theo thứ tự. Bước đã qua là một dòng chia cột (bước, người xử lý + vai, thời gian, kết quả, ý
 * kiến, số tệp; không có dòng tiêu đề cột, các dòng dùng chung khuôn cột nên vẫn thẳng hàng) để dò nhanh, bấm thì mở thẻ
 * đầy đủ ngay tại chỗ; bước đang làm là khung "Việc cần làm" (một dòng đầu: tên bước, vai của bạn / đang chờ ai); bước sắp
 * tới mờ, có vai được giao. Thẻ rẽ nhánh và nhóm nhánh không đi giữ nguyên như giao diện cũ.
 */
export function CaseFlow(props: CaseFlowProps) {
  const { instance, entries, renderEntry } = props;
  return (
    <>
      {/* Hồ sơ không có bước đang chạy trên dòng thời gian: khung xử lý đứng đầu như cũ. */}
      {props.currentInTimeline ? null : props.actionPanel}
      <ol className={styles.flow} aria-label="Tiến trình các bước">
        {entries.map((entry) => {
          if (entry.kind !== 'step') {
            return (
              <li key={entry.kind === 'decision' ? `decision:${entry.decision.id}` : 'skipped'} className={styles.flowItem}>
                <ol className={`${boardStyles.timeline} ${styles.flowCard}`}>{renderEntry(entry)}</ol>
              </li>
            );
          }
          const step = entry.step;
          const state = stepStateOf(step, instance.currentStepId);
          const files = props.attachments.filter(
            (file) => file.instanceId === instance.id && file.stepInstanceId === step.id,
          ).length;
          // Bước vừa xong mà người này còn hoàn duyệt được: mở sẵn thẻ để thấy lời mời ngay trên bước đó.
          const open = state === 'current' || props.expanded.has(step.id) || props.withdrawStepId === step.id;
          if (open) {
            return (
              <li
                key={step.id}
                className={`${styles.flowItem} ${state === 'current' ? styles.flowItemCurrent : ''}`}
                data-step-id={step.id}
                data-state={state}
              >
                {/* Bước đang làm: khung "Việc cần làm" tự có dòng đầu (tên bước, vai, đang chờ ai), không thêm dải riêng. */}
                {state === 'current' ? null : (
                  <button
                    type="button"
                    className={styles.flowCollapse}
                    aria-expanded
                    onClick={() => props.onToggle(step.id)}
                  >
                    <ChevronUp size={13} aria-hidden /> Thu gọn bước {step.order}
                  </button>
                )}
                {/* Bước đang làm: tiến độ từng người nằm trong khung "Việc cần làm" (do màn truyền vào). */}
                {state === 'current' ? null : (
                  <StepPeopleProgress instance={instance} step={step} resolveSubject={props.resolveSubject} />
                )}
                <ol className={`${boardStyles.timeline} ${styles.flowCard}`}>{renderEntry(entry)}</ol>
              </li>
            );
          }
          if (isPastState(state)) {
            return (
              <li key={step.id} className={styles.flowItem} data-step-id={step.id} data-state={state}>
                <DoneRow
                  instance={instance}
                  step={step}
                  state={state}
                  files={files}
                  performerRole={props.performerRole}
                  onOpen={() => props.onToggle(step.id)}
                />
                <StepPeopleProgress instance={instance} step={step} resolveSubject={props.resolveSubject} />
              </li>
            );
          }
          return (
            <li key={step.id} className={`${styles.flowItem} ${styles.flowItemUpcoming}`} data-step-id={step.id} data-state={state}>
              <div className={styles.flowGrid}>
                <span className={`${styles.flowNode} ${styles.flowNodeUpcoming}`} aria-hidden>
                  {step.order}
                </span>
                <span className={styles.flowRowName} title={`Bước ${step.order} · ${step.name}`}>
                  Bước {step.order} · {step.name}
                </span>
                <span className={styles.flowRoles}>{props.renderRoles(step)}</span>
                <span className={styles.flowWhen}>—</span>
                <span>
                  <span className={styles.flowStatus}>{STEP_STATUS_LABEL[step.status] ?? step.status}</span>
                </span>
                <span />
                <span />
              </div>
            </li>
          );
        })}
      </ol>
      {props.flowExtras}
    </>
  );
}

/**
 * Một bước đã qua, gọn một dòng chia cột: dấu trạng thái, tên bước, người xử lý (kèm vai), thời gian, kết quả, ý kiến, số
 * tệp; bước Tài chính thêm phiếu (mã, trạng thái, số tiền) dưới ý kiến.
 */
function DoneRow({
  instance,
  step,
  state,
  files,
  performerRole,
  onOpen,
}: {
  instance: ProcedureInstance;
  step: ProcedureInstanceStep;
  state: StepState;
  files: number;
  performerRole?: CaseFlowProps['performerRole'];
  onOpen: () => void;
}) {
  const detail = stepDetail(instance, step);
  const decision = [...detail.activity].reverse().find((entry) => DECISION_ACTIONS.has(entry.action));
  const start = decision ? undefined : instance.activity.find((entry) => entry.action === 'start');
  const decisionAction = decision?.action ?? (detail.performerName && start ? 'start' : undefined);
  const decisionText = decisionAction ? DECISION_LABEL[decisionAction] : STEP_STATUS_LABEL[step.status];
  const tone = decisionAction ? DECISION_TONE[decisionAction] : undefined;
  const actorId = decision?.actorId ?? start?.actorId;
  const role = performerRole?.(step, actorId, detail.performerName);
  const note = decision?.comment?.trim();
  const voucher = step.integration?.module === 'finance' && step.financeVoucher ? financeVoucherCard(step.financeVoucher) : undefined;
  return (
    <button
      type="button"
      className={`${styles.flowGrid} ${styles.flowRow}`}
      aria-expanded={false}
      title="Bấm để xem đầy đủ bước này"
      onClick={onOpen}
    >
      <span className={`${styles.flowNode} ${styles[`flowNode_${state}`] ?? ''}`} aria-hidden>
        <StateIcon state={state} order={step.order} size={12} />
      </span>
      <span className={styles.flowRowName} title={`Bước ${step.order} · ${step.name}`}>
        Bước {step.order} · {step.name}
      </span>
      <span className={styles.flowWho} title={detail.performerName}>
        {role ? <i className={`${boardStyles.role} ${boardStyles[`role${role}`] ?? ''}`}>{role}</i> : null}
        <span className={styles.flowWhoName}>{detail.performerName ?? '—'}</span>
      </span>
      <span className={styles.flowWhen} title={detail.performedAt ? formatDateTime(detail.performedAt) : undefined}>
        {formatOverviewDateTime(detail.performedAt)}
      </span>
      <span>
        {decisionText ? <span className={`${styles.decision} ${tone ? (styles[tone] ?? '') : ''}`}>{decisionText}</span> : null}
      </span>
      <span className={styles.flowNoteCell}>
        {note ? (
          <span className={styles.flowNote} title={note}>
            {note}
          </span>
        ) : null}
        {voucher ? (
          <span className={styles.flowVoucher} title={voucher.detail ?? voucher.title}>
            {voucher.title}
          </span>
        ) : null}
      </span>
      <span className={styles.flowFiles} title={files ? `${files} tệp của bước này` : undefined}>
        {files ? (
          <>
            <FileText size={12} aria-hidden /> {files}
          </>
        ) : null}
      </span>
    </button>
  );
}

const STAGE_TONE: Record<StageProgressStatus, string | undefined> = {
  done: 'decision_ok',
  returned: 'decision_warn',
  rejected: 'decision_bad',
  waiting: 'decision_info',
  pending: undefined,
};

/** Trạng thái phần việc của một vai, bằng lời: "Đã xem xét", "Đã phê duyệt", "Đã trả lại", "Đang chờ"... */
export function stageStatusText(item: Pick<StageProgress, 'role' | 'status'>): string {
  switch (item.status) {
    case 'done':
      return item.role === 'R' ? 'Đã xem xét' : item.role === 'A' ? 'Đã phê duyệt' : 'Đã hoàn tất';
    case 'returned':
      return 'Đã trả lại';
    case 'rejected':
      return 'Đã từ chối';
    case 'waiting':
      return 'Đang chờ';
    default:
      return 'Chưa xử lý';
  }
}

/**
 * Tiến độ TỪNG NGƯỜI trong một bước nhiều vai (vd Xem xét rồi Phê duyệt): mỗi vai một dòng gọn gồm tên vai, người (đã xử lý,
 * hay người được giao khi chưa tới), trạng thái kèm thời gian, và ý kiến nếu có. Ai mở hồ sơ cũng thấy người xem xét đã
 * xong phần mình trước khi bước hoàn tất. Chỉ suy từ dữ liệu sẵn có của hồ sơ (`stepStageProgress`). Bước một vai (dòng
 * bước đã đủ) và bước Tài chính (do module ngoài đóng) không hiện.
 */
export function StepPeopleProgress({
  instance,
  step,
  resolveSubject,
  className,
}: {
  instance: ProcedureInstance;
  step: ProcedureInstanceStep;
  resolveSubject?: SubjectResolver;
  className?: string;
}) {
  if (step.integration) return null;
  const items = stepStageProgress(instance, step, resolveSubject);
  if (items.length < 2) return null;
  return (
    <ul
      className={`${styles.stageList} ${className ?? ''}`}
      aria-label={`Tiến độ từng người ở bước ${step.order}`}
      data-stage-progress=""
    >
      {items.map((item) => {
        const people = peopleSummary(item.names);
        const text = stageStatusText(item);
        const tone = STAGE_TONE[item.status];
        const delegated = item.delegatedBy ? ` (uỷ quyền từ ${item.delegatedBy})` : '';
        return (
          <li key={item.role} className={styles.stageLine} data-role={item.role} data-status={item.status}>
            <span className={styles.stageRole}>{ROLE_HUMAN_LABEL[item.role]}</span>
            <span className={styles.stageWho} title={`${people.title || '—'}${delegated}`}>
              {people.text || '—'}
              {item.delegatedBy ? <span className={styles.stageDelegated}> · uỷ quyền từ {item.delegatedBy}</span> : null}
            </span>
            <span className={styles.stageState}>
              <span className={`${styles.decision} ${tone ? (styles[tone] ?? '') : ''}`}>{text}</span>
              {item.at ? (
                <span className={styles.stageWhen} title={formatDateTime(item.at)}>
                  {formatOverviewDateTime(item.at)}
                </span>
              ) : null}
            </span>
            {item.comment ? (
              <span className={styles.stageNote} title={item.comment}>
                {item.comment}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
