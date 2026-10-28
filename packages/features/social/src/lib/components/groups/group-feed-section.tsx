'use client';

import type { SocialGroupDetail, SocialGroupTopic } from '@enterprise-platform/contracts-social';
import { useSocialSession, type SocialComposerMode } from '../../social-context';
import { SocialLink } from '../../social-navigation';
import { SocialFeed } from '../feed/social-feed';
import { ComposerBox } from '../shell/composer-box';
import { FILTER_CHIP } from './group-ui';

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
    <div className="flex min-w-0 flex-col gap-2">
      {session && isMember ? (
        caps.canPost ? (
          <ComposerBox
            user={session.me.user}
            placeholder="Đăng bài mới vào nhóm"
            canAnnounce={caps.canManage}
            onCompose={compose}
          />
        ) : (
          <p className="m-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-[7px] text-[12.5px] text-slate-500">
            Nhóm chỉ cho phép một số người đăng bài.
          </p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Lọc bài trong nhóm">
        <SocialLink
          to={{ name: 'group', groupId: group.id }}
          role="tab"
          aria-selected={!announcementsOnly && !activeTopic}
          className={FILTER_CHIP}
          data-active={!announcementsOnly && !activeTopic}
          onClick={() => onTopicChange(undefined)}
        >
          Tất cả
        </SocialLink>
        <SocialLink
          to={{ name: 'group', groupId: group.id, section: 'announcements' }}
          role="tab"
          aria-selected={announcementsOnly}
          className={FILTER_CHIP}
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
            className={FILTER_CHIP}
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
