'use client';

import {
  WORK_ITEM_STATUSES,
  canTransitionWorkItem,
  type WorkItem,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { useMemo, useState, type DragEvent } from 'react';
import { boardScopeOf, branchOf } from '../project-tree.model';
import {
  PRIORITY_LABELS,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
  isOverdue,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

/** Vùng sát mép bảng kích hoạt tự cuộn khi kéo thẻ, và bước cuộn mỗi lần. */
const EDGE_PX = 64;
const SCROLL_STEP_PX = 24;

export interface TabKanbanProps {
  readonly items: readonly WorkItem[];
  /** Rỗng nghĩa là cả cây của dự án. */
  readonly selected?: WorkItem;
  readonly canWrite: boolean;
  readonly onOpen: (item: WorkItem) => void;
  readonly onChangeStatus: (item: WorkItem, next: WorkItemStatus) => Promise<void>;
}

/**
 * Bảng Kanban sáu cột theo trạng thái.
 *
 * `phase` không hiện: nó là vỏ chứa, không phải việc ai đó kéo qua cột "đang
 * làm". Trạng thái của nó được suy ra từ việc con.
 */
export function TabKanban({
  items,
  selected,
  canWrite,
  onOpen,
  onChangeStatus,
}: TabKanbanProps) {
  const directory = useDirectory();
  const [dragging, setDragging] = useState<string>();
  const [dropTarget, setDropTarget] = useState<WorkItemStatus>();
  /** Thẻ đã kéo nhưng server chưa xác nhận; giữ để hiện ở cột mới. */
  const [pending, setPending] = useState<Record<string, WorkItemStatus>>({});
  const [error, setError] = useState<string>();

  // Chọn việc lá thì bảng lùi lên nhánh cha — xem `boardScopeOf`.
  const scope = useMemo(() => boardScopeOf(items, selected?.id), [items, selected]);

  const cards = useMemo(() => {
    const branch = scope ? branchOf(items, scope.id) : undefined;
    return items.filter(
      (item) =>
        item.itemType !== 'phase' &&
        (!branch || (branch.has(item.id) && item.id !== scope?.id)),
    );
  }, [items, scope]);

  /** Trạng thái hiện tại của thẻ đang kéo, để biết cột nào thả được. */
  const draggingStatus = useMemo(() => {
    if (!dragging) return undefined;
    const card = cards.find((item) => item.id === dragging);
    return card ? (pending[card.id] ?? card.status) : undefined;
  }, [dragging, cards, pending]);

  const accepts = (status: WorkItemStatus) =>
    canWrite && (!draggingStatus || canTransitionWorkItem(draggingStatus, status));

  const columns = useMemo(() => {
    const byStatus = new Map<WorkItemStatus, WorkItem[]>(
      WORK_ITEM_STATUSES.map((status) => [status, []]),
    );
    for (const card of cards) {
      const status = pending[card.id] ?? card.status;
      byStatus.get(status)?.push(card);
    }
    return byStatus;
  }, [cards, pending]);

  const drop = async (event: DragEvent, next: WorkItemStatus) => {
    event.preventDefault();
    setDropTarget(undefined);
    const id = event.dataTransfer.getData('text/plain') || dragging;
    setDragging(undefined);
    if (!id) return;

    const card = cards.find((item) => item.id === id);
    if (!card || card.status === next) return;
    if (!canTransitionWorkItem(card.status, next)) {
      setError(
        `Không chuyển thẳng "${WORK_ITEM_STATUS_LABELS[card.status]}" sang "${WORK_ITEM_STATUS_LABELS[next]}".`,
      );
      return;
    }
    setError(undefined);

    // Chuyển thẻ ngay để thao tác kéo thả không có độ trễ, rồi nhả ra khi
    // server trả lời. Thất bại thì thẻ tự về cột cũ — chỉ cần xoá mục tạm.
    setPending((current) => ({ ...current, [id]: next }));
    try {
      await onChangeStatus(card, next);
    } catch (cause) {
      // Thẻ tự về cột cũ ở `finally`; lý do phải hiện ra, không thì người
      // dùng chỉ thấy thẻ "bật lại" mà không biết vì sao.
      setError((cause as { message?: string })?.message ?? 'Không đổi được trạng thái.');
    } finally {
      setPending((current) => {
        const rest = { ...current };
        delete rest[id];
        return rest;
      });
    }
  };

  return (
    <div className={styles.tabBody}>
      <p className={styles.muted}>
        {scope
          ? `Đang xem nhánh ${scope.code} · ${scope.title}. Chọn dự án ở cây bên trái để xem toàn bộ.`
          : 'Đang xem toàn bộ công việc của dự án.'}{' '}
        {canWrite ? 'Kéo thẻ sang cột khác để đổi trạng thái; cột mờ là bước không hợp lệ.' : null}
      </p>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <div
        className={styles.kanban}
        // Kéo thẻ sát mép trái/phải thì bảng tự cuộn ngang, để thả được vào
        // cột đang nằm ngoài khung nhìn.
        onDragOver={(event) => {
          const board = event.currentTarget;
          const box = board.getBoundingClientRect();
          if (event.clientX > box.right - EDGE_PX) board.scrollLeft += SCROLL_STEP_PX;
          else if (event.clientX < box.left + EDGE_PX) board.scrollLeft -= SCROLL_STEP_PX;
        }}
      >
        {WORK_ITEM_STATUSES.map((status) => {
          const tone = WORK_ITEM_STATUS_TONE[status];
          const column = columns.get(status) ?? [];
          const locked = Boolean(draggingStatus) && !accepts(status);
          return (
            <section
              key={status}
              className={[
                dropTarget === status ? styles.kanbanColumnOver : styles.kanbanColumn,
                locked ? styles.kanbanColumnLocked : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragOver={(event) => {
                // Không gọi `preventDefault` thì trình duyệt hiện con trỏ cấm
                // thả — đúng với cột không chuyển tới được.
                if (!accepts(status)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(status);
              }}
              onDragLeave={() => setDropTarget((current) => (current === status ? undefined : current))}
              onDrop={(event) => void drop(event, status)}
            >
              <header className={styles.kanbanHead} style={{ borderTopColor: tone.fg }}>
                <span>{WORK_ITEM_STATUS_LABELS[status]}</span>
                <span className={styles.kanbanCount}>{column.length}</span>
              </header>

              <div className={styles.kanbanBody}>
                {column.map((card) => (
                  <article
                    key={card.id}
                    className={[
                      dragging === card.id ? styles.kanbanCardDragging : styles.kanbanCard,
                      selected?.id === card.id ? styles.kanbanCardSelected : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    draggable={canWrite}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', card.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(undefined)}
                    onClick={() => onOpen(card)}
                  >
                    <p className={styles.kanbanCardTitle}>
                      {card.code} · {card.title}
                    </p>
                    <p className={styles.kanbanCardMeta}>
                      <span className={styles.treeCode}>{card.code}</span>
                      <span>{PRIORITY_LABELS[card.priority]}</span>
                    </p>
                    <p className={styles.kanbanCardMeta}>
                      <span>{card.assigneeUserId ? directory.nameOf(card.assigneeUserId) : 'Chưa giao'}</span>
                      {card.plannedEnd ? (
                        <span className={isOverdue(card) ? styles.cellDanger : undefined}>
                          {formatDate(card.plannedEnd)}
                        </span>
                      ) : null}
                    </p>
                  </article>
                ))}

                {column.length === 0 ? <p className={styles.kanbanEmpty}>Trống</p> : null}
              </div>
            </section>
          );
        })}
      </div>

      {canWrite ? null : (
        <p className={styles.muted}>
          Bạn chỉ có quyền xem dự án này, nên không kéo thả đổi trạng thái được.
        </p>
      )}
    </div>
  );
}
