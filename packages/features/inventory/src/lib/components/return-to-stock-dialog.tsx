'use client';

import type { ReturnItemToStockRequest, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useState } from 'react';
import styles from '../inventory.module.scss';

/**
 * Thanh lý một vật tư khỏi cây lắp đặt.
 *
 * Thanh lý ở đây KHÔNG phải xoá. Hàng đã vào sổ kho thì chỉ có nhập hoặc xuất —
 * mã vật tư và toàn bộ lịch sử của nó luôn ở lại. Tháo một thiết bị xuống là
 * một lệnh NHẬP: hiện vật rời khỏi vị trí lắp đặt và về nằm trong một kho.
 *
 * Vì vậy kho tiếp nhận là bắt buộc, không có kho mặc định. Đoán một kho thay
 * người bấm nghĩa là ghi tăng tồn ở nơi hiện vật không hề có mặt, và sai lệch
 * đó chỉ lộ ra ở kỳ kiểm kê sau.
 */
export function ReturnToStockDialog({
  title,
  description,
  unit,
  maxQuantity,
  warehouses,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  /** Đơn vị tính, để hiện cạnh ô số lượng. */
  unit?: string;
  /** Trần cho ô số lượng: số đang lắp trên thiết bị. Bỏ trống là không chặn. */
  maxQuantity?: number;
  warehouses: readonly Warehouse[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: ReturnItemToStockRequest) => void;
}) {
  // Một kho thì chọn sẵn — vẫn là lựa chọn có ý thức vì nó hiện rõ trên màn
  // hình, chỉ là không bắt bấm thêm một lần cho một phương án duy nhất.
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const amount = Number(quantity);
  const valid = Number.isFinite(amount) && amount > 0;
  const over = maxQuantity !== undefined && valid && amount > maxQuantity;
  const ready = warehouseCode !== '' && valid && !over;

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '560px',
          background: '#f5f5f5',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header theo quy chuẩn Typography & Close Button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 700,
                color: '#333333',
                lineHeight: 1.25,
              }}
            >
              {title}
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13.5px',
                color: '#666666',
                lineHeight: 1.4,
              }}
            >
              {description}
            </p>
          </div>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              padding: 0,
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: '#666666',
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onClick={onCancel}
            title="Đóng (ESC)"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            onConfirm({
              warehouseCode,
              quantity: amount,
              note: note.trim() || undefined,
            });
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          {/* Hàng 2 cột: Kho tiếp nhận & Số lượng */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                Kho tiếp nhận <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select
                style={{
                  padding: '9px 12px',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                  background: '#ffffff',
                  fontSize: '14px',
                  color: '#333333',
                  outline: 'none',
                }}
                value={warehouseCode}
                required
                onChange={(event) => setWarehouse(event.target.value)}
              >
                <option value="">— Chọn kho tiếp nhận —</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.code} value={warehouse.code}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', minHeight: '20px' }}>
                <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                  Số lượng {unit ? `(${unit})` : ''} <span style={{ color: '#dc2626' }}>*</span>
                </label>
                {maxQuantity !== undefined ? (
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                    (Tối đa: {maxQuantity} {unit ?? ''})
                  </span>
                ) : null}
              </div>
              <input
                type="number"
                min={0.001}
                step="0.001"
                style={{
                  padding: '9px 12px',
                  borderRadius: '4px',
                  border: over ? '1px solid #ef4444' : '1px solid #e0e0e0',
                  background: '#ffffff',
                  fontSize: '14px',
                  color: '#333333',
                  outline: 'none',
                }}
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
          </div>

          {/* Cảnh báo số lượng vượt quá đang lắp */}
          {over ? (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '12.5px',
                lineHeight: 1.4,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span></span>
              <span>
                Chỉ đang lắp <strong>{maxQuantity} {unit ?? ''}</strong> trên thiết bị — không thể tháo/gỡ {amount} {unit ?? ''}.
              </span>
            </div>
          ) : null}

          {/* Ghi chú */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
              Ghi chú hoàn kho
            </label>
            <input
              style={{
                padding: '9px 12px',
                borderRadius: '4px',
                border: '1px solid #e0e0e0',
                background: '#ffffff',
                fontSize: '14px',
                color: '#333333',
                outline: 'none',
              }}
              value={note}
              placeholder="Lý do tháo gỡ, tình trạng thiết bị khi nhập về kho…"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              marginTop: '12px',
              paddingTop: '16px',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <button
              type="button"
              style={{
                padding: '9px 16px',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                background: 'transparent',
                color: '#4b5563',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              disabled={busy}
              onClick={onCancel}
            >
              Huỷ
            </button>
            <button
              type="submit"
              style={{
                padding: '9px 20px',
                borderRadius: '4px',
                border: 'none',
                background: busy || !ready ? '#fca5a5' : '#dc2626',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: busy || !ready ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              disabled={busy || !ready}
            >
              {busy ? 'Đang hoàn kho…' : 'Xác nhận nhập về kho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
