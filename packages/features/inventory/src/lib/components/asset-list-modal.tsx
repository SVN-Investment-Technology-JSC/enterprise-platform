'use client';

import type { Asset, AssetCriticality, AssetStatus, AssetType, InstalledMaterial, Warehouse } from '@enterprise-platform/contracts-inventory';
import { useMemo, useState, useEffect } from 'react';
import { Search, X, Check, Trash2 } from 'lucide-react';
import {
  ASSET_TYPE_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_CRITICALITY_LABEL,
} from '../inventory-labels';
import { BulkReturnToStockDialog, type BulkReturnItemEntry } from './bulk-return-dialog';
import styles from '../inventory.module.scss';

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

  // Esc key để đóng popup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  // Logic chọn Checkbox nhiều thiết bị
  const isAllPageChecked =
    pagedAssets.length > 0 && pagedAssets.every((asset) => checkedIds.has(asset.id));
  const isSomePageChecked =
    pagedAssets.some((asset) => checkedIds.has(asset.id)) && !isAllPageChecked;

  const handleToggleCheckAllPage = () => {
    const next = new Set(checkedIds);
    if (isAllPageChecked) {
      for (const a of pagedAssets) {
        next.delete(a.id);
      }
    } else {
      for (const a of pagedAssets) {
        next.add(a.id);
      }
    }
    setCheckedIds(next);
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

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`${styles.modalDialog} ${styles.modalDialogWide}`}
        style={{
          maxWidth: '1150px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className={styles.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>
              Danh mục Thiết bị (Bảng liệt kê đồng cấp)
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              Danh sách liệt kê toàn bộ {assets.length} thiết bị/vị trí đồng cấp trên hệ thống. Bấm vào một dòng để chọn và xem chi tiết.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            title="Đóng hộp thoại (Esc)"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Thanh tìm kiếm & Bộ lọc nhanh */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Ô tìm kiếm */}
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
              }}
            />
            <input
              type="text"
              placeholder="Tìm theo mã, tên thiết bị, mã sê-ri, nhà sản xuất..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 28px 6px 32px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                outline: 'none',
              }}
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setPage(1);
                }}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ✕
              </button>
            ) : null}
          </div>

          {/* Bộ lọc dropdowns */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Loại thiết bị */}
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#ffffff',
                color: '#334155',
                outline: 'none',
              }}
            >
              <option value="all">Tất cả phân loại</option>
              {(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((k) => (
                <option key={k} value={k}>
                  {ASSET_TYPE_LABEL[k]}
                </option>
              ))}
            </select>

            {/* Tình trạng vận hành */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#ffffff',
                color: '#334155',
                outline: 'none',
              }}
            >
              <option value="all">Tất cả tình trạng</option>
              {(Object.keys(ASSET_STATUS_LABEL) as AssetStatus[]).map((k) => (
                <option key={k} value={k}>
                  {ASSET_STATUS_LABEL[k]}
                </option>
              ))}
            </select>

            {/* Mức độ quan trọng */}
            <select
              value={criticalityFilter}
              onChange={(e) => {
                setCriticalityFilter(e.target.value);
                setPage(1);
              }}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#ffffff',
                color: '#334155',
                outline: 'none',
              }}
            >
              <option value="all">Tất cả mức độ</option>
              {(Object.keys(ASSET_CRITICALITY_LABEL) as AssetCriticality[]).map((k) => (
                <option key={k} value={k}>
                  {ASSET_CRITICALITY_LABEL[k]}
                </option>
              ))}
            </select>

            {isFiltered ? (
              <button
                type="button"
                className={styles.reset}
                style={{ padding: '5px 10px', fontSize: '11.5px' }}
                onClick={resetFilters}
              >
                Xóa lọc
              </button>
            ) : null}
          </div>
        </div>

        {/* Thanh tác vụ hàng loạt (Bulk Action Bar) */}
        {checkedIds.size > 0 ? (
          <div
            style={{
              padding: '8px 20px',
              background: '#eff6ff',
              borderBottom: '1px solid #bfdbfe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '12.5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 600, color: '#1e40af' }}>
                Đã chọn {checkedIds.size} thiết bị
              </span>
              <button
                type="button"
                onClick={handleClearChecked}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#3b82f6',
                  cursor: 'pointer',
                  fontSize: '12px',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Bỏ chọn tất cả
              </button>
            </div>

            {onBulkReturn || onReturn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setIsBulkDialogOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  background: '#fee2e2',
                  color: '#b91c1c',
                  border: '1px solid #fca5a5',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!busy) {
                    e.currentTarget.style.background = '#fecaca';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!busy) {
                    e.currentTarget.style.background = '#fee2e2';
                  }
                }}
              >
                <Trash2 size={14} />
                <span>Gỡ {checkedIds.size} thiết bị đã chọn</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Thân bảng liệt kê dạng list đồng cấp */}
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(90vh - 210px)' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12.5px',
            }}
          >
            <thead>
              <tr
                style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                }}
              >
                {/* Cột Checkbox multi-select header */}
                <th
                  style={{
                    padding: '9px 10px',
                    textAlign: 'center',
                    width: '38px',
                    background: '#f8fafc',
                  }}
                >
                  <input
                    type="checkbox"
                    title="Chọn / Bỏ chọn toàn bộ trang hiện tại"
                    aria-label="Chọn toàn bộ trang"
                    checked={isAllPageChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomePageChecked;
                    }}
                    onChange={handleToggleCheckAllPage}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontSize: '11.5px',
                    color: '#64748b',
                    width: '45px',
                    background: '#f8fafc',
                  }}
                >
                  STT
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: sortField === 'code' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    background: '#f8fafc',
                  }}
                  onClick={() => handleSort('code')}
                  title="Bấm để sắp xếp theo mã thiết bị"
                >
                  Mã thiết bị {sortField === 'code' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: sortField === 'name' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: '#f8fafc',
                  }}
                  onClick={() => handleSort('name')}
                  title="Bấm để sắp xếp theo tên thiết bị"
                >
                  Tên thiết bị {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: sortField === 'type' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    background: '#f8fafc',
                  }}
                  onClick={() => handleSort('type')}
                  title="Bấm để sắp xếp theo phân loại"
                >
                  Phân loại {sortField === 'type' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: sortField === 'parent' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    background: '#f8fafc',
                  }}
                  onClick={() => handleSort('parent')}
                  title="Bấm để sắp xếp theo vị trí/thiết bị cha"
                >
                  Vị trí / Thiết bị cha {sortField === 'parent' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: sortField === 'status' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    background: '#f8fafc',
                  }}
                  onClick={() => handleSort('status')}
                  title="Bấm để sắp xếp theo tình trạng"
                >
                  Tình trạng {sortField === 'status' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: sortField === 'criticality' ? '#2563eb' : '#64748b',
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    background: '#f8fafc',
                  }}
                  onClick={() => handleSort('criticality')}
                  title="Bấm để sắp xếp theo mức độ quan trọng"
                >
                  Độ quan trọng {sortField === 'criticality' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontSize: '11.5px',
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                    background: '#f8fafc',
                  }}
                >
                  Linh kiện lắp ráp
                </th>
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontSize: '11.5px',
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                    width: '110px',
                    background: '#f8fafc',
                  }}
                >
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedAssets.map((asset, idx) => {
                const isSelected = asset.id === selectedId;
                const isChecked = checkedIds.has(asset.id);
                const parent = asset.parentId ? parentMap.get(asset.parentId) : undefined;
                const line = installedByUnit.get(asset.id);
                const stt = (safePage - 1) * pageSize + idx + 1;

                return (
                  <tr
                    key={asset.id}
                    onClick={() => handleSelectAndClose(asset.id)}
                    style={{
                      cursor: 'pointer',
                      background: isChecked ? '#f0fdf4' : isSelected ? '#eff6ff' : undefined,
                      borderLeft: isChecked
                        ? '4px solid #16a34a'
                        : isSelected
                        ? '4px solid #2563eb'
                        : '4px solid transparent',
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isChecked) e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected && !isChecked) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* Cột Checkbox multi-select row */}
                    <td
                      style={{ padding: '10px 10px', textAlign: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        title={`Chọn thiết bị ${asset.name} (${asset.code})`}
                        aria-label={`Chọn thiết bị ${asset.code}`}
                        checked={isChecked}
                        onChange={() => handleToggleCheckAsset(asset.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>

                    {/* STT */}
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '11.5px' }}>
                      {stt}
                    </td>

                    {/* Mã thiết bị */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span className={styles.nodeCodeBadge} style={{ fontWeight: 700, fontSize: '12px' }}>
                        {asset.code}
                      </span>
                    </td>

                    {/* Tên thiết bị */}
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: isSelected ? '#1d4ed8' : '#0f172a' }}>
                        {asset.name}
                      </div>
                      {asset.serialNumber ? (
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          S/N: {asset.serialNumber} {asset.manufacturer ? `· Hãng: ${asset.manufacturer}` : ''}
                        </div>
                      ) : null}
                    </td>

                    {/* Phân loại */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span className={styles.typeBadge}>
                        {ASSET_TYPE_LABEL[asset.type] ?? asset.type}
                      </span>
                    </td>

                    {/* Vị trí / Thiết bị cha */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {parent ? (
                        <span
                          style={{ color: '#334155', fontSize: '12px' }}
                          title={`Thuộc ${parent.name} (${parent.code})`}
                        >
                          ↳ <strong>{parent.name}</strong> <code style={{ fontSize: '11px', color: '#64748b' }}>({parent.code})</code>
                        </span>
                      ) : (
                        <span
                          style={{
                            color: '#15803d',
                            fontWeight: 600,
                            fontSize: '11px',
                            background: '#dcfce7',
                            padding: '2px 8px',
                            borderRadius: '4px',
                          }}
                        >
                          Node Gốc
                        </span>
                      )}
                    </td>

                    {/* Tình trạng vận hành */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span className={`${styles.statusBadge} ${styles[`status_${asset.status}`] ?? ''}`}>
                        {ASSET_STATUS_LABEL[asset.status] ?? asset.status}
                      </span>
                    </td>

                    {/* Độ quan trọng */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 600,
                          color:
                            asset.criticality === 'CRITICAL'
                              ? '#dc2626'
                              : asset.criticality === 'HIGH'
                              ? '#ea580c'
                              : asset.criticality === 'MEDIUM'
                              ? '#0284c7'
                              : '#64748b',
                        }}
                      >
                        {ASSET_CRITICALITY_LABEL[asset.criticality] ?? asset.criticality}
                      </span>
                    </td>

                    {/* Linh kiện lắp ráp */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {line ? (
                        <span className={styles.installedQty} style={{ fontSize: '11px' }}>
                          Lắp: {line.quantity} {line.unit ?? ''}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '11.5px' }}>—</span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.editRowBtn}
                        onClick={() => handleSelectAndClose(asset.id)}
                        title={`Xem chi tiết thiết bị ${asset.name}`}
                        style={{ fontSize: '11.5px', padding: '3px 8px' }}
                      >
                        {isSelected ? (
                          <>
                            <Check size={12} color="#16a34a" />
                            <span>Đang chọn</span>
                          </>
                        ) : (
                          <span>Chọn xem →</span>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sortedAssets.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      textAlign: 'center',
                      padding: '36px 16px',
                      color: '#94a3b8',
                      fontSize: '13px',
                    }}
                  >
                    {isFiltered
                      ? 'Không tìm thấy thiết bị nào khớp với tiêu chí tìm kiếm/bộ lọc.'
                      : 'Chưa có thiết bị nào trong danh sách.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Footer phân trang & Đóng */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12px',
            color: '#64748b',
          }}
        >
          {/* Thông tin số lượng & Select page size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span>
              Hiển thị <strong>{sortedAssets.length > 0 ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, sortedAssets.length)}</strong> / <strong>{sortedAssets.length}</strong> thiết bị
              {assets.length !== sortedAssets.length ? ` (tổng ${assets.length})` : ''}
            </span>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#64748b' }}>
              <span>Hiển thị:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) || 15);
                  setPage(1);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#0f172a',
                  fontSize: '11.5px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value={15}>15 / trang</option>
                <option value={30}>30 / trang</option>
                <option value={45}>45 / trang</option>
                <option value={60}>60 / trang</option>
              </select>
            </label>
          </div>

          {/* Cụm nút lùi/tiến trang & Đóng */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className={styles.reset}
                style={{ padding: '4px 10px', fontSize: '11.5px' }}
                disabled={safePage <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                ← Trước
              </button>
              <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '12px', minWidth: '40px', textAlign: 'center' }}>
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className={styles.reset}
                style={{ padding: '4px 10px', fontSize: '11.5px' }}
                disabled={safePage >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Sau →
              </button>
            </div>

            <button
              type="button"
              className={styles.btnSecondary}
              style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600 }}
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>
      </div>

      {isBulkDialogOpen ? (
        <BulkReturnToStockDialog
          assets={checkedAssets}
          warehouses={warehouses}
          busy={busy}
          onCancel={() => setIsBulkDialogOpen(false)}
          onConfirm={handleConfirmBulkReturn}
        />
      ) : null}
    </div>
  );
}
