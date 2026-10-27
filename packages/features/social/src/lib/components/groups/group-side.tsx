'use client';

import type { SocialGroupDetail, SocialGroupMember, SocialGroupSummary } from '@enterprise-platform/contracts-social';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import { useSocialSession } from '../../social-context';
import { SocialLink } from '../../social-navigation';
import { Button } from '../../ui/button';
import { userSubtitle } from '../ui';
import { UserAvatar } from '../user-avatar';
import { EMPTY_LINE, PANEL, ROLE_ADMIN, ROW_LIST, ROW_META, ROW_TITLE, SIDE_TITLE, SKELETON } from './group-ui';
import { AvatarStack, GroupGlyph } from './group-visuals';
import { memberCountLabel } from './groups.model';
import { joinGroup, listGroupMembers, loadGroupSuggestions } from './social-groups-api';

/** Quản trị viên của nhóm (tối đa 10 người đầu); nạp lại khi `refreshKey` đổi. */
export function useGroupAdmins(groupId: string, enabled: boolean, refreshKey: number): readonly SocialGroupMember[] {
  const [admins, setAdmins] = useState<readonly SocialGroupMember[]>([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    listGroupMembers(groupId, { role: 'admin', limit: 10 })
      .then((page) => {
        if (!cancelled) setAdmins(page.items);
      })
      .catch(() => {
        if (!cancelled) setAdmins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, enabled, refreshKey]);
  return admins;
}

/** "Các nhóm khác": gợi ý nhóm công khai tôi chưa tham gia. */
function OtherGroups({ currentId }: { readonly currentId: string }) {
  const session = useSocialSession();
  const [items, setItems] = useState<readonly SocialGroupSummary[]>();
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setItems(undefined);
    setError(undefined);
    loadGroupSuggestions(6)
      .then((result) => {
        if (!cancelled) setItems(result.items.filter((group) => group.id !== currentId).slice(0, 5));
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, 'Không tải được gợi ý nhóm.'));
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const join = async (group: SocialGroupSummary) => {
    setBusyId(group.id);
    try {
      await joinGroup(group.id);
      setItems((current) => current?.filter((item) => item.id !== group.id));
      session?.notify(`Bạn đã tham gia nhóm "${group.name}".`);
    } catch (cause) {
      session?.notify(errorMessage(cause, 'Không tham gia được nhóm.'), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className={PANEL} aria-label="Các nhóm khác">
      <h3 className={SIDE_TITLE}>Các nhóm khác</h3>
      {error ? (
        <p className={EMPTY_LINE}>{error}</p>
      ) : !items ? (
        <ul className={`${ROW_LIST} gap-1.5`} aria-busy="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className={`${SKELETON} h-10`} />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className={EMPTY_LINE}>Không còn nhóm nào để tham gia.</p>
      ) : (
        <ul className={`${ROW_LIST} gap-2`}>
          {items.map((group) => (
            <li key={group.id} className="flex min-w-0 items-center gap-2">
              <GroupGlyph icon={group.icon} color={group.color} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <SocialLink
                  to={{ name: 'group', groupId: group.id }}
                  className="truncate text-[13px] font-semibold text-slate-900 no-underline hover:underline"
                >
                  {group.name}
                </SocialLink>
                <span className={ROW_META}>{memberCountLabel(group.memberCount)}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyId === group.id}
                onClick={() => void join(group)}
              >
                Tham gia
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Cột phải của trang nhóm: thành viên, quản trị viên, các nhóm khác. */
export function GroupSide({
  group,
  admins,
  onAddMembers,
}: {
  readonly group: SocialGroupDetail;
  readonly admins: readonly SocialGroupMember[];
  readonly onAddMembers: () => void;
}) {
  const rest = group.memberCount - group.memberPreview.length;
  return (
    <aside className="flex min-w-0 flex-col gap-2.5">
      <section className={PANEL} aria-label="Thành viên">
        <h3 className={SIDE_TITLE}>
          <SocialLink
            to={{ name: 'group', groupId: group.id, section: 'members' }}
            className="text-inherit no-underline hover:underline"
          >
            Thành viên ({group.memberCount})
          </SocialLink>
        </h3>
        <div className="flex items-center gap-1.5">
          <AvatarStack users={group.memberPreview} size={30} />
          {rest > 0 ? (
            <SocialLink
              to={{ name: 'group', groupId: group.id, section: 'members' }}
              className="inline-flex h-[30px] min-w-[30px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-1.5 text-[11.5px] font-bold text-slate-600 no-underline hover:border-amber-400"
              aria-label={`Xem thêm ${rest} thành viên`}
            >
              +{rest}
            </SocialLink>
          ) : null}
        </div>
        {group.capabilities.canManage ? (
          <Button type="button" variant="outline" size="sm" className="h-7 rounded-full" onClick={onAddMembers}>
            <Plus size={13} aria-hidden="true" />
            Thêm thành viên
          </Button>
        ) : null}
      </section>

      <section className={PANEL} aria-label="Quản trị viên">
        <h3 className={SIDE_TITLE}>Quản trị viên ({group.adminCount})</h3>
        <ul className={`${ROW_LIST} gap-2`}>
          {admins.map((member) => (
            <li key={member.user.id} className="flex min-w-0 items-center gap-2">
              <UserAvatar user={member.user} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={ROW_TITLE}>
                  {member.user.name} <span className={ROLE_ADMIN}>Admin</span>
                </span>
                {userSubtitle(member.user) ? <span className={ROW_META}>{userSubtitle(member.user)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <OtherGroups currentId={group.id} />
    </aside>
  );
}
