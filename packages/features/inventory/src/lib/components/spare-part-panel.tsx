'use client';

import type {
  AssetBomLine,
  InstalledMaterial,
  Material,
} from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { addAssetSparePart, loadAssetSpareParts, removeAssetSparePart } from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

/**
 * Vật tư TRỌNG YẾU của một vật tư.
 *
 * Chọn trong đúng các vật tư con đang lắp trên nó, không phải trong toàn bộ danh
 * mục kho: "trọng yếu" là câu trả lời cho "cấu phần nào của chính cái này mà
 * hỏng thì cả cụm dừng". Cho chọn cả danh mục thì câu hỏi đó mất nghĩa và danh
 * sách biến thành một bản sao thứ hai của kho.
 *
 * Mỗi dòng hiện luôn TỒN KHO của mã đó. Đấy là con số quyết định: biết cấu phần
 * nào trọng yếu mà không biết trong kho còn mấy cái thì vẫn không hành động được.
 */
export function SparePartPanel({
  assetCode,
  materials,
  childMaterials,
  onHandByCode,
  availableByCode,
  busy,
}: {
  assetCode: string;
  materials: readonly Material[];
  /** Vật tư con đang lắp trên vật tư này — nguồn duy nhất để chọn. */
  childMaterials?: readonly InstalledMaterial[];
  /** Hàng thật trong kho, gộp mọi kho, theo mã. */
  onHandByCode?: ReadonlyMap<string, number>;
  /** Khả dụng (đã trừ phần giữ chỗ), để hiện kèm khi hai số lệch nhau. */
  availableByCode?: ReadonlyMap<string, number>;
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
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách vật tư trọng yếu.');
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
      setError(cause instanceof Error ? cause.message : 'Không thêm được vật tư trọng yếu.');
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
      setError(cause instanceof Error ? cause.message : 'Không xoá được vật tư trọng yếu.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = busy || saving;

  /** Hàng thật trong kho của một mã; chưa đọc được thì coi như 0. */
  const stockOf = (code: string) => onHandByCode?.get(code) ?? 0;
  /** Khả dụng của mã đó — chỉ hiện khi nó khác số trong kho. */
  const freeOf = (code: string) => availableByCode?.get(code) ?? 0;

  /**
   * Chỉ các vật tư con đang lắp, trừ những mã đã khai rồi.
   *
   * `materials` vẫn nhận vào để lấy TÊN cho mã: dòng lắp đặt có tên, nhưng mã đã
   * khai trọng yếu rồi bị lọc ra nên danh sách chọn phải tự đứng được.
   */
  const options = (childMaterials ?? [])
    .filter((child) => !(lines ?? []).some((line) => line.materialCode === child.materialCode))
    .map((child) => ({
      code: child.materialCode,
      name:
        materials.find((material) => material.code === child.materialCode)?.name ??
        child.materialName,
    }));

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <h2>Vật tư trọng yếu</h2>
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
                  {line.materialCode} · định mức {formatNumber(line.standardQuantity)} {line.unit}
                  {' · '}
                  {/* Con số ở ĐÂY là hàng trong kho — khác hẳn con số cạnh cùng
                      mã đó trên cây, vốn là số đang lắp trên thiết bị. Hai chỗ
                      trả lời hai câu hỏi khác nhau nên phải gọi tên rõ ràng. */}
                  <span className={stockOf(line.materialCode) > 0 ? undefined : styles.overdraw}>
                    trong kho {formatNumber(stockOf(line.materialCode))} {line.unit}
                  </span>
                  {freeOf(line.materialCode) !== stockOf(line.materialCode) ? (
                    <span className={styles.muted}>
                      {' '}(khả dụng {formatNumber(freeOf(line.materialCode))})
                    </span>
                  ) : null}
                </small>
              </span>
              <button type="button" disabled={disabled} onClick={() => void remove(line.id)}>
                Xoá
              </button>
            </li>
          ))}
        </ul>
      ) : lines ? (
        <p className={styles.empty}>Chưa chọn vật tư trọng yếu nào.</p>
      ) : null}

      {options.length === 0 ? (
        <p className={styles.hint}>
          Chưa có vật tư con nào đang lắp trên {assetCode}. Dùng nút “+” trên cây để lắp vật tư từ
          kho vào đây trước, rồi mới chọn cái nào là trọng yếu.
        </p>
      ) : null}

      <div className={styles.spareForm}>
        <select
          value={materialCode}
          disabled={disabled}
          aria-label="Vật tư"
          onChange={(event) => {
            setMaterialCode(event.target.value);
            /**
             * Điền sẵn định mức bằng số ĐANG LẮP THẬT trên vật tư này.
             *
             * Trước đây ô này luôn khởi tạo bằng 1, nên lắp 5 cái rồi khai trọng
             * yếu vẫn ra "định mức 1 Cái" — hai con số nói về cùng một thứ mà
             * lệch nhau, và người đọc không biết tin cái nào.
             *
             * Vẫn sửa được: định mức là "cần bao nhiêu", có thể khác "đang lắp
             * bao nhiêu" khi thiết bị đang thiếu cấu phần.
             */
            const child = (childMaterials ?? []).find(
              (line) => line.materialCode === event.target.value,
            );
            if (child) setQuantity(String(child.quantity));
          }}
        >
          <option value="">Chọn trong vật tư con…</option>
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name} · {option.code}
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
