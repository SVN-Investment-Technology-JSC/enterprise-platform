'use client';

import type {
  MaintenanceFrequencyCatalog,
  MaintenanceFrequencyOption,
} from '@enterprise-platform/contracts-maintenance';
import styles from '../maintenance.module.scss';

const UNIT_LABEL: Readonly<Record<MaintenanceFrequencyOption['intervalUnit'], string>> = {
  day: 'ngày',
  week: 'tuần',
  month: 'tháng',
  year: 'năm',
};

/** Bỏ dấu và chuẩn hoá nhãn thành mã. */
function toCode(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Danh mục tần suất bảo trì.
 *
 * `intervalUnit` và `intervalCount` mới là phần thật: ngày đến hạn kế tiếp tính
 * từ hai trường đó. Đổi nhãn thì lịch không đổi, đổi hai trường này thì mọi lịch
 * đang dùng tần suất đó sẽ nhảy sang chu kỳ khác ở lần sinh phiếu tiếp theo.
 *
 * Tần suất đang có lịch dùng thì TẮT chứ đừng xoá: mã tần suất nằm trong cột
 * `schedules.frequency`, xoá đi thì lịch đó không tính được ngày đến hạn nữa.
 */
export function FrequencyCatalogEditor({
  value,
  usedCodes,
  disabled,
  onChange,
}: {
  value: MaintenanceFrequencyCatalog;
  /** Mã tần suất đang được ít nhất một lịch dùng. */
  usedCodes: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (next: MaintenanceFrequencyCatalog) => void;
}) {
  const setOptions = (options: MaintenanceFrequencyOption[]) =>
    onChange({ options: options.map((option, index) => ({ ...option, sortOrder: index + 1 })) });

  const patch = (index: number, change: Partial<MaintenanceFrequencyOption>) => {
    const next = [...value.options];
    next[index] = { ...next[index], ...change };
    setOptions(next);
  };

  const add = () => {
    const base = 'Tần suất mới';
    let label = base;
    let n = 2;
    while (value.options.some((option) => option.label === label)) label = `${base} ${n++}`;

    // Mã duy nhất theo MÃ, không theo nhãn: nhãn đổi được còn mã thì giữ nguyên,
    // nên kiểm theo nhãn sẽ sinh lại đúng mã cũ sau một lần đổi tên.
    const taken = new Set(value.options.map((option) => option.code));
    const stem = toCode(label) || 'tan-suat';
    let code = stem;
    let suffix = 2;
    while (taken.has(code)) code = `${stem}-${suffix++}`;

    setOptions([
      ...value.options,
      { code, label, intervalUnit: 'month', intervalCount: 1, sortOrder: 0, isActive: true },
    ]);
  };

  return (
    <div className={styles.freqEditor}>
      <ul className={styles.freqList}>
        {value.options.map((option, index) => {
          const inUse = usedCodes.has(option.code);
          return (
            <li key={option.code}>
              <input
                type="checkbox"
                checked={option.isActive}
                disabled={disabled}
                aria-label={`Bật tần suất ${option.label}`}
                onChange={(event) => patch(index, { isActive: event.target.checked })}
              />
              <input
                className={styles.freqLabel}
                value={option.label}
                disabled={disabled}
                aria-label={`Tên tần suất ${option.label}`}
                // Chỉ đổi nhãn, KHÔNG đổi mã: mã nằm trong `schedules.frequency`.
                onChange={(event) => patch(index, { label: event.target.value })}
              />
              <span className={styles.freqEvery}>mỗi</span>
              <input
                type="number"
                min={1}
                className={styles.freqCount}
                value={option.intervalCount}
                disabled={disabled}
                aria-label={`Số kỳ của ${option.label}`}
                onChange={(event) =>
                  patch(index, { intervalCount: Math.max(1, Number(event.target.value) || 1) })
                }
              />
              <select
                value={option.intervalUnit}
                disabled={disabled}
                aria-label={`Đơn vị chu kỳ của ${option.label}`}
                onChange={(event) =>
                  patch(index, {
                    intervalUnit: event.target.value as MaintenanceFrequencyOption['intervalUnit'],
                  })
                }
              >
                {(['day', 'week', 'month', 'year'] as const).map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABEL[unit]}
                  </option>
                ))}
              </select>
              {inUse ? <em title="Đang có lịch dùng tần suất này">đang dùng</em> : null}
              <button
                type="button"
                className={styles.freqRemove}
                disabled={disabled || inUse}
                aria-label={`Xoá tần suất ${option.label}`}
                title={
                  inUse
                    ? 'Đang có lịch dùng tần suất này — tắt thay vì xoá, nếu không lịch đó mất cách tính ngày đến hạn.'
                    : 'Xoá tần suất'
                }
                onClick={() => setOptions(value.options.filter((_, p) => p !== index))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <button type="button" className={styles.freqAdd} disabled={disabled} onClick={add}>
        + Tần suất
      </button>
    </div>
  );
}
