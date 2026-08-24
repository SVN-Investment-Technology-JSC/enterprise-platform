'use client';

import type { ProcedureSlaView } from '@enterprise-platform/contracts-procedure-engine';
import styles from './workspace-board.module.scss';

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
});

/** “2h 15p” — bỏ phần giây, giám sát không quan tâm tới độ chính xác đó. */
function formatDuration(ms: number): string {
  const total = Math.abs(Math.round(ms / 60_000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}p`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}p`;
}

export function slaLabel(view: ProcedureSlaView): string {
  if (view.state === 'none' || view.remainingMs === undefined) return '—';
  if (view.state === 'breached') return `Quá ${formatDuration(view.remainingMs)}`;
  return `Còn ${formatDuration(view.remainingMs)}`;
}

/**
 * Chỉ báo SLA của một bước hoặc một hồ sơ.
 *
 * Bước không cài SLA hiện dấu “—” chứ không phải màu xanh: không cam kết khác
 * với đang kịp tiến độ (AC-SLA-04).
 */
export function SlaBadge({
  view,
  slaHours,
  startedAt,
}: {
  view: ProcedureSlaView;
  slaHours?: number;
  startedAt?: string;
}) {
  if (view.state === 'none') {
    return (
      <span className={styles.slaNone} title="Bước này không cài SLA.">
        —
      </span>
    );
  }

  const tooltip = [
    slaHours ? `SLA: ${slaHours} giờ` : undefined,
    startedAt ? `Bắt đầu: ${dateTime.format(new Date(startedAt))}` : undefined,
    view.dueAt ? `Hạn: ${dateTime.format(new Date(view.dueAt))}` : undefined,
    view.frozen ? 'Đã dừng đếm' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={`${styles.sla} ${styles[`sla_${view.state}`]} ${view.frozen ? styles.slaFrozen : ''}`}
      title={tooltip}
    >
      {slaLabel(view)}
    </span>
  );
}
