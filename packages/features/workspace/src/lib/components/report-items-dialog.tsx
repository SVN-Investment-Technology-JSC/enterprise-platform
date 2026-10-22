'use client';

import type { ReportItemList } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Dialog } from './dialog';
import { Pager, usePaged } from './pager';

/** Một con số vừa được bấm: tiêu đề của danh sách và cách tải nó. */
export interface ReportDrill {
  readonly title: string;
  readonly subtitle?: string;
  readonly load: () => Promise<ReportItemList>;
}

/**
 * Danh sách việc đứng sau một con số trên báo cáo. Bấm một việc để mở chi tiết của nó trong dự án.
 */
export function ReportItemsDialog({
  drill,
  nameOf,
  onOpenItem,
  onClose,
}: {
  readonly drill?: ReportDrill;
  readonly nameOf: (userId?: string) => string;
  readonly onOpenItem?: (projectId: string, workItemId: string) => void;
  readonly onClose: () => void;
}) {
  const [list, setList] = useState<ReportItemList>();
  const [error, setError] = useState<string>();
  const page = usePaged(list?.items);

  useEffect(() => {
    if (!drill) return;
    let alive = true;
    setList(undefined);
    setError(undefined);
    drill
      .load()
      .then((value) => alive && setList(value))
      .catch((cause) => alive && setError((cause as { message?: string })?.message ?? 'Không tải được danh sách.'));
    return () => {
      alive = false;
    };
  }, [drill]);

  return (
    <Dialog
      open={Boolean(drill)}
      title={drill?.title ?? ''}
      subtitle={
        list
          ? `${drill?.subtitle ? `${drill.subtitle} · ` : ''}${list.items.length}${list.truncated ? '+' : ''} công việc`
          : drill?.subtitle
      }
      size="extraWide"
      submitLabel="Đóng"
      cancelLabel={null}
      error={error}
      onClose={onClose}
      onSubmit={onClose}
    >
      {!list ? (
        error ? null : <p className={styles.muted}>Đang tải…</p>
      ) : list.items.length === 0 ? (
        <p className={styles.muted}>Không có công việc nào.</p>
      ) : (
        <>
          {list.truncated ? (
            <p className={styles.muted}>Chỉ hiện {list.items.length} việc đầu; thu hẹp bộ lọc để xem đủ.</p>
          ) : null}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Công việc</th>
                  <th>Dự án</th>
                  <th>Người phụ trách</th>
                  <th>Trạng thái</th>
                  <th>Ưu tiên</th>
                  <th>Hạn</th>
                  <th>Ngày xong</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.workItemId}>
                    <td className={`${styles.treeCode} ${styles.cellNowrap}`}>{row.code}</td>
                    <td>
                      {onOpenItem ? (
                        <button
                          type="button"
                          className={styles.linkButton}
                          title="Mở chi tiết công việc"
                          onClick={() => onOpenItem(row.projectId, row.workItemId)}
                        >
                          {row.title}
                        </button>
                      ) : (
                        row.title
                      )}
                    </td>
                    <td className={styles.muted}>{row.projectCode}</td>
                    <td>{row.assigneeUserId ? nameOf(row.assigneeUserId) : 'Chưa giao'}</td>
                    <td>
                      <span
                        className={styles.pill}
                        style={{
                          background: WORK_ITEM_STATUS_TONE[row.status].bg,
                          color: WORK_ITEM_STATUS_TONE[row.status].fg,
                        }}
                      >
                        {WORK_ITEM_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td>
                      <span
                        className={styles.pill}
                        style={{
                          background: PRIORITY_TONE[row.priority].bg,
                          color: PRIORITY_TONE[row.priority].fg,
                        }}
                      >
                        {PRIORITY_LABELS[row.priority]}
                      </span>
                    </td>
                    <td className={styles.cellNowrap}>{formatDate(row.plannedEnd)}</td>
                    <td className={styles.cellNowrap}>{formatDate(row.actualEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page.page}
            pages={page.pages}
            total={page.total}
            pageSize={page.pageSize}
            onPage={page.setPage}
          />
        </>
      )}
    </Dialog>
  );
}
