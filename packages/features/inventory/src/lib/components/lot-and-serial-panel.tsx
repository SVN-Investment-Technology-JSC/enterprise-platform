'use client';

import type {
  LotStatus,
  LotTracking,
  Material,
  SerialTracking,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building,
  Calendar,
  Clock,
  FileCheck,
  Filter,
  Layers,
  Plus,
  QrCode,
  Search,
  X,
} from 'lucide-react';
import {
  loadLots,
  saveLots,
  loadSerials,
  registerSerials,
  updateSerial,
} from '../inventory-api';
import {
  ASSET_STATUS_LABEL,
  LOT_STATUS_BADGE,
  LOT_STATUS_LABEL,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Kiểu định danh của một đơn vị theo dõi:
 * - 'LOT': Theo Lô / Mẻ hàng (Batch / Lot / Bịch / Kiện)
 * - 'SERIAL': Theo cá thể đơn chiếc (Serial Number)
 */
export type UnitTrackingKind = 'LOT' | 'SERIAL';

export function LotAndSerialPanel({
  material,
  warehouses = [],
  statuses = [],
  usageStates = [],
  busy,
  defaultView,
}: {
  material: Material;
  warehouses?: readonly Warehouse[];
  /** Danh mục tình trạng sê-ri */
  statuses?: readonly string[];
  /** Danh mục vị trí sử dụng */
  usageStates?: readonly string[];
  busy?: boolean;
  defaultView?: 'all' | 'lots' | 'serials';
}) {
  const [filterView, setFilterView] = useState<'all' | 'lots' | 'serials'>(
    defaultView ?? (material.isSerialized ? 'serials' : 'all'),
  );
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Quản lý Lô (Batch / Lot)
  const [lots, setLots] = useState<LotTracking[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [showAddLotModal, setShowAddLotModal] = useState(false);

  // Form thêm Lô mới
  const [lotNumber, setLotNumber] = useState('');
  const [lotStatus, setLotStatus] = useState<LotStatus>('PASSED');
  const [lotQuantity, setLotQuantity] = useState('50');
  const [lotWarehouse, setLotWarehouse] = useState(warehouses[0]?.code ?? 'WH-CENTRAL');
  const [manufactureDate, setManufactureDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [coCqNumber, setCoCqNumber] = useState('');
  const [lotNote, setLotNote] = useState('');

  // 2. Quản lý Sê-ri (Serial)
  const [serials, setSerials] = useState<SerialTracking[]>([]);
  const [loadingSerials, setLoadingSerials] = useState(false);
  const [serialDraft, setSerialDraft] = useState('');
  const [savingSerial, setSavingSerial] = useState(false);
  const [serialError, setSerialError] = useState<string>();

  // Đồng bộ nạp dữ liệu cả Lô và Sê-ri
  const reloadData = useCallback(async () => {
    setLoadingLots(true);
    setLoadingSerials(true);
    try {
      const [lotsData, serialsData] = await Promise.all([
        loadLots(material.code),
        material.isSerialized ? loadSerials(material.code) : Promise.resolve([]),
      ]);
      setLots(lotsData);
      setSerials(serialsData);
    } finally {
      setLoadingLots(false);
      setLoadingSerials(false);
    }
  }, [material.code, material.isSerialized]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  // Handler tạo Lô mới
  const handleCreateLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lotNumber.trim()) return;

    const newLot: LotTracking = {
      id: `lot-${Date.now()}`,
      materialCode: material.code,
      lotNumber: lotNumber.trim().toUpperCase(),
      status: lotStatus,
      quantity: Number(lotQuantity) || 1,
      unit: material.unit ?? 'Đơn vị',
      warehouseCode: lotWarehouse,
      manufactureDate: manufactureDate || undefined,
      expiryDate: expiryDate || undefined,
      supplier: supplier.trim() || undefined,
      coCqNumber: coCqNumber.trim() || undefined,
      note: lotNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const nextLots = [newLot, ...lots];
    setLots(nextLots);
    await saveLots(material.code, nextLots);

    setLotNumber('');
    setLotNote('');
    setCoCqNumber('');
    setShowAddLotModal(false);
  };

  // Handler cập nhật trạng thái Lô
  const handleUpdateLotStatus = async (lotId: string, newStatus: LotStatus) => {
    const nextLots = lots.map((l) => (l.id === lotId ? { ...l, status: newStatus } : l));
    setLots(nextLots);
    await saveLots(material.code, nextLots);
  };

  // Handler thêm Sê-ri
  const handleAddSerials = async () => {
    const serialNumbers = serialDraft
      .split(/[\n,;]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (serialNumbers.length === 0) return;

    setSavingSerial(true);
    try {
      const res = await registerSerials({ materialCode: material.code, serialNumbers });
      setSerialDraft('');
      setSerialError(
        res.added < serialNumbers.length
          ? `Đã thêm ${res.added}/${serialNumbers.length} — các số còn lại đã trùng lặp.`
          : undefined,
      );
      await reloadData();
    } catch (cause) {
      setSerialError(cause instanceof Error ? cause.message : 'Không khai báo được sê-ri.');
    } finally {
      setSavingSerial(false);
    }
  };

  // Handler cập nhật trạng thái Sê-ri
  const handleUpdateSerial = async (serialNum: string, change: Parameters<typeof updateSerial>[2]) => {
    setSavingSerial(true);
    try {
      await updateSerial(material.code, serialNum, change);
      await reloadData();
    } catch (cause) {
      setSerialError(cause instanceof Error ? cause.message : 'Không lưu được sê-ri.');
    } finally {
      setSavingSerial(false);
    }
  };

  // Lọc tìm kiếm
  const term = searchTerm.trim().toLowerCase();

  const filteredLots = useMemo(() => {
    if (filterView === 'serials') return [];
    if (!term) return lots;
    return lots.filter(
      (l) =>
        l.lotNumber.toLowerCase().includes(term) ||
        (l.coCqNumber ?? '').toLowerCase().includes(term) ||
        (l.warehouseCode ?? '').toLowerCase().includes(term) ||
        (l.supplier ?? '').toLowerCase().includes(term),
    );
  }, [lots, term, filterView]);

  const filteredSerials = useMemo(() => {
    if (filterView === 'lots') return [];
    if (!term) return serials;
    return serials.filter(
      (s) =>
        s.serialNumber.toLowerCase().includes(term) ||
        (s.currentStatus ?? '').toLowerCase().includes(term) ||
        (s.locationType ?? '').toLowerCase().includes(term),
    );
  }, [serials, term, filterView]);

  const totalEntries = lots.length + serials.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 1. Header Toolbar & Bộ lọc gộp chung */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 16px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={16} color="#2563eb" />
          <div>
            <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
              Quản lý Lô &amp; Cá thể Sê-ri ({totalEntries} bản ghi)
            </h4>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Theo dõi tình trạng kiểm định, chất lượng, hạn sử dụng và vị trí từng Lô/Sê-ri.
            </span>
          </div>
        </div>

        {/* Nút thao tác thêm mới */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
            onClick={() => setShowAddLotModal(true)}
            disabled={busy}
            title="Khai báo thêm một Lô / Mẻ hàng mới"
          >
            <Plus size={14} />
            <span>+ Khai báo Lô (Batch)</span>
          </button>
        </div>
      </div>

      {/* 2. Thanh lọc loại hiển thị (Tất cả / Chỉ xem Lô / Chỉ xem Sê-ri) & Ô tìm kiếm */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className={`${styles.drawerTabBtn} ${filterView === 'all' ? styles.drawerTabBtnActive : ''}`}
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
            onClick={() => setFilterView('all')}
          >
            <Filter size={12} />
            <span>Tất cả ({totalEntries})</span>
          </button>
          <button
            type="button"
            className={`${styles.drawerTabBtn} ${filterView === 'lots' ? styles.drawerTabBtnActive : ''}`}
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
            onClick={() => setFilterView('lots')}
          >
            <Layers size={12} />
            <span>Theo Lô hàng ({lots.length})</span>
          </button>
          <button
            type="button"
            className={`${styles.drawerTabBtn} ${filterView === 'serials' ? styles.drawerTabBtnActive : ''}`}
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
            onClick={() => setFilterView('serials')}
          >
            <QrCode size={12} />
            <span>Theo Số Sê-ri ({serials.length})</span>
          </button>
        </div>

        <div style={{ position: 'relative', width: '220px' }}>
          <Search size={14} style={{ position: 'absolute', left: '8px', top: '8px', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Tìm mã Lô hoặc Sê-ri…"
            value={searchTerm}
            style={{
              width: '100%',
              padding: '5px 8px 5px 28px',
              borderRadius: '5px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              outline: 'none',
              background: '#ffffff',
            }}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm ? (
            <button
              type="button"
              style={{
                position: 'absolute',
                right: '6px',
                top: '6px',
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
              }}
              onClick={() => setSearchTerm('')}
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {/* 3. PHẦN DANH SÁCH LÔ HÀNG (BATCH / LOT) */}
      {filterView !== 'serials' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>
              Danh sách Lô hàng ({filteredLots.length} lô)
            </span>
          </div>

          {loadingLots ? (
            <p className={styles.empty}>Đang tải danh sách lô…</p>
          ) : filteredLots.length === 0 ? (
            <div
              style={{
                padding: '12px 14px',
                background: '#ffffff',
                border: '1px dashed #cbd5e1',
                borderRadius: '6px',
                fontSize: '12.5px',
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              Chưa có thông tin Lô hàng cho mã này. Nhấn <strong>+ Khai báo Lô</strong> ở góc trên để tạo mới.
            </div>
          ) : (
            filteredLots.map((lot) => {
              const badge = LOT_STATUS_BADGE[lot.status] ?? {
                bg: '#f1f5f9',
                text: '#475569',
                border: '#cbd5e1',
              };
              return (
                <div
                  key={lot.id}
                  style={{
                    padding: '12px 14px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: '13px',
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
                      <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                        Số lượng: <strong>{lot.quantity}</strong> {lot.unit}
                      </span>
                      <span style={{ fontSize: '11.5px', color: '#64748b' }}>({lot.warehouseCode})</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Tình trạng lô:</span>
                      <select
                        value={lot.status}
                        disabled={busy}
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          background: badge.bg,
                          color: badge.text,
                          border: `1px solid ${badge.border}`,
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                        onChange={(e) => handleUpdateLotStatus(lot.id, e.target.value as LotStatus)}
                      >
                        {Object.entries(LOT_STATUS_LABEL).map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                      gap: '8px',
                      padding: '6px 10px',
                      background: '#f8fafc',
                      borderRadius: '5px',
                      fontSize: '11.5px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Calendar size={12} color="#64748b" />
                      <span>NSX: {lot.manufactureDate || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Clock size={12} color="#b45309" />
                      <span>
                        Hạn dùng:{' '}
                        <strong
                          style={{
                            color:
                              lot.status === 'NEAR_EXPIRY'
                                ? '#b45309'
                                : lot.status === 'EXPIRED'
                                ? '#dc2626'
                                : '#0f172a',
                          }}
                        >
                          {lot.expiryDate || '— (Không hạn)'}
                        </strong>
                      </span>
                    </div>
                    {lot.coCqNumber ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <FileCheck size={12} color="#16a34a" />
                        <span>CO/CQ: <strong>{lot.coCqNumber}</strong></span>
                      </div>
                    ) : null}
                    {lot.supplier ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Building size={12} color="#64748b" />
                        <span>NCC: {lot.supplier}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 4. PHẦN DANH SÁCH CÁ THỂ SÊ-RI (SERIAL NUMBERS) */}
      {filterView !== 'lots' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>
              Danh sách cá thể theo Sê-ri ({filteredSerials.length} cá thể)
            </span>
          </div>

          {serialError ? (
            <p role="alert" className={styles.alert}>
              {serialError}
            </p>
          ) : null}

          {loadingSerials ? (
            <p className={styles.empty}>Đang tải danh sách sê-ri…</p>
          ) : filteredSerials.length > 0 ? (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <table className={styles.serialTable} style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Số sê-ri</th>
                    <th>Tình trạng kỹ thuật</th>
                    <th>Vị trí sử dụng</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSerials.map((row) => (
                    <tr key={row.id}>
                      <td className={styles.code}>{row.serialNumber}</td>
                      <td>
                        <select
                          value={row.currentStatus}
                          disabled={busy || savingSerial}
                          aria-label={`Tình trạng của ${row.serialNumber}`}
                          onChange={(e) =>
                            void handleUpdateSerial(row.serialNumber, { currentStatus: e.target.value })
                          }
                        >
                          {withCurrent(statuses, row.currentStatus).map((st) => (
                            <option key={st} value={st}>
                              {ASSET_STATUS_LABEL[st as keyof typeof ASSET_STATUS_LABEL] ?? st}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={row.locationType}
                          disabled={busy || savingSerial}
                          aria-label={`Vị trí của ${row.serialNumber}`}
                          onChange={(e) =>
                            void handleUpdateSerial(row.serialNumber, { locationType: e.target.value })
                          }
                        >
                          <option value="">— Chưa xác định —</option>
                          {withCurrent(usageStates, row.locationType).map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                padding: '12px 14px',
                background: '#ffffff',
                border: '1px dashed #cbd5e1',
                borderRadius: '6px',
                fontSize: '12.5px',
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              Chưa có số sê-ri nào được khai báo cho mã này.
            </div>
          )}

          {/* Khung dán/khai nhanh số sê-ri */}
          <div className={styles.serialAdd} style={{ marginTop: '6px' }}>
            <textarea
              rows={2}
              value={serialDraft}
              disabled={busy || savingSerial}
              placeholder="Nhập hoặc dán các số sê-ri mới (mỗi số một dòng hoặc ngăn bằng dấu phẩy)…"
              onChange={(e) => setSerialDraft(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || savingSerial || !serialDraft.trim()}
              onClick={() => void handleAddSerials()}
            >
              {savingSerial ? 'Đang lưu…' : '+ Thêm Sê-ri'}
            </button>
          </div>
        </div>
      )}

      {/* Modal Popup Khai báo Lô mới */}
      {showAddLotModal ? (
        <div className={styles.modalOverlay} onClick={() => setShowAddLotModal(false)}>
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
                  Vật tư: <strong>{material.name}</strong> ({material.code})
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowAddLotModal(false)}
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
                    Số lượng ({material.unit ?? 'Đơn vị'}) <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={lotQuantity}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setLotQuantity(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    Kho lưu trữ
                  </label>
                  <select
                    value={lotWarehouse}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setLotWarehouse(e.target.value)}
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
                    value={lotStatus}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                    onChange={(e) => setLotStatus(e.target.value as LotStatus)}
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
                  value={lotNote}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                  onChange={(e) => setLotNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className={styles.modalCancelBtn}
                  onClick={() => setShowAddLotModal(false)}
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

function withCurrent(options: readonly string[], current: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}
