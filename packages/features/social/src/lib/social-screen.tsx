'use client';

import type { SocialInboxCounts, SocialMe, SocialPost, SocialTopic } from '@enterprise-platform/contracts-social';
import { ModuleShell, type ModuleNavItem } from '@enterprise-platform/feature-module-shell';
import { toast } from '@enterprise-platform/shared-ui';
import { BarChart3, Image as ImageIcon, Megaphone, Newspaper, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BirthdayView } from './components/birthday/birthday-view';
import { ComposerDialog } from './components/composer-dialog';
import { SocialFeed } from './components/feed/social-feed';
import { GroupDetailView } from './components/groups/group-detail-view';
import { GroupsView } from './components/groups/groups-view';
import { SavedView } from './components/library/saved-view';
import { PendingView } from './components/moderation/pending-view';
import { ScheduledView } from './components/moderation/scheduled-view';
import { PostCard } from './components/post-card';
import { ProfileView } from './components/profile/profile-view';
import { SearchView } from './components/search/search-view';
import { LeftRail } from './components/shell/left-rail';
import { QuickBoard } from './components/shell/quick-board';
import { SocialRightSlotContext } from './components/shell/right-slot';
import { SocialTabStrip } from './components/shell/social-nav';
import { SocialTopBar } from './components/shell/social-topbar';
import { TopicDialog } from './components/topic-dialog';
import { Avatar } from './components/ui';
import { errorMessage, loadInboxCounts, loadMe, loadPost, loadTenantHomePath, loadTopics } from './social-api';
import {
  SocialSessionContext,
  type SocialComposerMode,
  type SocialComposerOptions,
  type SocialSavedPost,
  type SocialSession,
} from './social-context';
import {
  tabForRoute,
  visibleTabs,
  type SocialRoute,
} from './social.model';
import { navigateSocial, SocialLink, useSocialRoute } from './social-navigation';
import styles from './social.module.scss';
import shell from './social-shell.module.scss';

type ShellView = 'social';

const NAV: readonly ModuleNavItem<ShellView>[] = [
  { id: 'social', label: 'Mạng nội bộ', icon: <Newspaper size={16} /> },
];

/** Tuyến có cột phải riêng do trang tự dựng (chi tiết nhóm); các tuyến còn lại dùng "bảng nhanh". */
const OWN_RIGHT_ROUTES: ReadonlySet<SocialRoute['name']> = new Set(['group']);

/** Tuyến nào có thanh soạn bài ở đầu cột giữa. */
const COMPOSER_ROUTES: ReadonlySet<SocialRoute['name']> = new Set(['feed', 'wall', 'post']);

type ComposerState = { readonly post?: SocialPost; readonly groupId?: string; readonly mode?: SocialComposerMode } | undefined;

const INFO_MS = 5000;

/**
 * Mạng nội bộ. Điều hướng bằng đường dẫn (xem `parseSocialPath`, tiền tố `/modules/social`):
 * `/`, `/feed/<topicId>`, `/wall[/<topicId>|/announcements]`, `/groups`, `/groups/<id>[/<mục>]`, `/saved`,
 * `/pending`, `/scheduled`, `/profile/<userId>`, `/search?q=...`, `/posts/<id>[/comments/<id>]`, `/birthday`.
 * Liên kết hash cũ (`#posts/<id>`...) được đổi sang đường dẫn khi mở.
 */
