'use client';

import { SOCIAL_GROUP_PAGE_SIZE, type SocialGroupSummary } from '@enterprise-platform/contracts-social';
import { Check, Clock, Link2, LogOut, Pin, Plus, Search, Star, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@enterprise-platform/shared-ui';
import { errorMessage } from '../../social-api';
import { useSocialSession } from '../../social-context';
import { navigateSocial, SocialLink } from '../../social-navigation';
import { socialHref } from '../../social.model';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';
import { Dialog } from '../ui';
import { GroupFormDialog } from './group-form-dialog';
import { GroupGlyph, GroupMenu, PrivacyBadge, type GroupMenuItem } from './group-visuals';
import { appendUnique, groupCover, joinState, memberCountLabel } from './groups.model';
import { joinGroup, leaveGroup, listGroups, setGroupPriority } from './social-groups-api';

type Tab = 'mine' | 'all';

const GRID =
  'm-0 grid list-none grid-cols-1 gap-2.5 p-0 min-[520px]:grid-cols-2 min-[860px]:grid-cols-3 min-[1180px]:grid-cols-4';
const SURFACE = 'rounded-[var(--ep-radius-xl)] border border-slate-200 bg-white shadow-xs';

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
    <li className="relative flex flex-col items-center gap-1.5 overflow-hidden rounded-[var(--ep-radius-xl)] border border-slate-200 bg-white pb-2.5 text-center shadow-xs">
      <div className="h-16 self-stretch" style={{ background: groupCover(group) }} />
      <span className="-mt-[26px] inline-flex rounded-full border-[3px] border-white bg-white">
        <GroupGlyph icon={group.icon} color={group.color} size={44} />
      </span>
      <div className="flex max-w-full flex-col items-center gap-px px-2.5">
        <SocialLink
          to={groupRoute(group)}
          className="max-w-full truncate text-[13.5px] font-bold text-slate-900 no-underline hover:underline"
          title={group.name}
        >
          {group.name}
        </SocialLink>
        <span className="text-xs text-slate-500">
          {group.privacy === 'private' ? 'Riêng tư' : 'Công khai'} &bull; {memberCountLabel(group.memberCount)}
        </span>
      </div>
      {state === 'member' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-24 rounded-full text-slate-600"
          onClick={() => navigateSocial(groupRoute(group))}
        >
          <Check size={13} aria-hidden="true" />
          Đã tham gia
        </Button>
      ) : state === 'pending' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-24 rounded-full text-slate-600"
          onClick={() => navigateSocial(groupRoute(group))}
        >
          <Clock size={13} aria-hidden="true" />
          Chờ duyệt
        </Button>
      ) : (
        <Button type="button" size="sm" className="min-w-24 rounded-full font-semibold" disabled={busy} onClick={() => onJoin(group)}>
          {busy ? 'Đang gửi…' : state === 'join' ? 'Tham gia' : 'Gửi yêu cầu'}
        </Button>
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
    <li className="flex items-center gap-2.5 px-3 py-2 not-first:border-t not-first:border-slate-100 hover:bg-slate-50">
      <GroupGlyph icon={group.icon} color={group.color} size={40} />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <SocialLink
          to={groupRoute(group)}
          className="inline-flex items-center gap-1.5 truncate text-[13.5px] font-bold text-slate-900 no-underline hover:underline"
        >
          {group.name}
          {group.myPriorityAt ? <Pin size={12} className="flex-none text-amber-600" aria-label="Đang ưu tiên" /> : null}
        </SocialLink>
        <span className="text-xs leading-snug text-slate-500">{memberCountLabel(group.memberCount)}</span>
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
    <section className="flex min-w-0 flex-col gap-2.5" aria-label="Nhóm">
      <div className="flex items-center justify-between gap-2.5">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList aria-label="Danh mục nhóm">
            {TABS.map((item) => (
              <TabsTrigger key={item.key} value={item.key}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button type="button" className="h-[34px] gap-1.5 rounded-md px-3 text-[13px] font-semibold" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" />
          Tạo nhóm
        </Button>
      </div>

      {tab === 'all' ? (
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            className="h-[38px] rounded-md pl-9 text-[13.5px]!"
            value={text}
            placeholder="Tìm kiếm"
            aria-label="Tìm kiếm nhóm"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="m-0 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
        >
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Thử lại
          </Button>
        </p>
      ) : null}

      {loading ? (
        tab === 'all' ? (
          <ul className={GRID} aria-busy="true" aria-label="Đang tải nhóm">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
              <li key={key} className="h-[150px] animate-pulse rounded-lg bg-slate-100" />
            ))}
          </ul>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-busy="true" aria-label="Đang tải nhóm">
            {[0, 1, 2, 3].map((key) => (
              <li key={key} className="h-14 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </ul>
        )
      ) : groups.length === 0 && !error ? (
        <div className={`flex flex-col items-center gap-1.5 px-4 py-7 text-center text-[13px] text-slate-500 ${SURFACE}`}>
          <Users size={26} aria-hidden="true" />
          <strong className="text-sm text-slate-900">
            {query && tab === 'all'
              ? 'Không có nhóm phù hợp.'
              : tab === 'mine'
                ? 'Bạn chưa tham gia nhóm nào.'
                : 'Chưa có nhóm nào.'}
          </strong>
          {tab === 'mine' ? (
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => setTab('all')}>
                Xem tất cả nhóm
              </Button>
              <Button type="button" onClick={() => setCreating(true)}>
                Tạo nhóm
              </Button>
            </div>
          ) : null}
        </div>
      ) : tab === 'all' ? (
        <ul className={GRID}>
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} busy={joiningId === group.id} onJoin={(item) => void join(item)} />
          ))}
        </ul>
      ) : (
        <ul className={`m-0 flex list-none flex-col p-0 ${SURFACE}`}>
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
        <div className="flex justify-center py-1">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Đang tải…' : 'Xem thêm nhóm'}
          </Button>
        </div>
      ) : null}

      <GroupFormDialog
        open={creating}
        creatorId={session?.me.user.id}
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
        <p className="m-0 text-[13.5px] leading-relaxed text-slate-700">
          {leaving?.privacy === 'private'
            ? `Rời nhóm "${leaving.name}"? Nhóm riêng tư nên bạn sẽ phải gửi yêu cầu và chờ duyệt để quay lại.`
            : `Rời nhóm "${leaving?.name ?? ''}"? Bạn có thể tham gia lại bất cứ lúc nào.`}
        </p>
      </Dialog>
    </section>
  );
}
