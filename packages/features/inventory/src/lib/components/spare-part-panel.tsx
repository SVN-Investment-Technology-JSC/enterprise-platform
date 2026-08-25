'use client';

import type { AssetBomLine, Material } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { addAssetSparePart, loadAssetSpareParts, removeAssetSparePart } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Phụ tùng tiêu chuẩn của một thiết bị.
 *
 * Bảng `asset_boms` đã có từ migration đầu tiên nhưng chưa từng có giao diện —
 * đây là phần nối dây, không phải mô hình dữ liệu mới.
 */
export function SparePartPanel({
  assetCode,
  materials,
  busy,
}: {
  assetCode: string;
  materials: readonly Material[];
  busy?: boolean;
}) {
  const [lines, setLines] = useState<AssetBomLine[]>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [materialCode, setMaterialCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [critical, setCritical] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLines(await loadAssetSpareParts(assetCode));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách phụ tùng.');
    }
  }, [assetCode]);

  useEffect(() => {
    setLines(undefined);
    void reload();
  }, [reload]);

  const submit = async () => {
    const parsed = Number(quantity);
    if (!materialCode || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Chọn vật tư và nhập định mức là số dương.');
      return;
    }
    setSaving(true);
    try {
      await addAssetSparePart(assetCode, {
        materialCode,
        standardQuantity: parsed,
        isCriticalSpare: critical,
      });
      setMaterialCode('');
      setQuantity('1');
      setCritical(false);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thêm được phụ tùng.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (bomId: string) => {
    setSaving(true);
    try {
      await removeAssetSparePart(assetCode, bomId);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xoá được phụ tùng.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = busy || saving;

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <h2>Phụ tùng tiêu chuẩn</h2>
        <span>{lines ? `${lines.length} dòng` : 'Đang tải…'}</span>
      </header>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {lines && lines.length > 0 ? (
        <ul className={styles.spareList}>
          {lines.map((line) => (
            <li key={line.id}>
              <span>
                <strong>{line.materialName}</strong>
                <small>
                  {line.materialCode} · {formatNumber(line.standardQuantity)} {line.unit}
                  {line.isCriticalSpare ? ' · trọng yếu' : ''}
                </small>
              </span>
              <button type="button" disabled={disabled} onClick={() => void remove(line.id)}>
                Xoá
              </button>
            </li>
          ))}
        </ul>
      ) : lines ? (
        <p className={styles.empty}>Thiết bị chưa khai báo phụ tùng nào.</p>
      ) : null}

      <div className={styles.spareForm}>
        <select
          value={materialCode}
          disabled={disabled}
          aria-label="Vật tư"
          onChange={(event) => setMaterialCode(event.target.value)}
        >
          <option value="">Chọn vật tư…</option>
          {materials.map((material) => (
            <option key={material.code} value={material.code}>
              {material.name} · {material.code}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.001"
          value={quantity}
          disabled={disabled}
          aria-label="Định mức"
          onChange={(event) => setQuantity(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={critical}
            disabled={disabled}
            onChange={(event) => setCritical(event.target.checked)}
          />
          Trọng yếu
        </label>
        <button type="button" disabled={disabled} onClick={() => void submit()}>
          Thêm
        </button>
      </div>
    </section>
  );
}
