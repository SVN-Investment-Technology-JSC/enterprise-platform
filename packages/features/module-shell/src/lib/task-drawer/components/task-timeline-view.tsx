'use client';

import type { TaskTimelineBlock } from '@enterprise-platform/contracts-task-approval';
import styles from '../universal-task-drawer.module.scss';

export function TaskTimelineView({ block }: { block: TaskTimelineBlock }) {
  if (!block || !block.steps || block.steps.length === 0) return null;

  return (
    <div className={styles.blockCard}>
      <h4 className={styles.blockTitle}>{block.title || 'Tiến trình phê duyệt'}</h4>
      <div className={styles.timelineList}>
        {block.steps.map((step) => {
          let stepClass = styles.timelineStep;
          if (step.status === 'COMPLETED') stepClass += ` ${styles.stepCompleted}`;
          else if (step.status === 'CURRENT') stepClass += ` ${styles.stepCurrent}`;
          else if (step.status === 'REJECTED') stepClass += ` ${styles.stepRejected}`;

          return (
            <div key={step.stepId} className={stepClass}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                  {step.stepName}
                </span>
                {step.actedAt && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{step.actedAt}</span>
                )}
              </div>

              {step.assigneeName && (
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  Người xử lý: <b>{step.assigneeName}</b>
                </span>
              )}

              {step.comment && (
                <div style={{ marginTop: 4, padding: '6px 10px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#334155', fontStyle: 'italic', borderLeft: '2px solid #cbd5e1' }}>
                  "{step.comment}"
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
