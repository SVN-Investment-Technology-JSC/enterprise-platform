'use client';

import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  type ExternalReference,
  type WorkItem,
  type WorkItemDependency,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { ChevronDown, ChevronRight, CornerDownRight, Diamond, Plus, Workflow } from 'lucide-react';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { buildWorkItemTree } from '../project-tree.model';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatShortDate,
  isOverdue,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { GanttChart } from './gantt-chart';
import { initials } from './project-header';
import { TabKanban } from './tab-kanban';
import { useDirectory } from './use-directory';

/** Ba cách xem cùng một danh sách công việc. */
type WorkView = 'table' | 'kanban' | 'gantt';

const WORK_VIEWS: readonly { id: WorkView; label: string }[] = [
  { id: 'table', label: 'Bảng' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'gantt', label: 'Gantt' },
];

type DueFilter = 'all' | 'overdue' | 'week' | 'month';

const DUE_OPTIONS: readonly { value: DueFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'week', label: 'Trong 7 ngày tới' },
  { value: 'month', label: 'Trong tháng này' },
];

/** Thụt mỗi cấp trong cột Công việc của bảng WBS. */
const INDENT_REM = 1.25;

export interface TabWorkProps {
  readonly items: readonly WorkItem[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly externalRefs: readonly ExternalReference[];
  /** Việc chạy theo quy trình mà chưa mở được hồ sơ bên Quy trình. */
  readonly pendingProcedure: ReadonlySet<string>;
  /** Tin chưa đọc theo công việc, đã cộng dồn nhánh con. */
  readonly unread?: Readonly<Record<string, number>>;
  readonly canWrite: boolean;
  readonly currentUserId: string;
  readonly onOpen: (item: WorkItem) => void;
  /** Thêm công việc cấp gốc (nút "Thêm công việc" và "Thêm nhóm công việc"). */
  readonly onAddRoot: () => void;
  /** Chuột phải trên một dòng: cùng menu lệnh với cây công việc trước đây. */
  readonly onMenu: (item: WorkItem, at: { x: number; y: number }) => void;
  readonly onChangeStatus: (item: WorkItem, next: WorkItemStatus) => Promise<void>;
}

/**
 * Tab Công việc của dự án: thanh công cụ (kiểu xem, bộ lọc, nút thêm) và bảng
 * WBS dạng cây — nhóm công việc bung ra các việc con, thụt theo cấp.
 *
 * Cây công việc trước đây nằm ở cột trái; giờ chính bảng này là cây, nên
 * vùng chính không phải chia cột. Bấm một dòng để mở chi tiết công việc.
 */
export function TabWork({
  items,
  dependencies,
  externalRefs,
  pendingProcedure,
  unread = {},
  canWrite,
  currentUserId,
  onOpen,
  onAddRoot,
  onMenu,
  onChangeStatus,
}: TabWorkProps) {
  const directory = useDirectory();
  const [view, setView] = useState<WorkView>('table');
  const [showChildren, setShowChildren] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<'all' | WorkItemStatus>('all');
  const [priority, setPriority] = useState<'all' | WorkItemPriority>('all');
  const [assignee, setAssignee] = useState('all');
  const [due, setDue] = useState<DueFilter>('all');

  const filtering = status !== 'all' || priority !== 'all' || assignee !== 'all' || due !== 'all';

  /** Việc khớp bộ lọc; bảng giữ thêm tổ tiên của chúng để còn thấy chúng thuộc nhánh nào. */
  const matched = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    return items.filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (priority !== 'all' && item.priority !== priority) return false;
      if (assignee === 'me' && item.assigneeUserId !== currentUserId) return false;
      if (assignee === 'none' && item.assigneeUserId) return false;
      if (!['all', 'me', 'none'].includes(assignee) && item.assigneeUserId !== assignee) {
        return false;
      }
      const end = item.plannedEnd?.slice(0, 10);
      if (due === 'overdue' && !isOverdue(item)) return false;
      if (due === 'week' && !(end && end >= today && end <= weekEnd)) return false;
      if (due === 'month' && !(end && end.startsWith(month))) return false;
      return true;
    });
  }, [items, status, priority, assignee, due, currentUserId]);

  const rows = useMemo(() => {
    // Tắt "Hiện việc con" thì chỉ còn các nhóm cấp gốc.
    const hidden = showChildren ? collapsed : new Set(items.map((item) => item.id));
    return buildWorkItemTree(items, new Set(matched.map((item) => item.id)), hidden);
  }, [items, matched, collapsed, showChildren]);

  const ganttRows = useMemo(
    () =>
      buildWorkItemTree(items, new Set(matched.map((item) => item.id))).map((row) => ({
        item: row.item,
        depth: row.depth,
      })),
    [items, matched],
  );

  const assigneeOptions = useMemo(() => {
    const ids = [...new Set(items.map((item) => item.assigneeUserId).filter(Boolean))] as string[];
    return [
      { value: 'all', label: 'Tất cả' },
      { value: 'me', label: 'Của tôi' },
      { value: 'none', label: 'Chưa giao' },
      ...ids
        .map((id) => ({ value: id, label: directory.nameOf(id) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    ];
  }, [items, directory]);

  /** Hồ sơ quy trình đã mở của từng công việc. */
  const procedureOf = useMemo(() => {
    const map = new Map<string, ExternalReference>();
    for (const ref of externalRefs) {
      if (ref.moduleKey === 'procedure-engine' && ref.entityType === 'work_item') {
        map.set(ref.entityId, ref);
      }
    }
    return map;
  }, [externalRefs]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openMenu = (event: MouseEvent, item: WorkItem) => {
    event.preventDefault();
    onMenu(item, { x: event.clientX, y: event.clientY });
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.panel}>
        <div className={styles.workToolbar}>
          <div className={styles.segmented} role="group" aria-label="Kiểu xem công việc">
            {WORK_VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={view === entry.id}
                className={view === entry.id ? styles.segmentActive : styles.segment}
                onClick={() => setView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {view === 'table' ? (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={showChildren}
                onChange={(event) => setShowChildren(event.target.checked)}
              />
              Hiện việc con
            </label>
          ) : null}
          <button
            type="button"
            className={`${styles.buttonPrimary} ${styles.workToolbarAdd}`}
            disabled={!canWrite}
            onClick={onAddRoot}
          >
            <Plus size={15} /> Thêm công việc
          </button>
        </div>

        <div className={styles.workFilters}>
          <FilterField label="Trạng thái">
            <Choice
              label="Lọc theo trạng thái"
              value={status}
              options={[
                { value: 'all', label: 'Tất cả' },
                ...WORK_ITEM_STATUSES.map((value) => ({
                  value,
                  label: WORK_ITEM_STATUS_LABELS[value],
                })),
              ]}
              onChange={(value) => setStatus(value as 'all' | WorkItemStatus)}
            />
          </FilterField>
          <FilterField label="Ưu tiên">
            <Choice
              label="Lọc theo ưu tiên"
              value={priority}
              options={[
                { value: 'all', label: 'Tất cả' },
                ...WORK_ITEM_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] })),
              ]}
              onChange={(value) => setPriority(value as 'all' | WorkItemPriority)}
            />
          </FilterField>
          <FilterField label="Phụ trách">
            <Choice
              label="Lọc theo người phụ trách"
              value={assignee}
              options={assigneeOptions}
              onChange={setAssignee}
            />
          </FilterField>
          <FilterField label="Thời hạn">
            <Choice
              label="Lọc theo thời hạn"
              value={due}
              options={DUE_OPTIONS}
              onChange={(value) => setDue(value as DueFilter)}
            />
          </FilterField>
          {filtering ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setStatus('all');
                setPriority('all');
                setAssignee('all');
                setDue('all');
              }}
            >
              Bỏ lọc
            </button>
          ) : null}
        </div>
      </div>

      {view === 'kanban' ? (
        <TabKanban
          items={matched}
          canWrite={canWrite}
          onOpen={onOpen}
          onChangeStatus={onChangeStatus}
        />
      ) : null}

      {view === 'gantt' ? (
        <GanttChart rows={ganttRows} dependencies={dependencies} onOpen={onOpen} />
      ) : null}

      {view === 'table' ? (
        <div className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.wbsTable}`}>
              <thead>
                <tr>
                  <th>Công việc</th>
                  <th>Phụ trách</th>
                  <th>Ưu tiên</th>
                  <th>Trạng thái</th>
                  <th>Bắt đầu</th>
                  <th>Thời hạn</th>
                  <th>Tiến độ</th>
                  <th>Quy trình</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.muted}>
                      {filtering
                        ? 'Không có công việc nào khớp bộ lọc.'
                        : 'Dự án chưa có công việc nào.'}
                    </td>
                  </tr>
                ) : null}
                {rows.map((row) => {
                  const { item } = row;
                  const tone = WORK_ITEM_STATUS_TONE[item.status];
                  const procedure = procedureOf.get(item.id);
                  const overdue = isOverdue(item);
                  return (
                    <tr
                      key={item.id}
                      className={row.hasChildren ? styles.wbsGroupRow : undefined}
                      onClick={() => onOpen(item)}
                      onContextMenu={(event) => openMenu(event, item)}
                    >
                      <td>
                        <span
                          className={styles.wbsName}
                          style={{ paddingLeft: `${row.depth * INDENT_REM}rem` }}
                        >
                          {row.hasChildren ? (
                            <button
                              type="button"
                              className={styles.treeToggle}
                              aria-label={row.expanded ? 'Thu gọn nhánh' : 'Mở nhánh'}
                              aria-expanded={row.expanded}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (showChildren) toggle(item.id);
                                else setShowChildren(true);
                              }}
                            >
                              {row.expanded ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                            </button>
                          ) : item.itemType === 'milestone' ? (
                            <Diamond size={14} className={styles.wbsMilestone} aria-hidden />
                          ) : row.depth > 0 ? (
                            <CornerDownRight size={14} className={styles.wbsBranch} aria-hidden />
                          ) : (
                            <span className={styles.treeToggleSpacer} aria-hidden />
                          )}
                          <button
                            type="button"
                            className={styles.wbsTitle}
                            title={`${item.code} · ${item.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(item);
                            }}
                          >
                            <span className={styles.treeCode}>{item.code}</span>
                            <span className={styles.treeTitle}>{item.title}</span>
                          </button>
                          {unread[item.id] ? (
                            <span
                              className={styles.treeUnread}
                              title={`${unread[item.id]} tin chưa đọc`}
                            >
                              {unread[item.id]}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td>
                        {item.assigneeUserId ? (
                          <span className={styles.wbsPerson}>
                            <span className={styles.avatarSmall}>
                              {initials(directory.nameOf(item.assigneeUserId))}
                            </span>
                            {directory.nameOf(item.assigneeUserId)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {row.hasChildren ? null : (
                          <span
                            className={styles.pill}
                            style={{
                              background: PRIORITY_TONE[item.priority].bg,
                              color: PRIORITY_TONE[item.priority].fg,
                            }}
                          >
                            {PRIORITY_LABELS[item.priority]}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={styles.pill}
                          style={{ background: tone.bg, color: tone.fg }}
                        >
                          {WORK_ITEM_STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td>{formatShortDate(item.plannedStart)}</td>
                      <td className={overdue ? styles.cellDanger : undefined}>
                        {formatShortDate(item.plannedEnd)}
                      </td>
                      <td>
                        <span className={styles.progressCell}>
                          <span
                            className={styles.progressTrack}
                            aria-label={`${item.progressPercent}%`}
                          >
                            <span
                              className={
                                item.progressPercent >= 100
                                  ? styles.progressFillDone
                                  : styles.progressFill
                              }
                              style={{ width: `${item.progressPercent}%` }}
                            />
                          </span>
                          {item.progressPercent}%
                        </span>
                      </td>
                      <td>
                        {procedure ? (
                          <a
                            className={styles.wbsProcedure}
                            href={procedure.launchUrl}
                            title={procedure.cachedStatus ?? undefined}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Workflow size={12} aria-hidden />
                            {procedure.cachedLabel ?? procedure.externalCode ?? 'Quy trình'}
                          </a>
                        ) : pendingProcedure.has(item.id) ? (
                          <span
                            className={styles.treePending}
                            title="Công việc đã tạo nhưng chưa mở được hồ sơ bên Quy trình. Bấm chuột phải để thử lại."
                          >
                            Chưa mở được quy trình
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canWrite ? (
            <button type="button" className={styles.wbsAddGroup} onClick={onAddRoot}>
              <Plus size={14} /> Thêm nhóm công việc
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      {children}
    </div>
  );
}
