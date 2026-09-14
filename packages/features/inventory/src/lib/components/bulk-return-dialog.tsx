'use client';

import type { Asset, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { AlertTriangle, Trash2, Warehouse as WarehouseIcon, X } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import styles from '../inventory.module.scss';

export interface BulkReturnItemEntry {
  asset: Asset;
  warehouseCode: string;
  note: string;
}

export interface BulkReturnToStockDialogProps {
  assets: readonly Asset[];
  warehouses: readonly Warehouse[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (entries: BulkReturnItemEntry[]) => void;
}

export function BulkReturnToStockDialog({
  assets: initialAssets,
  warehouses,
  busy = false,
  onCancel,
  onConfirm,
}: BulkReturnToStockDialogProps) {
  // Trạng thái danh sách thiết bị trong phiên gỡ hàng loạt
  const [items, setItems] = useState<BulkReturnItemEntry[]>(() => {
    const defaultWh = warehouses.length === 1 ? warehouses[0].code : '';
    return initialAssets.map((asset) => ({
      asset,
      warehouseCode: defaultWh,
      note: '',
    }));
  });

  // Esc key đóng hộp thoại
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  // Áp dụng kho hàng loạt
  const [globalWarehouse, setGlobalWarehouse] = useState<string>(
    warehouses.length === 1 ? warehouses[0].code : '',
  );

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((wh) => ({
        value: wh.code,
        label: `${wh.name} (${wh.code})`,
      })),
    [warehouses],
  );

  const handleApplyGlobalWarehouse = (whCode: string) => {
    setGlobalWarehouse(whCode);
    if (!whCode) return;
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        warehouseCode: whCode,
      })),
    );
  };

  const handleUpdateWarehouse = (assetId: string, warehouseCode: string) => {
    setItems((prev) =>
      prev.map((item) => (item.asset.id === assetId ? { ...item, warehouseCode } : item)),
    );
  };

  const handleUpdateNote = (assetId: string, note: string) => {
    setItems((prev) =>
      prev.map((item) => (item.asset.id === assetId ? { ...item, note } : item)),
    );
  };

  const handleRemoveItem = (assetId: string) => {
    setItems((prev) => prev.filter((item) => item.asset.id !== assetId));
  };

  // Kiểm tra điều kiện hoàn tất: tất cả thiết bị đều phải chọn kho
  const hasMissingWarehouse = items.some((item) => !item.warehouseCode);
  const isValid = items.length > 0 && !hasMissingWarehouse;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || busy) return;
    onConfirm(items);
  };

  return (
    <div className={styles.modalOverlay} onClick={busy ? undefined : onCancel} role="dialog" aria-modal="true">
      <div
        className={`${styles.modalDialog} ${styles.modalDialogWide}`}
        style={{
          maxWidth: '960px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tiêu đề Modal */}
        <div className={styles.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>
              Tháo dỡ / Gỡ thiết bị hàng loạt ({items.length} thiết bị)
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              Tháo dỡ các thiết bị đã chọn khỏi cây tài sản và nhập về các kho tương ứng. Thao tác này sẽ ghi nhận các bút toán nhập kho thực tế.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            title="Đóng hộp thoại (Esc)"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>

        {/* Thanh công cụ áp dụng nhanh kho chung */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '320px' }}>
            <WarehouseIcon size={16} style={{ color: '#475569', flexShrink: 0 }} />
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
              Áp dụng kho chung cho tất cả dòng:
            </span>
            <div style={{ flex: 1, maxWidth: '280px' }}>
              <SearchableSelect
                value={globalWarehouse}
                onChange={handleApplyGlobalWarehouse}
                options={warehouseOptions}
                placeholder="-- Chọn kho áp dụng chung --"
                disabled={busy}
              />
            </div>
          </div>

          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Tổng số: <strong style={{ color: '#0f172a' }}>{items.length}</strong> thiết bị
          </div>
        </div>

        {/* Cảnh báo nếu có thiết bị chưa chọn kho */}
        {hasMissingWarehouse && items.length > 0 ? (
          <div
            style={{
              padding: '8px 20px',
              background: '#fffbeb',
              borderBottom: '1px solid #fef3c7',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: '#b45309',
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>Mỗi thiết bị cần được chỉ định rõ kho tiếp nhận để ghi tăng tồn thực tế.</span>
          </div>
        ) : null}

        {/* Bảng danh sách thiết bị cần gỡ */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(90vh - 240px)', padding: '0 20px' }}>
            {items.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                Đã xoá hết thiết bị khỏi danh sách gỡ. Vui lòng đóng hộp thoại hoặc quay lại bảng chọn thiết bị.
              </div>
            ) : (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12.5px',
                  marginTop: '12px',
                  marginBottom: '16px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: '#f8fafc',
                      borderBottom: '1px solid #e2e8f0',
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: '40px', color: '#64748b' }}>
                      STT
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', width: '240px', color: '#64748b' }}>
                      Thiết bị / Tài sản
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', width: '260px', color: '#64748b' }}>
                      Kho tiếp nhận <span style={{ color: '#ef4444' }}>*</span>
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b' }}>
                      Ghi chú tháo dỡ
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: '50px', color: '#64748b' }}>
                      Xoá
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const isMissing = !item.warehouseCode;
                    return (
                      <tr
                        key={item.asset.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: isMissing ? '#fffdfa' : '#ffffff',
                        }}
                      >
                        <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.asset.name}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>
                              {item.asset.code}
                            </code>
                            {item.asset.serialNumber ? ` · S/N: ${item.asset.serialNumber}` : ''}
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <SearchableSelect
                            value={item.warehouseCode}
                            onChange={(code) => handleUpdateWarehouse(item.asset.id, code)}
                            options={warehouseOptions}
                            placeholder="-- Chọn kho tiếp nhận --"
                            disabled={busy}
                          />
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="text"
                            value={item.note}
                            onChange={(e) => handleUpdateNote(item.asset.id, e.target.value)}
                            placeholder="Nhập ghi chú hoặc lý do tháo dỡ..."
                            disabled={busy}
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              fontSize: '12px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <button
                            type="button"
                            title="Loại bỏ thiết bị này khỏi danh sách gỡ"
                            disabled={busy}
                            onClick={() => handleRemoveItem(item.asset.id)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: '#94a3b8',
                              cursor: busy ? 'not-allowed' : 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              if (!busy) e.currentTarget.style.color = '#ef4444';
                            }}
                            onMouseLeave={(e) => {
                              if (!busy) e.currentTarget.style.color = '#94a3b8';
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Modal Footer */}
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc',
            }}
          >
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              {hasMissingWarehouse && items.length > 0 ? (
                <span style={{ color: '#dc2626', fontWeight: 500 }}>
                  Vui lòng chọn kho tiếp nhận cho toàn bộ {items.length} thiết bị trước khi xác nhận.
                </span>
              ) : items.length > 0 ? (
                <span style={{ color: '#15803d', fontWeight: 500 }}>
                  Đã sẵn sàng tháo dỡ {items.length} thiết bị về các kho tương ứng.
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={onCancel}
                disabled={busy}
                style={{ padding: '7px 14px', fontSize: '12.5px' }}
              >
                Huỷ bỏ
              </button>
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={!isValid || busy}
                style={{
                  padding: '7px 16px',
                  fontSize: '12.5px',
                  background: !isValid || busy ? '#94a3b8' : '#dc2626',
                  borderColor: !isValid || busy ? '#94a3b8' : '#dc2626',
                  color: '#ffffff',
                }}
              >
                {busy ? 'Đang thực hiện...' : `Xác nhận tháo dỡ (${items.length} thiết bị)`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
