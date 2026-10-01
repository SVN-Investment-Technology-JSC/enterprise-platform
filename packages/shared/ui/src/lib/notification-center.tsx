'use client';

import {
  Bell,
  CheckCheck,
  ChevronRight,
  LoaderCircle,
  Settings2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  BrowserNotificationClient,
  normalizeNotificationPreference,
  type NotificationClient,
  type NotificationListOptions,
  type NotificationPreference,
  type NotificationRecord,
  type NotificationSummary,
  type RealtimeEventEnvelope,
} from './notification-client';
import { toast } from './sonner';
import styles from './notification-center.module.css';

type NotificationFilter = 'all' | 'unread';

interface NotificationState {
  readonly notifications: readonly NotificationRecord[];
  readonly unreadCount: number;
  readonly lastSequence: number;
  readonly preferences: readonly NotificationPreference[];
  readonly nextCursor?: string;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly connected: boolean;
  readonly filter: NotificationFilter;
  readonly error?: string;
}

export interface RealtimeNotificationsValue extends NotificationState {
  readonly drawerOpen: boolean;
  setDrawerOpen(open: boolean): void;
  setFilter(filter: NotificationFilter): Promise<void>;
  loadMore(): Promise<void>;
  markRead(notificationId: string, read: boolean): Promise<void>;
  markAllRead(): Promise<void>;
  updatePreference(preference: NotificationPreference): Promise<void>;
  openNotification(notification: NotificationRecord): Promise<void>;
}

const initialState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  lastSequence: 0,
  preferences: [],
  loading: true,
  loadingMore: false,
  connected: false,
  filter: 'all',
};

const NotificationContext = createContext<RealtimeNotificationsValue | null>(null);

export interface NotificationProviderProps {
  readonly children: ReactNode;
  readonly client?: NotificationClient;
}

