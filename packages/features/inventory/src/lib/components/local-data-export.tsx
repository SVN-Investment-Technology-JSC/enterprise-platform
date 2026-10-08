'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  dismissLocalExportNotice,
  exportLocalInventoryExcel,
  exportLocalInventoryJson,
  isLocalExportNoticeDismissed,
  readLocalInventoryData,
  type LocalInventoryData,
} from '../local-data-export';
import styles from '../inventory.module.scss';

const button: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '12px',
  fontWeight: 600,
  background: '#ffffff',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
  borderRadius: '4px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
};

/**
 * `banner`: cảnh báo một lần (ẩn hẳn sau khi bấm "Đã hiểu").
 * `inline`: nút xuất luôn có mặt chừng nào còn dữ liệu cục bộ.
 */
export function LocalDataExport({ mode }: { mode: 'banner' | 'inline' }) {
  const [data, setData] = useState<LocalInventoryData | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setData(readLocalInventoryData());
    setDismissed(isLocalExportNoticeDismissed());
  }, []);

  if (!data || (mode === 'banner' && dismissed)) return null;

  const run = async (action: () => void | Promise<void>) => {
    try {
      setError(undefined);
      // Đọc lại để bản xuất phản ánh đúng dữ liệu hiện có.
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xuất dữ liệu.');
    }
  };
  const fresh = () => readLocalInventoryData() ?? data;

  const actions = (
    <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
      <button type="button" style={button} onClick={() => run(() => exportLocalInventoryJson(fresh()))}>
        <Download size={13} /> Xuất dữ liệu cục bộ (JSON)
      </button>
      <button type="button" style={button} onClick={() => run(() => exportLocalInventoryExcel(fresh()))}>
        <Download size={13} /> Xuất dữ liệu cục bộ (Excel)
      </button>
    </span>
  );

  if (mode === 'inline') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px', color: '#64748b' }}>
        <span>Trình duyệt này còn dữ liệu kiểm kê/lô hàng lưu cục bộ.</span>
        {actions}
        {error ? <span role="alert" style={{ color: '#b91c1c' }}>{error}</span> : null}
      </div>
    );
  }

  const sessions = data.stocktakeSessions.length;
  const lots = Object.values(data.lots).reduce((sum, rows) => sum + rows.length, 0);
  return (
    <div role="alert" className={styles.alert} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span>
        Trình duyệt này còn dữ liệu kho lưu cục bộ ({sessions} đợt kiểm kê, {lots} dòng lô hàng). Kiểm kê hiện
        đã chuyển sang máy chủ và không còn đọc dữ liệu cục bộ; hãy xuất ra tệp để lưu lại trước khi dọn dữ
        liệu trình duyệt. Lô hàng vẫn lưu cục bộ trong lúc chờ chuyển sang máy chủ.
      </span>
      <span style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        {actions}
        <button
          type="button"
          style={button}
          onClick={() => {
            dismissLocalExportNotice();
            setDismissed(true);
          }}
        >
          Đã hiểu, không nhắc lại
        </button>
        {error ? <span>{error}</span> : null}
      </span>
    </div>
  );
}
