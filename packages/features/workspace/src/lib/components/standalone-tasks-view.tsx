'use client';

import {
  STANDALONE_TASK_SCOPES,
  STANDALONE_TASK_SYSTEM_ACTOR_ID,
  WORK_ITEM_STATUSES,
  type CreateStandaloneTaskRequest,
  type StandaloneTask,
  type StandaloneTaskDetail,
  type StandaloneTaskListItem,
  type StandaloneTaskRef,
  type StandaloneTaskRole,
  type StandaloneTaskScope,
  type WorkItemStatus,
  WORKSPACE_ASSISTANT_ACTIONS,
} from '@enterprise-platform/contracts-workspace';
import { useAssistantSaved } from '@enterprise-platform/feature-module-shell';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  ChevronRight,
  ExternalLink,
  GitBranch,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROCEDURE_LAUNCH_URL } from '../procedure-api';
import * as api from '../workspace-api';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  STANDALONE_TASK_PROCEDURE_STATUS_LABELS,
  STANDALONE_TASK_ROLE_LABELS,
  STANDALONE_TASK_SCOPE_LABELS,
  WORK_ITEM_STATUS_LABELS,
  formatDate,
  formatDateTime,
  standaloneTaskStatusLabel,
  standaloneTaskStatusTone,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { ReverseStandaloneTaskDialog } from './reverse-standalone-task-dialog';
import { StandaloneTaskForm } from './standalone-task-form';
import { useDirectory, type DirectoryView } from './use-directory';

const CLOSED: readonly WorkItemStatus[] = ['done', 'cancelled'];
const STANDALONE_TASK_ACTION_KEYS = [WORKSPACE_ASSISTANT_ACTIONS.createStandaloneTask.key];

/** Bộ lọc trạng thái: mặc định chỉ việc đang mở. */
const STATUS_FILTERS = [
  { value: 'open', label: 'Đang mở' },
  ...WORK_ITEM_STATUSES.map((status) => ({ value: status, label: WORK_ITEM_STATUS_LABELS[status] })),
  { value: 'reversed', label: 'Đã huỷ hiệu lực' },
];

/** Bộ lọc trạng thái; "Đã huỷ" không gồm việc huỷ hiệu lực (có lựa chọn riêng). */
function matchesStatus(task: StandaloneTask, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'open') return !CLOSED.includes(task.status);
  if (filter === 'reversed') return Boolean(task.reversal);
  if (filter === 'cancelled') return task.status === 'cancelled' && !task.reversal;
  return task.status === filter;
}

export interface StandaloneTasksViewProps {
  /** Việc đang mở bên cột phải, lấy từ hash `#tasks/<id>` (link trong thông báo). */
  readonly focusTaskId?: string;
  readonly onFocusChange: (taskId: string | undefined) => void;
  /** Tăng mỗi lần bấm "Giao việc" ở đầu trang. */
  readonly createRequest: number;
  readonly onCreateHandled: () => void;
}

/**
 * Trang "Công việc ngoài dự án".
 *
 * Master-detail hai cột, mỗi cột tự cuộn: bên trái là danh sách theo ba ngăn
 * (Giao cho tôi / Tôi giao / Tôi theo dõi), bên phải là chi tiết việc đang
 * chọn cùng các nút chuyển trạng thái hợp lệ với vai của người xem. Server trả
 * sẵn `allowedStatuses`, nên giao diện không tự suy quyền.
 */
