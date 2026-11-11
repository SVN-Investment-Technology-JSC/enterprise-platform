'use client';

import { CRM_TASK_KIND_LABELS, type CrmTask } from '@enterprise-platform/contracts-crm';
import { useEffect, useState } from 'react';
import { getMyTasks } from '../crm-api';
import { formatMoney } from '../sales.model';
import styles from '../sales.module.scss';
import { openTask, type TaskOpeners } from './tasks-page';
import { CRM_QUOTES_PATH, approvalModeText, taskActionLabel, taskQuoteLabel } from './tasks.model';

/**
 * Khối thu gọn "Cần tôi duyệt (n)" ở đầu danh sách báo giá (D3-33). Ẩn khi không có việc; lỗi tải cũng ẩn (khối chỉ là
 * lối tắt, danh sách báo giá và bộ lọc "Cần tôi duyệt" vẫn dùng được). Việc qua Quy trình quay về danh sách báo giá.
 */
export function AwaitingApprovalBlock({ refresh = 0, ...openers }: TaskOpeners & { refresh?: number }) {
  const [tasks, setTasks] = useState<readonly CrmTask[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyTasks()
      .then((list) => alive && setTasks(list.awaitingMe))
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [refresh]);

  if (!tasks.length) return null;
  return (
    <section className={styles.panel} aria-label="Cần tôi duyệt">
      <div className={styles.toolbar}>
        <h3 className={styles.title}>Cần tôi duyệt ({tasks.length})</h3>
        <button type="button" className={styles.buttonGhost} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Thu gọn' : 'Mở rộng'}
        </button>
      </div>
      {expanded ? (
        <ul className={styles.timeline}>
          {tasks.map((task) => {
            const open = () => openTask(task, openers, { returnTo: CRM_QUOTES_PATH, fromTasks: false });
            return (
              <li key={`${task.kind}:${task.quoteId}:${task.versionNo}`} className={styles.timelineItem}>
                <div>
                  <button type="button" className={styles.linkButton} onClick={open}>
                    {taskQuoteLabel(task)}
                  </button>{' '}
                  <span className={styles.muted}>{task.customerName ?? ''}</span>
                  <div className={styles.timelineMeta}>
                    {CRM_TASK_KIND_LABELS[task.kind]} · {formatMoney(task.totalAmount)} · {approvalModeText(task.approval)}
                  </div>
                </div>
                <button type="button" className={styles.buttonGhost} onClick={open}>
                  {taskActionLabel(task)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
