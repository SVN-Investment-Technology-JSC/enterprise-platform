'use client';

import {
  MY_WORK_BUCKETS,
  type MyWorkBucket,
  type MyWorkItem,
  type MyWorkSummary,
  type ParticipantResponse,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import {
  AtSign,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Inbox,
  MailQuestion,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../workspace-api';
import {
  MY_WORK_BUCKET_LABELS,
  MY_WORK_BUCKET_TONE,
  PRIORITY_LABELS,
  WORK_ITEM_STATUS_LABELS,
  formatDate,
  formatDateTime,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

const INVITATION_RESPONSES: readonly { value: ParticipantResponse; label: string }[] = [
  { value: 'accepted', label: 'Tham gia' },
  { value: 'tentative', label: 'Có thể' },
  { value: 'declined', label: 'Từ chối' },
];

/**
 * Trang "Công việc của tôi".
 *
 * Chỉ hiển thị dữ liệu của chính người đang đăng nhập — kể cả quản trị viên
 * tenant. Có một dải giải thích ngay đầu trang để người quản trị không tưởng
 * màn hình bị lọc sai.
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

  return (
    <div className={styles.tabBody}>
      {isTenantAdmin ? (
        <p className={styles.notice}>
          Bạn là quản trị viên tenant, nhưng màn hình này <strong>luôn chỉ hiện việc của
          chính bạn</strong>. Muốn xem toàn bộ dự án, hãy dùng trang Dự án hoặc Báo cáo.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <div className={styles.statRow}>
        <Kpi label="Việc đang mở" value={summary?.counters.openItems} icon={<Inbox size={15} />} />
        <Kpi
          label="Quá hạn"
          value={summary?.counters.overdueItems}
          icon={<CalendarClock size={15} />}
          danger
        />
        <Kpi
          label="Đến hạn hôm nay"
          value={summary?.counters.dueToday}
          icon={<CalendarClock size={15} />}
        />
        <Kpi
          label="Hoàn thành tuần này"
          value={summary?.counters.completedThisWeek}
          icon={<CheckCircle2 size={15} />}
        />
      </div>

      <div className={styles.filterBar}>
        <span className={styles.muted}>
          Mốc thời gian tính theo múi giờ {summary?.timezone ?? '…'} · hôm nay{' '}
          {formatDate(summary?.today) || '…'}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
      </div>

      {MY_WORK_BUCKETS.map((bucket) => {
        const rows = (summary?.items ?? []).filter((entry) => entry.bucket === bucket);
        if (rows.length === 0) return null;
        return (
          <BucketGroup key={bucket} bucket={bucket} rows={rows} onAdvance={advance} />
        );
      })}

      {summary && summary.items.length === 0 ? (
        <p className={styles.muted}>Bạn không có việc nào đang mở. </p>
      ) : null}

      <div className={styles.myWorkColumns}>
        <section className={styles.panel}>
          <h3>
            <CalendarClock size={14} /> Lịch hôm nay
          </h3>
          {summary?.todayEvents.length ? (
            <ul className={`${styles.memberList} ${styles.stackedList}`}>
              {summary.todayEvents.map((event) => (
                <li key={event.eventId}>
                  <span className={styles.memberName}>
                    {event.allDay ? 'Cả ngày' : formatTime(event.startAt)} · {event.title}
                  </span>
                  <span className={styles.memberRole}>{event.location ?? ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Hôm nay bạn không có lịch nào.</p>
          )}
        </section>

        <section className={styles.panel}>
          <h3>
            <MailQuestion size={14} /> Lời mời chờ phản hồi
          </h3>
          {summary?.pendingInvitations.length ? (
            <ul className={`${styles.memberList} ${styles.stackedList}`}>
              {summary.pendingInvitations.map((event) => (
                <li key={event.eventId}>
                  <span className={styles.memberName}>
                    {formatDateTime(event.startAt)} · {event.title}
                  </span>
                  {/* Trả lời xong thì lời mời rời khối này ở lần tải lại. */}
                  <span className={styles.responseGroup} role="group" aria-label="Phản hồi lời mời">
                    {INVITATION_RESPONSES.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={responding === event.eventId}
                        onClick={() => void respond(event.eventId, option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Không có lời mời nào đang chờ.</p>
          )}
        </section>

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
                      {card.externalCode ?? card.cachedLabel ?? card.moduleKey} ↗
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

function BucketGroup({
  bucket,
  rows,
  onAdvance,
}: {
  bucket: MyWorkBucket;
  rows: readonly MyWorkItem[];
  onAdvance: (itemId: string, next: WorkItemStatus) => void;
}) {
  return (
    <section
      className={styles.myWorkGroup}
      style={{ borderLeftColor: MY_WORK_BUCKET_TONE[bucket] }}
    >
      <h3>
        {MY_WORK_BUCKET_LABELS[bucket]}
        <span className={styles.kanbanCount}>{rows.length}</span>
      </h3>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Công việc</th>
            <th>Dự án</th>
            <th>Ưu tiên</th>
            <th>Hạn</th>
            <th>Trạng thái</th>
            <th>Thao tác nhanh</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.item.id}>
              <td>
                <span className={styles.treeCode}>{entry.item.code}</span> {entry.item.title}
              </td>
              <td className={styles.muted}>{entry.projectCode}</td>
              <td>{PRIORITY_LABELS[entry.item.priority]}</td>
              <td className={bucket === 'overdue' ? styles.cellDanger : undefined}>
                {formatDate(entry.item.plannedEnd) || '—'}
              </td>
              <td>{WORK_ITEM_STATUS_LABELS[entry.item.status]}</td>
              <td>
                {entry.item.status === 'todo' ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onAdvance(entry.item.id, 'in_progress')}
                  >
                    Bắt đầu làm
                  </button>
                ) : entry.item.status === 'in_progress' || entry.item.status === 'review' ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onAdvance(entry.item.id, 'done')}
                  >
                    Hoàn thành
                  </button>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Kpi({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={danger && value ? styles.statDanger : styles.stat}>
      <span className={styles.statValue}>{value ?? '—'}</span>
      <span className={styles.statLabel}>
        {icon} {label}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
