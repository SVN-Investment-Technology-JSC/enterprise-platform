'use client';

import type { StocktakeLotAllocation, StocktakeSerialAllocation } from '@enterprise-platform/contracts-inventory';
import { useState } from 'react';
import { X, Plus, Trash2, Layers, QrCode } from 'lucide-react';

export interface StocktakeLotSerialDrawerProps {
  materialCode: string;
  materialName: string;
  unit: string;
  systemQuantity: number;
  actualQuantity?: number;
  isSerialized?: boolean;
  isLotTracked?: boolean;
  lotAllocations?: readonly StocktakeLotAllocation[];
  serialAllocations?: readonly StocktakeSerialAllocation[];
  readOnly?: boolean;
  onClose: () => void;
  onSave: (data: {
    actualQuantity: number;
    lotAllocations?: StocktakeLotAllocation[];
    serialAllocations?: StocktakeSerialAllocation[];
  }) => void;
}

export function StocktakeLotSerialDrawer({
  materialCode,
  materialName,
  unit,
  systemQuantity,
  actualQuantity,
  isSerialized,
  isLotTracked,
  lotAllocations = [],
  serialAllocations = [],
  readOnly = false,
  onClose,
  onSave,
}: StocktakeLotSerialDrawerProps) {
  // Quản lý tab bên trong drawer nếu vừa theo dõi lô vừa có sê-ri
  const [tab, setTab] = useState<'lots' | 'serials'>(isLotTracked ? 'lots' : 'serials');

  // Local state cho Lô
  const [lots, setLots] = useState<StocktakeLotAllocation[]>(() => {
    if (lotAllocations.length > 0) return [...lotAllocations];
    return [
      {
        lotNumber: 'LOT-2026-Q1',
        systemQty: systemQuantity,
        actualQty: actualQuantity ?? systemQuantity,
        expiryDate: '2027-12-31',
      },
    ];
  });

  // Local state cho Sê-ri
  const [serials, setSerials] = useState<StocktakeSerialAllocation[]>(() => {
    if (serialAllocations.length > 0) return [...serialAllocations];
    // Giả lập danh sách sê-ri từ số tồn sổ sách
    const initialSerials: StocktakeSerialAllocation[] = [];
    const count = Math.min(Math.max(systemQuantity, 1), 10);
    for (let i = 1; i <= count; i++) {
      initialSerials.push({
        serialNumber: `SN-${materialCode}-${String(i).padStart(4, '0')}`,
        status: 'FOUND',
      });
    }
    return initialSerials;
  });

  const [newSerialInput, setNewSerialInput] = useState('');
  const [newLotNumber, setNewLotNumber] = useState('');
  const [newLotQty, setNewLotQty] = useState<number>(0);

  // Tính tổng thực đếm từ Lô hoặc Sê-ri
  const totalLotActual = lots.reduce((sum, l) => sum + (Number(l.actualQty) || 0), 0);
  const totalFoundSerials = serials.filter((s) => s.status === 'FOUND' || s.status === 'EXTRA').length;

  const handleAddLot = () => {
    if (!newLotNumber.trim() || newLotQty <= 0) return;
    setLots((prev) => [
      ...prev,
      {
        lotNumber: newLotNumber.trim().toUpperCase(),
        systemQty: 0,
        actualQty: newLotQty,
      },
    ]);
    setNewLotNumber('');
    setNewLotQty(0);
  };

  const handleAddSerial = () => {
    if (!newSerialInput.trim()) return;
    const sn = newSerialInput.trim().toUpperCase();
    if (serials.some((s) => s.serialNumber === sn)) return;
    setSerials((prev) => [
      ...prev,
      {
        serialNumber: sn,
        status: 'EXTRA', // Quét thêm được ngoài danh sách sổ sách
      },
    ]);
    setNewSerialInput('');
  };

  const handleApply = () => {
    if (isLotTracked) {
      onSave({
        actualQuantity: totalLotActual,
        lotAllocations: lots,
        serialAllocations: isSerialized ? serials : undefined,
      });
    } else if (isSerialized) {
      onSave({
        actualQuantity: totalFoundSerials,
        serialAllocations: serials,
      });
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1050,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: '640px',
          maxWidth: '100vw',
          height: '100%',
          background: '#ffffff',
          boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header Drawer */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: '#e0e7ff',
                  color: '#4338ca',
                }}
              >
                {materialCode}
              </span>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                Đối soát chi tiết {isLotTracked && isSerialized ? 'Lô & Sê-ri' : isLotTracked ? 'Theo Lô hàng' : 'Cá thể Sê-ri'}
              </h3>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {materialName} · Sổ sách: <strong>{systemQuantity} {unit}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Sub-Tabs nếu cả 2 */}
        {isLotTracked && isSerialized ? (
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', padding: '0 20px', background: '#ffffff' }}>
            <button
              type="button"
              onClick={() => setTab('lots')}
              style={{
                padding: '10px 14px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                borderBottom: tab === 'lots' ? '2px solid #2563eb' : '2px solid transparent',
                color: tab === 'lots' ? '#2563eb' : '#64748b',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              Kiểm đếm theo Lô ({lots.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('serials')}
              style={{
                padding: '10px 14px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                borderBottom: tab === 'serials' ? '2px solid #2563eb' : '2px solid transparent',
                color: tab === 'serials' ? '#2563eb' : '#64748b',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              Quét mã Sê-ri ({serials.length})
            </button>
          </div>
        ) : null}

        {/* Drawer Body Scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* TAB LÔ */}
          {tab === 'lots' && isLotTracked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '6px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: '#166534' }}>Tổng thực đếm các Lô:</span>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#15803d' }}>
                    {totalLotActual} {unit}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '12px', color: '#166534' }}>Chênh lệch sổ sách:</span>
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 700,
                      color: totalLotActual === systemQuantity ? '#15803d' : totalLotActual > systemQuantity ? '#2563eb' : '#dc2626',
                    }}
                  >
                    {totalLotActual - systemQuantity > 0 ? `+${totalLotActual - systemQuantity}` : totalLotActual - systemQuantity} {unit}
                  </div>
                </div>
              </div>

              {!readOnly ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    padding: '10px',
                    background: '#f8fafc',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Mã số Lô mới..."
                    value={newLotNumber}
                    onChange={(e) => setNewLotNumber(e.target.value)}
                    style={{
                      flex: 2,
                      padding: '6px 10px',
                      fontSize: '12.5px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                    }}
                  />
                  <input
                    type="number"
                    placeholder="SL thực đếm"
                    value={newLotQty || ''}
                    onChange={(e) => setNewLotQty(Number(e.target.value) || 0)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: '12.5px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddLot}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={14} /> Thêm Lô
                  </button>
                </div>
              ) : null}

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px' }}>Số Lô</th>
                    <th style={{ textAlign: 'center', padding: '8px' }}>Tồn sổ</th>
                    <th style={{ textAlign: 'center', padding: '8px' }}>Thực đếm</th>
                    <th style={{ textAlign: 'center', padding: '8px' }}>Lệch</th>
                    {!readOnly ? <th style={{ textAlign: 'right', padding: '8px 10px' }}>Thao tác</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot, idx) => {
                    const diff = (Number(lot.actualQty) || 0) - (Number(lot.systemQty) || 0);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1e293b' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Layers size={13} color="#64748b" />
                            {lot.lotNumber}
                          </div>
                          {lot.expiryDate ? (
                            <span style={{ fontSize: '10.5px', color: '#64748b' }}>HSD: {lot.expiryDate}</span>
                          ) : null}
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px', color: '#475569' }}>
                          {lot.systemQty}
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>
                          {readOnly ? (
                            <strong>{lot.actualQty}</strong>
                          ) : (
                            <input
                              type="number"
                              value={lot.actualQty}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setLots((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, actualQty: val } : item)),
                                );
                              }}
                              style={{
                                width: '70px',
                                textAlign: 'center',
                                padding: '4px 6px',
                                fontSize: '12px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                fontWeight: 700,
                              }}
                            />
                          )}
                        </td>
                        <td
                          style={{
                            textAlign: 'center',
                            padding: '8px',
                            fontWeight: 700,
                            color: diff === 0 ? '#16a34a' : diff > 0 ? '#2563eb' : '#dc2626',
                          }}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </td>
                        {!readOnly ? (
                          <td style={{ textAlign: 'right', padding: '8px 10px' }}>
                            <button
                              type="button"
                              onClick={() => setLots((prev) => prev.filter((_, i) => i !== idx))}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                padding: '4px',
                              }}
                              title="Xóa dòng lô này"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* TAB SÊ-RI */}
          {(tab === 'serials' || !isLotTracked) && isSerialized ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '6px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Tổng sê-ri xác nhận có mặt:</span>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb' }}>
                    {totalFoundSerials} / {serials.length} chiếc
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>So với sổ sách:</span>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      color: totalFoundSerials === systemQuantity ? '#15803d' : '#dc2626',
                    }}
                  >
                    {totalFoundSerials === systemQuantity ? 'Đủ 100%' : `Lệch ${totalFoundSerials - systemQuantity} chiếc`}
                  </div>
                </div>
              </div>

              {!readOnly ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    padding: '10px',
                    background: '#f0fdf4',
                    borderRadius: '6px',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Quét mã vạch hoặc gõ số Sê-ri..."
                    value={newSerialInput}
                    onChange={(e) => setNewSerialInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSerial();
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: '12.5px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddSerial}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: '#16a34a',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <QrCode size={14} /> Quét / Thêm
                  </button>
                </div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {serials.map((serial, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                      background: serial.status === 'FOUND' ? '#ffffff' : serial.status === 'EXTRA' ? '#eff6ff' : '#fef2f2',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12.5px', color: '#1e293b' }}>
                        {serial.serialNumber}
                      </span>
                      {serial.status === 'EXTRA' ? (
                        <span style={{ fontSize: '10.5px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          Phát hiện thừa
                        </span>
                      ) : serial.status === 'MISSING' ? (
                        <span style={{ fontSize: '10.5px', background: '#fee2e2', color: '#b91c1c', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          Không tìm thấy
                        </span>
                      ) : (
                        <span style={{ fontSize: '10.5px', background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          Khớp sổ sách
                        </span>
                      )}
                    </div>

                    {!readOnly ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSerials((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, status: item.status === 'FOUND' ? 'MISSING' : 'FOUND' } : item,
                              ),
                            );
                          }}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            cursor: 'pointer',
                          }}
                        >
                          {serial.status === 'FOUND' ? 'Báo mất' : 'Đã tìm thấy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSerials((prev) => prev.filter((_, i) => i !== idx))}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#94a3b8',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            background: '#ffffff',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'transparent',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              color: '#475569',
              cursor: 'pointer',
            }}
          >
            Đóng
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={handleApply}
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 700,
                background: '#2563eb',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              Áp dụng số thực đếm ({isLotTracked ? totalLotActual : totalFoundSerials} {unit})
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
