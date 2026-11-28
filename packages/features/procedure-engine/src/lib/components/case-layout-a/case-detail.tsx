'use client';

import {
  evaluateInstanceSla,
  type ProcedureAttachment,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatOverviewDateTime } from '../../procedure-overview';
import { currentWaiting, type SubjectResolver } from '../../step-people';
import { instanceProgress, progressLabel, type TimelineEntry } from '../instance-flow-view';
import {
  InstanceSourceValue,
  SourceSummaryCard,
  workspaceProjectHref,
  type InstanceWorkspaceProject,
} from '../instance-source';
import { SlaBadge } from '../sla-badge';
import { STATUS_LABEL } from '../workspace-board-options';
import boardStyles from '../workspace-board.module.scss';
import { CaseFlow, CaseStepper, ESTIMATE_HINT, isPastState, stepStateOf } from './case-flow';
import styles from './case-layout-a.module.scss';

export type DetailTab = 'flow' | 'chat' | 'files' | 'history';

/** Gợi ý khi rê chuột lên tên hồ sơ: tên đầy đủ, kèm mã hồ sơ cho người hỗ trợ tra cứu. */
export function caseTitleTooltip(instance: Pick<ProcedureInstance, 'title' | 'code'>): string {
  return `${instance.title}\nMã hồ sơ ${instance.code}`;
}

/** Các khối của chi tiết hồ sơ, đều do `WorkspaceBoard` dựng và truyền vào (không có logic nghiệp vụ riêng ở đây). */
export interface CaseLayoutADetail {
  readonly instance: ProcedureInstance;
  readonly project?: InstanceWorkspaceProject;
  /** Đang tra tên dự án (hồ sơ cũ chưa chụp tên): hiện mã dự án hay khung chờ, không để trống. */
  readonly projectPending?: boolean;
  /** Nút quản trị của hồ sơ: cửa sổ đặt trên thanh đầu (xem `CaseModal`), không vẽ trong vùng cuộn. */
  readonly headerActions: ReactNode;
  readonly reversalNotes: ReactNode;
  readonly tabs: ReadonlyArray<{ readonly key: DetailTab; readonly label: string; readonly count: string | number }>;
  readonly tab: DetailTab;
  readonly onTab: (tab: DetailTab) => void;
  readonly entries: readonly TimelineEntry[];
  readonly currentInTimeline: boolean;
  readonly actionPanel: ReactNode;
  readonly renderEntry: (entry: TimelineEntry) => ReactNode;
  readonly renderRoles: (step: ProcedureInstanceStep) => ReactNode;
  readonly performerRole?: (step: ProcedureInstanceStep, actorId?: string, actorName?: string) => ProcedureRaciRole | undefined;
  readonly flowExtras: ReactNode;
  readonly otherTabPanel: ReactNode;
  readonly withdrawStepId?: string;
  readonly attachments: readonly ProcedureAttachment[];
  /** Tra chức danh / đơn vị / nhân sự ra người đang giữ (theo sơ đồ tổ chức), để "Người xử lý" hiện tên người. */
  readonly resolveSubject?: SubjectResolver;
}

/**
 * Tên hồ sơ trên thanh đầu cửa sổ (cạnh ‹ n/N ›): tối đa 2 dòng, đủ tên và mã hồ sơ ở gợi ý; chip trạng thái và SLA ngay sau.
 * Mang `titleId` để cửa sổ lấy làm tên (aria-labelledby).
 */
export function CaseHeading({ instance, titleId }: { instance: ProcedureInstance; titleId: string }) {
  return (
    <div className={styles.modalHeading}>
      <h2 id={titleId} className={styles.title} title={caseTitleTooltip(instance)}>
        {instance.title}
      </h2>
      <span className={styles.headingChips}>
        <span className={`${boardStyles.badge} ${boardStyles[instance.status]}`}>{STATUS_LABEL[instance.status]}</span>
        <SlaBadge view={evaluateInstanceSla(instance)} />
      </span>
    </div>
  );
}

/**
 * Cảnh báo ngắn một dòng khi không tạo được công việc bên Workspace (đủ lý do ở gợi ý). Gắn được / đang tạo thì không ghi
 * gì: dự án đã có ở lưới thông tin.
 */
function WorkspaceLinkWarning({ link }: { link: ProcedureInstance['workspaceLink'] }) {
  if (link?.status !== 'rejected') return null;
  const text = `Không tạo được công việc trong dự án ${link.projectCode}: ${link.error ?? 'lỗi không rõ'}`;
  return (
    <p className={styles.linkWarning} title={text} data-link-warning="">
      <TriangleAlert size={14} aria-hidden />
      <span className={styles.linkWarningText}>{text}</span>
    </p>
  );
}

