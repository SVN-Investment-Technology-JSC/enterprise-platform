'use client';

import type { ReturnItemToStockRequest, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { AlertTriangle } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { ProcedureOption } from '../inventory-api';
import { getUnitQuantityConfig } from '../inventory-labels';
import styles from '../inventory.module.scss';

export interface ReturnToStockInput extends ReturnItemToStockRequest {
  readonly procedureDefinitionId?: string;
}

/**
 * Thanh lý hoặc tháo dỡ một vật tư / thiết bị khỏi cây lắp đặt.
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
  isAsset = false,
  warehouses,
  procedures = [],
  hasChildren = false,
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
  /** Là cá thể thiết bị tài sản (số lượng cố định là 1) */
  isAsset?: boolean;
  warehouses: readonly Warehouse[];
  procedures?: readonly ProcedureOption[];
  hasChildren?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: ReturnToStockInput) => void;
}) {
  // Một kho thì chọn sẵn — vẫn là lựa chọn có ý thức vì nó hiện rõ trên màn
  // hình, chỉ là không bắt bấm thêm một lần cho một phương án duy nhất.
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  // Khởi tạo số lượng: nếu là thiết bị cá thể thì là 1, nếu có maxQuantity thì mặc định dỡ toàn bộ số lượng đang lắp
  const [quantity, setQuantity] = useState(() =>
    isAsset ? '1' : maxQuantity !== undefined ? String(maxQuantity) : '1',
  );
  const [note, setNote] = useState('');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((w) => ({
        value: w.code,
        label: w.name,
        badge: w.code,
      })),
    [warehouses],
  );

  const procedureOptions = useMemo(
    () =>
      procedures.map((p) => ({
        value: p.id,
        label: `${p.code} · ${p.name}`,
        badge: p.code,
      })),
    [procedures],
  );

  const unitConfig = getUnitQuantityConfig(unit);
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
              procedureDefinitionId: procedureDefinitionId || undefined,
            });
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          {/* Cảnh báo khi tháo gỡ cụm thiết bị có nhánh con */}
          {hasChildren ? (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                fontSize: '12.5px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangle size={18} color="#b45309" style={{ flexShrink: 0 }} />
              <span>
                <strong>Cảnh báo gỡ cụm thiết bị:</strong> Thiết bị này đang chứa các thiết bị/chi tiết con. Việc tháo dỡ sẽ gỡ toàn bộ cấu trúc nhánh con bên dưới khỏi cây vận hành.
              </span>
            </div>
          ) : null}

          {/* Hàng 2 cột: Kho tiếp nhận & Số lượng */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '14px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap', minHeight: '20px', display: 'flex', alignItems: 'center' }}>
                Kho tiếp nhận <span style={{ color: '#dc2626', marginLeft: '3px' }}>*</span>
              </label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseCode}
                placeholder="— Chọn kho tiếp nhận —"
                searchPlaceholder="Tìm mã hoặc tên kho…"
                emptyText="Không tìm thấy kho phù hợp"
                onChange={(val) => setWarehouse(val)}
                clearable
                style={{ width: '100%' }}
              />
            </div>

            {isAsset ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', minHeight: '20px' }}>
                  <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                    Số lượng tháo dỡ
                  </label>
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#0369a1',
                      fontWeight: 600,
                      background: '#e0f2fe',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    1 cá thể trên cây
                  </span>
                </div>
                <div
                  style={{
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    color: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxSizing: 'border-box',
                  }}
                >
                  <span>1 {unit || 'thiết bị'}</span>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Cố định</span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', minHeight: '20px' }}>
                  <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                    Số lượng {unit ? `(${unit})` : ''} <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  {maxQuantity !== undefined ? (
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#0369a1', whiteSpace: 'nowrap' }}>
                      (Đang lắp: {maxQuantity} {unit ?? ''})
                    </span>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="number"
                    min={unitConfig.min}
                    max={maxQuantity}
                    step={unitConfig.step}
                    style={{
                      flex: 1,
                      height: '38px',
                      padding: '0 12px',
                      borderRadius: '6px',
                      border: over ? '1px solid #ef4444' : '1px solid #cbd5e1',
                      background: '#ffffff',
                      fontSize: '13.5px',
                      color: '#0f172a',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                    required
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                  {maxQuantity !== undefined && Number(quantity) !== maxQuantity ? (
                    <button
                      type="button"
                      style={{
                        height: '38px',
                        padding: '0 10px',
                        fontSize: '12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#f1f5f9',
                        color: '#334155',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        boxSizing: 'border-box',
                      }}
                      onClick={() => setQuantity(String(maxQuantity))}
                      title="Dỡ toàn bộ số lượng đang lắp đặt"
                    >
                      Dỡ hết ({maxQuantity})
                    </button>
                  ) : null}
                </div>
              </div>
            )}
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

          {/* Quy trình liên kết mở Work Order */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
              Quy trình liên kết mở Work Order
            </label>
            <SearchableSelect
              options={procedureOptions}
              value={procedureDefinitionId}
              placeholder={
                procedures.length === 0
                  ? '— Không có quy trình —'
                  : 'Tìm hoặc chọn quy trình mở Work Order (không bắt buộc)…'
              }
              emptyText="Không tìm thấy quy trình phù hợp"
              disabled={procedures.length === 0}
              onChange={(val) => setProcedureDefinitionId(val)}
              clearable
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Tự động khởi tạo Work Order bên module Quy trình khi hoàn tất lệnh tháo dỡ / hoàn kho.
            </span>
          </div>

          {/* Ghi chú */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
              Ghi chú hoàn kho
            </label>
            <input
              style={{
                height: '38px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '13.5px',
                color: '#0f172a',
                outline: 'none',
                boxSizing: 'border-box',
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
