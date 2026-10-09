'use client';

import type { ProjectSummary, WorkItem } from '@enterprise-platform/contracts-workspace';
import { MessageSquare, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { ProcedureOption } from '../procedure-api';
import { branchOf } from '../project-tree.model';
import {
  ITEM_TYPE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONE,
  ROLE_LABELS,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
  isOverdue,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ProcedureActions, type ProcedureLink } from './procedure-actions';
import type { SelectedNode } from './project-tree';
import { useDirectory } from './use-directory';

export interface NodeHeaderProps {
  readonly project: ProjectSummary;
  readonly items: readonly WorkItem[];
  /** Rỗng nghĩa là đang đứng ở chính dự án. */
  readonly selected?: WorkItem;
  readonly onSelect: (node: SelectedNode) => void;
  readonly canEdit: boolean;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
  readonly onAddChild: () => void;
  /** Số tin chưa đọc của node đang đứng, đã cộng dồn nhánh con. */
  readonly unread: number;
  readonly onOpenChat: () => void;
  /**
   * Nút "⋯" cạnh Trao đổi: mở menu đủ lệnh của node, cùng menu với chuột phải
   * trên cây. Dòng dự án nằm ở thanh bên nên đây là chỗ mở menu của dự án.
   */
  readonly onMore?: (anchor: { x: number; y: number }) => void;
  readonly startableProcedures: readonly ProcedureOption[];
  readonly procedureLink?: ProcedureLink;
  /** Vắng khi đang đứng ở dự án: chỉ công việc mới gắn được hồ sơ quy trình. */
  readonly onStartProcedure?: (definitionId: string) => Promise<void>;
}

/**
 * Khối đầu của node đang chọn, nằm trên hàng tab.
 *
 * Gom một lần những gì trước đây lặp lại hai, ba chỗ trong tab Tổng quan:
 * trạng thái, độ ưu tiên, người phụ trách, thời gian và tiến độ. Khối luôn
 * hiện, nên đổi sang tab nào cũng vẫn biết mình đang đứng ở node nào.
 */
export function NodeHeader({
  project,
  items,
  selected,
  onSelect,
  canEdit,
  canWrite,
  onEdit,
  onAddChild,
  unread,
  onOpenChat,
  onMore,
  startableProcedures,
  procedureLink,
  onStartProcedure,
}: NodeHeaderProps) {
  const directory = useDirectory();

  // Số liệu tính trên NHÁNH, không phải trên con trực tiếp, và đếm việc LÁ —
  // cùng cơ sở với phần trăm tiến độ có trọng số theo giờ.
  const branch = selected ? branchOf(items, selected.id) : undefined;
  const scope = branch
    ? items.filter((item) => branch.has(item.id) && item.id !== selected?.id)
    : items;
  const parentIds = new Set(scope.map((item) => item.parentId).filter(Boolean));
  const leaves = scope.filter((item) => !parentIds.has(item.id) && item.status !== 'cancelled');
  const done = leaves.filter((item) => item.status === 'done').length;
  const overdue = scope.filter(isOverdue).length;
  const percent = selected?.progressPercent ?? project.progressPercent;

  const statusTone = selected
    ? WORK_ITEM_STATUS_TONE[selected.status]
    : PROJECT_STATUS_TONE[project.status];
  const statusLabel = selected
    ? WORK_ITEM_STATUS_LABELS[selected.status]
    : PROJECT_STATUS_LABELS[project.status];
  const start = selected ? selected.plannedStart : project.startDate;
  const end = selected ? selected.plannedEnd : project.endDate;

  return (
    <section className={styles.nodeHeader}>
      {selected ? (
        <nav className={styles.nodePath} aria-label="Đường dẫn node">
          {pathOf(project, items, selected).map((crumb, index, all) =>
            index < all.length - 1 ? (
              <span key={crumb.key} className={styles.nodePathItem}>
                <button
                  type="button"
                  className={styles.crumbLink}
                  onClick={() => onSelect(crumb.node)}
                >
                  {crumb.label}
                </button>
                <span className={styles.crumbSep} aria-hidden>
                  ›
                </span>
              </span>
            ) : null,
          )}
        </nav>
      ) : null}

      <div className={styles.nodeHead}>
        <span className={styles.nodeKind}>
          {selected ? ITEM_TYPE_LABELS[selected.itemType] : 'Dự án'}
        </span>
        <h2 className={styles.nodeTitle}>
          <span className={styles.nodeCode}>{selected ? selected.code : project.code}</span>
          {selected ? selected.title : project.name}
        </h2>
        <span className={styles.pill} style={{ background: statusTone.bg, color: statusTone.fg }}>
          {statusLabel}
        </span>
        {selected ? (
          <span
            className={styles.pill}
            style={{
              background: PRIORITY_TONE[selected.priority].bg,
              color: PRIORITY_TONE[selected.priority].fg,
            }}
          >
            {PRIORITY_LABELS[selected.priority]}
          </span>
        ) : null}

        <div className={styles.nodeActions}>
          <button
            type="button"
            className={styles.buttonGhost}
            aria-label={unread > 0 ? `Trao đổi, ${unread} tin chưa đọc` : 'Trao đổi'}
            onClick={onOpenChat}
          >
            <MessageSquare size={14} /> Trao đổi
            {unread > 0 ? <span className={styles.countBadge}>{unread}</span> : null}
          </button>
          {onMore ? (
            <button
              type="button"
              className={styles.buttonGhost}
              aria-label="Thêm thao tác"
              title="Thêm thao tác"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                onMore({ x: box.left, y: box.bottom + 4 });
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          ) : null}
          <button type="button" className={styles.buttonGhost} disabled={!canEdit} onClick={onEdit}>
            <Pencil size={14} /> Chỉnh sửa
          </button>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={!canWrite}
            onClick={onAddChild}
          >
            <Plus size={14} /> Thêm công việc con
          </button>
        </div>
      </div>

      <div className={styles.nodeMeta}>
        <span>
          {selected ? 'Phụ trách' : 'Vai trò của tôi'}{' '}
          <b>
            {selected
              ? selected.assigneeUserId
                ? directory.nameOf(selected.assigneeUserId)
                : 'Chưa giao'
              : project.myRole
                ? ROLE_LABELS[project.myRole]
                : 'Quản trị viên tenant'}
          </b>
        </span>
        <span>
          Kế hoạch <b>{dateRange(start, end)}</b>
        </span>
        <span>
          {leaves.length > 0 ? (
            <>
              <b>
                {done}/{leaves.length}
              </b>{' '}
              việc đã xong
            </>
          ) : (
            'Chưa có việc con'
          )}
          {overdue > 0 ? <span className={styles.textDanger}> · {overdue} quá hạn</span> : null}
        </span>
        <span className={styles.nodeProgress}>
          <span className={styles.progressTrack} aria-label={`Tiến độ ${percent}%`}>
            <span className={styles.progressFill} style={{ width: `${percent}%` }} />
          </span>
          <b>{percent}%</b>
        </span>
      </div>

      {selected && onStartProcedure ? (
        <div className={styles.nodeProcedure}>
          <ProcedureActions
            options={startableProcedures}
            link={procedureLink}
            canWrite={canWrite}
            onStart={onStartProcedure}
          />
          {procedureLink ? (
            <span className={styles.muted}>
              Tiến độ lấy từ hồ sơ {procedureLink.code}
              {procedureLink.totalSteps
                ? ` · ${procedureLink.doneSteps}/${procedureLink.totalSteps} bước đã xong`
                : ''}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function dateRange(start?: string | null, end?: string | null): string {
  const from = formatDate(start);
  const to = formatDate(end);
  if (!from && !to) return '—';
  return `${from || '…'} → ${to || '…'}`;
}

/** Dự án và các cấp cha của node đang chọn; cấp cuối là chính node đó. */
function pathOf(
  project: ProjectSummary,
  items: readonly WorkItem[],
  selected?: WorkItem,
): { key: string; label: string; node: SelectedNode }[] {
  const crumbs = [
    {
      key: project.id,
      label: project.code,
      node: { kind: 'project' } as SelectedNode,
    },
  ];
  if (!selected) return crumbs;
  const byId = new Map(items.map((item) => [item.id, item]));
  const chain: { key: string; label: string; node: SelectedNode }[] = [];
  let cursor: WorkItem | undefined = selected;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift({
      key: cursor.id,
      label: `${cursor.code} · ${cursor.title}`,
      node: { kind: 'work-item', id: cursor.id },
    });
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return [...crumbs, ...chain];
}
