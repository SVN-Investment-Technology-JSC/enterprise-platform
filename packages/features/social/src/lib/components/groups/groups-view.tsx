'use client';

import { SOCIAL_GROUP_PAGE_SIZE, type SocialGroupSummary } from '@enterprise-platform/contracts-social';
import { Check, Clock, Link2, LogOut, Pin, Plus, Search, Star, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@enterprise-platform/shared-ui';
import { errorMessage } from '../../social-api';
import { useSocialSession } from '../../social-context';
import { navigateSocial, SocialLink } from '../../social-navigation';
import { socialHref } from '../../social.model';
import base from '../../social.module.scss';
import { Dialog } from '../ui';
import { GroupFormDialog } from './group-form-dialog';
import { GroupGlyph, GroupMenu, PrivacyBadge, type GroupMenuItem } from './group-visuals';
import { appendUnique, groupCover, joinState, memberCountLabel } from './groups.model';
import s from './groups.module.scss';
import { joinGroup, leaveGroup, listGroups, setGroupPriority } from './social-groups-api';

type Tab = 'mine' | 'all';

const TABS: ReadonlyArray<{ readonly key: Tab; readonly label: string }> = [
  { key: 'mine', label: 'Nhóm của bạn' },
  { key: 'all', label: 'Tất cả nhóm' },
];

const groupRoute = (group: SocialGroupSummary) => ({ name: 'group' as const, groupId: group.id });

/** Thẻ nhóm ở tab "Tất cả nhóm": ảnh bìa, ảnh đại diện đè lên bìa, tên, quyền riêng tư, nút tham gia. */
function GroupCard({
  group,
  busy,
  onJoin,
}: {
  readonly group: SocialGroupSummary;
  readonly busy: boolean;
  readonly onJoin: (group: SocialGroupSummary) => void;
}) {
  const state = joinState(group);
  return (
    <li className={s.card}>
      <div className={s.cardCover} style={{ background: groupCover(group) }} />
      <span className={s.cardGlyph}>
        <GroupGlyph icon={group.icon} color={group.color} size={44} />
      </span>
      <div className={s.cardBody}>
        <SocialLink to={groupRoute(group)} className={s.cardName} title={group.name}>
          {group.name}
        </SocialLink>
        <span className={s.cardMeta}>
          {group.privacy === 'private' ? 'Riêng tư' : 'Công khai'} &bull; {memberCountLabel(group.memberCount)}
        </span>
      </div>
      {state === 'member' ? (
        <button type="button" className={s.cardBtn} data-state="joined" onClick={() => navigateSocial(groupRoute(group))}>
          <Check size={13} aria-hidden="true" />
          Đã tham gia
        </button>
      ) : state === 'pending' ? (
        <button type="button" className={s.cardBtn} data-state="joined" onClick={() => navigateSocial(groupRoute(group))}>
          <Clock size={13} aria-hidden="true" />
          Chờ duyệt
        </button>
      ) : (
        <button type="button" className={s.cardBtn} data-state="join" disabled={busy} onClick={() => onJoin(group)}>
          {busy ? 'Đang gửi…' : state === 'join' ? 'Tham gia' : 'Gửi yêu cầu'}
        </button>
      )}
    </li>
  );
}

/** Dòng nhóm ở tab "Nhóm của bạn". */
function GroupRow({
  group,
  onPriority,
  onCopy,
  onLeave,
}: {
  readonly group: SocialGroupSummary;
  readonly onPriority: (group: SocialGroupSummary) => void;
  readonly onCopy: (group: SocialGroupSummary) => void;
  readonly onLeave: (group: SocialGroupSummary) => void;
}) {
  const items: readonly GroupMenuItem[] = [
    {
      key: 'priority',
      label: group.myPriorityAt ? 'Bỏ ưu tiên' : 'Ưu tiên lên trên',
      icon: Star,
      onSelect: () => onPriority(group),
    },
    { key: 'copy', label: 'Copy link nhóm', icon: Link2, onSelect: () => onCopy(group) },
    { key: 'leave', label: 'Rời khỏi nhóm', icon: LogOut, onSelect: () => onLeave(group) },
  ];
  return (
    <li className={s.groupRow}>
      <GroupGlyph icon={group.icon} color={group.color} size={40} />
      <div className={s.groupRowText}>
        <SocialLink to={groupRoute(group)} className={s.groupRowName}>
          {group.name}
          {group.myPriorityAt ? <Pin size={12} className={s.pinMark} aria-label="Đang ưu tiên" /> : null}
        </SocialLink>
        <span className={s.rowMeta}>{memberCountLabel(group.memberCount)}</span>
        <PrivacyBadge privacy={group.privacy} />
      </div>
      <GroupMenu items={items} label={`Tuỳ chọn nhóm ${group.name}`} />
    </li>
  );
}

export function GroupsView() {
  const session = useSocialSession();
  const [tab, setTab] = useState<Tab>('mine');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<readonly SocialGroupSummary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [joiningId, setJoiningId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState<SocialGroupSummary>();
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string>();
  const generation = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);

  const scopeQuery = tab === 'mine' ? undefined : query || undefined;

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await listGroups({
        scope: tab,
        query: scopeQuery,
        limit: SOCIAL_GROUP_PAGE_SIZE,
      });
      if (mine !== generation.current) return;
      setGroups(page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine === generation.current) setError(errorMessage(cause, 'Không tải được danh sách nhóm.'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [tab, scopeQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await listGroups({ scope: tab, query: scopeQuery, cursor, limit: SOCIAL_GROUP_PAGE_SIZE });
      if (mine !== generation.current) return;
      setGroups((current) => appendUnique(current, page.items));
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải thêm được nhóm.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const join = async (group: SocialGroupSummary) => {
    setJoiningId(group.id);
    setError(undefined);
    try {
      const response = await joinGroup(group.id);
      toast.success(
        response.result === 'joined'
          ? `Bạn đã tham gia nhóm "${group.name}".`
          : `Đã gửi yêu cầu tham gia nhóm "${group.name}". Quản trị viên sẽ xem và duyệt.`,
      );
      setGroups((current) => current.map((item) => (item.id === group.id ? { ...item, ...response.group } : item)));
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không tham gia được nhóm.'));
    } finally {
      setJoiningId(undefined);
    }
  };

  const priority = async (group: SocialGroupSummary) => {
    setError(undefined);
    try {
      const state = await setGroupPriority(group.id, !group.myPriorityAt);
      toast.success(state.pinned ? `Đã đưa "${group.name}" lên trên.` : `Đã bỏ ưu tiên "${group.name}".`);
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không đổi được ưu tiên của nhóm.'));
    }
  };

  const copy = async (group: SocialGroupSummary) => {
    setError(undefined);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${socialHref(groupRoute(group))}`);
      toast.success('Đã sao chép liên kết nhóm.');
    } catch {
      toast.error('Không sao chép được liên kết.');
    }
  };

  const leave = async () => {
    if (!leaving) return;
    setLeaveBusy(true);
    setLeaveError(undefined);
    try {
      await leaveGroup(leaving.id);
      setGroups((current) => current.filter((item) => item.id !== leaving.id));
      setLeaving(undefined);
      toast.success(`Bạn đã rời nhóm "${leaving.name}".`);
    } catch (cause) {
      setLeaveError(errorMessage(cause, 'Không rời được nhóm.'));
    } finally {
      setLeaveBusy(false);
    }
  };

  return (
    <section className={s.page} aria-label="Nhóm">
      <div className={s.toolbar}>
        <div className={s.tabs} role="tablist" aria-label="Danh mục nhóm">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={s.tab}
              data-active={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className={base.buttonPrimary + ' ' + s.compactBtn} onClick={() => setCreating(true)}>
          <Plus size={14} />
          Tạo nhóm
        </button>
      </div>

      {tab === 'all' ? (
        <label className={s.filter}>
          <Search size={14} />
          <input
            value={text}
            placeholder="Tìm kiếm"
            aria-label="Tìm kiếm nhóm"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className={base.alert}>
          <span>{error}</span>
          <button type="button" className={base.buttonSmall} onClick={() => void load()}>
            Thử lại
          </button>
        </p>
      ) : null}

      {loading ? (
        tab === 'all' ? (
          <ul className={s.grid} aria-busy="true" aria-label="Đang tải nhóm">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
              <li key={key} className={s.cardSkeleton} />
            ))}
          </ul>
        ) : (
          <ul className={s.groupList} aria-busy="true" aria-label="Đang tải nhóm">
            {[0, 1, 2, 3].map((key) => (
              <li key={key} className={s.rowSkeleton} />
            ))}
          </ul>
        )
      ) : groups.length === 0 && !error ? (
        <div className={s.empty}>
          <Users size={26} />
          <strong>
            {query && tab === 'all'
              ? 'Không có nhóm phù hợp.'
              : tab === 'mine'
                ? 'Bạn chưa tham gia nhóm nào.'
                : 'Chưa có nhóm nào.'}
          </strong>
          {tab === 'mine' ? (
            <div className={s.emptyActions}>
              <button type="button" className={base.buttonGhost} onClick={() => setTab('all')}>
                Xem tất cả nhóm
              </button>
              <button type="button" className={base.buttonPrimary} onClick={() => setCreating(true)}>
                Tạo nhóm
              </button>
            </div>
          ) : null}
        </div>
      ) : tab === 'all' ? (
        <ul className={s.grid}>
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} busy={joiningId === group.id} onJoin={(item) => void join(item)} />
          ))}
        </ul>
      ) : (
        <ul className={s.groupList}>
          {groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              onPriority={(item) => void priority(item)}
              onCopy={(item) => void copy(item)}
              onLeave={(item) => {
                setLeaveError(undefined);
                setLeaving(item);
              }}
            />
          ))}
        </ul>
      )}

      {cursor && !loading ? (
        <div className={s.more}>
          <button type="button" className={base.buttonGhost} disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Đang tải…' : 'Xem thêm nhóm'}
          </button>
        </div>
      ) : null}

      <GroupFormDialog
        open={creating}
        creatorName={session?.me.user.name}
        onClose={() => setCreating(false)}
        onSaved={(group) => {
          setCreating(false);
          navigateSocial({ name: 'group', groupId: group.id });
        }}
      />

      <Dialog
        open={Boolean(leaving)}
        title="Rời nhóm"
        danger
        submitLabel="Rời nhóm"
        submittingLabel="Đang xử lý…"
        submitting={leaveBusy}
        error={leaveError}
        onSubmit={() => void leave()}
        onClose={() => setLeaving(undefined)}
      >
        <p className={base.confirmText}>
          {leaving?.privacy === 'private'
            ? `Rời nhóm "${leaving.name}"? Nhóm riêng tư nên bạn sẽ phải gửi yêu cầu và chờ duyệt để quay lại.`
            : `Rời nhóm "${leaving?.name ?? ''}"? Bạn có thể tham gia lại bất cứ lúc nào.`}
        </p>
      </Dialog>
    </section>
  );
}
