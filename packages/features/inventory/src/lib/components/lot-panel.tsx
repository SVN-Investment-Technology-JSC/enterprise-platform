'use client';

import type { LotStatus, LotTracking, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  Layers,
  Plus,
  Building,
  FileCheck,
  X,
} from 'lucide-react';
import { loadLots, saveLots } from '../inventory-api';
import { LOT_STATUS_BADGE, LOT_STATUS_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

export function LotPanel({
  materialCode,
  materialName,
  unit,
  warehouses = [],
  busy,
}: {
  materialCode: string;
  materialName?: string;
  unit?: string;
  warehouses?: readonly Warehouse[];
  busy?: boolean;
}) {
  const [lots, setLots] = useState<LotTracking[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form khai báo lô mới
  const [lotNumber, setLotNumber] = useState('');
  const [status, setStatus] = useState<LotStatus>('PASSED');
  const [quantity, setQuantity] = useState('50');
  const [warehouseCode, setWarehouseCode] = useState(warehouses[0]?.code ?? 'WH-CENTRAL');
  const [manufactureDate, setManufactureDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [coCqNumber, setCoCqNumber] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadLots(materialCode);
      setLots(data);
    } finally {
      setLoading(false);
    }
  }, [materialCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreateLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lotNumber.trim()) return;

    const newLot: LotTracking = {
      id: `lot-${Date.now()}`,
      materialCode,
      lotNumber: lotNumber.trim().toUpperCase(),
      status,
      quantity: Number(quantity) || 1,
      unit: unit ?? 'Đơn vị',
      warehouseCode,
      manufactureDate: manufactureDate || undefined,
      expiryDate: expiryDate || undefined,
      supplier: supplier.trim() || undefined,
      coCqNumber: coCqNumber.trim() || undefined,
      note: note.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const nextLots = [newLot, ...lots];
    setLots(nextLots);
    await saveLots(materialCode, nextLots);

    // Reset form
    setLotNumber('');
    setNote('');
    setCoCqNumber('');
    setShowAddModal(false);
  };

  const handleUpdateStatus = async (lotId: string, newStatus: LotStatus) => {
    const nextLots = lots.map((lot) =>
      lot.id === lotId ? { ...lot, status: newStatus } : lot,
    );
    setLots(nextLots);
    await saveLots(materialCode, nextLots);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Banner & Nút khai báo Lô mới */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="#2563eb" />
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
              Quản lý danh sách Lô / Mẻ hàng (Batch & Lot Tracking)
            </h4>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
            Theo dõi tình trạng chất lượng, hạn sử dụng (FEFO) và chứng chỉ CO/CQ của từng lô nhập.
          </p>
        </div>

        <button
          type="button"
          className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
          onClick={() => setShowAddModal(true)}
          disabled={busy}
        >
          <Plus size={14} />
          <span>Khai báo Lô mới</span>
        </button>
      </div>

      {/* Bảng dữ liệu các Lô */}
      {loading ? (
        <p className={styles.empty}>Đang tải dữ liệu lô…</p>
      ) : lots.length === 0 ? (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            background: '#ffffff',
            border: '1.5px dashed #cbd5e1',
            borderRadius: '8px',
            color: '#64748b',
          }}
        >
          <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 600, color: '#334155' }}>
            Chưa có thông tin Lô (Batch/Lot) cho vật tư này.
          </p>
          <p style={{ margin: '4px 0 12px', fontSize: '12px' }}>
            Vật tư chưa được chia theo mẻ hoặc được quản lý theo số lượng thông thường.
          </p>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setShowAddModal(true)}
          >
            + Khai báo Lô hàng đầu tiên
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {lots.map((lot) => {
            const badge = LOT_STATUS_BADGE[lot.status] ?? {
              bg: '#f1f5f9',
              text: '#475569',
              border: '#cbd5e1',
            };
            return (
              <div
                key={lot.id}
                style={{
                  padding: '14px 16px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {/* Dòng tiêu đề của Lô */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '13.5px',
                        fontWeight: 700,
                        color: '#1e40af',
                        background: '#eff6ff',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid #bfdbfe',
                      }}
                    >
                      {lot.lotNumber}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                      Số lượng: <strong>{lot.quantity}</strong> {lot.unit}
                    </span>
                  </div>

                  {/* Dropdown chỉnh sửa nhanh Tình trạng của Lô */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Tình trạng:</span>
                    <select
                      value={lot.status}
                      disabled={busy}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: badge.bg,
                        color: badge.text,
                        border: `1px solid ${badge.border}`,
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                      onChange={(e) => handleUpdateStatus(lot.id, e.target.value as LotStatus)}
                    >
                      {Object.entries(LOT_STATUS_LABEL).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Các thông số chi tiết của Lô */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '8px',
                    padding: '8px 10px',
                    background: '#f8fafc',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Building size={13} color="#64748b" />
                    <span>Kho lưu: <strong>{lot.warehouseCode}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={13} color="#64748b" />
                    <span>NSX: {lot.manufactureDate || '—'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={13} color="#b45309" />
                    <span>
                      Hạn dùng:{' '}
                      <strong style={{ color: lot.status === 'NEAR_EXPIRY' ? '#b45309' : lot.status === 'EXPIRED' ? '#dc2626' : '#0f172a' }}>
                        {lot.expiryDate || '— (Không thời hạn)'}
                      </strong>
                    </span>
                  </div>
                  {lot.coCqNumber ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileCheck size={13} color="#16a34a" />
                      <span>CO/CQ: <strong>{lot.coCqNumber}</strong></span>
                    </div>
                  ) : null}
                </div>

                {lot.note ? (
                  <div style={{ fontSize: '12px', color: '#475569', fontStyle: 'italic' }}>
                    Ghi chú: {lot.note}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Popup Khai báo Lô mới */}
      {showAddModal ? (
        <div className={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div
            className={styles.modalDialog}
            style={{
              maxWidth: '520px',
              background: '#ffffff',
              borderRadius: '8px',
              padding: '24px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  Khai báo Lô hàng mới (Batch / Lot)
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  Vật tư: <strong>{materialName ?? materialCode}</strong> ({materialCode})
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateLot} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Mã số Lô (Batch / Lot No) <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="VD: LOT-2026-Q3-01"
                    value={lotNumber}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setLotNumber(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Số lượng {unit ? `(${unit})` : ''} <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Kho lưu trữ
                  </label>
                  <select
                    value={warehouseCode}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setWarehouseCode(e.target.value)}
                  >
                    {warehouses.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Tình trạng kiểm định
                  </label>
                  <select
                    value={status}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setStatus(e.target.value as LotStatus)}
                  >
                    {Object.entries(LOT_STATUS_LABEL).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Ngày sản xuất (MFG)
                  </label>
                  <input
                    type="date"
                    value={manufactureDate}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setManufactureDate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Hạn sử dụng (EXP)
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setExpiryDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Nhà cung cấp / Xuất xứ
                  </label>
                  <input
                    type="text"
                    placeholder="VD: Schneider Electric"
                    value={supplier}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setSupplier(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Số chứng chỉ CO/CQ
                  </label>
                  <input
                    type="text"
                    placeholder="VD: CO-2026/992"
                    value={coCqNumber}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setCoCqNumber(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                  Ghi chú kiểm định
                </label>
                <input
                  type="text"
                  placeholder="Ghi chú thêm về lô hàng…"
                  value={note}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className={styles.modalCancelBtn}
                  onClick={() => setShowAddModal(false)}
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
                  disabled={!lotNumber.trim()}
                >
                  Lưu thông tin Lô
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
