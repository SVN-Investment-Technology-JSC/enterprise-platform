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
 * Thêm hoặc sửa một mã vật tư trong Modal Dialog nổi bật.
 */
export function MaterialForm({
  editing,
  busy,
  onCancel,
  onSubmit,
}: {
  editing?: Material;
  busy?: boolean;
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
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={styles.modalDialog} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <h2>
            <span>📦</span>
            {editing ? `Chỉnh sửa vật tư: ${editing.code}` : 'Thêm vật tư mới'}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>Mã SKU *</label>
                <input
                  required
                  readOnly={Boolean(editing)}
                  placeholder="VD: SKU-MTR-001"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                {editing ? (
                  <small>Mã SKU đã phát sinh giao dịch nên không thể thay đổi.</small>
                ) : (
                  <small>Mã định danh duy nhất của vật tư.</small>
                )}
              </div>

              <div className={styles.formGroup}>
                <label>Tên vật tư / Thiết bị *</label>
                <input
                  required
                  placeholder="VD: Động cơ điện 3 pha 75kW"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Nhóm phân loại *</label>
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
              </div>

              <div className={styles.formGroup}>
                <label>Đơn vị tính *</label>
                <input
                  required
                  placeholder="VD: Cái, Bộ, Cuộn, Lít, Kg"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Định mức tồn tối thiểu (Min Stock)</label>
                <input
                  type="number"
                  min={0}
                  value={minStock}
                  onChange={(event) => setMinStock(event.target.value)}
                />
                <small>Hệ thống sẽ cảnh báo khi tồn khả dụng dưới mức này.</small>
              </div>

              <div className={styles.formGroup}>
                <label>Định mức tồn tối đa (Max Stock)</label>
                <input
                  type="number"
                  min={0}
                  value={maxStock}
                  onChange={(event) => setMaxStock(event.target.value)}
                />
                <small>Để 0 nếu không giới hạn trần tồn kho.</small>
              </div>
            </div>

            {!editing ? (
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={isSerialized}
                  onChange={(event) => setIsSerialized(event.target.checked)}
                />
                <span>Quản lý chi tiết theo từng Số Serial (Serialized Tracking)</span>
              </label>
            ) : null}
          </div>

          <div className={styles.modalFoot}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ bỏ
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={busy}
            >
              {busy ? 'Đang lưu…' : editing ? '✓ Lưu thay đổi' : '+ Thêm vật tư'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
