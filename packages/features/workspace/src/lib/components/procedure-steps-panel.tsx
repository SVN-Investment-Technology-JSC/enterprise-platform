'use client';

import type {
  ProcedureStepEvent,
  ProcedureStepView,
  WorkItemProcedureSteps,
} from '@enterprise-platform/contracts-workspace';
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  ListOrdered,
  Loader2,
  RotateCcw,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type FlowBranch,
  type FlowSegment,
  type StepDisplayState,
  buildFlowLayout,
  isStepOverdue,
  progressPercent,
  skippedOutsideBranches,
  slaText,
  stepCounts,
  stepDisplayState,
} from '../procedure-steps-model';
import {
  type ProcedureStepsKind,
  useProcedureSteps,
} from '../use-procedure-steps';
import {
  formatDateTime,
  procedureEventActionLabel,
  procedureRoleStageLabel,
  procedureStepStatusLabel,
  procedureStepStatusTone,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Button } from '../ui/button';
import { Tip } from '../ui/tooltip';

const STATE_CLASS: Record<StepDisplayState, string> = {
  done: styles.procedureStepsDone,
  current: styles.procedureStepsCurrent,
  returned: styles.procedureStepsReturned,
  rejected: styles.procedureStepsRejected,
  cancelled: styles.procedureStepsRejected,
  upcoming: styles.procedureStepsUpcoming,
  skipped: styles.procedureStepsUpcoming,
};

function StepDot({ state, order }: { state: StepDisplayState; order: number }) {
  if (state === 'done') return <Check size={12} aria-hidden />;
  if (state === 'returned') return <RotateCcw size={12} aria-hidden />;
  if (state === 'rejected') return <X size={12} aria-hidden />;
  if (state === 'cancelled') return <Ban size={12} aria-hidden />;
  return <span aria-hidden>{order}</span>;
}

