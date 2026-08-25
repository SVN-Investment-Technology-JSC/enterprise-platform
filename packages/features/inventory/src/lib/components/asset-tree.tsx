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
  onAddAsset,
}: {
  assets: readonly Asset[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAddAsset?: () => void;
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
          Cây Tài Sản 360
        </h3>
        {onAddAsset ? (
          <button
            type="button"
            className={styles.btnPrimary}
            style={{ padding: '4px 10px', fontSize: '12px' }}
            onClick={onAddAsset}
          >
            + Thiết bị
          </button>
        ) : null}
      </div>

      <input
        style={{
          width: '100%',
          padding: '7px 12px',
          borderRadius: '8px',
          border: '1px solid var(--pe-border-subtle)',
          fontSize: '13px',
          outline: 'none',
        }}
        placeholder="Tìm kiếm thiết bị / cụm…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className={styles.tree}>
        {nodes.map(({ asset, depth }) => {
          const isActive = asset.id === selectedId;
          return (
            <button
              key={asset.id}
              type="button"
              className={`${styles.node} ${isActive ? styles.nodeActive : ''}`}
              style={{ paddingLeft: `${Math.max(12, depth * 18 + 10)}px` }}
              onClick={() => onSelect(asset.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--pe-text-muted)' }}>
                  {depth === 0 ? '🏢' : depth === 1 ? '🏭' : depth === 2 ? '⚙️' : '🔹'}
                </span>
                <strong>{asset.name}</strong>
              </div>
              <small style={{ paddingLeft: '18px' }}>
                {asset.code} · {ASSET_TYPE_LABEL[asset.type]}
              </small>
            </button>
          );
        })}
        {nodes.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '24px', color: 'var(--pe-text-muted)', fontSize: '13px' }}>
            Không tìm thấy tài sản nào phù hợp.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
