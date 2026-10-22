'use client';

import type { SocialGroupDetail, SocialGroupMember, SocialGroupSummary } from '@enterprise-platform/contracts-social';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../social-api';
import { useSocialSession } from '../../social-context';
import { SocialLink } from '../../social-navigation';
import base from '../../social.module.scss';
import { Avatar, userSubtitle } from '../ui';
import { AvatarStack, GroupGlyph } from './group-visuals';
import { memberCountLabel } from './groups.model';
import s from './groups.module.scss';
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
      session?.notify(errorMessage(cause, 'Không tham gia được nhóm.'));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className={s.sideCard} aria-label="Các nhóm khác">
      <h3 className={s.sideTitle}>Các nhóm khác</h3>
      {error ? (
        <p className={s.emptyLine}>{error}</p>
      ) : !items ? (
        <ul className={s.rowList} aria-busy="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className={s.rowSkeleton} />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className={s.emptyLine}>Không còn nhóm nào để tham gia.</p>
      ) : (
        <ul className={s.sideList}>
          {items.map((group) => (
            <li key={group.id} className={s.sideRow}>
              <GroupGlyph icon={group.icon} color={group.color} size={32} />
              <span className={s.rowText}>
                <SocialLink to={{ name: 'group', groupId: group.id }} className={s.rowTitleLink}>
                  {group.name}
                </SocialLink>
                <span className={s.rowMeta}>{memberCountLabel(group.memberCount)}</span>
              </span>
              <button
                type="button"
                className={base.buttonSmall}
                disabled={busyId === group.id}
                onClick={() => void join(group)}
              >
                Tham gia
              </button>
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
    <aside className={s.side}>
      <section className={s.sideCard} aria-label="Thành viên">
        <h3 className={s.sideTitle}>
          <SocialLink to={{ name: 'group', groupId: group.id, section: 'members' }}>
            Thành viên ({group.memberCount})
          </SocialLink>
        </h3>
        <div className={s.stackRow}>
          <AvatarStack users={group.memberPreview} size={30} />
          {rest > 0 ? (
            <SocialLink
              to={{ name: 'group', groupId: group.id, section: 'members' }}
              className={s.moreCount}
              aria-label={`Xem thêm ${rest} thành viên`}
            >
              +{rest}
            </SocialLink>
          ) : null}
        </div>
        {group.capabilities.canManage ? (
          <button type="button" className={s.addMemberBtn} onClick={onAddMembers}>
            <Plus size={13} />
            Thêm thành viên
          </button>
        ) : null}
      </section>

      <section className={s.sideCard} aria-label="Quản trị viên">
        <h3 className={s.sideTitle}>Quản trị viên ({group.adminCount})</h3>
        <ul className={s.sideList}>
          {admins.map((member) => (
            <li key={member.user.id} className={s.sideRow}>
              <Avatar user={member.user} size={32} />
              <span className={s.rowText}>
                <span className={s.rowTitle}>
                  {member.user.name} <span className={s.roleAdmin}>Admin</span>
                </span>
                {userSubtitle(member.user) ? <span className={s.rowMeta}>{userSubtitle(member.user)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <OtherGroups currentId={group.id} />
    </aside>
  );
}
