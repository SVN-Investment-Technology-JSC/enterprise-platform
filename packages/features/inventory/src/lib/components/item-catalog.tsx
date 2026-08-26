'use client';

import type { InventoryItem } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import { formatNumber } from '../inventory-labels';
import styles from '../inventory.module.scss';

const KIND_LABEL: Readonly<Record<InventoryItem['kind'], string>> = {
  STOCK: 'Vật tư kho',
  ASSET: 'Thiết bị',
};

/**
 * Danh mục HỢP NHẤT — vật tư kho và thiết bị trong một bảng.
 *
 * Từ lượt gộp dữ liệu, cả hai đã là cùng một bảng, chỉ khác `kind`. Một cái máy
 * biến áp cũng là một mã vật tư: nó có đơn vị tính, có giá, có thể tồn trong kho
 * trước khi lắp. Tách làm hai màn hình khiến câu hỏi thường gặp nhất — "cái này
 * là gì, còn bao nhiêu, đang lắp ở đâu" — phải tra hai chỗ.
 *
 * Cột "Đang lắp tại" là thứ danh sách vật tư cũ không trả lời được: nó cho biết
 * một thiết bị đang nằm trong kho hay đã ra hiện trường, và ở trạm nào.
 */
export function ItemCatalog({
  items,
  busy,
  onOpenHistory,
}: {
  items: readonly InventoryItem[];
  busy?: boolean;
  onOpenHistory?: (code: string) => void;
}) {
  const [kind, setKind] = useState<'all' | InventoryItem['kind']>('all');
  const [root, setRoot] = useState('all');
  const [query, setQuery] = useState('');

  /** Các nhánh gốc có mặt trong dữ liệu — để lọc theo trạm/nhà máy. */
  const roots = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.rootCode && item.rootName) map.set(item.rootCode, item.rootName);
    }
    return [...map.entries()].sort((left, right) => left[1].localeCompare(right[1], 'vi'));
  }, [items]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (root !== 'all' && item.rootCode !== root) return false;
      if (!needle) return true;
      return (
        item.code.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        (item.installedAtName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [items, kind, root, query]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <h2>Vật tư &amp; thiết bị</h2>
        <span className={styles.badge}>{rows.length}/{items.length}</span>
      </header>

      <div className={styles.itemFilters}>
        <div className={styles.kindTabs}>
          {(['all', 'STOCK', 'ASSET'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={kind === value ? styles.kindOn : undefined}
              onClick={() => setKind(value)}
            >
              {value === 'all' ? 'Tất cả' : KIND_LABEL[value]}
              <span>
                {value === 'all'
                  ? items.length
                  : items.filter((item) => item.kind === value).length}
              </span>
            </button>
          ))}
        </div>

        {roots.length > 0 ? (
          <label>
            Vị trí
            <select value={root} onChange={(event) => setRoot(event.target.value)}>
              <option value="all">Mọi vị trí</option>
              {roots.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <input
          type="search"
          placeholder="Tìm theo mã, tên hoặc vị trí lắp đặt…"
          value={query}
          aria-label="Tìm vật tư"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Mã / Tên</th>
            <th>Loại</th>
            <th className={styles.right}>Tồn khả dụng</th>
            <th>Đang lắp tại</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.code}
              className={onOpenHistory ? styles.clickable : undefined}
              onClick={onOpenHistory && !busy ? () => onOpenHistory(item.code) : undefined}
            >
              <td className={styles.code}>
                {item.code}
                <span className={styles.sub}>{item.name}</span>
              </td>
              <td>
                <span className={item.kind === 'ASSET' ? styles.kindAsset : styles.kindStock}>
                  {KIND_LABEL[item.kind]}
                </span>
              </td>
              <td className={`${styles.numeric} ${styles.right}`}>
                {formatNumber(item.available)} {item.unit ?? ''}
              </td>
              <td>
                {item.installedAtName ? (
                  <>
                    {item.installedAtName}
                    {item.rootName && item.rootName !== item.installedAtName ? (
                      <span className={styles.sub}>{item.rootName}</span>
                    ) : null}
                  </>
                ) : (
                  /* Không có cha nghĩa là chưa lắp vào đâu — đang trong kho, hoặc
                     chính nó là gốc của một nhánh (trạm, nhà máy). */
                  <span className={styles.muted}>
                    {item.kind === 'ASSET' ? 'Chưa lắp / là gốc' : 'Trong kho'}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={styles.muted}>
                Không có mục nào khớp bộ lọc.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
