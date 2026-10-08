'use client';

import type {
  CreateStockReservationRequest,
  Material,
} from '@enterprise-platform/contracts-inventory';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState, type FormEvent } from 'react';
import type { InventoryReservationRow } from '../inventory-api';
import { RESERVATION_STATUS_LABEL, formatDateTime, formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

const ACTIVE_STATUSES = new Set(['PENDING', 'RESERVED', 'PARTIALLY_ISSUED']);

function newReferenceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Dự phòng cho môi trường không có crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/**
 * Giữ chỗ vật tư thủ công cho một mã: tạo phiếu giữ và giải phóng phiếu còn hiệu lực.
 * API đã có sẵn từ trước; panel này chỉ là mặt UI còn thiếu.
 */
export function ReservationPanel({
  material,
  warehouseCodes,
  reservations,
  canWrite,
  busy,
  onReserve,
  onRelease,
}: {
  material: Material;
  /** Các kho đang có tồn của mã này. */
  warehouseCodes: readonly string[];
  reservations: readonly InventoryReservationRow[];
  canWrite: boolean;
  busy?: boolean;
  onReserve: (input: CreateStockReservationRequest) => Promise<void> | void;
  onRelease: (code: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [warehouseCode, setWarehouseCode] = useState(warehouseCodes[0] ?? '');
  const [quantity, setQuantity] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string>();

  const active = useMemo(
    () =>
      reservations.filter(
        (reservation) =>
          ACTIVE_STATUSES.has(reservation.status) &&
          (reservation.items ?? []).some((item) => item.materialId === material.id),
      ),
    [reservations, material.id],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!warehouseCode) return setFormError('Chọn kho cần giữ vật tư.');
    if (!Number.isFinite(amount) || amount <= 0) return setFormError('Số lượng phải lớn hơn 0.');
    setFormError(undefined);
    await onReserve({
      warehouseCode,
      referenceType: 'MANUAL',
      referenceId: newReferenceId(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      notes: notes.trim() || undefined,
      items: [{ materialCode: material.code, quantityReserved: amount }],
    });
    setOpen(false);
    setQuantity('');
    setExpiresAt('');
    setNotes('');
  };

  return (
    <div className={styles.drawerSection}>
      <h4 className={styles.drawerSectionTitle}>
        <span>Giữ chỗ vật tư</span>
        {canWrite && !open ? (
          <button
            type="button"
            className={styles.linkButton}
            disabled={busy || warehouseCodes.length === 0}
            onClick={() => {
              setWarehouseCode((current) => current || warehouseCodes[0] || '');
              setOpen(true);
            }}
          >
            Tạo giữ chỗ
          </button>
        ) : null}
      </h4>

      {open ? (
        <form onSubmit={submit} className={styles.formGrid}>
          <label>
            Kho *
            <SearchableSelect
              required
              options={warehouseCodes.map((code) => ({ value: code, label: code }))}
              value={warehouseCode}
              onChange={(value) => setWarehouseCode(value)}
            />
          </label>
          <label>
            Số lượng giữ ({material.unit}) *
            <input
              type="number"
              min={0}
              step="any"
              required
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            Hết hạn giữ (tuỳ chọn)
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <label>
            Ghi chú
            <input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          {formError ? (
            <p role="alert" className={styles.alert}>
              {formError}
            </p>
          ) : null}
          <div className={styles.rowActions}>
            <button type="button" className={styles.linkButton} onClick={() => setOpen(false)}>
              Huỷ
            </button>
            <button
              type="submit"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy}
            >
              {busy ? 'Đang lưu…' : 'Giữ vật tư'}
            </button>
          </div>
        </form>
      ) : null}

      {active.length === 0 ? (
        <p className={styles.muted}>Chưa có phiếu giữ chỗ nào còn hiệu lực cho mã này.</p>
      ) : (
        <ul className={styles.holderList}>
          {active.map((reservation) => {
            const held = (reservation.items ?? [])
              .filter((item) => item.materialId === material.id)
              .reduce((sum, item) => sum + item.quantityReserved - item.quantityIssued, 0);
            return (
              <li key={reservation.id}>
                <span className={styles.code}>{reservation.reservationCode}</span>
                <span className={styles.pill}>{RESERVATION_STATUS_LABEL[reservation.status]}</span>
                <span>
                  giữ {formatNumber(held)} {material.unit}
                </span>
                <em>
                  {reservation.expiresAt
                    ? `hết hạn ${formatDateTime(reservation.expiresAt)}`
                    : 'không hạn'}
                </em>
                {canWrite ? (
                  <Popconfirm
                    title="Giải phóng giữ chỗ?"
                    description={`Số lượng đang giữ của ${reservation.reservationCode} sẽ trả về tồn khả dụng.`}
                    okText="Giải phóng"
                    cancelText="Giữ lại"
                    okType="danger"
                    disabled={busy}
                    onConfirm={() => onRelease(reservation.reservationCode)}
                  >
                    <button type="button" className={styles.linkButton} disabled={busy}>
                      Giải phóng
                    </button>
                  </Popconfirm>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
