'use client';

import type { AssetDocument } from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assetDocumentDownloadUrl,
  loadAssetDocuments,
  removeAssetDocument,
  uploadAssetDocument,
} from '../inventory-api';
import styles from '../inventory.module.scss';

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tài liệu đính kèm theo thiết bị: hướng dẫn, phiếu bảo hành, biên bản. */
export function AssetDocumentPanel({ assetCode, busy }: { assetCode: string; busy?: boolean }) {
  const [documents, setDocuments] = useState<AssetDocument[]>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
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
      setError(cause instanceof Error ? cause.message : 'Không tải được tệp lên.');
    } finally {
      setWorking(false);
    }
  };

  const open = async (documentId: string) => {
    try {
      const { url } = await assetDocumentDownloadUrl(assetCode, documentId);
      window.open(url, '_blank', 'noopener');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không mở được tài liệu.');
    }
  };

  const remove = async (documentId: string) => {
    setWorking(true);
    try {
      await removeAssetDocument(assetCode, documentId);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xoá được tài liệu.');
    } finally {
      setWorking(false);
    }
  };

  const disabled = busy || working;

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <h2>Tài liệu đính kèm</h2>
        <span>{documents ? `${documents.length} tệp` : 'Đang tải…'}</span>
      </header>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {documents && documents.length > 0 ? (
        <ul className={styles.spareList}>
          {documents.map((document) => (
            <li key={document.id}>
              <span>
                <strong>{document.fileName}</strong>
                <small>
                  {formatSize(document.sizeBytes)}
                  {document.note ? ` · ${document.note}` : ''}
                </small>
              </span>
              <span className={styles.docActions}>
                <button
                  type="button"
                  className={styles.docOpenBtn}
                  disabled={disabled}
                  onClick={() => void open(document.id)}
                >
                  Mở
                </button>
                <Popconfirm
                  title="Xoá tệp đính kèm này?"
                  description={`Tệp "${document.fileName}" sẽ bị gỡ bỏ vĩnh viễn khỏi hồ sơ thiết bị.`}
                  okText="Đồng ý xoá"
                  cancelText="Huỷ"
                  okType="danger"
                  placement="top-end"
                  disabled={disabled}
                  onConfirm={() => remove(document.id)}
                >
                  <button
                    type="button"
                    className={styles.deleteActionBtn}
                    disabled={disabled}
                  >
                    Xoá
                  </button>
                </Popconfirm>
              </span>
            </li>
          ))}
        </ul>
      ) : documents ? (
        <p className={styles.empty}>Chưa có tài liệu nào.</p>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        disabled={disabled}
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
