'use client';

import type { StockDocumentStatus, Warehouse } from '@enterprise-platform/contracts-inventory';
import { formatDate } from '@enterprise-platform/shared-ui';
import { Drawer, Modal } from 'antd';
import { QrCode, Layers } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { loadLots, loadSerials } from '../inventory-api';
import { QUALITY_STATUS_LABEL, formatNumber } from '../inventory-labels';
import {
  STOCK_DOCUMENT_STATUS_BADGE,
  STOCK_DOCUMENT_STATUS_LABEL,
  addScannedSerials,
  allocateFefo,
  lotOptionsForWarehouse,
  parseSerialInput,
  todayIso,
  type LotAllocation,
  type LotOption,
} from '../stock-document.model';
import styles from '../inventory.module.scss';

/** Nhãn trạng thái chứng từ: nền màu và chấm tròn CSS, không dùng emoji. */
export function DocumentStatusBadge({ status }: { status: StockDocumentStatus }) {
  const badge = STOCK_DOCUMENT_STATUS_BADGE[status];
  return (
    <span
      className={styles.statusPill}
      style={{ background: badge.bg, color: badge.text, border: `1px solid ${badge.border}` }}
    >
      <span className={styles.docDot} style={{ background: badge.text }} />
      {STOCK_DOCUMENT_STATUS_LABEL[status]}
    </span>
  );
}

/** Nội dung lỗi trả về từ server hoặc lỗi bất ngờ, hiện nguyên văn cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

// ---------------------------------------------------------------- Chọn serial

/**
 * Chọn serial cho một dòng trong Drawer. Dòng xuất: chỉ chọn serial đang ở kho
 * xuất, Trong kho, Đạt (đọc từ server). Dòng nhập: gõ hoặc quét serial mới.
 * Ô quét nhận cả bàn phím lẫn máy quét mã vạch (máy quét gõ chuỗi rồi Enter).
 */
