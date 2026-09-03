'use client';

import type { Asset, InstalledMaterial } from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import React, { useCallback, useMemo, useState } from 'react';
import { buildAssetTree } from '../asset-tree.model';
import styles from '../inventory.module.scss';

/**
 * Helper: Tính toán thụt lề cấp độ sâu (indentation)
 * - Tỷ lệ co giãn mượt mà giữa các cấp độ
 * - Cấp 0: 4px, mỗi cấp con thụt lề thêm 20px
 */
function getIndentationRem(depth: number): string {
  return `${depth * 1.25 + 0.25}rem`;
}

/**
 * Helper: Định nghĩa màu sắc phân cấp (Depth-based badge styling)
 */
interface DepthBadgeStyle {
  readonly bg: string;
  readonly text: string;
  readonly label: string;
}

function getDepthBadgeStyle(depth: number): DepthBadgeStyle {
  switch (depth) {
    case 0:
      return { bg: '#eff6ff', text: '#1d4ed8', label: 'Gốc' };
    case 1:
      return { bg: '#fef3c7', text: '#b45309', label: 'Cấp 1' };
    case 2:
      return { bg: '#f0fdf4', text: '#15803d', label: 'Cấp 2' };
    default:
      return { bg: '#f5f3ff', text: '#6d28d9', label: `Cấp ${depth}` };
  }
}

/**
 * Component hiển thị thẻ tài sản theo từng cấp (AssetNodeCard)
 * - Styling theo độ sâu (depth-based visual styling)
 * - Hỗ trợ kéo thả (Drag & Drop)
 * - Hỗ trợ thao tác phím (Enter / Space để chọn)
 */
interface AssetNodeCardProps {
  readonly asset: Asset;
  readonly depth: number;
  readonly isSelected: boolean;
  readonly isDragging: boolean;
  readonly isDropTarget: boolean;
  readonly installedLine?: InstalledMaterial;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDragStart?: (e: React.DragEvent) => void;
  readonly onDragOver?: (e: React.DragEvent) => void;
  readonly onDragLeave?: (e: React.DragEvent) => void;
  readonly onDrop?: (e: React.DragEvent) => void;
  readonly onDragEnd?: (e: React.DragEvent) => void;
}

