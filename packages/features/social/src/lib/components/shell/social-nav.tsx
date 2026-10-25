'use client';

import { SOCIAL_SEARCH_QUERY_MAX, SOCIAL_SEARCH_QUERY_MIN } from '@enterprise-platform/contracts-social';
import { Bookmark, Building2, ClipboardCheck, Clock, Newspaper, Search, Users, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { sliceSafe } from '../../safe-text';
import { routeForTab, socialHref, type SocialRoute, type SocialTab, type SocialTabId } from '../../social.model';
import { handleSocialLinkClick, navigateSocial } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import GooeyNav from '../../ui/gooey-nav';

const TAB_ICONS: Readonly<Record<SocialTabId, LucideIcon>> = {
  feed: Newspaper,
  wall: Building2,
  groups: Users,
  saved: Bookmark,
  pending: ClipboardCheck,
  scheduled: Clock,
};

/** Chờ gõ xong bấy nhiêu ms mới chuyển sang kết quả tìm kiếm. */
const SEARCH_DEBOUNCE_MS = 450;

function goToSearch(query: string, replace: boolean) {
  navigateSocial({ name: 'search', query }, { replace });
}

const FEED: SocialRoute = { name: 'feed' };

/** Ô tìm kiếm trên thanh điều hướng: gõ (hoặc Enter) thì sang `/search?q=`. */
function SearchBox({ active, query }: { readonly active: boolean; readonly query: string }) {
  const [text, setText] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;

  // Giữ ô nhập khớp với tuyến khi mở liên kết tìm kiếm hoặc rời khỏi trang tìm kiếm.
  useEffect(() => {
    setText((current) => (active ? (current.trim() === query ? current : query) : ''));
  }, [active, query]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = (value: string) => {
    clearTimeout(timer.current);
    const trimmed = sliceSafe(value.trim(), SOCIAL_SEARCH_QUERY_MAX);
    if (trimmed.length >= SOCIAL_SEARCH_QUERY_MIN) goToSearch(trimmed, activeRef.current);
  };

  const onChange = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => submit(value), SEARCH_DEBOUNCE_MS);
  };

  return (
    <form
      className={styles.search}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        submit(text);
      }}
    >
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        value={text}
        maxLength={SOCIAL_SEARCH_QUERY_MAX}
        placeholder="Tìm bài viết, người, nhóm"
        aria-label="Tìm kiếm trong Mạng nội bộ"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            clearTimeout(timer.current);
            setText('');
            if (activeRef.current) navigateSocial(FEED);
          }
        }}
      />
      {text ? (
        <button
          type="button"
          className={styles.searchClear}
          aria-label="Xoá từ khoá"
          onClick={() => {
            clearTimeout(timer.current);
            setText('');
            if (activeRef.current) navigateSocial(FEED);
          }}
        >
          <X size={13} />
        </button>
      ) : null}
    </form>
  );
}

/** Thanh trên cùng của nội dung: thẻ điều hướng dạng viên thuốc và ô tìm kiếm. */
export function SocialNav({
  tabs,
  activeTab,
  searchActive,
  searchQuery,
}: {
  readonly tabs: readonly SocialTab[];
  readonly activeTab: SocialTabId | undefined;
  readonly searchActive: boolean;
  readonly searchQuery: string;
}) {
  const items = tabs.map((tab) => {
    const Icon = TAB_ICONS[tab.id];
    const route = routeForTab(tab.id);
    return {
      id: tab.id,
      label: tab.label,
      href: socialHref(route),
      icon: <Icon size={15} aria-hidden="true" />,
      badge: tab.badge ? (tab.badge > 99 ? '99+' : tab.badge) : undefined,
      onClick: (event: MouseEvent<HTMLElement>) =>
        handleSocialLinkClick(event as MouseEvent<HTMLAnchorElement>, route),
    };
  });

  return (
    <div className={styles.bar}>
      <div className={styles.gooeyWrap}>
        <GooeyNav
          theme="light"
          size="sm"
          frame
          color="#ffc90a"
          activeTextColor="#18161d"
          hoverEffect
          particleCount={12}
          spread={44}
          animationTime={520}
          activeIndex={items.findIndex((item) => item.id === activeTab)}
          items={items}
        />
      </div>
      <SearchBox active={searchActive} query={searchQuery} />
    </div>
  );
}
