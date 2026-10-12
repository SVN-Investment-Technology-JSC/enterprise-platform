'use client';

import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import { Archive, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './archived-drawer.module.scss';

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN');
}

/**
 * Kho quy trình đã lưu trữ. Bảng chính chỉ giữ quy trình đang dùng; muốn đưa
 * một quy trình trở lại thì mở ngăn này và bấm "Tái kích hoạt".
 */
export function ArchivedDrawer({
  definitions,
  groups,
  busy = false,
  onReactivate,
  onClose,
}: {
  definitions: readonly ProcedureDefinition[];
  groups?: readonly { code: string; label: string }[];
  busy?: boolean;
  /** Vắng mặt khi người dùng không có quyền thiết kế: chỉ xem được danh sách. */
  onReactivate?: (definitionId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const groupLabel = useMemo(
    () => new Map((groups ?? []).map((group) => [group.code, group.label])),
    [groups],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return definitions;
    return definitions.filter(
      (definition) =>
        definition.name.toLowerCase().includes(needle) ||
        definition.code.toLowerCase().includes(needle),
    );
  }, [definitions, query]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.layer}>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label="Sơ đồ lưu trữ">
        <header className={styles.head}>
          <div className={styles.headTitle}>
            <Archive size={16} aria-hidden="true" />
            <h3>Sơ đồ lưu trữ</h3>
            <span className={styles.count}>{definitions.length}</span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <p className={styles.hint}>
          Quy trình đã lưu trữ không hiện trên ma trận. Bấm “Tái kích hoạt” để đưa quy trình về bản
          nháp và tiếp tục thiết kế.
        </p>

        <label className={styles.search}>
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            placeholder="Tìm quy trình lưu trữ…"
            aria-label="Tìm quy trình lưu trữ"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className={styles.body}>
          {rows.length === 0 ? (
            <div className={styles.empty}>
              {definitions.length === 0
                ? 'Chưa có quy trình nào được lưu trữ.'
                : 'Không tìm thấy quy trình phù hợp.'}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Quy trình</th>
                  <th>Nhóm</th>
                  <th className={styles.num}>Số bước</th>
                  <th>Lưu trữ ngày</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {rows.map((definition) => (
                  <tr key={definition.id}>
                    <td>
                      <div className={styles.name} title={definition.name}>
                        {definition.name}
                      </div>
                      <div className={styles.code}>
                        {definition.code} · v{definition.versionNumber}
                      </div>
                    </td>
                    <td>
                      {definition.category
                        ? groupLabel.get(definition.category) ?? definition.category
                        : '—'}
                    </td>
                    <td className={styles.num}>{definition.steps.length}</td>
                    <td>{formatDate(definition.updatedAt)}</td>
                    <td className={styles.action}>
                      {onReactivate ? (
                        <button
                          type="button"
                          className={styles.reactivate}
                          disabled={busy}
                          title="Tái kích hoạt quy trình (chuyển về bản nháp để chỉnh sửa và công bố lại)"
                          onClick={() => onReactivate(definition.id)}
                        >
                          Tái kích hoạt
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
