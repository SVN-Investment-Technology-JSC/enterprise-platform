'use client';

import type {
  WorkItem,
  WorkItemStatusHistoryEntry,
} from '@enterprise-platform/contracts-workspace';
import { branchOf } from '../project-tree.model';
import { WORK_ITEM_STATUS_LABELS, WORK_ITEM_STATUS_TONE } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

export interface TabActivityProps {
  readonly entries: readonly WorkItemStatusHistoryEntry[];
  readonly items: readonly WorkItem[];
  /** Rỗng nghĩa là xem nhật ký của cả dự án. */
  readonly selected?: WorkItem;
  /** Bấm một khối để mở công việc của nó (trừ chính việc đang mở). */
  readonly onOpen?: (item: WorkItem) => void;
}

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

const dayKey = (value: string) =>
  new Date(value).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

const timeOf = (value: string) =>
  new Date(value).toLocaleTimeString('vi-VN', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });

/** "Hôm nay", "Hôm qua", hay "Thứ Năm, 09/10/2026". */
function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return 'Hôm nay';
  if (key === yesterday) return 'Hôm qua';
  const date = new Date(`${key}T12:00:00+07:00`);
  return date.toLocaleDateString('vi-VN', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

interface ItemBlock {
  readonly workItemId: string;
  readonly entries: WorkItemStatusHistoryEntry[];
}

interface DayBlock {
  readonly key: string;
  readonly blocks: ItemBlock[];
}

/**
 * Chia nhật ký theo ngày, rồi gộp các dòng liền nhau của cùng một công việc:
 * một đề nghị duyệt đi qua năm bước thì tên việc hiện một lần, không năm lần.
 */
function groupEntries(entries: readonly WorkItemStatusHistoryEntry[]): DayBlock[] {
  const days: DayBlock[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, blocks: [] };
      days.push(day);
    }
    const last = day.blocks[day.blocks.length - 1];
    if (last && last.workItemId === entry.workItemId) last.entries.push(entry);
    else day.blocks.push({ workItemId: entry.workItemId, entries: [entry] });
  }
  return days;
}

/**
 * Nhật ký chuyển trạng thái, lọc theo nhánh đang chọn.
 *
 * Server trả nhật ký của cả dự án trong một lời gọi và lọc ở client: nhật ký
 * đã bị giới hạn số dòng, nên gọi lại theo từng node chỉ thêm vòng mạng mà
 * không giảm dữ liệu đáng kể.
 */
export function TabActivity({ entries, items, selected, onOpen }: TabActivityProps) {
  const directory = useDirectory();
  const branch = selected ? branchOf(items, selected.id) : undefined;
  const scope = branch ? entries.filter((entry) => branch.has(entry.workItemId)) : entries;
  const itemOf = new Map(items.map((item) => [item.id, item]));

  if (scope.length === 0) {
    return (
      <div className={styles.tabBody}>
        <p className={styles.muted}>Chưa có hoạt động nào được ghi nhận.</p>
      </div>
    );
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.activity}>
        {groupEntries(scope).map((day) => (
          <section key={day.key} className={styles.activityDay}>
            <h4 className={styles.activityDayLabel}>{dayLabel(day.key)}</h4>
            <ol className={styles.activityList}>
              {day.blocks.map((block, index) => {
                const item = itemOf.get(block.workItemId);
                const latest = block.entries[0] as WorkItemStatusHistoryEntry;
                const open =
                  item && onOpen && item.id !== selected?.id ? () => onOpen(item) : undefined;
                return (
                  <li
                    key={`${block.workItemId}-${index}`}
                    className={
                      open
                        ? `${styles.activityBlock} ${styles.activityBlockLink}`
                        : styles.activityBlock
                    }
                    role={open ? 'button' : undefined}
                    tabIndex={open ? 0 : undefined}
                    title={open ? `Mở ${item?.code} · ${item?.title}` : undefined}
                    onClick={open}
                    onKeyDown={
                      open
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              open();
                            }
                          }
                        : undefined
                    }
                  >
                    <span
                      className={styles.activityDot}
                      style={{ background: WORK_ITEM_STATUS_TONE[latest.toStatus].fg }}
                      aria-hidden
                    />
                    <p className={styles.activityItem}>
                      {item ? (
                        <>
                          <span className={styles.activityCode}>{item.code}</span>
                          {item.title}
                        </>
                      ) : (
                        'Công việc đã xoá'
                      )}
                    </p>
                    {block.entries.map((entry) => (
                      <ActivityRow
                        key={entry.id}
                        entry={entry}
                        actor={directory.nameOf(entry.createdBy)}
                      />
                    ))}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ entry, actor }: { entry: WorkItemStatusHistoryEntry; actor: string }) {
  const tone = WORK_ITEM_STATUS_TONE[entry.toStatus];
  // Ghi chú kiểu "Kế toán trưởng duyệt · A, B": phần đầu là bước, phần sau là
  // người. Bước không có người thì 1Office để lại dấu "·" thừa ở cuối.
  const note = entry.note?.replace(/\s*·\s*$/, '').trim();
  const split = note?.indexOf(' · ') ?? -1;
  const step = note && split > 0 ? note.slice(0, split) : note;
  const people = note && split > 0 ? note.slice(split + 3) : undefined;
  return (
    <div className={styles.activityRow}>
      <div className={styles.activityMain}>
        <span className={styles.activityChange}>
          {entry.fromStatus ? (
            <>
              <span className={styles.muted}>{WORK_ITEM_STATUS_LABELS[entry.fromStatus]}</span>
              <span className={styles.muted} aria-hidden>
                →
              </span>
            </>
          ) : (
            <span className={styles.muted}>Khởi tạo</span>
          )}
          <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
            {WORK_ITEM_STATUS_LABELS[entry.toStatus]}
          </span>
          <span className={styles.activityActor}>{actor}</span>
        </span>
        {step ? (
          <span className={styles.activityNote}>
            <b>{step}</b>
            {people ? <span className={styles.muted}> · {people}</span> : null}
          </span>
        ) : null}
      </div>
      <time className={styles.activityTime} dateTime={entry.createdAt}>
        {timeOf(entry.createdAt)}
      </time>
    </div>
  );
}
