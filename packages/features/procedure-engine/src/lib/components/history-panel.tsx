'use client';

import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useState } from 'react';
import { ACTION_TONE, activityTime, dayLabel } from './activity-format';
import styles from './workspace-board.module.scss';

const PAGE = 20;

/**
 * Lịch sử thao tác, tổ chức theo LƯỢT.
 *
 * Một hồ sơ có C hoặc A thì không chạy thẳng một mạch: bị trả về là quay lại
 * bước trước và làm lại. Xếp phẳng theo thời gian thì người giám sát không thấy
 * được nó đã lặp mấy vòng, và vì sao cùng một bước lại xuất hiện nhiều lần.
 *
 * Mỗi hành động `return` mở một lượt mới cho những gì diễn ra sau đó. Đếm lượt
 * theo chiều thời gian tăng dần rồi mới đảo lại để hiển thị mới-nhất-trước.
 */
export function HistoryPanel({ instance }: { instance: ProcedureInstance }) {
  const [visible, setVisible] = useState(PAGE);

  const stepNameById = useMemo(
    () => new Map(instance.steps.map((step) => [step.id, `${step.key} · ${step.name}`])),
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

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <h3 className={styles.panelTitle}>Lịch sử thao tác</h3>
        <span className={styles.stepBadge}>
          {rounds.entries.length} mục{rounds.total > 1 ? ` · ${rounds.total} lượt` : ''}
        </span>
      </header>

      <ol className={styles.feed}>
        {shown.map((item, index) => {
          const { entry } = item;
          const tone = ACTION_TONE[entry.action] ?? ACTION_TONE.comment;
          const previous = shown[index - 1];
          const showRound = rounds.total > 1 && (index === 0 || previous.round !== item.round);
          const showDay =
            index === 0 || dayLabel(previous.entry.createdAt) !== dayLabel(entry.createdAt);
          const stepName = entry.stepInstanceId
            ? stepNameById.get(entry.stepInstanceId)
            : undefined;
          return (
            <li key={entry.id}>
              {showRound ? <div className={styles.feedRound}>Lượt {item.round}</div> : null}
              {showDay ? <div className={styles.feedDay}>{dayLabel(entry.createdAt)}</div> : null}
              <div className={styles.feedRow}>
                <span className={`${styles.feedDot} ${styles[tone]}`} aria-hidden="true" />
                <div>
                  <strong>
                    {entry.actorName} — {entry.summary}
                  </strong>
                  {stepName ? <p className={styles.feedStep}>{stepName}</p> : null}
                  {entry.comment ? <p className={styles.feedComment}>{entry.comment}</p> : null}
                  <small>{activityTime.format(new Date(entry.createdAt))}</small>
                </div>
              </div>
            </li>
          );
        })}
        {rounds.entries.length === 0 ? (
          <li className={styles.panelHint}>Chưa có thao tác nào.</li>
        ) : null}
      </ol>

      {visible < rounds.entries.length ? (
        <button
          type="button"
          className={styles.ghost}
          onClick={() => setVisible((count) => count + PAGE)}
        >
          Xem thêm
        </button>
      ) : null}
    </section>
  );
}
