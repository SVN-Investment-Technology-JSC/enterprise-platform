'use client';

import type { Asset } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import { buildAssetTree } from '../asset-tree.model';
import { ASSET_TYPE_LABEL } from '../inventory-labels';
import styles from '../inventory.module.scss';

export function AssetTree({
  assets,
  selectedId,
  onSelect,
}: {
  assets: readonly Asset[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');

  const visibleIds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return new Set(assets.map((asset) => asset.id));
    return new Set(
      assets
        .filter(
          (asset) =>
            asset.code.toLowerCase().includes(needle) || asset.name.toLowerCase().includes(needle),
        )
        .map((asset) => asset.id),
    );
  }, [assets, query]);

  const nodes = useMemo(() => buildAssetTree(assets, visibleIds), [assets, visibleIds]);

  return (
    <aside className={styles.treePanel}>
      <input
        className={styles.search}
        placeholder="Tìm theo mã hoặc tên thiết bị…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.tree}>
        {nodes.map(({ asset, depth }) => (
          <button
            key={asset.id}
            type="button"
            className={`${styles.node} ${asset.id === selectedId ? styles.nodeActive : ''}`}
            style={{ marginLeft: `${depth * 0.9}rem` }}
            onClick={() => onSelect(asset.id)}
          >
            <strong>{asset.name}</strong>
            <small>
              {asset.code} · {ASSET_TYPE_LABEL[asset.type]}
            </small>
          </button>
        ))}
        {nodes.length === 0 ? <p className={styles.empty}>Không có tài sản khớp.</p> : null}
      </div>
    </aside>
  );
}