export function NotificationProvider({ children, client: suppliedClient }: NotificationProviderProps) {
  const client = useMemo(
    () => suppliedClient ?? new BrowserNotificationClient(),
    [suppliedClient],
  );
  const [state, setReactState] = useState<NotificationState>(initialState);
  const stateRef = useRef<NotificationState>(initialState);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const commit = useCallback((update: (current: NotificationState) => NotificationState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setReactState(next);
  }, []);

  const loadPage = useCallback(
    async (filter: NotificationFilter, cursor?: string) => {
      const options: NotificationListOptions = {
        limit: 30,
        ...(filter === 'unread' ? { unread: true } : {}),
        ...(cursor ? { cursor } : {}),
      };
      return client.list(options);
    },
    [client],
  );

  const hardReload = useCallback(async () => {
    const filter = stateRef.current.filter;
    const [page, summary] = await Promise.all([loadPage(filter), client.summary()]);
    commit((current) => ({
      ...current,
      notifications: page.items,
      nextCursor: page.nextCursor,
      unreadCount: summary.unreadCount,
      lastSequence: summary.lastSequence,
      loading: false,
      error: undefined,
    }));
  }, [client, commit, loadPage]);

  const reconcile = useCallback(async () => {
    const afterSequence = stateRef.current.lastSequence;
    const result = await client.sync(afterSequence);
    if (result.resetRequired) {
      await hardReload();
      return;
    }
    commit((current) => {
      let next = current;
      for (const event of [...result.events].sort((a, b) => a.sequence - b.sequence)) {
        if (event.sequence <= next.lastSequence) continue;
        next = applyRealtimeEvent(next, event);
      }
      return {
        ...next,
        unreadCount: result.summary.unreadCount,
        lastSequence: Math.max(next.lastSequence, result.summary.lastSequence),
        error: undefined,
      };
    });
  }, [client, commit, hardReload]);

  const handleRealtimeEvent = useCallback(
    async (event: RealtimeEventEnvelope) => {
      const current = stateRef.current;
      if (event.sequence <= current.lastSequence) return;
      if (event.sequence > current.lastSequence + 1) {
        await reconcile();
        return;
      }
      const notification = notificationFromEvent(event);
      commit((stateNow) => applyRealtimeEvent(stateNow, event));
      if (event.event === 'notification.summary-updated') {
        try {
          const page = await loadPage(stateRef.current.filter);
          commit((stateNow) => ({
            ...stateNow,
            notifications: page.items,
            nextCursor: page.nextCursor,
            error: undefined,
          }));
        } catch (error) {
          commit((stateNow) => ({ ...stateNow, error: messageOf(error) }));
        }
        return;
      }
      if (notification && shouldToast(notification, stateRef.current.preferences)) {
        toast.info(notification.title, { description: notification.body });
      }
    },
    [commit, loadPage, reconcile],
  );

  useEffect(() => {
    let active = true;
    let connection: ReturnType<NotificationClient['connect']> | undefined;
    let queue = Promise.resolve();
    const enqueue = (job: () => Promise<void>) => {
      queue = queue.then(job, job).catch(() => undefined);
    };

    async function initialize() {
      try {
        const [page, summary, preferences] = await Promise.all([
          loadPage('all'),
          client.summary(),
          client.preferences(),
        ]);
        if (!active) return;
        commit((current) => ({
          ...current,
          notifications: page.items,
          nextCursor: page.nextCursor,
          unreadCount: summary.unreadCount,
          lastSequence: summary.lastSequence,
          preferences,
          loading: false,
          error: undefined,
        }));
        connection = client.connect({
          onConnected: () => {
            if (!active) return;
            commit((current) => ({ ...current, connected: true }));
            enqueue(reconcile);
          },
          onDisconnected: () => {
            if (active) commit((current) => ({ ...current, connected: false }));
          },
          onEvent: (event) => {
            if (active) enqueue(() => handleRealtimeEvent(event));
          },
          onSessionRevoked: () => {
            if (!active) return;
            commit((current) => ({ ...current, connected: false }));
            toast.error('Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.');
          },
        });
      } catch (error) {
        if (!active) return;
        commit((current) => ({
          ...current,
          loading: false,
          error: messageOf(error),
        }));
      }
    }

    void initialize();
    return () => {
      active = false;
      connection?.disconnect();
    };
  }, [client, commit, handleRealtimeEvent, loadPage, reconcile]);

  const setFilter = useCallback(
    async (filter: NotificationFilter) => {
      if (filter === stateRef.current.filter) return;
      commit((current) => ({ ...current, filter, loading: true, error: undefined }));
      try {
        const page = await loadPage(filter);
        commit((current) => ({
          ...current,
          notifications: page.items,
          nextCursor: page.nextCursor,
          loading: false,
        }));
      } catch (error) {
        commit((current) => ({ ...current, loading: false, error: messageOf(error) }));
      }
    },
    [commit, loadPage],
  );

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (!current.nextCursor || current.loadingMore) return;
    commit((value) => ({ ...value, loadingMore: true }));
    try {
      const page = await loadPage(current.filter, current.nextCursor);
      commit((value) => ({
        ...value,
        notifications: mergeNotifications(value.notifications, page.items),
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch (error) {
      commit((value) => ({ ...value, loadingMore: false, error: messageOf(error) }));
    }
  }, [commit, loadPage]);

  const markRead = useCallback(
    async (notificationId: string, read: boolean) => {
      const before = stateRef.current;
      const existing = before.notifications.find((item) => item.id === notificationId);
      if (existing) {
        commit((current) => optimisticRead(current, notificationId, read));
      }
      try {
        const saved = await client.setRead(notificationId, read);
        commit((current) => ({
          ...current,
          notifications: current.notifications.map((item) =>
            item.id === saved.id ? saved : item,
          ),
          lastSequence: Math.max(current.lastSequence, saved.sequence),
        }));
      } catch (error) {
        stateRef.current = before;
        setReactState(before);
        toast.error('Không thể cập nhật trạng thái thông báo.', { description: messageOf(error) });
      }
    },
    [client, commit],
  );

  const markAllRead = useCallback(async () => {
    const before = stateRef.current;
    commit((current) => ({
      ...current,
      unreadCount: 0,
      notifications: current.filter === 'unread'
        ? []
        : current.notifications.map((item) =>
            item.readAt ? item : { ...item, readAt: new Date().toISOString() },
          ),
    }));
    try {
      const summary = await client.readAll();
      commit((current) => ({
        ...current,
        unreadCount: summary.unreadCount,
        lastSequence: Math.max(current.lastSequence, summary.lastSequence),
      }));
    } catch (error) {
      stateRef.current = before;
      setReactState(before);
      toast.error('Không thể đánh dấu tất cả đã đọc.', { description: messageOf(error) });
    }
  }, [client, commit]);

  const updatePreference = useCallback(
    async (requested: NotificationPreference) => {
      const normalized = normalizeNotificationPreference(requested);
      const before = stateRef.current;
      const nextPreferences = replacePreference(before.preferences, normalized);
      commit((current) => ({ ...current, preferences: nextPreferences }));
      try {
        const saved = await client.setPreferences(nextPreferences);
        commit((current) => ({ ...current, preferences: saved }));
      } catch (error) {
        stateRef.current = before;
        setReactState(before);
        toast.error('Không thể lưu tùy chọn thông báo.', { description: messageOf(error) });
      }
    },
    [client, commit],
  );

  const openNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!notification.readAt) await markRead(notification.id, true);
      const target = safeDeepLink(notification.deepLink);
      if (target && typeof window !== 'undefined') window.location.assign(target);
    },
    [markRead],
  );

  const value = useMemo<RealtimeNotificationsValue>(
    () => ({
      ...state,
      drawerOpen,
      setDrawerOpen,
      setFilter,
      loadMore,
      markRead,
      markAllRead,
      updatePreference,
      openNotification,
    }),
    [
      state,
      drawerOpen,
      setFilter,
      loadMore,
      markRead,
      markAllRead,
      updatePreference,
      openNotification,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationDrawer />
    </NotificationContext.Provider>
  );
}

