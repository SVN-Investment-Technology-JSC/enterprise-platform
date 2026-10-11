'use client';

import type {
  ProcedureDefinition,
  ProcedureInstance,
  RequestProcedureMaterialsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { useState } from 'react';
import type { MaterialCatalogItem } from '../procedure-api';
import styles from './workspace-board.module.scss';

interface DraftLine {
  materialCode: string;
  quantity: number;
}

/**
 * Xin vật tư cho BƯỚC hiện tại — dành cho chủ vai KHÔNG phải E.
 *
 * Vai E xin theo đầu việc, vật tư gộp từ các E(x) (xem SubtaskPanel). Các vai
 * còn lại không có đầu việc nào nhưng vẫn cần dụng cụ để làm phần việc của
 * mình: người rà soát cần máy đo, người nghiệm thu cần thiết bị kiểm tra.
 *
 * Cùng một luật với đường của vai E: server đọc tồn tươi rồi tự quyết đủ thì mở
 * đơn mượn/xuất, thiếu thì mở đơn mua. Không trừ kho ở bất kỳ đâu.
 */
export function MaterialRequestPanel({
  instance,
  materialCatalog,
  definitions,
  busy,
  onRequest,
}: {
  instance: ProcedureInstance;
  materialCatalog: readonly MaterialCatalogItem[];
  definitions: readonly ProcedureDefinition[];
  busy?: string;
  onRequest: (input: RequestProcedureMaterialsRequest) => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [issueDefinitionId, setIssue] = useState('');
  const [purchaseDefinitionId, setPurchase] = useState('');

  const published = definitions.filter((item) => item.status === 'published');
  const valid = lines.filter((line) => line.materialCode.trim() && line.quantity > 0);
  const anyShort = valid.some((line) => {
    const stock = materialCatalog.find((item) => item.code === line.materialCode);
    return stock?.available !== undefined && stock.available < line.quantity;
  });

  const patch = (index: number, change: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...change } : line)),
    );

  if (materialCatalog.length === 0) {
    return (
      <p className={styles.panelHint}>
        Chưa đọc được danh mục vật tư từ Kho nên chưa xin vật tư được.
      </p>
    );
  }

  return (
    <div className={styles.orderBox}>
      <p className={styles.panelHint}>
        Khai vật tư bạn cần cho bước này. Đủ hàng thì mở đơn mượn/xuất kho, thiếu thì mở đơn mua
        sắm — hệ thống không tự trừ kho, thủ kho vẫn là người xuất hàng.
      </p>

      <div className={styles.materialRows}>
        {lines.map((line, index) => {
          const stock = materialCatalog.find((item) => item.code === line.materialCode);
          const short = stock?.available !== undefined && stock.available < line.quantity;
          return (
            <div key={index} className={styles.materialRow}>
              <select
                aria-label="Vật tư"
                value={line.materialCode}
                onChange={(event) => patch(index, { materialCode: event.target.value })}
              >
                <option value="">— Chọn vật tư —</option>
                {materialCatalog.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                aria-label="Số lượng"
                value={line.quantity}
                onChange={(event) => patch(index, { quantity: Number(event.target.value) })}
              />
              <span className={short ? styles.materialShort : styles.materialStock}>
                {stock?.available !== undefined
                  ? `tồn ${stock.available} ${stock.unit}`
                  : line.materialCode
                    ? 'chưa đọc được tồn'
                    : ''}
              </span>
              <button
                type="button"
                className={styles.subtaskRemove}
                aria-label="Xoá dòng vật tư"
                onClick={() => setLines((current) => current.filter((_, p) => p !== index))}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={styles.ghost}
          onClick={() => setLines((current) => [...current, { materialCode: '', quantity: 1 }])}
        >
          + Vật tư
        </button>
      </div>

      {valid.length > 0 ? (
        <div className={styles.dispatchPicker}>
          <label>
            <span>Phần đủ hàng — mượn/xuất kho</span>
            <select value={issueDefinitionId} onChange={(event) => setIssue(event.target.value)}>
              <option value="">— Chọn quy trình —</option>
              {published.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
          </label>
          {anyShort ? (
            <label>
              <span>Phần thiếu hàng — mua sắm</span>
              <select
                value={purchaseDefinitionId}
                onChange={(event) => setPurchase(event.target.value)}
              >
                <option value="">— Chọn quy trình —</option>
                {published.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy === 'materials'}
              onClick={() => {
                onRequest({
                  materials: valid,
                  issueDefinitionId: issueDefinitionId || undefined,
                  purchaseDefinitionId: purchaseDefinitionId || undefined,
                });
                setLines([]);
              }}
            >
              Xác nhận tạo đơn
            </button>
          </div>
        </div>
      ) : null}

      {(instance.materialOrders ?? []).length > 0 ? (
        <p className={styles.panelHint}>
          Đã mở {(instance.materialOrders ?? []).length} đơn từ hồ sơ này — xem mục “Hồ sơ liên
          quan”.
        </p>
      ) : null}
    </div>
  );
}
