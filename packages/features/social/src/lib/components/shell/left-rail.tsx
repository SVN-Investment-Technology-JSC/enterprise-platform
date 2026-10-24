'use client';

import type {
  SocialGroupSummary,
  SocialInboxCounts,
  SocialMe,
  SocialTopic,
} from '@enterprise-platform/contracts-social';
import { Bookmark, Cake, Clock, Pin, Settings2, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadMyGroups } from '../../social-api';
import { loadProfile } from '../../social-discovery-api';
import { orderMyGroups } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { GroupGlyph } from '../groups/group-visuals';
import { Avatar, userSubtitle } from '../ui';

/** Số nhóm hiện ở cột trái; lấy dư để nhóm ưu tiên không bị cắt mất. */
const GROUP_LIMIT = 6;
const GROUP_FETCH = 20;

export interface TopicFilterProps {
  readonly topics: readonly SocialTopic[];
  readonly activeTopicId: string | undefined;
  readonly canManage: boolean;
  readonly onSelect: (topicId: string | undefined) => void;
  readonly onManage: () => void;
}

const formatCount = (value: number) => value.toLocaleString('vi-VN');

function ProfileCard({ me }: { readonly me: SocialMe }) {
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
      <Avatar user={me.user} size={40} />
      <div className={styles.profileInfo}>
        <SocialLink className={styles.profileName} to={{ name: 'profile', userId: me.user.id }}>
          {me.user.name}
        </SocialLink>
        {subtitle ? <span className={styles.profileSub}>{subtitle}</span> : null}
      </div>
      <div className={styles.profileMeta}>
        {postCount !== undefined ? (
          <span>
            <strong>{formatCount(postCount)}</strong> bài viết
          </span>
        ) : (
          <span />
        )}
        <SocialLink className={styles.panelLink} to={{ name: 'profile', userId: me.user.id }}>
          Trang cá nhân
        </SocialLink>
      </div>
    </section>
  );
}

interface ShortcutItem {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly route: 'saved' | 'scheduled' | 'birthday';
  readonly count?: number;
}

function Shortcuts({ counts }: { readonly counts: SocialInboxCounts | undefined }) {
  const items: readonly ShortcutItem[] = [
    { key: 'saved', label: 'Đã lưu', icon: Bookmark, route: 'saved', count: counts?.bookmarks },
    { key: 'scheduled', label: 'Hẹn giờ', icon: Clock, route: 'scheduled', count: counts?.myScheduled },
    { key: 'birthday', label: 'Sinh nhật', icon: Cake, route: 'birthday' },
  ];
  return (
    <nav className={styles.panel} aria-label="Lối tắt">
      <ul className={styles.shortcutList}>
        {items.map(({ key, label, icon: Icon, route, count }) => (
          <li key={key}>
            <SocialLink to={{ name: route }}>
              <Icon size={15} aria-hidden="true" />
              <span className={styles.groupName}>{label}</span>
              {count ? <span className={styles.groupCount}>{formatCount(count)}</span> : null}
            </SocialLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MyGroups() {
  const [groups, setGroups] = useState<readonly SocialGroupSummary[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMyGroups(GROUP_FETCH)
      .then((items) => {
        if (!cancelled) setGroups(orderMyGroups(items).slice(0, GROUP_LIMIT));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
 * Cột trái: hồ sơ của tôi, lối tắt, nhóm của bạn, chuyên mục. `topicFilter` chỉ có ở Bảng tin và
 * Tường công ty (nơi lọc chuyên mục có nghĩa).
 */
export function LeftRail({
  me,
  counts,
  topicFilter,
}: {
  readonly me: SocialMe;
  readonly counts: SocialInboxCounts | undefined;
  readonly topicFilter?: TopicFilterProps;
}) {
  return (
    <aside className={styles.leftRail} aria-label="Thông tin của bạn">
      <ProfileCard me={me} />
      <Shortcuts counts={counts} />
      <MyGroups />
      {topicFilter ? <TopicFilter {...topicFilter} /> : null}
    </aside>
  );
}