function AssetNodeCard({
  asset,
  depth,
  isSelected,
  isDragging,
  isDropTarget,
  installedLine,
  disabled,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: AssetNodeCardProps) {
  const badgeStyle = getDepthBadgeStyle(depth);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`${asset.name} (${asset.code})`}
      draggable={!disabled && !!onDragStart}
      className={`${styles.nodeCard} ${isSelected ? styles.nodeCardSelected : ''} ${
        isDragging ? styles.nodeCardDragging : ''
      } ${isDropTarget ? styles.nodeCardDropTarget : ''}`}
      onClick={() => onSelect(asset.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(asset.id);
        }
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Badge định danh phân cấp độ sâu */}
      <span
        className={styles.nodeDepthBadge}
        style={{
          background: badgeStyle.bg,
          color: badgeStyle.text,
        }}
        title={`Vị trí: ${badgeStyle.label}`}
      >
        {depth === 0 ? 'R' : depth}
      </span>

      <div className={styles.nodeInfo}>
        <strong className={styles.nodeName}>{asset.name}</strong>
        <div className={styles.nodeMeta}>
          <span className={styles.nodeCodeBadge}>{asset.code}</span>
          {installedLine ? (
            <span className={styles.installedQty}>
              Lắp: {installedLine.quantity} {installedLine.unit ?? ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
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
  onAddAsset,
}: {
  assets: readonly Asset[];
  installed?: readonly InstalledMaterial[];
  selectedId?: string;
  busy?: boolean;
  onSelect: (id: string) => void;
  onInstall?: (parent: Asset) => void;
  onUninstall?: (asset: Asset, line: InstalledMaterial) => void;
  onReturn?: (asset: Asset) => void;
  onRename?: (asset: Asset, name: string) => void;
  onMove?: (asset: Asset, parentCode: string | null) => void;
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

  // buildAssetTree đã được đơn giản hóa, không còn isLastFlags
  const nodes = useMemo(
    () => buildAssetTree(assets, visibleIds, query.trim() ? new Set() : collapsed),
    [assets, visibleIds, collapsed, query],
  );

  /** Tra theo id node: node này là một đơn vị đã lắp, và đang lắp bao nhiêu. */
  const installedByUnit = useMemo(
    () => new Map((installed ?? []).map((line) => [line.unitId, line])),
    [installed],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  // Keyboard navigation hỗ trợ điều hướng danh sách tài sản (Mũi tên lên/xuống)
  const handleTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (nodes.length === 0) return;
    const currentIndex = nodes.findIndex((n) => n.asset.id === selectedId);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < nodes.length - 1 ? currentIndex + 1 : 0;
      onSelect(nodes[nextIndex].asset.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : nodes.length - 1;
      onSelect(nodes[prevIndex].asset.id);
    } else if (e.key === 'ArrowRight' && currentIndex >= 0) {
      const currentNode = nodes[currentIndex];
      if (currentNode.hasChildren && collapsed.has(currentNode.asset.id)) {
        e.preventDefault();
        toggle(currentNode.asset.id);
      }
    } else if (e.key === 'ArrowLeft' && currentIndex >= 0) {
      const currentNode = nodes[currentIndex];
      if (currentNode.hasChildren && !collapsed.has(currentNode.asset.id)) {
        e.preventDefault();
        toggle(currentNode.asset.id);
      }
    }
  };

  return (
    <aside className={styles.treePanel}>
      <div className={styles.treePanelHead}>
        <div className={styles.treePanelTitleGroup}>
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
        <span className={styles.treeSearchIcon}></span>
        <input
          className={styles.treeSearchInput}
          placeholder="Tìm theo mã hoặc tên thiết bị… (Phím ↑↓ điều hướng)"
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

      {/* 
        TODO (Mobile Optimization):
        1. Thêm gesture vuốt ngang (swipe) để đóng/mở sidebar trên màn hình nhỏ (<768px).
        2. Tự động thu gọn các nhánh cấp sâu (depth > 2) trên viewport điện thoại để tránh tràn ngang.
        3. Tăng touch target kích thước nút toggle và action buttons lên tối thiểu 36px khi trên mobile.
      */}
      <div
        role="tree"
        aria-label="Cây cấu trúc thiết bị"
        tabIndex={0}
        className={styles.tree}
        onKeyDown={handleTreeKeyDown}
      >
        {nodes.map(({ asset, depth, hasChildren }) => {
          const line = installedByUnit.get(asset.id);
          const open = hasChildren && !collapsed.has(asset.id);
          const isSelected = asset.id === selectedId;

          return (
            <div
              key={asset.id}
              role="treeitem"
              aria-expanded={hasChildren ? open : undefined}
              aria-level={depth + 1}
              className={`${styles.nodeRow} ${isSelected ? styles.nodeRowSelected : ''}`}
            >
              <div
                className={styles.nodeLine}
                style={{ paddingLeft: getIndentationRem(depth) }}
              >
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

                {/* Thẻ Node chính (AssetNodeCard) có depth styling, kéo thả và keyboard accessible */}
                <AssetNodeCard
                  asset={asset}
                  depth={depth}
                  isSelected={isSelected}
                  isDragging={draggedAsset?.id === asset.id}
                  isDropTarget={dropTargetId === asset.id}
                  installedLine={line}
                  disabled={busy}
                  onSelect={onSelect}
                  onDragStart={(e) => {
                    if (busy || !onMove) return;
                    setDraggedAsset(asset);
                    e.dataTransfer.setData('text/plain', asset.code);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!draggedAsset || draggedAsset.id === asset.id || !onMove) return;
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
                    if (draggedAsset.parentId !== asset.id) {
                      onMove(draggedAsset, asset.code);
                    }
                    setDraggedAsset(null);
                  }}
                  onDragEnd={() => {
                    setDraggedAsset(null);
                    setDropTargetId(null);
                  }}
                />

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
            Thả vào đây để đưa “{draggedAsset.name}” lên làm Node Gốc
          </div>
        ) : null}

        {nodes.length === 0 ? <p className={styles.empty}>Không có tài sản khớp tìm kiếm.</p> : null}
      </div>
    </aside>
  );
}
