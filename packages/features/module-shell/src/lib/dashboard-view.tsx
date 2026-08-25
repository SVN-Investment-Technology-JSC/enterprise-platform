'use client';

import type { ReactNode } from 'react';
import {
  resolveDashboardCards,
  type DashboardCardCatalog,
  type DashboardCardSize,
} from './dashboard-card.types';
import styles from './module-shell.module.scss';

const SIZE_CLASS: Readonly<Record<DashboardCardSize, string>> = {
  sm: styles.cardSm,
  md: styles.cardMd,
  lg: styles.cardLg,
  xl: styles.cardXl,
};

export interface DashboardViewProps<TData> {
  readonly catalog: DashboardCardCatalog<TData>;
  /** Danh sách id đã chọn, theo thứ tự hiển thị. Rỗng thì dùng mặc định của catalog. */
  readonly selection: readonly string[];
  /** `undefined` nghĩa là đang tải — vẽ khung chờ, không phải lỗi. */
  readonly data: TData | undefined;
  readonly emptyHint?: ReactNode;
}

/**
 * Lưới thẻ dashboard.
 *
 * Mọi thẻ đọc chung một object `data` do module nạp một lần, nên package này
 * không chứa dòng gọi mạng nào.
 */
export function DashboardView<TData>(props: DashboardViewProps<TData>) {
  const cards = resolveDashboardCards(props.catalog, props.selection);

  if (cards.length === 0) {
    return (
      <p className={styles.empty}>
        {props.emptyHint ?? 'Chưa có thẻ nào được bật. Chọn thẻ trong mục Cài đặt.'}
      </p>
    );
  }

  return (
    <div className={styles.cardGrid}>
      {cards.map((card) => (
        <section key={card.id} className={`${styles.card} ${SIZE_CLASS[card.size]}`}>
          <h2 className={styles.cardTitle}>{card.title}</h2>
          {props.data === undefined ? (
            <div className={styles.cardSkeleton} />
          ) : (
            card.render(props.data)
          )}
        </section>
      ))}
    </div>
  );
}
