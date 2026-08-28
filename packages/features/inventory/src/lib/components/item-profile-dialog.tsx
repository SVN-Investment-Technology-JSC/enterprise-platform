'use client';

import type { Asset, InventoryCatalogSettings } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import { loadItemProfile } from '../inventory-api';
import { AssetDetail } from './asset-detail';
import { AssetDocumentPanel } from './asset-document-panel';
import styles from '../inventory.module.scss';

/**
 * Hồ sơ đầy đủ của một mã, mở từ danh mục Kho.
 *
 * Trước đây hồ sơ chỉ xem được trong cây thiết bị — mà cây chỉ chứa những mã đã
 * lắp. Vật tư còn nằm trong kho thì không có đường nào mở hồ sơ, dù nó cũng có
 * sê-ri, tình trạng, vị trí, thông số và tài liệu như mọi mã khác.
 *
 * Nạp lại hồ sơ từ server thay vì dùng dòng đang có trên bảng: dòng đó là bản
 * rút gọn cho danh mục, thiếu thông số kỹ thuật, đầu việc bảo trì và tài liệu.
 */
export function ItemProfileDialog({
  code,
  catalog,
  units,
  busy,
  onClose,
  onSaved,
}: {
  code: string;
  catalog?: InventoryCatalogSettings;
  units?: readonly string[];
  busy?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [asset, setAsset] = useState<Asset>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setAsset(await loadItemProfile(code));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được hồ sơ vật tư.');
    }
  }, [code]);

  useEffect(() => {
    setAsset(undefined);
    void reload();
  }, [reload]);

  // Esc để đóng: hộp thoại này che gần hết màn hình, bắt người dùng đi tìm nút
  // đóng ở góc là thêm một nhịp không cần thiết.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.profileDialog} role="dialog" aria-modal="true" aria-label={`Hồ sơ ${code}`}>
      {/* Nền tối cũng là nút đóng — bấm ra ngoài để thoát là phản xạ sẵn có. */}
      <div className={styles.profileBackdrop} onClick={onClose} />
      <div className={styles.profileBox}>
        <button
          type="button"
          className={styles.profileClose}
          aria-label="Đóng hồ sơ"
          onClick={onClose}
        >
          ×
        </button>

        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}

        {asset ? (
          <>
            <AssetDetail
              asset={asset}
              busy={busy}
              catalog={catalog}
              units={units}
              onSaved={() => {
                void reload();
                onSaved();
              }}
            />
            <AssetDocumentPanel assetCode={asset.code} busy={busy} />
          </>
        ) : error ? null : (
          <p className={styles.empty}>Đang tải hồ sơ…</p>
        )}
      </div>
    </div>
  );
}
