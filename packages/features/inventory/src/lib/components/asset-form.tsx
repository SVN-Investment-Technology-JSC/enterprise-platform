'use client';

import type {
  Asset,
  AssetCriticality,
  AssetType,
  CreateAssetRequest,
} from '@enterprise-platform/contracts-inventory';
import { useState, type FormEvent } from 'react';
import { ASSET_CRITICALITY_LABEL, ASSET_TYPE_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

export function AssetForm({
  assets,
  defaultParentCode,
  busy,
  onCancel,
  onSubmit,
}: {
  assets: readonly Asset[];
  defaultParentCode?: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateAssetRequest) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>('EQUIPMENT');
  const [criticality, setCriticality] = useState<AssetCriticality>('MEDIUM');
  const [parentCode, setParentCode] = useState(defaultParentCode ?? '');
  const [serialNumber, setSerialNumber] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type,
      criticality,
      parentCode: parentCode || undefined,
      serialNumber: serialNumber.trim() || undefined,
    });
  };

  return (
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={styles.modalDialog} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <h2>
            <span>⚙️</span>
            Thêm thiết bị mới
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>Mã thiết bị *</label>
                <input
                  required
                  placeholder="VD: MBA-T3"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Tên thiết bị *</label>
                <input
                  required
                  placeholder="VD: Máy biến áp lực T3 — 25MVA"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Cấp phân cấp</label>
                <select value={type} onChange={(event) => setType(event.target.value as AssetType)}>
                  {Object.entries(ASSET_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Thuộc thiết bị cha (Cây 360)</label>
                <select value={parentCode} onChange={(event) => setParentCode(event.target.value)}>
                  <option value="">— Là node gốc (Top Level) —</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.code}>
                      {asset.code} — {asset.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Mức độ quan trọng</label>
                <select
                  value={criticality}
                  onChange={(event) => setCriticality(event.target.value as AssetCriticality)}
                >
                  {Object.entries(ASSET_CRITICALITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Số Serial Number</label>
                <input
                  placeholder="VD: SN-2024-9901"
                  value={serialNumber}
                  onChange={(event) => setSerialNumber(event.target.value)}
                />
              </div>
            </div>

            <small style={{ color: 'var(--pe-text-muted)', fontSize: '12px' }}>
              💡 Thông số kỹ thuật chi tiết và đầu việc bảo trì có thể khai báo sau trong hồ sơ Asset 360.
            </small>
          </div>

          <div className={styles.modalFoot}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ bỏ
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={busy}
            >
              {busy ? 'Đang tạo…' : '+ Thêm thiết bị'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
