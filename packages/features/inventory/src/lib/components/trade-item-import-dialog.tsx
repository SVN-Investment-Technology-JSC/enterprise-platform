'use client';

import type { InventoryTradeCatalog } from '@enterprise-platform/contracts-inventory';
import { X } from 'lucide-react';
import { useState } from 'react';
import styles from '../inventory.module.scss';
import { downloadTradeTemplate, readImportFile, type ImportRow } from '../trade-items.model';

/**
 * Nhập hàng hóa từ Excel: đọc tệp, báo dòng sai trước khi ghi, rồi tạo từng mặt hàng.
 * Chỉ tạo mới; mã đã có trong Kho bị Kho từ chối và được báo lại theo dòng.
 */
export function TradeItemImportDialog({
  catalog,
  onCancel,
  onImport,
}: {
  /** Danh mục phân loại và sử dụng khai trong Cài đặt; dòng ngoài danh mục bị báo lỗi. */
  catalog?: InventoryTradeCatalog;
  onCancel: () => void;
  /** Trả về lỗi của từng dòng (theo số dòng trong tệp); dòng thành công không có trong kết quả. */
  onImport: (rows: ImportRow[]) => Promise<{ created: number; failures: { line: number; message: string }[] }>;
}) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; failures: { line: number; message: string }[] }>();

  const valid = rows.filter((row) => row.input);
  const invalid = rows.filter((row) => row.error);

  const pick = async (file?: File) => {
    setResult(undefined);
    setReadError(undefined);
    if (!file) return;
    setFileName(file.name);
    try {
      setRows(await readImportFile(file, catalog));
    } catch {
      setRows([]);
      setReadError('Không đọc được tệp. Hãy dùng tệp Excel theo mẫu.');
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      setResult(await onImport(valid));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={styles.modalDialog}
        style={{ maxWidth: '640px' }}
        role="dialog"
        aria-modal="true"
        aria-label="Nhập hàng hóa từ Excel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <h2>Nhập hàng hóa từ Excel</h2>
          <button type="button" className={styles.closeButton} onClick={onCancel} title="Đóng" aria-label="Đóng">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.modalBody} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#475569' }}>
            Các cột: Mã, Tên, Barcode, Nhóm (Hàng hóa hoặc Dịch vụ), Phân loại, Đơn vị, Sử dụng, Giá bán. Bắt buộc có Mã,
            Tên và Đơn vị. Phân loại và Sử dụng phải là mục đã khai báo trong Cài đặt.{' '}
            <button type="button" className={styles.btnSecondary} onClick={downloadTradeTemplate}>
              Tải tệp mẫu
            </button>
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            aria-label="Chọn tệp Excel"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
          {readError ? (
            <p role="alert" style={{ margin: 0, color: '#dc2626', fontSize: '14px' }}>
              {readError}
            </p>
          ) : null}

          {fileName && !readError && !result ? (
            <div style={{ fontSize: '14px', color: '#0f172a' }}>
              <strong>{valid.length}</strong> dòng hợp lệ, <strong>{invalid.length}</strong> dòng lỗi.
              {invalid.length > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem', color: '#b91c1c', maxHeight: '160px', overflowY: 'auto' }}>
                  {invalid.map((row) => (
                    <li key={row.line}>
                      Dòng {row.line}: {row.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div style={{ fontSize: '14px' }} role="status">
              Đã tạo <strong>{result.created}</strong> mặt hàng
              {result.failures.length > 0 ? `, ${result.failures.length} dòng không tạo được:` : '.'}
              {result.failures.length > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem', color: '#b91c1c', maxHeight: '160px', overflowY: 'auto' }}>
                  {result.failures.map((failure) => (
                    <li key={failure.line}>
                      Dòng {failure.line}: {failure.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={onCancel} disabled={busy}>
            {result ? 'Đóng' : 'Huỷ'}
          </button>
          {!result ? (
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy || valid.length === 0}
              onClick={() => void run()}
            >
              {busy ? 'Đang nhập…' : `Nhập ${valid.length} dòng`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
