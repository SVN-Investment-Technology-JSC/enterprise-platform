'use client';

import {
  DIRECTION_STAGES,
  LETTER_DIRECTION_LABELS,
  LETTER_STAGE_LABELS,
  type CorrespondenceOverview,
  type LetterDirection,
  type LetterStage,
} from '@enterprise-platform/contracts-correspondence';
import { ChevronRight } from 'lucide-react';
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
        {(['incoming', 'outgoing'] as const).map((direction) => (
          <section key={direction} className={styles.card}>
            <h2>{LETTER_DIRECTION_LABELS[direction]} theo bước</h2>
            <div className={styles.flow}>
              {DIRECTION_STAGES[direction].map((stage, index) => (
                <button key={stage} type="button" className={styles.flowStep} onClick={() => onOpenStage(direction, stage)}>
                  <b>{overview.byStage[direction][stage] ?? 0}</b>
                  <span>{LETTER_STAGE_LABELS[stage]}</span>
                  {index < DIRECTION_STAGES[direction].length - 1 ? <ChevronRight size={14} className={styles.flowArrow} aria-hidden /> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
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