export function useRealtimeNotifications(): RealtimeNotificationsValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useRealtimeNotifications must be used inside NotificationProvider.');
  return context;
}

export function useRealtimeNotificationsOptional(): RealtimeNotificationsValue | null {
  return useContext(NotificationContext);
}

export function NotificationBell({ className = '' }: { readonly className?: string }) {
  const realtime = useRealtimeNotificationsOptional();
  if (!realtime) return null;
  const label = realtime.unreadCount
    ? `Thông báo, ${realtime.unreadCount} chưa đọc`
    : 'Thông báo';
  return (
    <button
      type="button"
      className={`${styles.bell} ${className}`.trim()}
      aria-label={label}
      aria-expanded={realtime.drawerOpen}
      title="Thông báo"
      onClick={() => realtime.setDrawerOpen(true)}
    >
      <Bell aria-hidden="true" size={17} />
      {realtime.unreadCount > 0 ? (
        <span className={styles.badge}>{realtime.unreadCount > 99 ? '99+' : realtime.unreadCount}</span>
      ) : null}
    </button>
  );
}

function NotificationDrawer() {
  const realtime = useRealtimeNotifications();
  const { drawerOpen, setDrawerOpen } = realtime;
  const [showPreferences, setShowPreferences] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;
  return (
    <div className={styles.overlay} onMouseDown={() => setDrawerOpen(false)}>
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <div>
            <div className={styles.titleRow}>
              <h2 id="notification-drawer-title">Thông báo</h2>
              <span className={realtime.connected ? styles.connected : styles.disconnected}>
                {realtime.connected ? <Wifi size={13} /> : <WifiOff size={13} />}
                {realtime.connected ? 'Trực tuyến' : 'Đang kết nối lại'}
              </span>
            </div>
            <p>{realtime.unreadCount} thông báo chưa đọc</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Tùy chọn thông báo"
              aria-pressed={showPreferences}
              onClick={() => setShowPreferences((value) => !value)}
            >
              <Settings2 size={17} />
            </button>
            <button
              ref={closeRef}
              type="button"
              className={styles.iconButton}
              aria-label="Đóng thông báo"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {showPreferences ? (
          <NotificationPreferences />
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.tabs} role="tablist" aria-label="Bộ lọc thông báo">
                <button
                  type="button"
                  role="tab"
                  aria-selected={realtime.filter === 'all'}
                  className={realtime.filter === 'all' ? styles.tabActive : styles.tab}
                  onClick={() => void realtime.setFilter('all')}
                >
                  Tất cả
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={realtime.filter === 'unread'}
                  className={realtime.filter === 'unread' ? styles.tabActive : styles.tab}
                  onClick={() => void realtime.setFilter('unread')}
                >
                  Chưa đọc
                </button>
              </div>
              <button
                type="button"
                className={styles.markAll}
                disabled={realtime.unreadCount === 0}
                onClick={() => void realtime.markAllRead()}
              >
                <CheckCheck size={15} />
                Đánh dấu tất cả đã đọc
              </button>
            </div>
            <NotificationList />
          </>
        )}
      </aside>
    </div>
  );
}

