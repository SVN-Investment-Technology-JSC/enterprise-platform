'use client';

import type { SocialMe, SocialTopic } from '@enterprise-platform/contracts-social';
import { ListFilter, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadProfile } from '../../social-discovery-api';
import { DEFAULT_PROFILE_COVER } from '../../profile-cover';
import type { SocialTab, SocialTabId } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { Avatar, userSubtitle } from '../ui';
import { useMyGroups } from './my-groups';
import { SavedRecent } from './quick-board';
import { SocialNavCard } from './social-nav';

export interface TopicFilterProps {
  readonly topics: readonly SocialTopic[];
  readonly activeTopicId: string | undefined;
  readonly canManage: boolean;
  readonly onSelect: (topicId: string | undefined) => void;
  readonly onManage: () => void;
}

const formatCount = (value: number) => value.toLocaleString('vi-VN');

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

function TopicFilter({ topics, activeTopicId, canManage, onSelect, onManage }: TopicFilterProps) {
  const active = topics.filter((topic) => topic.isActive);
  return (
    <section className={`${styles.panel} ${styles.panelTopics}`} aria-label="Chuyên mục">
      <header className={styles.panelHead}>
        <ListFilter size={17} aria-hidden="true" />
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
 * Cột trái: hồ sơ của tôi, thẻ điều hướng (các tab của Mạng nội bộ), bài đã lưu gần đây, chuyên mục. `topicFilter` chỉ có ở
 * Bảng tin và Tường công ty (nơi lọc chuyên mục có nghĩa).
 */
export function LeftRail({
  me,
  tabs,
  activeTab,
  topicFilter,
  refreshKey = 0,
}: {
  readonly me: SocialMe;
  readonly tabs: readonly SocialTab[];
  readonly activeTab: SocialTabId | undefined;
  readonly topicFilter?: TopicFilterProps;
  /** Đổi giá trị khi cần nạp lại các khối nhanh (bài đã lưu). */
  readonly refreshKey?: number;
}) {
  const myGroups = useMyGroups();
  return (
    <aside className={styles.leftRail} aria-label="Thông tin của bạn">
      <ProfileCard me={me} groupCount={myGroups.groups?.length} groupCountMore={myGroups.hasMore} />
      <SocialNavCard tabs={tabs} activeTab={activeTab} />
      <SavedRecent refreshKey={refreshKey} />
      {topicFilter ? <TopicFilter {...topicFilter} /> : null}
    </aside>
  );
}
