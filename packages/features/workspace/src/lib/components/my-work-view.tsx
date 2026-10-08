'use client';

import {
  MY_WORK_BUCKETS,
  type MyWorkEvent,
  type MyWorkSummary,
  type ParticipantResponse,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { AtSign, CalendarClock, ExternalLink, RefreshCw } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import * as api from '../workspace-api';
import {
  MY_WORK_BUCKET_LABELS,
  MY_WORK_BUCKET_TONE,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
  formatDateTime,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

const INVITATION_RESPONSES: readonly {
  value: ParticipantResponse;
  label: string;
}[] = [
  { value: 'accepted', label: 'Tham gia' },
  { value: 'tentative', label: 'Có thể' },
  { value: 'declined', label: 'Từ chối' },
];

/**
 * Trang "Công việc của tôi".
 *
 * Chỉ hiển thị dữ liệu của chính người đang đăng nhập — kể cả quản trị viên
 * tenant. Có một dòng giải thích ngay đầu trang để người quản trị không tưởng
 * màn hình bị lọc sai.
 *
 * Bố cục: dải lịch hôm nay và lời mời ở trên cùng, rồi MỘT bảng chia nhóm theo
 * hạn — số việc của từng nhóm nằm ngay trên đầu nhóm, nên không cần thêm hàng
 * thẻ số nhắc lại cùng con số đó.
 */
export function MyWorkView() {
  const directory = useDirectory();
  const [summary, setSummary] = useState<MyWorkSummary>();
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [responding, setResponding] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await api.loadMyWork());
      setError(undefined);
    } catch (cause) {
      setSummary(undefined);
      setError((cause as { message?: string })?.message ?? 'Không tải được dữ liệu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void api.loadIsTenantAdmin().then(setIsTenantAdmin);
  }, [reload]);

  const respond = async (eventId: string, response: ParticipantResponse) => {
    setResponding(eventId);
    setError(undefined);
    try {
      await api.respondToEvent(eventId, { responseStatus: response });
      await reload();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không gửi được phản hồi.');
    } finally {
      setResponding(undefined);
    }
  };

  const advance = async (itemId: string, next: WorkItemStatus) => {
    setError(undefined);
    try {
      // Cùng endpoint với màn Dự án, nên mọi ràng buộc — việc con chưa đóng,
      // tiền nhiệm FS chưa xong — vẫn áp dụng nguyên vẹn ở đây.
      await api.changeWorkItemStatus(itemId, { status: next });
      await reload();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không đổi được trạng thái.');
    }
  };

  const items = summary?.items ?? [];
  const events = summary?.todayEvents ?? [];
  const invitations = summary?.pendingInvitations ?? [];

  return (
    <div className={styles.tabBody}>
      {isTenantAdmin ? (
        <p className={styles.notice}>
          Bạn là quản trị viên tenant, nhưng màn hình này{' '}
          <strong>luôn chỉ hiện việc của chính bạn</strong>. Muốn xem toàn bộ dự án, hãy dùng trang
          Dự án hoặc Báo cáo.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {events.length > 0 || invitations.length > 0 ? (
        <section className={styles.dayStrip} aria-label="Lịch hôm nay và lời mời">
          <CalendarClock size={16} aria-hidden className={styles.dayStripIcon} />
          <span className={styles.dayStripTitle}>
            {events.length > 0
              ? `Hôm nay bạn có ${events.length} lịch`
              : 'Hôm nay bạn không có lịch nào'}
          </span>
          {events.map((event) => (
            <span key={`event-${event.eventId}`} className={styles.dayChip}>
              <b>{event.allDay ? 'Cả ngày' : formatTime(event.startAt)}</b> {event.title}
              {event.location ? <span className={styles.muted}> · {event.location}</span> : null}
            </span>
          ))}
          {invitations.map((event) => (
            <InvitationChip
              key={`invite-${event.eventId}`}
              event={event}
              busy={responding === event.eventId}
              onRespond={(response) => void respond(event.eventId, response)}
            />
          ))}
        </section>
      ) : null}

      <div className={styles.summaryLine}>
        <span>
          <b>{summary?.counters.openItems ?? '—'}</b> việc đang mở
        </span>
        <span>
          Đã xong tuần này{' '}
          <b className={styles.textSuccess}>{summary?.counters.completedThisWeek ?? '—'}</b>
        </span>
        <span className={styles.muted}>
          Múi giờ {summary?.timezone ?? '…'} · hôm nay {formatDate(summary?.today) || '…'}
        </span>
        <span className={styles.summarySpacer} />
        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          title="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <section className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Công việc</th>
                <th>Dự án</th>
                <th>Ưu tiên</th>
                <th>Trạng thái</th>
                <th>Hạn</th>
                <th>Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody>
              {MY_WORK_BUCKETS.map((bucket) => {
                const rows = items.filter((entry) => entry.bucket === bucket);
                if (rows.length === 0) return null;
                return (
                  <Fragment key={bucket}>
                    <tr className={styles.groupRow}>
                      <th colSpan={6} scope="colgroup">
                        <span
                          className={styles.groupDot}
                          style={{ background: MY_WORK_BUCKET_TONE[bucket] }}
                          aria-hidden
                        />
                        {MY_WORK_BUCKET_LABELS[bucket]}
                        <span className={styles.countPill}>{rows.length}</span>
                      </th>
                    </tr>
                    {rows.map((entry) => {
                      const status = WORK_ITEM_STATUS_TONE[entry.item.status];
                      const priority = PRIORITY_TONE[entry.item.priority];
                      return (
                        <tr key={entry.item.id}>
                          <td>
                            <span className={styles.cellTitle}>
                              <span className={styles.treeCode}>{entry.item.code}</span>
                              {entry.item.title}
                            </span>
                          </td>
                          <td className={styles.cellSub} title={entry.projectName}>
                            {entry.projectCode}
                          </td>
                          <td>
                            <span
                              className={styles.pill}
                              style={{
                                background: priority.bg,
                                color: priority.fg,
                              }}
                            >
                              {PRIORITY_LABELS[entry.item.priority]}
                            </span>
                          </td>
                          <td>
                            <span
                              className={styles.pill}
                              style={{
                                background: status.bg,
                                color: status.fg,
                              }}
                            >
                              {WORK_ITEM_STATUS_LABELS[entry.item.status]}
                            </span>
                          </td>
                          <td className={bucket === 'overdue' ? styles.cellDanger : undefined}>
                            {formatDate(entry.item.plannedEnd) || '—'}
                          </td>
                          <td>
                            {entry.item.status === 'todo' ? (
                              <button
                                type="button"
                                className={styles.buttonSmall}
                                onClick={() => void advance(entry.item.id, 'in_progress')}
                              >
                                Bắt đầu làm
                              </button>
                            ) : entry.item.status === 'in_progress' ||
                              entry.item.status === 'review' ? (
                              <button
                                type="button"
                                className={styles.buttonSmall}
                                onClick={() => void advance(entry.item.id, 'done')}
                              >
                                Hoàn thành
                              </button>
                            ) : (
                              <span className={styles.muted}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {summary && items.length === 0 ? (
          <p className={styles.emptyRow}>Bạn không có việc nào đang mở.</p>
        ) : null}
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <h3>
            <AtSign size={14} /> Có người nhắc bạn
          </h3>
          {summary?.mentions.length ? (
            <ul className={`${styles.memberList} ${styles.stackedList}`}>
              {summary.mentions.map((mention) => (
                <li key={mention.messageId}>
                  <span className={styles.memberName}>{mention.excerpt}</span>
                  <span className={styles.memberRole}>
                    {directory.nameOf(mention.createdBy)} · {formatDateTime(mention.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Chưa ai nhắc tên bạn.</p>
          )}
        </section>

        <section className={styles.panel}>
          <h3>
            <ExternalLink size={14} /> Từ module khác
          </h3>
          {summary?.externalCards.length ? (
            <ul className={`${styles.memberList} ${styles.stackedList}`}>
              {summary.externalCards.map((card) => (
                <li key={card.id}>
                  <span className={styles.memberName}>
                    {/* Nhãn là bản sao để hiển thị nhanh, có thể cũ. Nguồn sự
                        thật luôn là module gốc. */}
                    <a href={card.launchUrl} target="_blank" rel="noopener noreferrer">
                      {card.externalCode ?? card.cachedLabel ?? card.moduleKey}
                    </a>{' '}
                    — {card.workItemTitle}
                  </span>
                  <span className={styles.memberRole}>{card.cachedStatus ?? '—'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Không có hồ sơ nào từ module khác.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Lời mời chờ phản hồi: giờ, tên buổi và ba nút trả lời ngay tại chỗ. */
function InvitationChip({
  event,
  busy,
  onRespond,
}: {
  event: MyWorkEvent;
  busy: boolean;
  onRespond: (response: ParticipantResponse) => void;
}) {
  return (
    <span className={styles.dayChip}>
      <b>{formatDateTime(event.startAt)}</b> {event.title}
      {/* Trả lời xong thì lời mời rời dải này ở lần tải lại. */}
      <span className={styles.responseGroup} role="group" aria-label="Phản hồi lời mời">
        {INVITATION_RESPONSES.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={busy}
            onClick={() => onRespond(option.value)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </span>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
