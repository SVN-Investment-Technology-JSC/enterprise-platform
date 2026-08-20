'use client';

import { useEffect, useState } from 'react';
import { loadAssetTasks, type AssetTaskList } from '../maintenance-api';
import styles from './asset-task-panel.module.scss';

/** Template lấy từ Kho không có kiểu chặt — chấp nhận vài cách đặt tên thường gặp. */
function taskLabel(entry: Record<string, unknown>, index: number): string {
  for (const key of ['name', 'title', 'step', 'label']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return `Đầu việc ${index + 1}`;
}

function taskKey(entry: Record<string, unknown>): string | undefined {
  const value = entry['key'];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function taskMinutes(entry: Record<string, unknown>): number | undefined {
  const value = entry['durationMinutes'];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Đầu việc bảo trì của một thiết bị, xem ngay trong module Bảo trì.
 *
 * Trước đây bấm vào badge sẽ chuyển hẳn sang module Kho bằng
 * `/modules/inventory#assets:<mã>` — mà không nơi nào xử lý dạng hash đó, nên
 * người dùng rơi vào tab mặc định và không thấy thiết bị mình vừa bấm. Panel này
 * đọc thẳng từ Kho qua endpoint của Bảo trì; Bảo trì không giữ bản sao nào.
 */
export function AssetTaskPanel({ assetCode, onClose }: { assetCode: string; onClose: () => void }) {
  const [data, setData] = useState<AssetTaskList>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError(undefined);
    loadAssetTasks(assetCode)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Không đọc được đầu việc từ Kho.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetCode]);

  const total = (data?.tasks ?? []).reduce((sum, entry) => sum + (taskMinutes(entry) ?? 0), 0);

  return (
    <aside className={styles.panel}>
      <header>
        <div>
          <span className={styles.eyebrow}>Đầu việc bảo trì</span>
          <h3>{data?.assetName ?? assetCode}</h3>
          <p>{assetCode}</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </header>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : !data ? (
        <p className={styles.hint}>Đang đọc từ Kho…</p>
      ) : data.tasks.length === 0 ? (
        <p className={styles.hint}>
          Thiết bị này chưa khai báo đầu việc nào. Khai báo trong hồ sơ thiết bị bên Kho.
        </p>
      ) : (
        <>
          <p className={styles.hint}>
            {data.tasks.length} đầu việc
            {total > 0 ? ` · khoảng ${total} phút` : ''}. Đây cũng là danh sách vai trò E nhận được
            khi quy trình công bố.
          </p>
          <ol className={styles.list}>
            {data.tasks.map((entry, index) => (
              <li key={index}>
                {taskKey(entry) ? <span className={styles.key}>{taskKey(entry)}</span> : null}
                <span>{taskLabel(entry, index)}</span>
                {taskMinutes(entry) ? <em>{taskMinutes(entry)} phút</em> : null}
              </li>
            ))}
          </ol>
        </>
      )}

      <a className={styles.link} href={`/modules/inventory#assets`}>
        Sửa trong Kho →
      </a>
    </aside>
  );
}
