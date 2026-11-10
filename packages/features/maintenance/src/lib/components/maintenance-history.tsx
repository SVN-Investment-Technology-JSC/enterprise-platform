'use client';

import type {
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceOccurrence,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
  OccurrenceAttachment,
} from '@enterprise-platform/contracts-maintenance';
import { formatDate, formatDateTime, SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Download, ListFilter, Paperclip, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadOccurrenceAttachments,
  occurrenceAttachmentDownloadUrl,
  removeOccurrenceAttachment,
  uploadOccurrenceAttachment,
} from '../maintenance-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { TablePagerBar } from '../ui/table-pager-bar';
import { Tip } from '../ui/tooltip';
import { describeDispatchFailure } from '../maintenance-messages';
import { cn } from '../utils';
import { SELECT_CLASS } from '../ui/select-class';
import { useFillViewportHeight } from '../ui/use-fill-viewport';
import styles from './maintenance-history.module.scss';

const KIND_LABEL: Record<MaintenanceOccurrenceKind, string> = {
  preventive: 'Định kỳ',
  incident: 'Sự cố',
};

const KIND_OPTIONS = [
  { value: '', label: 'Tất cả loại' },
  { value: 'preventive', label: 'Định kỳ' },
  { value: 'incident', label: 'Sự cố' },
];

