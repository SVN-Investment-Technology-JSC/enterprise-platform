'use client';

import { useState } from 'react';
import styles from '../inventory.module.scss';

/**
 * Trình soạn một DANH MỤC CHUỖI: đơn vị tính, tình trạng, loại vật tư, vị trí…
 *
 * Bốn danh mục đó khác nhau ở nội dung nhưng giống hệt nhau ở thao tác — thêm,
 * xoá, chặn trùng — nên dùng chung một trình soạn. Chữ hiển thị phải truyền vào:
 * bản trước viết cứng "đơn vị", nên danh mục Tình trạng cũng hiện "Chưa có đơn
 * vị nào" và gợi ý "VD: Tấn, Cuộn, Bao".
 *
 * Giá trị đang được dùng thì KHÔNG cho xoá. Xoá đi thì form không chọn lại được
 * giá trị đó, và mọi lần sửa bản ghi cũ sẽ âm thầm đổi nó sang giá trị khác.
 */
export function UnitCatalogEditor({
  units,
  usedUnits,
  disabled,
  noun = 'đơn vị',
  placeholder = 'VD: Tấn, Cuộn, Bao',
  onChange,
}: {
  units: readonly string[];
  /** Giá trị đang được ít nhất một bản ghi dùng. */
  usedUnits: ReadonlySet<string>;
  disabled?: boolean;
  /** Tên gọi của thứ đang khai, dùng trong câu trống và nhãn trợ năng. */
  noun?: string;
  placeholder?: string;
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
              {inUse ? <em title={`Đang có vật tư dùng ${noun} này`}>đang dùng</em> : null}
              <button
                type="button"
                disabled={disabled || inUse}
                aria-label={`Xoá ${noun} ${unit}`}
                title={
                  inUse ? `Đang có vật tư dùng ${noun} này nên không xoá được.` : `Xoá ${noun}`
                }
                onClick={() => onChange(units.filter((item) => item !== unit))}
              >
                ×
              </button>
            </li>
          );
        })}
        {units.length === 0 ? (
          <li className={styles.unitEmpty}>Chưa khai {noun} nào.</li>
        ) : null}
      </ul>

      <div className={styles.unitAdd}>
        <input
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={`${noun} mới`}
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
