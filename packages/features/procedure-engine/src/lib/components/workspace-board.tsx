'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureInstanceStep,
  ProcedureInstanceStepStatus,
  ProcedureRaciRole,
  ProcedureAttachment,
  ProcedureRuntimeAction,
  ProcedureSubtaskExecutionMode,
  ProcedureSubtaskInput,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  evaluateInstanceSla,
  evaluateStepSla,
  PROCEDURE_STAGE_ORDER,
  type ProcedureSlaView,
} from '@enterprise-platform/contracts-procedure-engine';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AttachmentPanel } from './attachment-panel';
import { ChatPanel } from './chat-panel';
import { DetailTabs } from './detail-tabs';
import { SlaBadge } from './sla-badge';
import { SubtaskPanel } from './subtask-panel';
import styles from './workspace-board.module.scss';

const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
};

type Filter = 'all' | ProcedureInstance['status'];

/**
 * Suy ra từ STATUS_LABEL chứ không liệt kê tay.
 *
 * Bản liệt kê tay trước đây thiếu 'cancelled', nên đơn đã huỷ không lọc tới
 * được và tổng các tab không khớp con số "Tất cả".
 */
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  ...(Object.keys(STATUS_LABEL) as ProcedureInstance['status'][]).map((status) => ({
    id: status as Filter,
    label: STATUS_LABEL[status],
  })),
];

const STEP_ICON: Record<ProcedureInstanceStepStatus, string> = {
  pending: '○',
  active: '↻',
  ready: '↻',
  completed: '✓',
  returned: '↩',
  rejected: '✕',
  cancelled: '⊘',
};

const ACTION_LABEL: Record<ProcedureRuntimeAction, string> = {
  approve: 'Phê duyệt',
  reject: 'Từ chối',
  return: 'Trả lại',
  complete: 'Hoàn tất',
  cancel: 'Huỷ hồ sơ',
  comment: 'Ghi nhận trao đổi',
};

const ROLE_ORDER: readonly ProcedureRaciRole[] = ['S', 'R', 'E', 'C', 'A', 'I'];

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDateTime(value?: string): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

/**
 * Tên người thực sự nhận việc. Phân công ở cấp đơn vị định tuyến tới người phụ
 * trách, nên chỉ hiện tên đơn vị thì người dùng không biết ai phải làm.
 */
function subjectNames(snapshot?: TenantOrganizationSnapshot) {
  const label = new Map<string, string>();
  if (!snapshot) return label;

  // Snapshot đến từ Core qua HTTP; một phản hồi thiếu trường không được phép làm
  // trắng cả màn hình Workspace, nên đọc phòng thủ thay vì tin vào kiểu.
  const units = snapshot.units ?? [];
  const positions = snapshot.positions ?? [];
  const members = snapshot.members ?? [];

  for (const unit of units) {
    label.set(unit.id, unit.headName ? `${unit.headName} (${unit.name})` : unit.name);
  }
  for (const position of positions) {
    const holders = members
      .filter((member) => member.positionId === position.id)
      .map((member) => member.displayName);
    label.set(position.id, holders.length > 0 ? holders.join(', ') : position.name);
  }
  for (const member of members) label.set(member.userId, member.displayName);
  return label;
}