const STATUS_LABEL: Record<MaintenanceOccurrenceStatus, string> = {
  planned: 'Đã lên lịch',
  in_progress: 'Đang xử lý',
  dispatch_pending: 'Chờ tạo phiếu',
  generated: 'Đã tạo phiếu',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  blocked: 'Bị chặn',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Tất cả trạng thái' },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

const PAGE_SIZES = [15, 30, 45, 60];

const TH =
  'sticky top-0 z-10 whitespace-nowrap border-b border-slate-300 bg-[#e9eef5] px-3.5 py-2.5 text-left text-[0.8125rem] font-bold uppercase tracking-wide text-slate-700';
const TD = 'px-3.5 py-3 align-middle text-sm text-foreground';

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
  onRetryDispatch,
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
  /** Gửi lại phiếu báo lỗi sang Quy trình. */
  onRetryDispatch: (id: string) => void;
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

  // Khung bảng chiếm đúng phần cao còn lại của màn hình; quá dài thì chỉ cuộn trong bảng.
  const cardRef = useRef<HTMLDivElement>(null);
  useFillViewportHeight(cardRef, 320, undefined, 16);
  const activeFilterCount = (filter.kind ? 1 : 0) + (filter.status ? 1 : 0);

  return (
    <section className={styles.history}>
      {/* 1. HEADER TỐI GIẢN */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="m-0 mb-1 text-xl font-bold tracking-tight text-foreground">
            Lịch sử bảo trì thiết bị
          </h2>
          <p className="m-0 text-sm leading-snug text-muted-foreground">
            Nhật ký kiểm tra, bảo dưỡng phòng ngừa định kỳ và khắc phục sự cố kỹ thuật trên toàn hệ thống ({page?.stats.total ?? 0} lượt).
          </p>
        </div>
      </header>

      {/* 2. BẢNG DỮ LIỆU ĐƠN DUY NHẤT CHIẾM TRỌN CHIỀU NGANG */}
      <div
        ref={cardRef}
        className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
      >
        {/* THANH TÌM KIẾM & BỘ LỌC */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
          <div className="relative min-w-[180px] max-w-[320px] flex-1 basis-60">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              className="h-9 rounded-md pl-8 text-sm"
              placeholder="Tìm theo mã thiết bị (MBA-01, MC-22)..."
              aria-label="Tìm theo mã thiết bị"
              defaultValue={filter.assetCode ?? ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onFilter({ ...filter, assetCode: (e.target as HTMLInputElement).value, cursor: undefined });
                }
              }}
              onBlur={(event) => onFilter({ ...filter, assetCode: event.target.value, cursor: undefined })}
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" size="lg" className="gap-1.5 rounded-md px-3" aria-label="Bộ lọc" />
              }
            >
              <ListFilter />
              Bộ lọc
              {activeFilterCount > 0 ? (
                <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-slate-700">Loại hình</span>
            <SearchableSelect
              className={SELECT_CLASS}
            height={36}
            searchInDropdown
            hideDropdownSearch
            clearable={false}
            value={filter.kind ?? ''}
            options={KIND_OPTIONS}
            onChange={(value) =>
              onFilter({
                ...filter,
                kind: (value || undefined) as MaintenanceOccurrenceKind | undefined,
                cursor: undefined,
              })
            }
            />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-slate-700">Trạng thái</span>
            <SearchableSelect
              className={SELECT_CLASS}
            height={36}
            searchInDropdown
            hideDropdownSearch
            clearable={false}
            value={filter.status ?? ''}
            options={STATUS_OPTIONS}
            onChange={(value) =>
              onFilter({
                ...filter,
                status: (value || undefined) as MaintenanceOccurrenceStatus | undefined,
                cursor: undefined,
              })
            }
            />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-1.5">
            <div className="w-[150px]">
              <DatePickerInput
                height={36}
                placeholder="Từ ngày"
                aria-label="Từ ngày"
                value={filter.from?.slice(0, 10) ?? ''}
                onChange={(value) => onFilter({ ...filter, from: value || undefined, cursor: undefined })}
              />
            </div>
            <span className="text-sm text-slate-400">→</span>
            <div className="w-[150px]">
              <DatePickerInput
                height={36}
                placeholder="Đến ngày"
                aria-label="Đến ngày"
                value={filter.to?.slice(0, 10) ?? ''}
                onChange={(value) => onFilter({ ...filter, to: value || undefined, cursor: undefined })}
              />
            </div>
          </div>

          <Tip content="Xóa toàn bộ bộ lọc và đặt lại mặc định">
            <Button
              variant="outline"
              size="lg"
              className="rounded-md px-3"
              onClick={() => onFilter({})}
            >
              Xoá bộ lọc
            </Button>
          </Tip>
        </div>

        <div className="min-h-0 w-full flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className={cn(TH, 'w-[120px]')}>Loại hình</th>
                <th className={cn(TH, 'w-[130px]')}>Mã thiết bị</th>
                <th className={TH}>Tiêu đề & Hạng mục bảo trì</th>
                <th className={cn(TH, 'w-[140px]')}>Ngày thực hiện</th>
                <th className={cn(TH, 'w-[150px]')}>Trạng thái</th>
                <th className={cn(TH, 'w-[140px]')}>WorkOrder</th>
              </tr>
            </thead>

            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">
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
                      className={cn(
                        'cursor-pointer border-b border-slate-100 transition-colors hover:bg-muted',
                        isSelected && 'bg-blue-50 hover:bg-blue-50',
                      )}
                      onClick={() => {
                        setNote('');
                        onSelect(item);
                      }}
                    >
                      <td className={TD}>
                        <span className={`${styles.kindBadge} ${styles[item.kind]}`}>
                          {KIND_LABEL[item.kind]}
                        </span>
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap font-mono font-semibold text-slate-700')}>
                        {item.assetCode || '—'}
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col gap-1">
                          <strong className="text-sm font-semibold leading-snug text-foreground">
                            {item.title}
                          </strong>
                          {itemPerformers?.length ? (
                            <span className="text-[0.8125rem] text-muted-foreground">
                              {itemPerformers.join(', ')}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap text-slate-700')}>
                        {formatDate(item.dueAt)}
                      </td>
                      <td className={TD}>
                        <span className={`${styles.statusBadge} ${styles[`st_${item.status}`]}`}>
                          <span className={styles.statusDot} />
                          {STATUS_LABEL[item.status]}
                        </span>
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>
                        {item.procedureInstanceCode ? (
                          <span className="font-mono font-semibold text-blue-600">
                            #{item.procedureInstanceCode}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
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
        <TablePagerBar
          summary={
            <>
              Hiển thị <strong>{items.length > 0 ? 1 : 0}–{items.length}</strong> /{' '}
              <strong>{page?.stats.total ?? items.length}</strong> bản ghi
            </>
          }
          pageSize={filter.limit ?? 15}
          pageSizeOptions={PAGE_SIZES}
          onPageSizeChange={(limit) => onFilter({ ...filter, limit, cursor: undefined })}
        >
          <Tip content="Làm mới / Về đầu">
            <span className="inline-flex">
              <Button
                variant="outline"
                size="lg"
                className="rounded-md px-3"
                disabled={busy}
                onClick={() => onFilter({ ...filter, cursor: undefined })}
              >
                ← Đầu
              </Button>
            </span>
          </Tip>
          <Tip content="Tải tiếp trang sau">
            <span className="inline-flex">
              <Button
                variant="outline"
                size="lg"
                className="rounded-md px-3"
                disabled={busy || !page?.nextCursor}
                onClick={onLoadMore}
              >
                {busy ? 'Đang nạp…' : 'Sau →'}
              </Button>
            </span>
          </Tip>
        </TablePagerBar>
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
                  {KIND_LABEL[selected.kind]}
                </span>
                <h3 className={styles.drawerTitle}>{selected.title}</h3>
              </div>
              <Tip content="Đóng (ESC)">
                <button
                  type="button"
                  className={styles.closeDrawerBtn}
                  onClick={() => onSelect(undefined)}
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </Tip>
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
                  <span className={styles.factValue}>{formatDateTime(selected.dueAt)}</span>
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

              {/* Gửi sang Quy trình lỗi: hiện lý do và cho thử lại; đang tự thử lại thì chỉ báo tình trạng. */}
              {!selected.procedureInstanceCode && selected.failureReason && !selected.completedAt ? (
                <div
                  role="alert"
                  className={cn(
                    'flex flex-col gap-2 rounded-md border px-3 py-2.5 text-sm',
                    selected.status === 'failed'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800',
                  )}
                >
                  <strong className="font-semibold">
                    {selected.status === 'failed'
                      ? 'Không tạo được hồ sơ bên Quy trình'
                      : 'Đang gửi sang Quy trình, hệ thống tự thử lại'}
                  </strong>
                  <span>{describeDispatchFailure(selected.failureReason)}</span>
                  {selected.status === 'failed' && canManage ? (
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => onRetryDispatch(selected.id)}
                      >
                        Thử lại tạo phiếu
                      </Button>
                    </div>
                  ) : null}
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
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Paperclip size={15} color="#475569" />
                    Tài liệu & Tệp đính kèm ({loadedAttachments.length})
                  </span>
                  {loadingAttachments ? (
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Đang tải…</span>
                  ) : null}
                </div>

                {loadedAttachments.length === 0 && !loadingAttachments ? (
                  <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
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
                      fontSize: '13px',
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
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {formatDate(att.createdAt)}
                        {att.uploadedBy ? ` · ${att.uploadedBy}` : ''}
                        {att.note ? ` · ${att.note}` : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Tip content="Mở xem / Tải về">
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
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <Download size={13} />
                          <span>Mở / Tải</span>
                        </button>
                      </Tip>

                      {canManage && !selected.completedAt ? (
                        <Tip content="Gỡ tệp">
                          <button
                            aria-label="Gỡ tệp"
                            type="button"
                            onClick={() => void handleDeleteAttachment(att.id)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: '#dc2626',
                              cursor: 'pointer',
                              padding: '4px',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Tip>
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
                      Hoàn tất: {formatDateTime(selected.completedAt)}
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
                            fontSize: '13px',
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
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
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
                                fontSize: '13px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                <span style={{ color: '#2563eb', fontWeight: 500, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  {item.name}
                                </span>
                                <small style={{ color: '#94a3b8' }}>({item.size})</small>
                              </div>
                              <Tip content="Gỡ tệp">
                                <button
                                  aria-label="Gỡ tệp"
                                  type="button"
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                  }}
                                  onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                                >
                                  Xoá
                                </button>
                              </Tip>
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
