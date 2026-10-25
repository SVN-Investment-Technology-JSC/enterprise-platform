'use client';

import type { SocialGroupSummary, SocialMe, SocialTopic } from '@enterprise-platform/contracts-social';
import { Pin, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadMyGroups } from '../../social-api';
import { loadProfile } from '../../social-discovery-api';
import { DEFAULT_PROFILE_COVER } from '../../profile-cover';
import { orderMyGroups, type SocialTab, type SocialTabId } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { GroupGlyph } from '../groups/group-visuals';
import { Avatar, userSubtitle } from '../ui';
import { SocialNavCard } from './social-nav';

/** Số nhóm hiện ở cột trái; lấy dư để nhóm ưu tiên không bị cắt mất. */
const GROUP_LIMIT = 6;
/** Một lượt lấy tối đa số nhóm của trang (trần của máy chủ); vừa để xếp nhóm ưu tiên vừa để đếm nhóm đã tham gia. */
const GROUP_FETCH = 50;

export interface TopicFilterProps {
  readonly topics: readonly SocialTopic[];
  readonly activeTopicId: string | undefined;
  readonly canManage: boolean;
  readonly onSelect: (topicId: string | undefined) => void;
  readonly onManage: () => void;
}

const formatCount = (value: number) => value.toLocaleString('vi-VN');

interface MyGroupsState {
  readonly groups: readonly SocialGroupSummary[] | undefined;
  readonly failed: boolean;
  /** Còn nhóm ngoài lượt đã lấy: số đếm chỉ là "từ ... trở lên". */
  readonly hasMore: boolean;
}

/** Nhóm của tôi, lấy một lần cho cả thẻ hồ sơ (đếm) lẫn thẻ "Nhóm của bạn" (danh sách). */
function useMyGroups(): MyGroupsState {
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

function ProfileCard({
  me,
  groupCount,
  groupCountMore,
  coverUrl = DEFAULT_PROFILE_COVER,
}: {
  readonly me: SocialMe;
  /** Số nhóm đã tham gia; chưa biết hoặc 0 thì không hiện. */
  readonly groupCount: number | undefined;
  readonly groupCountMore: boolean;
  readonly coverUrl?: string;
}) {
  const [postCount, setPostCount] = useState<number>();

  useEffect(() => {
    let cancelled = false;
    loadProfile(me.user.id)
      .then((profile) => {
        if (!cancelled) setPostCount(profile.postCount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me.user.id]);

  const subtitle = userSubtitle(me.user);
  return (
    <section className={`${styles.panel} ${styles.profileCard}`} aria-label="Hồ sơ của tôi">
      <div className={styles.profileCover} style={{ backgroundImage: `url("${coverUrl}")` }} aria-hidden="true" />
      <div className={styles.profileBody}>
        <span className={styles.profileAvatar}>
          <Avatar user={me.user} size={56} />
        </span>
        <div className={styles.profileInfo}>
          <SocialLink className={styles.profileName} to={{ name: 'profile', userId: me.user.id }}>
            {me.user.name}
          </SocialLink>
          {subtitle ? <span className={styles.profileSub}>{subtitle}</span> : null}
        </div>
        <div className={styles.profileMeta}>
          <span className={styles.profileStats}>
            {postCount !== undefined ? (
              <span>
                <strong>{formatCount(postCount)}</strong> bài viết
              </span>
            ) : null}
            {groupCount ? (
              <span>
                <strong>
                  {formatCount(groupCount)}
                  {groupCountMore ? '+' : ''}
                </strong>{' '}
                nhóm
              </span>
            ) : null}
          </span>
          <SocialLink className={styles.panelLink} to={{ name: 'profile', userId: me.user.id }}>
            Trang cá nhân
          </SocialLink>
        </div>
      </div>
    </section>
  );
}

function MyGroups({ groups: all, failed }: Pick<MyGroupsState, 'groups' | 'failed'>) {
  const groups = all?.slice(0, GROUP_LIMIT);

  return (
    <section className={styles.panel} aria-label="Nhóm của bạn">
      <header className={styles.panelHead}>
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
        <ul className={styles.groupList}>
          {groups.map((group) => (
            <li key={group.id}>
              <SocialLink to={{ name: 'group', groupId: group.id }}>
                <GroupGlyph icon={group.icon} color={group.color} size={28} />
                <span className={styles.groupName}>{group.name}</span>
                {group.myPriorityAt ? (
                  <Pin size={11} className={styles.groupPin} aria-label="Nhóm ưu tiên" />
                ) : null}
                <span className={styles.groupCount}>{formatCount(group.memberCount)}</span>
              </SocialLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopicFilter({ topics, activeTopicId, canManage, onSelect, onManage }: TopicFilterProps) {
  const active = topics.filter((topic) => topic.isActive);
  return (
    <section className={styles.panel} aria-label="Chuyên mục">
      <header className={styles.panelHead}>
        <h2>Chuyên mục</h2>
        {canManage ? (
          <button
            type="button"
            className={styles.panelIconButton}
            aria-label="Quản lý chuyên mục"
            title="Quản lý chuyên mục"
            onClick={onManage}
          >
            <Settings2 size={14} />
          </button>
        ) : null}
      </header>
      <ul className={styles.topicList}>
        <li>
          <button type="button" aria-current={!activeTopicId} onClick={() => onSelect(undefined)}>
            <span className={styles.topicName}>Tất cả</span>
          </button>
        </li>
        {active.map((topic) => (
          <li key={topic.id}>
            <button type="button" aria-current={topic.id === activeTopicId} onClick={() => onSelect(topic.id)}>
              <span className={styles.topicName}>{topic.name}</span>
              <span className={styles.topicCount}>{formatCount(topic.postCount)}</span>
            </button>
          </li>
        ))}
      </ul>
      {active.length === 0 ? <p className={styles.panelEmpty}>Chưa có chuyên mục.</p> : null}
    </section>
  );
}

/**
 * Cột trái: hồ sơ của tôi, thẻ điều hướng (các tab của Mạng nội bộ), nhóm của bạn, chuyên mục. `topicFilter` chỉ có ở
 * Bảng tin và Tường công ty (nơi lọc chuyên mục có nghĩa).
 */
export function LeftRail({
  me,
  tabs,
  activeTab,
  topicFilter,
}: {
  readonly me: SocialMe;
  readonly tabs: readonly SocialTab[];
  readonly activeTab: SocialTabId | undefined;
  readonly topicFilter?: TopicFilterProps;
}) {
  const myGroups = useMyGroups();
  return (
    <aside className={styles.leftRail} aria-label="Thông tin của bạn">
      <ProfileCard me={me} groupCount={myGroups.groups?.length} groupCountMore={myGroups.hasMore} />
      <SocialNavCard tabs={tabs} activeTab={activeTab} />
      <MyGroups groups={myGroups.groups} failed={myGroups.failed} />
      {topicFilter ? <TopicFilter {...topicFilter} /> : null}
    </aside>
  );
}
