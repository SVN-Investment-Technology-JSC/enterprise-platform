'use client';

import {
  LETTER_FLOW_LABELS,
  LETTER_FLOW_STAGES,
  type CorrespondenceOverview,
  type LetterStage,
} from '@enterprise-platform/contracts-correspondence';
import styles from '../correspondence.module.scss';
import type { CorrespondenceView } from '../correspondence.model';
import { LetterTable } from './letter-table';

/** Tổng quan: số liệu nhanh, công văn theo từng bước, công văn cần xử lý gấp. */
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
  readonly onOpenStage: (stage: LetterStage) => void;
  readonly onOpenLetter: (letterId: string) => void;
}) {
  const stats: { label: string; value: number; tone?: string; view: CorrespondenceView }[] = [
    { label: 'Cần tôi xử lý', value: overview.awaitingMe, tone: 'stat-accent', view: 'mine' },
    { label: 'Đang xử lý', value: overview.open, view: 'incoming' },
    { label: 'Chờ lãnh đạo cho ý kiến', value: overview.awaitingLeader, tone: 'stat-warning', view: 'incoming' },
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
      <section className={styles.card}>
        <h2>Công văn theo từng bước xử lý</h2>
        <div className={styles.flow}>
          {LETTER_FLOW_STAGES.map((stage, index) => (
            <button key={stage} type="button" className={styles.flowStep} onClick={() => onOpenStage(stage)}>
              <b>{overview.byStage[stage] ?? 0}</b>
              {LETTER_FLOW_LABELS[index]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className={styles.cardHead}>
          <h2 style={{ fontSize: 15 }}>Cần xử lý gấp</h2>
          <button type="button" className={styles.buttonLink} onClick={() => onNavigate('incoming')}>
            Xem tất cả công văn đến
          </button>
        </div>
        <LetterTable
          letters={overview.urgent}
          mode="incoming"
          today={today}
          emptyText="Không còn công văn nào đang mở."
          onOpen={onOpenLetter}
        />
      </section>
    </div>
  );
}
