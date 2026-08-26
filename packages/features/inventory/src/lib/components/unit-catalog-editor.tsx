'use client';

import { useState } from 'react';
import styles from '../inventory.module.scss';

/**
 * Danh mục đơn vị tính.
 *
 * Đơn vị đang có vật tư dùng thì KHÔNG cho xoá. Xoá đi thì form không còn chọn
 * lại được đơn vị đó, và mọi lần sửa vật tư cũ sẽ âm thầm đổi đơn vị của nó —
 * tức đổi ý nghĩa của cả số tồn đang có.
 */
export function UnitCatalogEditor({
  units,
  usedUnits,
  disabled,
  onChange,
}: {
  units: readonly string[];
  /** Đơn vị đang được ít nhất một vật tư dùng. */
  usedUnits: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    // So sánh không phân biệt hoa thường: thêm "cái" khi đã có "Cái" chính là
    // cái lỗi mà danh mục này sinh ra để chặn.
    if (units.some((unit) => unit.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...units, value]);
    setDraft('');
  };

  return (
    <div className={styles.unitEditor}>
      <ul className={styles.unitList}>
        {units.map((unit) => {
          const inUse = usedUnits.has(unit);
          return (
            <li key={unit}>
              <span>{unit}</span>
              {inUse ? <em title="Đang có vật tư dùng đơn vị này">đang dùng</em> : null}
              <button
                type="button"
                disabled={disabled || inUse}
                aria-label={`Xoá đơn vị ${unit}`}
                title={inUse ? 'Đang có vật tư dùng đơn vị này nên không xoá được.' : 'Xoá đơn vị'}
                onClick={() => onChange(units.filter((item) => item !== unit))}
              >
                ×
              </button>
            </li>
          );
        })}
        {units.length === 0 ? <li className={styles.unitEmpty}>Chưa có đơn vị nào.</li> : null}
      </ul>

      <div className={styles.unitAdd}>
        <input
          value={draft}
          disabled={disabled}
          placeholder="VD: Tấn, Cuộn, Bao"
          aria-label="Đơn vị tính mới"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Form Cài đặt bọc ngoài có nút Lưu riêng; Enter ở đây phải là
            // "thêm dòng", không được kích hoạt submit của form đó.
            event.preventDefault();
            add();
          }}
        />
        <button type="button" disabled={disabled || !draft.trim()} onClick={add}>
          Thêm
        </button>
      </div>
    </div>
  );
}