/** Người có mặt trong hồ sơ, để gợi ý @ và tô đậm khi hiển thị. */
function participantsOf(
  instance: ProcedureInstance,
  names: ReadonlyMap<string, string>,
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const step of instance.steps) {
    for (const assignment of step.assignments) {
      const label = names.get(assignment.subjectId) ?? assignment.subjectLabel;
      if (label) seen.set(assignment.subjectId, label);
    }
  }
  for (const subtask of instance.subtasks ?? []) {
    if (subtask.assigneeId && subtask.assigneeName) seen.set(subtask.assigneeId, subtask.assigneeName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** “S: Phạm Thị Hà, Lê Văn Nam; C: Nguyễn Văn Tuấn” — ai giữ vai trò gì ở bước. */
function roleLines(step: ProcedureInstanceStep, names: ReadonlyMap<string, string>) {
  return ROLE_ORDER.flatMap((role) => {
    const holders = step.assignments
      .filter((item) => item.role === role)
      .map((item) => names.get(item.subjectId) ?? item.subjectLabel ?? item.subjectId);
    return holders.length > 0 ? [{ role, names: holders.join(', ') }] : [];
  });
}

/**
 * Phần trăm hoàn thành của một bước.
 *
 * Một bước chạy lần lượt qua các pha RACI mà nó có (S → R → E → C → A). Tiến độ
 * gồm hai phần: số pha đã đi qua trọn vẹn, cộng phần dở dang của pha đang chạy.
 *
 * Phần dở dang lấy từ **trọng số đầu việc đã xong** khi bước đang ở pha E và đã
 * phân rã — đây là con số thật, không phải ước lượng, vì tổng trọng số luôn bằng
 * 100. Các pha khác không có thước đo nào bên trong nên tính nửa pha: đang làm
 * mà hiện 0% thì người xem tưởng chưa ai động tới.
 */
function stepProgress(step: ProcedureInstanceStep, instance: ProcedureInstance): number {
  if (step.status === 'completed') return 1;
  if (step.status === 'rejected' || step.status === 'cancelled') return 0;
  if (step.status === 'pending') return 0;

  const stages = PROCEDURE_STAGE_ORDER.filter((role) =>
    step.assignments.some((assignment) => assignment.role === role),
  );
  if (stages.length === 0 || !step.currentRoleStage) return 0;

  const passed = stages.indexOf(step.currentRoleStage);
  if (passed < 0) return 0;

  let partial = 0.5;
  if (step.currentRoleStage === 'E') {
    const subtasks = (instance.subtasks ?? []).filter((item) => item.stepInstanceId === step.id);
    if (subtasks.length > 0) {
      partial =
        subtasks
          .filter((item) => item.status === 'completed')
          .reduce((sum, item) => sum + item.weight, 0) / 100;
    }
  }

  return Math.min(1, (passed + partial) / stages.length);
}

export function WorkspaceBoard({
  busy,
  actorName,
  actorId,
  organization,
  definitions,
  instances,
  onAction,
  onOpenDefinitions,
  onStart,
  attachments = [],
  onSeedSubtasks,
  onRecheckMaterials,
  onSetSubtasks,
  onCompleteSubtask,
  onCancelSubtask,
  onUploadEvidence,
  onUploadFile,
  onSendComment,
}: {
  busy?: string;
  actorName?: string;
  actorId?: string;
  organization?: TenantOrganizationSnapshot;
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
  onAction: (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) => Promise<void>;
  onOpenDefinitions: () => void;
  onStart: (definition: ProcedureDefinition) => Promise<void>;
  attachments?: readonly ProcedureAttachment[];
  onSeedSubtasks?: (instanceId: string) => void;
  onRecheckMaterials?: (instanceId: string) => void;
  onSetSubtasks?: (
    instanceId: string,
    items: ProcedureSubtaskInput[],
    executionMode: ProcedureSubtaskExecutionMode,
  ) => void;
  onCompleteSubtask?: (instanceId: string, subtaskId: string) => void;
  onCancelSubtask?: (instanceId: string, subtaskId: string) => void;
  onUploadEvidence?: (instanceId: string, subtaskId: string, file: File) => void;
  onUploadFile?: (instanceId: string, file: File) => void;
  onSendComment?: (instanceId: string, body: string, mentions: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [slaFilter, setSlaFilter] = useState<'all' | ProcedureSlaView['state']>('all');
  const [source, setSource] = useState<'all' | 'manual' | 'maintenance_occurrence' | 'auto_from_parent'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [comment, setComment] = useState('');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const published = definitions.filter((item) => item.status === 'published');
  const names = useMemo(() => subjectNames(organization), [organization]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Ngày lọc theo NGÀY BẮT ĐẦU của hồ sơ, tính theo mốc đầu/cuối ngày để người
    // dùng chọn "từ 19/8 đến 19/8" vẫn ra hồ sơ mở trong ngày đó.
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;

    const matched = instances.filter((instance) => {
      if (filter !== 'all' && instance.status !== filter) return false;
      if (source !== 'all' && (instance.sourceType ?? 'manual') !== source) return false;
      if (slaFilter !== 'all' && evaluateInstanceSla(instance).state !== slaFilter) return false;

      const started = Date.parse(instance.startedAt);
      if (fromTime !== undefined && started < fromTime) return false;
      if (toTime !== undefined && started > toTime) return false;

      if (!needle) return true;
      return (
        instance.code.toLowerCase().includes(needle) ||
        instance.title.toLowerCase().includes(needle) ||
        instance.definitionName.toLowerCase().includes(needle)
      );
    });

    // Mặc định sắp theo ngày mở hồ sơ, mới nhất trước. Sắp ở đây chứ không dựa
    // vào thứ tự server trả về, để mọi bộ lọc đều cho ra cùng một trật tự.
    return [...matched].sort((left, right) =>
      dateSort === 'newest'
        ? right.startedAt.localeCompare(left.startedAt)
        : left.startedAt.localeCompare(right.startedAt),
    );
  }, [filter, instances, query, source, slaFilter, from, to, dateSort]);

  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Bộ lọc đổi có thể làm trang hiện tại vượt quá số trang còn lại.
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const filtersActive =
    source !== 'all' || slaFilter !== 'all' || Boolean(from) || Boolean(to);

  // Luôn giữ một đơn được chọn: danh sách đổi theo bộ lọc nên lựa chọn cũ có
  // thể biến mất khỏi màn hình.
  const selected =
    visible.find((instance) => instance.id === selectedId) ?? paged[0] ?? visible[0];

  useEffect(() => {
    setComment('');
  }, [selected?.id]);

  return (
    <section className={styles.workspace}>
      <header className={styles.topBar}>
        <div>
          <h1>Workspace</h1>
          {/* Tên người đăng nhập đã có ở thanh shell; nhắc lại ở đây là thừa. */}
          <p>
            Chỉ hiện những đơn bạn đang giữ vai trò, ở bất kỳ bước nào — kể cả việc được uỷ quyền
            lại hoặc được phân rã cho bạn.
          </p>
        </div>
        <div className={styles.topActions}>
          {published.length > 0 ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setCreating((open) => !open)}
            >
              <span aria-hidden="true">⊕</span> Tạo Đơn / Yêu cầu Mới
            </button>
          ) : null}
          <input
            className={styles.search}
            placeholder="Tìm kiếm đơn, mã…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </header>

      {creating ? (
        <div className={styles.createPanel}>
          <span>Chọn quy trình để mở đơn mới:</span>
          <div className={styles.createList}>
            {published.map((definition) => (
              <button
                key={definition.id}
                type="button"
                disabled={busy === `start:${definition.id}`}
                onClick={() => {
                  void onStart(definition).then(() => setCreating(false));
                }}
              >
                <strong>{definition.code}</strong>
                <span>{definition.name}</span>
                <small>{definition.steps.length} bước</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <nav className={styles.filters}>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={filter === entry.id ? styles.filterOn : undefined}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            <span className={styles.filterCount}>
              {entry.id === 'all'
                ? instances.length
                : instances.filter((item) => item.status === entry.id).length}
            </span>
          </button>
        ))}
      </nav>

      <div className={styles.moreFilters}>
        <label>
          Sắp xếp
          <select
            value={dateSort}
            onChange={(event) => {
              setDateSort(event.target.value as 'newest' | 'oldest');
              setPage(1);
            }}
          >
            <option value="newest">Ngày mở — mới nhất trước</option>
            <option value="oldest">Ngày mở — cũ nhất trước</option>
          </select>
        </label>
        <label>
          SLA
          <select
            value={slaFilter}
            onChange={(event) => setSlaFilter(event.target.value as typeof slaFilter)}
          >
            <option value="all">Tất cả</option>
            <option value="breached">Đã quá hạn</option>
            <option value="warning">Sắp đến hạn</option>
            <option value="ok">Còn thời gian</option>
            <option value="none">Không cài SLA</option>
          </select>
        </label>
        <label>
          Nguồn
          <select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
            <option value="all">Tất cả</option>
            <option value="manual">Tạo thủ công</option>
            <option value="maintenance_occurrence">Từ bảo trì</option>
            <option value="auto_from_parent">Nối tiếp quy trình</option>
          </select>
        </label>
        <label>
          Mở từ ngày
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        {filtersActive ? (
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              setSlaFilter('all');
              setSource('all');
              setFrom('');
              setTo('');
            }}
          >
            Xoá lọc
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <h2>
            {filtersActive || query
              ? 'Không có đơn nào khớp bộ lọc'
              : 'Không có đơn nào bạn đang tham gia'}
          </h2>
          <p>
            Workspace chỉ hiện đơn mà bạn giữ vai trò. Nếu cần xem toàn bộ quy trình của doanh
            nghiệp, mở bảng thiết kế ma trận RCSI.
          </p>
          <button type="button" className={styles.ghost} onClick={onOpenDefinitions}>
            Mở ma trận quy trình
          </button>
        </div>
      ) : (
        <>
          {pageCount > 1 ? (
            <div className={styles.pager}>
              <span>
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)}{' '}
                trên {visible.length} hồ sơ
              </span>
              <div>
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ← Trước
                </button>
                <strong>
                  {currentPage} / {pageCount}
                </strong>
                <button
                  type="button"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Sau →
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.cardStrip}>
            {paged.map((instance) => (
              <button
                key={instance.id}
                type="button"
                className={`${styles.orderCard} ${
                  instance.id === selected?.id ? styles.orderCardOn : ''
                }`}
                onClick={() => setSelectedId(instance.id)}
              >
                <span className={styles.cardTop}>
                  <span className={styles.code}>{instance.code}</span>
                  <span className={`${styles.badge} ${styles[instance.status]}`}>
                    {STATUS_LABEL[instance.status]}
                  </span>
                </span>
                <strong>{instance.title}</strong>
                <span className={styles.cardFoot}>
                  <span>{instance.definitionCode}</span>
                  <span className={styles.cardFootRight}>
                    <SlaBadge view={evaluateInstanceSla(instance)} />
                    {instance.steps.filter((step) => step.status === 'completed').length}/
                    {instance.steps.length} bước
                  </span>
                </span>
              </button>
            ))}
          </div>

          {selected ? (
            <div className={styles.detailLayout}>
              <div className={styles.detailMain}>
                <article className={styles.panel}>
                  <header className={styles.detailHead}>
                    <span className={styles.code}>{selected.code}</span>
                    <span className={`${styles.badge} ${styles[selected.status]}`}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </header>
                  <h2 className={styles.detailTitle}>{selected.title}</h2>

                  <dl className={styles.metaGrid}>
                    <div>
                      <dt>Người khởi tạo</dt>
                      <dd>
                        {selected.activity.find((entry) => entry.action === 'start')?.actorName ??
                          '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Đơn vị</dt>
                      <dd>
                        {selected.steps[0]?.assignments.find((item) => item.role === 'S')
                          ?.subjectLabel ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Quy trình</dt>
                      <dd>
                        {selected.definitionName}
                        <small> · v{selected.definitionVersion}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Nguồn</dt>
                      <dd>
                        {selected.sourceType === 'maintenance_occurrence'
                          ? 'Lịch bảo trì'
                          : 'Tạo thủ công'}
                      </dd>
                    </div>
                    <div>
                      <dt>{selected.completedAt ? 'Hoàn thành' : 'Bắt đầu'}</dt>
                      <dd>{formatDateTime(selected.completedAt ?? selected.startedAt)}</dd>
                    </div>
                  </dl>
                </article>

                <article className={styles.panel}>
                  <h3 className={styles.panelTitle}>
Tiến trình các bước
                  </h3>
                  <div className={styles.stepStrip}>
                    {selected.steps.map((step) => (
                      <div
                        key={step.id}
                        className={`${styles.stepCard} ${
                          step.id === selected.currentStepId ? styles.stepCurrent : ''
                        } ${styles[`step_${step.status}`]}`}
                        // Nền xanh phủ đúng phần đã hoàn thành. Dùng biến CSS thay
                        // vì đặt nền trực tiếp, để lớp trạng thái vẫn giữ được màu
                        // viền và màu nền nền của nó.
                        style={
                          {
                            '--progress': `${Math.round(stepProgress(step, selected) * 100)}%`,
                          } as CSSProperties
                        }
                      >
                        <span className={styles.stepTop}>
                          <span>BƯỚC {step.order}</span>
                          <span className={styles.stepIcon}>{STEP_ICON[step.status]}</span>
                        </span>
                        <strong>{step.name}</strong>
                        <ul className={styles.stepRoles}>
                          {roleLines(step, names).map((line) => (
                            <li key={line.role}>
                              <i className={`${styles.role} ${styles[`role${line.role}`]}`}>
                                {line.role}
                              </i>
                              {line.names}
                            </li>
                          ))}
                          {step.assignments.length === 0 ? (
                            <li className={styles.stepMuted}>Chưa phân vai</li>
                          ) : null}
                        </ul>
                        <span className={styles.stepFoot}>
                          {step.currentRoleStage ? (
                            <span className={styles.stepStage}>
                              Đang ở pha {step.currentRoleStage}
                            </span>
                          ) : null}
                          <SlaBadge
                            view={evaluateStepSla(step, selected)}
                            slaHours={step.slaHours}
                            startedAt={step.startedAt}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <aside className={styles.detailSide}>
                <ActionPanel
                  busy={busy}
                  comment={comment}
                  instance={selected}
                  onAction={onAction}
                  onComment={setComment}
                />

                <MaterialStatus
                  instance={selected}
                  busy={busy}
                  onRecheck={onRecheckMaterials ? () => onRecheckMaterials(selected.id) : undefined}
                />

                <DetailTabs
                  tabs={[
                    ...(onSeedSubtasks &&
                    onSetSubtasks &&
                    onCompleteSubtask &&
                    onCancelSubtask &&
                    onUploadEvidence
                      ? [
                          {
                            id: 'work',
                            label: 'Phân rã việc',
                            render: () => (
                              <SubtaskPanel
                                instance={selected}
                                organization={organization}
                                actorId={actorId}
                                busy={busy}
                                attachments={attachments}
                                onSeed={() => onSeedSubtasks(selected.id)}
                                onSetItems={(items, mode) => onSetSubtasks(selected.id, items, mode)}
                                onComplete={(subtaskId) => onCompleteSubtask(selected.id, subtaskId)}
                                onCancel={(subtaskId) => onCancelSubtask(selected.id, subtaskId)}
                                onUpload={(subtaskId, file) =>
                                  onUploadEvidence(selected.id, subtaskId, file)
                                }
                              />
                            ),
                          },
                        ]
                      : []),
                    {
                      id: 'files',
                      label: 'Tệp',
                      count: attachments.filter((item) => item.instanceId === selected.id).length,
                      render: () => (
                        <AttachmentPanel
                          instance={selected}
                          attachments={attachments}
                          busy={busy}
                          onUpload={(file) => onUploadFile?.(selected.id, file)}
                        />
                      ),
                    },
                    {
                      id: 'chat',
                      label: 'Trao đổi',
                      count: selected.activity.length,
                      render: () => (
                        <ChatPanel
                          instance={selected}
                          busy={busy}
                          participants={participantsOf(selected, names)}
                          onSend={(body, mentions) => onSendComment?.(selected.id, body, mentions)}
                        />
                      ),
                    },
                  ]}
                />
              </aside>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActionPanel({
  busy,
  comment,
  instance,
  onAction,
  onComment,
}: {
  busy?: string;
  comment: string;
  instance: ProcedureInstance;
  onAction: (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) => Promise<void>;
  onComment: (value: string) => void;
}) {
  const authorization = instance.authorization;
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const currentIndex = instance.steps.findIndex((step) => step.id === instance.currentStepId);

  /**
   * Điểm quay về của C được cấu hình sẵn từ lúc thiết kế, nên chỉ vai trò A mới
   * chọn được bước trả về. Đưa ô chọn ra ngay cạnh nút để người duyệt không phải
   * đoán hồ sơ sẽ rơi về đâu.
   */
  const fixedRollback = current?.assignments.find(
    (item) => item.role === 'C' && item.fixedRollbackStepId,
  )?.fixedRollbackStepId;
  const canPickReturnStep =
    current?.currentRoleStage === 'A' && !fixedRollback && currentIndex > 0;
  const earlierSteps = currentIndex > 0 ? instance.steps.slice(0, currentIndex) : [];
  const [returnTo, setReturnTo] = useState('');
  const actions = authorization?.availableActions ?? [];
  // Quản trị viên hành động bằng quyền override, myRoles của họ vẫn rỗng — chỉ
  // xét myRoles sẽ khoá mất bảng thao tác của chính người điều hành ma trận.
  const canAct = actions.length > 0 || (authorization?.myRoles.length ?? 0) > 0;

  return (
    <article className={styles.panel}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>Xử lý &amp; Phê duyệt</h3>
        {current ? <span className={styles.stepBadge}>Bước: {current.name}</span> : null}
      </header>

      {!authorization || !canAct ? (
        <p className={styles.panelHint}>
          Bạn không giữ vai trò nào ở bước hiện tại — chỉ theo dõi được tiến trình.
        </p>
      ) : (
        <>
          <p className={styles.myRoles}>
            Vai trò bạn giữ ở bước này:{' '}
            {authorization.myRoles.length > 0 ? (
              authorization.myRoles.map((role) => (
                <i key={role} className={`${styles.role} ${styles[`role${role}`]}`}>
                  {role}
                </i>
              ))
            ) : (
              <span className={styles.tag}>quản trị — quyền override</span>
            )}
            {authorization.isDelegated ? (
              <span className={styles.tag}>được uỷ quyền</span>
            ) : null}
            {authorization.isEscalated ? (
              <span className={styles.tag}>xử lý thay cấp dưới</span>
            ) : null}
          </p>

          <label className={styles.commentField}>
            Ghi chú phản hồi / lý do từ chối
            <textarea
              rows={4}
              placeholder="Nhập nhận xét hoặc phương án điều chỉnh…"
              value={comment}
              onChange={(event) => onComment(event.target.value)}
            />
          </label>

          {canPickReturnStep && actions.includes('return') ? (
            <label className={styles.commentField}>
              Trả lại về bước
              <select value={returnTo} onChange={(event) => setReturnTo(event.target.value)}>
                <option value="">
                  Bước liền trước ({earlierSteps[earlierSteps.length - 1]?.order}-
                  {earlierSteps[earlierSteps.length - 1]?.name})
                </option>
                {earlierSteps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.order}-{step.name}
                  </option>
                ))}
              </select>
            </label>
          ) : fixedRollback && actions.includes('return') ? (
            <p className={styles.panelHint}>
              Bước quay về đã cấu hình sẵn:{' '}
              <strong>
                {instance.steps.find((step) => step.definitionStepId === fixedRollback)?.name ??
                  'bước trước'}
              </strong>
            </p>
          ) : null}

          {actions.length === 0 ? (
            <p className={styles.panelHint}>
              Chưa tới lượt bạn: bước này đang ở pha {current?.currentRoleStage ?? '—'}.
            </p>
          ) : (
            <div className={styles.actionRow}>
              {actions
                .filter((action) => action !== 'approve' && action !== 'complete')
                .map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={action === 'reject' ? styles.danger : styles.ghost}
                    disabled={busy === `${action}:${instance.id}`}
                    onClick={() =>
                      void onAction(
                        instance.id,
                        action,
                        comment || undefined,
                        action === 'return' ? returnTo || undefined : undefined,
                      )
                    }
                  >
                    {busy === `${action}:${instance.id}` ? 'Đang xử lý…' : ACTION_LABEL[action]}
                  </button>
                ))}
              {actions
                .filter((action) => action === 'approve' || action === 'complete')
                .map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={styles.primary}
                    disabled={busy === `${action}:${instance.id}`}
                    onClick={() => void onAction(instance.id, action, comment || undefined)}
                  >
                    {busy === `${action}:${instance.id}` ? 'Đang xử lý…' : ACTION_LABEL[action]}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}

/**
 * Tình trạng vật tư của bước hiện tại.
 *
 * Hiện ngay trên panel chi tiết chứ không giấu trong tab: bước thiếu hàng là thứ
 * chặn công việc, người dùng phải thấy trước khi bấm bất cứ nút nào.
 */
function MaterialStatus({
  instance,
  busy,
  onRecheck,
}: {
  instance: ProcedureInstance;
  busy?: string;
  onRecheck?: () => void;
}) {
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  if (!step?.materials?.length) return null;

  const check = step.materialCheck;
  const short = check?.state === 'short';

  return (
    <article className={`${styles.panel} ${short ? styles.materialShort : ''}`}>
      <header className={styles.actionHead}>
        <h3 className={styles.panelTitle}>Vật tư cần cho bước này</h3>
        {onRecheck ? (
          <button
            type="button"
            className={styles.ghost}
            disabled={busy === 'materials'}
            onClick={onRecheck}
          >
            {busy === 'materials' ? 'Đang kiểm…' : 'Kiểm lại tồn kho'}
          </button>
        ) : null}
      </header>

      {short ? (
        <p className={styles.materialAlert}>
          Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng. Nhập kho xong thì bấm “Kiểm lại tồn
          kho”.
        </p>
      ) : step.materialReservations?.length ? (
        <p className={styles.materialHeld}>
          Đã giữ hàng trong kho cho bước này —{' '}
          {step.materialReservations.map((code) => (
            <code key={code}>{code}</code>
          ))}
          . Hàng được trả lại kho khi bước xong hoặc hồ sơ đóng.
        </p>
      ) : null}

      <ul className={styles.materialList}>
        {step.materials.map((item) => {
          const line = check?.lines.find((row) => row.materialCode === item.materialCode);
          return (
            <li key={item.materialCode} className={line && line.short > 0 ? styles.lineShort : ''}>
              <span>{item.materialName ?? item.materialCode}</span>
              <em>
                cần {item.quantity}
                {item.unit ? ` ${item.unit}` : ''}
              </em>
              <strong>
                {line
                  ? line.short > 0
                    ? `thiếu ${line.short}`
                    : `còn ${line.available}`
                  : 'chưa kiểm'}
              </strong>
            </li>
          );
        })}
      </ul>

      {check ? (
        <small className={styles.panelHint}>
          Kiểm lúc {new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
          }).format(new Date(check.checkedAt))}
        </small>
      ) : null}
    </article>
  );
}
