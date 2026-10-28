'use client';

import type { TaskAttributesBlock } from '@enterprise-platform/contracts-task-approval';
import styles from '../universal-task-drawer.module.scss';

export function TaskAttributesView({ block }: { block: TaskAttributesBlock }) {
  if (!block || !block.items || block.items.length === 0) return null;

  return (
    <div className={styles.blockCard}>
      {block.title && <h4 className={styles.blockTitle}>{block.title}</h4>}
      <div className={styles.attributesGrid}>
        {block.items.map((item) => (
          <div key={item.key} className={styles.attributeItem}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <span className={styles.summaryValue}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
