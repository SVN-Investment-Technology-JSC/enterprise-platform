'use client';

import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useState } from 'react';
import { activityTime, dayLabel } from './activity-format';
import styles from './workspace-board.module.scss';

const PAGE = 20;

/**
 * Lịch sử thao tác, tổ chức theo LƯỢT / PHIÊN LÀM VIỆC.
 *
 * Tách biệt rõ ràng từng phiên (Lượt 1, Lượt 2, ...) sau các lần trả về.
 * Phân biệt trực quan bằng màu sắc và badge giữa các bước Duyệt/Hoàn tất và bước Trả về/Từ chối.
 */
export function HistoryPanel({ instance }: { instance: ProcedureInstance }) {
  const [visible, setVisible] = useState(PAGE);

  const stepNameById = useMemo(
    () => new Map(instance.steps.map((step) => [step.id, `${step.key ? `${step.key} · ` : ''}${step.name}`])),
    [instance.steps],
  );

  const rounds = useMemo(() => {
    // Bình luận đã có tab riêng; ở đây chỉ giữ các chuyển trạng thái.
    const changes = instance.activity.filter((entry) => entry.action !== 'comment');
    const oldestFirst = [...changes].reverse();

    let round = 1;
    const numbered = oldestFirst.map((entry) => {
      const current = { entry, round };
      // `return` thuộc về lượt đang chạy; lượt mới bắt đầu từ hành động kế tiếp.
      if (entry.action === 'return') round += 1;
      return current;
    });
    return { total: round, entries: numbered.reverse() };
  }, [instance.activity]);

  const shown = rounds.entries.slice(0, visible);

  const groupedRounds = useMemo(() => {
    const groups: { round: number; entries: (typeof rounds.entries)[number][] }[] = [];
    for (const item of shown) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.round === item.round) {
        lastGroup.entries.push(item);
      } else {
        groups.push({ round: item.round, entries: [item] });
      }
    }
    return groups;
  }, [shown]);

  return (
    <section className={styles.panel}>
      <header className={styles.historyHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 className={styles.panelTitle}>📜 Lịch sử thao tác</h3>
        </div>
        <span className={styles.historySummaryBadge}>
          {rounds.entries.length} thao tác{rounds.total > 1 ? ` · ${rounds.total} phiên/lượt` : ''}
        </span>
      </header>

      {groupedRounds.length === 0 ? (
        <p className={styles.panelHint}>Chưa có thao tác nào được ghi nhận.</p>
      ) : (
        <div className={styles.historyRoundsContainer}>
          {groupedRounds.map((group) => {
            const isLatest = group.round === rounds.total;
            return (
              <div
                key={group.round}
                className={`${styles.historyRoundCard} ${isLatest ? styles.historyRoundLatest : ''}`}
              >
                {/* Round Header */}
                <div className={styles.roundHeader}>
                  <div className={styles.roundTitleRow}>
                    <span className={styles.roundIcon}>🔄</span>
                    <span className={styles.roundTitle}>
                      Phiên / Lượt {group.round}
                    </span>
                    {isLatest ? (
                      <span className={styles.roundCurrentTag}>Phiên gần nhất</span>
                    ) : (
                      <span className={styles.roundPastTag}>Phiên trước</span>
                    )}
                  </div>
                  <span className={styles.roundCountHint}>
                    {group.entries.length} sự kiện
                  </span>
                </div>

                {/* Feed Items inside this round */}
                <div className={styles.roundTimeline}>
                  {group.entries.map((item) => {
                    const { entry } = item;
                    const isReturn = entry.action === 'return';
                    const isReject = entry.action === 'reject' || entry.action === 'cancel';
                    const isApprove = entry.action === 'approve' || entry.action === 'complete';
                    const isStart = entry.action === 'start';

                    const itemTypeClass = isReturn
                      ? styles.historyItemReturn
                      : isReject
                        ? styles.historyItemReject
                        : isApprove
                          ? styles.historyItemApprove
                          : isStart
                            ? styles.historyItemStart
                            : styles.historyItemNeutral;

                    const actionBadgeLabel = isReturn
                      ? '↩️ Đã trả hồ sơ về'
                      : isReject
                        ? '✗ Đã từ chối / huỷ'
                        : isApprove
                          ? '✓ Phê duyệt / Hoàn tất'
                          : isStart
                            ? '🚀 Khởi tạo'
                            : 'Thao tác';

                    const stepName = entry.stepInstanceId
                      ? stepNameById.get(entry.stepInstanceId)
                      : undefined;

                    return (
                      <div key={entry.id} className={`${styles.historyEventItem} ${itemTypeClass}`}>
                        {/* Event Card Content */}
                        <div className={styles.eventCard}>
                          <div className={styles.eventCardHeader}>
                            <span className={styles.eventActionBadge}>{actionBadgeLabel}</span>
                            <span className={styles.eventTime}>
                              {dayLabel(entry.createdAt)} · {activityTime.format(new Date(entry.createdAt))}
                            </span>
                          </div>

                          <div className={styles.eventMain}>
                            <div className={styles.eventActorSummary}>
                              <strong className={styles.eventActor}>{entry.actorName}</strong>
                              <span className={styles.eventSummary}>— {entry.summary}</span>
                            </div>
                            {stepName ? (
                              <div className={styles.eventStepName}>
                                <span className={styles.eventStepIcon}>📍</span>
                                <span>{stepName}</span>
                              </div>
                            ) : null}
                          </div>

                          {entry.comment ? (
                            <div className={styles.eventCommentBox}>
                              <span className={styles.eventCommentLabel}>Ý kiến / Lý do:</span>
                              <p className={styles.eventCommentText}>{entry.comment}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {visible < rounds.entries.length ? (
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setVisible((count) => count + PAGE)}
          >
            Xem thêm thao tác cũ hơn ({rounds.entries.length - visible} mục)
          </button>
        </div>
      ) : null}
    </section>
  );
}
