'use client';

import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import type { InventoryWorkspace, ProcedureRequisition } from '../inventory-api';
import { issueStock, receiveStock } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

export interface BatchItemState {
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  warehouseCode: string;
}

export function BatchRequisitionModal({
  req,
  workspace,
  busy = false,
  onClose,
  onSuccess,
}: {
  req: ProcedureRequisition;
  workspace: InventoryWorkspace;
  busy?: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const isPurchase = req.kind === 'purchase';
  const defaultWarehouse = workspace.warehouses[0]?.code ?? '';

  // Khởi tạo trạng thái cho từng dòng vật tư
  const [items, setItems] = useState<BatchItemState[]>(() => {
    return req.lines.map((line) => {
      // Tìm kho mặc định có sẵn tồn kho khả dụng cho vật tư này (nếu xuất)
      let initialWh = defaultWarehouse;
      if (!isPurchase) {
        const whWithStock = workspace.stock.find(
          (s) => s.materialCode === line.materialCode && s.quantity >= line.quantity,
        ) || workspace.stock.find(
          (s) => s.materialCode === line.materialCode && s.quantity > 0,
        );
        if (whWithStock?.warehouseCode) {
          initialWh = whWithStock.warehouseCode;
        }
      }
      return {
        materialCode: line.materialCode,
        materialName: line.materialName || line.materialCode,
        quantity: line.quantity,
        unit: line.unit || '',
        warehouseCode: initialWh,
      };
    });
  });

  const [note, setNote] = useState<string>(
    `Xuất toàn bộ ${req.lines.length} vật tư theo bảng kê ${req.csvFileName} cho hồ sơ ${req.code}${
      req.assetCode ? ` (Thiết bị: ${req.assetCode})` : ''
    }`,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cập nhật từng dòng
  const handleItemChange = (index: number, patch: Partial<BatchItemState>) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  // Kiểm tra tồn kho cho từng dòng
  const itemValidations = items.map((item) => {
    if (isPurchase) {
      return { valid: item.quantity > 0 && !!item.warehouseCode, onHand: 0, available: 0, overdraw: false };
    }
    const stockRow = workspace.stock.find(
      (s) => s.materialCode === item.materialCode && s.warehouseCode === item.warehouseCode,
    );
    const onHand = stockRow?.quantity ?? 0;
    const available = stockRow?.available ?? 0;
    const overdraw = item.quantity > onHand;
    const valid = item.quantity > 0 && !!item.warehouseCode && !overdraw;
    return { valid, onHand, available, overdraw };
  });

  const hasInvalid = itemValidations.some((v) => !v.valid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasInvalid || submitting || busy) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const results: string[] = [];
      for (const item of items) {
        const itemNote = `${note} [Vật tư ${item.materialCode} × ${item.quantity}]`;
        if (isPurchase) {
          const res = await receiveStock({
            warehouseCode: item.warehouseCode,
            materialCode: item.materialCode,
            quantity: item.quantity,
            note: itemNote,
          });
          results.push(res.transactionCode);
        } else {
          const res = await issueStock({
            warehouseCode: item.warehouseCode,
            materialCode: item.materialCode,
            quantity: item.quantity,
            note: itemNote,
          });
          results.push(res.transactionCode);
        }
      }

      onSuccess(
        `Đã ${isPurchase ? 'nhập' : 'xuất'} thành công toàn bộ ${items.length} vật tư theo bảng kê ${
          req.csvFileName
        } (${results.join(', ')}).`,
      );
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Có lỗi xảy ra khi thực hiện xuất kho hàng loạt.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalDialog}
        style={{
          maxWidth: '820px',
          width: '95vw',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={styles.modalHead}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                padding: '8px',
                borderRadius: '8px',
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Layers size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                {isPurchase ? 'Lập phiếu mua sắm hàng loạt' : 'Xuất kho theo bảng kê'} ({req.lines.length} vật tư)
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                Hồ sơ <strong>{req.code}</strong> • Bảng kê: <code>{req.csvFileName}</code>
                {req.assetCode ? ` • Thiết bị: ${req.assetCode}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            title="Đóng (ESC)"
            aria-label="Đóng"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Modal Body */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
        >
          <div
            className={styles.modalBody}
            style={{
              padding: '16px 20px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {errorMessage ? (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            {/* Bảng danh sách vật tư */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12.5px',
                  background: '#ffffff',
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', width: '35px' }}>
                      STT
                    </th>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>Vật tư</th>
                    <th
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid #e2e8f0',
                        width: '120px',
                        textAlign: 'right',
                      }}
                    >
                      Số lượng xuất
                    </th>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', width: '220px' }}>
                      Kho chỉ định
                    </th>
                    {!isPurchase ? (
                      <th
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #e2e8f0',
                          width: '160px',
                          textAlign: 'right',
                        }}
                      >
                        Tồn kho / Khả dụng
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const val = itemValidations[idx];
                    return (
                      <tr
                        key={`${item.materialCode}-${idx}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: val.overdraw ? '#fff1f2' : idx % 2 === 1 ? '#fafafa' : '#ffffff',
                        }}
                      >
                        <td style={{ padding: '8px 12px', color: '#64748b', textAlign: 'center' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#2563eb' }}>{item.materialCode}</div>
                          <div style={{ fontSize: '11.5px', color: '#475569' }}>{item.materialName}</div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                            <input
                              type="number"
                              min={0.01}
                              step="any"
                              value={item.quantity}
                              onChange={(e) =>
                                handleItemChange(idx, { quantity: Number(e.target.value) || 0 })
                              }
                              style={{
                                width: '75px',
                                padding: '5px 8px',
                                borderRadius: '4px',
                                border: val.overdraw ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                textAlign: 'right',
                                fontSize: '12.5px',
                                fontWeight: 700,
                              }}
                            />
                            <span style={{ fontSize: '11.5px', color: '#64748b', minWidth: '25px' }}>
                              {item.unit}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <select
                            value={item.warehouseCode}
                            onChange={(e) => handleItemChange(idx, { warehouseCode: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '5px 8px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              fontSize: '12px',
                              background: '#ffffff',
                            }}
                          >
                            {workspace.warehouses.map((w) => (
                              <option key={w.id} value={w.code}>
                                {w.name} ({w.code})
                              </option>
                            ))}
                          </select>
                        </td>
                        {!isPurchase ? (
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <div
                              style={{
                                fontWeight: 600,
                                color: val.overdraw ? '#dc2626' : '#1e293b',
                                fontSize: '12px',
                              }}
                            >
                              Tồn: {formatNumber(val.onHand)} {item.unit}
                            </div>
                            <div style={{ fontSize: '11px', color: val.overdraw ? '#ef4444' : '#64748b' }}>
                              {val.overdraw ? 'Thiếu hàng trong kho!' : `Khả dụng: ${formatNumber(val.available)}`}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Ghi chú chứng từ chung */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Ghi chú chứng từ xuất / tham chiếu quy trình:
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className={styles.modalFoot}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b' }}>
              <CheckCircle2 size={15} color="#16a34a" />
              <span>
                Sẽ ghi đồng thời <strong>{items.length} bút toán giao dịch kho</strong> vào sổ cái.
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                onClick={onClose}
                disabled={submitting}
              >
                Huỷ
              </button>
              <button
                type="submit"
                className={`${styles.action} ${styles.actionPrimary}`}
                disabled={hasInvalid || submitting || busy}
                style={{ minWidth: '160px' }}
              >
                {submitting
                  ? 'Đang ghi sổ giao dịch…'
                  : `Xác nhận xuất ${items.length} vật tư`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
