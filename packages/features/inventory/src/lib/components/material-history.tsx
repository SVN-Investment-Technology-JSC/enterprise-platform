'use client';

import type { TransactionType } from '@enterprise-platform/contracts-inventory';
import { useState, useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  RotateCcw,
  SlidersHorizontal,
  Search,
  Filter,
  Warehouse as WarehouseIcon,
  Calendar,
  Layers,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { formatDateTime, formatNumber } from '../inventory-labels';
import type { InventoryLedgerRow } from '../inventory-api';
import styles from '../inventory.module.scss';

/** Nhãn loại bút toán, nói theo việc thủ kho làm chứ không theo tên enum. */
const TYPE_LABEL: Readonly<Record<TransactionType, string>> = {
  IMPORT: 'Nhập kho',
  EXPORT: 'Xuất kho',
  TRANSFER_IN: 'Nhập kho luân chuyển',
  TRANSFER_OUT: 'Xuất kho luân chuyển',
  BORROW: 'Mượn kho',
  RETURN: 'Trả lại kho',
  ADJUST: 'Điều chỉnh kiểm kê',
};

export function MaterialHistory(props: {
  state: InventoryLedgerRow[] | 'loading' | 'error' | undefined;
  unit?: string;
  warehouseCodeById: ReadonlyMap<string, string>;
}) {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterWarehouse, setFilterWarehouse] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const rows = useMemo(() => {
    if (!props.state || props.state === 'loading' || props.state === 'error') {
      return [];
    }
    return props.state;
  }, [props.state]);

  // Thống kê nhanh Tổng nhập, Tổng xuất, Tồn ròng phát sinh
  const stats = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    for (const item of rows) {
      if (item.quantity > 0) {
        totalIn += item.quantity;
      } else {
        totalOut += Math.abs(item.quantity);
      }
    }
    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      count: rows.length,
    };
  }, [rows]);

  // Bộ lọc kho duy nhất xuất hiện trong lịch sử
  const warehouseOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [{ value: 'ALL', label: 'Tất cả kho' }];
    const seen = new Set<string>();
    for (const r of rows) {
      const wCode = props.warehouseCodeById.get(r.warehouseId) ?? r.warehouseId;
      if (wCode && !seen.has(wCode)) {
        seen.add(wCode);
        list.push({ value: wCode, label: `Kho ${wCode}` });
      }
    }
    return list;
  }, [rows, props.warehouseCodeById]);

  // Tùy chọn loại giao dịch
  const typeOptions = useMemo(() => [
    { value: 'ALL', label: 'Tất cả giao dịch' },
    { value: 'IN', label: 'Nhập kho (+)' },
    { value: 'OUT', label: 'Xuất kho (−)' },
    { value: 'ADJUST', label: 'Cân kho / Kiểm kê' },
  ], []);

  // Lọc danh sách giao dịch
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((entry) => {
      // Lọc theo hướng luân chuyển
      if (filterType === 'IN' && entry.quantity <= 0) return false;
      if (filterType === 'OUT' && entry.quantity >= 0) return false;
      if (filterType === 'ADJUST' && entry.type !== 'ADJUST') return false;

      // Lọc theo kho
      if (filterWarehouse !== 'ALL') {
        const wCode = props.warehouseCodeById.get(entry.warehouseId) ?? entry.warehouseId;
        if (wCode !== filterWarehouse) return false;
      }

      // Lọc theo từ khóa (ghi chú, mã phiếu, sê-ri)
      if (query) {
        const noteMatch = (entry.note ?? '').toLowerCase().includes(query);
        const codeMatch = (entry.transactionCode ?? '').toLowerCase().includes(query);
        const refMatch = (entry.referenceId ?? '').toLowerCase().includes(query);
        const serialMatch = (entry.serialNumber ?? '').toLowerCase().includes(query);
        if (!noteMatch && !codeMatch && !refMatch && !serialMatch) return false;
      }

      return true;
    });
  }, [rows, filterType, filterWarehouse, searchQuery, props.warehouseCodeById]);

  if (props.state === undefined || props.state === 'loading') {
    return (
      <div className={styles.historyLoadingBox}>
        <div className={styles.historySpinner} />
        <span>Đang nạp dữ liệu lịch sử xuất nhập...</span>
      </div>
    );
  }

  if (props.state === 'error') {
    return (
      <div className={styles.historyErrorBox}>
        <span>Không thể truy vấn lịch sử nhập/xuất của vật tư này từ sổ cái.</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={styles.historyEmptyBox}>
        <Layers size={36} strokeWidth={1.5} color="#94a3b8" />
        <span style={{ fontWeight: 600, color: '#475569' }}>Chưa có phát sinh giao dịch</span>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          Vật tư này chưa từng được nhập, xuất hoặc điều chỉnh kiểm kê nào trong hệ thống.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.historyContainer}>
      {/* 1. THANH TỔNG HỢP NHANH (KPI METRICS) */}
      <div className={styles.historyMetricsGrid}>
        <div className={styles.historyMetricCard}>
          <div className={styles.historyMetricLabel}>
            <Calendar size={13} color="#64748b" />
            <span>Tổng phát sinh</span>
          </div>
          <div className={styles.historyMetricValue}>
            <strong>{formatNumber(stats.count)}</strong> <small>bút toán</small>
          </div>
        </div>

        <div className={`${styles.historyMetricCard} ${styles.historyMetricCardIn}`}>
          <div className={styles.historyMetricLabel}>
            <ArrowDownLeft size={13} color="#15803d" />
            <span>Tổng nhập vào</span>
          </div>
          <div className={`${styles.historyMetricValue} ${styles.historyTextIn}`}>
            <strong>+{formatNumber(stats.totalIn)}</strong> <small>{props.unit ?? ''}</small>
          </div>
        </div>

        <div className={`${styles.historyMetricCard} ${styles.historyMetricCardOut}`}>
          <div className={styles.historyMetricLabel}>
            <ArrowUpRight size={13} color="#b91c1c" />
            <span>Tổng xuất ra</span>
          </div>
          <div className={`${styles.historyMetricValue} ${styles.historyTextOut}`}>
            <strong>−{formatNumber(stats.totalOut)}</strong> <small>{props.unit ?? ''}</small>
          </div>
        </div>

        <div className={styles.historyMetricCard}>
          <div className={styles.historyMetricLabel}>
            <SlidersHorizontal size={13} color="#2563eb" />
            <span>Biến động ròng</span>
          </div>
          <div className={styles.historyMetricValue}>
            <strong style={{ color: stats.net >= 0 ? '#15803d' : '#b91c1c' }}>
              {stats.net > 0 ? `+${formatNumber(stats.net)}` : formatNumber(stats.net)}
            </strong>{' '}
            <small>{props.unit ?? ''}</small>
          </div>
        </div>
      </div>

      {/* 2. THANH CÔNG CỤ TÌM KIẾM & BỘ LỌC */}
      <div className={styles.historyFilterBar}>
        <div className={styles.historySearchWrapper}>
          <Search size={14} className={styles.historySearchIcon} />
          <input
            type="text"
            className={styles.historySearchInput}
            placeholder="Tìm theo nội dung, mã kiểm kê, phiếu xuất/lắp..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className={styles.historyFilterGroup}>
          <div style={{ minWidth: 155 }}>
            <SearchableSelect
              options={typeOptions}
              value={filterType}
              onChange={(val) => setFilterType(val || 'ALL')}
              placeholder="Loại giao dịch"
            />
          </div>

          {warehouseOptions.length > 2 ? (
            <div style={{ minWidth: 145 }}>
              <SearchableSelect
                options={warehouseOptions}
                value={filterWarehouse}
                onChange={(val) => setFilterWarehouse(val || 'ALL')}
                placeholder="Chọn kho"
              />
            </div>
          ) : null}

          {(filterType !== 'ALL' || filterWarehouse !== 'ALL' || searchQuery) ? (
            <button
              type="button"
              className={styles.historyResetBtn}
              onClick={() => {
                setFilterType('ALL');
                setFilterWarehouse('ALL');
                setSearchQuery('');
              }}
              title="Đặt lại bộ lọc"
            >
              <RotateCcw size={12} />
              <span>Xóa lọc</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 3. DANH SÁCH GIAO DỊCH DẠNG THẺ DÒNG THỜI GIAN HIỆN ĐẠI */}
      <div className={styles.historyTimelineList}>
        {filteredRows.map((entry) => {
          const isPositive = entry.quantity > 0;
          const warehouseCode = props.warehouseCodeById.get(entry.warehouseId) ?? entry.warehouseId;
          const typeText = TYPE_LABEL[entry.type] ?? entry.type;

          return (
            <div key={entry.id} className={styles.historyCardItem}>
              {/* Cột trái: Biểu tượng & Trực quan luồng */}
              <div
                className={`${styles.historyDirectionBadge} ${
                  isPositive ? styles.historyBadgeIn : styles.historyBadgeOut
                }`}
                title={isPositive ? 'Nhập / Tăng tồn kho' : 'Xuất / Giảm tồn kho'}
              >
                {entry.type === 'ADJUST' ? (
                  <SlidersHorizontal size={15} />
                ) : entry.type === 'TRANSFER_IN' || entry.type === 'TRANSFER_OUT' ? (
                  <ArrowRightLeft size={15} />
                ) : isPositive ? (
                  <ArrowDownLeft size={15} />
                ) : (
                  <ArrowUpRight size={15} />
                )}
              </div>

              {/* Cột giữa: Nội dung chi tiết */}
              <div className={styles.historyCardBody}>
                <div className={styles.historyCardHeader}>
                  <div className={styles.historyActionInfo}>
                    <span
                      className={`${styles.historyTypeTag} ${
                        isPositive ? styles.historyTypeTagIn : styles.historyTypeTagOut
                      }`}
                    >
                      {typeText}
                    </span>

                    {warehouseCode ? (
                      <span className={styles.historyWarehousePill}>
                        <WarehouseIcon size={11} />
                        <span>{warehouseCode}</span>
                      </span>
                    ) : null}

                    {entry.transactionCode ? (
                      <span className={styles.historyTxCode} title="Mã bút toán sổ cái">
                        {entry.transactionCode}
                      </span>
                    ) : null}
                  </div>

                  <div className={styles.historyCardTimestamp}>
                    <Calendar size={12} />
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </div>
                </div>

                {/* Diễn giải chi tiết hoặc lý do giao dịch */}
                {entry.note ? (
                  <div className={styles.historyNoteCard}>
                    <p className={styles.historyNoteText}>{entry.note}</p>
                  </div>
                ) : (
                  <div className={styles.historyNoteCardEmpty}>
                    <small>Không có ghi chú diễn giải</small>
                  </div>
                )}

                {/* Phụ lục: Sê-ri hoặc Tham chiếu */}
                {entry.serialNumber || entry.referenceId ? (
                  <div className={styles.historyMetaRow}>
                    {entry.serialNumber ? (
                      <span className={styles.historyMetaTag}>
                        Sê-ri: <strong>{entry.serialNumber}</strong>
                      </span>
                    ) : null}
                    {entry.referenceId ? (
                      <span className={styles.historyMetaTag}>
                        Mã tham chiếu: <strong>{entry.referenceId}</strong>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Cột phải: Số lượng biến động */}
              <div className={styles.historyQtyColumn}>
                <div
                  className={`${styles.historyQtyAmount} ${
                    isPositive ? styles.historyTextIn : styles.historyTextOut
                  }`}
                >
                  <span className={styles.historyQtySign}>{isPositive ? '+' : '−'}</span>
                  <span className={styles.historyQtyNumber}>{formatNumber(Math.abs(entry.quantity))}</span>
                  <span className={styles.historyQtyUnit}>{props.unit ?? ''}</span>
                </div>
              </div>
            </div>
          );
        })}

        {filteredRows.length === 0 ? (
          <div className={styles.historyFilterEmpty}>
            <Filter size={24} strokeWidth={1.5} color="#94a3b8" />
            <span>Không tìm thấy giao dịch nào khớp với điều kiện lọc hiện tại.</span>
          </div>
        ) : null}
      </div>

      {/* 4. FOOTER ĐẾM SỐ DÒNG */}
      <div className={styles.historyFooterNote}>
        <span>
          Hiển thị <strong>{filteredRows.length}</strong> / <strong>{rows.length}</strong> giao dịch
        </span>
      </div>
    </div>
  );
}
