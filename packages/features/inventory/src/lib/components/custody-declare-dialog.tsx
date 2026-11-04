'use client';

import type { AssetCategory, CreateAssetRequest } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import styles from '../inventory.module.scss';

/** `.formGrid label` ép nhãn thành cột flex nên dấu * rớt xuống dòng; ép về dòng thường. */
const labelStyle = { display: 'block' } as const;

export const ASSET_CATEGORY_LABEL: Readonly<Record<AssetCategory, string>> = {
  INDUSTRIAL: 'Thiết bị công nghiệp',
  IT_OFFICE: 'Thiết bị CNTT, văn phòng',
  TOOL_PPE: 'Dụng cụ, bảo hộ',
  VEHICLE: 'Phương tiện',
};

/**
 * Form khai báo tài sản mới (thiết bị, dụng cụ, phương tiện) ngay ở tab Tài sản.
 * Tài sản mới vào ở trạng thái hoạt động và chưa có người giữ, tức là tồn kho.
 */
export function CustodyDeclareDialog({
  busy,
  onCancel,
  onSubmit,
}: {
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateAssetRequest) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>('IT_OFFICE');
  const [serialNumber, setSerialNumber] = useState('');
  const [unit, setUnit] = useState('Cái');
  const [price, setPrice] = useState('');

  const categoryOptions = useMemo(
    () =>
      (Object.keys(ASSET_CATEGORY_LABEL) as AssetCategory[]).map((value) => ({
        value,
        label: ASSET_CATEGORY_LABEL[value],
      })),
    [],
  );

  const priceValue = price.trim() === '' ? undefined : Number(price);
  const priceInvalid = priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0);
  const ready = code.trim() !== '' && name.trim() !== '' && !priceInvalid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type: 'EQUIPMENT',
      status: 'OPERATING',
      assetCategory: category,
      serialNumber: serialNumber.trim() || undefined,
      unit: unit.trim() || undefined,
      purchasePrice: priceValue,
      currency: priceValue === undefined ? undefined : 'VND',
    });
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{ maxWidth: '620px' }}
        role="dialog"
        aria-modal="true"
        aria-label="Khai báo tài sản"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className={styles.modalHead}>
            <div>
              <h2>Khai báo tài sản</h2>
              <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
                Tài sản mới ở trạng thái tồn kho, chưa cấp cho ai.
              </p>
            </div>
            <button type="button" className={styles.closeButton} onClick={onCancel} title="Đóng" aria-label="Đóng">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className={styles.modalBody} style={{ maxHeight: '75vh', overflowY: 'auto' }}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="custody-declare-code">
                  Mã tài sản <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  id="custody-declare-code"
                  required
                  autoFocus
                  placeholder="VD: TS-LAP-003"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="custody-declare-name">
                  Tên tài sản <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  id="custody-declare-name"
                  required
                  placeholder="VD: Laptop Dell Latitude 5440"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle}>Nhóm tài sản</label>
                <SearchableSelect
                  options={categoryOptions}
                  value={category}
                  placeholder="— Chọn nhóm —"
                  onChange={(value) => setCategory((value || 'IT_OFFICE') as AssetCategory)}
                  clearable={false}
                  height={42}
                  style={{ width: '100%' }}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="custody-declare-serial">Số sê-ri</label>
                <input
                  id="custody-declare-serial"
                  placeholder="Số sê-ri của thiết bị"
                  value={serialNumber}
                  onChange={(event) => setSerialNumber(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="custody-declare-unit">Đơn vị tính</label>
                <input
                  id="custody-declare-unit"
                  placeholder="Cái, Bộ…"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label style={labelStyle} htmlFor="custody-declare-price">Giá mua (VND)</label>
                <input
                  id="custody-declare-price"
                  inputMode="decimal"
                  placeholder="Bỏ trống nếu chưa khai báo"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  aria-invalid={priceInvalid}
                />
                {priceInvalid ? (
                  <span role="alert" style={{ fontSize: '13px', color: '#dc2626' }}>
                    Giá mua phải là số không âm.
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className={styles.modalFoot}>
            <button
              type="button"
              className={`${styles.action} ${styles.actionGhost}`}
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy || !ready}
            >
              {busy ? 'Đang lưu…' : 'Khai báo tài sản'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
