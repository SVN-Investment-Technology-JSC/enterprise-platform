'use client';

import { SOCIAL_HRM_LINKS, type SocialPersonProfile } from '@enterprise-platform/contracts-social';
import { openChat } from '@enterprise-platform/feature-chat';
import { Contact, MessageCircle, User } from 'lucide-react';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { loadProfile } from '../social-discovery-api';
import { socialHref } from '../social.model';
import { handleSocialLinkClick, navigateSocial } from '../social-navigation';
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

const BUTTON =
  'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold uppercase tracking-wide no-underline transition-colors';

/**
 * Điều hướng sang trang cá nhân kèm kiểm tra việc đang làm dở: chuyển trang kiểu SPA không có hộp hỏi của trình duyệt,
 * nên đang soạn dở bình luận hay đính kèm chưa gửi thì hỏi lại trước khi rời. `handleClick` trả `true` khi đã chặn lại
 * để hỏi (người gọi nên đóng thẻ hồ sơ); bấm kèm Ctrl/Shift hoặc chuột giữa thì để trình duyệt tự mở tab mới.
 */
function useGuardedProfileLink(userId: string) {
  const [confirming, setConfirming] = useState(false);
  const route = { name: 'profile', userId } as const;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): boolean => {
    if (hasUnsavedWork() && !event.defaultPrevented && event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
      event.preventDefault();
      setConfirming(true);
      return true;
    }
    handleSocialLinkClick(event, route);
    return false;
  };

  const dialog = (
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
  );

  return { href: socialHref(route), confirming, handleClick, dialog };
}

function PersonCard({
  userId,
  name,
  href,
  onProfileClick,
}: {
  readonly userId: string;
  readonly name: string;
  readonly href: string;
  readonly onProfileClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
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
      <p className="m-0 py-6 text-center text-sm text-slate-600" aria-busy={!failed}>
        {failed ? name : 'Đang tải…'}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <a href={href} onClick={onProfileClick} className="mb-2 rounded-full" aria-label={`Trang cá nhân của ${profile.user.name}`}>
        <Avatar user={profile.user} size={80} />
      </a>
      <a href={href} onClick={onProfileClick} className="text-base font-semibold text-slate-900 no-underline hover:underline">
        {profile.user.name}
      </a>
      {profile.position ? <p className="m-0 text-sm text-slate-600">{profile.position}</p> : null}
      {profile.unitName ? <p className="m-0 text-xs text-slate-500">{profile.unitName}</p> : null}
      {profile.email ? <p className="m-0 max-w-full truncate text-xs text-slate-500">{profile.email}</p> : null}
      <div className="mt-3 flex w-full gap-2">
        {profile.isSelf ? null : (
          <button
            type="button"
            className={`${BUTTON} border-amber-400 bg-amber-300 text-zinc-900 hover:bg-amber-400`}
            onClick={() => openChat({ userId })}
          >
            <MessageCircle size={14} aria-hidden="true" />
            Nhắn tin
          </button>
        )}
        {profile.canOpenInHrm ? (
          <a className={`${BUTTON} border-slate-300 bg-white text-slate-600 hover:bg-slate-50`} href={SOCIAL_HRM_LINKS.employees}>
            <Contact size={14} aria-hidden="true" />
            Hồ sơ
          </a>
        ) : null}
        <a href={href} onClick={onProfileClick} className={`${BUTTON} border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}>
          <User size={14} aria-hidden="true" />
          Cá nhân
        </a>
      </div>
    </div>
  );
}

/**
 * Liên kết tới trang cá nhân của một người, kèm thẻ hồ sơ hiện khi rê chuột (ảnh, tên, chức danh, đơn vị, email và các nút
 * Nhắn tin, Hồ sơ, Cá nhân). Dùng cho tên được nhắc và ảnh đại diện.
 */
export function PersonHover({
  userId,
  name,
  label,
  className,
  children,
}: {
  readonly userId: string;
  readonly name: string;
  /** Nhãn đọc cho trình đọc màn hình khi nội dung liên kết không có chữ (ảnh đại diện). */
  readonly label?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const link = useGuardedProfileLink(userId);
  const [open, setOpen] = useState(false);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (link.handleClick(event)) setOpen(false);
  };

  return (
    <>
      {/* Đóng thẻ hồ sơ khi hộp xác nhận mở, để nó không đè lên hộp. */}
      <HoverCard open={open && !link.confirming} onOpenChange={setOpen}>
        <HoverCardTrigger href={link.href} className={className} aria-label={label} onClick={onClick}>
          {children}
        </HoverCardTrigger>
        <HoverCardContent className="w-80 p-4">
          <PersonCard
            userId={userId}
            name={name}
            href={link.href}
            onProfileClick={(event) => {
              if (link.handleClick(event)) setOpen(false);
            }}
          />
        </HoverCardContent>
      </HoverCard>
      {link.dialog}
    </>
  );
}
