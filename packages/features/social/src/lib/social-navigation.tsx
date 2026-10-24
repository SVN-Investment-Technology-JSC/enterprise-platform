'use client';

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import {
  isLegacySocialHash,
  parseSocialPath,
  parseSocialRoute,
  socialHref,
  type SocialRoute,
} from './social.model';

/** Sự kiện nội bộ báo `history` vừa đổi do `navigateSocial` (pushState không tự phát sự kiện). */
const NAVIGATE_EVENT = 'social:navigate';

export interface NavigateSocialOptions {
  /** Thay mục lịch sử hiện tại thay vì thêm mục mới. */
  readonly replace?: boolean;
}

/**
 * Chuyển trang trong Mạng nội bộ mà không tải lại: ghi `history` rồi báo cho `useSocialRoute`.
 * Nhận tuyến hoặc một `href` đã có (`socialHref(route)`).
 */
export function navigateSocial(target: SocialRoute | string, options: NavigateSocialOptions = {}): void {
  if (typeof window === 'undefined') return;
  const href = typeof target === 'string' ? target : socialHref(target);
  const current = `${window.location.pathname}${window.location.search}`;
  if (href !== current || window.location.hash) {
    if (options.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/**
 * Đọc tuyến hiện tại từ URL và theo dõi thay đổi (Back/Forward, `navigateSocial`, và hash kiểu cũ).
 * Lần vẽ đầu trả về bảng tin (khớp phía server), ngay sau đó đọc URL thật.
 */
export function useSocialRoute(): SocialRoute {
  const [key, setKey] = useState('');
  useEffect(() => {
    const read = () => {
      const { hash } = window.location;
      // Liên kết cũ dạng `#posts/<id>`: đổi sang đường dẫn mới, không thêm mục lịch sử.
      if (isLegacySocialHash(hash)) {
        window.history.replaceState(null, '', socialHref(parseSocialRoute(hash)));
      }
      setKey(`${window.location.pathname}${window.location.search}`);
    };
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    window.addEventListener(NAVIGATE_EVENT, read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
      window.removeEventListener(NAVIGATE_EVENT, read);
    };
  }, []);

  const [pathname = '', search = ''] = splitKey(key);
  return parseSocialPath(pathname, search);
}

function splitKey(key: string): readonly [string, string] {
  const at = key.indexOf('?');
  return at < 0 ? [key, ''] : [key.slice(0, at), key.slice(at)];
}

/** Có nên để trình duyệt tự xử lý cú nhấp (mở tab mới, tải về...) thay vì chuyển trang kiểu SPA? */
function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.currentTarget.getAttribute('target');
  return !target || target === '_self';
}

/** `onClick` cho thẻ `<a href={socialHref(route)}>` tự viết: chuyển trang kiểu SPA, giữ chuột phải/mở tab mới. */
export function handleSocialLinkClick(event: MouseEvent<HTMLAnchorElement>, route: SocialRoute): void {
  if (!isPlainLeftClick(event)) return;
  event.preventDefault();
  navigateSocial(route);
}

type SocialLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  readonly to: SocialRoute;
  readonly children?: ReactNode;
};

/** Liên kết nội bộ: thẻ `<a href>` thật (mở tab mới được) nhưng bấm thường thì chuyển trang không tải lại. */
export function SocialLink({ to, onClick, children, ...rest }: SocialLinkProps) {
  return (
    <a
      {...rest}
      href={socialHref(to)}
      onClick={(event) => {
        onClick?.(event);
        handleSocialLinkClick(event, to);
      }}
    >
      {children}
    </a>
  );
}
