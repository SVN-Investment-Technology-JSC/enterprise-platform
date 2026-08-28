'use client';

import type { Material, TransactionType } from '@enterprise-platform/contracts-inventory';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  InventoryLedgerRow,
  InventoryReservationRow,
  InventoryWorkspace,
} from '../inventory-api';
import {
  MATERIAL_CATEGORY_LABEL,
  RESERVATION_STATUS_LABEL,
  WAREHOUSE_TYPE_LABEL,
  formatDateTime,
  formatNumber,
} from '../inventory-labels';
import { loadMaterialHistory } from '../inventory-api';
import { SerialPanel } from './serial-panel';
import styles from '../inventory.module.scss';

/**
 * Tab Tồn kho gộp ba tab cũ: Tồn kho, Vật tư và Kho & vị trí. Một dòng tồn vốn đã
 * là một vật tư ở một kho, nên danh mục vật tư mở ra khi bấm vào dòng, còn danh
 * sách kho trở thành hàng chip lọc thay vì một tab riêng.
 */
export function StockTable({
  workspace,
  reservations,
  materialByCode,
  busy,
  onEditMaterial,
  onRetireMaterial,
  initialQuery,
  onTransfer,
  statuses = [],
  usageStates = [],
}: {
  workspace: InventoryWorkspace;
  reservations?: readonly InventoryReservationRow[];
  materialByCode: ReadonlyMap<string, Material>;
  busy?: boolean;
  onEditMaterial?: (material: Material) => void;
  onRetireMaterial?: (material: Material) => void;
  /** Mã cần tìm sẵn khi nhảy sang từ danh mục hợp nhất. */
  initialQuery?: string;
  /** Tình trạng và vị trí sử dụng được phép chọn, theo cấu hình admin. */
  statuses?: readonly string[];
  usageStates?: readonly string[];
  /** Mở quy trình chuyển kho cho một dòng tồn. */
  onTransfer?: (input: {
    materialCode: string;
    materialName: string;
    fromWarehouseCode: string;
  }) => void;
}) {
  const [warehouseCode, setWarehouseCode] = useState('all');
  const [query, setQuery] = useState(initialQuery ?? '');

  /**
   * Đồng bộ khi bên ngoài đổi mã cần tìm.
   *
   * Chỉ chạy khi `initialQuery` đổi, không chạy mỗi lần gõ: nếu phụ thuộc cả
   * `query` thì mọi ký tự người dùng gõ sẽ bị ghi đè lại ngay.
   */
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);
  const [openRowId, setOpenRowId] = useState<string>();

  /**
   * Lịch sử nhập/xuất của mã đang mở, tải theo yêu cầu.
   *
   * Không nạp sẵn cho mọi dòng: bảng tồn có thể hàng trăm dòng, mỗi dòng một
   * lượt gọi sổ cái là đủ làm treo màn hình. Cache theo mã để đóng rồi mở lại
   * không gọi thêm lần nữa.
   */
  const [history, setHistory] = useState<Record<string, InventoryLedgerRow[] | 'loading' | 'error'>>({});

  /** Sổ cái lưu `warehouseId`; bảng cần mã kho để đọc được. */
  const warehouseCodeById = useMemo(
    () => new Map((workspace.warehouses ?? []).map((item) => [item.id, item.code])),
    [workspace.warehouses],
  );

  const openHistory = (materialCode: string | undefined) => {
    if (!materialCode || history[materialCode]) return;
    setHistory((current) => ({ ...current, [materialCode]: 'loading' }));
    loadMaterialHistory(materialCode)
      .then((rows) => setHistory((current) => ({ ...current, [materialCode]: rows })))
      .catch(() => setHistory((current) => ({ ...current, [materialCode]: 'error' })));
  };

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.stock.filter((row) => {
      if (warehouseCode !== 'all' && row.warehouseCode !== warehouseCode) return false;
      if (!needle) return true;
      const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
      return (
        (row.materialCode ?? '').toLowerCase().includes(needle) ||
        (material?.name ?? '').toLowerCase().includes(needle)
      );
    });
  }, [workspace.stock, warehouseCode, query, materialByCode]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);

  /** Phiếu giữ chỗ đang chiếm số lượng của một dòng tồn, để giải thích cột "Đã giữ". */
  const holdersOf = (materialId: string, warehouseId: string) =>
    (reservations ?? []).filter((reservation) =>
      (reservation.items ?? []).some(
        (item) => item.materialId === materialId && item.warehouseId === warehouseId,
      ),
    );

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Tồn kho theo vật tư</h2>
        <input
          className={styles.searchInline}
          placeholder="Tìm mã hoặc tên vật tư…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.chipRow}>
        <button
          type="button"
          className={`${styles.chip} ${warehouseCode === 'all' ? styles.chipOn : ''}`}
          onClick={() => setWarehouseCode('all')}
        >
          Tất cả kho
        </button>
        {workspace.warehouses.map((warehouse) => (
          <button
            key={warehouse.id}
            type="button"
            title={`${warehouse.name} · ${WAREHOUSE_TYPE_LABEL[warehouse.type]}`}
            className={`${styles.chip} ${warehouseCode === warehouse.code ? styles.chipOn : ''}`}
            onClick={() => setWarehouseCode(warehouse.code)}
          >
            {warehouse.code}
          </button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vật tư</th>
              <th>Kho</th>
              <th className={styles.right}>Tồn thực</th>
              <th className={styles.right}>Đã giữ</th>
              <th className={styles.right}>Khả dụng</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => {
              const material = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
              const low = material ? row.available < material.minStock : false;
              const open = openRowId === row.id;
              const holders = open ? holdersOf(row.materialId, row.warehouseId) : [];
              return (
                <Fragment key={row.id}>
                  <tr
                    className={styles.clickable}
                    onClick={() => {
                      setOpenRowId(open ? undefined : row.id);
                      if (!open) openHistory(row.materialCode ?? undefined);
                    }}
                  >
                    <td className={styles.code}>
                      {row.materialCode ?? '—'}
                      {material ? <span className={styles.sub}>{material.name}</span> : null}
                    </td>
                    <td>{row.warehouseCode ?? '—'}</td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {formatNumber(row.quantity)} {material?.unit ?? ''}
                    </td>
                    <td className={`${styles.numeric} ${styles.right}`}>
                      {formatNumber(row.quantityReserved)}
                    </td>
                    <td className={`${styles.numeric} ${styles.right} ${low ? styles.low : ''}`}>
                      {formatNumber(row.available)}
                      {low && material ? (
                        <span className={styles.sub}>dưới mức tối thiểu {formatNumber(material.minStock)}</span>
                      ) : null}
                    </td>
                  </tr>
                  {open ? (
                    <tr className={styles.detailRow}>
                      <td colSpan={5}>
                        <div className={styles.detailGrid}>
                          <div>
                            <span>Nhóm vật tư</span>
                            <strong>
                              {material ? MATERIAL_CATEGORY_LABEL[material.category] : '—'}
                            </strong>
                          </div>
                          <div>
                            <span>Đơn vị tính</span>
                            <strong>{material?.unit ?? '—'}</strong>
                          </div>
                          <div>
                            <span>Tồn tối thiểu</span>
                            {/* Trần tồn đã bỏ: không luật nào của kho dựa vào nó,
                                nên nó chỉ là một con số phải nhập rồi không ai
                                đọc. Sàn thì có việc thật — nó bật cảnh báo. */}
                            <strong className={low ? styles.lowValue : undefined}>
                              {material ? formatNumber(material.minStock) : '—'}
                            </strong>
                          </div>
                          <div>
                            <span>Cập nhật</span>
                            <strong>{formatDateTime(row.updatedAt)}</strong>
                          </div>
                        </div>

                        {material ? (
                          <SerialPanel
                            material={material}
                            statuses={statuses}
                            usageStates={usageStates}
                            busy={busy}
                          />
                        ) : null}

                        {row.materialCode ? (
                          <MaterialHistory
                            state={history[row.materialCode]}
                            unit={material?.unit}
                            warehouseCodeById={warehouseCodeById}
                          />
                        ) : null}

                        {material && (onEditMaterial || onRetireMaterial) ? (
                          <div className={styles.rowActions}>
                            {onEditMaterial ? (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => onEditMaterial(material)}
                              >
                                Sửa vật tư
                              </button>
                            ) : null}
                            {onTransfer && row.materialCode && row.warehouseCode ? (
                              <button
                                type="button"
                                className={styles.linkButton}
                                title="Mở quy trình chuyển kho bên module Quy trình. Kho chỉ chuyển bạn sang đó kèm sẵn nội dung — số lượng chỉ đổi khi thủ kho thao tác."
                                onClick={() =>
                                  onTransfer({
                                    materialCode: row.materialCode as string,
                                    materialName: material.name,
                                    fromWarehouseCode: row.warehouseCode as string,
                                  })
                                }
                              >
                                Chuyển kho
                              </button>
                            ) : null}
                            {onRetireMaterial ? (
                              <button
                                type="button"
                                className={styles.dangerButton}
                                disabled={busy}
                                onClick={() => onRetireMaterial(material)}
                              >
                                Ngừng dùng
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {row.quantityReserved > 0 ? (
                          holders.length > 0 ? (
                            <ul className={styles.holderList}>
                              {holders.map((reservation) => {
                                const held = (reservation.items ?? [])
                                  .filter(
                                    (item) =>
                                      item.materialId === row.materialId &&
                                      item.warehouseId === row.warehouseId,
                                  )
                                  .reduce((sum, item) => sum + item.quantityReserved, 0);
                                return (
                                  <li key={reservation.id}>
                                    <span className={styles.code}>{reservation.reservationCode}</span>
                                    <span className={styles.pill}>
                                      {RESERVATION_STATUS_LABEL[reservation.status]}
                                    </span>
                                    <span>giữ {formatNumber(held)}</span>
                                    <em>
                                      {reservation.expiresAt
                                        ? `hết hạn ${formatDateTime(reservation.expiresAt)}`
                                        : 'không hạn'}
                                    </em>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className={styles.hint}>
                              Số lượng đang giữ không khớp phiếu nào còn hiệu lực.
                            </p>
                          )
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className={styles.empty}>
            {workspace.stock.length === 0 ? 'Chưa có tồn kho.' : 'Không có dòng tồn nào khớp bộ lọc.'}
          </p>
        ) : null}

        {/* Pagination Footer */}
        {rows.length > pageSize ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderTop: '1px solid #e2e8f0',
              fontSize: '12.5px',
              color: '#64748b',
              background: '#f8fafc',
            }}
          >
            <div>
              Hiển thị {rows.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} –{' '}
              {Math.min(currentPage * pageSize, rows.length)} trong tổng số{' '}
              <strong>{rows.length}</strong> dòng tồn
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Dòng/trang:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  ← Trước
                </button>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.reset}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Sau →
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Khớp đúng `TransactionType` trong contract, không đoán theo tên thường gặp. */
const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  IMPORT: 'Nhập kho',
  EXPORT: 'Xuất kho',
  TRANSFER_IN: 'Chuyển đến',
  TRANSFER_OUT: 'Chuyển đi',
  BORROW: 'Mượn',
  RETURN: 'Trả',
  ADJUST: 'Điều chỉnh',
};

/**
 * Lịch sử nhập/xuất của một mã vật tư.
 *
 * Dấu của `quantity` chính là chiều luân chuyển — sổ cái lưu số âm cho xuất
 * kho. Hiện kèm dấu và tô màu để đọc lướt ra ngay, thay vì bắt người dùng suy
 * từ cột loại giao dịch.
 */
function MaterialHistory(props: {
  state: InventoryLedgerRow[] | 'loading' | 'error' | undefined;
  unit?: string;
  warehouseCodeById: ReadonlyMap<string, string>;
}) {
  if (props.state === undefined || props.state === 'loading') {
    return <p className={styles.historyNote}>Đang tải lịch sử…</p>;
  }
  if (props.state === 'error') {
    return <p className={styles.historyNote}>Không đọc được lịch sử nhập/xuất.</p>;
  }
  if (props.state.length === 0) {
    return <p className={styles.historyNote}>Vật tư này chưa có giao dịch nào.</p>;
  }

  return (
    <div className={styles.historyWrap}>
      <h4>Lịch sử nhập/xuất</h4>
      <ul className={styles.historyList}>
        {props.state.map((entry) => (
          <li key={entry.id}>
            <span className={styles.historyWhen}>{formatDateTime(entry.createdAt)}</span>
            <span className={styles.historyType}>
              {TYPE_LABEL[entry.type] ?? entry.type}
              {props.warehouseCodeById.get(entry.warehouseId)
                ? ` · ${props.warehouseCodeById.get(entry.warehouseId)}`
                : ''}
            </span>
            <span
              className={`${styles.historyQty} ${
                entry.quantity < 0 ? styles.historyOut : styles.historyIn
              }`}
            >
              {entry.quantity > 0 ? '+' : ''}
              {formatNumber(entry.quantity)} {props.unit ?? ''}
            </span>
            {entry.note ? <small className={styles.historyNoteLine}>{entry.note}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
