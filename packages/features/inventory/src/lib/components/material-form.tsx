'use client';

import type {
  CreateMaterialRequest,
  Material,
  MaterialCategory,
} from '@enterprise-platform/contracts-inventory';
import { Info, Layers, Package, QrCode, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import styles from '../inventory.module.scss';

export type MaterialTrackingMode = 'SERIAL' | 'LOT' | 'NONE';

/**
 * Form Thêm mới / Chỉnh sửa Vật tư (Chuẩn danh mục Master Data ERP/WMS).
 *
 * Chỉ chịu trách nhiệm khai báo định nghĩa vật tư:
 * - Thông tin SKU: Mã, tên, đơn vị tính, ngưỡng tồn min/max.
 * - Định dạng quản lý định danh: Theo Sê-ri (Serial), Theo Lô (Lot/Batch), hoặc Thông thường.
 *
 * Nghiệp vụ chuẩn: Việc phát sinh số Lô hàng (Lot Number), Hạn sử dụng, CO/CQ hoặc
 * dán mã Sê-ri cá thể sẽ được thực hiện khi làm phiếu NHẬP KHO thực tế (Goods Receipt).
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
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [minStock, setMinStock] = useState(String(editing?.minStock ?? 0));
  const [maxStock, setMaxStock] = useState(String(editing?.maxStock ?? 100));

  // Xác định phương thức quản lý ban đầu khi sửa hoặc tạo mới
  const initialMode: MaterialTrackingMode = editing?.isSerialized
    ? 'SERIAL'
    : editing?.category === 'CONSUMABLE'
    ? 'LOT'
    : 'NONE';
  const [trackingMode, setTrackingMode] = useState<MaterialTrackingMode>(initialMode);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanUnit = unit.trim();

    if (!cleanCode || !cleanName || !cleanUnit) return;

    // Phân nhóm category theo tracking mode để tương thích ràng buộc database & contracts
    const category: MaterialCategory =
      trackingMode === 'LOT' ? 'CONSUMABLE' : 'SPARE_PART';
    const isSerialized = trackingMode === 'SERIAL';

    onSubmit({
      code: cleanCode,
      name: cleanName,
      category,
      unit: cleanUnit,
      minStock: Number(minStock) || 0,
      maxStock: Number(maxStock) || 0,
      isSerialized,
    });
  };

  const isDisabled = busy;

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '620px',
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
                Khai báo mã SKU, định mức tồn và phương thức quản lý định danh (Sê-ri hoặc Lô).
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
          <div className={styles.modalBody} style={{ maxHeight: '75vh', overflowY: 'auto' }}>
            {/* 1. Nhóm thông tin cơ bản của SKU */}
            <div className={styles.formGrid}>
              <label>
                Mã SKU / Mã vật tư *
                <input
                  required
                  readOnly={Boolean(editing)}
                  placeholder="VD: VT-RO-LE-01, VT-DAU-02…"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                {editing ? <small>Mã đã dùng trong sổ cái nên không đổi được.</small> : null}
              </label>

              <label>
                Tên vật tư *
                <input
                  required
                  placeholder="VD: Rơ-le bảo vệ so lệch, Dầu biến áp…"
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
                    placeholder="VD: Cái, Bộ, Lít, Cuộn…"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                )}
              </label>

              <label>
                Tồn tối thiểu (Min stock)
                <input
                  type="number"
                  min={0}
                  value={minStock}
                  onChange={(event) => setMinStock(event.target.value)}
                />
              </label>

              <label>
                Tồn tối đa (Max stock)
                <input
                  type="number"
                  min={0}
                  value={maxStock}
                  onChange={(event) => setMaxStock(event.target.value)}
                />
              </label>
            </div>

            {/* 2. CHỌN DUY NHẤT 1 PHƯƠNG THỨC QUẢN LÝ (MUTUALLY EXCLUSIVE) */}
            <div style={{ marginTop: '20px' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#0f172a',
                  marginBottom: '8px',
                }}
              >
                Phương thức quản lý định danh vật tư *
              </span>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '10px',
                }}
              >
                {/* Lựa chọn 1: Theo Sê-ri */}
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '12px',
                    borderRadius: '8px',
                    border:
                      trackingMode === 'SERIAL' ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: trackingMode === 'SERIAL' ? '#eff6ff' : '#ffffff',
                    cursor: editing ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="radio"
                      name="trackingMode"
                      disabled={Boolean(editing)}
                      checked={trackingMode === 'SERIAL'}
                      onChange={() => setTrackingMode('SERIAL')}
                    />
                    <QrCode size={16} color={trackingMode === 'SERIAL' ? '#2563eb' : '#64748b'} />
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: trackingMode === 'SERIAL' ? '#1d4ed8' : '#334155',
                      }}
                    >
                      Theo Sê-ri (SN)
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: '#64748b', lineHeight: '1.4' }}>
                    Mỗi chiếc có số SN riêng biệt (thiết bị, rơ-le, máy biến áp, motor...).
                  </span>
                </label>

                {/* Lựa chọn 2: Theo Lô / Bịch / Mẻ */}
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '12px',
                    borderRadius: '8px',
                    border:
                      trackingMode === 'LOT' ? '2px solid #16a34a' : '1px solid #e2e8f0',
                    background: trackingMode === 'LOT' ? '#f0fdf4' : '#ffffff',
                    cursor: editing ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="radio"
                      name="trackingMode"
                      disabled={Boolean(editing)}
                      checked={trackingMode === 'LOT'}
                      onChange={() => setTrackingMode('LOT')}
                    />
                    <Layers size={16} color={trackingMode === 'LOT' ? '#16a34a' : '#64748b'} />
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: trackingMode === 'LOT' ? '#15803d' : '#334155',
                      }}
                    >
                      Theo Lô (Lot/Batch)
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: '#64748b', lineHeight: '1.4' }}>
                    Quản lý mẻ/kiện, hạn dùng FEFO, kiểm định (dầu, cáp, hoá chất...).
                  </span>
                </label>

                {/* Lựa chọn 3: Thông thường */}
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '12px',
                    borderRadius: '8px',
                    border:
                      trackingMode === 'NONE' ? '2px solid #475569' : '1px solid #e2e8f0',
                    background: trackingMode === 'NONE' ? '#f8fafc' : '#ffffff',
                    cursor: editing ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="radio"
                      name="trackingMode"
                      disabled={Boolean(editing)}
                      checked={trackingMode === 'NONE'}
                      onChange={() => setTrackingMode('NONE')}
                    />
                    <Package size={16} color={trackingMode === 'NONE' ? '#0f172a' : '#64748b'} />
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: trackingMode === 'NONE' ? '#0f172a' : '#334155',
                      }}
                    >
                      Thông thường
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: '#64748b', lineHeight: '1.4' }}>
                    Quản lý tồn thuần túy theo số lượng, không cần định danh chi tiết.
                  </span>
                </label>
              </div>
            </div>

            {/* Thông báo chuẩn nghiệp vụ kho */}
            <div
              style={{
                marginTop: '16px',
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
              }}
            >
              <Info size={18} color="#64748b" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '12.5px', color: '#475569', lineHeight: '1.5' }}>
                {trackingMode === 'SERIAL' && (
                  <span>
                    Các số Sê-ri (SN) cụ thể của từng cá thể sẽ được ghi nhận và quét mã khi thực hiện{' '}
                    <strong>Phiếu Nhập kho</strong> hoặc cập nhật trong chi tiết vật tư sau này.
                  </span>
                )}
                {trackingMode === 'LOT' && (
                  <span>
                    Chi tiết từng lô hàng (Số lô, Hạn sử dụng, CO/CQ, Nhà cung cấp...) sẽ được khai báo
                    chính xác khi lập <strong>Phiếu Nhập kho</strong> vào kho thực tế.
                  </span>
                )}
                {trackingMode === 'NONE' && (
                  <span>
                    Số lượng nhập, kho lưu trữ và giá trị sẽ được ghi nhận qua các{' '}
                    <strong>Phiếu Nhập kho</strong> thông thường.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Footer Dialog Actions */}
          <div className={styles.modalFoot}>
            <button
              type="button"
              className={`${styles.action} ${styles.actionGhost}`}
              onClick={onCancel}
              disabled={isDisabled}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={isDisabled || !code.trim() || !name.trim() || !unit.trim()}
            >
              {isDisabled ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm vật tư'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
