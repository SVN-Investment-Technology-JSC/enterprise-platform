'use client';

import type { AssetDocument } from '@enterprise-platform/contracts-inventory';
import { Popconfirm, toast } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assetDocumentDownloadUrl,
  loadAssetDocuments,
  removeAssetDocument,
  uploadAssetDocument,
} from '../inventory-api';
import { useInventoryPermissions } from '../inventory-permissions';
import { Button } from '../ui/button';

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tài liệu đính kèm theo thiết bị: hướng dẫn, phiếu bảo hành, biên bản. */
export function AssetDocumentPanel({ assetCode, busy }: { assetCode: string; busy?: boolean }) {
  const { canManage } = useInventoryPermissions();
  const [documents, setDocuments] = useState<AssetDocument[]>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setDocuments(await loadAssetDocuments(assetCode));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách tài liệu.');
    }
  }, [assetCode]);

  useEffect(() => {
    setDocuments(undefined);
    void reload();
  }, [reload]);

  const upload = async (file: File) => {
    setWorking(true);
    try {
      await uploadAssetDocument(assetCode, file);
      if (fileInput.current) fileInput.current.value = '';
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không tải được tệp lên.');
    } finally {
      setWorking(false);
    }
  };

  const open = async (documentId: string) => {
    try {
      const { url } = await assetDocumentDownloadUrl(assetCode, documentId);
      window.open(url, '_blank', 'noopener');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không mở được tài liệu.');
    }
  };

  const remove = async (documentId: string) => {
    setWorking(true);
    try {
      await removeAssetDocument(assetCode, documentId);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không xoá được tài liệu.');
    } finally {
      setWorking(false);
    }
  };

  const disabled = busy || working;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-[1.2rem] shadow-sm">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-bold text-slate-900">Tài liệu đính kèm</h2>
        <span>{documents ? `${documents.length} tệp` : 'Đang tải…'}</span>
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      {documents && documents.length > 0 ? (
        <ul className="m-0 mb-3 flex list-none flex-col gap-[0.4rem] p-0">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <span>
                <strong className="block text-sm">{document.fileName}</strong>
                <small className="text-[13px] text-slate-500">
                  {formatSize(document.sizeBytes)}
                  {document.note ? ` · ${document.note}` : ''}
                </small>
              </span>
              <span className="flex flex-none flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void open(document.id)}
                >
                  Mở
                </Button>
                {canManage ? <Popconfirm
                  title="Xoá tệp đính kèm này?"
                  description={`Tệp "${document.fileName}" sẽ bị gỡ bỏ vĩnh viễn khỏi hồ sơ thiết bị.`}
                  okText="Đồng ý xoá"
                  cancelText="Huỷ"
                  okType="danger"
                  placement="top-end"
                  disabled={disabled}
                  onConfirm={() => remove(document.id)}
                >
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={disabled}
                  >
                    Xoá
                  </Button>
                </Popconfirm> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : documents ? (
        <p className="m-0 py-8 text-center text-slate-500">Chưa có tài liệu nào.</p>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        disabled={!canManage || disabled}
        accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx,.txt"
        aria-label="Chọn tệp đính kèm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </section>
  );
}
