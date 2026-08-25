'use client';

import type { Material } from '@enterprise-platform/contracts-inventory';
import { Fragment, useMemo, useState } from 'react';
import type { InventoryReservationRow, InventoryWorkspace } from '../inventory-api';
import {
  MATERIAL_CATEGORY_LABEL,
  formatNumber,
} from '../inventory-labels';
import styles from '../inventory.module.scss';

export function StockTable({
  workspace,
  reservations,
  materialByCode,
  busy,
  onAddMaterial,
  onEditMaterial,
  onRetireMaterial,
}: {
  workspace: InventoryWorkspace;
  reservations?: readonly InventoryReservationRow[];
  materialByCode: ReadonlyMap<string, Material>;
  busy?: boolean;
  onAddMaterial?: () => void;
  onEditMaterial?: (material: Material) => void;
  onRetireMaterial?: (material: Material) => void;
}) {
  const [warehouseCode, setWarehouseCode] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [warrantyFilter, setWarrantyFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openRowId, setOpenRowId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.stock.filter((row) => {
      if (warehouseCode !== 'all' && row.warehouseCode !== warehouseCode) return false;
      const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
      
      // Status filtering simulation
      if (statusFilter !== 'all') {
        const low = material ? row.available < material.minStock : false;
        if (statusFilter === 'ready' && low) return false;
        if (statusFilter === 'low' && !low) return false;
      }

      if (!needle) return true;
      return (
        (row.materialCode ?? '').toLowerCase().includes(needle) ||
        (material?.name ?? '').toLowerCase().includes(needle) ||
        (row.warehouseCode ?? '').toLowerCase().includes(needle)
      );
    });
  }, [workspace.stock, warehouseCode, statusFilter, query, materialByCode]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const toggleSelectAll = () => {
    if (selectedIds.size === pagedRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pagedRows.map((r) => r.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const exportExcel = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      ['Mã SKU,Tên Vật tư,Kho,Tồn thực tế,Đã giữ,Khả dụng,Đơn vị']
        .concat(
          filteredRows.map((r) => {
            const m = r.materialCode ? materialByCode.get(r.materialCode) : undefined;
            return `"${r.materialCode}","${m?.name ?? ''}","${r.warehouseCode}",${r.quantity},${r.quantityReserved},${r.available},"${m?.unit ?? ''}"`;
          }),
        )
        .join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `danh_muc_vat_tu_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const holdersOf = (materialId: string, warehouseId: string) =>
    (reservations ?? []).filter((reservation) =>
      (reservation.items ?? []).some(
        (item) => item.materialId === materialId && item.warehouseId === warehouseId,
      ),
    );

  return (
    <section>
      {/* Header Bar */}
      <div className={styles.sectionHeading}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1>Danh mục Vật tư &amp; Thiết bị</h1>
          <span className={styles.eyebrow}>
            {filteredRows.length} vật tư / thiết bị
          </span>
        </div>
        <div className={styles.headActions}>
          {onAddMaterial ? (
            <button type="button" className={styles.btnPrimary} onClick={onAddMaterial}>
              <span>+</span> Thêm vật tư mới
            </button>
          ) : null}
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => window.alert('Đang mở máy quét mã QR/Barcode…')}
          >
            <span>📷</span> Quét mã QR
          </button>
          <button type="button" className={styles.btnSecondary} onClick={exportExcel}>
            <span>⬇</span> Xuất Excel
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className={styles.filterBar}>
        <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
          <input
            style={{ width: '100%' }}
            placeholder="Tìm theo SKU, Tên, Vị trí kho…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        <div>
          <select
            value={warehouseCode}
            onChange={(e) => {
              setWarehouseCode(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Kho: Tất cả kho</option>
            {workspace.warehouses.map((w) => (
              <option key={w.id} value={w.code}>
                {w.code} ({w.name})
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Tình trạng: Tất cả</option>
            <option value="ready">Sẵn sàng dùng (Đủ tồn)</option>
            <option value="low">Cảnh báo thiếu hàng (Dưới min)</option>
          </select>
        </div>

        <div>
          <select
            value={warrantyFilter}
            onChange={(e) => {
              setWarrantyFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Bảo hành: Tất cả</option>
            <option value="valid">Còn hạn bảo hành</option>
            <option value="expired">Hết hạn bảo hành</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className={styles.card} style={{ padding: '0', overflow: 'hidden' }}>
        <div className={styles.tableWrap} style={{ border: 'none', borderRadius: '0' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === pagedRows.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Mã SKU</th>
                <th>Tên thiết bị / Vật tư</th>
                <th>Vị trí kho</th>
                <th>Tình trạng</th>
                <th style={{ textAlign: 'right' }}>Tồn thực</th>
                <th style={{ textAlign: 'right' }}>Đã giữ</th>
                <th style={{ textAlign: 'right' }}>Khả dụng</th>
                <th style={{ textAlign: 'center', width: '130px' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '36px', color: 'var(--pe-text-muted)' }}>
                    Không có vật tư nào khớp với điều kiện tìm kiếm.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
                  const low = material ? row.available < material.minStock : false;
                  const open = openRowId === row.id;
                  const isSelected = selectedIds.has(row.id);
                  const holders = open ? holdersOf(row.materialId, row.warehouseId) : [];

                  return (
                    <Fragment key={row.id}>
                      <tr style={{ background: isSelected ? 'var(--pe-primary-50)' : undefined }}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(row.id)}
                          />
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--pe-primary-600)' }}>
                          {row.materialCode ?? '—'}
                        </td>
                        <td>
                          <strong>{material?.name ?? 'Chưa đặt tên'}</strong>
                          <div style={{ fontSize: '11.5px', color: 'var(--pe-text-muted)' }}>
                            {material ? MATERIAL_CATEGORY_LABEL[material.category] : 'Vật tư tiêu chuẩn'} · ĐVT: {material?.unit ?? 'Cái'}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{row.warehouseCode ?? '—'}</span>
                          <div style={{ fontSize: '11px', color: 'var(--pe-text-muted)' }}>
                            Kệ K02-3
                          </div>
                        </td>
                        <td>
                          {low ? (
                            <span className={`${styles.statusPill} ${styles.statusPillWarn}`}>
                              ⚠️ Dưới min ({formatNumber(material?.minStock ?? 0)})
                            </span>
                          ) : (
                            <span className={`${styles.statusPill} ${styles.statusPillSuccess}`}>
                              ✓ Sẵn sàng dùng
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatNumber(row.quantity)} {material?.unit ?? ''}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--pe-text-muted)' }}>
                          {formatNumber(row.quantityReserved)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: low ? '#b91c1c' : '#15803d' }}>
                          {formatNumber(row.available)} {material?.unit ?? ''}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              title="Xem chi tiết"
                              className={styles.btnSecondary}
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => setOpenRowId(open ? undefined : row.id)}
                            >
                              {open ? '▲' : '▼'}
                            </button>
                            {onEditMaterial && material ? (
                              <button
                                type="button"
                                title="Chỉnh sửa vật tư"
                                className={styles.btnSecondary}
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                disabled={busy}
                                onClick={() => onEditMaterial(material)}
                              >
                                ✎
                              </button>
                            ) : null}
                            {onRetireMaterial && material ? (
                              <button
                                type="button"
                                title="Ngừng sử dụng"
                                className={styles.btnSecondary}
                                style={{ padding: '4px 8px', fontSize: '12px', color: '#dc2626' }}
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm(`Xác nhận ngừng dùng hoặc xoá vật tư ${material.code}?`)) {
                                    onRetireMaterial(material);
                                  }
                                }}
                              >
                                ✕
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable detail row */}
                      {open ? (
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan={9} style={{ padding: '16px 24px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid var(--pe-border-subtle)' }}>
                              <div>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--pe-text-muted)', fontWeight: 600 }}>
                                  Nhóm vật tư
                                </span>
                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                  {material ? MATERIAL_CATEGORY_LABEL[material.category] : '—'}
                                </div>
                              </div>
                              <div>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--pe-text-muted)', fontWeight: 600 }}>
                                  Định mức Min / Max
                                </span>
                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                  {formatNumber(material?.minStock ?? 0)} / {material?.maxStock ? formatNumber(material.maxStock) : '∞'} {material?.unit ?? ''}
                                </div>
                              </div>
                              <div>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--pe-text-muted)', fontWeight: 600 }}>
                                  Phương thức theo dõi
                                </span>
                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                  {material?.isSerialized ? 'Quản lý theo Serial' : 'Quản lý theo Số lượng'}
                                </div>
                              </div>
                              <div>
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--pe-text-muted)', fontWeight: 600 }}>
                                  Phiếu giữ chỗ đang chiếm tồn
                                </span>
                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                  {holders.length === 0 ? 'Không có phiếu giữ' : `${holders.length} phiếu giữ chỗ`}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Pagination Footer */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 20px',
            borderTop: '1px solid var(--pe-border-subtle)',
            fontSize: '13px',
            color: 'var(--pe-text-secondary)',
          }}
        >
          <div>
            Hiển thị {filteredRows.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} –{' '}
            {Math.min(currentPage * pageSize, filteredRows.length)} trong tổng số{' '}
            <strong>{filteredRows.length}</strong> vật tư
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Dòng / trang:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--pe-border-subtle)' }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              >
                ← Trước
              </button>
              <span style={{ padding: '4px 8px', fontWeight: 600 }}>
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Sau →
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
