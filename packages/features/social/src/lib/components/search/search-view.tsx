'use client';

import type {
  SocialGroupSummary,
  SocialPost,
  SocialSearchOverview,
  SocialTopic,
  SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DATE_PRESETS,
  EMPTY_FILTERS,
  hasActiveFilters,
  highlightSegments,
  htmlToPlainText,
  isSearchable,
  normalizeQuery,
  snippetAround,
  toSearchPostsQuery,
  type SearchFilters,
} from '../../discovery.model';
import styles from '../../discovery.module.scss';
import { SocialLink } from '../../social-navigation';
import { errorMessage, loadTopics } from '../../social-api';
import {
  loadMyGroupOptions,
  searchGroups,
  searchOverview,
  searchPeople,
  searchPosts,
} from '../../social-discovery-api';
import { formatRelativeTime, postTopics } from '../../social.model';
import { Avatar, userSubtitle } from '../ui';

type Tab = 'all' | 'posts' | 'people' | 'groups';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'posts', label: 'Bài viết' },
  { id: 'people', label: 'Người' },
  { id: 'groups', label: 'Nhóm' },
];

/** Tô sáng từ khoá bằng phần tử `<mark>`; văn bản luôn đi qua React nên không có chèn HTML. */
function Highlight({ text, query }: { readonly text: string; readonly query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((segment, index) =>
        segment.match ? (
          <mark key={index} className={styles.mark}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

interface Remote<T> {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly data?: T;
  readonly error?: string;
}

/** Tải một lần theo `key`; bỏ kết quả của lần gọi cũ khi `key` đổi. */
function useRemote<T>(key: string | null, fetcher: () => Promise<T>, fallback: string): Remote<T> & { reload: () => void } {
  const [state, setState] = useState<Remote<T>>({ status: 'idle' });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    fetcherRef
      .current()
      .then((data) => active && setState({ status: 'ready', data }))
      .catch((cause: unknown) => active && setState({ status: 'error', error: errorMessage(cause, fallback) }));
    return () => {
      active = false;
    };
  }, [key, nonce, fallback]);

  return { ...state, reload: () => setNonce((value) => value + 1) };
}

interface PagedPosts {
  readonly items: readonly SocialPost[];
  readonly nextCursor?: string;
}

/** Trang bài tìm thấy, có "Xem thêm" theo con trỏ. */
function usePostResults(query: string, filters: SearchFilters, enabled: boolean) {
  const [state, setState] = useState<Remote<PagedPosts>>({ status: 'idle' });
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  const token = useRef(0);
  const filterKey = JSON.stringify(filters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(() => {
    const mine = ++token.current;
    setState({ status: 'loading' });
    setMoreError(undefined);
    searchPosts(toSearchPostsQuery(query, filtersRef.current))
      .then((page) => mine === token.current && setState({ status: 'ready', data: page }))
      .catch(
        (cause: unknown) =>
          mine === token.current &&
          setState({ status: 'error', error: errorMessage(cause, 'Không tìm được bài viết. Vui lòng thử lại.') }),
      );
  }, [query, filterKey]);

  useEffect(() => {
    if (!enabled) {
      token.current += 1;
      setState({ status: 'idle' });
      return;
    }
    load();
  }, [enabled, load]);

  const loadMore = () => {
    const cursor = state.data?.nextCursor;
    if (!cursor || more) return;
    const mine = token.current;
    setMore(true);
    setMoreError(undefined);
    searchPosts(toSearchPostsQuery(query, filtersRef.current, cursor))
      .then((page) => {
        if (mine !== token.current) return;
        setState((current) => {
          const seen = new Set((current.data?.items ?? []).map((item) => item.id));
          const items = [...(current.data?.items ?? []), ...page.items.filter((item) => !seen.has(item.id))];
          return { status: 'ready', data: { items, nextCursor: page.nextCursor } };
        });
      })
      .catch((cause: unknown) => mine === token.current && setMoreError(errorMessage(cause, 'Không tải thêm được.')))
      .finally(() => setMore(false));
  };

  return { state, more, moreError, loadMore, reload: load };
}

/** Kết quả tìm kiếm Mạng nội bộ: Tất cả / Bài viết / Người / Nhóm. */
export function SearchView({ query }: { readonly query: string }) {
  const q = normalizeQuery(query);
  const searchable = isSearchable(q);
  const [tab, setTab] = useState<Tab>('all');
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);

  useEffect(() => {
    setTab('all');
    setFilters(EMPTY_FILTERS);
  }, [q]);

  const overview = useRemote<SocialSearchOverview>(
    searchable && tab === 'all' ? q : null,
    () => searchOverview(q),
    'Không tìm kiếm được. Vui lòng thử lại.',
  );
  const people = useRemote<readonly SocialUserRef[]>(
    searchable ? q : null,
    async () => (await searchPeople(q)).items,
    'Không tìm được người. Vui lòng thử lại.',
  );
  const groups = useRemote<{ items: readonly SocialGroupSummary[]; nextCursor?: string }>(
    searchable && tab === 'groups' ? q : null,
    () => searchGroups(q),
    'Không tìm được nhóm. Vui lòng thử lại.',
  );
  const posts = usePostResults(q, filters, searchable && tab === 'posts');

  // Dữ liệu cho ô lọc: lỗi thì để trống, không chặn tìm kiếm.
  const topics = useRemote<readonly SocialTopic[]>('topics', loadTopics, '');
  const myGroups = useRemote<readonly SocialGroupSummary[]>('groups', loadMyGroupOptions, '');

  const authors = useMemo(() => {
    const map = new Map<string, SocialUserRef>();
    for (const user of people.data ?? []) map.set(user.id, user);
    for (const post of posts.state.data?.items ?? []) map.set(post.author.id, post.author);
    return [...map.values()];
  }, [people.data, posts.state.data]);

  const goTab = (next: Tab) => setTab(next);

  return (
    <div className={styles.search}>
      <header className={styles.searchHead}>
        <h1>Kết quả cho "{q}"</h1>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Loại kết quả">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`search-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls="search-panel"
            className={styles.tab}
            onClick={() => goTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="search-panel" aria-labelledby={`search-tab-${tab}`} className={styles.search}>
        {!searchable ? (
          <EmptyState title="Nhập thêm từ khoá" text="Từ khoá cần có ít nhất 2 ký tự." />
        ) : tab === 'all' ? (
          <AllTab q={q} remote={overview} onMore={goTab} />
        ) : tab === 'posts' ? (
          <>
            <FilterBar
              filters={filters}
              onChange={setFilters}
              topics={topics.data ?? []}
              groups={myGroups.data ?? []}
              authors={authors}
            />
            <Block<PagedPosts>
              remote={posts.state}
              retry={posts.reload}
              isEmpty={(data) => data.items.length === 0}
            >
              {(data) => (
                <section className={`${styles.card} ${styles.section}`}>
                  <PostResults q={q} items={data.items} />
                  {data.nextCursor ? (
                    <MoreButton busy={posts.more} error={posts.moreError} onClick={posts.loadMore} />
                  ) : null}
                </section>
              )}
            </Block>
          </>
        ) : tab === 'people' ? (
          <Block remote={people} retry={people.reload} isEmpty={(data) => data.length === 0}>
            {(data) => (
              <section className={`${styles.card} ${styles.section}`}>
                <PeopleResults q={q} items={data} />
              </section>
            )}
          </Block>
        ) : (
          <GroupsTab q={q} remote={groups} />
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- khung */

function EmptyState({ title, text }: { readonly title: string; readonly text?: string }) {
  return (
    <div className={`${styles.card} ${styles.state}`}>
      <p className={styles.stateTitle}>{title}</p>
      {text ? <p>{text}</p> : null}
    </div>
  );
}

/** Khung trạng thái chung: đang tải, lỗi (có Thử lại), rỗng, hoặc nội dung. */
function Block<T>({
  remote,
  retry,
  isEmpty,
  children,
}: {
  readonly remote: Remote<T>;
  readonly retry: () => void;
  readonly isEmpty: (data: T) => boolean;
  readonly children: (data: T) => ReactNode;
}) {
  if (remote.status === 'idle' || remote.status === 'loading') {
    return (
      <div className={`${styles.card} ${styles.skeletons}`} aria-busy="true" aria-label="Đang tìm kiếm">
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }
  if (remote.status === 'error' || remote.data === undefined) {
    return (
      <div className={`${styles.card} ${styles.state}`} role="alert">
        <p className={styles.stateTitle}>{remote.error ?? 'Không tìm kiếm được.'}</p>
        <button type="button" className={styles.retry} onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  }
  if (isEmpty(remote.data)) {
    return <EmptyState title="Không tìm thấy" text="Thử từ khoá khác hoặc bỏ bớt bộ lọc." />;
  }
  return <>{children(remote.data)}</>;
}

function MoreButton({
  busy,
  error,
  onClick,
}: {
  readonly busy: boolean;
  readonly error?: string;
  readonly onClick: () => void;
}) {
  return (
    <div className={styles.more}>
      {error ? <span role="alert">{error}&nbsp;</span> : null}
      <button type="button" className={styles.retry} disabled={busy} onClick={onClick}>
        {busy ? 'Đang tải…' : 'Xem thêm'}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- tab Tất cả */

function AllTab({
  q,
  remote,
  onMore,
}: {
  readonly q: string;
  readonly remote: Remote<SocialSearchOverview> & { reload: () => void };
  readonly onMore: (tab: Tab) => void;
}) {
  return (
    <Block
      remote={remote}
      retry={remote.reload}
      isEmpty={(data) => data.posts.length + data.people.length + data.groups.length === 0}
    >
      {(data) => (
        <>
          {data.posts.length > 0 ? (
            <Section title="Bài viết" onMore={() => onMore('posts')}>
              <PostResults q={q} items={data.posts} />
            </Section>
          ) : null}
          {data.people.length > 0 ? (
            <Section title="Người" onMore={() => onMore('people')}>
              <PeopleResults q={q} items={data.people} />
            </Section>
          ) : null}
          {data.groups.length > 0 ? (
            <Section title="Nhóm" onMore={() => onMore('groups')}>
              <GroupResults q={q} items={data.groups} />
            </Section>
          ) : null}
        </>
      )}
    </Block>
  );
}

function Section({
  title,
  onMore,
  children,
}: {
  readonly title: string;
  readonly onMore: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section className={`${styles.card} ${styles.section}`} aria-label={title}>
      <header className={styles.sectionHead}>
        <h2>{title}</h2>
        <button type="button" className={styles.sectionMore} onClick={onMore}>
          Xem tất cả
        </button>
      </header>
      {children}
    </section>
  );
}

/* --------------------------------------------------------- danh sách kết quả */

function PostResults({ q, items }: { readonly q: string; readonly items: readonly SocialPost[] }) {
  return (
    <ul className={styles.results}>
      {items.map((post) => {
        const text = snippetAround(htmlToPlainText(post.bodyHtml), q);
        return (
          <li key={post.id}>
            <SocialLink className={styles.result} to={{ name: 'post', postId: post.id }}>
              <Avatar user={post.author} size={36} />
              <span className={styles.resultBody}>
                {post.title ? (
                  <span className={styles.resultTitle}>
                    <Highlight text={post.title} query={q} />
                  </span>
                ) : null}
                {text ? (
                  <p className={styles.resultSnippet}>
                    <Highlight text={text} query={q} />
                  </p>
                ) : null}
                <span className={styles.resultMeta}>
                  <span>{post.author.name}</span>
                  {postTopics(post).length > 0 ? <span>{postTopics(post).map((topic) => topic.name).join(', ')}</span> : null}
                  <span>{formatRelativeTime(post.publishedAt)}</span>
                </span>
              </span>
            </SocialLink>
          </li>
        );
      })}
    </ul>
  );
}

function PeopleResults({ q, items }: { readonly q: string; readonly items: readonly SocialUserRef[] }) {
  return (
    <ul className={styles.results}>
      {items.map((user) => (
        <li key={user.id}>
          <SocialLink className={styles.result} to={{ name: 'profile', userId: user.id }}>
            <Avatar user={user} size={40} />
            <span className={styles.resultBody}>
              <span className={styles.resultTitle}>
                <Highlight text={user.name} query={q} />
              </span>
              {userSubtitle(user) ? <span className={styles.resultSub}>{userSubtitle(user)}</span> : null}
            </span>
          </SocialLink>
        </li>
      ))}
    </ul>
  );
}

function GroupResults({ q, items }: { readonly q: string; readonly items: readonly SocialGroupSummary[] }) {
  return (
    <ul className={styles.results}>
      {items.map((group) => (
        <li key={group.id}>
          <SocialLink className={styles.result} to={{ name: 'group', groupId: group.id }}>
            <span className={styles.groupSwatch} aria-hidden="true">
              {(group.name.trim()[0] ?? '?').toUpperCase()}
            </span>
            <span className={styles.resultBody}>
              <span className={styles.resultTitle}>
                <Highlight text={group.name} query={q} />
              </span>
              <span className={styles.resultSub}>
                {group.privacy === 'private' ? 'Nhóm riêng tư' : 'Nhóm công khai'} · {group.memberCount} thành viên
              </span>
            </span>
          </SocialLink>
        </li>
      ))}
    </ul>
  );
}

/** Tab Nhóm: trang đầu từ `useRemote`, các trang sau nối thêm tại chỗ. */
function GroupsTab({
  q,
  remote,
}: {
  readonly q: string;
  readonly remote: Remote<{ items: readonly SocialGroupSummary[]; nextCursor?: string }> & { reload: () => void };
}) {
  const [extra, setExtra] = useState<{ items: readonly SocialGroupSummary[]; cursor?: string; for: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const first = remote.data;
  const current = extra && extra.for === first ? extra : null;
  const cursor = current ? current.cursor : first?.nextCursor;

  const more = () => {
    if (!cursor || busy) return;
    setBusy(true);
    setError(undefined);
    searchGroups(q, cursor)
      .then((page) =>
        setExtra({
          items: [...(current?.items ?? []), ...page.items],
          cursor: page.nextCursor,
          for: first,
        }),
      )
      .catch((cause: unknown) => setError(errorMessage(cause, 'Không tải thêm được.')))
      .finally(() => setBusy(false));
  };

  return (
    <Block remote={remote} retry={remote.reload} isEmpty={(data) => data.items.length === 0}>
      {(data) => (
        <section className={`${styles.card} ${styles.section}`}>
          <GroupResults q={q} items={[...data.items, ...(current?.items ?? [])]} />
          {cursor ? <MoreButton busy={busy} error={error} onClick={more} /> : null}
        </section>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ bộ lọc */

function FilterBar({
  filters,
  onChange,
  topics,
  groups,
  authors,
}: {
  readonly filters: SearchFilters;
  readonly onChange: (next: SearchFilters) => void;
  readonly topics: readonly SocialTopic[];
  readonly groups: readonly SocialGroupSummary[];
  readonly authors: readonly SocialUserRef[];
}) {
  const topicOptions = topics.map((topic) => ({ value: topic.id, label: topic.name }));
  const groupOptions = groups.map((group) => ({ value: group.id, label: group.name }));
  const authorOptions = authors.map((user) => ({ value: user.id, label: user.name }));
  const dateOptions = DATE_PRESETS.map((item) => ({ value: item.value, label: item.label }));

  return (
    <div className={`${styles.card} ${styles.filters}`} role="group" aria-label="Bộ lọc bài viết">
      <div className={styles.filterField} role="group" aria-label="Chuyên mục">
        <span className={styles.filterLabel}>Chuyên mục</span>
        <SearchableSelect
          options={topicOptions}
          value={filters.topicId}
          placeholder="Tất cả chuyên mục"
          emptyText="Không có chuyên mục"
          height={36}
          clearable
          onChange={(value) => onChange({ ...filters, topicId: value || undefined })}
        />
      </div>
      <div className={styles.filterField} role="group" aria-label="Nhóm">
        <span className={styles.filterLabel}>Nhóm</span>
        <SearchableSelect
          options={groupOptions}
          value={filters.groupId}
          placeholder="Tất cả nhóm"
          emptyText="Bạn chưa tham gia nhóm nào"
          height={36}
          clearable
          onChange={(value) => onChange({ ...filters, groupId: value || undefined })}
        />
      </div>
      <div className={styles.filterField} role="group" aria-label="Tác giả">
        <span className={styles.filterLabel}>Tác giả</span>
        <SearchableSelect
          options={authorOptions}
          value={filters.authorId}
          placeholder="Mọi tác giả"
          emptyText="Chưa có tác giả phù hợp"
          height={36}
          clearable
          onChange={(value) => onChange({ ...filters, authorId: value || undefined })}
        />
      </div>
      <div className={styles.filterField} role="group" aria-label="Thời gian">
        <span className={styles.filterLabel}>Thời gian</span>
        <SearchableSelect
          options={dateOptions}
          value={filters.preset}
          height={36}
          onChange={(value) => onChange({ ...filters, preset: value || 'any' })}
        />
      </div>
      {hasActiveFilters(filters) ? (
        <button type="button" className={styles.filterReset} onClick={() => onChange(EMPTY_FILTERS)}>
          Xoá bộ lọc
        </button>
      ) : null}
    </div>
  );
}
