'use client';

import type { Asset, InstalledMaterial, Warehouse } from '@enterprise-platform/contracts-inventory';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import React, { useCallback, useMemo, useState } from 'react';
import { buildAssetTree } from '../asset-tree.model';
import { AssetListModal } from './asset-list-modal';
import type { BulkReturnItemEntry } from './bulk-return-dialog';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';

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
      className={cn(
        'flex min-w-0 flex-1 cursor-grab select-none items-center gap-2 rounded-md border border-slate-200 bg-white px-[0.6rem] py-[0.35rem] text-left shadow-sm transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none active:cursor-grabbing',
        isSelected && 'border-blue-300 bg-blue-50 shadow-[0_0_0_1px_#3b82f6] hover:border-blue-300 hover:bg-blue-50',
        isDragging && 'border-dashed border-slate-400 bg-slate-100 opacity-45',
        isDropTarget && 'translate-x-1 border-blue-600 bg-blue-50 shadow-[0_0_0_2px_rgba(37,99,235,0.3)] hover:border-blue-600 hover:bg-blue-50',
      )}
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
        className="inline-flex size-[18px] shrink-0 items-center justify-center rounded text-xs font-bold"
        style={{
          background: badgeStyle.bg,
          color: badgeStyle.text,
        }}
        title={`Vị trí: ${badgeStyle.label}`}
      >
        {depth === 0 ? 'R' : depth}
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <strong className="truncate text-sm font-semibold text-slate-900">{asset.name}</strong>
        <div className="flex items-center gap-[0.35rem] text-xs">
          <span className="font-mono font-semibold text-blue-600">{asset.code}</span>
          {installedLine ? (
            <span className="rounded bg-green-100 px-[0.35rem] py-[0.05rem] text-xs font-semibold text-green-800">
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
  warehouses,
  selectedId,
  busy,
  onSelect,
  onInstall,
  onUninstall,
  onReturn,
  onBulkReturn,
  onRename,
  onMove,
  onAddAsset,
}: {
  assets: readonly Asset[];
  installed?: readonly InstalledMaterial[];
  warehouses?: readonly Warehouse[];
  selectedId?: string;
  busy?: boolean;
  onSelect: (id: string) => void;
  onInstall?: (parent: Asset) => void;
  onUninstall?: (asset: Asset, line: InstalledMaterial) => void;
  onReturn?: (asset: Asset) => void;
  onBulkReturn?: (entries: BulkReturnItemEntry[]) => Promise<void> | void;
  onRename?: (asset: Asset, name: string) => void;
  onMove?: (asset: Asset, parentCode: string | null) => void;
  onAddAsset?: (parentCode?: string) => void;
}) {
  const [query, setQuery] = useState('');
  /** Trạng thái mở popup bảng liệt kê danh sách thiết bị đồng cấp */
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);

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
    <aside className="flex flex-col rounded-[10px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <div>
            <h3 className="m-0 text-base font-bold text-slate-900">Cây cấu trúc thiết bị</h3>
            <span className="text-xs text-slate-500">{nodes.length} vị trí / thiết bị</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            title="Mở danh sách thiết bị dạng bảng liệt kê (Popup)"
            onClick={() => setIsTableModalOpen(true)}
          >
            Dạng bảng
          </Button>
          {parentNodeIds.size > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              title={allCollapsed ? 'Mở rộng toàn bộ cây' : 'Thu gọn toàn bộ cây'}
              onClick={allCollapsed ? expandAll : collapseAll}
            >
              {allCollapsed ? '⊞ Mở' : '⊟ Thu'}
            </Button>
          ) : null}
          {onAddAsset ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              title="Thêm thiết bị gốc cấp cao nhất"
              onClick={() => onAddAsset(undefined)}
            >
              + Gốc
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative mb-3 flex items-center">
        <span className="pointer-events-none absolute left-[0.65rem] z-10 text-[13px] text-slate-400"></span>
        <Input
          className="pr-7 pl-[1.85rem]"
          placeholder="Tìm theo mã hoặc tên thiết bị… (Phím ↑↓ điều hướng)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            className="absolute right-2 h-auto px-1 py-0.5 text-[13px] text-slate-400 hover:bg-transparent hover:text-slate-900"
            onClick={() => setQuery('')}
            title="Xóa tìm kiếm"
          >
            ✕
          </Button>
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
        className="flex max-h-[calc(100vh-18rem)] flex-col gap-[0.2rem] overflow-x-hidden overflow-y-auto pr-1 [scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:h-[5px] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-slate-300"
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
              className={cn(
                'group/node flex flex-col rounded-md transition-colors hover:bg-slate-50',
                isSelected && 'bg-blue-50 hover:bg-blue-50',
              )}
            >
              <div
                className="flex min-h-[2.2rem] items-center gap-[0.35rem] py-1 pr-[0.4rem]"
                style={{ paddingLeft: getIndentationRem(depth) }}
              >
                {/* Nút đóng/mở nhánh */}
                {hasChildren ? (
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'inline-flex size-[18px] shrink-0 items-center justify-center rounded border border-slate-200 bg-white p-0 text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800',
                      open && 'bg-slate-50 text-blue-600',
                    )}
                    aria-expanded={open}
                    aria-label={open ? `Thu gọn ${asset.name}` : `Mở rộng ${asset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(asset.id);
                    }}
                  >
                    <svg
                      className={cn('size-[11px] transition-transform duration-150', open && 'rotate-90')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Button>
                ) : (
                  <span className="inline-flex size-[18px] shrink-0" aria-hidden="true" />
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
                <div className={cn('flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/node:opacity-100', isSelected && 'opacity-100')}>
                  {onInstall ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="size-5 min-w-0 rounded border-green-200 bg-green-50 p-0 text-sm font-bold text-green-800 hover:scale-105 hover:border-green-300 hover:bg-green-100"
                      disabled={busy}
                      title={`Lắp vật tư vào ${asset.name}`}
                      aria-label={`Lắp vật tư vào ${asset.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInstall(asset);
                      }}
                    >
                      +
                    </Button>
                  ) : null}

                  {line && onUninstall ? (
                    <Popconfirm
                      title={`Tháo ${asset.name}?`}
                      description={`Xác nhận để mở form tháo dỡ và hoàn kho cho vật tư ${line.materialCode} (${line.quantity} ${line.unit ?? ''}).`}
                      okText="Tiếp tục"
                      okType="danger"
                      placement="left"
                      disabled={busy}
                      onConfirm={() => onUninstall(asset, line)}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className="size-5 min-w-0 rounded border-red-200 bg-red-50 p-0 text-sm font-bold text-red-700 hover:scale-105 hover:border-red-300 hover:bg-red-100"
                        disabled={busy}
                        title={`Tháo ${asset.name} (${line.materialCode})`}
                        aria-label={`Tháo ${asset.name}`}
                      >
                        −
                      </Button>
                    </Popconfirm>
                  ) : !line && onReturn ? (
                    <Popconfirm
                      title={hasChildren ? `Gỡ cụm ${asset.name}?` : `Gỡ ${asset.name}?`}
                      description={
                        hasChildren
                          ? `Thiết bị này đang chứa các thiết bị/chi tiết con. Xác nhận để mở form tháo dỡ cụm.`
                          : `Xác nhận để mở form tháo dỡ và hoàn kho cho thiết bị ${asset.code}.`
                      }
                      okText="Tiếp tục"
                      okType="danger"
                      placement="left"
                      disabled={busy}
                      onConfirm={() => onReturn(asset)}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className="size-5 min-w-0 rounded border-red-200 bg-red-50 p-0 text-sm font-bold text-red-700 hover:scale-105 hover:border-red-300 hover:bg-red-100"
                        disabled={busy}
                        title={`Gỡ ${asset.name} khỏi cây`}
                        aria-label={`Gỡ ${asset.name} khỏi cây`}
                      >
                        −
                      </Button>
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
            className="mx-2.5 my-2 flex cursor-copy items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-blue-500 bg-blue-50 px-3 py-2 text-center text-[13px] font-semibold text-blue-700"
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

        {nodes.length === 0 ? <p className="m-0 py-8 text-center text-slate-500">Không có tài sản khớp tìm kiếm.</p> : null}
      </div>

      {isTableModalOpen ? (
        <AssetListModal
          assets={assets}
          installed={installed}
          warehouses={warehouses}
          selectedId={selectedId}
          busy={busy}
          onSelect={(id) => {
            onSelect(id);
            setIsTableModalOpen(false);
          }}
          onReturn={onReturn}
          onBulkReturn={onBulkReturn}
          onClose={() => setIsTableModalOpen(false)}
        />
      ) : null}
    </aside>
  );
}
