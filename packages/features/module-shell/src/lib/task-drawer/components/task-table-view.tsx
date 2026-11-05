'use client';

import type { TaskTableBlock } from '@enterprise-platform/contracts-task-approval';
import styles from '../universal-task-drawer.module.scss';

export function TaskTableView({
  block,
  detailUrl,
}: {
  block: TaskTableBlock;
  detailUrl: string;
}) {
  if (!block || !block.columns || block.columns.length === 0) return null;

  return (
    <div className={styles.blockCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 className={styles.blockTitle}>{block.title}</h4>
        {block.totalRowsCount !== undefined && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Tổng cộng: {block.totalRowsCount} dòng
          </span>
        )}
      </div>

      {block.description && (
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>{block.description}</p>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.columns.map((col) => (
                <th key={col.key} style={{ textAlign: col.align || 'left', width: col.width }}>
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows && block.rows.length > 0 ? (
              block.rows.map((row, idx) => (
                <tr key={idx}>
                  {block.columns.map((col) => (
                    <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                      {String(row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={block.columns.length} style={{ textAlign: 'center', padding: 16, color: '#94a3b8' }}>
                  Không có dữ liệu dòng
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cảnh báo an toàn khi danh mục bị cắt bớt do vượt quá giới hạn hiển thị trong Drawer */}
      {block.hasMoreRows && (
        <div className={styles.tableWarningBanner}>
          <span>
            Đang hiển thị <b>{block.rows.length}</b> / <b>{block.totalRowsCount}</b> dòng danh mục.
          </span>
          <a
            href={detailUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.linkDetail}
          >
            Xem toàn bộ {block.totalRowsCount} dòng trong phân hệ ↗
          </a>
        </div>
      )}

      {/* Dòng tổng kết tiền tệ hoặc số lượng đã format sẵn từ Server */}
      {block.totalSummary && (
        <div className={styles.totalSummary}>
          <span>{block.totalSummary.label}:</span>
          <span style={{ color: '#059669' }}>{block.totalSummary.value}</span>
        </div>
      )}
    </div>
  );
}