export function SerialPickerDrawer({
  open,
  materialCode,
  materialName,
  warehouse,
  quantity,
  value,
  inbound,
  readOnly,
  zIndex,
  onApply,
  onClose,
}: {
  open: boolean;
  materialCode: string;
  materialName?: string;
  warehouse?: Pick<Warehouse, 'id' | 'code'>;
  quantity: number;
  value: readonly string[];
  inbound: boolean;
  readOnly?: boolean;
  /** Mở chồng lên hộp thoại khác (lắp, tháo vật tư) thì cần nổi cao hơn hộp thoại đó. */
  zIndex?: number;
  onApply: (serials: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([...value]);
  const [available, setAvailable] = useState<string[]>();
  const [scan, setScan] = useState('');
  const [filter, setFilter] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const limit = Math.max(Math.trunc(quantity) || 0, 0);

  useEffect(() => {
    if (!open) return;
    setSelected([...value]);
    setFeedback(undefined);
    setScan('');
    setFilter('');
  }, [open, value]);

  useEffect(() => {
    if (!open || inbound || !materialCode) return;
    let cancelled = false;
    setAvailable(undefined);
    setLoadError(undefined);
    loadSerials(materialCode)
      .then((rows) => {
        if (cancelled) return;
        setAvailable(
          rows
            .filter(
              (row) =>
                (!warehouse || row.currentWarehouseId === warehouse.id) &&
                (row.stockState ?? 'IN_STOCK') === 'IN_STOCK' &&
                (row.qualityStatus ?? 'PASSED') === 'PASSED',
            )
            .map((row) => row.serialNumber)
            .sort((left, right) => left.localeCompare(right)),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(errorMessage(cause, 'Không tải được danh sách serial.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, inbound, materialCode, warehouse]);

  /** Serial đã có sẵn trên dòng (ví dụ Bán hàng gợi ý) vẫn được giữ trong danh sách cho phép. */
  const allowed = useMemo(
    () => (inbound || !available ? undefined : [...new Set([...available, ...value])]),
    [inbound, available, value],
  );

  const applyScan = () => {
    const scanned = parseSerialInput(scan);
    if (scanned.length === 0) return;
    const result = addScannedSerials(selected, scanned, { limit, allowed });
    setSelected(result.serials);
    setScan('');
    setFeedback(
      result.rejected.length
        ? `Không thêm: ${result.rejected.map((item) => `${item.serial} (${item.reason})`).join('; ')}.`
        : `Đã thêm ${result.serials.length - selected.length} serial.`,
    );
  };

  const toggle = (serial: string) => {
    if (readOnly) return;
    if (selected.includes(serial)) setSelected(selected.filter((item) => item !== serial));
    else if (selected.length < limit) setSelected([...selected, serial]);
    else setFeedback(`Dòng chỉ cần ${limit} serial.`);
  };

  const visible = (allowed ?? []).filter((serial) => serial.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={520}
      zIndex={zIndex}
      destroyOnHidden
      title={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <QrCode size={18} /> Serial {materialCode}
        </span>
      }
      footer={
        <div className={styles.docFooter}>
          <span className={styles.countHint}>
            Đã chọn {selected.length}/{limit}
          </span>
          <div className={styles.docActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Đóng
            </button>
            {readOnly ? null : (
              <button type="button" className={styles.btnPrimary} onClick={() => onApply(selected)}>
                Áp dụng
              </button>
            )}
          </div>
        </div>
      }
    >
      {materialName ? <p className={styles.docHint}>{materialName}</p> : null}
      {readOnly ? null : (
        <label className={styles.docField}>
          <span>Quét hoặc gõ serial rồi nhấn Enter (nhiều serial cách nhau bằng dấu phẩy hoặc xuống dòng)</span>
          <input
            autoFocus
            value={scan}
            aria-label="Quét serial"
            placeholder="Ví dụ SN001"
            onChange={(event) => setScan(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyScan();
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (/[\s,;]/.test(text.trim())) {
                event.preventDefault();
                const result = addScannedSerials(selected, parseSerialInput(text), { limit, allowed });
                setSelected(result.serials);
                setFeedback(
                  result.rejected.length
                    ? `Không thêm: ${result.rejected.map((item) => `${item.serial} (${item.reason})`).join('; ')}.`
                    : undefined,
                );
              }
            }}
          />
        </label>
      )}
      {feedback ? <p className={styles.docHint}>{feedback}</p> : null}

      <h4 className={styles.docSubTitle}>Đã chọn</h4>
      {selected.length === 0 ? (
        <p className={styles.docHint}>Chưa chọn serial nào.</p>
      ) : (
        <div className={styles.docChips}>
          {selected.map((serial) => (
            <span key={serial} className={styles.docChip}>
              {serial}
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Bỏ ${serial}`}
                  onClick={() => setSelected(selected.filter((item) => item !== serial))}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {inbound ? (
        <p className={styles.docHint}>Dòng nhập: serial mới được tạo khi ghi sổ; serial đã có của mặt hàng bị từ chối.</p>
      ) : (
        <>
          <h4 className={styles.docSubTitle}>
            Serial sẵn có ở kho {warehouse?.code ?? ''} (Trong kho, Đạt)
          </h4>
          {loadError ? <p className={styles.alert}>{loadError}</p> : null}
          {!available && !loadError ? <p className={styles.docHint}>Đang tải serial…</p> : null}
          {available ? (
            <>
              <label className={styles.docField}>
                <span>Lọc</span>
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Tìm serial" />
              </label>
              <div className={styles.docSerialGrid}>
                {visible.map((serial) => (
                  <label key={serial} className={styles.docSerialItem}>
                    <input
                      type="checkbox"
                      checked={selected.includes(serial)}
                      disabled={readOnly}
                      onChange={() => toggle(serial)}
                    />
                    {serial}
                  </label>
                ))}
                {visible.length === 0 ? <p className={styles.docHint}>Không có serial phù hợp.</p> : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- Chọn lô

/**
 * Chọn lô cho dòng xuất theo FEFO. Lô hết hạn, không Đạt hiện mờ kèm lý do.
 * "Gợi ý FEFO" chia số lượng cho lô hạn gần nhất trước; áp dụng xong một dòng có
 * thể tách thành nhiều dòng, mỗi dòng một lô.
 */
export function LotPickerDrawer({
  open,
  materialCode,
  warehouseCode,
  quantity,
  unit,
  current,
  zIndex,
  onApply,
  onClose,
}: {
  open: boolean;
  materialCode: string;
  warehouseCode: string;
  quantity: number;
  unit?: string;
  current?: string;
  /** Xem `SerialPickerDrawer`. */
  zIndex?: number;
  onApply: (allocations: LotAllocation[]) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<LotOption[]>();
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!open || !materialCode) return;
    let cancelled = false;
    setOptions(undefined);
    setLoadError(undefined);
    loadLots(materialCode)
      .then((lots) => {
        if (cancelled) return;
        const next = lotOptionsForWarehouse(lots, warehouseCode, todayIso());
        setOptions(next);
        if (current && next.some((option) => option.lotNo === current)) setAmounts({ [current]: quantity });
        else {
          const fefo = allocateFefo(next, quantity);
          setAmounts(Object.fromEntries(fefo.allocations.map((item) => [item.lotNo, item.quantity])));
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(errorMessage(cause, 'Không tải được danh sách lô.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, materialCode, warehouseCode, quantity, current]);

  const total = Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const overLot = (options ?? []).find((option) => (amounts[option.lotNo] ?? 0) > option.available);
  const suggest = () => {
    const fefo = allocateFefo(options ?? [], quantity);
    setAmounts(Object.fromEntries(fefo.allocations.map((item) => [item.lotNo, item.quantity])));
  };

  const apply = () => {
    const allocations = (options ?? [])
      .filter((option) => (amounts[option.lotNo] ?? 0) > 0)
      .map((option) => ({ lotNo: option.lotNo, expiresOn: option.expiresOn, quantity: amounts[option.lotNo] }));
    onApply(allocations);
  };

  const problem =
    overLot !== undefined
      ? `Lô ${overLot.lotNo} chỉ còn khả dụng ${formatNumber(overLot.available)}.`
      : total !== quantity && total > 0
        ? `Tổng theo lô ${formatNumber(total)} khác số lượng dòng ${formatNumber(quantity)}; áp dụng sẽ đổi số lượng theo lô.`
        : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={560}
      zIndex={zIndex}
      destroyOnHidden
      title={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Layers size={18} /> Chọn lô {materialCode} tại {warehouseCode}
        </span>
      }
      footer={
        <div className={styles.docFooter}>
          <span className={styles.countHint}>
            Cần {formatNumber(quantity)} {unit ?? ''}, đã chia {formatNumber(total)}
          </span>
          <div className={styles.docActions}>
            <button type="button" className={styles.btnSecondary} onClick={suggest} disabled={!options}>
              Gợi ý FEFO
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => onApply([])}>
              Không chọn lô
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={apply}
              disabled={!options || overLot !== undefined || total <= 0}
            >
              Áp dụng
            </button>
          </div>
        </div>
      }
    >
      <p className={styles.docHint}>
        Xếp theo hạn dùng gần nhất trước (FEFO). Lô hết hạn hoặc không ở trạng thái Đạt không xuất được.
      </p>
      {loadError ? <p className={styles.alert}>{loadError}</p> : null}
      {!options && !loadError ? <p className={styles.docHint}>Đang tải lô…</p> : null}
      {options && options.length === 0 ? (
        <p className={styles.docHint}>Mặt hàng chưa có lô nào ở kho {warehouseCode}.</p>
      ) : null}
      {options && options.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Số lô</th>
              <th>Hạn dùng</th>
              <th className={styles.right}>Khả dụng</th>
              <th className={styles.right}>Lấy</th>
            </tr>
          </thead>
          <tbody>
            {options.map((option) => (
              <tr key={option.lotNo} style={{ opacity: option.blockedReason ? 0.55 : 1 }}>
                <td>
                  <strong>{option.lotNo}</strong>
                  {option.blockedReason ? (
                    <span className={styles.sub}>
                      {option.blockedReason}
                      {option.qualityStatus !== 'PASSED' ? ` (${QUALITY_STATUS_LABEL[option.qualityStatus]})` : ''}
                    </span>
                  ) : null}
                </td>
                <td>{option.expiresOn ? formatDate(option.expiresOn) : 'Không thời hạn'}</td>
                <td className={`${styles.right} ${styles.numeric}`}>{formatNumber(option.available)}</td>
                <td className={styles.right}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    aria-label={`Số lượng lấy từ lô ${option.lotNo}`}
                    className={styles.docNumber}
                    disabled={Boolean(option.blockedReason)}
                    value={amounts[option.lotNo] ?? ''}
                    onChange={(event) =>
                      setAmounts({ ...amounts, [option.lotNo]: Math.max(Number(event.target.value) || 0, 0) })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {problem ? <p className={styles.docWarn}>{problem}</p> : null}
    </Drawer>
  );
}

// ---------------------------------------------------------------- Lý do từ chối

/** Hộp nhập lý do từ chối; lý do bắt buộc (server cũng kiểm). */
export function RejectReasonDialog({
  open,
  documentCode,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  documentCode?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal
      open={open}
      title={`Từ chối chứng từ ${documentCode ?? ''}`}
      onCancel={onCancel}
      destroyOnHidden
      footer={
        <div className={styles.docActions} style={{ justifyContent: 'flex-end' }}>
          <button type="button" className={styles.btnSecondary} onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            Từ chối
          </button>
        </div>
      }
    >
      <label className={styles.docField}>
        <span>Lý do từ chối (bắt buộc, người lập sẽ thấy để sửa lại)</span>
        <textarea
          autoFocus
          rows={4}
          value={reason}
          aria-label="Lý do từ chối"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
    </Modal>
  );
}