function StepRow({
  step,
  index,
  instanceStatus,
  now,
}: {
  step: ProcedureStepView;
  index: number;
  instanceStatus: string | undefined;
  now: Date;
}) {
  const state = stepDisplayState(step.status);
  const tone = procedureStepStatusTone(step.status);
  const stage = procedureRoleStageLabel(step.roleStage);
  const overdue = isStepOverdue(step, instanceStatus, now);
  const sla = slaText(step, instanceStatus, now);
  return (
    <li
      className={`${styles.procedureStepsItem} ${STATE_CLASS[state]}`}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span className={styles.procedureStepsDot}>
        <StepDot state={state} order={state === 'skipped' ? step.order : index + 1} />
      </span>
      <div className={styles.procedureStepsBody}>
        <div className={styles.procedureStepsHead}>
          <span className={styles.procedureStepsName}>{step.name}</span>
          <span
            className={styles.pill}
            style={{ background: tone.bg, color: tone.fg }}
          >
            {procedureStepStatusLabel(step.status)}
          </span>
        </div>
        <div className={styles.procedureStepsMeta}>
          <span>
            Phụ trách: {step.assigneeLabel || 'Chưa xác định'}
            {stage ? ` (${stage})` : ''}
          </span>
          {sla ? (
            <Tip content={step.slaDueAt ? formatDateTime(step.slaDueAt) : ''}>
              <span
                className={overdue ? styles.procedureStepsOverdue : undefined}
              >
                {sla}
              </span>
            </Tip>
          ) : null}
          {step.completedAt ? (
            <span>Xong {formatDateTime(step.completedAt)}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

const FLOW_STATE_CLASS: Record<StepDisplayState, string> = {
  done: styles.procedureFlowDone,
  current: styles.procedureFlowCurrent,
  returned: styles.procedureFlowReturned,
  rejected: styles.procedureFlowRejected,
  cancelled: styles.procedureFlowRejected,
  upcoming: styles.procedureFlowUpcoming,
  skipped: styles.procedureFlowSkipped,
};

/** Một câu tóm tắt tình trạng hồ sơ để người xem biết ngay kết quả mà không phải đọc cả sơ đồ. */
function instanceSummary(data: WorkItemProcedureSteps): { text: string; tone: string } {
  const named = (status: string) => data.steps.find((step) => step.status === status)?.name;
  switch (data.status) {
    case 'completed':
      return {
        text: data.completedAt ? `Hồ sơ đã hoàn thành lúc ${formatDateTime(data.completedAt)}.` : 'Hồ sơ đã hoàn thành.',
        tone: styles.procedureStepsSummaryOk,
      };
    case 'rejected':
      return {
        text: `Hồ sơ bị từ chối${named('rejected') ? ` tại bước "${named('rejected')}"` : ''}.`,
        tone: styles.procedureStepsSummaryBad,
      };
    case 'cancelled':
      return { text: 'Hồ sơ đã bị huỷ.', tone: styles.procedureStepsSummaryBad };
    case 'reversed':
      return { text: 'Hồ sơ đã huỷ hiệu lực.', tone: styles.procedureStepsSummaryBad };
    default: {
      const current = data.steps.find((step) => step.id === data.currentStepId);
      if (!current) return { text: 'Hồ sơ đang chạy.', tone: styles.procedureStepsSummaryRun };
      const returned = Boolean(named('returned'));
      return {
        text: `${returned ? 'Hồ sơ bị trả lại, đang làm lại' : 'Đang ở bước'} "${current.name}"${
          current.assigneeLabel && current.assigneeLabel.length > 1 ? ` · ${current.assigneeLabel}` : ''
        }.`,
        tone: returned ? styles.procedureStepsSummaryWarn : styles.procedureStepsSummaryRun,
      };
    }
  }
}

/** Một nút của sơ đồ: thẻ bước nối với bước kế bằng mũi tên; mũi tên xanh khi bước này đã xong. */
function FlowNode({
  step,
  index,
  last,
  instanceStatus,
  now,
}: {
  step: ProcedureStepView;
  index: number;
  last: boolean;
  instanceStatus: string | undefined;
  now: Date;
}) {
  const state = stepDisplayState(step.status);
  const tone = procedureStepStatusTone(step.status);
  const stage = procedureRoleStageLabel(step.roleStage);
  const overdue = isStepOverdue(step, instanceStatus, now);
  const sla = slaText(step, instanceStatus, now);
  return (
    <li
      className={`${styles.procedureFlowItem} ${FLOW_STATE_CLASS[state]}`}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <div className={styles.procedureFlowNode}>
        <div className={styles.procedureFlowTop}>
          <span className={styles.procedureFlowDot}>
            <StepDot state={state} order={state === 'skipped' ? step.order : index + 1} />
          </span>
          <span
            className={styles.pill}
            style={{ background: tone.bg, color: tone.fg }}
          >
            {procedureStepStatusLabel(step.status)}
          </span>
        </div>
        <div className={styles.procedureFlowName}>{step.name}</div>
        <Tip content={`${step.assigneeLabel || 'Chưa xác định'}${stage ? ` (${stage})` : ''}`}>
          <div className={`${styles.procedureFlowMeta} ${styles.procedureFlowClamp}`}>
            {step.assigneeLabel || 'Chưa xác định'}
            {stage ? ` (${stage})` : ''}
          </div>
        </Tip>
        {sla ? (
          <Tip content={step.slaDueAt ? formatDateTime(step.slaDueAt) : ''}>
            <div
              className={`${styles.procedureFlowMeta} ${overdue ? styles.procedureStepsOverdue : ''}`}
            >
              {sla}
            </div>
          </Tip>
        ) : null}
        {step.completedAt ? (
          <div className={styles.procedureFlowMeta}>
            Xong {formatDateTime(step.completedAt)}
          </div>
        ) : null}
      </div>
      {last ? null : <span className={styles.procedureFlowArrow} aria-hidden />}
    </li>
  );
}

const BRANCH_CLASS: Record<FlowBranch['state'], string> = {
  chosen: styles.procedureFlowBranchChosen,
  not_chosen: styles.procedureFlowBranchNotChosen,
  pending: styles.procedureFlowBranchPending,
};

function BranchHeader({ item }: { item: FlowBranch }) {
  return (
    <span className={styles.procedureFlowBranchChip}>
      {item.branch.label}
      {item.branch.isDefault ? (
        <span className={styles.procedureFlowBranchTag}>Mặc định</span>
      ) : null}
      {item.state === 'chosen' ? (
        <span className={styles.procedureFlowBranchTag}>(đã chọn)</span>
      ) : null}
    </span>
  );
}

/** Điểm rẽ nhánh trên sơ đồ: hình thoi mang tên điểm rẽ, rồi các nhánh xếp dọc, mỗi nhánh một hàng thẻ bước. */
function GatewayFlowBlock({
  name,
  branches,
  last,
  instanceStatus,
  now,
}: {
  name: string;
  branches: readonly FlowBranch[];
  last: boolean;
  instanceStatus: string | undefined;
  now: Date;
}) {
  return (
    <li className={styles.procedureFlowGatewayItem}>
      <div className={styles.procedureFlowGateway}>
        <div className={styles.procedureFlowGatewayNode}>
          <span className={styles.procedureFlowGatewayDiamond} aria-hidden />
          <span className={styles.procedureFlowGatewayName}>{name}</span>
        </div>
        <div className={styles.procedureFlowBranches}>
          {branches.map((item) => (
            <div
              key={item.branch.id}
              className={`${styles.procedureFlowBranch} ${BRANCH_CLASS[item.state]}`}
            >
              <BranchHeader item={item} />
              {item.steps.length > 0 ? (
                <ol
                  className={styles.procedureFlowBranchSteps}
                  aria-label={`Nhánh ${item.branch.label}`}
                >
                  {item.steps.map((step, index) => (
                    <FlowNode
                      key={step.id}
                      step={step}
                      index={index}
                      last={index === item.steps.length - 1}
                      instanceStatus={instanceStatus}
                      now={now}
                    />
                  ))}
                </ol>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {last ? null : <span className={styles.procedureFlowArrow} aria-hidden />}
    </li>
  );
}

function EventRow({
  event,
  stepName,
}: {
  event: ProcedureStepEvent;
  stepName?: string;
}) {
  return (
    <li className={styles.procedureStepsEvent}>
      <span className={styles.procedureStepsEventTime}>
        {formatDateTime(event.createdAt)}
      </span>
      <span>
        <b>{event.actorName || 'Hệ thống'}</b> ·{' '}
        {procedureEventActionLabel(event.action)}
        {stepName ? ` · ${stepName}` : ''}
      </span>
    </li>
  );
}

/**
 * Chi tiết các bước của hồ sơ quy trình gắn với một công việc. Không gắn hồ sơ thì không hiện gì; module Quy trình
 * không đọc được thì báo tạm thời kèm nút thử lại.
 */
export function ProcedureStepsPanel({
  kind,
  id,
  version,
  flat = false,
}: {
  kind: ProcedureStepsKind;
  id: string;
  /** Không vẽ khung riêng, để đặt trong một khung có sẵn (tab, thẻ chứa). */
  flat?: boolean;
  /** Đổi giá trị này (ví dụ `updatedAt` của công việc) để nạp lại các bước. */
  version?: string | number;
}) {
  const { data, loading, reload } = useProcedureSteps(kind, id, version);
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [view, setView] = useState<'flow' | 'list'>('flow');
  const rootClass = flat ? styles.procedureStepsFlat : styles.panel;
  const flowRef = useRef<HTMLOListElement>(null);

  // Quy trình dài thì cuộn ngang tới bước hiện tại, để người xem thấy ngay việc đang ở đâu.
  useEffect(() => {
    const container = flowRef.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="step"]');
    if (container && current) {
      container.scrollLeft = Math.max(0, current.offsetLeft - container.offsetLeft - 24);
    }
  }, [data, view]);

  if (!data) {
    if (!loading) return null;
    return (
      <section className={rootClass} aria-label="Các bước quy trình">
        <h3>Các bước quy trình</h3>
        <p className={styles.procedureStepsNote}>
          <Loader2 size={14} className="animate-spin" aria-hidden /> Đang tải
          các bước…
        </p>
      </section>
    );
  }
  if (!data.linked) return null;

  if (!data.available) {
    return (
      <section className={rootClass} aria-label="Các bước quy trình">
        <h3>Các bước quy trình</h3>
        <p className={styles.procedureStepsNote}>
          Chưa đọc được các bước lúc này.{' '}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loading}
          >
            Thử lại
          </Button>
        </p>
      </section>
    );
  }

  const now = new Date();
  const layout = buildFlowLayout(data);
  const skipped = skippedOutsideBranches(data);
  let trunkCount = 0;
  const trunkIndex = new Map<FlowSegment, number>();
  for (const segment of layout) {
    if (segment.kind === 'step') trunkIndex.set(segment, trunkCount++);
  }
  const { done, total } = stepCounts(data);
  const percent = progressPercent(done, total);
  const stepNames = new Map(data.steps.map((step) => [step.id, step.name]));
  const summary = instanceSummary(data);

  return (
    <section className={rootClass} aria-label="Các bước quy trình">
      <h3>
        Các bước quy trình
        <span
          className={styles.countPill}
          aria-label={`Đã xong ${done} trên ${total} bước`}
        >
          {done}/{total}
        </span>
      </h3>
      <p className={`${styles.procedureStepsSummary} ${summary.tone}`}>{summary.text}</p>
      <div
        className={styles.procedureStepsTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Tiến độ quy trình"
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className={styles.procedureStepsViewSwitch} role="group" aria-label="Kiểu hiển thị">
        <button
          type="button"
          aria-pressed={view === 'flow'}
          className={view === 'flow' ? styles.procedureStepsViewOn : undefined}
          onClick={() => setView('flow')}
        >
          <Workflow size={13} aria-hidden /> Sơ đồ
        </button>
        <button
          type="button"
          aria-pressed={view === 'list'}
          className={view === 'list' ? styles.procedureStepsViewOn : undefined}
          onClick={() => setView('list')}
        >
          <ListOrdered size={13} aria-hidden /> Danh sách
        </button>
      </div>

      {view === 'flow' ? (
        <ol className={styles.procedureFlow} aria-label="Sơ đồ các bước" ref={flowRef}>
          {layout.map((segment, position) =>
            segment.kind === 'step' ? (
              <FlowNode
                key={segment.step.id}
                step={segment.step}
                index={trunkIndex.get(segment) ?? 0}
                last={position === layout.length - 1}
                instanceStatus={data.status}
                now={now}
              />
            ) : (
              <GatewayFlowBlock
                key={segment.gateway.id}
                name={segment.gateway.name}
                branches={segment.branches}
                last={position === layout.length - 1}
                instanceStatus={data.status}
                now={now}
              />
            ),
          )}
        </ol>
      ) : (
        <ol className={styles.procedureStepsList}>
          {layout.map((segment) =>
            segment.kind === 'step' ? (
              <StepRow
                key={segment.step.id}
                step={segment.step}
                index={trunkIndex.get(segment) ?? 0}
                instanceStatus={data.status}
                now={now}
              />
            ) : (
              <li key={segment.gateway.id} className={styles.procedureFlowGatewayList}>
                <div className={styles.procedureFlowGatewayListName}>
                  Rẽ nhánh: {segment.gateway.name}
                </div>
                {segment.branches.map((item) => (
                  <div
                    key={item.branch.id}
                    className={`${styles.procedureFlowBranch} ${BRANCH_CLASS[item.state]}`}
                  >
                    <BranchHeader item={item} />
                    <ol className={styles.procedureStepsList}>
                      {item.steps.map((step, index) => (
                        <StepRow
                          key={step.id}
                          step={step}
                          index={index}
                          instanceStatus={data.status}
                          now={now}
                        />
                      ))}
                    </ol>
                  </div>
                ))}
              </li>
            ),
          )}
        </ol>
      )}

      {skipped.length > 0 ? (
        <div className={styles.procedureStepsGroup}>
          <button
            type="button"
            className={styles.procedureStepsToggle}
            aria-expanded={skippedOpen}
            onClick={() => setSkippedOpen((open) => !open)}
          >
            {skippedOpen ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
            Nhánh không đi ({skipped.length})
          </button>
          {skippedOpen ? (
            view === 'flow' ? (
              <ol className={styles.procedureFlow} aria-label="Các bước ở nhánh không đi">
                {skipped.map((step, index) => (
                  <FlowNode
                    key={step.id}
                    step={step}
                    index={index}
                    last
                    instanceStatus={data.status}
                    now={now}
                  />
                ))}
              </ol>
            ) : (
              <ol className={styles.procedureStepsList}>
                {skipped.map((step, index) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={index}
                    instanceStatus={data.status}
                    now={now}
                  />
                ))}
              </ol>
            )
          ) : null}
        </div>
      ) : null}

      {data.events.length > 0 ? (
        <div className={styles.procedureStepsGroup}>
          <button
            type="button"
            className={styles.procedureStepsToggle}
            aria-expanded={eventsOpen}
            onClick={() => setEventsOpen((open) => !open)}
          >
            {eventsOpen ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
            Nhật ký hồ sơ ({data.events.length})
          </button>
          {eventsOpen ? (
            <ul className={styles.procedureStepsEvents}>
              {data.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  stepName={
                    event.stepId ? stepNames.get(event.stepId) : undefined
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
