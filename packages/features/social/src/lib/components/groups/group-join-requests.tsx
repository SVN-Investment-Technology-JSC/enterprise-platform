'use client';

import type { SocialJoinRequest } from '@enterprise-platform/contracts-social';
import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../social-api';
import { formatRelativeTime } from '../../social.model';
import { Button } from '../../ui/button';
import { userSubtitle } from '../ui';
import { UserAvatar } from '../user-avatar';
import { ALERT, EMPTY_LINE, PANEL, REASON, ROW, ROW_LIST, ROW_META, ROW_TEXT, ROW_TITLE, SKELETON } from './group-ui';
import { appendUnique } from './groups.model';
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
    <section className={PANEL} aria-label="Yêu cầu tham gia">
      {error ? (
        <p role="alert" className={ALERT}>
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Thử lại
          </Button>
        </p>
      ) : null}
      {loading ? (
        <ul className={`${ROW_LIST} gap-1.5`} aria-busy="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className={`${SKELETON} h-14`} />
          ))}
        </ul>
      ) : items.length === 0 && !error ? (
        <p className={EMPTY_LINE}>Không có yêu cầu nào đang chờ duyệt.</p>
      ) : (
        <ul className={ROW_LIST}>
          {items.map((item) => (
            <li key={item.id} className={`${ROW} items-start`}>
              <UserAvatar user={item.user} size={32} />
              <div className={ROW_TEXT}>
                <span className={ROW_TITLE}>{item.user.name}</span>
                <span className={ROW_META}>
                  {[userSubtitle(item.user), formatRelativeTime(item.createdAt)].filter(Boolean).join(' · ')}
                </span>
                {item.message ? <p className={REASON}>{item.message}</p> : null}
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 px-3.5 text-[13px] font-semibold"
                  disabled={busyId === item.id}
                  onClick={() => void decide(item, true)}
                >
                  <Check size={14} aria-hidden="true" />
                  Duyệt
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 px-3.5 text-[13px]"
                  disabled={busyId === item.id}
                  onClick={() => void decide(item, false)}
                >
                  <X size={14} aria-hidden="true" />
                  Từ chối
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div className="flex justify-center py-1">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Đang tải…' : 'Xem thêm'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
