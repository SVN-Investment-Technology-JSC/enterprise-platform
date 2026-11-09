'use client';

import type {
  Asset,
  InventoryCatalogSettings,
} from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { loadItemProfile } from '../inventory-api';
import { AssetDetail } from './asset-detail';
import { AssetDocumentPanel } from './asset-document-panel';

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
      setError(
        cause instanceof Error ? cause.message : 'Không đọc được hồ sơ vật tư.',
      );
    }
  }, [code]);

  useEffect(() => {
    setAsset(undefined);
    void reload();
  }, [reload]);

  return (
    <Dialog onEscape={onClose}>
      <DialogContent className="max-w-[1200px]" aria-label={`Hồ sơ ${code}`}>
        <DialogHeader>
          <DialogTitle>{`Hồ sơ ${code}`}</DialogTitle>
          <DialogCloseButton
            aria-label="Đóng hồ sơ"
            title="Đóng hồ sơ"
            onClick={onClose}
          />
        </DialogHeader>
        <DialogBody>
          {error ? (
            <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-3 text-red-800">
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
            <p className="m-0 py-8 text-center text-slate-500">Đang tải hồ sơ…</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
