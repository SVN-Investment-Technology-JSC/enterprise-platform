'use client';

import type {
  Asset,
  InstallItemRequest,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import styles from '../inventory.module.scss';

/**
 * Lắp vật tư từ kho vào một thiết bị.
 *
 * Đây là một lệnh XUẤT, nên phải biết xuất từ kho nào và bao nhiêu. Mã vật tư
 * không rời khỏi danh mục: lắp 1 mét cáp thì kho còn 2999 mét, vì mét là đơn vị
 * tính chứ không phải một khối cố định.
 *
 * Tồn hiện theo ĐÚNG kho đang chọn, không phải tổng mọi kho. Tổng thì luôn nhìn
 * có vẻ đủ, còn thứ quyết định lệnh xuất có đi được hay không là số nằm trong
 * kho cụ thể đó.
 */
export function InstallMaterialDialog({
  parent,
  materials,
  warehouses,
  stock,
  busy,
  onCancel,
  onConfirm,
}: {
  parent: Asset;
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  stock: readonly MaterialInventory[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (code: string, input: InstallItemRequest) => void;
}) {
  const [materialCode, setMaterial] = useState('');
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  /** Tồn khả dụng theo cặp (mã vật tư, mã kho). */
  const onHand = useMemo(() => {
    const materialById = new Map(materials.map((item) => [item.id, item.code]));
    const warehouseById = new Map(warehouses.map((item) => [item.id, item.code]));
    const map = new Map<string, number>();
    for (const row of stock) {
      const code = materialById.get(row.materialId);
      const warehouse = warehouseById.get(row.warehouseId);
      if (!code || !warehouse) continue;
      const key = `${code}@${warehouse}`;
      map.set(key, (map.get(key) ?? 0) + row.available);
    }
    return map;
  }, [materials, warehouses, stock]);

  const picked = materials.find((item) => item.code === materialCode);

  /** Danh sách kho khả dụng (tồn khả dụng > 0 đối với vật tư đã chọn) */
  const availableWarehouses = useMemo(() => {
    if (!materialCode) return warehouses;
    return warehouses
      .map((w) => ({
        ...w,
        availableStock: onHand.get(`${materialCode}@${w.code}`) ?? 0,
      }))
      .filter((w) => w.availableStock > 0);
  }, [warehouses, materialCode, onHand]);

  const available =
    materialCode && warehouseCode ? (onHand.get(`${materialCode}@${warehouseCode}`) ?? 0) : undefined;

  const handleSelectMaterial = (code: string) => {
    setMaterial(code);
    if (!code) {
      setWarehouse('');
      return;
    }
    // Tự động chọn kho đầu tiên còn hàng khả dụng
    const validWh = warehouses
      .map((w) => ({ code: w.code, stock: onHand.get(`${code}@${w.code}`) ?? 0 }))
      .filter((w) => w.stock > 0);
    if (validWh.length > 0) {
      setWarehouse(validWh[0].code);
    } else {
      setWarehouse('');
    }
  };

  const amount = Number(quantity);
  const valid = Number.isFinite(amount) && amount > 0;
  const short = available !== undefined && valid && amount > available;
  const ready = materialCode !== '' && warehouseCode !== '' && valid && !short;

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '580px',
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
              Lắp vật tư vào thiết bị
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13.5px',
                color: '#666666',
                lineHeight: 1.4,
              }}
            >
              Xuất vật tư từ kho và lắp ráp trực tiếp vào cụm <strong>{parent.name}</strong> ({parent.code}).
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
            onConfirm(materialCode, {
              parentCode: parent.code,
              warehouseCode,
              quantity: amount,
              note: note.trim() || undefined,
            });
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          {/* Thiết bị đích nhận lắp đặt */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
              Vị trí thiết bị tiếp nhận
            </label>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                background: '#ffffff',
                border: '1px solid #e0e0e0',
                fontSize: '13.5px',
                color: '#1e293b',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⚙️</span>
              <span>
                <strong>{parent.name}</strong> <code style={{ color: '#2563eb' }}>({parent.code})</code>
              </span>
            </div>
          </div>

          {/* Chọn Vật tư từ kho */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
              Vật tư cần lắp <span style={{ color: '#dc2626' }}>*</span>
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
              value={materialCode}
              required
              onChange={(event) => handleSelectMaterial(event.target.value)}
            >
              <option value="">— Chọn vật tư trong danh mục kho —</option>
              {materials.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} ({item.code}) · ĐVT: {item.unit}
                </option>
              ))}
            </select>
          </div>

          {/* Hàng 2 cột: Kho xuất & Số lượng */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                Xuất từ kho <span style={{ color: '#dc2626' }}>*</span>
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
                <option value="">
                  {availableWarehouses.length === 0 && materialCode
                    ? '— Hết hàng ở tất cả các kho —'
                    : '— Chọn kho xuất —'}
                </option>
                {availableWarehouses.map((warehouse) => (
                  <option key={warehouse.code} value={warehouse.code}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', minHeight: '20px' }}>
                <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                  Số lượng {picked?.unit ? `(${picked.unit})` : ''} <span style={{ color: '#dc2626' }}>*</span>
                </label>
                {available !== undefined ? (
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: short ? '#dc2626' : '#166534',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    (Khả dụng: {available} {picked?.unit ?? ''})
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
                  border: short ? '1px solid #ef4444' : '1px solid #e0e0e0',
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

          {/* Cảnh báo thiếu tồn (Chỉ hiện khi vượt quá khả dụng) */}
          {short ? (
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
              <span>⚠️</span>
              <span>
                Kho <strong>{warehouseCode}</strong> chỉ còn khả dụng <strong>{available} {picked?.unit ?? ''}</strong> (Không đủ xuất {amount} {picked?.unit ?? ''}).
              </span>
            </div>
          ) : null}

          {/* Ghi chú */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
              Ghi chú lắp đặt
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
              placeholder="VD: Lắp vào ngăn xuất tuyến 110kV, bảo dưỡng thay mới định kỳ…"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {/* Footer Actions theo đúng Spacing và Màu sắc chuẩn */}
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
                background: busy || !ready ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: busy || !ready ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              disabled={busy || !ready}
            >
              {busy ? 'Đang xuất kho…' : 'Xác nhận xuất kho & lắp'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