export function StandaloneTasksView({
  focusTaskId,
  onFocusChange,
  createRequest,
  onCreateHandled,
}: StandaloneTasksViewProps) {
  const directory = useDirectory();
  const [scope, setScope] = useState<StandaloneTaskScope>('assigned_to_me');
  const [items, setItems] = useState<readonly StandaloneTaskListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [statusFilter, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState<StandaloneTaskDetail>();
  const [detailError, setDetailError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StandaloneTask>();
  /** Đang thêm việc con cho việc này. */
  const [childParent, setChildParent] = useState<StandaloneTaskRef>();
  /** Đang lập việc điều chỉnh cho việc đã huỷ hiệu lực này. */
  const [adjustmentOf, setAdjustmentOf] = useState<StandaloneTask>();
  /** Việc đang hỏi "Huỷ hiệu lực?". */
  const [reverseTarget, setReverseTarget] = useState<StandaloneTask>();
  const [historyOpen, setHistoryOpen] = useState(false);

  const reloadList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listStandaloneTasks(scope);
      setItems(result.items);
      setError(undefined);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tải được danh sách công việc.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  // Card Trợ lý vừa giao việc ngoài dự án: tải lại ngăn đang xem.
  useAssistantSaved(STANDALONE_TASK_ACTION_KEYS, () => void reloadList());

  /** Ids đang có ở cột trái, để biết việc vừa mở (từ link thông báo) có nằm trong ngăn hiện tại không. */
  const listedIds = useRef(new Set<string>());
  listedIds.current = new Set(items.map((item) => item.task.id));

  const loadDetail = useCallback(async (taskId: string) => {
    try {
      const next = await api.getStandaloneTask(taskId);
      setDetail(next);
      setDetailError(undefined);
      // Mở từ link thông báo: chuyển cột trái sang ngăn chứa việc đó. Người chỉ
      // xem qua cây không có ngăn nào chứa việc này, giữ nguyên ngăn đang xem.
      if (!listedIds.current.has(taskId) && next.myRole !== 'viewer') {
        setScope(scopeOfRole(next.myRole));
      }
    } catch (cause) {
      setDetail(undefined);
      setDetailError((cause as { message?: string })?.message ?? 'Không tải được công việc.');
    }
  }, []);

  useEffect(() => {
    setHistoryOpen(false);
    if (focusTaskId) void loadDetail(focusTaskId);
    else {
      setDetail(undefined);
      setDetailError(undefined);
    }
  }, [focusTaskId, loadDetail]);

  // Hồ sơ quy trình đang được mở bên module Quy trình: hỏi lại sau mỗi 3 giây
  // cho tới khi có kết quả (đã mở hoặc không mở được).
  const pendingProcedure =
    detail?.task.procedure?.status === 'pending' ? detail.task.id : undefined;
  useEffect(() => {
    if (!pendingProcedure) return;
    const timer = setInterval(() => {
      void api
        .getStandaloneTask(pendingProcedure)
        .then(setDetail)
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingProcedure]);

  // Nút "Giao việc" ở đầu trang.
  useEffect(() => {
    if (createRequest === 0) return;
    setEditing(undefined);
    setChildParent(undefined);
    setAdjustmentOf(undefined);
    setFormOpen(true);
    onCreateHandled();
  }, [createRequest, onCreateHandled]);

  /** Sau mỗi lần ghi: cập nhật cột phải bằng phản hồi, nạp lại cột trái. */
  const applyDetail = useCallback(
    (next: StandaloneTaskDetail) => {
      setDetail(next);
      void reloadList();
    },
    [reloadList],
  );

  const visible = useMemo(() => {
    const needle = fold(search.trim());
    return items.filter(({ task }) => {
      if (!matchesStatus(task, statusFilter)) return false;
      return !needle || fold(`${task.code} ${task.title}`).includes(needle);
    });
  }, [items, statusFilter, search]);

  const submitForm = async (input: CreateStandaloneTaskRequest) => {
    if (editing) {
      applyDetail(await api.updateStandaloneTask(editing.id, input));
    } else if (adjustmentOf) {
      // Việc điều chỉnh là việc gốc mới, nằm ở ngăn "Tôi giao".
      const created = await api.createStandaloneTask(input);
      if (scope !== 'assigned_by_me') setScope('assigned_by_me');
      else void reloadList();
      onFocusChange(created.task.id);
    } else if (childParent) {
      // Thêm việc con: ở lại việc cha để thấy danh sách việc con cập nhật.
      await api.createStandaloneTask(input);
      applyDetail(await api.getStandaloneTask(childParent.id));
    } else {
      const created = await api.createStandaloneTask(input);
      // Việc vừa giao nằm ở ngăn "Tôi giao".
      if (scope !== 'assigned_by_me') setScope('assigned_by_me');
      else void reloadList();
      onFocusChange(created.task.id);
    }
    setFormOpen(false);
  };

  return (
    <div className={styles.taskSplit}>
      <section className={styles.taskListPane} aria-label="Danh sách công việc ngoài dự án">
        <div className={styles.taskListHead}>
          <div className={styles.segmented} role="tablist" aria-label="Nhóm công việc">
            {STANDALONE_TASK_SCOPES.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                className={scope === value ? styles.segmentActive : styles.segment}
                onClick={() => setScope(value)}
              >
                {STANDALONE_TASK_SCOPE_LABELS[value]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Tải lại"
            title="Tải lại"
            onClick={() => void reloadList()}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className={styles.taskListFilters}>
          <label className={styles.taskSearch}>
            <Search size={14} aria-hidden />
            <input
              value={search}
              placeholder="Tìm theo mã hoặc tên"
              aria-label="Tìm công việc"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Choice
            label="Trạng thái"
            value={statusFilter}
            emptyOption="Mọi trạng thái"
            options={STATUS_FILTERS}
            onChange={setStatusFilter}
          />
        </div>

        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}

        <ul className={styles.taskList}>
          {visible.map(({ task, parent }) => (
            <TaskRow
              key={task.id}
              task={task}
              parent={parent}
              scope={scope}
              directory={directory}
              active={task.id === focusTaskId}
              onSelect={() => onFocusChange(task.id)}
            />
          ))}
        </ul>
        {!loading && visible.length === 0 ? (
          <p className={styles.emptyRow}>
            {items.length === 0 ? emptyText(scope) : 'Không có việc nào khớp bộ lọc.'}
          </p>
        ) : null}
        {loading && items.length === 0 ? <p className={styles.emptyRow}>Đang tải…</p> : null}
      </section>

      <section className={styles.taskDetailPane} aria-label="Chi tiết công việc">
        {detail ? (
          <TaskDetail
            detail={detail}
            directory={directory}
            onChanged={applyDetail}
            onEdit={() => {
              setEditing(detail.task);
              setChildParent(undefined);
              setAdjustmentOf(undefined);
              setFormOpen(true);
            }}
            onReverse={() => setReverseTarget(detail.task)}
            onCreateAdjustment={() => {
              setEditing(undefined);
              setChildParent(undefined);
              setAdjustmentOf(detail.task);
              setFormOpen(true);
            }}
            onAddChild={() => {
              setEditing(undefined);
              setAdjustmentOf(undefined);
              setChildParent({
                id: detail.task.id,
                code: detail.task.code,
                title: detail.task.title,
              });
              setFormOpen(true);
            }}
            onOpenTask={(taskId) => onFocusChange(taskId)}
            onDeleted={() => {
              setDetail(undefined);
              // Xoá việc con thì quay về việc cha; xoá việc gốc thì đóng cột phải.
              onFocusChange(detail.task.parentId);
              void reloadList();
            }}
            onShowHistory={() => setHistoryOpen(true)}
          />
        ) : detailError ? (
          <p role="alert" className={styles.alert}>
            {detailError}
          </p>
        ) : (
          <div className={styles.emptyState}>
            <p>Chọn một công việc bên trái để xem chi tiết.</p>
          </div>
        )}
      </section>

      {detail && historyOpen ? (
        <HistoryDrawer detail={detail} directory={directory} onClose={() => setHistoryOpen(false)} />
      ) : null}

      <ReverseStandaloneTaskDialog
        task={reverseTarget}
        onClose={() => setReverseTarget(undefined)}
        onConfirm={async (task, reason, createAdjustment) => {
          const reversed = await api.reverseStandaloneTask(task.id, { reason, createAdjustment });
          setReverseTarget(undefined);
          applyDetail(reversed);
          if (createAdjustment) {
            setEditing(undefined);
            setChildParent(undefined);
            setAdjustmentOf(reversed.task);
            setFormOpen(true);
          }
        }}
      />

      <StandaloneTaskForm
        open={formOpen}
        task={editing}
        parent={childParent}
        adjustmentOf={adjustmentOf}
        onClose={() => setFormOpen(false)}
        onSubmit={submitForm}
      />
    </div>
  );
}

function scopeOfRole(role: StandaloneTaskRole): StandaloneTaskScope {
  if (role === 'assigner') return 'assigned_by_me';
  if (role === 'follower') return 'following';
  return 'assigned_to_me';
}

function emptyText(scope: StandaloneTaskScope): string {
  if (scope === 'assigned_by_me') return 'Bạn chưa giao việc nào. Bấm "Giao việc" để bắt đầu.';
  if (scope === 'following') return 'Bạn chưa theo dõi việc nào.';
  return 'Chưa ai giao việc ngoài dự án cho bạn.';
}

/** Bỏ dấu để gõ "bao gia" vẫn ra "Báo giá". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function isOverdue(task: StandaloneTask): boolean {
  if (!task.dueDate || CLOSED.includes(task.status)) return false;
  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return task.dueDate < key;
}

function StatusPill({ task }: { task: Pick<StandaloneTask, 'status' | 'reversal'> }) {
  const tone = standaloneTaskStatusTone(task);
  return (
    <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
      {standaloneTaskStatusLabel(task)}
    </span>
  );
}

function TaskRow({
  task,
  parent,
  scope,
  directory,
  active,
  onSelect,
}: {
  task: StandaloneTask;
  parent?: StandaloneTaskRef;
  scope: StandaloneTaskScope;
  directory: DirectoryView;
  active: boolean;
  onSelect: () => void;
}) {
  const priority = PRIORITY_TONE[task.priority];
  // "Tôi giao" cần biết ai đang làm; hai ngăn còn lại cần biết ai giao.
  const person =
    scope === 'assigned_by_me'
      ? `Phụ trách: ${directory.nameOf(task.assigneeUserId)}`
      : `Người giao: ${directory.nameOf(task.createdBy)}`;
  return (
    <li>
      <button
        type="button"
        className={active ? `${styles.taskRow} ${styles.taskRowActive}` : styles.taskRow}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className={styles.taskRowTitle}>
          <span className={styles.treeCode}>{task.code}</span>
          {task.title}
        </span>
        <span className={styles.taskRowMeta}>
          <StatusPill task={task} />
          <span className={styles.pill} style={{ background: priority.bg, color: priority.fg }}>
            {PRIORITY_LABELS[task.priority]}
          </span>
          {task.dueDate ? (
            <span className={isOverdue(task) ? styles.textDanger : styles.muted}>
              Hạn {formatDate(task.dueDate)}
            </span>
          ) : null}
          {task.executionType === 'procedure' ? (
            <span className={styles.muted} title="Theo quy trình">
              <Workflow size={12} aria-hidden /> Quy trình
            </span>
          ) : null}
          {task.childCount > 0 ? (
            <span className={styles.muted} title="Việc con đã xong / tổng số">
              <GitBranch size={12} aria-hidden /> {task.childCount - task.openChildCount}/
              {task.childCount}
            </span>
          ) : null}
        </span>
        <span className={styles.taskRowPerson}>
          {parent ? `Thuộc ${parent.code} · ` : ''}
          {person}
        </span>
      </button>
    </li>
  );
}

/** Nhãn nút cho một bước chuyển, theo ngữ cảnh thay vì "Chuyển sang …" chung chung. */
function transitionLabel(from: WorkItemStatus, to: WorkItemStatus, isAssigner: boolean): string {
  if (to === 'done') return isAssigner && from === 'review' ? 'Duyệt hoàn thành' : 'Hoàn thành';
  if (to === 'review') return 'Gửi duyệt';
  if (to === 'blocked') return 'Báo vướng mắc';
  if (to === 'cancelled') return 'Huỷ việc';
  if (to === 'in_progress') {
    if (from === 'todo') return 'Bắt đầu làm';
    if (from === 'review') return isAssigner ? 'Trả lại' : 'Rút lại';
    if (from === 'done') return 'Mở lại';
    return 'Tiếp tục làm';
  }
  return from === 'cancelled' ? 'Mở lại' : 'Về Chưa làm';
}

function TaskDetail({
  detail,
  directory,
  onChanged,
  onEdit,
  onReverse,
  onCreateAdjustment,
  onAddChild,
  onOpenTask,
  onDeleted,
  onShowHistory,
}: {
  detail: StandaloneTaskDetail;
  directory: DirectoryView;
  onChanged: (next: StandaloneTaskDetail) => void;
  onEdit: () => void;
  onReverse: () => void;
  onCreateAdjustment: () => void;
  onAddChild: () => void;
  onOpenTask: (taskId: string) => void;
  onDeleted: () => void;
  onShowHistory: () => void;
}) {
  const {
    task,
    myRole,
    allowedStatuses,
    history,
    ancestors,
    children,
    canAddChild,
    canReverse,
    canCreateAdjustment,
    adjustmentOf,
    adjustments,
  } = detail;
  const isAssigner = myRole === 'assigner';
  const isExecutor = myRole === 'assignee' || myRole === 'participant';
  const open = !CLOSED.includes(task.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState(String(task.progressPercent));

  useEffect(() => {
    setProgress(String(task.progressPercent));
    setError(undefined);
  }, [task.id, task.progressPercent]);

  const run = async (operation: () => Promise<StandaloneTaskDetail | void>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await operation();
      if (next) onChanged(next);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không thực hiện được thao tác.');
    } finally {
      setBusy(false);
    }
  };

  const move = (status: WorkItemStatus, note?: string) =>
    run(() => api.changeStandaloneTaskStatus(task.id, { status, note }));

  /** Lần trả lại gần nhất, để người thực hiện thấy ngay cần sửa gì. */
  const lastReturn =
    task.status === 'in_progress'
      ? history.find((entry) => entry.fromStatus === 'review' && entry.toStatus === 'in_progress')
      : undefined;
  const lastReturnIsLatest = lastReturn && history[0]?.id === lastReturn.id;
  /** Việc vào Chờ duyệt do hồ sơ quy trình hoàn tất, không phải người thực hiện gửi. */
  const byProcedure =
    task.status === 'review' &&
    history[0]?.toStatus === 'review' &&
    history[0]?.createdBy === STANDALONE_TASK_SYSTEM_ACTOR_ID;

  return (
    <div className={styles.taskDetail}>
      {ancestors.length > 0 ? (
        <nav className={styles.taskBreadcrumb} aria-label="Việc cha">
          {ancestors.map((ancestor) => (
            <span key={ancestor.id}>
              <button type="button" className={styles.linkButton} onClick={() => onOpenTask(ancestor.id)}>
                {ancestor.code} · {ancestor.title}
              </button>
              <ChevronRight size={13} aria-hidden />
            </span>
          ))}
        </nav>
      ) : null}
      <header className={styles.documentHead}>
        <div className={styles.documentHeadText}>
          <h3>
            <span className={styles.treeCode}>{task.code}</span>
            {task.title}
          </h3>
          <p className={styles.muted}>
            Vai của bạn: {STANDALONE_TASK_ROLE_LABELS[myRole]}
            {task.parentId ? ' · Việc con: người thực hiện tự hoàn thành, không cần duyệt' : ''}
          </p>
        </div>
        <div className={styles.documentActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Nhật ký"
            title="Nhật ký"
            onClick={onShowHistory}
          >
            <History size={15} />
          </button>
          {isAssigner ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Sửa"
              title="Sửa"
              onClick={onEdit}
            >
              <Pencil size={15} />
            </button>
          ) : null}
          {isAssigner && !task.reversal && (task.status === 'todo' || task.status === 'cancelled') ? (
            <Popconfirm
              title="Xoá công việc?"
              description={
                task.childCount > 0
                  ? `Công việc cùng ${task.childCount} việc con và nhật ký bị xoá hẳn, không hoàn tác được.`
                  : 'Công việc và nhật ký bị xoá hẳn, không hoàn tác được.'
              }
              okText="Xoá"
              okType="danger"
              placement="bottom-end"
              onConfirm={() =>
                run(async () => {
                  await api.deleteStandaloneTask(task.id);
                  onDeleted();
                })
              }
            >
              <button type="button" className={styles.iconButton} aria-label="Xoá" title="Xoá">
                <Trash2 size={15} />
              </button>
            </Popconfirm>
          ) : null}
        </div>
      </header>

      <div className={styles.taskStatusBar}>
        <StatusPill task={task} />
        {allowedStatuses.map((next) => {
          const label = transitionLabel(task.status, next, isAssigner);
          const returning = isAssigner && task.status === 'review' && next === 'in_progress';
          if (returning || next === 'cancelled') {
            return (
              <Popconfirm
                key={next}
                title={returning ? 'Trả lại công việc?' : 'Huỷ công việc?'}
                description={
                  returning
                    ? 'Công việc quay về Đang làm; người thực hiện nhận thông báo kèm lý do.'
                    : 'Công việc chuyển sang Đã huỷ; mở lại được sau.'
                }
                okText={returning ? 'Trả lại' : 'Huỷ việc'}
                cancelText="Đóng"
                okType={returning ? 'warning' : 'danger'}
                reasonRequired
                reasonLabel={returning ? 'Lý do trả lại' : 'Lý do huỷ'}
                reasonPlaceholder="Ghi rõ để người thực hiện hiểu"
                onConfirm={(reason) => move(next, reason)}
              >
                <button
                  type="button"
                  className={next === 'cancelled' ? styles.buttonDanger : styles.buttonGhost}
                  disabled={busy}
                >
                  {label}
                </button>
              </Popconfirm>
            );
          }
          const primary = next === 'done' || next === 'review';
          return (
            <button
              key={next}
              type="button"
              className={primary ? styles.buttonPrimary : styles.buttonGhost}
              disabled={busy}
              onClick={() => void move(next)}
            >
              {label}
            </button>
          );
        })}
        {canReverse ? (
          <button type="button" className={styles.buttonDanger} disabled={busy} onClick={onReverse}>
            Huỷ hiệu lực
          </button>
        ) : null}
      </div>

      {task.reversal ? (
        <div className={styles.alert}>
          Đã huỷ hiệu lực lúc {formatDateTime(task.reversal.reversedAt)} bởi{' '}
          {task.reversal.reversedByName ?? directory.nameOf(task.reversal.reversedBy)}:{' '}
          {task.reversal.reason}
          {adjustments.length > 0 ? (
            <>
              {' · Công việc điều chỉnh: '}
              {adjustments.map((adjustment, index) => (
                <span key={adjustment.id}>
                  {index > 0 ? ', ' : ''}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onOpenTask(adjustment.id)}
                  >
                    {adjustment.code}
                  </button>
                  {adjustment.status === 'cancelled' ? ' (đã huỷ)' : ''}
                </span>
              ))}
            </>
          ) : task.reversal.adjustmentRequested ? (
            ' · Cần lập công việc điều chỉnh.'
          ) : null}
          {canCreateAdjustment ? (
            <>
              {' '}
              <button type="button" className={styles.buttonSmall} onClick={onCreateAdjustment}>
                <Plus size={13} /> Lập công việc điều chỉnh
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {adjustmentOf ? (
        <p className={styles.notice}>
          Công việc điều chỉnh cho{' '}
          <button type="button" className={styles.linkButton} onClick={() => onOpenTask(adjustmentOf.id)}>
            {adjustmentOf.code} · {adjustmentOf.title}
          </button>{' '}
          (đã huỷ hiệu lực).
        </p>
      ) : null}

      {task.status === 'review' && isExecutor ? (
        <p className={styles.notice}>
          {byProcedure ? 'Hồ sơ quy trình đã hoàn tất. ' : ''}Đang chờ{' '}
          {directory.nameOf(task.createdBy)} duyệt. Bạn có thể rút lại để làm tiếp.
        </p>
      ) : null}
      {task.status === 'review' && isAssigner && (byProcedure || task.assigneeUserId !== task.createdBy) ? (
        <p className={styles.notice}>
          {byProcedure
            ? `Hồ sơ quy trình ${task.procedure?.instanceCode ?? ''} đã hoàn tất nên công việc tự chuyển sang Chờ duyệt.`
            : `${directory.nameOf(task.assigneeUserId)} đã gửi kết quả.`}{' '}
          Hãy duyệt hoàn thành hoặc trả lại kèm lý do.
        </p>
      ) : null}
      {task.openChildCount > 0 && open ? (
        <p className={styles.notice}>
          Còn {task.openChildCount} việc con chưa xong. Công việc chỉ{' '}
          {task.parentId ? 'hoàn thành' : 'gửi duyệt'} được khi mọi việc con đã xong hoặc đã huỷ.
        </p>
      ) : null}
      {lastReturn && lastReturnIsLatest && lastReturn.note ? (
        <p className={styles.alert}>
          Bị trả lại ({formatDateTime(lastReturn.createdAt)}): {lastReturn.note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <dl className={styles.definitionList}>
        <dt>Người giao</dt>
        <dd>{directory.nameOf(task.createdBy)}</dd>
        <dt>Người phụ trách</dt>
        <dd>{directory.nameOf(task.assigneeUserId)}</dd>
        <dt>Người cùng thực hiện</dt>
        <dd>{namesOf(task.participantUserIds, directory)}</dd>
        <dt>Người theo dõi</dt>
        <dd>{namesOf(task.followerUserIds, directory)}</dd>
        <dt>Mức ưu tiên</dt>
        <dd>{PRIORITY_LABELS[task.priority]}</dd>
        <dt>Ngày bắt đầu</dt>
        <dd>{formatDate(task.plannedStart) || '—'}</dd>
        <dt>Hạn hoàn thành</dt>
        <dd className={isOverdue(task) ? styles.textDanger : undefined}>
          {formatDate(task.dueDate) || '—'}
        </dd>
        <dt>Thực tế</dt>
        <dd>
          {task.actualStart ? formatDate(task.actualStart) : '—'}
          {task.actualEnd ? ` → ${formatDate(task.actualEnd)}` : ''}
        </dd>
        <dt>Tiến độ</dt>
        <dd>
          <span className={styles.progressCell}>
            <span className={styles.progressTrack}>
              <span className={styles.progressFill} style={{ width: `${task.progressPercent}%` }} />
            </span>
            {task.progressPercent}%
          </span>
        </dd>
        <dt>Giao lúc</dt>
        <dd>{formatDateTime(task.createdAt)}</dd>
      </dl>

      {task.executionType === 'procedure' && task.procedure ? (
        <ProcedurePanel procedure={task.procedure} isChild={Boolean(task.parentId)} />
      ) : null}

      {task.childCount > 0 ? (
        <p className={styles.muted}>Tiến độ tự tính từ trung bình các việc con chưa huỷ.</p>
      ) : open && (isAssigner || isExecutor) ? (
        <form
          className={styles.taskProgressForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              api.updateStandaloneTask(task.id, { progressPercent: Number(progress) }),
            );
          }}
        >
          <label htmlFor={`progress-${task.id}`}>Cập nhật tiến độ (%)</label>
          <input
            id={`progress-${task.id}`}
            type="number"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(event) => setProgress(event.target.value)}
          />
          <button
            type="submit"
            className={styles.buttonSmall}
            disabled={busy || progress === String(task.progressPercent) || progress === ''}
          >
            Lưu
          </button>
        </form>
      ) : null}

      {task.description ? (
        <p className={styles.description}>{task.description}</p>
      ) : (
        <p className={`${styles.description} ${styles.muted}`}>Không có mô tả.</p>
      )}

      <section className={styles.taskChildren} aria-label="Việc con">
        <div className={styles.panelHeadRow}>
          <h4>
            <GitBranch size={14} aria-hidden /> Việc con
            {task.childCount > 0 ? (
              <span className={styles.countPill}>
                {task.childCount - task.openChildCount}/{task.childCount}
              </span>
            ) : null}
          </h4>
          {canAddChild ? (
            <button type="button" className={styles.buttonSmall} onClick={onAddChild}>
              <Plus size={13} /> Thêm việc con
            </button>
          ) : null}
        </div>
        {children.length === 0 ? (
          <p className={styles.muted}>
            {canAddChild
              ? 'Chưa có việc con. Chia nhỏ công việc và giao cho người khác bằng "Thêm việc con".'
              : 'Chưa có việc con.'}
          </p>
        ) : (
          <ul className={styles.taskChildList}>
            {children.map((child) => (
              <li key={child.id}>
                <button type="button" className={styles.cellTitleButton} onClick={() => onOpenTask(child.id)}>
                  <span className={styles.treeCode}>{child.code}</span>
                  {child.title}
                </button>
                <span className={styles.taskChildMeta}>
                  <StatusPill task={child} />
                  <span className={styles.muted}>{directory.nameOf(child.assigneeUserId)}</span>
                  <span className={styles.muted}>{child.progressPercent}%</span>
                  {child.dueDate ? (
                    <span className={isOverdue(child) ? styles.textDanger : styles.muted}>
                      Hạn {formatDate(child.dueDate)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Hồ sơ quy trình gắn với việc: trạng thái, mã hồ sơ và đường mở sang module Quy trình. */
function ProcedurePanel({
  procedure,
  isChild,
}: {
  procedure: NonNullable<StandaloneTask['procedure']>;
  isChild: boolean;
}) {
  const failed =
    procedure.status === 'start_rejected' ||
    procedure.status === 'rejected' ||
    procedure.status === 'cancelled';
  return (
    <div className={failed ? styles.alert : styles.notice}>
      <Workflow size={14} aria-hidden /> <b>{STANDALONE_TASK_PROCEDURE_STATUS_LABELS[procedure.status]}</b>
      {procedure.instanceCode ? <> · Hồ sơ {procedure.instanceCode}</> : null}
      {procedure.status === 'pending' ? ' · Module Quy trình đang mở hồ sơ, vui lòng chờ.' : null}
      {procedure.status === 'started'
        ? isChild
          ? ' · Hồ sơ hoàn tất thì việc con tự Hoàn thành.'
          : ' · Hồ sơ hoàn tất thì công việc tự chuyển sang Chờ duyệt.'
        : null}
      {procedure.error ? ` · ${procedure.error}` : null}
      {failed ? ' · Có thể xử lý công việc bằng tay.' : null}
      {procedure.instanceId ? (
        <>
          {' '}
          <a href={PROCEDURE_LAUNCH_URL} target="_blank" rel="noopener noreferrer">
            Xem hồ sơ <ExternalLink size={12} aria-hidden />
          </a>
        </>
      ) : null}
    </div>
  );
}

function namesOf(userIds: readonly string[], directory: DirectoryView): string {
  return userIds.length ? userIds.map((userId) => directory.nameOf(userId)).join(', ') : '—';
}

/** Nhật ký đổi trạng thái, mở trong ngăn kéo bên phải. */
function HistoryDrawer({
  detail,
  directory,
  onClose,
}: {
  detail: StandaloneTaskDetail;
  directory: DirectoryView;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className={styles.drawer} role="complementary" aria-label="Nhật ký công việc">
      <header className={styles.drawerHead}>
        <div>
          <h3>Nhật ký</h3>
          <p>
            {detail.task.code} · {detail.task.title}
          </p>
        </div>
        <button type="button" aria-label="Đóng" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className={styles.drawerBody}>
        {detail.history.length === 0 ? (
          <p className={styles.muted}>Chưa có thay đổi nào.</p>
        ) : (
          <ul className={`${styles.memberList} ${styles.stackedList}`}>
            {detail.history.map((entry) => (
              <li key={entry.id}>
                <span className={styles.memberName}>
                  {entry.fromStatus
                    ? `${WORK_ITEM_STATUS_LABELS[entry.fromStatus]} → ${WORK_ITEM_STATUS_LABELS[entry.toStatus]}`
                    : 'Giao việc'}
                  {entry.note ? ` · ${entry.note}` : ''}
                </span>
                <span className={styles.memberRole}>
                  {entry.createdBy === STANDALONE_TASK_SYSTEM_ACTOR_ID
                    ? 'Hệ thống (theo hồ sơ quy trình)'
                    : directory.nameOf(entry.createdBy)}{' '}
                  · {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