export function SocialScreen() {
  const route = useSocialRoute();

  const [homePath, setHomePath] = useState('/');
  const [me, setMe] = useState<SocialMe>();
  const [meError, setMeError] = useState<string>();
  const [topics, setTopics] = useState<readonly SocialTopic[]>([]);
  const [counts, setCounts] = useState<SocialInboxCounts>();
  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    if (tone === 'error') toast.error(message);
    else toast.success(message);
  }, []);
  const [info, setInfo] = useState<string>();
  const [composer, setComposer] = useState<ComposerState>();
  const [saved, setSaved] = useState<SocialSavedPost>();
  const [managing, setManaging] = useState(false);
  /** Tăng khi có bài mới/sửa để bảng nhanh nạp lại thông báo ghim. */
  const [boardKey, setBoardKey] = useState(0);
  const [rightSlot, setRightSlot] = useState<HTMLElement | null>(null);
  const infoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [focused, setFocused] = useState<SocialPost>();
  const [focusError, setFocusError] = useState<string>();
  const focusRef = useRef<HTMLDivElement>(null);
  const linkPostId = route.name === 'post' ? route.postId : undefined;

  useEffect(() => {
    void loadTenantHomePath().then(setHomePath);
    loadMe()
      .then(setMe)
      .catch((cause) => setMeError(errorMessage(cause, 'Không tải được thông tin Mạng nội bộ.')));
    return () => clearTimeout(infoTimer.current);
  }, []);

  useEffect(() => {
    setFocused(undefined);
    setFocusError(undefined);
    if (!me || !linkPostId) return;
    let cancelled = false;
    loadPost(linkPostId)
      .then((post) => {
        if (!cancelled) setFocused(post);
      })
      .catch((cause) => {
        if (!cancelled) setFocusError(errorMessage(cause, 'Không mở được bài viết này. Có thể bài đã bị xoá.'));
      });
    return () => {
      cancelled = true;
    };
  }, [me, linkPostId]);

  useEffect(() => {
    if (focused) focusRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused?.id]);

  const reloadTopics = useCallback(() => {
    loadTopics()
      .then(setTopics)
      .catch(() => undefined);
  }, []);

  const reloadCounts = useCallback(() => {
    loadInboxCounts()
      .then(setCounts)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (me) reloadTopics();
  }, [me, reloadTopics]);

  // Số trên thẻ "Chờ duyệt", "Hẹn giờ" đổi khi đổi tuyến hoặc vừa lưu bài.
  useEffect(() => {
    if (me) reloadCounts();
  }, [me, route.name, saved?.seq, reloadCounts]);

  const showInfo = useCallback((message: string) => {
    setInfo(message);
    clearTimeout(infoTimer.current);
    infoTimer.current = setTimeout(() => setInfo(undefined), INFO_MS);
  }, []);

  const permissions = me?.permissions;
  const canPost = Boolean(permissions?.includes('social.post.write'));
  const canManage = Boolean(permissions?.includes('social.manage'));
  const tabs = useMemo(() => visibleTabs(permissions ?? [], counts), [permissions, counts]);
  const topicId = route.name === 'feed' || route.name === 'wall' ? route.topicId : undefined;
  const currentTopic = topics.find((topic) => topic.id === topicId);

  const openTopic = useCallback(
    (id: string | undefined) => {
      navigateSocial(
        route.name === 'wall'
          ? { name: 'wall', topicId: id, announcementsOnly: false }
          : { name: 'feed', topicId: id },
      );
    },
    [route.name],
  );

  const openComposer = useCallback(
    (post?: SocialPost, options?: SocialComposerOptions) =>
      setComposer({ post, groupId: options?.groupId, mode: options?.mode }),
    [],
  );

  const onSaved = (post: SocialPost) => {
    const edited = Boolean(composer?.post);
    setComposer(undefined);
    setSaved((previous) => ({ seq: (previous?.seq ?? 0) + 1, post, edited }));
    setBoardKey((key) => key + 1);
    reloadTopics();
    if (!edited && post.status === 'pending') showInfo('Bài viết đã được gửi và đang chờ duyệt.');
    if (!edited && post.status === 'scheduled') showInfo('Bài viết đã được hẹn giờ đăng.');
  };

  const session = useMemo<SocialSession | undefined>(
    () => (me ? { me, topics, openComposer, notify, openTopic, saved } : undefined),
    [me, topics, openComposer, openTopic, saved],
  );

  const closeFocus = () => {
    navigateSocial({ name: 'feed' });
  };

  const content = (() => {
    if (!me) return null;
    switch (route.name) {
      case 'groups':
        return <GroupsView />;
      case 'group':
        return <GroupDetailView groupId={route.groupId} />;
      case 'saved':
        return <SavedView />;
      case 'pending':
        return <PendingView />;
      case 'scheduled':
        return <ScheduledView />;
      case 'profile':
        return <ProfileView userId={route.userId} />;
      case 'search':
        return <SearchView query={route.query} />;
      case 'birthday':
        return <BirthdayView />;
      case 'wall':
        return (
          <>
            <nav className={shell.segment} aria-label="Lọc Tường công ty">
              <SocialLink
                to={{ name: 'wall', announcementsOnly: false }}
                aria-current={route.announcementsOnly ? undefined : 'page'}
              >
                Tất cả
              </SocialLink>
              <SocialLink
                to={{ name: 'wall', announcementsOnly: true }}
                aria-current={route.announcementsOnly ? 'page' : undefined}
              >
                Thông báo
              </SocialLink>
            </nav>
            <SocialFeed
              scope={{
                source: 'wall',
                topicId: route.topicId,
                kind: route.announcementsOnly ? 'announcement' : undefined,
              }}
              emptyText={
                currentTopic
                  ? `Chuyên mục "${currentTopic.name}" chưa có bài viết.`
                  : route.announcementsOnly
                    ? 'Chưa có thông báo nào trên Tường công ty.'
                    : 'Chưa có bài viết nào trên Tường công ty.'
              }
            />
          </>
        );
      default:
        return (
          <>
            {route.name === 'post' ? (
              <section className={shell.focused} ref={focusRef} aria-label="Bài viết được liên kết">
                <div className={shell.focusedBar}>
                  <span>Bài viết từ thông báo</span>
                  <button type="button" className={styles.buttonSmall} onClick={closeFocus}>
                    Đóng
                  </button>
                </div>
                {focusError ? (
                  <p role="alert" className={styles.alert}>
                    {focusError}
                  </p>
                ) : focused ? (
                  <PostCard
                    key={focused.id}
                    post={focused}
                    me={me}
                    defaultCommentsOpen
                    isDetailPage
                    focusCommentId={route.commentId}
                    onChange={setFocused}
                    onEdit={(target) => openComposer(target)}
                    onDeleted={() => {
                      setFocused(undefined);
                      setBoardKey((key) => key + 1);
                      closeFocus();
                    }}
                    onOpenTopic={openTopic}
                    onError={(message) => notify(message, 'error')}
                  />
                ) : (
                  <div className={styles.skeleton} aria-busy="true" />
                )}
              </section>
            ) : null}
            <SocialFeed
              scope={{ source: 'all', topicId }}
              excludePostId={focused?.id}
              emptyText={
                currentTopic
                  ? `Chuyên mục "${currentTopic.name}" chưa có bài viết.`
                  : 'Chưa có bài viết nào. Hãy là người đăng bài đầu tiên.'
              }
            />
          </>
        );
    }
  })();

  const ownRight = OWN_RIGHT_ROUTES.has(route.name);
  const showComposer = canPost && me && COMPOSER_ROUTES.has(route.name);

  return (
    <ModuleShell<ShellView>
      moduleKey="social"
      appearance="light"
      title="Mạng nội bộ"
      nav={NAV}
      view="social"
      onViewChange={closeFocus}
      homeHref={homePath}
      hideNavigation
      compact
      hideBreadcrumb
      banner={
        meError ? (
          <p role="alert" className={styles.alert}>
            <span>{meError}</span>
          </p>
        ) : undefined
      }
    >
      {!me || !session ? (
        meError ? null : (
          <p className={styles.muted}>Đang tải…</p>
        )
      ) : (
        <SocialSessionContext.Provider value={session}>
          <div className={shell.page}>
            <SocialTopBar
              me={me}
              homeHref={homePath}
              searchActive={route.name === 'search'}
              searchQuery={route.name === 'search' ? route.query : ''}
            />
            <SocialTabStrip tabs={tabs} activeTab={tabForRoute(route)} />

            {info ? (
              <p role="status" className={shell.info}>
                {info}
              </p>
            ) : null}

            <SocialRightSlotContext.Provider value={rightSlot}>
            <div className={shell.body}>
                <LeftRail
                  me={me}
                  tabs={tabs}
                  activeTab={tabForRoute(route)}
                  refreshKey={boardKey}
                  topicFilter={
                    route.name === 'feed' || route.name === 'wall'
                      ? {
                          topics,
                          activeTopicId: topicId,
                          canManage,
                          onSelect: openTopic,
                          onManage: () => setManaging(true),
                        }
                      : undefined
                  }
                />
              <main className={shell.main}>
                {showComposer ? (
                  <section className={shell.composer} aria-label="Soạn bài viết">
                    <div className={shell.composerTop}>
                      <Avatar user={me.user} size={36} />
                      <button
                        type="button"
                        className={shell.composerTrigger}
                        onClick={() => openComposer()}
                      >
                        <Pencil size={14} aria-hidden="true" /> Bạn đang nghĩ gì? Đăng bài viết mới
                      </button>
                    </div>
                    <div className={shell.composerShortcuts}>
                      <button type="button" onClick={() => openComposer(undefined, { mode: 'media' })}>
                        <ImageIcon size={15} aria-hidden="true" />
                        Ảnh/Video/File
                      </button>
                      <button type="button" onClick={() => openComposer(undefined, { mode: 'poll' })}>
                        <BarChart3 size={15} aria-hidden="true" />
                        Bình chọn
                      </button>
                      {permissions?.includes('social.post.moderate') ? (
                        <button type="button" onClick={() => openComposer(undefined, { mode: 'announcement' })}>
                          <Megaphone size={15} aria-hidden="true" />
                          Thông báo
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {content}
              </main>

              {ownRight ? (
                <div className={shell.rail} ref={setRightSlot} />
              ) : (
                <QuickBoard refreshKey={boardKey} />
              )}
            </div>
            </SocialRightSlotContext.Provider>
          </div>
        </SocialSessionContext.Provider>
      )}

      {me && composer ? (
        <ComposerDialog
          me={me}
          topics={topics}
          editing={composer.post}
          defaultGroupId={composer.groupId}
          defaultMode={composer.mode}
          defaultKind={
            !composer.groupId && route.name === 'wall' && route.announcementsOnly ? 'announcement' : 'post'
          }
          onClose={() => setComposer(undefined)}
          onSaved={onSaved}
        />
      ) : null}
      {managing ? (
        <TopicDialog
          topics={topics}
          onChanged={() => {
            reloadTopics();
          }}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </ModuleShell>
  );
}