/**
 * Giá trị ô "Dự án" của cửa sổ hồ sơ: TÊN dự án đầy đủ (bấm mở dự án bên Workspace), dài thì xuống dòng, không cắt; gợi ý
 * có thêm mã dự án. Còn đang tra tên thì hiện mã dự án mờ.
 */
function CaseProjectValue({ project, pending }: { project: InstanceWorkspaceProject; pending: boolean }) {
  const name = project.projectName || project.projectCode;
  return (
    <>
      <a
        className={`text-blue-600 underline ${pending && !project.projectName ? styles.infoPending : ''}`}
        href={workspaceProjectHref({ projectId: project.projectId })}
        title={`${name}\nMã dự án ${project.projectCode} · bấm để mở dự án trong Workspace`}
        aria-busy={pending && !project.projectName ? true : undefined}
      >
        {name}
      </a>
      {project.workItemId ? (
        <>
          {' · '}
          <a className="text-blue-600 underline" href={workspaceProjectHref(project)} title="Mở công việc trong Workspace">
            {project.workItemCode ? `Công việc ${project.workItemCode}` : 'Công việc'}
          </a>
        </>
      ) : null}
    </>
  );
}

/**
 * Nội dung cửa sổ hồ sơ (tên, trạng thái, SLA và nút quản trị nằm trên thanh đầu cửa sổ, xem `CaseHeading`): lưới thông tin
 * chính (giá trị dài xuống dòng, không cắt), các bước nằm ngang, tab nội dung. Lưới thông tin lẫn thanh bước cuộn cùng nội
 * dung (không ghim) để quy trình dài có chỗ; chỉ hàng nút thao tác ghim đáy.
 */
