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
import { Tooltip } from './tooltip';
import { Dialog } from './dialog';
import { Pager, usePaged } from './pager';
import { ReorderableTh, ResetColumnLayoutButton } from './reorderable-th';
import { explicitTableStyle, useColumnOrder, useColumnWidths } from '../column-order';

const ITEM_COLUMN_DEFAULTS: readonly string[] = [
  'code',
  'title',
  'project',
  'assignee',
  'status',
  'priority',
  'plannedEnd',
  'actualEnd',
];
const ITEM_COLUMN_PINNED: readonly string[] = ['code'];
const ITEM_COLUMN_LABELS: Record<string, string> = {
  code: 'Mã',
  title: 'Công việc',
  project: 'Dự án',
  assignee: 'Người phụ trách',
  status: 'Trạng thái',
  priority: 'Ưu tiên',
  plannedEnd: 'Hạn',
  actualEnd: 'Ngày xong',
};

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
  const columns = useColumnOrder('report-items', undefined, ITEM_COLUMN_DEFAULTS, ITEM_COLUMN_PINNED);
  const sizing = useColumnWidths('report-items', undefined, ITEM_COLUMN_DEFAULTS);

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
          <ResetColumnLayoutButton order={columns} sizing={sizing} />
          <div className={styles.tableScroll}>
            <table
              className={sizing.customized ? `${styles.table} ${styles.columnsResized}` : styles.table}
              style={explicitTableStyle(columns.order, sizing.widths)}
            >
              <thead>
                <tr>
                  {columns.order.map((id) => (
                    <ReorderableTh
                      key={id}
                      tableKey="report-items"
                      id={id}
                      order={columns.order}
                      pinned={ITEM_COLUMN_PINNED}
                      onMove={columns.move}
                      label={ITEM_COLUMN_LABELS[id]}
                      sizing={sizing}
                    >
                      {ITEM_COLUMN_LABELS[id]}
                    </ReorderableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.workItemId}>
                    {columns.order.map((id) => {
                      switch (id) {
                        case 'code':
                          return (
                            <td key={id} className={`${styles.treeCode} ${styles.cellNowrap}`}>
                              {row.code}
                            </td>
                          );
                        case 'title':
                          return (
                            <td key={id}>
                              {onOpenItem ? (
                                <Tooltip content="Mở chi tiết công việc">
                                  <button
                                    type="button"
                                    className={styles.linkButton}
                                    onClick={() => onOpenItem(row.projectId, row.workItemId)}
                                  >
                                    {row.title}
                                  </button>
                                </Tooltip>
                              ) : (
                                row.title
                              )}
                            </td>
                          );
                        case 'project':
                          return (
                            <td key={id} className={styles.muted}>
                              {row.projectCode}
                            </td>
                          );
                        case 'assignee':
                          return <td key={id}>{row.assigneeUserId ? nameOf(row.assigneeUserId) : 'Chưa giao'}</td>;
                        case 'status':
                          return (
                            <td key={id}>
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
                          );
                        case 'priority':
                          return (
                            <td key={id}>
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
                          );
                        case 'plannedEnd':
                          return (
                            <td key={id} className={styles.cellNowrap}>
                              {formatDate(row.plannedEnd)}
                            </td>
                          );
                        case 'actualEnd':
                          return (
                            <td key={id} className={styles.cellNowrap}>
                              {formatDate(row.actualEnd)}
                            </td>
                          );
                        default:
                          return null;
                      }
                    })}
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
