'use client';

import {
  WORK_ITEM_STATUSES,
  type WorkItem,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { useMemo, useState } from 'react';
import { branchOf } from '../project-tree.model';
import {
  PRIORITY_LABELS,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
  isOverdue,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { useDirectory } from './use-directory';

export interface TabWorkItemsProps {
  readonly items: readonly WorkItem[];
  /** Rỗng nghĩa là xem toàn bộ cây của dự án. */
  readonly selected?: WorkItem;
  readonly canWrite: boolean;
  readonly onOpen: (item: WorkItem) => void;
  readonly onChangeStatus: (item: WorkItem, next: WorkItemStatus) => void;
}

type SortKey = 'code' | 'title' | 'status' | 'priority' | 'plannedEnd';

/**
 * Bảng phẳng các công việc thuộc nhánh đang chọn.
 *
 * Cùng dữ liệu với cây bên trái nhưng nhìn theo hàng: dễ so sánh hạn và người
 * phụ trách giữa nhiều việc, việc mà cây phân cấp làm không tốt.
 */
export function TabWorkItems({
  items,
  selected,
  canWrite,
  onOpen,
  onChangeStatus,
}: TabWorkItemsProps) {
  const directory = useDirectory();
  const [statusFilter, setStatusFilter] = useState<'all' | WorkItemStatus>('all');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'code',
    desc: false,
  });

  const rows = useMemo(() => {
    const branch = selected ? branchOf(items, selected.id) : undefined;
    let scope = branch
      ? items.filter((item) => branch.has(item.id) && item.id !== selected?.id)
      : [...items];
    if (statusFilter !== 'all') scope = scope.filter((item) => item.status === statusFilter);
    if (onlyOverdue) scope = scope.filter(isOverdue);

    const direction = sort.desc ? -1 : 1;
    return scope.sort((a, b) => {
      const left = a[sort.key] ?? '';
      const right = b[sort.key] ?? '';
      return String(left).localeCompare(String(right), 'vi') * direction;
    });
  }, [items, selected, statusFilter, onlyOverdue, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }));

  return (
    <div className={styles.tabBody}>
      <div className={styles.filterBar}>
        <Choice
          label="Lọc theo trạng thái"
          value={statusFilter}
          options={[
            { value: 'all', label: 'Tất cả trạng thái' },
            ...WORK_ITEM_STATUSES.map((status) => ({
              value: status,
              label: WORK_ITEM_STATUS_LABELS[status],
            })),
          ]}
          onChange={(value) => setStatusFilter(value as 'all' | WorkItemStatus)}
        />
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={onlyOverdue}
            onChange={(event) => setOnlyOverdue(event.target.checked)}
          />
          Chỉ việc quá hạn
        </label>
        <span className={styles.muted}>{rows.length} công việc</span>
      </div>

      {rows.length === 0 ? (
        <p className={styles.muted}>Không có công việc nào khớp bộ lọc.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableHeader label="Mã" sortKey="code" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Tên công việc" sortKey="title" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Trạng thái" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortableHeader
                label="Ưu tiên"
                sortKey="priority"
                sort={sort}
                onSort={toggleSort}
              />
              <th>Người phụ trách</th>
              <SortableHeader label="Hạn" sortKey="plannedEnd" sort={sort} onSort={toggleSort} />
              <th>Tiến độ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const tone = WORK_ITEM_STATUS_TONE[item.status];
              return (
                <tr key={item.id} onDoubleClick={() => onOpen(item)}>
                  <td>
                    <button type="button" className={styles.linkButton} onClick={() => onOpen(item)}>
                      {item.code}
                    </button>
                  </td>
                  <td>{item.title}</td>
                  <td>
                    {canWrite ? (
                      <Choice
                        label={`Trạng thái của ${item.code}`}
                        value={item.status}
                        options={WORK_ITEM_STATUSES.map((status) => ({
                          value: status,
                          label: WORK_ITEM_STATUS_LABELS[status],
                        }))}
                        onChange={(value) => onChangeStatus(item, value as WorkItemStatus)}
                      />
                    ) : (
                      <span
                        className={styles.treeBadge}
                        style={{ background: tone.bg, color: tone.fg }}
                      >
                        {WORK_ITEM_STATUS_LABELS[item.status]}
                      </span>
                    )}
                  </td>
                  <td>{PRIORITY_LABELS[item.priority]}</td>
                  <td>{directory.nameOf(item.assigneeUserId)}</td>
                  <td className={isOverdue(item) ? styles.cellDanger : undefined}>
                    {formatDate(item.plannedEnd) || '—'}
                  </td>
                  <td>
                    <div className={styles.progressTrack} aria-label={`${item.progressPercent}%`}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${item.progressPercent}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className={styles.sortButton} onClick={() => onSort(sortKey)}>
        {label}
        {active ? <span aria-hidden>{sort.desc ? ' ↓' : ' ↑'}</span> : null}
      </button>
    </th>
  );
}