function NotificationList() {
  const realtime = useRealtimeNotifications();
  const { loadMore, nextCursor } = realtime;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nextCursor || typeof IntersectionObserver === 'undefined') return;
    const element = sentinelRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  if (realtime.loading) {
    return <div className={styles.state}><LoaderCircle className={styles.spin} size={18} />Đang tải thông báo…</div>;
  }
  if (realtime.error && realtime.notifications.length === 0) {
    return <div className={styles.state} role="alert">{realtime.error}</div>;
  }
  if (realtime.notifications.length === 0) {
    return <div className={styles.state}>Không có thông báo phù hợp.</div>;
  }
  return (
    <div className={styles.list}>
      {realtime.notifications.map((notification) => (
        <button
          type="button"
          key={notification.id}
          className={`${styles.item} ${notification.readAt ? '' : styles.unreadItem}`.trim()}
          onClick={() => void realtime.openNotification(notification)}
        >
          <span className={`${styles.priority} ${styles[`priority_${notification.priority}`]}`} />
          <span className={styles.itemContent}>
            <span className={styles.itemMeta}>
              <span>{moduleLabel(notification.module)}</span>
              <time dateTime={notification.updatedAt}>{formatRelativeTime(notification.updatedAt)}</time>
            </span>
            <strong>{notification.title}</strong>
            <span className={styles.body}>{notification.body}</span>
            <span className={styles.category}>{notification.category}</span>
          </span>
          {notification.aggregateCount > 1 ? (
            <span className={styles.aggregate}>×{notification.aggregateCount}</span>
          ) : notification.deepLink ? (
            <ChevronRight className={styles.chevron} size={16} />
          ) : null}
        </button>
      ))}
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      {realtime.loadingMore ? (
        <div className={styles.loadingMore}><LoaderCircle className={styles.spin} size={15} />Đang tải thêm…</div>
      ) : null}
      {realtime.nextCursor && typeof IntersectionObserver === 'undefined' ? (
        <button type="button" className={styles.loadMore} onClick={() => void realtime.loadMore()}>
          Tải thêm
        </button>
      ) : null}
    </div>
  );
}

function NotificationPreferences() {
  const realtime = useRealtimeNotifications();
  const preferences = useMemo(
    () => derivePreferences(realtime.preferences, realtime.notifications),
    [realtime.preferences, realtime.notifications],
  );
  return (
    <div className={styles.preferences}>
      <div className={styles.preferencesIntro}>
        <h3>Tùy chọn nhận thông báo</h3>
        <p>Thông báo bắt buộc luôn xuất hiện. Với thông báo hành động, bạn có thể tắt toast nhưng vẫn giữ trong trung tâm thông báo.</p>
      </div>
      {preferences.length === 0 ? (
        <div className={styles.state}>Chưa có nhóm thông báo để cấu hình.</div>
      ) : preferences.map((preference) => {
        const required = preference.priority === 'required';
        const feedLocked = required || preference.priority === 'actionable';
        return (
          <section className={styles.preferenceRow} key={`${preference.module}:${preference.category}`}>
            <div>
              <strong>{preference.category}</strong>
              <span>{moduleLabel(preference.module)} · {priorityLabel(preference.priority)}</span>
            </div>
            <label>
              <input
                type="checkbox"
                checked={preference.feedEnabled}
                disabled={feedLocked}
                onChange={(event) => void realtime.updatePreference({ ...preference, feedEnabled: event.target.checked })}
              />
              Trung tâm
            </label>
            <label>
              <input
                type="checkbox"
                checked={preference.toastEnabled}
                disabled={required}
                onChange={(event) => void realtime.updatePreference({ ...preference, toastEnabled: event.target.checked })}
              />
              Toast
            </label>
          </section>
        );
      })}
    </div>
  );
}

function applyRealtimeEvent(state: NotificationState, event: RealtimeEventEnvelope): NotificationState {
  if (event.sequence <= state.lastSequence) return state;
  const notification = notificationFromEvent(event);
  if (event.event === 'notification.created' || event.event === 'notification.updated') {
    if (!notification) return { ...state, lastSequence: event.sequence };
    const existing = state.notifications.find((item) => item.id === notification.id);
    const unreadDelta = !notification.readAt && (!existing || Boolean(existing.readAt)) ? 1 : 0;
    const readDelta = notification.readAt && existing && !existing.readAt ? -1 : 0;
    const notifications =
      state.filter === 'unread' && notification.readAt
        ? state.notifications.filter((item) => item.id !== notification.id)
        : mergeNotifications([notification], state.notifications);
    return {
      ...state,
      notifications,
      unreadCount: Math.max(0, state.unreadCount + unreadDelta + readDelta),
      lastSequence: event.sequence,
    };
  }
  if (event.event === 'notification.read') {
    const data = eventData(event);
    const notificationId = typeof data.notificationId === 'string' ? data.notificationId : '';
    const read = data.read === true;
    const item = state.notifications.find((candidate) => candidate.id === notificationId);
    const delta = item && Boolean(item.readAt) !== read ? (read ? -1 : 1) : 0;
    const notifications = state.notifications
      .map((candidate) =>
        candidate.id === notificationId
          ? { ...candidate, readAt: read ? String(data.readAt ?? event.occurredAt) : undefined, sequence: event.sequence }
          : candidate,
      )
      .filter((candidate) => !(state.filter === 'unread' && candidate.readAt));
    return {
      ...state,
      notifications,
      unreadCount: Math.max(0, state.unreadCount + delta),
      lastSequence: event.sequence,
    };
  }
  if (event.event === 'notification.summary-updated') {
    const summary = summaryFromEvent(event);
    return {
      ...state,
      notifications: summary?.unreadCount === 0
        ? state.notifications.map((item) => item.readAt ? item : { ...item, readAt: event.occurredAt })
        : state.notifications,
      unreadCount: summary?.unreadCount ?? state.unreadCount,
      lastSequence: event.sequence,
    };
  }
  return { ...state, lastSequence: event.sequence };
}

