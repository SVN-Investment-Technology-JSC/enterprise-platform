'use client';

import type {
  Asset,
  InstallItemRequest,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { getUnitQuantityConfig } from '../inventory-labels';
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
  /** Node cha tiếp nhận. Bỏ trống nếu lắp làm Cụm/Thiết bị gốc trên cây (Root Asset). */
  parent?: Asset;
  materials: readonly Material[];
  warehouses: readonly Warehouse[];
  stock: readonly MaterialInventory[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (code: string, input: InstallItemRequest) => void;
}) {
  const [materialCode, setMaterial] = useState('');
  const [materialSearchTerm, setMaterialSearchTerm] = useState('');
  const [warehouseCode, setWarehouse] = useState(
    warehouses.length === 1 ? warehouses[0].code : '',
  );
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /** Lọc vật tư theo từ khoá nhập (mã hoặc tên) */
  const filteredMaterials = useMemo(() => {
    const term = materialSearchTerm.trim().toLowerCase();
    if (!term) return materials;
    return materials.filter(
      (item) =>
        item.code.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term) ||
        (item.unit ?? '').toLowerCase().includes(term),
    );
  }, [materials, materialSearchTerm]);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
  const unitConfig = getUnitQuantityConfig(picked?.unit);

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

  const warehouseOptions = useMemo(() => {
    return availableWarehouses.map((w) => {
      const stockQty = 'availableStock' in w ? (w.availableStock as number) : undefined;
      return {
        value: w.code,
        label: w.name,
        badge: w.code,
        description:
          stockQty !== undefined
            ? `Tồn khả dụng: ${stockQty} ${picked?.unit ?? ''}`
            : undefined,
      };
    });
  }, [availableWarehouses, picked?.unit]);

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
              {parent ? 'Lắp vật tư vào thiết bị' : 'Xuất kho thiết bị / Cụm gốc'}
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13.5px',
                color: '#666666',
                lineHeight: 1.4,
              }}
            >
              {parent ? (
                <>Xuất vật tư từ kho và lắp ráp trực tiếp vào cụm <strong>{parent.name}</strong> ({parent.code}).</>
              ) : (
                <>Xuất vật tư/thiết bị từ kho và đưa lên làm <strong>Thiết bị / Cụm gốc cấp cao nhất</strong> trên cây tài sản.</>
              )}
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
              parentCode: parent?.code,
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
              Vị trí tiếp nhận trên cây
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
              {parent ? (
                <span>
                  <strong>{parent.name}</strong> <code style={{ color: '#2563eb' }}>({parent.code})</code>
                </span>
              ) : (
                <span style={{ color: '#047857', fontWeight: 600 }}>
                  Là Thiết bị / Cụm gốc (Root Node - Cấp cao nhất)
                </span>
              )}
            </div>
          </div>

          {/* Chọn Vật tư từ kho — Searchable Combobox (Input & Dropdown kết hợp chung 1 element) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }} ref={dropdownRef}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333' }}>
                Vật tư cần lắp <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {filteredMaterials.length} / {materials.length} vật tư
              </span>
            </div>

            {/* Khung Combobox duy nhất kết hợp Input tìm kiếm và Dropdown lựa chọn */}
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#ffffff',
                  border: isDropdownOpen ? '1px solid #2563eb' : '1px solid #cbd5e1',
                  borderRadius: '6px',
                  boxShadow: isDropdownOpen ? '0 0 0 2px rgba(37,99,235,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                  padding: '2px 8px 2px 10px',
                }}
              >
                <Search size={15} style={{ color: '#94a3b8', marginRight: '6px', flexShrink: 0 }} />
                <input
                  type="text"
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: '13.5px',
                    color: '#1e293b',
                    padding: '6px 0',
                  }}
                  placeholder={picked ? `${picked.name} (${picked.code})` : 'Gõ mã hoặc tên vật tư để tìm & chọn…'}
                  value={materialSearchTerm}
                  onFocus={() => setIsDropdownOpen(true)}
                  onChange={(e) => {
                    setMaterialSearchTerm(e.target.value);
                    if (!isDropdownOpen) setIsDropdownOpen(true);
                  }}
                />
                {materialSearchTerm || materialCode ? (
                  <button
                    type="button"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onClick={() => {
                      setMaterialSearchTerm('');
                      handleSelectMaterial('');
                    }}
                  >
                    <X size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#64748b',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                >
                  <ChevronDown
                    size={16}
                    style={{
                      transform: isDropdownOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>

              {/* Danh sách dropdown kết quả thả xuống */}
              {isDropdownOpen ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    maxHeight: '220px',
                    overflowY: 'auto',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    zIndex: 50,
                  }}
                >
                  {filteredMaterials.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: '13px', color: '#94a3b8', textAlign: 'center' }}>
                      Không tìm thấy vật tư khớp với từ khóa
                    </div>
                  ) : (
                    filteredMaterials.map((item) => {
                      const isSelected = item.code === materialCode;
                      return (
                        <div
                          key={item.code}
                          style={{
                            padding: '8px 12px',
                            fontSize: '13px',
                            cursor: 'pointer',
                            background: isSelected ? '#eff6ff' : '#ffffff',
                            color: isSelected ? '#1d4ed8' : '#1e293b',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderBottom: '1px solid #f1f5f9',
                            transition: 'background 0.1s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#ffffff';
                          }}
                          onClick={() => {
                            handleSelectMaterial(item.code);
                            setMaterialSearchTerm(`${item.name} (${item.code})`);
                            setIsDropdownOpen(false);
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600 }}>{item.name}</span>
                            <span style={{ marginLeft: '6px', color: '#2563eb', fontSize: '12px' }}>
                              ({item.code})
                            </span>
                          </div>
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>ĐVT: {item.unit}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>

            {/* Input ẩn để đảm bảo form validation HTML5 required */}
            <input
              type="text"
              required
              value={materialCode}
              onChange={() => undefined}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
            />
          </div>

          {/* Hàng 2 cột: Kho xuất & Số lượng */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#333333', whiteSpace: 'nowrap' }}>
                Xuất từ kho <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseCode}
                placeholder={
                  availableWarehouses.length === 0 && materialCode
                    ? '— Hết hàng ở tất cả các kho —'
                    : 'Tìm mã hoặc tên kho xuất…'
                }
                emptyText="Không tìm thấy kho phù hợp"
                disabled={availableWarehouses.length === 0}
                onChange={(val) => setWarehouse(val)}
                clearable
                style={{ width: '100%' }}
              />
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
                min={unitConfig.min}
                step={unitConfig.step}
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
              <span></span>
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
