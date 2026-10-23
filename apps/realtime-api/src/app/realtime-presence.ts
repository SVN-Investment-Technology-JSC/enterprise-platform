import { randomUUID } from 'node:crypto';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { PresenceSignal, PresenceSnapshot, RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import type { createClient } from 'redis';

/**
 * Nơi giữ trạng thái trực tuyến dùng chung giữa các replica realtime-api (Valkey). Mỗi socket là một mục có hạn:
 * replica còn sống gia hạn định kỳ; replica chết thì mục của nó tự hết hạn, không cần ai dọn.
 */
export interface PresenceStore {
  /** Thêm socket, trả số socket còn hạn của người đó sau khi thêm. */
  addSocket(tenantId: string, userId: string, socketId: string, expiresAt: number, now: number): Promise<number>;
  /** Bỏ socket, trả số socket còn hạn của người đó sau khi bỏ. */
  removeSocket(tenantId: string, userId: string, socketId: string, now: number): Promise<number>;
  /** Số socket còn hạn của một người. */
  liveSockets(tenantId: string, userId: string, now: number): Promise<number>;
  /** Gia hạn các socket đang mở trên replica này. */
  refresh(entries: readonly PresenceEntry[], expiresAt: number): Promise<void>;
  /** Người dùng không còn socket nào: bỏ khỏi danh sách trực tuyến, ghi lần cuối còn kết nối. */
  markOffline(tenantId: string, userId: string, lastSeenAt: string): Promise<void>;
  snapshot(tenantId: string, now: number): Promise<PresenceSnapshot>;
}

export interface PresenceEntry {
  readonly tenantId: string;
  readonly userId: string;
  readonly socketId: string;
}

type RedisClient = ReturnType<typeof createClient>;

const keys = {
  online: (tenantId: string) => `enterprise:presence:${tenantId}:online`,
  lastSeen: (tenantId: string) => `enterprise:presence:${tenantId}:last-seen`,
  sockets: (tenantId: string, userId: string) => `enterprise:presence:${tenantId}:user:${userId}`,
};

export class RedisPresenceStore implements PresenceStore {
  constructor(
    private readonly redis: RedisClient,
    /** Khoá tự hết hạn nếu không replica nào gia hạn (đề phòng dữ liệu mồ côi). */
    private readonly keyTtlSeconds = 600,
  ) {}

  async addSocket(tenantId: string, userId: string, socketId: string, expiresAt: number, now: number): Promise<number> {
    const socketsKey = keys.sockets(tenantId, userId);
    const replies = await this.redis
      .multi()
      .zRemRangeByScore(socketsKey, '-inf', now)
      .zAdd(socketsKey, { score: expiresAt, value: socketId })
      .zCard(socketsKey)
      .zAdd(keys.online(tenantId), { score: expiresAt, value: userId })
      .expire(socketsKey, this.keyTtlSeconds)
      .expire(keys.online(tenantId), this.keyTtlSeconds)
      .exec();
    return Number(replies[2] ?? 0);
  }

  async removeSocket(tenantId: string, userId: string, socketId: string, now: number): Promise<number> {
    const socketsKey = keys.sockets(tenantId, userId);
    const replies = await this.redis
      .multi()
      .zRem(socketsKey, socketId)
      .zRemRangeByScore(socketsKey, '-inf', now)
      .zCard(socketsKey)
      .exec();
    return Number(replies[2] ?? 0);
  }

  async liveSockets(tenantId: string, userId: string, now: number): Promise<number> {
    return Number(await this.redis.zCount(keys.sockets(tenantId, userId), now, '+inf'));
  }

  async refresh(entries: readonly PresenceEntry[], expiresAt: number): Promise<void> {
    if (entries.length === 0) return;
    const multi = this.redis.multi();
    const tenants = new Set<string>();
    for (const entry of entries) {
      const socketsKey = keys.sockets(entry.tenantId, entry.userId);
      multi.zAdd(socketsKey, { score: expiresAt, value: entry.socketId });
      multi.expire(socketsKey, this.keyTtlSeconds);
      multi.zAdd(keys.online(entry.tenantId), { score: expiresAt, value: entry.userId });
      tenants.add(entry.tenantId);
    }
    for (const tenantId of tenants) multi.expire(keys.online(tenantId), this.keyTtlSeconds);
    await multi.exec();
  }

  async markOffline(tenantId: string, userId: string, lastSeenAt: string): Promise<void> {
    await this.redis
      .multi()
      .zRem(keys.online(tenantId), userId)
      .hSet(keys.lastSeen(tenantId), userId, lastSeenAt)
      .exec();
  }

  async snapshot(tenantId: string, now: number): Promise<PresenceSnapshot> {
    const [online, lastSeen] = await Promise.all([
      this.redis.zRangeByScore(keys.online(tenantId), now, '+inf'),
      this.redis.hGetAll(keys.lastSeen(tenantId)),
    ]);
    const onlineIds = online.map(String);
    const seen: Record<string, string> = {};
    for (const [userId, at] of Object.entries(lastSeen as Record<string, string>)) {
      if (!onlineIds.includes(userId)) seen[userId] = String(at);
    }
    return { online: onlineIds, lastSeen: seen };
  }
}

type Schedule = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
type Repeat = (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;

/**
 * Trạng thái trực tuyến của người dùng doanh nghiệp. Người dùng trực tuyến khi còn ít nhất một socket ở bất kỳ replica
 * nào. Socket cuối đóng thì chờ một khoảng ngắn mới báo ngoại tuyến: chuyển trang giữa các phân hệ (mỗi phân hệ là một
 * ứng dụng web riêng) đóng rồi mở lại socket ngay, không được làm người khác thấy "vừa ngoại tuyến".
 */
export class RealtimePresence {
  private readonly local = new Map<string, PresenceEntry>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  /** Gateway gắn hàm gửi vào phòng của công ty khi khởi tạo (tránh phụ thuộc vòng gateway ↔ presence). */
  private emit: ((tenantId: string, event: RealtimeEventEnvelope) => Promise<void>) | undefined;

  constructor(
    private readonly store: PresenceStore,
    private readonly enabled = true,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 90_000,
    private readonly heartbeatMs = 30_000,
    private readonly offlineGraceMs = 8_000,
    private readonly schedule: Schedule = setTimeout,
    private readonly repeat: Repeat = setInterval,
  ) {}

  attach(emit: (tenantId: string, event: RealtimeEventEnvelope) => Promise<void>): void {
    this.emit = emit;
    this.start();
  }

  start(): void {
    if (!this.enabled || this.heartbeat) return;
    this.heartbeat = this.repeat(() => {
      void this.store.refresh([...this.local.values()], this.now() + this.ttlMs).catch(() => undefined);
    }, this.heartbeatMs);
    (this.heartbeat as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  async connected(principal: TenantUserPrincipal, socketId: string): Promise<void> {
    if (!this.enabled) return;
    const entry: PresenceEntry = { tenantId: principal.tenantId, userId: principal.userId, socketId };
    this.local.set(socketId, entry);
    const now = this.now();
    const live = await this.store.addSocket(entry.tenantId, entry.userId, socketId, now + this.ttlMs, now);
    if (live === 1) await this.announce(entry.tenantId, { userId: entry.userId, online: true, lastSeenAt: null });
  }

  async disconnected(socketId: string): Promise<void> {
    if (!this.enabled) return;
    const entry = this.local.get(socketId);
    if (!entry) return;
    this.local.delete(socketId);
    const live = await this.store.removeSocket(entry.tenantId, entry.userId, socketId, this.now());
    if (live > 0) return;
    const timer = this.schedule(() => {
      void this.settleOffline(entry).catch(() => undefined);
    }, this.offlineGraceMs);
    (timer as { unref?: () => void }).unref?.();
  }

  snapshot(tenantId: string): Promise<PresenceSnapshot> {
    if (!this.enabled) return Promise.resolve({ online: [], lastSeen: {} });
    return this.store.snapshot(tenantId, this.now());
  }

  private async settleOffline(entry: PresenceEntry): Promise<void> {
    if ((await this.store.liveSockets(entry.tenantId, entry.userId, this.now())) > 0) return;
    const lastSeenAt = new Date(this.now()).toISOString();
    await this.store.markOffline(entry.tenantId, entry.userId, lastSeenAt);
    await this.announce(entry.tenantId, { userId: entry.userId, online: false, lastSeenAt });
  }

  private async announce(tenantId: string, signal: PresenceSignal): Promise<void> {
    if (!this.emit) return;
    await this.emit(tenantId, {
      id: randomUUID(),
      event: 'core.presence.changed',
      version: 1,
      tenantId,
      // Sự kiện theo phòng của công ty: `userId` là người vừa đổi trạng thái.
      userId: signal.userId,
      sequence: 1,
      occurredAt: new Date(this.now()).toISOString(),
      data: signal,
    });
  }
}
