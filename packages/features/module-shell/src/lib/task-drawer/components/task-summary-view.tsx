'use client';

import type { TaskSummaryBlock } from '@enterprise-platform/contracts-task-approval';
import styles from '../universal-task-drawer.module.scss';

export function TaskSummaryView({ block }: { block: TaskSummaryBlock }) {
  if (!block || !block.items || block.items.length === 0) return null;

  return (
    <div className={styles.blockCard}>
      <div className={styles.summaryGrid}>
        {block.items.map((item, idx) => (
          <div key={idx} className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <span className={styles.summaryValue}>{item.value}</span>
            {item.hint && <span className={styles.summaryHint}>{item.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
