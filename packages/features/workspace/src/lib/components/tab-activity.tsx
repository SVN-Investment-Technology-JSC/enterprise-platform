'use client';

import type {
  WorkItem,
  WorkItemStatusHistoryEntry,
} from '@enterprise-platform/contracts-workspace';
import { branchOf } from '../project-tree.model';
import { WORK_ITEM_STATUS_LABELS, WORK_ITEM_STATUS_TONE, formatDateTime } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

export interface TabActivityProps {
  readonly entries: readonly WorkItemStatusHistoryEntry[];
  readonly items: readonly WorkItem[];
  /** Rỗng nghĩa là xem nhật ký của cả dự án. */
  readonly selected?: WorkItem;
}

/**
 * Nhật ký chuyển trạng thái, lọc theo nhánh đang chọn.
 *
 * Server trả nhật ký của cả dự án trong một lời gọi và lọc ở client: nhật ký
 * đã bị giới hạn số dòng, nên gọi lại theo từng node chỉ thêm vòng mạng mà
 * không giảm dữ liệu đáng kể.
 */
export function TabActivity({ entries, items, selected }: TabActivityProps) {
  const directory = useDirectory();
  const branch = selected ? branchOf(items, selected.id) : undefined;
  const scope = branch ? entries.filter((entry) => branch.has(entry.workItemId)) : entries;
  const titleOf = new Map(items.map((item) => [item.id, `${item.code} · ${item.title}`]));

  if (scope.length === 0) {
    return (
      <div className={styles.tabBody}>
        <p className={styles.muted}>Chưa có hoạt động nào được ghi nhận.</p>
      </div>
    );
  }

  return (
    <div className={styles.tabBody}>
      <ol className={styles.timeline}>
        {scope.map((entry) => {
          const tone = WORK_ITEM_STATUS_TONE[entry.toStatus];
          return (
            <li key={entry.id}>
              <span className={styles.timelineDot} style={{ background: tone.fg }} aria-hidden />
              <div className={styles.timelineBody}>
                <p className={styles.timelineHead}>
                  <strong>{titleOf.get(entry.workItemId) ?? 'Công việc đã xoá'}</strong>
                  <span className={styles.timelineTime}>{formatDateTime(entry.createdAt)}</span>
                </p>
                <p className={styles.timelineText}>
                  {entry.fromStatus
                    ? `${WORK_ITEM_STATUS_LABELS[entry.fromStatus]} → ${WORK_ITEM_STATUS_LABELS[entry.toStatus]}`
                    : `Khởi tạo ở trạng thái ${WORK_ITEM_STATUS_LABELS[entry.toStatus]}`}
                  {' · '}
                  <span className={styles.muted}>{directory.nameOf(entry.createdBy)}</span>
                </p>
                {entry.note ? <p className={styles.timelineNote}>{entry.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
