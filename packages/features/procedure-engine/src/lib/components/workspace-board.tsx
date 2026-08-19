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
  ProcedureSubtaskInput,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  evaluateInstanceSla,
  evaluateStepSla,
} from '@enterprise-platform/contracts-procedure-engine';
import { useEffect, useMemo, useState } from 'react';
import { AttachmentPanel } from './attachment-panel';
import { ChatPanel } from './chat-panel';
import { DetailTabs } from './detail-tabs';
import { SlaBadge } from './sla-badge';
import { SubtaskPanel } from './subtask-panel';
import styles from './workspace-board.module.scss';

type Filter = 'all' | 'running' | 'completed' | 'rejected';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'running', label: 'Đang xử lý' },
  { id: 'completed', label: 'Hoàn thành' },
  { id: 'rejected', label: 'Từ chối' },
];

const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
};

const STEP_ICON: Record<ProcedureInstanceStepStatus, string> = {
  pending: '🕘',
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
  ) => Promise<void>;
  onOpenDefinitions: () => void;
  onStart: (definition: ProcedureDefinition) => Promise<void>;
  attachments?: readonly ProcedureAttachment[];
  onSeedSubtasks?: (instanceId: string) => void;
  onSetSubtasks?: (instanceId: string, items: ProcedureSubtaskInput[]) => void;
  onCompleteSubtask?: (instanceId: string, subtaskId: string) => void;
  onCancelSubtask?: (instanceId: string, subtaskId: string) => void;
  onUploadEvidence?: (instanceId: string, subtaskId: string, file: File) => void;
  onUploadFile?: (instanceId: string, file: File) => void;
  onSendComment?: (instanceId: string, body: string, mentions: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [comment, setComment] = useState('');
  const [creating, setCreating] = useState(false);

  const published = definitions.filter((item) => item.status === 'published');
  const names = useMemo(() => subjectNames(organization), [organization]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return instances.filter((instance) => {
      if (filter !== 'all' && instance.status !== filter) return false;
      if (!needle) return true;
      return (
        instance.code.toLowerCase().includes(needle) ||
        instance.title.toLowerCase().includes(needle) ||
        instance.definitionName.toLowerCase().includes(needle)
      );
    });
  }, [filter, instances, query]);

  // Luôn giữ một đơn được chọn: danh sách đổi theo bộ lọc nên lựa chọn cũ có
  // thể biến mất khỏi màn hình.
  const selected =
    visible.find((instance) => instance.id === selectedId) ?? visible[0];

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

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <h2>Không có đơn nào bạn đang tham gia</h2>
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
          <div className={styles.cardStrip}>
            {visible.map((instance) => (
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
                    <span aria-hidden="true">▦</span> Tiến trình các bước
                  </h3>
                  <div className={styles.stepStrip}>
                    {selected.steps.map((step) => (
                      <div
                        key={step.id}
                        className={`${styles.stepCard} ${
                          step.id === selected.currentStepId ? styles.stepCurrent : ''
                        } ${styles[`step_${step.status}`]}`}
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
                                onSetItems={(items) => onSetSubtasks(selected.id, items)}
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
                      label: '📎 Tệp',
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
                      label: '💬 Trao đổi',
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
  ) => Promise<void>;
  onComment: (value: string) => void;
}) {
  const authorization = instance.authorization;
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
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
                    onClick={() => void onAction(instance.id, action, comment || undefined)}
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
