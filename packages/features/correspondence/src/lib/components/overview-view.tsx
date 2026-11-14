'use client';

import {
  DIRECTION_STAGES,
  LETTER_DIRECTION_LABELS,
  LETTER_STAGE_LABELS,
  type CorrespondenceOverview,
  type LetterDirection,
  type LetterStage,
} from '@enterprise-platform/contracts-correspondence';
import styles from '../correspondence.module.scss';
import type { CorrespondenceView } from '../correspondence.model';
import { LetterTable } from './letter-table';

/** Tổng quan: số liệu nhanh, công văn theo bước của từng luồng, công văn cần xử lý gấp. */
export function OverviewView({
  overview,
  today,
  onNavigate,
  onOpenStage,
  onOpenLetter,
}: {
  readonly overview: CorrespondenceOverview;
  readonly today: string;
  readonly onNavigate: (view: CorrespondenceView) => void;
  readonly onOpenStage: (direction: LetterDirection, stage: LetterStage) => void;
  readonly onOpenLetter: (letterId: string) => void;
}) {
  const stats: { label: string; value: number; tone?: string; view: CorrespondenceView }[] = [
    { label: 'Cần tôi xử lý', value: overview.awaitingMe, tone: 'stat-accent', view: 'mine' },
    { label: 'Công văn đến đang xử lý', value: overview.incomingOpen, view: 'incoming' },
    { label: 'Công văn đi đang xử lý', value: overview.outgoingOpen, view: 'outgoing' },
    { label: 'Đang trình duyệt', value: overview.awaitingApproval, tone: 'stat-warning', view: 'incoming' },
    { label: 'Quá hạn', value: overview.overdue, tone: 'stat-danger', view: 'incoming' },
    { label: 'Đã lưu trữ', value: overview.archived, tone: 'stat-success', view: 'archive' },
  ];
  return (
    <div className={styles.page}>
      <div className={styles.stats}>
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            className={`${styles.stat} ${stat.tone ? styles[stat.tone] : ''}`}
            onClick={() => onNavigate(stat.view)}
          >
            <b>{stat.value}</b>
            <span>{stat.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.flowColumns}>
        {(['incoming', 'outgoing'] as const).map((direction) => {
          const stages = DIRECTION_STAGES[direction];
          const total = stages.reduce((sum, stage) => sum + (overview.byStage[direction][stage] ?? 0), 0);
          return (
            <section key={direction} className={styles.card}>
              <div className={styles.cardHead}>
                <h2>{LETTER_DIRECTION_LABELS[direction]} theo bước</h2>
                <span className={styles.muted}>{total === 0 ? 'Không có công văn đang mở' : `${total} công văn đang mở`}</span>
              </div>
              <ol className={styles.stageFlow}>
                {stages.map((stage, index) => {
                  const count = overview.byStage[direction][stage] ?? 0;
                  return (
                    <li key={stage} className={styles.stageItem}>
                      <button
                        type="button"
                        className={`${styles.stageStep} ${count > 0 ? styles.stageStepBusy : ''}`}
                        aria-label={`${LETTER_STAGE_LABELS[stage]}: ${count} công văn`}
                        onClick={() => onOpenStage(direction, stage)}
                      >
                        <span className={styles.stageDot} aria-hidden>
                          {index + 1}
                        </span>
                        <b>{count}</b>
                        <span className={styles.stageLabel}>{LETTER_STAGE_LABELS[stage]}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
      <section>
        <div className={styles.cardHead}>
          <h2 style={{ fontSize: 15 }}>Cần xử lý gấp</h2>
        </div>
        <LetterTable letters={overview.urgent} mode="mixed" today={today} emptyText="Không còn công văn nào đang mở." onOpen={onOpenLetter} />
      </section>
    </div>
  );
}
