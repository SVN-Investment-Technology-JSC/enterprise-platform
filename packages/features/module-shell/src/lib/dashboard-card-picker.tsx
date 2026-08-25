'use client';

import type { DashboardCardCatalog } from './dashboard-card.types';
import styles from './module-shell.module.scss';

export interface DashboardCardPickerProps<TData> {
  readonly catalog: DashboardCardCatalog<TData>;
  readonly selection: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** Trần số thẻ được bật; bỏ trống là không giới hạn. */
  readonly max?: number;
  readonly disabled?: boolean;
}

/**
 * Màn admin chọn thẻ dashboard: bật/tắt và sắp xếp.
 *
 * Dùng nút lên/xuống thay vì kéo thả — repo chưa có thư viện drag-and-drop và
 * thêm một thư viện chỉ cho màn này thì không đáng.
 */
export function DashboardCardPicker<TData>(props: DashboardCardPickerProps<TData>) {
  const { catalog, selection, onChange, max, disabled } = props;
  const atLimit = max !== undefined && selection.length >= max;

  const toggle = (id: string) => {
    if (selection.includes(id)) {
      onChange(selection.filter((current) => current !== id));
      return;
    }
    if (atLimit) return;
    onChange([...selection, id]);
  };

  const move = (id: string, delta: number) => {
    const from = selection.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= selection.length) return;
    const next = [...selection];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  // Thẻ đã bật lên trước theo đúng thứ tự hiển thị, thẻ chưa bật xếp sau — để
  // admin thấy ngay dashboard sẽ trông ra sao.
  const enabled = selection
    .map((id) => catalog.find((card) => card.id === id))
    .filter((card): card is (typeof catalog)[number] => card !== undefined);
  const rest = catalog.filter((card) => !selection.includes(card.id));

  return (
    <div>
      <div className={styles.pickerList}>
        {[...enabled, ...rest].map((card) => {
          const on = selection.includes(card.id);
          const index = selection.indexOf(card.id);
          return (
            <div key={card.id} className={`${styles.pickerRow} ${on ? styles.pickerRowOn : ''}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled || (!on && atLimit)}
                aria-label={card.title}
                onChange={() => toggle(card.id)}
              />
              <span className={styles.pickerText}>
                <strong>{card.title}</strong>
                <small>{card.description}</small>
              </span>
              {on ? (
                <span className={styles.pickerOrder}>
                  <button
                    type="button"
                    className={styles.orderButton}
                    disabled={disabled || index === 0}
                    aria-label={`Đưa ${card.title} lên trên`}
                    onClick={() => move(card.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.orderButton}
                    disabled={disabled || index === selection.length - 1}
                    aria-label={`Đưa ${card.title} xuống dưới`}
                    onClick={() => move(card.id, 1)}
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {max !== undefined ? (
        <p className={styles.pickerLimit}>
          Đã chọn {selection.length}/{max} thẻ.
        </p>
      ) : null}
    </div>
  );
}
