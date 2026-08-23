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
  busy: boolean;
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
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.cardHead}>
        <h2>Thêm thiết bị</h2>
      </div>

      <div className={styles.formGrid}>
        <label>
          Mã thiết bị *
          <input
            required
            placeholder="VD: MBA-T3"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label>
          Tên thiết bị *
          <input
            required
            placeholder="VD: Máy biến áp lực T3 — 25MVA"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Cấp
          <select value={type} onChange={(event) => setType(event.target.value as AssetType)}>
            {Object.entries(ASSET_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Thuộc thiết bị cha
          <select value={parentCode} onChange={(event) => setParentCode(event.target.value)}>
            <option value="">— Là node gốc —</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.code}>
                {asset.code} — {asset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Độ quan trọng
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
        </label>
        <label>
          Số serial
          <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} />
        </label>
      </div>

      <p className={styles.hint}>
        Thông số kỹ thuật và đầu việc bảo trì khai báo sau khi tạo, trong hồ sơ thiết bị.
      </p>

      <div className={styles.editActions}>
        <button type="submit" className={`${styles.action} ${styles.actionPrimary}`} disabled={busy}>
          {busy ? 'Đang tạo…' : 'Thêm thiết bị'}
        </button>
        <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
