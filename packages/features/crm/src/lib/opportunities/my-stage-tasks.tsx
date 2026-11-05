'use client';

import type { MyStageTask } from '@enterprise-platform/contracts-crm';
import { formatDate } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { StatusPill } from '../components/crm-ui';
import { errorMessage, listMyStageTasks } from '../crm-api';
import { STAGE_PLAN_STATUS_LABELS, isDueOverdue, stagePlanTone } from '../sales.model';
import styles from '../sales.module.scss';

/**
 * "Việc của tôi": giai đoạn của dự án bán hàng đang giao cho người dùng (đang làm hoặc chưa tới). Ẩn khi không có việc.
 * Mặc định thu gọn, chỉ hiện tiêu đề kèm số việc, để kanban không bị đẩy xuống.
 */
export function MyStageTasks({ refresh, onOpen }: { refresh: number; onOpen: (id: string) => void }) {
  const [tasks, setTasks] = useState<readonly MyStageTask[]>([]);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    listMyStageTasks()
      .then((next) => {
        if (!alive) return;
        setTasks(next);
        setError(undefined);
      })
      .catch((cause) => alive && setError(errorMessage(cause, 'Không tải được việc của bạn.')));
    return () => {
      alive = false;
    };
  }, [refresh]);

  if (error) return <p className={styles.alert}>{error}</p>;
  if (!tasks.length) return null;
  return (
    <section className={styles.panel} aria-label="Việc của tôi">
      <div className={styles.toolbar}>
        <h3 className={styles.title}>Việc của tôi ({tasks.length})</h3>
        <button type="button" className={styles.buttonGhost} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Thu gọn' : 'Mở rộng'}
        </button>
      </div>
      {expanded ? (
        <ul className={styles.timeline}>
          {tasks.map((task) => (
            <li key={`${task.opportunityId}:${task.stage.id}`} className={styles.timelineItem}>
              <div>
                <button type="button" className={styles.linkButton} onClick={() => onOpen(task.opportunityId)}>
                  {task.opportunityName}
                </button>{' '}
                <span className={styles.muted}>{task.customerName}</span>
                <div className={styles.timelineMeta}>
                  Giai đoạn {task.stage.name} <StatusPill tone={stagePlanTone(task.status)}>{STAGE_PLAN_STATUS_LABELS[task.status]}</StatusPill>
                  {task.dueDate ? ` · Hạn: ${formatDate(task.dueDate)}${isDueOverdue(task.dueDate) ? ' (quá hạn)' : ''}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
