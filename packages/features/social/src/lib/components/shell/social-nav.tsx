'use client';

import { SOCIAL_SEARCH_QUERY_MAX, SOCIAL_SEARCH_QUERY_MIN } from '@enterprise-platform/contracts-social';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sliceSafe } from '../../safe-text';
import { routeForTab, type SocialRoute, type SocialTab, type SocialTabId } from '../../social.model';
import { navigateSocial, SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';

/** Chờ gõ xong bấy nhiêu ms mới chuyển sang kết quả tìm kiếm. */
const SEARCH_DEBOUNCE_MS = 450;

function goToSearch(query: string, replace: boolean) {
  navigateSocial({ name: 'search', query }, { replace });
}

const FEED: SocialRoute = { name: 'feed' };

/** Ô tìm kiếm trên thanh trên: gõ (hoặc Enter) thì sang `/search?q=`. */
export function SearchBox({ active, query }: { readonly active: boolean; readonly query: string }) {
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

interface TabListProps {
  readonly tabs: readonly SocialTab[];
  readonly activeTab: SocialTabId | undefined;
}

function TabLinks({ tabs, activeTab }: TabListProps) {
  return (
    <ul className={styles.navList}>
      {tabs.map((tab) => (
        <li key={tab.id}>
          <SocialLink to={routeForTab(tab.id)} aria-current={tab.id === activeTab ? 'page' : undefined}>
            <span className={styles.groupName}>{tab.label}</span>
            {tab.badge ? <span className={styles.pillBadge}>{tab.badge > 99 ? '99+' : tab.badge}</span> : null}
          </SocialLink>
        </li>
      ))}
    </ul>
  );
}

/** Thẻ điều hướng dọc ở cột trái (màn rộng). */
export function SocialNavCard({ tabs, activeTab }: TabListProps) {
  return (
    <nav className={`${styles.panel} ${styles.navCard}`} aria-label="Điều hướng Mạng nội bộ">
      <TabLinks tabs={tabs} activeTab={activeTab} />
    </nav>
  );
}

/** Dải thẻ ngang thay cho thẻ điều hướng khi màn hẹp (cột trái rơi xuống cuối trang). */
export function SocialTabStrip({ tabs, activeTab }: TabListProps) {
  return (
    <nav className={styles.tabStrip} aria-label="Điều hướng Mạng nội bộ (màn hẹp)">
      <TabLinks tabs={tabs} activeTab={activeTab} />
    </nav>
  );
}
