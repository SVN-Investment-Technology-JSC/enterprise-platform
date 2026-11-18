'use client';

import type { CalendarOccurrence } from '@enterprise-platform/contracts-workspace';
import {
  PROJECT_REQUEST_STATUS_LABELS,
  PROJECT_REQUEST_STATUS_TONE,
  formatDate,
  formatDateTime,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Dialog } from './dialog';
import { RequestDetailList } from './request-detail-list';
import { useDirectory } from './use-directory';

export interface BusinessTripDialogProps {
  /** Mục công tác trên lịch (có `businessTrip`); `undefined` thì đóng. */
  readonly occurrence?: CalendarOccurrence;
  readonly onClose: () => void;
}

function rangeText(from?: string, to?: string): string {
  if (!from) return '—';
  return !to || to === from ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/**
 * Chi tiết một đơn công tác hiện trên lịch dự án. Chỉ xem: mọi thông tin đã có trong lần đọc lịch (Workspace lưu
 * chi tiết HRM gửi kèm đơn), nên mở không phải gọi thêm và không đưa người dùng sang module khác.
 */
export function BusinessTripDialog({ occurrence, onClose }: BusinessTripDialogProps) {
  const directory = useDirectory();
  const trip = occurrence?.businessTrip;
  const tone = trip ? PROJECT_REQUEST_STATUS_TONE[trip.status] : undefined;
  const who = trip ? (trip.requesterName ?? directory.nameOf(trip.requesterUserId)) : '';

  return (
    <Dialog
      open={Boolean(trip)}
      title={trip ? `${trip.requestTypeLabel} ${trip.code}` : 'Đơn công tác'}
      subtitle={who ? `Người đi công tác: ${who}` : undefined}
      submitLabel="Đóng"
      cancelLabel={null}
      guardDiscard={false}
      onClose={onClose}
      onSubmit={onClose}
    >
      {trip ? (
        <>
          <h4 className={styles.tripSectionTitle}>Thông tin đơn</h4>
          <dl className={styles.detailGrid}>
            <dt>Mã đơn</dt>
            <dd>{trip.code}</dd>
            <dt>Loại đơn</dt>
            <dd>{trip.requestTypeLabel}</dd>
            <dt>Người đi</dt>
            <dd>{who}</dd>
            <dt>Thời gian</dt>
            <dd>{rangeText(trip.fromDate, trip.toDate)}</dd>
            <dt>Trạng thái</dt>
            <dd>
              {tone ? (
                <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                  {PROJECT_REQUEST_STATUS_LABELS[trip.status]}
                </span>
              ) : null}
            </dd>
            <dt>Ngày gửi</dt>
            <dd>{formatDateTime(trip.submittedAt)}</dd>
            {trip.statusChangedAt ? (
              <>
                <dt>Cập nhật trạng thái</dt>
                <dd>{formatDateTime(trip.statusChangedAt)}</dd>
              </>
            ) : null}
            <dt>Hồ sơ quy trình</dt>
            <dd>{trip.procedureInstanceCode ?? 'Không chạy quy trình'}</dd>
          </dl>

          <h4 className={styles.tripSectionTitle}>Chi tiết công tác</h4>
          {trip.details && trip.details.length > 0 ? (
            <RequestDetailList details={trip.details} />
          ) : (
            <p className={styles.muted}>Đơn này chưa có chi tiết công tác kèm theo (đơn gửi trước khi có tính năng này).</p>
          )}
        </>
      ) : null}
    </Dialog>
  );
}
