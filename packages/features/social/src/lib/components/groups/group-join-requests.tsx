'use client';

import type { SocialJoinRequest } from '@enterprise-platform/contracts-social';
import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../social-api';
import { formatRelativeTime } from '../../social.model';
import base from '../../social.module.scss';
import { Avatar, userSubtitle } from '../ui';
import { appendUnique } from './groups.model';
import s from './groups.module.scss';
import { approveJoinRequest, listJoinRequests, rejectJoinRequest } from './social-groups-api';

/** Tab "Yêu cầu tham gia" (chỉ admin nhóm / quản trị toàn hệ thống). */
export function GroupJoinRequests({
  groupId,
  onDecided,
}: {
  readonly groupId: string;
  /** Sau khi duyệt hoặc từ chối: cha nạp lại chi tiết nhóm (số chờ duyệt, số thành viên). */
  readonly onDecided: (approved: boolean) => void;
}) {
  const [items, setItems] = useState<readonly SocialJoinRequest[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await listJoinRequests(groupId);
      if (mine !== generation.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine === generation.current) setError(errorMessage(cause, 'Không tải được yêu cầu tham gia.'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listJoinRequests(groupId, cursor);
      setItems((current) => appendUnique(current, page.items));
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải thêm được yêu cầu.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const decide = async (item: SocialJoinRequest, approve: boolean) => {
    setBusyId(item.id);
    setError(undefined);
    try {
      if (approve) await approveJoinRequest(groupId, item.id);
      else await rejectJoinRequest(groupId, item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
      onDecided(approve);
    } catch (cause) {
      setError(errorMessage(cause, approve ? 'Không duyệt được yêu cầu.' : 'Không từ chối được yêu cầu.'));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className={s.panel} aria-label="Yêu cầu tham gia">
      {error ? (
        <p role="alert" className={base.alert}>
          <span>{error}</span>
          <button type="button" className={base.buttonSmall} onClick={() => void load()}>
            Thử lại
          </button>
        </p>
      ) : null}
      {loading ? (
        <ul className={s.rowList} aria-busy="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className={s.rowSkeleton} />
          ))}
        </ul>
      ) : items.length === 0 && !error ? (
        <p className={s.emptyLine}>Không có yêu cầu nào đang chờ duyệt.</p>
      ) : (
        <ul className={s.rowList}>
          {items.map((item) => (
            <li key={item.id} className={s.reportRow}>
              <Avatar user={item.user} size={32} />
              <div className={s.reportText}>
                <span className={s.rowTitle}>{item.user.name}</span>
                <span className={s.rowMeta}>
                  {[userSubtitle(item.user), formatRelativeTime(item.createdAt)].filter(Boolean).join(' · ')}
                </span>
                {item.message ? <p className={s.reportReason}>{item.message}</p> : null}
              </div>
              <div className={s.rowActions}>
                <button
                  type="button"
                  className={base.buttonSmall + ' ' + base.buttonSmallPrimary}
                  disabled={busyId === item.id}
                  onClick={() => void decide(item, true)}
                >
                  <Check size={14} />
                  Duyệt
                </button>
                <button
                  type="button"
                  className={base.buttonSmall}
                  disabled={busyId === item.id}
                  onClick={() => void decide(item, false)}
                >
                  <X size={14} />
                  Từ chối
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div className={s.more}>
          <button type="button" className={base.buttonGhost} disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Đang tải…' : 'Xem thêm'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