export function CaseDetail({ detail }: { detail: CaseLayoutADetail }) {
  const { instance, project } = detail;
  const starter = instance.activity.find((entry) => entry.action === 'start')?.actorName ?? '—';
  const starterLabel = `${starter}${instance.createdOnBehalfBy ? ` (do ${instance.createdOnBehalfBy.name} tạo hộ)` : ''}`;
  const flowLabel = `${instance.definitionName} · v${instance.definitionVersion}`;
  const progress = instanceProgress(instance);
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const sla = evaluateInstanceSla(instance);
  const dueAt = instance.status === 'running' ? (sla.dueAt ?? current?.slaDueAt) : undefined;
  // Pha S: người đã mở hồ sơ; pha khác: người được giao (tối đa 2 tên + "+N", đủ danh sách ở gợi ý).
  const waiting =
    instance.status === 'running'
      ? (currentWaiting(instance, detail.resolveSubject) ?? { text: 'Đang xử lý', title: 'Đang xử lý' })
      : undefined;
  const projectLabel = project
    ? `${project.projectName || project.projectCode}${project.workItemCode ? ` · Công việc ${project.workItemCode}` : ''}`
    : undefined;
  const stepText = `${progressLabel(progress)}${current ? ` · ${current.name}` : ''}`;

  const scrollRef = useRef<HTMLDivElement>(null);
  // Bước đã qua đang mở thẻ đầy đủ trên tiến trình; bước cần cuộn tới (mở hồ sơ: bước đang làm).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // `reveal`: lúc mở hồ sơ chỉ cuộn khi bước đang làm nằm khuất dưới (đầu hồ sơ cuộn cùng nội dung, không đẩy mất đầu
  // hồ sơ khi bước đã thấy); bấm bước trên thanh ngang thì luôn cuộn tới bước đó.
  const [scrollTarget, setScrollTarget] = useState<{ id: string; reveal?: boolean } | undefined>(() =>
    instance.currentStepId ? { id: instance.currentStepId, reveal: true } : undefined,
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!scrollTarget || !container || detail.tab !== 'flow') return;
    const target = [...container.querySelectorAll<HTMLElement>('[data-step-id]')].find(
      (element) => element.dataset.stepId === scrollTarget.id,
    );
    if (!target) return;
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    if (scrollTarget.reveal) {
      const visibleHeight = container.clientHeight;
      if (offset >= 0 && offset <= visibleHeight * 0.6) return;
      // Bước đang làm hiện ở khoảng một phần ba trên của vùng nhìn, còn thấy vài bước đã qua phía trên.
      container.scrollTop = Math.max(0, container.scrollTop + offset - visibleHeight / 3);
      return;
    }
    container.scrollTop = Math.max(0, container.scrollTop + offset - 8);
  }, [scrollTarget, detail.tab]);

  const toggle = (stepId: string) =>
    setExpanded((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });

  // Bấm một bước trên thanh ngang: về tab Tiến trình, mở thẻ bước đã qua, cuộn tới bước đó.
  const pick = (stepId: string) => {
    const step = instance.steps.find((item) => item.id === stepId);
    const state = step ? stepStateOf(step, instance.currentStepId) : undefined;
    if (state && isPastState(state)) setExpanded((currentSet) => new Set(currentSet).add(stepId));
    if (detail.tab !== 'flow') detail.onTab('flow');
    setScrollTarget({ id: stepId });
  };

  const projectPending = Boolean(detail.projectPending);
  return (
    <div ref={scrollRef} className={`${boardStyles.detailBody} ${styles.detailScroll}`}>
      <header className={styles.detailHead}>
        <dl className={styles.infoGrid} aria-label="Thông tin hồ sơ">
          {/* Dự án: ô rộng nhất ở mọi bề rộng (tên dài xuống dòng, không cắt). */}
          {project ? (
            <div className={`${styles.infoItem} ${styles.infoItemWide} ${styles.infoItemProject}`}>
              <dt>Dự án</dt>
              <dd title={projectLabel}>
                <CaseProjectValue project={project} pending={projectPending} />
              </dd>
            </div>
          ) : projectPending ? (
            <div className={`${styles.infoItem} ${styles.infoItemWide} ${styles.infoItemProject}`}>
              <dt>Dự án</dt>
              <dd aria-busy="true" title="Đang tải tên dự án">
                <span className={styles.infoSkeleton} aria-label="Đang tải tên dự án" />
              </dd>
            </div>
          ) : null}
          <div className={styles.infoItem}>
            <dt>Quy trình</dt>
            <dd title={flowLabel}>{flowLabel}</dd>
          </div>
          <div className={styles.infoItem}>
            <dt>Khởi tạo</dt>
            <dd title={starterLabel}>{starterLabel}</dd>
          </div>
          <div className={styles.infoItem}>
            <dt>Mở đơn</dt>
            <dd className={styles.num}>{formatOverviewDateTime(instance.startedAt)}</dd>
          </div>
          {instance.completedAt ? (
            <div className={styles.infoItem}>
              <dt>Hoàn tất</dt>
              <dd className={styles.num}>{formatOverviewDateTime(instance.completedAt)}</dd>
            </div>
          ) : (
            <div className={styles.infoItem}>
              <dt>Hạn</dt>
              <dd className={`${styles.num} ${sla.state === 'breached' ? styles.overdue : ''}`}>
                {formatOverviewDateTime(dueAt)}
              </dd>
            </div>
          )}
          <div className={`${styles.infoItem} ${styles.infoItemWide}`}>
            <dt>Bước</dt>
            <dd className={styles.num} title={progress.isEstimate ? `${stepText} · ${ESTIMATE_HINT}` : stepText}>
              {stepText}
            </dd>
          </div>
          <div className={styles.infoItem}>
            <dt>Người xử lý</dt>
            <dd title={waiting?.title}>{waiting?.text ?? '—'}</dd>
          </div>
          <div className={styles.infoItem}>
            <dt>Nguồn</dt>
            <dd>
              <InstanceSourceValue instance={instance} />
            </dd>
          </div>
        </dl>

        <CaseStepper instance={instance} entries={detail.entries} onPick={pick} waitingTitle={waiting?.title} />

        <div className={styles.tabs} role="tablist" aria-label="Nội dung hồ sơ">
          {detail.tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={detail.tab === tab.key}
              className={`${styles.tab} ${detail.tab === tab.key ? styles.tabOn : ''}`}
              onClick={() => detail.onTab(tab.key)}
            >
              {tab.label}
              {tab.count ? <span className={styles.tabCount}>{tab.count}</span> : null}
            </button>
          ))}
        </div>
      </header>

      {detail.reversalNotes}
      <SourceSummaryCard summary={instance.sourceSummary} />
      <WorkspaceLinkWarning link={instance.workspaceLink} />
      {detail.tab === 'flow' ? (
        <CaseFlow
          instance={instance}
          entries={detail.entries}
          currentInTimeline={detail.currentInTimeline}
          actionPanel={detail.actionPanel}
          renderEntry={detail.renderEntry}
          renderRoles={detail.renderRoles}
          performerRole={detail.performerRole}
          flowExtras={detail.flowExtras}
          attachments={detail.attachments}
          withdrawStepId={detail.withdrawStepId}
          resolveSubject={detail.resolveSubject}
          expanded={expanded}
          onToggle={toggle}
        />
      ) : (
        detail.otherTabPanel
      )}
    </div>
  );
}
