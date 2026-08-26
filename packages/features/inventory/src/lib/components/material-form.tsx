'use client';

import {
  type CreateMaterialRequest,
  type Material,
  type MaterialCategory,
} from '@enterprise-platform/contracts-inventory';
import { useState, type FormEvent } from 'react';
import { MATERIAL_CATEGORY_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Thêm hoặc sửa một mã vật tư.
 *
 * Sửa thì khoá ô mã: mã là thứ mọi giao dịch trong sổ cái trỏ vào, đổi nó sẽ
 * làm lịch sử tồn kho mất dấu.
 */
export function MaterialForm({
  editing,
  units = [],
  busy,
  onCancel,
  onSubmit,
}: {
  editing?: Material;
  /** Danh mục đơn vị tính do admin cấu hình; rỗng thì rơi về ô nhập tự do. */
  units?: readonly string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateMaterialRequest) => void;
}) {
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [category, setCategory] = useState<MaterialCategory>(editing?.category ?? 'SPARE_PART');
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [minStock, setMinStock] = useState(String(editing?.minStock ?? 0));
  const [maxStock, setMaxStock] = useState(String(editing?.maxStock ?? 0));
  const [isSerialized, setIsSerialized] = useState(editing?.isSerialized ?? false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      category,
      unit: unit.trim(),
      minStock: Number(minStock) || 0,
      maxStock: Number(maxStock) || 0,
      isSerialized,
    });
  };

  return (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.cardHead}>
        <h2>{editing ? `Sửa vật tư ${editing.code}` : 'Thêm vật tư'}</h2>
      </div>

      <div className={styles.formGrid}>
        <label>
          Mã SKU *
          <input
            required
            readOnly={Boolean(editing)}
            placeholder="VD: VT-DAU-MBA"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {editing ? <small>Mã đã dùng trong sổ cái nên không đổi được.</small> : null}
        </label>
        <label>
          Tên vật tư *
          <input
            required
            placeholder="VD: Dầu cách điện máy biến áp"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Nhóm
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as MaterialCategory)}
          >
            {Object.entries(MATERIAL_CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Đơn vị tính *
          {units.length > 0 ? (
            /* Chọn từ danh mục thay vì gõ tay: gõ tay thì cùng một thứ vào kho
               dưới ba cái tên ("Cái", "cái", "chiếc") và không cộng gộp được.
               Vật tư cũ mang đơn vị không còn trong danh mục vẫn giữ được giá
               trị của nó — thêm vào cuối danh sách thay vì làm rỗng ô. */
            <select
              required
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            >
              <option value="">— Chọn đơn vị —</option>
              {(units.includes(unit) || !unit ? units : [...units, unit]).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          ) : (
            <input
              required
              placeholder="VD: Lít, Cái, Bộ"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          )}
        </label>
        <label>
          Tồn tối thiểu
          <input
            type="number"
            min={0}
            value={minStock}
            onChange={(event) => setMinStock(event.target.value)}
          />
        </label>
        <label>
          Tồn tối đa
          <input
            type="number"
            min={0}
            value={maxStock}
            onChange={(event) => setMaxStock(event.target.value)}
          />
          <small>Để 0 nghĩa là không đặt trần.</small>
        </label>
      </div>

      {!editing ? (
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={isSerialized}
            onChange={(event) => setIsSerialized(event.target.checked)}
          />
          Theo dõi theo số serial từng đơn vị
        </label>
      ) : null}

      <div className={styles.editActions}>
        <button type="submit" className={`${styles.action} ${styles.actionPrimary}`} disabled={busy}>
          {busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm vật tư'}
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.actionGhost}`}
          onClick={onCancel}
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
