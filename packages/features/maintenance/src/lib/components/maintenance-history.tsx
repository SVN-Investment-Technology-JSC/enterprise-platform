'use client';

import type {
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceOccurrence,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
  OccurrenceAttachment,
} from '@enterprise-platform/contracts-maintenance';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  loadOccurrenceAttachments,
  occurrenceAttachmentDownloadUrl,
  removeOccurrenceAttachment,
  uploadOccurrenceAttachment,
} from '../maintenance-api';
import styles from './maintenance-history.module.scss';

const KIND_LABEL: Record<MaintenanceOccurrenceKind, string> = {
  preventive: 'Định kỳ',
  incident: 'Sự cố',
};

const KIND_ICON: Record<MaintenanceOccurrenceKind, string> = {
  preventive: '',
  incident: '',
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
  const [loadedAttachments, setLoadedAttachments] = useState<OccurrenceAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; name: string; size: string }>>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const items = page?.items ?? [];

  const refreshAttachments = useCallback(async (occurrenceId: string) => {
    setLoadingAttachments(true);
    try {
      const list = await loadOccurrenceAttachments(occurrenceId);
      setLoadedAttachments(list);
    } catch {
      setLoadedAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  }, []);

  useEffect(() => {
    if (selected?.id) {
      void refreshAttachments(selected.id);
      setPendingFiles([]);
      setNote('');
    } else {
      setLoadedAttachments([]);
      setPendingFiles([]);
    }
  }, [selected?.id, refreshAttachments]);

  const handleDownload = async (attachmentId: string) => {
    if (!selected?.id) return;
    try {
      const res = await occurrenceAttachmentDownloadUrl(selected.id, attachmentId);
      if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      alert('Không thể lấy đường dẫn tải tệp.');
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!selected?.id) return;
    if (!window.confirm('Bạn có chắc chắn muốn gỡ tệp đính kèm này?')) return;
    try {
      await removeOccurrenceAttachment(selected.id, attachmentId);
      await refreshAttachments(selected.id);
    } catch {
      alert('Không thể gỡ tệp đính kèm.');
    }
  };

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
                      <span className={styles.searchIcon}></span>
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
                      <option value="">Tất cả loại</option>
                      <option value="preventive">Định kỳ</option>
                      <option value="incident">Sự cố</option>
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
                      <option value="">Tất cả trạng thái</option>
                      {Object.entries(STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
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
                      Xoá bộ lọc
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
                        <span className={styles.assetTagMono}>{item.assetCode || '—'}</span>
                      </td>
                      <td>
                        <div className={styles.rowMain}>
                          <strong className={styles.rowTitle}>{item.title}</strong>
                          {itemPerformers?.length ? (
                            <span className={styles.performerTag}>{itemPerformers.join(', ')}</span>
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
                    <span className={styles.factValue}>{selected.assigneeName}</span>
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

              {/* Khu vực tệp đính kèm đã lưu theo hồ sơ */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px',
                  borderRadius: '6px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Paperclip size={15} color="#475569" />
                    Tài liệu & Tệp đính kèm ({loadedAttachments.length})
                  </span>
                  {loadingAttachments ? (
                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>Đang tải…</span>
                  ) : null}
                </div>

                {loadedAttachments.length === 0 && !loadingAttachments ? (
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                    Chưa có tài liệu hay ảnh hiện trường nào được đính kèm.
                  </span>
                ) : null}

                {loadedAttachments.map((att) => (
                  <div
                    key={att.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      borderRadius: '5px',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      fontSize: '12.5px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#0f172a', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {att.fileName}
                        </span>
                        {att.sizeBytes != null ? (
                          <small style={{ color: '#64748b' }}>
                            ({att.sizeBytes < 1024 * 1024
                              ? `${(att.sizeBytes / 1024).toFixed(1)} KB`
                              : `${(att.sizeBytes / (1024 * 1024)).toFixed(1)} MB`})
                          </small>
                        ) : null}
                      </div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {dateOnly.format(new Date(att.createdAt))}
                        {att.uploadedBy ? ` · ${att.uploadedBy}` : ''}
                        {att.note ? ` · ${att.note}` : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => void handleDownload(att.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          color: '#2563eb',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title="Mở xem / Tải về"
                      >
                        <Download size={13} />
                        <span>Mở / Tải</span>
                      </button>

                      {canManage && !selected.completedAt ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteAttachment(att.id)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#dc2626',
                            cursor: 'pointer',
                            padding: '4px',
                          }}
                          title="Gỡ tệp"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {selected.completedAt ? (
                <div className={styles.resultBox}>
                  <div className={styles.resultHead}>
                    <span>Kết quả thực hiện</span>
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

                  {/* Phần tệp đính kèm hồ sơ đóng */}
                  <div className={styles.actionField}>
                    <label className={styles.actionLabel}>
                      Tệp đính kèm / Biên bản nghiệm thu & Ảnh hiện trường
                    </label>
                    
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: '1px dashed #cbd5e1',
                        background: '#f8fafc',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label
                          htmlFor="history-file-upload"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            borderRadius: '5px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#1e293b',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          Chọn tệp tải lên
                        </label>
                        <input
                          id="history-file-upload"
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.mp4,.mov"
                          style={{ display: 'none' }}
                          onChange={(event) => {
                            const files = event.target.files;
                            if (!files || files.length === 0) return;
                            const ALLOWED_EXTENSIONS = new Set([
                              'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'
                            ]);
                            const MAX_BYTES = 25 * 1024 * 1024;
                            const validFiles: Array<{ file: File; name: string; size: string }> = [];
                            const rejectedNames: string[] = [];

                            Array.from(files).forEach((file) => {
                              const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                              if (!ALLOWED_EXTENSIONS.has(ext)) {
                                rejectedNames.push(`${file.name} (định dạng không hỗ trợ)`);
                                return;
                              }
                              if (file.size > MAX_BYTES) {
                                rejectedNames.push(`${file.name} (vượt quá 25MB)`);
                                return;
                              }
                              validFiles.push({
                                file,
                                name: file.name,
                                size:
                                  file.size < 1024 * 1024
                                    ? `${(file.size / 1024).toFixed(1)} KB`
                                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                              });
                            });

                            if (rejectedNames.length > 0) {
                              alert(`Không thể tải lên các tệp sau:\n- ${rejectedNames.join('\n- ')}\n\nChỉ chấp nhận các tệp tài liệu và hình ảnh (.pdf, .doc, .docx, .xls, .xlsx, .csv, .jpg, .png, .mp4) dung lượng tối đa 25MB.`);
                            }

                            if (validFiles.length > 0) {
                              setPendingFiles((prev) => [...prev, ...validFiles]);
                            }
                            event.target.value = '';
                          }}
                        />
                        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                          (PDF, Word, Excel, JPG, PNG, MP4 - Tối đa 25MB)
                        </span>
                      </div>

                      {/* Danh sách các tệp chờ tải lên khi đóng hồ sơ */}
                      {pendingFiles.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                          {pendingFiles.map((item, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifySelf: 'stretch',
                                justifyContent: 'space-between',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                background: '#ffffff',
                                border: '1px solid #e2e8f0',
                                fontSize: '12px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                <span style={{ color: '#2563eb', fontWeight: 500, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  {item.name}
                                </span>
                                <small style={{ color: '#94a3b8' }}>({item.size})</small>
                              </div>
                              <button
                                type="button"
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#ef4444',
                                  cursor: 'pointer',
                                  padding: '2px 4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}
                                onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                                title="Gỡ tệp"
                              >
                                Xoá
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className={styles.actionFoot}>
                    <button
                      type="button"
                      className={styles.completeSubmitBtn}
                      disabled={busy || uploadingAttachment || !note.trim()}
                      onClick={async () => {
                        try {
                          if (pendingFiles.length > 0) {
                            setUploadingAttachment(true);
                            await Promise.all(
                              pendingFiles.map((item) =>
                                uploadOccurrenceAttachment(selected.id, item.file, 'Đính kèm khi hoàn thành'),
                              ),
                            );
                          }
                          onComplete(selected.id, note.trim());
                          setPendingFiles([]);
                        } catch {
                          alert('Không tải được một số tệp đính kèm.');
                        } finally {
                          setUploadingAttachment(false);
                        }
                      }}
                    >
                      {busy || uploadingAttachment ? 'Đang lưu…' : 'Đánh dấu hoàn thành'}
                    </button>
                    <small className={styles.actionHint}>
                      Khi đã hoàn thành, hồ sơ sẽ được khoá và chuyển trạng thái lưu trữ.
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
