import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { socialGroupRoom } from '@enterprise-platform/contracts-realtime';
import type { RoomSocket } from './realtime-procedure-rooms';
import {
  HttpSocialGroupAccessClient,
  parseSocialRoomMessage,
  RealtimeSocialRooms,
  type SocialGroupAccessClient,
} from './realtime-social-rooms';

const principal = { tenantId: 'tenant-a', userId: 'user-a', sessionId: 'session-1' } as unknown as TenantUserPrincipal;
const ROOM = socialGroupRoom('tenant-a', 'group-1');

function setup(options: { allow?: boolean | Error; enabled?: boolean; maxRooms?: number } = {}) {
  let clock = 1_000_000;
  const access: SocialGroupAccessClient = {
    canJoin: jest.fn(async () => {
      if (options.allow instanceof Error) throw options.allow;
      return options.allow ?? true;
    }),
  };
  const rooms = new RealtimeSocialRooms(access, options.enabled ?? true, () => clock, 30_000, 10_000, options.maxRooms ?? 10);
  const socket = (id = 'socket-1', connected = true): RoomSocket & { join: jest.Mock; leave: jest.Mock } => ({
    id,
    connected,
    join: jest.fn(async () => undefined),
    leave: jest.fn(async () => undefined),
  });
  return { rooms, access, socket, advance: (ms: number) => (clock += ms) };
}

describe('parseSocialRoomMessage', () => {
  it.each([null, 'x', {}, { groupId: 'a b' }, { groupId: 'a:b' }, { groupId: 7 }, { groupId: 'a'.repeat(101) }])(
    'rejects %p',
    (value) => expect(parseSocialRoomMessage(value)).toBeUndefined(),
  );
  it('accepts a uuid', () => {
    expect(parseSocialRoomMessage({ groupId: '3f2b8c1e-0000-4000-8000-000000000001' })).toEqual({
      groupId: '3f2b8c1e-0000-4000-8000-000000000001',
    });
  });
});

describe('RealtimeSocialRooms', () => {
  it('joins the tenant-scoped group room when social-api allows', async () => {
    const { rooms, socket, access } = setup();
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'ep_access=x', { groupId: 'group-1' })).resolves.toBe(true);
    expect(s.join).toHaveBeenCalledWith(ROOM);
    expect(access.canJoin).toHaveBeenCalledWith('ep_access=x', 'group-1');
  });

  it('denies and does not join when the user is not a member', async () => {
    const { rooms, socket } = setup({ allow: false });
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'c', { groupId: 'group-1' })).resolves.toBe(false);
    expect(s.join).not.toHaveBeenCalled();
  });

  it('treats an access error as a short-lived denial', async () => {
    const { rooms, socket, access, advance } = setup({ allow: new Error('down') });
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'c', { groupId: 'group-1' })).resolves.toBe(false);
    await rooms.subscribe(principal, s, 'c', { groupId: 'group-1' });
    expect(access.canJoin).toHaveBeenCalledTimes(1);
    advance(11_000);
    await rooms.subscribe(principal, s, 'c', { groupId: 'group-1' });
    expect(access.canJoin).toHaveBeenCalledTimes(2);
  });

  it('is idempotent, caches the answer and leaves on unsubscribe', async () => {
    const { rooms, socket, access } = setup();
    const s = socket();
    await rooms.subscribe(principal, s, 'c', { groupId: 'group-1' });
    await expect(rooms.subscribe(principal, s, 'c', { groupId: 'group-1' })).resolves.toBe(true);
    expect(s.join).toHaveBeenCalledTimes(1);
    await rooms.unsubscribe(principal, s, { groupId: 'group-1' });
    expect(s.leave).toHaveBeenCalledWith(ROOM);
    await rooms.subscribe(principal, s, 'c', { groupId: 'group-1' });
    expect(access.canJoin).toHaveBeenCalledTimes(1);
    expect(s.join).toHaveBeenCalledTimes(2);
  });

  it('ignores unsubscribe for a room that was never joined', async () => {
    const { rooms, socket } = setup();
    const s = socket();
    await rooms.unsubscribe(principal, s, { groupId: 'group-1' });
    expect(s.leave).not.toHaveBeenCalled();
  });

  it('limits rooms per socket', async () => {
    const { rooms, socket } = setup({ maxRooms: 2 });
    const s = socket();
    expect(await rooms.subscribe(principal, s, 'c', { groupId: 'g1' })).toBe(true);
    expect(await rooms.subscribe(principal, s, 'c', { groupId: 'g2' })).toBe(true);
    expect(await rooms.subscribe(principal, s, 'c', { groupId: 'g3' })).toBe(false);
    expect(s.join).toHaveBeenCalledTimes(2);
  });

  it('does not exceed the limit with concurrent requests', async () => {
    const { rooms, socket } = setup({ maxRooms: 1 });
    const s = socket();
    const results = await Promise.all([
      rooms.subscribe(principal, s, 'c', { groupId: 'g1' }),
      rooms.subscribe(principal, s, 'c', { groupId: 'g2' }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('does not join a socket that closed while access was checked', async () => {
    const { rooms, socket } = setup();
    const s = socket('socket-1', false);
    await expect(rooms.subscribe(principal, s, 'c', { groupId: 'group-1' })).resolves.toBe(false);
    expect(s.join).not.toHaveBeenCalled();
  });

  it('refuses invalid payloads and a disabled feature without calling social-api', async () => {
    const off = setup({ enabled: false });
    expect(await off.rooms.subscribe(principal, off.socket(), 'c', { groupId: 'group-1' })).toBe(false);
    const on = setup();
    expect(await on.rooms.subscribe(principal, on.socket(), 'c', { groupId: 'a:b' })).toBe(false);
    expect(off.access.canJoin).not.toHaveBeenCalled();
    expect(on.access.canJoin).not.toHaveBeenCalled();
  });

  it('forget drops the socket state so it can join again later', async () => {
    const { rooms, socket } = setup({ maxRooms: 1 });
    const s = socket();
    await rooms.subscribe(principal, s, 'c', { groupId: 'g1' });
    rooms.forget(s.id);
    expect(await rooms.subscribe(principal, s, 'c', { groupId: 'g2' })).toBe(true);
  });
});

describe('HttpSocialGroupAccessClient', () => {
  const client = (status: number) => {
    const fetcher = jest.fn<ReturnType<ConstructorParameters<typeof HttpSocialGroupAccessClient>[1] & {}>, Parameters<ConstructorParameters<typeof HttpSocialGroupAccessClient>[1] & {}>>(async () => ({ ok: status >= 200 && status < 300, status }));
    return { fetcher, access: new HttpSocialGroupAccessClient('http://social:3343/', fetcher) };
  };

  it('calls the access route with only the access cookie', async () => {
    const { fetcher, access } = client(204);
    await expect(access.canJoin('a=1; ep_access=tok; b=2', 'g 1')).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      'http://social:3343/api/social/v1/realtime/groups/g%201/access',
      expect.objectContaining({ headers: { cookie: 'ep_access=tok' } }),
    );
  });

  it('returns false without a cookie and for 404', async () => {
    const { fetcher, access } = client(404);
    await expect(access.canJoin(undefined, 'g')).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(access.canJoin('ep_access=t', 'g')).resolves.toBe(false);
  });

  it('throws on unexpected statuses', async () => {
    await expect(client(500).access.canJoin('ep_access=t', 'g')).rejects.toThrow('500');
  });
});
