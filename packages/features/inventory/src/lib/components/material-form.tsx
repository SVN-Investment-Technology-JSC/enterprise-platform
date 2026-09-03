'use client';

import {
  type CreateMaterialRequest,
  type Material,
  type MaterialCategory,
} from '@enterprise-platform/contracts-inventory';
import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import styles from '../inventory.module.scss';

/**
 * Thêm hoặc sửa một mã vật tư dạng Popup Form / Dialog chuẩn.
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
  /**
   * Nhóm vật tư đã bỏ khỏi form.
   *
   * Bốn nhóm cứng (phụ tùng / tiêu hao / dụng cụ / quay vòng) trùng vai với cột
   * "Loại" — cột đó giờ là danh mục mở do tenant tự khai, nên bắt chọn thêm một
   * trục phân loại nữa là hỏi hai lần cùng một câu.
   *
   * Vẫn gửi một giá trị vì ràng buộc `materials_stock_requires_category` bắt mọi
   * dòng trong kho phải có nhóm.
   */
  const category: MaterialCategory = editing?.category ?? 'SPARE_PART';
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [minStock, setMinStock] = useState(String(editing?.minStock ?? 0));
  const [isSerialized, setIsSerialized] = useState(editing?.isSerialized ?? false);
  const [serialNumber, setSerialNumber] = useState(editing?.serialNumber ?? '');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      category,
      unit: unit.trim(),
      minStock: Number(minStock) || 0,
      isSerialized,
      serialNumber: serialNumber.trim() || undefined,
    });
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '560px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header Dialog */}
          <div className={styles.modalHead}>
            <div>
              <h2>{editing ? `Sửa vật tư ${editing.code}` : 'Thêm vật tư mới'}</h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                Khai báo thông tin vật tư, mã SKU và định mức lưu kho.
              </p>
            </div>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onCancel}
              title="Đóng (ESC)"
              aria-label="Đóng"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Thân Form Dialog */}
          <div className={styles.modalBody}>
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
                Đơn vị tính *
                {units.length > 0 ? (
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

              <label style={{ gridColumn: 'span 2' }}>
                Số sê-ri
                <input
                  placeholder="Bỏ trống nếu không có"
                  value={serialNumber}
                  onChange={(event) => setSerialNumber(event.target.value)}
                />
              </label>
            </div>

            {!editing ? (
              <label className={styles.checkRow} style={{ marginTop: '1rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isSerialized}
                  onChange={(event) => setIsSerialized(event.target.checked)}
                />
                <span>Theo dõi theo số serial từng đơn vị</span>
              </label>
            ) : null}
          </div>

          {/* Footer Dialog Actions */}
          <div className={styles.modalFoot}>
            <button
              type="button"
              className={`${styles.action} ${styles.actionGhost}`}
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy}
            >
              {busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm vật tư'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
