'use client';

import type { SocialGroupSummary, SocialUserRef } from '@enterprise-platform/contracts-social';
import { Pin, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadMyGroups } from '../../social-api';
import { orderMyGroups } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { GroupGlyph } from '../groups/group-visuals';
import { listGroupMembers } from '../groups/social-groups-api';
import { PersonHover } from '../person-card';
import { Avatar } from '../ui';

/** Số nhóm hiện ở thẻ "Nhóm của bạn"; lấy dư để nhóm ưu tiên không bị cắt mất. */
const GROUP_LIMIT = 6;
/** Số ảnh thành viên hiện dưới mỗi nhóm; còn lại gộp thành "+N". */
const GROUP_MEMBER_AVATARS = 4;
/** Một lượt lấy tối đa số nhóm của trang (trần của máy chủ); vừa để xếp nhóm ưu tiên vừa để đếm nhóm đã tham gia. */
const GROUP_FETCH = 50;

const formatCount = (value: number) => value.toLocaleString('vi-VN');

export interface MyGroupsState {
  readonly groups: readonly SocialGroupSummary[] | undefined;
  readonly failed: boolean;
  /** Còn nhóm ngoài lượt đã lấy: số đếm chỉ là "từ ... trở lên". */
  readonly hasMore: boolean;
}

/** Nhóm của tôi, lấy một lần cho cả thẻ hồ sơ (đếm) lẫn thẻ "Nhóm của bạn" (danh sách). */
export function useMyGroups(): MyGroupsState {
  const [state, setState] = useState<MyGroupsState>({ groups: undefined, failed: false, hasMore: false });

  useEffect(() => {
    let cancelled = false;
    loadMyGroups(GROUP_FETCH)
      .then((page) => {
        if (!cancelled) setState({ groups: orderMyGroups(page.items), failed: false, hasMore: Boolean(page.nextCursor) });
      })
      .catch(() => {
        if (!cancelled) setState({ groups: undefined, failed: true, hasMore: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Ảnh vài thành viên của nhóm (quản trị viên trước); rê chuột vào ảnh để xem hồ sơ rút gọn. */
function GroupMemberAvatars({ group }: { readonly group: SocialGroupSummary }) {
  const [users, setUsers] = useState<readonly SocialUserRef[]>([]);

  useEffect(() => {
    let cancelled = false;
    listGroupMembers(group.id, { limit: GROUP_MEMBER_AVATARS })
      .then((page) => {
        if (!cancelled) setUsers(page.items.map((member) => member.user));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  if (users.length === 0) return null;
  const rest = group.memberCount - users.length;
  return (
    <span className={styles.groupCardMembers}>
      {users.map((user) => (
        <PersonHover key={user.id} userId={user.id} name={user.name} label={user.name} className={styles.noticeReactor}>
          <Avatar user={user} size={22} />
        </PersonHover>
      ))}
      {rest > 0 ? <span className={styles.noticeReactorMore}>+{formatCount(rest)}</span> : null}
    </span>
  );
}

export function MyGroups({ groups: all, failed }: Pick<MyGroupsState, 'groups' | 'failed'>) {
  const groups = all?.slice(0, GROUP_LIMIT);

  return (
    <section className={styles.panel} aria-label="Nhóm của bạn">
      <header className={styles.panelHead}>
        <Users size={17} aria-hidden="true" />
        <h2>Nhóm của bạn</h2>
        <SocialLink className={styles.panelLink} to={{ name: 'groups' }}>
          Xem tất cả
        </SocialLink>
      </header>
      {failed ? (
        <p className={styles.panelEmpty}>Không tải được danh sách nhóm.</p>
      ) : !groups ? (
        <p className={styles.panelEmpty}>Đang tải…</p>
      ) : groups.length === 0 ? (
        <p className={styles.panelEmpty}>Bạn chưa tham gia nhóm nào.</p>
      ) : (
        <ul className={styles.groupCards}>
          {groups.map((group) => (
            <li key={group.id} className={styles.groupCard}>
              <SocialLink
                className={styles.groupCardLink}
                to={{ name: 'group', groupId: group.id }}
                aria-label={group.name}
              >
                <GroupGlyph icon={group.icon} color={group.color} size={36} />
              </SocialLink>
              <div className={styles.groupCardBody}>
                <span className={styles.groupCardName} title={group.name}>
                  {group.name}
                </span>
                <span className={styles.groupCardMeta}>
                  {group.myPriorityAt ? <Pin size={11} className={styles.groupPin} aria-label="Nhóm ưu tiên" /> : null}
                  {formatCount(group.memberCount)} thành viên
                </span>
                <GroupMemberAvatars group={group} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


/** "Nhóm của bạn" tự nạp danh sách nhóm (cột phải). */
export function MyGroupsCard() {
  const { groups, failed } = useMyGroups();
  return <MyGroups groups={groups} failed={failed} />;
}
