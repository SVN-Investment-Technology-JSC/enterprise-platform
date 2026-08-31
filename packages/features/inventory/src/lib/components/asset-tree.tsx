'use client';

import type { Asset, InstalledMaterial } from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { useCallback, useMemo, useState } from 'react';
import { buildAssetTree } from '../asset-tree.model';
import styles from '../inventory.module.scss';

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
  onAddAsset,
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
  /** Thêm thiết bị gốc mới cấp cao nhất */
  onAddAsset?: (parentCode?: string) => void;
}) {
  const [query, setQuery] = useState('');
  /** Nhánh đang THU. Mặc định rỗng nghĩa là mọi nhánh đều mở. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /** State kéo thả node */
  const [draggedAsset, setDraggedAsset] = useState<Asset | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  /** Kiểm tra xem targetId có phải là con cháu của draggedAsset hay không để chống lặp vòng */
  const isDescendant = useCallback(
    (targetId: string, parentCandidateId: string): boolean => {
      let current = assets.find((a) => a.id === targetId);
      while (current && current.parentId) {
        if (current.parentId === parentCandidateId) return true;
        current = assets.find((a) => a.id === current?.parentId);
      }
      return false;
    },
    [assets],
  );

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

  // Tìm tất cả các node cha có con
  const parentNodeIds = useMemo(() => {
    const parentIds = new Set<string>();
    for (const a of assets) {
      if (a.parentId) parentIds.add(a.parentId);
    }
    return parentIds;
  }, [assets]);

  const allCollapsed = parentNodeIds.size > 0 && parentNodeIds.size === collapsed.size;

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(parentNodeIds));

  return (
    <aside className={styles.treePanel}>
      <div className={styles.treePanelHead}>
        <div className={styles.treePanelTitleGroup}>
          <span className={styles.treePanelIcon}>🌲</span>
          <div>
            <h3 className={styles.treePanelTitle}>Cây cấu trúc thiết bị</h3>
            <span className={styles.treePanelSubtitle}>{nodes.length} vị trí / thiết bị</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {parentNodeIds.size > 0 ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{
                padding: '3px 6px',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
              title={allCollapsed ? 'Mở rộng toàn bộ cây' : 'Thu gọn toàn bộ cây'}
              onClick={allCollapsed ? expandAll : collapseAll}
            >
              {allCollapsed ? '⊞ Mở' : '⊟ Thu'}
            </button>
          ) : null}
          {onAddAsset ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ padding: '3px 8px', fontSize: '11px' }}
              title="Thêm thiết bị gốc cấp cao nhất"
              onClick={() => onAddAsset(undefined)}
            >
              + Gốc
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.treeSearchBox}>
        <span className={styles.treeSearchIcon}>🔍</span>
        <input
          className={styles.treeSearchInput}
          placeholder="Tìm theo mã hoặc tên thiết bị…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className={styles.treeSearchClear}
            onClick={() => setQuery('')}
            title="Xóa tìm kiếm"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className={styles.tree}>
        {nodes.map(({ asset, depth, hasChildren }) => {
          const line = installedByUnit.get(asset.id);
          const open = hasChildren && !collapsed.has(asset.id);
          const isSelected = asset.id === selectedId;
          const isRoot = depth === 0;

          return (
            <div
              key={asset.id}
              className={`${styles.nodeRow} ${isSelected ? styles.nodeRowSelected : ''}`}
            >
              <div
                className={styles.nodeLine}
                style={{ paddingLeft: `${depth * 1.25 + 0.4}rem` }}
              >
                {/* Đường dẫn phân cấp trực quan */}
                {depth > 0 ? (
                  <span className={styles.treeBranchGuide} aria-hidden="true">
                    └─
                  </span>
                ) : null}

                {/* Nút đóng/mở nhánh */}
                {hasChildren ? (
                  <button
                    type="button"
                    className={`${styles.nodeToggle} ${open ? styles.nodeToggleOpen : ''}`}
                    aria-expanded={open}
                    aria-label={open ? `Thu gọn ${asset.name}` : `Mở rộng ${asset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(asset.id);
                    }}
                  >
                    <svg
                      className={`${styles.nodeToggleSvg} ${open ? styles.nodeToggleSvgOpen : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ) : (
                  <span className={styles.nodeToggleSpacer} aria-hidden="true" />
                )}

                {/* Thẻ Node chính có hỗ trợ kéo thả */}
                <button
                  type="button"
                  draggable={!busy && !!onMove}
                  className={`${styles.node} ${isSelected ? styles.nodeActive : ''} ${
                    draggedAsset?.id === asset.id ? styles.nodeDragging : ''
                  } ${dropTargetId === asset.id ? styles.nodeDropTarget : ''}`}
                  onClick={() => onSelect(asset.id)}
                  onDragStart={(e) => {
                    if (busy || !onMove) return;
                    setDraggedAsset(asset);
                    e.dataTransfer.setData('text/plain', asset.code);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!draggedAsset || draggedAsset.id === asset.id || !onMove) return;
                    // Không cho phép thả vào con cháu của chính nó
                    if (isDescendant(asset.id, draggedAsset.id)) {
                      e.dataTransfer.dropEffect = 'none';
                      return;
                    }
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dropTargetId !== asset.id) {
                      setDropTargetId(asset.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dropTargetId === asset.id) {
                      setDropTargetId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTargetId(null);
                    if (
                      !draggedAsset ||
                      draggedAsset.id === asset.id ||
                      !onMove ||
                      isDescendant(asset.id, draggedAsset.id)
                    ) {
                      return;
                    }
                    // Thả vào node đích: đặt node đích làm cha mới
                    if (draggedAsset.parentId !== asset.id) {
                      onMove(draggedAsset, asset.code);
                    }
                    setDraggedAsset(null);
                  }}
                  onDragEnd={() => {
                    setDraggedAsset(null);
                    setDropTargetId(null);
                  }}
                >
                  <span className={styles.nodeIcon}>
                    {depth === 0 ? '🏢' : depth === 1 ? '🏭' : depth === 2 ? '⚙️' : line ? '📦' : '🔹'}
                  </span>
                  <div className={styles.nodeInfo}>
                    <strong className={styles.nodeName}>{asset.name}</strong>
                    <div className={styles.nodeMeta}>
                      <span className={styles.nodeCodeBadge}>{asset.code}</span>
                      {line ? (
                        <span className={styles.installedQty}>
                          Lắp: {line.quantity} {line.unit ?? ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>

                {/* Cụm nút hành động nhanh (+/−) */}
                <div className={styles.nodeActions}>
                  {onInstall ? (
                    <button
                      type="button"
                      className={styles.nodeAddBtn}
                      disabled={busy}
                      title={`Lắp vật tư vào ${asset.name}`}
                      aria-label={`Lắp vật tư vào ${asset.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstall(asset);
                      }}
                    >
                      +
                    </button>
                  ) : null}

                  {line && onUninstall ? (
                    <Popconfirm
                      title={`Tháo ${asset.name}?`}
                      description={`Vật tư ${line.materialCode} (${line.quantity} ${line.unit ?? ''}) sẽ được hoàn về kho.`}
                      okText="Tháo"
                      okType="danger"
                      placement="left"
                      disabled={busy}
                      onConfirm={() => onUninstall(asset, line)}
                    >
                      <button
                        type="button"
                        className={styles.nodeReturnBtn}
                        disabled={busy}
                        title={`Tháo ${asset.name} (${line.materialCode})`}
                        aria-label={`Tháo ${asset.name}`}
                      >
                        −
                      </button>
                    </Popconfirm>
                  ) : !line && onReturn ? (
                    <Popconfirm
                      title={hasChildren ? `Gỡ cụm ${asset.name}?` : `Gỡ ${asset.name}?`}
                      description={
                        hasChildren
                          ? `Thiết bị này đang chứa các thiết bị/chi tiết con. Việc gỡ sẽ ảnh hưởng đến toàn bộ cấu trúc nhánh bên dưới.`
                          : `Thiết bị ${asset.code} sẽ được gỡ khỏi cây và chuyển vào danh mục thanh lý/nhập kho.`
                      }
                      confirmInput={
                        hasChildren
                          ? {
                              requiredText: asset.code,
                              placeholder: asset.code,
                              label: 'Nhập chính xác mã thiết bị để xác nhận gỡ cụm:',
                            }
                          : undefined
                      }
                      okText={hasChildren ? 'Xác nhận gỡ cụm' : 'Gỡ'}
                      okType="danger"
                      placement="left"
                      disabled={busy}
                      onConfirm={() => onReturn(asset)}
                    >
                      <button
                        type="button"
                        className={styles.nodeReturnBtn}
                        disabled={busy}
                        title={`Gỡ ${asset.name} khỏi cây`}
                        aria-label={`Gỡ ${asset.name} khỏi cây`}
                      >
                        −
                      </button>
                    </Popconfirm>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {/* Khu vực thả để đưa thiết bị lên làm Node Gốc (Cấp 0) */}
        {draggedAsset && onMove && draggedAsset.parentId ? (
          <div
            style={{
              margin: '8px 10px',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1.5px dashed #3b82f6',
              background: '#eff6ff',
              color: '#1d4ed8',
              fontSize: '12px',
              fontWeight: 600,
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'copy',
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggedAsset && onMove) {
                onMove(draggedAsset, null);
                setDraggedAsset(null);
                setDropTargetId(null);
              }
            }}
          >
            <span>🏢</span> Thả vào đây để đưa “{draggedAsset.name}” lên làm Node Gốc
          </div>
        ) : null}

        {nodes.length === 0 ? <p className={styles.empty}>Không có tài sản khớp tìm kiếm.</p> : null}
      </div>
    </aside>
  );
}
