'use client';

import type { SocialGroupDetail, SocialGroupTopic } from '@enterprise-platform/contracts-social';
import { BarChart3, Image as ImageIcon, Megaphone } from 'lucide-react';
import { useSocialSession, type SocialComposerMode } from '../../social-context';
import { SocialLink } from '../../social-navigation';
import { SocialFeed } from '../feed/social-feed';
import { Avatar } from '../ui';
import s from './groups.module.scss';

/**
 * Bảng tin của nhóm: ô "Đăng bài viết mới" với ba lối tắt, chip Tất cả / Bài thông báo / chủ đề và danh sách bài.
 * Bài render bằng `SocialFeed` (thẻ bài `PostCard`).
 */
export function GroupFeedSection({
  group,
  announcementsOnly,
  topics,
  topicId,
  onTopicChange,
}: {
  readonly group: SocialGroupDetail;
  readonly announcementsOnly: boolean;
  readonly topics: readonly SocialGroupTopic[];
  readonly topicId?: string;
  readonly onTopicChange: (topicId: string | undefined) => void;
}) {
  const session = useSocialSession();
  const caps = group.capabilities;
  const isMember = Boolean(group.myMembership);
  const compose = (mode?: SocialComposerMode) =>
    session?.openComposer(undefined, { groupId: group.id, mode });
  const activeTopic = announcementsOnly ? undefined : topicId;

  return (
    <div className={s.feedSection}>
      {session && isMember ? (
        caps.canPost ? (
          <div className={s.composeBox}>
            <div className={s.composeTop}>
              <Avatar user={session.me.user} size={32} />
              <button type="button" className={s.composeTrigger} onClick={() => compose()}>
                Đăng bài viết mới
              </button>
            </div>
            <div className={s.composeShortcuts}>
              <button type="button" onClick={() => compose('media')}>
                <ImageIcon size={15} aria-hidden="true" />
                Ảnh/Video/File
              </button>
              <button type="button" onClick={() => compose('poll')}>
                <BarChart3 size={15} aria-hidden="true" />
                Bình chọn
              </button>
              {caps.canManage ? (
                <button type="button" onClick={() => compose('announcement')}>
                  <Megaphone size={15} aria-hidden="true" />
                  Thông báo
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className={s.noticeMuted}>Nhóm chỉ cho phép một số người đăng bài.</p>
        )
      ) : null}

      <div className={s.chipRow} role="tablist" aria-label="Lọc bài trong nhóm">
        <SocialLink
          to={{ name: 'group', groupId: group.id }}
          role="tab"
          aria-selected={!announcementsOnly && !activeTopic}
          className={s.filterChip}
          data-active={!announcementsOnly && !activeTopic}
          onClick={() => onTopicChange(undefined)}
        >
          Tất cả
        </SocialLink>
        <SocialLink
          to={{ name: 'group', groupId: group.id, section: 'announcements' }}
          role="tab"
          aria-selected={announcementsOnly}
          className={s.filterChip}
          data-active={announcementsOnly}
        >
          Bài thông báo
        </SocialLink>
        {topics.map((topic) => (
          <SocialLink
            key={topic.id}
            to={{ name: 'group', groupId: group.id }}
            role="tab"
            aria-selected={activeTopic === topic.id}
            className={s.filterChip}
            data-active={activeTopic === topic.id}
            onClick={() => onTopicChange(topic.id)}
          >
            {topic.name}
          </SocialLink>
        ))}
      </div>

      <SocialFeed
        key={`${group.id}:${announcementsOnly ? 'ann' : 'all'}:${activeTopic ?? ''}`}
        scope={{
          groupId: group.id,
          kind: announcementsOnly ? 'announcement' : undefined,
          groupTopicId: activeTopic,
        }}
      />
    </div>
  );
}
