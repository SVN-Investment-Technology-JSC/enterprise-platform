'use client';

import type { ProcedureGroupOption } from '@enterprise-platform/contracts-procedure-engine';
import styles from './procedure-engine.module.scss';

/** Bỏ dấu và chuẩn hoá tên thành mã nhóm. */
function toCode(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface GroupCatalogValue {
  readonly options: readonly ProcedureGroupOption[];
  readonly autoAssignEnabled: boolean;
}

/**
 * Màn admin quản lý danh mục nhóm quy trình.
 *
 * Nhóm đã có quy trình dùng thì TẮT chứ đừng xoá: mã nhóm nằm trong snapshot của
 * mọi bản đã công bố, xoá đi thì các quy trình đó rơi ra ngoài mọi bộ lọc mà
 * không có cách nào tìm lại.
 */
export function GroupCatalogEditor({
  value,
  usedCodes,
  disabled,
  onChange,
}: {
  value: GroupCatalogValue;
  /** Mã nhóm đang được ít nhất một quy trình sử dụng. */
  usedCodes: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (next: GroupCatalogValue) => void;
}) {
  const setOptions = (options: ProcedureGroupOption[]) =>
    onChange({ ...value, options: options.map((option, index) => ({ ...option, sortOrder: index + 1 })) });

  const addGroup = () => {
    const base = 'Nhóm mới';
    let label = base;
    let n = 2;
    while (value.options.some((option) => option.label === label)) label = `${base} ${n++}`;

    /**
     * Mã phải duy nhất theo MÃ, không theo nhãn.
     *
     * Nhãn đổi được còn mã thì cố ý giữ nguyên (mã nằm trong snapshot của các
     * quy trình đã công bố). Nên sau khi đổi tên "Nhóm mới" thành thứ khác, nhãn
     * đó trống chỗ và lần thêm sau lại sinh ra ĐÚNG mã cũ. Hai dòng trùng mã thì
     * React trùng khoá, và lúc lưu `normalizeGroupCatalog` bỏ luôn dòng thứ hai
     * — nhóm vừa thêm biến mất không một lời báo.
     */
    const taken = new Set(value.options.map((option) => option.code));
    const stem = toCode(label) || 'nhom';
    let code = stem;
    let suffix = 2;
    while (taken.has(code)) code = `${stem}-${suffix++}`;

    setOptions([...value.options, { code, label, sortOrder: 0, isActive: true }]);
  };

  return (
    <div>
      <label className={styles.groupToggle}>
        <input
          type="checkbox"
          checked={value.autoAssignEnabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, autoAssignEnabled: event.target.checked })}
        />
        Tự gán nhóm cho quy trình mới
      </label>

      <ul className={styles.groupList}>
        {value.options.map((option, index) => {
          const inUse = usedCodes.has(option.code);
          return (
            <li key={option.code} className={styles.groupRow}>
              <input
                type="checkbox"
                checked={option.isActive}
                disabled={disabled}
                aria-label={`Bật nhóm ${option.label}`}
                onChange={(event) => {
                  const next = [...value.options];
                  next[index] = { ...option, isActive: event.target.checked };
                  setOptions(next);
                }}
              />
              <input
                className={styles.groupLabel}
                value={option.label}
                disabled={disabled}
                aria-label={`Tên nhóm ${option.label}`}
                onChange={(event) => {
                  const next = [...value.options];
                  // Chỉ đổi nhãn, KHÔNG đổi mã: mã đã nằm trong snapshot của các
                  // quy trình đã công bố.
                  next[index] = { ...option, label: event.target.value };
                  setOptions(next);
                }}
              />
              <button
                type="button"
                className={styles.groupRemove}
                disabled={disabled || inUse}
                title={inUse ? 'Đang có quy trình dùng nhóm này — hãy tắt thay vì xoá' : 'Xoá nhóm'}
                onClick={() => setOptions(value.options.filter((_, position) => position !== index))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <button type="button" className={styles.ghost} disabled={disabled} onClick={addGroup}>
        + Thêm nhóm
      </button>
    </div>
  );
}
