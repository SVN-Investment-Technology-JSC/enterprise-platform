'use client';

import type {
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceOccurrence,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
} from '@enterprise-platform/contracts-maintenance';
import { useState } from 'react';
import styles from './maintenance-history.module.scss';

const KIND_LABEL: Record<MaintenanceOccurrenceKind, string> = {
  preventive: 'Định kỳ',
  incident: 'Sự cố',
};

const KIND_ICON: Record<MaintenanceOccurrenceKind, string> = {
  preventive: '🔄',
  incident: '⚠️',
};

const STATUS_LABEL: Record<MaintenanceOccurrenceStatus, string> = {
  planned: 'Đã lên lịch',
  in_progress: 'Đang xử lý',
  dispatch_pending: 'Chờ tạo phiếu',
  generated: 'Đã tạo phiếu',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  blocked: 'Bị chặn',
};

const STATUS_ICON: Record<MaintenanceOccurrenceStatus, string> = {
  planned: '🗓️',
  in_progress: '⏳',
  dispatch_pending: '📋',
  generated: '📑',
  completed: '✓',
  failed: '✕',
  blocked: '⛔',
};

const dateOnly = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
});

export function MaintenanceHistory({
  page,
  filter,
  busy,
  canManage,
  selected,
  onFilter,
  onLoadMore,
  onSelect,
  onComplete,
  performers,
}: {
  page?: MaintenanceHistoryPage;
  filter: MaintenanceHistoryFilter;
  busy: boolean;
  canManage: boolean;
  selected?: MaintenanceOccurrence;
  onFilter: (next: MaintenanceHistoryFilter) => void;
  onLoadMore: () => void;
  onSelect: (occurrence?: MaintenanceOccurrence) => void;
  onComplete: (id: string, note: string) => void;
  /** Mã hồ sơ Quy trình → tên người thực hiện. */
  performers?: ReadonlyMap<string, string[]>;
}) {
  const [note, setNote] = useState('');
  const items = page?.items ?? [];

  return (
    <section className={styles.history}>
      {/* 1. HEADER TỐI GIẢN */}
      <header className={styles.head}>
        <div className={styles.titleArea}>
          <h2>Lịch sử bảo trì thiết bị</h2>
          <p>
            Nhật ký kiểm tra, bảo dưỡng phòng ngừa định kỳ và khắc phục sự cố kỹ thuật trên toàn hệ thống ({page?.stats.total ?? 0} lượt).
          </p>
        </div>
      </header>

      {/* 2. BẢNG DỮ LIỆU ĐƠN DUY NHẤT CHIẾM TRỌN CHIỀU NGANG */}
      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              {/* HÀNG HEADER TÍCH HỢP TÌM KIẾM & BỘ LỌC */}
              <tr className={styles.filterHeaderRow}>
                <th colSpan={6} className={styles.controlsCell}>
                  <div className={styles.tableControls}>
                    <div className={styles.searchBox}>
                      <span className={styles.searchIcon}>🔍</span>
                      <input
                        placeholder="Tìm theo mã thiết bị (MBA-01, MC-22)..."
                        defaultValue={filter.assetCode ?? ''}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onFilter({ ...filter, assetCode: (e.target as HTMLInputElement).value, cursor: undefined });
                          }
                        }}
                        onBlur={(event) => onFilter({ ...filter, assetCode: event.target.value, cursor: undefined })}
                      />
                    </div>

                    <select
                      className={styles.selectFilter}
                      value={filter.kind ?? ''}
                      onChange={(event) =>
                        onFilter({
                          ...filter,
                          kind: (event.target.value || undefined) as MaintenanceOccurrenceKind | undefined,
                          cursor: undefined,
                        })
                      }
                    >
                      <option value="">📂 Tất cả loại</option>
                      <option value="preventive">🔄 Định kỳ</option>
                      <option value="incident">⚠️ Sự cố</option>
                    </select>

                    <select
                      className={styles.selectFilter}
                      value={filter.status ?? ''}
                      onChange={(event) =>
                        onFilter({
                          ...filter,
                          status: (event.target.value || undefined) as MaintenanceOccurrenceStatus | undefined,
                          cursor: undefined,
                        })
                      }
                    >
                      <option value="">🎯 Tất cả trạng thái</option>
                      {Object.entries(STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {STATUS_ICON[value as MaintenanceOccurrenceStatus]} {label}
                        </option>
                      ))}
                    </select>

                    <div className={styles.dateRange}>
                      <input
                        type="date"
                        title="Từ ngày"
                        value={filter.from?.slice(0, 10) ?? ''}
                        onChange={(event) =>
                          onFilter({ ...filter, from: event.target.value || undefined, cursor: undefined })
                        }
                      />
                      <span className={styles.dateSep}>→</span>
                      <input
                        type="date"
                        title="Đến ngày"
                        value={filter.to?.slice(0, 10) ?? ''}
                        onChange={(event) =>
                          onFilter({ ...filter, to: event.target.value || undefined, cursor: undefined })
                        }
                      />
                    </div>

                    <button
                      type="button"
                      className={styles.resetBtn}
                      title="Xóa toàn bộ bộ lọc và đặt lại mặc định"
                      onClick={() => onFilter({})}
                    >
                      ✕ Xoá bộ lọc
                    </button>
                  </div>
                </th>
              </tr>

              {/* HÀNG TIÊU ĐỀ CỘT */}
              <tr className={styles.columnHeaderRow}>
                <th style={{ width: '120px' }}>Loại hình</th>
                <th style={{ width: '130px' }}>Mã thiết bị</th>
                <th>Tiêu đề & Hạng mục bảo trì</th>
                <th style={{ width: '140px' }}>Ngày thực hiện</th>
                <th style={{ width: '150px' }}>Trạng thái</th>
                <th style={{ width: '140px' }}>WorkOrder</th>
              </tr>
            </thead>

            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyCell}>
                    {busy ? 'Đang tải dữ liệu…' : 'Không có lần bảo trì nào khớp bộ lọc.'}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isSelected = item.id === selected?.id;
                  const itemPerformers = item.procedureInstanceCode
                    ? performers?.get(item.procedureInstanceCode)
                    : undefined;

                  return (
                    <tr
                      key={item.id}
                      className={`${styles.tableRow} ${isSelected ? styles.tableRowActive : ''}`}
                      onClick={() => {
                        setNote('');
                        onSelect(item);
                      }}
                    >
                      <td>
                        <span className={`${styles.kindBadge} ${styles[item.kind]}`}>
                          {KIND_ICON[item.kind]} {KIND_LABEL[item.kind]}
                        </span>
                      </td>
                      <td>
                        <span className={styles.assetTagMono}>🏷️ {item.assetCode || '—'}</span>
                      </td>
                      <td>
                        <div className={styles.rowMain}>
                          <strong className={styles.rowTitle}>{item.title}</strong>
                          {itemPerformers?.length ? (
                            <span className={styles.performerTag}>👤 {itemPerformers.join(', ')}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className={styles.dateCell}>
                        {dateOnly.format(new Date(item.dueAt))}
                      </td>
                      <td>
                        <span className={`${styles.statusBadge} ${styles[`st_${item.status}`]}`}>
                          <span className={styles.statusDot} />
                          {STATUS_LABEL[item.status]}
                        </span>
                      </td>
                      <td className={styles.workorderCell}>
                        {item.procedureInstanceCode ? (
                          <span className={styles.woCode}>#{item.procedureInstanceCode}</span>
                        ) : (
                          <span className={styles.mutedDash}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* FOOTER: PHÂN TRANG & CHỌN SỐ LƯỢNG RECORD (ĐỒNG BỘ VỚI WORKSPACE) */}
        <div className={styles.tableFooter}>
          <div className={styles.footerLeft}>
            <span className={styles.totalRecords}>
              Hiển thị <strong>{items.length > 0 ? 1 : 0}–{items.length}</strong> / <strong>{page?.stats.total ?? items.length}</strong> bản ghi
            </span>
            <label className={styles.pageSizeLabel}>
              <span>Hiển thị:</span>
              <select
                className={styles.pageSizeSelect}
                value={filter.limit ?? 15}
                onChange={(event) =>
                  onFilter({
                    ...filter,
                    limit: Number(event.target.value) || 15,
                    cursor: undefined,
                  })
                }
              >
                <option value={15}>15 / trang</option>
                <option value={30}>30 / trang</option>
                <option value={45}>45 / trang</option>
                <option value={60}>60 / trang</option>
              </select>
            </label>
          </div>

          <div className={styles.footerRight}>
            <div className={styles.paginationGroup}>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={busy}
                onClick={() => onFilter({ ...filter, cursor: undefined })}
                title="Làm mới / Về đầu"
              >
                ← Đầu
              </button>
              {page?.nextCursor ? (
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={busy}
                  onClick={onLoadMore}
                  title="Tải tiếp trang sau"
                >
                  {busy ? 'Đang nạp…' : 'Sau →'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* 3. DRAWER CHI TIẾT KHI CLICK CHỌN HÀNG */}
      {selected ? (
        <div
          className={styles.drawerBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) onSelect(undefined);
          }}
        >
          <aside className={styles.drawerPanel}>
            <header className={styles.drawerHeader}>
              <div>
                <span className={`${styles.kindBadge} ${styles[selected.kind]}`}>
                  {KIND_ICON[selected.kind]} {KIND_LABEL[selected.kind]}
                </span>
                <h3 className={styles.drawerTitle}>{selected.title}</h3>
              </div>
              <button
                type="button"
                className={styles.closeDrawerBtn}
                onClick={() => onSelect(undefined)}
                aria-label="Đóng"
                title="Đóng (ESC)"
              >
                ✕
              </button>
            </header>

            <div className={styles.drawerBody}>
              <div className={styles.factsGrid}>
                <div className={styles.factItem}>
                  <span className={styles.factLabel}>Mã định danh</span>
                  <span className={styles.factValueMono}>{selected.code ?? '—'}</span>
                </div>
                <div className={styles.factItem}>
                  <span className={styles.factLabel}>Thiết bị áp dụng</span>
                  <span className={styles.factValueMono}>{selected.assetCode || '—'}</span>
                </div>
                <div className={styles.factItem}>
                  <span className={styles.factLabel}>Theo lịch</span>
                  <span className={styles.factValue}>{selected.scheduleTitle ?? 'Bảo trì đột xuất'}</span>
                </div>
                <div className={styles.factItem}>
                  <span className={styles.factLabel}>Ngày đến hạn</span>
                  <span className={styles.factValue}>{dateTime.format(new Date(selected.dueAt))}</span>
                </div>
                <div className={styles.factItem}>
                  <span className={styles.factLabel}>Mức độ ưu tiên</span>
                  <span className={styles.factValue}>{selected.priority}</span>
                </div>
                <div className={styles.factItem}>
                  <span className={styles.factLabel}>Trạng thái hiện tại</span>
                  <span className={`${styles.statusBadge} ${styles[`st_${selected.status}`]}`}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                </div>
                {selected.assigneeName ? (
                  <div className={styles.factItemFull}>
                    <span className={styles.factLabel}>Người phụ trách</span>
                    <span className={styles.factValue}>👤 {selected.assigneeName}</span>
                  </div>
                ) : null}
              </div>

              {selected.description ? (
                <div className={styles.descriptionBox}>
                  <span className={styles.boxLabel}>Mô tả công việc:</span>
                  <p>{selected.description}</p>
                </div>
              ) : null}

              {selected.procedureInstanceCode ? (
                <div className={styles.workorderBox}>
                  <div className={styles.workorderHead}>
                    <span>Hồ sơ quy trình công việc</span>
                    <a className={styles.workorderLink} href="/modules/procedure#workspace">
                      Mở WorkOrder #{selected.procedureInstanceCode} ↗
                    </a>
                  </div>
                  {performers?.get(selected.procedureInstanceCode)?.length ? (
                    <p className={styles.performerText}>
                      Đội ngũ thực thi:{' '}
                      <strong>
                        {performers.get(selected.procedureInstanceCode)?.join(', ')}
                      </strong>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {selected.completedAt ? (
                <div className={styles.resultBox}>
                  <div className={styles.resultHead}>
                    <span>✓ Kết quả thực hiện</span>
                    <small>
                      Hoàn tất: {dateTime.format(new Date(selected.completedAt))}
                      {selected.completedByName ? ` · ${selected.completedByName}` : ''}
                    </small>
                  </div>
                  <p className={styles.resultNote}>
                    {selected.completionNote || 'Đã kiểm tra và hoàn tất theo quy trình kỹ thuật.'}
                  </p>
                </div>
              ) : canManage ? (
                <div className={styles.actionConsoleBox}>
                  <h4 className={styles.actionTitle}>Ghi nhận & Đóng hồ sơ</h4>
                  <div className={styles.actionField}>
                    <label htmlFor="completion-note-input" className={styles.actionLabel}>
                      Nội dung thực hiện & Đánh giá kết quả <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <textarea
                      id="completion-note-input"
                      rows={3}
                      className={styles.actionTextarea}
                      placeholder="Mô tả các hạng mục đã hoàn thành, linh kiện thay thế, kết quả đo kiểm..."
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>

                  <div className={styles.actionFoot}>
                    <button
                      type="button"
                      className={styles.completeSubmitBtn}
                      disabled={busy || !note.trim()}
                      onClick={() => onComplete(selected.id, note)}
                    >
                      {busy ? 'Đang lưu…' : '✓ Đánh dấu hoàn thành'}
                    </button>
                    <small className={styles.actionHint}>
                      🔒 Khi đã hoàn thành, hồ sơ sẽ được khoá và chuyển trạng thái lưu trữ.
                    </small>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