function optimisticRead(state: NotificationState, id: string, read: boolean): NotificationState {
  const existing = state.notifications.find((item) => item.id === id);
  if (!existing || Boolean(existing.readAt) === read) return state;
  const notifications = state.notifications
    .map((item) =>
      item.id === id ? { ...item, readAt: read ? new Date().toISOString() : undefined } : item,
    )
    .filter((item) => !(state.filter === 'unread' && item.readAt));
  return {
    ...state,
    unreadCount: Math.max(0, state.unreadCount + (read ? -1 : 1)),
    notifications,
  };
}

function mergeNotifications(
  first: readonly NotificationRecord[],
  second: readonly NotificationRecord[],
): readonly NotificationRecord[] {
  const merged = new Map<string, NotificationRecord>();
  for (const item of [...first, ...second]) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  );
}

function notificationFromEvent(event: RealtimeEventEnvelope): NotificationRecord | undefined {
  const data = eventData(event);
  const value = data.notification;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
  return value as unknown as NotificationRecord;
}

function summaryFromEvent(event: RealtimeEventEnvelope): NotificationSummary | undefined {
  const summary = eventData(event).summary;
  if (!isRecord(summary) || !Number.isSafeInteger(summary.unreadCount) || !Number.isSafeInteger(summary.lastSequence)) {
    return undefined;
  }
  return summary as unknown as NotificationSummary;
}

function eventData(event: RealtimeEventEnvelope): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

function replacePreference(
  current: readonly NotificationPreference[],
  next: NotificationPreference,
): readonly NotificationPreference[] {
  const rest = current.filter(
    (item) => item.module !== next.module || item.category !== next.category,
  );
  return [...rest, next].sort((a, b) =>
    `${a.module}:${a.category}`.localeCompare(`${b.module}:${b.category}`),
  );
}

function derivePreferences(
  saved: readonly NotificationPreference[],
  notifications: readonly NotificationRecord[],
): readonly NotificationPreference[] {
  let result = [...saved];
  for (const notification of notifications) {
    if (result.some((item) => item.module === notification.module && item.category === notification.category)) continue;
    result = [
      ...result,
      normalizeNotificationPreference({
        module: notification.module,
        category: notification.category,
        priority: notification.priority,
        feedEnabled: true,
        toastEnabled: true,
      }),
    ];
  }
  return result.sort((a, b) => `${a.module}:${a.category}`.localeCompare(`${b.module}:${b.category}`));
}

function shouldToast(
  notification: NotificationRecord,
  preferences: readonly NotificationPreference[],
): boolean {
  const saved = preferences.find(
    (item) => item.module === notification.module && item.category === notification.category,
  );
  return normalizeNotificationPreference(saved ?? {
    module: notification.module,
    category: notification.category,
    priority: notification.priority,
    feedEnabled: true,
    toastEnabled: true,
  }).toastEnabled;
}

function safeDeepLink(value: string | undefined): string | undefined {
  if (!value || typeof window === 'undefined') return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function moduleLabel(module: NotificationRecord['module']): string {
  return ({
    identity: 'Tài khoản',
    procedure: 'Quy trình',
    workspace: 'Công việc',
    hrm: 'Nhân sự',
    inventory: 'Kho',
    maintenance: 'Bảo trì',
  } as const)[module];
}

function priorityLabel(priority: NotificationRecord['priority']): string {
  return ({ required: 'Bắt buộc', actionable: 'Cần xử lý', informational: 'Thông tin' } as const)[priority];
}

function formatRelativeTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const seconds = Math.round((time - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
