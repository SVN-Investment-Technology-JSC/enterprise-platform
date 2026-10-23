import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { PresenceSnapshot, RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { RealtimePresence, type PresenceEntry, type PresenceStore } from './realtime-presence';

/** Kho giả trong bộ nhớ, cùng ngữ nghĩa "mục có hạn" như Valkey. */
class MemoryPresenceStore implements PresenceStore {
  readonly sockets = new Map<string, Map<string, number>>();
  readonly online = new Map<string, number>();
  readonly lastSeen = new Map<string, string>();
  private key(tenantId: string, userId: string) {
    return `${tenantId}:${userId}`;
  }
  private live(tenantId: string, userId: string, now: number) {
    const map = this.sockets.get(this.key(tenantId, userId)) ?? new Map<string, number>();
    for (const [socket, until] of map) if (until <= now) map.delete(socket);
    this.sockets.set(this.key(tenantId, userId), map);
    return map;
  }
  async addSocket(tenantId: string, userId: string, socketId: string, expiresAt: number, now: number) {
    const map = this.live(tenantId, userId, now);
    map.set(socketId, expiresAt);
    this.online.set(this.key(tenantId, userId), expiresAt);
    return map.size;
  }
  async removeSocket(tenantId: string, userId: string, socketId: string, now: number) {
    const map = this.live(tenantId, userId, now);
    map.delete(socketId);
    return map.size;
  }
  async liveSockets(tenantId: string, userId: string, now: number) {
    return this.live(tenantId, userId, now).size;
  }
  async refresh(entries: readonly PresenceEntry[], expiresAt: number) {
    for (const entry of entries) {
      this.sockets.get(this.key(entry.tenantId, entry.userId))?.set(entry.socketId, expiresAt);
      this.online.set(this.key(entry.tenantId, entry.userId), expiresAt);
    }
  }
  async markOffline(tenantId: string, userId: string, lastSeenAt: string) {
    this.online.delete(this.key(tenantId, userId));
    this.lastSeen.set(this.key(tenantId, userId), lastSeenAt);
  }
  async snapshot(tenantId: string, now: number): Promise<PresenceSnapshot> {
    const online = [...this.online.entries()].filter(([key, until]) => key.startsWith(`${tenantId}:`) && until > now).map(([key]) => key.split(':')[1]);
    const lastSeen: Record<string, string> = {};
    for (const [key, at] of this.lastSeen) if (key.startsWith(`${tenantId}:`) && !online.includes(key.split(':')[1])) lastSeen[key.split(':')[1]] = at;
    return { online, lastSeen };
  }
}

function setup() {
  let clock = Date.parse('2026-10-23T08:00:00.000Z');
  const timers: { at: number; run: () => void }[] = [];
  const store = new MemoryPresenceStore();
  const emitted: { tenantId: string; event: RealtimeEventEnvelope }[] = [];
  const presence = new RealtimePresence(
    store,
    true,
    () => clock,
    90_000,
    30_000,
    8_000,
    ((callback: () => void, delay: number) => {
      timers.push({ at: clock + delay, run: callback });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never,
    (() => 0 as unknown as ReturnType<typeof setInterval>) as never,
  );
  presence.attach(async (tenantId, event) => {
    emitted.push({ tenantId, event });
  });
  const advance = async (ms: number) => {
    clock += ms;
    const due = timers.filter((t) => t.at <= clock);
    timers.splice(0, timers.length, ...timers.filter((t) => t.at > clock));
    for (const timer of due) timer.run();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { presence, store, emitted, advance, now: () => clock };
}

const user = (userId: string) => ({ tenantId: 'tenant-a', userId }) as unknown as TenantUserPrincipal;

describe('RealtimePresence', () => {
  it('báo trực tuyến khi người dùng mở socket đầu tiên, không báo lại với tab thứ hai', async () => {
    const { presence, emitted } = setup();
    await presence.connected(user('user-a'), 'socket-1');
    await presence.connected(user('user-a'), 'socket-2');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      tenantId: 'tenant-a',
      event: { event: 'core.presence.changed', userId: 'user-a', data: { userId: 'user-a', online: true, lastSeenAt: null } },
    });
  });

  it('đóng một tab trong hai: vẫn trực tuyến; đóng tab cuối: chờ một lúc rồi mới báo ngoại tuyến', async () => {
    const { presence, emitted, advance } = setup();
    await presence.connected(user('user-a'), 'socket-1');
    await presence.connected(user('user-a'), 'socket-2');
    await presence.disconnected('socket-1');
    await advance(10_000);
    expect(emitted).toHaveLength(1);
    await presence.disconnected('socket-2');
    await advance(5_000);
    expect(emitted).toHaveLength(1);
    await advance(5_000);
    expect(emitted).toHaveLength(2);
    expect(emitted[1].event.data).toMatchObject({ userId: 'user-a', online: false, lastSeenAt: expect.any(String) });
    expect((await presence.snapshot('tenant-a')).lastSeen['user-a']).toBe(emitted[1].event.occurredAt);
  });

  it('chuyển trang giữa các phân hệ (đóng rồi mở lại socket ngay) không làm người khác thấy ngoại tuyến', async () => {
    const { presence, emitted, advance } = setup();
    await presence.connected(user('user-a'), 'socket-1');
    await presence.disconnected('socket-1');
    await advance(1_000);
    await presence.connected(user('user-a'), 'socket-2');
    await advance(10_000);
    expect(emitted.map((e) => (e.event.data as { online: boolean }).online)).toEqual([true, true]);
    expect((await presence.snapshot('tenant-a')).online).toEqual(['user-a']);
  });

  it('ảnh chụp trạng thái chỉ thuộc đúng công ty', async () => {
    const { presence } = setup();
    await presence.connected(user('user-a'), 'socket-1');
    await presence.connected({ tenantId: 'tenant-b', userId: 'user-b' } as unknown as TenantUserPrincipal, 'socket-2');
    expect((await presence.snapshot('tenant-a')).online).toEqual(['user-a']);
    expect((await presence.snapshot('tenant-b')).online).toEqual(['user-b']);
  });

  it('socket của replica đã chết tự hết hạn khi không còn ai gia hạn', async () => {
    const { presence, advance } = setup();
    await presence.connected(user('user-a'), 'socket-1');
    await advance(91_000);
    expect((await presence.snapshot('tenant-a')).online).toEqual([]);
  });
});
