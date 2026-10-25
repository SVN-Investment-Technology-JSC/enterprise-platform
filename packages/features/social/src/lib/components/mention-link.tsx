'use client';

import type { SocialPersonProfile } from '@enterprise-platform/contracts-social';
import { useEffect, useState } from 'react';
import { loadProfile } from '../social-discovery-api';
import { socialHref } from '../social.model';
import { handleSocialLinkClick, navigateSocial } from '../social-navigation';
import styles from '../social.module.scss';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';
import { hasUnsavedWork } from '../unsaved-work';
import { Avatar, ConfirmDialog } from './ui';

const profiles = new Map<string, Promise<SocialPersonProfile>>();

/** Hồ sơ rút gọn, lấy một lần cho mỗi người trong phiên (lỗi thì bỏ cache để thử lại lần sau). */
function fetchProfile(userId: string): Promise<SocialPersonProfile> {
  let pending = profiles.get(userId);
  if (!pending) {
    pending = loadProfile(userId);
    profiles.set(userId, pending);
    pending.catch(() => profiles.delete(userId));
  }
  return pending;
}

function ProfileCard({ userId, name }: { readonly userId: string; readonly name: string }) {
  const [profile, setProfile] = useState<SocialPersonProfile>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchProfile(userId)
      .then((next) => active && setProfile(next))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [userId]);

  if (!profile) {
    return (
      <p className="m-0 text-sm text-slate-600" aria-busy={!failed}>
        {failed ? name : 'Đang tải…'}
      </p>
    );
  }
  const subtitle = [profile.position, profile.unitName].filter(Boolean).join(' · ');
  return (
    <div className="flex items-start gap-3">
      <Avatar user={profile.user} size={44} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-semibold text-slate-900">{profile.user.name}</p>
        {subtitle ? <p className="m-0 mt-0.5 text-xs text-slate-600">{subtitle}</p> : null}
        {profile.email ? <p className="m-0 mt-1 truncate text-xs text-slate-500">{profile.email}</p> : null}
        <p className="m-0 mt-1 text-xs text-slate-500">{profile.postCount.toLocaleString('vi-VN')} bài viết</p>
      </div>
    </div>
  );
}

/**
 * Tên được nhắc trong bình luận: chữ xanh, rê chuột hiện hồ sơ rút gọn, bấm để sang trang cá nhân.
 * Đang soạn dở bình luận thì hỏi lại trước khi chuyển trang (chuyển trang kiểu SPA không có hộp hỏi của trình duyệt).
 */
export function MentionLink({ userId, name }: { readonly userId: string; readonly name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const route = { name: 'profile', userId } as const;

  return (
    <>
      {/* Đóng thẻ hồ sơ khi hộp xác nhận mở, để nó không đè lên hộp. */}
      <HoverCard open={cardOpen && !confirming} onOpenChange={setCardOpen}>
        <HoverCardTrigger
          href={socialHref(route)}
          className={styles.mention}
          onClick={(event) => {
            if (hasUnsavedWork() && !event.defaultPrevented && event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
              event.preventDefault();
              setCardOpen(false);
              setConfirming(true);
              return;
            }
            handleSocialLinkClick(event, route);
          }}
        >
          @{name}
        </HoverCardTrigger>
        <HoverCardContent>
          <ProfileCard userId={userId} name={name} />
        </HoverCardContent>
      </HoverCard>
      <ConfirmDialog
        open={confirming}
        title="Rời trang khi đang soạn dở?"
        message={['Bạn đang soạn nội dung chưa gửi (bình luận hoặc tệp đính kèm).', 'Nếu mở trang cá nhân, nội dung này sẽ mất.']}
        confirmLabel="Rời trang"
        cancelLabel="Ở lại"
        submittingLabel="Đang chuyển…"
        danger={false}
        busy={false}
        onConfirm={() => {
          setConfirming(false);
          navigateSocial(route);
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
