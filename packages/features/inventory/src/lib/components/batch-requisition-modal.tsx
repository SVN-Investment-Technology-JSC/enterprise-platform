'use client';

import { useState, useMemo } from 'react';
import { X, CheckCircle2, AlertTriangle, Layers, PackageCheck } from 'lucide-react';
import type { InventoryWorkspace, ProcedureRequisition } from '../inventory-api';
import { issueStock, installItem, markRequisitionFulfilled } from '../inventory-api';
import { formatNumber, getUnitQuantityConfig } from '../inventory-labels';
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
  onSuccess: (message: string, reqCode?: string) => void;
}) {
  const defaultWarehouse = workspace.warehouses[0]?.code ?? '';
  const initialAssetCode = req.assetCode || '';
  const [isAssignToAsset, setIsAssignToAsset] = useState<boolean>(true);
  const [selectedAssetCode, setSelectedAssetCode] = useState<string>(initialAssetCode);

  /**
   * Tính toán tình trạng đáp ứng 3 màu cho toàn phiếu:
   * 1. singleCount (Xanh): có 1 kho đơn lẻ đủ xuất ngay toàn bộ.
   * 2. transferCount (Vàng): tổng tồn các kho gộp lại đủ, nhưng cần gom/chuyển kho.
   * 3. shortageCount (Đỏ): tổng tồn toàn hệ thống không đủ (thiếu hàng, cần mua bổ sung).
   */
  const stockSummary = useMemo(() => {
    let singleCount = 0;
    let transferCount = 0;
    let shortageCount = 0;

    for (const line of req.lines) {
      const matchingStocks = workspace.stock.filter((s) => s.materialCode === line.materialCode);
      const totalAvail = matchingStocks.reduce((sum, s) => sum + s.available, 0);
      const singleWh = matchingStocks.some((s) => s.available >= line.quantity);

      if (totalAvail >= line.quantity) {
        if (singleWh) singleCount++;
        else transferCount++;
      } else {
        shortageCount++;
      }
    }

    return {
      singleCount,
      transferCount,
      shortageCount,
      totalLines: req.lines.length,
      allReady: singleCount === req.lines.length && req.lines.length > 0,
    };
  }, [req.lines, workspace.stock]);

  // Khởi tạo danh sách vật tư kèm kho xuất tối ưu nhất
  const [items, setItems] = useState<BatchItemState[]>(() => {
    return req.lines.map((line) => {
      // Ưu tiên chọn kho có tồn khả dụng >= số lượng yêu cầu
      let initialWh = defaultWarehouse;
      const whWithEnoughStock = workspace.stock.find(
        (s) => s.materialCode === line.materialCode && s.available >= line.quantity,
      );
      const whWithAnyStock = workspace.stock.find(
        (s) => s.materialCode === line.materialCode && s.available > 0,
      );

      if (whWithEnoughStock?.warehouseCode) {
        initialWh = whWithEnoughStock.warehouseCode;
      } else if (whWithAnyStock?.warehouseCode) {
        initialWh = whWithAnyStock.warehouseCode;
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
    `Xuất cấp phát vật tư theo bảng kê ${req.csvFileName} cho hồ sơ ${req.code}${
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

  // Kiểm tra tồn kho và phân loại 3 màu cho từng dòng
  const itemStatuses = useMemo(() => {
    return items.map((item) => {
      const matchingStocks = workspace.stock.filter((s) => s.materialCode === item.materialCode);
      const totalAvail = matchingStocks.reduce((sum, s) => sum + s.available, 0);

      const stockRow = matchingStocks.find((s) => s.warehouseCode === item.warehouseCode);
      const onHand = stockRow?.quantity ?? 0;
      const available = stockRow?.available ?? 0;

      let tier: 'single_ready' | 'transfer_needed' | 'shortage' = 'shortage';
      if (totalAvail >= item.quantity) {
        tier = available >= item.quantity ? 'single_ready' : 'transfer_needed';
      } else {
        tier = 'shortage';
      }

      const overdraw = item.quantity > onHand;
      const valid = item.quantity >= 0 && !!item.warehouseCode && !overdraw;

      return { valid, onHand, available, totalAvail, overdraw, tier };
    });
  }, [items, workspace.stock]);

  const hasInvalid = itemStatuses.some((v) => !v.valid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasInvalid || submitting || busy) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const results: string[] = [];
      const targetAsset = req.assetCode || selectedAssetCode;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.quantity <= 0) continue; // Bỏ qua nếu người dùng đặt = 0

        const itemNote = `${note} [Vật tư ${item.materialCode} × ${item.quantity} ${item.unit}]`;
        if (targetAsset && isAssignToAsset) {
          // Xuất cho bảo trì/thay thế thiết bị: gọi installItem để liên kết cây tài sản và cộng vào 'Đang sử dụng'
          const res = await installItem(item.materialCode, {
            warehouseCode: item.warehouseCode,
            parentCode: targetAsset,
            quantity: item.quantity,
            note: itemNote,
          });
          results.push(`${item.materialCode}: ${res.transactionCode}`);
        } else {
          // Xuất tiêu hao
          const res = await issueStock({
            warehouseCode: item.warehouseCode,
            materialCode: item.materialCode,
            quantity: item.quantity,
            note: itemNote,
          });
          results.push(`${item.materialCode}: ${res.transactionCode}`);
        }
      }

      markRequisitionFulfilled(req.code);
      if (req.id && req.id !== req.code) {
        try {
          const csrfToken =
            document.cookie.split('; ').find((p) => p.startsWith('ep_csrf='))?.split('=')[1] ?? '';
          void fetch(`/api/procedure/v1/instances/${encodeURIComponent(req.id)}/comments`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify({
              comment: `[Thủ kho] Đã xuất kho thành công cấp phát theo phiếu yêu cầu ${req.code} (chứng từ: ${results.join(', ')}).`,
            }),
          }).catch((err) => {
            void err;
          });
        } catch {
          // Bỏ qua nếu không thể gửi comment về quy trình
        }
      }

      onSuccess(
        `Đã xuất kho thành công cấp phát vật tư theo phiếu yêu cầu ${req.code} (${results.join(', ')}).`,
        req.code,
      );
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Có lỗi xảy ra khi thực hiện xuất kho theo phiếu yêu cầu.',
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
          maxWidth: '850px',
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
                Xử lý Phiếu yêu cầu cấp phát vật tư ({req.lines.length} hạng mục)
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                Hồ sơ <strong>{req.code}</strong> • Bảng kê: <code>{req.csvFileName}</code>
                {req.assetCode ? ` • Thiết bị nhận: ${req.assetCode}` : ''}
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

            {/* BANNER 3 MÀU TỔNG QUAN TÌNH TRẠNG ĐÁP ỨNG CỦA PHIẾU YÊU CẦU */}
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                background: stockSummary.allReady ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${stockSummary.allReady ? '#86efac' : '#e2e8f0'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '14px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <PackageCheck
                  size={22}
                  style={{ color: stockSummary.allReady ? '#16a34a' : '#2563eb', flexShrink: 0 }}
                />
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '13px',
                      color: stockSummary.allReady ? '#15803d' : '#0f172a',
                    }}
                  >
                    {stockSummary.allReady
                      ? 'Kho đã có đủ hàng sẵn sàng xuất cho toàn bộ danh sách!'
                      : 'Tình trạng đáp ứng tồn kho của Phiếu yêu cầu:'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Thủ kho kiểm tra kho xuất và xác nhận cấp phát cho quy trình bảo dưỡng.
                  </div>
                </div>
              </div>

              {/* 3 Huy hiệu màu trạng thái */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {stockSummary.singleCount > 0 ? (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: '#ecfdf5',
                      color: '#047857',
                      border: '1px solid #a7f3d0',
                    }}
                    title="Vật tư có đủ hàng tại 1 kho đơn lẻ"
                  >
                    ● {stockSummary.singleCount} sẵn sàng
                  </span>
                ) : null}

                {stockSummary.transferCount > 0 ? (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: '#fffbeb',
                      color: '#b45309',
                      border: '1px solid #fde68a',
                    }}
                    title="Vật tư đủ nếu gom hoặc điều chuyển giữa các kho"
                  >
                    ▲ {stockSummary.transferCount} cần gom kho
                  </span>
                ) : null}

                {stockSummary.shortageCount > 0 ? (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: '#fef2f2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                    }}
                    title="Vật tư thiếu trên toàn bộ hệ thống kho"
                  >
                    ✕ {stockSummary.shortageCount} thiếu hàng
                  </span>
                ) : null}
              </div>
            </div>

            {/* Phân loại & Gán thiết bị cho toàn bộ bảng kê xuất bảo dưỡng */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>
                  Phân loại hạch toán & Gán thiết bị bảo trì:
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="batch_purpose"
                    checked={isAssignToAsset}
                    onChange={() => setIsAssignToAsset(true)}
                  />
                  Lắp đặt / Thay thế cho thiết bị <span style={{ color: '#16a34a' }}>(Cộng vào "Đang sử dụng")</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="batch_purpose"
                    checked={!isAssignToAsset}
                    onChange={() => setIsAssignToAsset(false)}
                  />
                  Xuất tiêu hao / tiêu hủy (Trừ hẳn sở hữu)
                </label>
              </div>

              {isAssignToAsset ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                    Thiết bị tiếp nhận:
                  </span>
                  <select
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid #86efac',
                      fontSize: '12.5px',
                      background: '#ffffff',
                      outline: 'none',
                      flex: 1,
                      maxWidth: '380px',
                    }}
                    value={selectedAssetCode}
                    onChange={(e) => setSelectedAssetCode(e.target.value)}
                  >
                    <option value="">— Chọn thiết bị nhận lắp đặt trên Cây tài sản —</option>
                    {workspace.assets.map((asset) => (
                      <option key={asset.id} value={asset.code}>
                        {asset.code} — {asset.name}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '11.5px', color: '#15803d' }}>
                    Các vật tư xuất ra sẽ được tự động cộng vào cột <strong>"Đang sử dụng"</strong>.
                  </span>
                </div>
              ) : null}
            </div>

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
                        width: '125px',
                        textAlign: 'right',
                      }}
                    >
                      Số lượng xuất
                    </th>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', width: '230px' }}>
                      Kho chỉ định xuất
                    </th>
                    <th
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid #e2e8f0',
                        width: '210px',
                        textAlign: 'right',
                      }}
                    >
                      Tồn kho & Trạng thái
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const status = itemStatuses[idx];
                    return (
                      <tr
                        key={`${item.materialCode}-${idx}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: status.overdraw ? '#fff1f2' : idx % 2 === 1 ? '#fafafa' : '#ffffff',
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
                              min={getUnitQuantityConfig(item.unit).min}
                              step={getUnitQuantityConfig(item.unit).step}
                              value={item.quantity}
                              onChange={(e) =>
                                handleItemChange(idx, { quantity: Number(e.target.value) || 0 })
                              }
                              style={{
                                width: '75px',
                                padding: '5px 8px',
                                borderRadius: '4px',
                                border: status.overdraw ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                textAlign: 'right',
                                fontSize: '12.5px',
                                fontWeight: 700,
                              }}
                            />
                            <span style={{ fontSize: '11.5px', color: '#64748b', minWidth: '25px' }}>
                              {item.unit}
                            </span>
                          </div>
                          {status.overdraw && status.onHand > 0 ? (
                            <div style={{ marginTop: '3px' }}>
                              <button
                                type="button"
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#2563eb',
                                  fontSize: '10.5px',
                                  textDecoration: 'underline',
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                                onClick={() => handleItemChange(idx, { quantity: status.onHand })}
                              >
                                Lấy tồn ({status.onHand})
                              </button>
                            </div>
                          ) : null}
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
                            {workspace.warehouses.map((w) => {
                              const wStock = workspace.stock.find(
                                (s) => s.materialCode === item.materialCode && s.warehouseCode === w.code,
                              );
                              const wAvail = wStock?.available ?? 0;
                              return (
                                <option key={w.id} value={w.code}>
                                  {w.name} (khả dụng: {formatNumber(wAvail)})
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {status.tier === 'single_ready' ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '2px 7px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                              }}
                            >
                              ● Sẵn sàng (tồn {formatNumber(status.onHand)})
                            </span>
                          ) : status.tier === 'transfer_needed' ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '2px 7px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: '#fffbeb',
                                color: '#b45309',
                                border: '1px solid #fde68a',
                              }}
                              title={`Kho chọn có ${formatNumber(status.onHand)}, tổng liên kho có ${formatNumber(status.totalAvail)}`}
                            >
                              ▲ Gom kho (kho {formatNumber(status.onHand)} / gom {formatNumber(status.totalAvail)})
                            </span>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '2px 7px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: '#fef2f2',
                                color: '#b91c1c',
                                border: '1px solid #fecaca',
                              }}
                              title={`Toàn hệ thống chỉ còn ${formatNumber(status.totalAvail)}`}
                            >
                              ✕ Thiếu hàng (tổng còn {formatNumber(status.totalAvail)})
                            </span>
                          )}
                          {status.overdraw ? (
                            <div style={{ fontSize: '10.5px', color: '#dc2626', marginTop: '2px', fontWeight: 500 }}>
                              Kho chọn chỉ còn {formatNumber(status.onHand)}!
                            </div>
                          ) : null}
                        </td>
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
                Sẽ ghi đồng thời <strong>{items.filter(i => i.quantity > 0).length} bút toán xuất kho</strong> vào sổ cái.
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
                style={{ minWidth: '180px' }}
              >
                {submitting
                  ? 'Đang ghi sổ giao dịch…'
                  : `Xác nhận xuất ${items.filter(i => i.quantity > 0).length} vật tư`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
