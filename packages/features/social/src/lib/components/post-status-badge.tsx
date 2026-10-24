'use client';

import type {
  SocialGroupRef,
  SocialPost,
} from '@enterprise-platform/contracts-social';
import {
  SOCIAL_POST_VISIBILITY_DESCRIPTIONS,
  type SocialPostVisibility,
} from '@enterprise-platform/contracts-social';
import {
  Building2,
  Clock,
  Lock,
  Pin,
  ShieldAlert,
  UserLock,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { postStatusBadges } from '../post-extras.model';
import styles from '../post-extras.module.scss';
import {
  summarizeAudience,
  visibilityBadgeLabel,
} from '../post-visibility.model';
import { SocialLink } from '../social-navigation';

const ICONS = {
  pending: ShieldAlert,
  rejected: XCircle,
  scheduled: Clock,
  pinned: Pin,
} as const;

/** Huy hiệu trạng thái bài: chờ duyệt, bị từ chối, hẹn giờ, thông báo, đã ghim. */
export function PostStatusBadges({
  post,
}: {
  readonly post: Pick<SocialPost, 'status' | 'kind' | 'pinned' | 'scheduledAt'>;
}) {
  const badges = postStatusBadges(post);
  return (
    <>
      {badges.map((badge) => {
        const Icon = ICONS[badge.key as keyof typeof ICONS];
        return (
          <span
            key={badge.key}
            className={styles.statusBadge}
            data-tone={badge.tone}
          >
            {Icon ? <Icon size={11} /> : null}
            {badge.label}
          </span>
        );
      })}
    </>
  );
}

const VISIBILITY_ICONS: Readonly<Record<SocialPostVisibility, LucideIcon>> = {
  company: Users,
  unit: Building2,
  custom: Users,
  private: UserLock,
};

/** Quyền xem của bài Tường công ty, cạnh thời gian đăng. Công khai và bài nhóm thì không hiện. */
export function VisibilityBadge({
  post,
}: {
  readonly post: Pick<SocialPost, 'visibility' | 'group' | 'audience'>;
}) {
  const label = visibilityBadgeLabel(post);
  if (!label || !post.visibility) return null;
  const Icon = VISIBILITY_ICONS[post.visibility];
  const audience = post.audience
    ? summarizeAudience(post.audience.users, post.audience.units)
    : '';
  const title =
    post.visibility === 'custom' && audience
      ? `${label}: ${audience}`
      : SOCIAL_POST_VISIBILITY_DESCRIPTIONS[post.visibility];
  return (
    <span className={styles.visibilityBadge} title={title}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Nhãn nhóm của bài; bấm để mở nhóm. */
export function GroupTag({ group }: { readonly group: SocialGroupRef }) {
  return (
    <SocialLink
      to={{ name: 'group', groupId: group.id }}
      className={styles.groupTag}
      title={`Nhóm ${group.name}`}
    >
      <span
        className={styles.groupDot}
        data-color={group.color}
        aria-hidden="true"
      />
      <span>{group.name}</span>
      {group.privacy === 'private' ? (
        <Lock size={11} aria-label="Nhóm riêng tư" />
      ) : null}
    </SocialLink>
  );
}
