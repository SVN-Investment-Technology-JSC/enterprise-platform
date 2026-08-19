'use client';

import { useState, type ReactNode } from 'react';
import styles from './workspace-board.module.scss';

export interface DetailTab {
  readonly id: string;
  readonly label: string;
  /** Số nhỏ cạnh nhãn, ví dụ số tệp đang có. Bỏ qua khi bằng 0. */
  readonly count?: number;
  readonly render: () => ReactNode;
}

/**
 * Dải tab cho cột chi tiết của workorder.
 *
 * Cố ý để cục bộ trong feature package thay vì đẩy lên shared-ui: chưa màn hình
 * nào khác cần tới, và một primitive dùng chung sớm quá thường bị bẻ cong theo
 * nhu cầu của nơi dùng thứ hai.
 */
export function DetailTabs({ tabs, initial }: { tabs: readonly DetailTab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className={styles.tabHost}>
      <div className={styles.tabStrip} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current?.id}
            className={`${styles.tab} ${tab.id === current?.id ? styles.tabOn : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
            {tab.count ? <span className={styles.tabCount}>{tab.count}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.render()}</div>
    </div>
  );
}
