'use client';

import type { Asset, AssetCriticality, AssetStatus, AssetType, InstalledMaterial, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import { Search, Check, Trash2 } from 'lucide-react';
import {
  ASSET_TYPE_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_CRITICALITY_LABEL,
} from '../inventory-labels';
import { BulkReturnToStockDialog, type BulkReturnItemEntry } from './bulk-return-dialog';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Dialog, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';

/** Màu pill tình trạng; tình trạng ngoài bốn giá trị dựng sẵn không có màu riêng. */
const ASSET_STATUS_TONE: Readonly<Record<string, string>> = {
  OPERATING: 'border-green-200 bg-green-50 text-green-800',
  STOPPED: 'border-red-200 bg-red-50 text-red-800',
  MAINTENANCE: 'border-amber-200 bg-amber-50 text-amber-700',
  DISPOSED: 'border-slate-300 bg-slate-100 text-slate-500',
};

const sortHeadClass = 'cursor-pointer select-none py-[9px] text-xs text-slate-500';

const pageSizeOptions = [15, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} / trang` }));

export interface AssetListModalProps {
  assets: readonly Asset[];
  installed?: readonly InstalledMaterial[];
  warehouses?: readonly Warehouse[];
  selectedId?: string;
  busy?: boolean;
  onSelect: (id: string) => void;
  onReturn?: (asset: Asset) => void;
  onBulkReturn?: (entries: BulkReturnItemEntry[]) => Promise<void> | void;
  onClose: () => void;
}

export function AssetListModal({
  assets,
  installed,
  warehouses = [],
  selectedId,
  busy = false,
  onSelect,
  onReturn,
  onBulkReturn,
  onClose,
}: AssetListModalProps) {
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [criticalityFilter, setCriticalityFilter] = useState<string>('all');

  const [sortField, setSortField] = useState<'code' | 'name' | 'type' | 'parent' | 'status' | 'criticality'>('code');
  const [sortAsc, setSortAsc] = useState(true);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Tra cứu thiết bị cha theo parentId
  const parentMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  // Tra cứu installed material theo unitId
  const installedByUnit = useMemo(
    () => new Map((installed ?? []).map((line) => [line.unitId, line])),
    [installed],
  );

  // Lọc dữ liệu
  const filteredAssets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
      if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
      if (criticalityFilter !== 'all' && asset.criticality !== criticalityFilter) return false;

      if (!q) return true;
      const parent = asset.parentId ? parentMap.get(asset.parentId) : undefined;
      return (
        asset.code.toLowerCase().includes(q) ||
        asset.name.toLowerCase().includes(q) ||
        (asset.serialNumber ?? '').toLowerCase().includes(q) ||
        (asset.manufacturer ?? '').toLowerCase().includes(q) ||
        (parent?.name ?? '').toLowerCase().includes(q) ||
        (parent?.code ?? '').toLowerCase().includes(q)
      );
    });
  }, [assets, searchTerm, typeFilter, statusFilter, criticalityFilter, parentMap]);

  // Sắp xếp
  const sortedAssets = useMemo(() => {
    return [...filteredAssets].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'code') {
        cmp = a.code.localeCompare(b.code, 'vi');
      } else if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, 'vi');
      } else if (sortField === 'type') {
        cmp = (a.type ?? '').localeCompare(b.type ?? '', 'vi');
      } else if (sortField === 'parent') {
        const parentA = a.parentId ? parentMap.get(a.parentId)?.name ?? '' : '';
        const parentB = b.parentId ? parentMap.get(b.parentId)?.name ?? '' : '';
        cmp = parentA.localeCompare(parentB, 'vi');
      } else if (sortField === 'status') {
        cmp = (a.status ?? '').localeCompare(b.status ?? '', 'vi');
      } else if (sortField === 'criticality') {
        cmp = (a.criticality ?? '').localeCompare(b.criticality ?? '', 'vi');
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filteredAssets, sortField, sortAsc, parentMap]);

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(sortedAssets.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedAssets = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedAssets.slice(start, start + pageSize);
  }, [sortedAssets, safePage, pageSize]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleSelectAndClose = (assetId: string) => {
    onSelect(assetId);
    onClose();
  };

  const isFiltered =
    searchTerm.trim() !== '' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    criticalityFilter !== 'all';

  const resetFilters = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setStatusFilter('all');
    setCriticalityFilter('all');
    setPage(1);
  };

  // Logic chọn Checkbox nhiều thiết bị (toàn bộ danh sách)
  const isAllAssetsChecked =
    sortedAssets.length > 0 && sortedAssets.every((asset) => checkedIds.has(asset.id));
  const isSomeAssetsChecked =
    sortedAssets.some((asset) => checkedIds.has(asset.id)) && !isAllAssetsChecked;

  const handleToggleCheckAll = () => {
    if (isAllAssetsChecked) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(sortedAssets.map((a) => a.id)));
    }
  };

  const handleToggleCheckAsset = (assetId: string) => {
    const next = new Set(checkedIds);
    if (next.has(assetId)) {
      next.delete(assetId);
    } else {
      next.add(assetId);
    }
    setCheckedIds(next);
  };

  const handleClearChecked = () => {
    setCheckedIds(new Set());
  };

  const checkedAssets = useMemo(() => {
    return assets.filter((a) => checkedIds.has(a.id));
  }, [assets, checkedIds]);

  const handleConfirmBulkReturn = async (entries: BulkReturnItemEntry[]) => {
    if (entries.length === 0) return;
    if (onBulkReturn) {
      await onBulkReturn(entries);
    } else if (onReturn) {
      for (const entry of entries) {
        onReturn(entry.asset);
      }
    }
    setCheckedIds(new Set());
    setIsBulkDialogOpen(false);
    onClose();
  };

  const typeOptions = [
    { value: 'all', label: 'Tất cả phân loại' },
    ...(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((k) => ({ value: k, label: ASSET_TYPE_LABEL[k] })),
  ];
  const statusOptions = [
    { value: 'all', label: 'Tất cả tình trạng' },
    ...(Object.keys(ASSET_STATUS_LABEL) as AssetStatus[]).map((k) => ({ value: k, label: ASSET_STATUS_LABEL[k] })),
  ];
  const criticalityOptions = [
    { value: 'all', label: 'Tất cả mức độ' },
    ...(Object.keys(ASSET_CRITICALITY_LABEL) as AssetCriticality[]).map((k) => ({
      value: k,
      label: ASSET_CRITICALITY_LABEL[k],
    })),
  ];

  return (
    <Dialog onEscape={isBulkDialogOpen ? undefined : onClose}>
      <DialogContent className="max-h-[90vh] max-w-[1150px]" aria-label="Danh mục Thiết bị">
        <DialogHeader>
          <div>
            <DialogTitle>Danh mục Thiết bị (Bảng liệt kê đồng cấp)</DialogTitle>
            <p className="mt-1 mb-0 text-sm text-slate-500">
              Danh sách liệt kê toàn bộ {assets.length} thiết bị/vị trí đồng cấp trên hệ thống. Bấm vào một dòng để chọn và xem chi tiết.
            </p>
          </div>
          <DialogCloseButton title="Đóng hộp thoại (Esc)" onClick={onClose} />
        </DialogHeader>

        {/* Thanh tìm kiếm & Bộ lọc nhanh */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 bg-slate-50 px-5 py-3">
          {/* Ô tìm kiếm */}
          <div className="relative min-w-[260px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2 text-slate-400"
            />
            <Input
              type="text"
              className="h-8 pr-7 pl-8 text-[13px]"
              placeholder="Tìm theo mã, tên thiết bị, mã sê-ri, nhà sản xuất..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />
            {searchTerm ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchTerm('');
                  setPage(1);
                }}
                className="absolute top-1/2 right-2 h-auto -translate-y-1/2 p-0 text-slate-400 hover:bg-transparent hover:text-slate-900"
              >
                ✕
              </Button>
            ) : null}
          </div>

          {/* Bộ lọc dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Loại thiết bị */}
            <SearchableSelect
              options={typeOptions}
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value || 'all');
                setPage(1);
              }}
              clearable={false}
              searchInDropdown
              hideDropdownSearch
              height={32}
              style={{ width: 180 }}
            />

            {/* Tình trạng vận hành */}
            <SearchableSelect
              options={statusOptions}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value || 'all');
                setPage(1);
              }}
              clearable={false}
              searchInDropdown
              hideDropdownSearch
              height={32}
              style={{ width: 180 }}
            />

            {/* Mức độ quan trọng */}
            <SearchableSelect
              options={criticalityOptions}
              value={criticalityFilter}
              onChange={(value) => {
                setCriticalityFilter(value || 'all');
                setPage(1);
              }}
              clearable={false}
              searchInDropdown
              hideDropdownSearch
              height={32}
              style={{ width: 170 }}
            />

            {isFiltered ? (
              <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                Xóa lọc
              </Button>
            ) : null}
          </div>
        </div>

        {/* Thanh tác vụ hàng loạt (Bulk Action Bar) */}
        {checkedIds.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-5 py-2 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-blue-800">
                Đã chọn {checkedIds.size} thiết bị
              </span>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-[13px] text-blue-500"
                onClick={handleClearChecked}
              >
                Bỏ chọn tất cả
              </Button>
            </div>

            {onBulkReturn || onReturn ? (
              <Button
                type="button"
                variant="destructive"
                className="border-red-300 bg-red-100 px-3 font-semibold hover:bg-red-200"
                disabled={busy}
                onClick={() => setIsBulkDialogOpen(true)}
              >
                <Trash2 size={14} />
                <span>Gỡ {checkedIds.size} thiết bị đã chọn</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Thân bảng liệt kê dạng list đồng cấp */}
        <TableWrap className="max-h-[calc(90vh-210px)] flex-1">
          <Table className="text-[13px]">
            <TableHead>
              <TableRow className="hover:bg-slate-50">
                {/* Cột Checkbox multi-select header */}
                <TableHeaderCell className="w-[38px] px-2.5 py-[9px] text-center">
                  <input
                    type="checkbox"
                    title={isAllAssetsChecked ? 'Bỏ chọn toàn bộ' : `Chọn toàn bộ ${sortedAssets.length} thiết bị`}
                    aria-label="Chọn toàn bộ thiết bị"
                    checked={isAllAssetsChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomeAssetsChecked;
                    }}
                    onChange={handleToggleCheckAll}
                    className="cursor-pointer"
                  />
                </TableHeaderCell>
                <TableHeaderCell className="w-[45px] py-[9px] text-center text-xs text-slate-500">
                  STT
                </TableHeaderCell>
                <TableHeaderCell
                  className={cn(sortHeadClass, 'whitespace-nowrap', sortField === 'code' && 'text-blue-600')}
                  onClick={() => handleSort('code')}
                  title="Bấm để sắp xếp theo mã thiết bị"
                >
                  Mã thiết bị {sortField === 'code' ? (sortAsc ? '▲' : '▼') : ''}
                </TableHeaderCell>
                <TableHeaderCell
                  className={cn(sortHeadClass, sortField === 'name' && 'text-blue-600')}
                  onClick={() => handleSort('name')}
                  title="Bấm để sắp xếp theo tên thiết bị"
                >
                  Tên thiết bị {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                </TableHeaderCell>
                <TableHeaderCell
                  className={cn(sortHeadClass, 'whitespace-nowrap', sortField === 'type' && 'text-blue-600')}
                  onClick={() => handleSort('type')}
                  title="Bấm để sắp xếp theo phân loại"
                >
                  Phân loại {sortField === 'type' ? (sortAsc ? '▲' : '▼') : ''}
                </TableHeaderCell>
                <TableHeaderCell
                  className={cn(sortHeadClass, 'whitespace-nowrap', sortField === 'parent' && 'text-blue-600')}
                  onClick={() => handleSort('parent')}
                  title="Bấm để sắp xếp theo vị trí/thiết bị cha"
                >
                  Vị trí / Thiết bị cha {sortField === 'parent' ? (sortAsc ? '▲' : '▼') : ''}
                </TableHeaderCell>
                <TableHeaderCell
                  className={cn(sortHeadClass, 'whitespace-nowrap', sortField === 'status' && 'text-blue-600')}
                  onClick={() => handleSort('status')}
                  title="Bấm để sắp xếp theo tình trạng"
                >
                  Tình trạng {sortField === 'status' ? (sortAsc ? '▲' : '▼') : ''}
                </TableHeaderCell>
                <TableHeaderCell
                  className={cn(sortHeadClass, 'whitespace-nowrap', sortField === 'criticality' && 'text-blue-600')}
                  onClick={() => handleSort('criticality')}
                  title="Bấm để sắp xếp theo mức độ quan trọng"
                >
                  Độ quan trọng {sortField === 'criticality' ? (sortAsc ? '▲' : '▼') : ''}
                </TableHeaderCell>
                <TableHeaderCell className="py-[9px] text-xs whitespace-nowrap text-slate-500">
                  Linh kiện lắp ráp
                </TableHeaderCell>
                <TableHeaderCell className="w-[110px] py-[9px] text-center text-xs whitespace-nowrap text-slate-500">
                  Thao tác
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedAssets.map((asset, idx) => {
                const isSelected = asset.id === selectedId;
                const isChecked = checkedIds.has(asset.id);
                const parent = asset.parentId ? parentMap.get(asset.parentId) : undefined;
                const line = installedByUnit.get(asset.id);
                const stt = (safePage - 1) * pageSize + idx + 1;

                return (
                  <TableRow
                    key={asset.id}
                    onClick={() => handleSelectAndClose(asset.id)}
                    className={cn(
                      'cursor-pointer border-l-4 border-l-transparent',
                      isChecked
                        ? 'border-l-green-600 bg-green-50 hover:bg-green-50'
                        : isSelected && 'border-l-blue-600 bg-blue-50 hover:bg-blue-50',
                    )}
                  >
                    {/* Cột Checkbox multi-select row */}
                    <TableCell
                      className="px-2.5 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        title={`Chọn thiết bị ${asset.name} (${asset.code})`}
                        aria-label={`Chọn thiết bị ${asset.code}`}
                        checked={isChecked}
                        onChange={() => handleToggleCheckAsset(asset.id)}
                        className="cursor-pointer"
                      />
                    </TableCell>

                    {/* STT */}
                    <TableCell className="text-center text-xs text-slate-400">
                      {stt}
                    </TableCell>

                    {/* Mã thiết bị */}
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-[13px] font-bold text-blue-600">
                        {asset.code}
                      </span>
                    </TableCell>

                    {/* Tên thiết bị */}
                    <TableCell>
                      <div className={cn('font-semibold', isSelected ? 'text-blue-700' : 'text-slate-900')}>
                        {asset.name}
                      </div>
                      {asset.serialNumber ? (
                        <div className="text-xs text-slate-500">
                          S/N: {asset.serialNumber} {asset.manufacturer ? `· Hãng: ${asset.manufacturer}` : ''}
                        </div>
                      ) : null}
                    </TableCell>

                    {/* Phân loại */}
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-block rounded border border-slate-200 bg-slate-100 px-2 py-[0.15rem] text-[13px] font-semibold text-slate-700">
                        {ASSET_TYPE_LABEL[asset.type] ?? asset.type}
                      </span>
                    </TableCell>

                    {/* Vị trí / Thiết bị cha */}
                    <TableCell className="whitespace-nowrap">
                      {parent ? (
                        <span
                          className="text-[13px] text-slate-700"
                          title={`Thuộc ${parent.name} (${parent.code})`}
                        >
                          ↳ <strong>{parent.name}</strong> <code className="text-xs text-slate-500">({parent.code})</code>
                        </span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          Node Gốc
                        </span>
                      )}
                    </TableCell>

                    {/* Tình trạng vận hành */}
                    <TableCell className="whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center gap-[0.35rem] rounded-full border px-[0.55rem] py-[0.15rem] text-xs font-bold whitespace-nowrap',
                          ASSET_STATUS_TONE[asset.status],
                        )}
                      >
                        {ASSET_STATUS_LABEL[asset.status] ?? asset.status}
                      </span>
                    </TableCell>

                    {/* Độ quan trọng */}
                    <TableCell className="whitespace-nowrap">
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          asset.criticality === 'CRITICAL'
                            ? 'text-red-600'
                            : asset.criticality === 'HIGH'
                              ? 'text-orange-600'
                              : asset.criticality === 'MEDIUM'
                                ? 'text-sky-600'
                                : 'text-slate-500',
                        )}
                      >
                        {ASSET_CRITICALITY_LABEL[asset.criticality] ?? asset.criticality}
                      </span>
                    </TableCell>

                    {/* Linh kiện lắp ráp */}
                    <TableCell className="whitespace-nowrap">
                      {line ? (
                        <span className="rounded bg-green-100 px-[0.35rem] py-[0.05rem] text-xs font-semibold text-green-800">
                          Lắp: {line.quantity} {line.unit ?? ''}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>

                    {/* Thao tác */}
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleSelectAndClose(asset.id)}
                        title={`Xem chi tiết thiết bị ${asset.name}`}
                      >
                        {isSelected ? (
                          <>
                            <Check size={12} color="#16a34a" />
                            <span>Đang chọn</span>
                          </>
                        ) : (
                          <span>Chọn xem →</span>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedAssets.length === 0 ? (
                <TableEmpty colSpan={10}>
                  {isFiltered
                    ? 'Không tìm thấy thiết bị nào khớp với tiêu chí tìm kiếm/bộ lọc.'
                    : 'Chưa có thiết bị nào trong danh sách.'}
                </TableEmpty>
              ) : null}
            </TableBody>
          </Table>
        </TableWrap>

        {/* Footer phân trang & Đóng */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3 text-[13px] text-slate-500">
          {/* Thông tin số lượng & Select page size */}
          <div className="flex flex-wrap items-center gap-3.5">
            <span>
              Hiển thị <strong>{sortedAssets.length > 0 ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, sortedAssets.length)}</strong> / <strong>{sortedAssets.length}</strong> thiết bị
              {assets.length !== sortedAssets.length ? ` (tổng ${assets.length})` : ''}
            </span>

            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span>Hiển thị:</span>
              <SearchableSelect
                options={pageSizeOptions}
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value) || 15);
                  setPage(1);
                }}
                clearable={false}
                searchInDropdown
                hideDropdownSearch
                height={28}
                style={{ width: 110 }}
              />
            </span>
          </div>

          {/* Cụm nút lùi/tiến trang & Đóng */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                ← Trước
              </Button>
              <span className="min-w-10 text-center text-[13px] font-semibold text-slate-900">
                {safePage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Sau →
              </Button>
            </div>

            <Button type="button" variant="outline" onClick={onClose}>
              Đóng
            </Button>
          </div>
        </div>
      </DialogContent>

      {isBulkDialogOpen ? (
        <BulkReturnToStockDialog
          assets={checkedAssets}
          warehouses={warehouses}
          busy={busy}
          onCancel={() => setIsBulkDialogOpen(false)}
          onConfirm={handleConfirmBulkReturn}
        />
      ) : null}
    </Dialog>
  );
}
