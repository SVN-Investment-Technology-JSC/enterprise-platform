'use client';

import type { Asset, InstalledMaterial } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState } from 'react';
import { buildAssetTree } from '../asset-tree.model';
import styles from '../inventory.module.scss';

/** Mã của node cha, để điền sẵn khi chuyển nhánh. */
function parentCodeOf(assets: readonly Asset[], asset: Asset): string | undefined {
  return assets.find((candidate) => candidate.id === asset.parentId)?.code;
}

export function AssetTree({
  assets,
  installed,
  selectedId,
  busy,
  onSelect,
  onInstall,
  onUninstall,
  onReturn,
  onRename,
  onMove,
}: {
  assets: readonly Asset[];
  /**
   * Số lượng đang lắp của từng đơn vị trên cây, tra theo id của node.
   *
   * Đơn vị đã lắp LÀ node bình thường — nó có `parent_id` nên lắp tiếp được vật
   * tư con, không cấp nào là cấp cuối. Danh sách này chỉ bổ sung con số và cho
   * biết node đó vốn là mã kho nào.
   */
  installed?: readonly InstalledMaterial[];
  selectedId?: string;
  busy?: boolean;
  onSelect: (id: string) => void;
  /** Lắp một vật tư đang trong kho vào dưới node này. */
  onInstall?: (parent: Asset) => void;
  /** Tháo một đơn vị đang lắp khỏi cây, nhập ngược về kho. */
  onUninstall?: (asset: Asset, line: InstalledMaterial) => void;
  /** Tháo node này khỏi cây, trả về kho. */
  onReturn?: (asset: Asset) => void;
  onRename?: (asset: Asset, name: string) => void;
  /** Đổi cha; `null` là đưa lên làm gốc. */
  onMove?: (asset: Asset, parentCode: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  /** Nhánh đang THU. Mặc định rỗng nghĩa là mọi nhánh đều mở. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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

  const nodes = useMemo(
    // Đang tìm kiếm thì bỏ qua trạng thái thu: giấu mất kết quả khớp là điều
    // cuối cùng người dùng chờ đợi khi họ vừa gõ từ khoá.
    () => buildAssetTree(assets, visibleIds, query.trim() ? new Set() : collapsed),
    [assets, visibleIds, collapsed, query],
  );

  /** Tra theo id node: node này là một đơn vị đã lắp, và đang lắp bao nhiêu. */
  const installedByUnit = useMemo(
    () => new Map((installed ?? []).map((line) => [line.unitId, line])),
    [installed],
  );

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className={styles.treePanel}>
      <input
        className={styles.search}
        placeholder="Tìm theo mã hoặc tên vật tư…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.tree}>
        {nodes.map(({ asset, depth, hasChildren }) => {
          const line = installedByUnit.get(asset.id);
          const open = hasChildren && !collapsed.has(asset.id);
          return (
          <div
            key={asset.id}
            className={styles.nodeRow}
            style={{ marginLeft: `${depth * 0.9}rem` }}
          >
            <div className={styles.nodeLine}>
              {/* Ô giữ chỗ khi không có con, để tên các node vẫn thẳng hàng. */}
              {hasChildren ? (
                <button
                  type="button"
                  className={styles.nodeToggle}
                  aria-expanded={open}
                  aria-label={open ? `Thu gọn ${asset.name}` : `Mở rộng ${asset.name}`}
                  onClick={() => toggle(asset.id)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className={styles.nodeToggleSpacer} aria-hidden="true" />
              )}

              <button
                type="button"
                className={`${styles.node} ${asset.id === selectedId ? styles.nodeActive : ''}`}
                onClick={() => onSelect(asset.id)}
              >
                <strong>{asset.name}</strong>
                <small>
                  {asset.code}
                  {/* Đơn vị đã lắp mang thêm số lượng; node cấu trúc thì không có
                      số nào để hiện. */}
                  {line ? (
                    <span className={styles.installedQty}>
                      {' · đang lắp '}
                      {line.quantity} {line.unit ?? ''}
                    </span>
                  ) : null}
                </small>
              </button>

              {/* +/− đứng cạnh mũi tên, hiện ở MỌI node chứ không chỉ node đang
                  chọn: lắp thêm cấu phần là thao tác thường xuyên, bắt chọn
                  node trước rồi mới bấm là thêm một nhịp thừa. */}
              {onInstall ? (
                <button
                  type="button"
                  className={styles.nodeAdd}
                  disabled={busy}
                  title={`Lắp một vật tư trong kho vào ${asset.name}`}
                  aria-label={`Lắp vật tư vào ${asset.name}`}
                  onClick={() => onInstall(asset)}
                >
                  +
                </button>
              ) : null}
              {line && onUninstall ? (
                <button
                  type="button"
                  className={styles.nodeReturn}
                  disabled={busy}
                  title={`Tháo ${asset.name} khỏi cây và nhập ${line.materialCode} về kho`}
                  aria-label={`Tháo ${asset.name}`}
                  onClick={() => onUninstall(asset, line)}
                >
                  −
                </button>
              ) : !line && onReturn ? (
                <button
                  type="button"
                  className={styles.nodeReturn}
                  disabled={busy}
                  title={`Thanh lý ${asset.name} — tháo cả cụm khỏi cây và nhập về kho`}
                  aria-label={`Trả ${asset.name} về kho`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Tháo “${asset.name}” (${asset.code}) khỏi cây và nhập về kho?`,
                      )
                    ) {
                      onReturn(asset);
                    }
                  }}
                >
                  −
                </button>
              ) : null}
            </div>

            {/* Thao tác cây chỉ hiện trên node ĐANG CHỌN: hiện trên mọi node thì
                một cây vài chục dòng biến thành rừng nút, và nút xoá nằm cạnh
                mọi dòng là mời gọi bấm nhầm. */}
            {asset.id === selectedId ? (
              <div className={styles.nodeTools}>
                {onRename ? (
                  <button
                    type="button"
                    disabled={busy}
                    title="Đổi tên"
                    onClick={() => {
                      const name = window.prompt('Tên mới', asset.name)?.trim();
                      if (name && name !== asset.name) onRename(asset, name);
                    }}
                  >
                    Đổi tên
                  </button>
                ) : null}
                {onMove ? (
                  <button
                    type="button"
                    disabled={busy}
                    title="Chuyển sang node cha khác; bỏ trống để đưa lên làm gốc"
                    onClick={() => {
                      const answer = window.prompt(
                        `Mã vật tư cha mới cho ${asset.code}.\nBỏ trống để đưa lên làm gốc.`,
                        parentCodeOf(assets, asset) ?? '',
                      );
                      if (answer === null) return;
                      const parentCode = answer.trim().toUpperCase();
                      // Tự làm cha của chính mình sẽ tạo chu trình và làm hỏng
                      // mọi truy vấn leo cây.
                      if (parentCode === asset.code) {
                        window.alert('Không thể đặt chính nó làm cha.');
                        return;
                      }
                      onMove(asset, parentCode || null);
                    }}
                  >
                    Chuyển
                  </button>
                ) : null}
              </div>
            ) : null}

          </div>
          );
        })}
        {nodes.length === 0 ? <p className={styles.empty}>Không có tài sản khớp.</p> : null}
      </div>
    </aside>
  );
}
