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
  formatDate,
  isOverdue,
  workItemStatusLabel,
  workItemStatusTone,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { ProcedureActions, type ProcedureLink } from './procedure-actions';
import type { SelectedNode } from './project-tree';
import { useDirectory } from './use-directory';
import { tagColor, useTags } from './use-tags';

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
  const tags = useTags();
  const participants = selected?.participantUserIds ?? [];
  const selectedTags = (selected?.tagIds ?? []).flatMap((tagId) => tags.find(tagId) ?? []);

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
    ? workItemStatusTone(selected)
    : PROJECT_STATUS_TONE[project.status];
  const statusLabel = selected
    ? workItemStatusLabel(selected)
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

      {selected?.reversal ? (
        <div
          role="note"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            margin: '6px 0',
            padding: '8px 10px',
            border: '1px solid #fed7aa',
            borderRadius: 8,
            background: '#fff7ed',
            color: '#7c2d12',
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: '#9a3412' }}>Đã huỷ hiệu lực</strong>
          <span style={{ fontSize: 11.5, color: '#9a3412', opacity: 0.85 }}>
            {selected.reversal.reversedByName ?? 'Quản trị viên'} ·{' '}
            {new Date(selected.reversal.reversedAt).toLocaleString('vi-VN')}
          </span>
          <span>
            <b>Lý do:</b> {selected.reversal.reason}
          </span>
          {(() => {
            const adjustment = items.find(
              (item) => item.adjustmentOfId === selected.id && item.status !== 'cancelled',
            );
            if (adjustment)
              return (
                <span>
                  <b>Công việc điều chỉnh:</b>{' '}
                  <button
                    type="button"
                    className={styles.crumbLink}
                    onClick={() => onSelect({ kind: 'work-item', id: adjustment.id })}
                  >
                    {adjustment.code}
                  </button>
                </span>
              );
            return selected.reversal.adjustmentRequested ? (
              <span>
                <b>Điều chỉnh:</b> đang chờ lập công việc điều chỉnh.
              </span>
            ) : null;
          })()}
        </div>
      ) : null}
      {selected?.adjustmentOfId ? (
        <p style={{ margin: '6px 0', fontSize: 12.5, color: 'var(--muted, #64748b)' }}>
          Công việc điều chỉnh cho{' '}
          {(() => {
            const original = items.find((item) => item.id === selected.adjustmentOfId);
            return original ? (
              <button type="button" className={styles.crumbLink} onClick={() => onSelect({ kind: 'work-item', id: original.id })}>
                {original.code}
              </button>
            ) : (
              'một công việc'
            );
          })()}{' '}
          đã huỷ hiệu lực.
        </p>
      ) : null}

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
        {participants.length > 0 ? (
          <span>
            Cùng thực hiện{' '}
            <b>{participants.map((userId) => directory.nameOf(userId)).join(', ')}</b>
          </span>
        ) : null}
        <span>
          Kế hoạch <b>{dateRange(start, end)}</b>
        </span>
        {selectedTags.length > 0 ? (
          <span className={styles.wbsTags}>
            {selectedTags.map((tag) => (
              <span key={tag.id} className={styles.wbsTag} style={{ color: tagColor(tag) }}>
                {tag.name}
              </span>
            ))}
          </span>
        ) : null}
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
        {selected?.reversal ? (
          // Việc huỷ hiệu lực không còn tính tiến độ; hiện 100% sẽ gây hiểu nhầm.
          <span className={styles.muted}>Không tính vào tiến độ</span>
        ) : (
          <span className={styles.nodeProgress}>
            <span className={styles.progressTrack} aria-label={`Tiến độ ${percent}%`}>
              <span className={styles.progressFill} style={{ width: `${percent}%` }} />
            </span>
            <b>{percent}%</b>
          </span>
        )}
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
