'use client';

import type {
  MaintenanceFrequency,
  MaintenancePriority,
  MaintenanceSchedule,
} from '@enterprise-platform/contracts-maintenance';
import { useMemo, useState } from 'react';
import styles from './maintenance-schedules.module.scss';

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
  }).format(new Date(value));
}

export interface MaintenanceSchedulesTableProps {
  readonly schedules: readonly MaintenanceSchedule[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly frequencyLabel: (freq: MaintenanceFrequency) => string;
  readonly onToggle: (id: string, nextStatus: 'active' | 'paused') => void;
  readonly onSkipOnce: (id: string) => void;
  readonly onCreateSchedule: () => void;
  readonly onCreateIncident?: () => void;
}

export function MaintenanceSchedulesTable({
  schedules,
  canManage,
  busy,
  frequencyLabel,
  onToggle,
  onSkipOnce,
  onCreateSchedule,
}: MaintenanceSchedulesTableProps) {
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Lọc dữ liệu
  const filtered = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return schedules.filter((s) => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (filterPriority !== 'all' && s.priority !== filterPriority) return false;
      if (!query) return true;
      return (
        s.code.toLowerCase().includes(query) ||
        s.assetCode.toLowerCase().includes(query) ||
        (s.title ?? '').toLowerCase().includes(query) ||
        (s.procedureDefinitionCode ?? '').toLowerCase().includes(query) ||
        (s.procedureDefinitionName ?? '').toLowerCase().includes(query)
      );
    });
  }, [schedules, filterText, filterStatus, filterPriority]);

  const totalRecords = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safeCurrentPage, pageSize]);

  return (
    <section className={styles.standardTableCard}>
      {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM + BỘ LỌC + NÚT TẠO) */}
      <div className={styles.tableControlsBar}>
        <div className={styles.tableControlsLeft}>
          <div className={styles.tableSearchBox}>
            <span className={styles.tableSearchIcon}></span>
            <input
              type="search"
              placeholder="Tìm theo mã lịch, mã thiết bị, quy trình…"
              value={filterText}
              aria-label="Tìm lịch bảo trì"
              onChange={(event) => {
                setFilterText(event.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          <select
            className={styles.tableSelectFilter}
            value={filterStatus}
            aria-label="Lọc theo trạng thái"
            onChange={(event) => {
              setFilterStatus(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang kích hoạt</option>
            <option value="paused">Ngưng tạo lịch</option>
            <option value="draft">Bản nháp</option>
          </select>

          <select
            className={styles.tableSelectFilter}
            value={filterPriority}
            aria-label="Lọc theo mức ưu tiên"
            onChange={(event) => {
              setFilterPriority(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Tất cả mức ưu tiên</option>
            <option value="High">Cao</option>
            <option value="Normal">Thường</option>
            <option value="Low">Thấp</option>
          </select>

          {filterText || filterStatus !== 'all' || filterPriority !== 'all' ? (
            <button
              type="button"
              className={styles.tableResetBtn}
              title="Xóa bộ lọc"
              onClick={() => {
                setFilterText('');
                setFilterStatus('all');
                setFilterPriority('all');
                setCurrentPage(1);
              }}
            >
              Xoá bộ lọc
            </button>
          ) : null}
        </div>

        {canManage ? (
          <div className={styles.tableControlsRight}>
            <button
              type="button"
              className={styles.actionPrimaryBtn}
              onClick={onCreateSchedule}
              disabled={busy}
            >
              + Tạo lịch bảo trì
            </button>
          </div>
        ) : null}
      </div>

      {/* VÙNG 2: THÂN BẢNG DỮ LIỆU */}
      <div className={styles.tableResponsiveWrap}>
        <table className={styles.standardTable}>
          <thead>
            <tr>
              <th style={{ width: '130px' }}>Mã lịch</th>
              <th style={{ width: '140px' }}>Thiết bị</th>
              <th style={{ width: '220px' }}>Quy trình</th>
              <th style={{ width: '100px' }}>Tần suất</th>
              <th style={{ width: '100px' }}>Ưu tiên</th>
              <th style={{ width: '130px' }}>Trạng thái</th>
              <th style={{ width: '160px' }}>Đến hạn kế tiếp</th>
              {canManage ? <th style={{ width: '190px' }} className={styles.right}>Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {paginated.map((schedule) => (
              <tr key={schedule.id}>
                <td className={styles.codeCell}>{schedule.code}</td>
                <td>
                  <span className={styles.assetBadge}>{schedule.assetCode}</span>
                </td>
                <td>
                  <div className={styles.procedureCell}>
                    <strong>{schedule.procedureDefinitionCode ?? '—'}</strong>
                    {schedule.procedureDefinitionName ? (
                      <span className={styles.subText}>{schedule.procedureDefinitionName}</span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <span className={styles.freqBadge}>{frequencyLabel(schedule.frequency)}</span>
                </td>
                <td>
                  <span className={`${styles.priorityPill} ${styles[`prio_${schedule.priority}`]}`}>
                    {PRIORITY_LABEL[schedule.priority]}
                  </span>
                </td>
                <td>
                  <span className={`${styles.statusBadge} ${styles[`status_${schedule.status}`]}`}>
                    {schedule.status === 'active'
                      ? '● Đang chạy'
                      : schedule.status === 'paused'
                        ? '⏸ Tạm dừng'
                        : schedule.status}
                  </span>
                </td>
                <td className={styles.dateTimeCell}>{formatDateTime(schedule.nextDueAt)}</td>
                {canManage ? (
                  <td className={styles.right}>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={busy}
                        onClick={() =>
                          onToggle(
                            schedule.id,
                            schedule.status === 'active' ? 'paused' : 'active',
                          )
                        }
                      >
                        {schedule.status === 'active' ? 'Ngưng tạo lịch' : 'Kích hoạt lại'}
                      </button>
                      {schedule.status === 'active' ? (
                        <button
                          type="button"
                          className={styles.skipButton}
                          disabled={busy}
                          title="Đẩy hạn sang chu kỳ kế, không sinh phiếu lần này."
                          onClick={() => onSkipOnce(schedule.id)}
                        >
                          Bỏ qua
                        </button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 8 : 7} className={styles.empty}>
                  {filterText || filterStatus !== 'all' || filterPriority !== 'all'
                    ? 'Không tìm thấy lịch bảo trì nào khớp bộ lọc.'
                    : 'Chưa có lịch bảo trì nào.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* VÙNG 3: FOOTER CHÂN BẢNG ĐỒNG BỘ */}
      <div className={styles.tableFooterBar}>
        <div className={styles.tableFooterLeft}>
          <span className={styles.tableTotalRecords}>
            Hiển thị <strong>{totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–{Math.min(safeCurrentPage * pageSize, totalRecords)}</strong> / <strong>{totalRecords}</strong> lịch
          </span>
          <label className={styles.tablePageSizeLabel}>
            <span>Hiển thị:</span>
            <select
              className={styles.tablePageSizeSelect}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) || 15);
                setCurrentPage(1);
              }}
            >
              <option value={15}>15 / trang</option>
              <option value={30}>30 / trang</option>
              <option value={45}>45 / trang</option>
              <option value={60}>60 / trang</option>
            </select>
          </label>
        </div>

        <div className={styles.tableFooterRight}>
          <div className={styles.tablePaginationGroup}>
            <button
              type="button"
              className={styles.tablePageBtn}
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              title="Trang trước"
            >
              ← Trước
            </button>
            <span className={styles.tablePageIndicator}>
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              type="button"
              className={styles.tablePageBtn}
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              title="Trang sau"
            >
              Sau →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
