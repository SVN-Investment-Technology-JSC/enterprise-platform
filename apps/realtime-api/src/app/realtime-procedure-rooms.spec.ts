import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { ProcedureTypingSignal } from '@enterprise-platform/contracts-realtime';
import {
  HttpProcedureAccessClient,
  parseProcedureTypingMessage,
  parseRoomMessage,
  procedureRoom,
  RealtimeProcedureRooms,
  type ProcedureAccessClient,
  type RoomSocket,
} from './realtime-procedure-rooms';

const INSTANCE = 'instance-1';
const principal = { tenantId: 'tenant-a', userId: 'user-a', sessionId: 'session-1' } as unknown as TenantUserPrincipal;
const ROOM = procedureRoom('tenant-a', INSTANCE);

function setup(options: { allow?: boolean | Error; enabled?: boolean; maxRooms?: number } = {}) {
  let clock = 1_000_000;
  const calls: string[] = [];
  const access: ProcedureAccessClient = {
    canJoin: jest.fn(async (_cookie, instanceId) => {
      calls.push(instanceId);
      if (options.allow instanceof Error) throw options.allow;
      return options.allow ?? true;
    }),
  };
  const rooms = new RealtimeProcedureRooms(access, options.enabled ?? true, () => clock, 60_000, 15_000, options.maxRooms ?? 10);
  const socket = (id = 'socket-1', connected = true): RoomSocket & { join: jest.Mock; leave: jest.Mock } => ({
    id,
    connected,
    join: jest.fn(async () => undefined),
    leave: jest.fn(async () => undefined),
  });
  const emitted: { room: string; signal: ProcedureTypingSignal }[] = [];
  const emit = async (room: string, signal: ProcedureTypingSignal) => {
    emitted.push({ room, signal });
  };
  return { rooms, access, calls, socket, emitted, emit, advance: (ms: number) => (clock += ms) };
}

describe('procedureRoom / parsers', () => {
  it('the room name carries the tenant so tenants can never share a room', () => {
    expect(procedureRoom('t1', 'i')).not.toBe(procedureRoom('t2', 'i'));
    expect(procedureRoom('t1', 'i')).toBe('tenant:t1:procedure:i');
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no id', {}],
    ['id with a space', { instanceId: 'a b' }],
    ['id with injection characters', { instanceId: "x'; DROP" }],
    ['id with a room separator', { instanceId: 'a:b' }],
    ['id that is too long', { instanceId: 'a'.repeat(101) }],
    ['a non-string id', { instanceId: 42 }],
  ])('parseRoomMessage rejects %s', (_label, value) => {
    expect(parseRoomMessage(value)).toBeUndefined();
  });

  it('accepts uuid-like ids and requires a boolean for typing', () => {
    expect(parseRoomMessage({ instanceId: '26b47afc-6d35-4809-b36a-28db731a1c5c' })).toBeDefined();
    expect(parseProcedureTypingMessage({ instanceId: INSTANCE, typing: true })).toEqual({ instanceId: INSTANCE, typing: true });
    expect(parseProcedureTypingMessage({ instanceId: INSTANCE, typing: 'yes' })).toBeUndefined();
    expect(parseProcedureTypingMessage({ typing: true })).toBeUndefined();
  });
});

describe('RealtimeProcedureRooms.subscribe', () => {
  it('joins the room of the instance once procedure-api allows it', async () => {
    const { rooms, socket } = setup();
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'ep_access=t', { instanceId: INSTANCE })).resolves.toBe(true);
    expect(s.join).toHaveBeenCalledWith(ROOM);
  });

  it('does NOT join when the user is not a participant', async () => {
    const { rooms, socket } = setup({ allow: false });
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'ep_access=t', { instanceId: INSTANCE })).resolves.toBe(false);
    expect(s.join).not.toHaveBeenCalled();
  });

  it('asks procedure-api only once for the same user and instance while the answer is cached', async () => {
    const { rooms, socket, calls, advance } = setup();
    await rooms.subscribe(principal, socket('s1'), 'ep_access=t', { instanceId: INSTANCE });
    await rooms.subscribe(principal, socket('s2'), 'ep_access=t', { instanceId: INSTANCE });
    advance(30_000);
    await rooms.subscribe(principal, socket('s3'), 'ep_access=t', { instanceId: INSTANCE });
    expect(calls).toHaveLength(1);
  });

  it('asks again after the cache expires', async () => {
    const { rooms, socket, calls, advance } = setup();
    await rooms.subscribe(principal, socket('s1'), 'ep_access=t', { instanceId: INSTANCE });
    advance(61_000);
    await rooms.subscribe(principal, socket('s2'), 'ep_access=t', { instanceId: INSTANCE });
    expect(calls).toHaveLength(2);
  });

  it('remembers a refusal only briefly so a user who was just added gets in soon', async () => {
    const { rooms, socket, calls, advance } = setup({ allow: false });
    await rooms.subscribe(principal, socket('s1'), 'ep_access=t', { instanceId: INSTANCE });
    advance(5_000);
    await rooms.subscribe(principal, socket('s2'), 'ep_access=t', { instanceId: INSTANCE });
    expect(calls).toHaveLength(1);
    advance(11_000);
    await rooms.subscribe(principal, socket('s3'), 'ep_access=t', { instanceId: INSTANCE });
    expect(calls).toHaveLength(2);
  });

  it('treats an error from procedure-api as "not allowed" and does not hammer it', async () => {
    const { rooms, socket, calls } = setup({ allow: new Error('procedure-api down') });
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'ep_access=t', { instanceId: INSTANCE })).resolves.toBe(false);
    await rooms.subscribe(principal, socket('s2'), 'ep_access=t', { instanceId: INSTANCE });
    expect(s.join).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('shares one in-flight check between concurrent subscribes', async () => {
    const { rooms, socket, access } = setup();
    await Promise.all([
      rooms.subscribe(principal, socket('s1'), 'ep_access=t', { instanceId: INSTANCE }),
      rooms.subscribe(principal, socket('s2'), 'ep_access=t', { instanceId: INSTANCE }),
    ]);
    expect(access.canJoin).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for a socket that is already in the room', async () => {
    const { rooms, socket, calls } = setup();
    const s = socket();
    await rooms.subscribe(principal, s, 'ep_access=t', { instanceId: INSTANCE });
    await expect(rooms.subscribe(principal, s, 'ep_access=t', { instanceId: INSTANCE })).resolves.toBe(true);
    expect(s.join).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('caps the rooms a single socket can hold', async () => {
    const { rooms, socket } = setup({ maxRooms: 2 });
    const s = socket();
    await expect(rooms.subscribe(principal, s, 'c', { instanceId: 'i1' })).resolves.toBe(true);
    await expect(rooms.subscribe(principal, s, 'c', { instanceId: 'i2' })).resolves.toBe(true);
    await expect(rooms.subscribe(principal, s, 'c', { instanceId: 'i3' })).resolves.toBe(false);
    expect(s.join).toHaveBeenCalledTimes(2);
  });

  it('does not join, and leaves no state, when the socket closed while access was being checked', async () => {
    const { rooms, socket } = setup();
    const closed = socket('gone', false);
    await expect(rooms.subscribe(principal, closed, 'c', { instanceId: INSTANCE })).resolves.toBe(false);
    expect(closed.join).not.toHaveBeenCalled();
    // Không có trạng thái rác: gõ thử từ socket đó không đi đâu cả.
    const { emitted, emit } = setup();
    await rooms.typing(principal, 'gone', { instanceId: INSTANCE, typing: true }, emit);
    expect(emitted).toEqual([]);
  });

  it('does nothing when disabled or when the message is malformed', async () => {
    const off = setup({ enabled: false });
    await expect(off.rooms.subscribe(principal, off.socket(), 'c', { instanceId: INSTANCE })).resolves.toBe(false);
    expect(off.access.canJoin).not.toHaveBeenCalled();

    const on = setup();
    await expect(on.rooms.subscribe(principal, on.socket(), 'c', { instanceId: 'a b' })).resolves.toBe(false);
    expect(on.access.canJoin).not.toHaveBeenCalled();
  });
});

describe('RealtimeProcedureRooms.unsubscribe / forget', () => {
  it('leaves the room and forgets it', async () => {
    const { rooms, socket } = setup();
    const s = socket();
    await rooms.subscribe(principal, s, 'c', { instanceId: INSTANCE });
    await rooms.unsubscribe(principal, s, { instanceId: INSTANCE });
    expect(s.leave).toHaveBeenCalledWith(ROOM);
    // Vào lại được (không bị coi là đã ở trong phòng).
    await rooms.subscribe(principal, s, 'c', { instanceId: INSTANCE });
    expect(s.join).toHaveBeenCalledTimes(2);
  });

  it('ignores leaving a room the socket never joined', async () => {
    const { rooms, socket } = setup();
    const s = socket();
    await rooms.unsubscribe(principal, s, { instanceId: INSTANCE });
    expect(s.leave).not.toHaveBeenCalled();
  });
});

describe('RealtimeProcedureRooms.typing', () => {
  it('only a socket that joined the room can send typing, and the typist comes from the session', async () => {
    const { rooms, socket, emitted, emit } = setup();
    await rooms.typing(principal, 'socket-1', { instanceId: INSTANCE, typing: true }, emit);
    expect(emitted).toEqual([]);

    await rooms.subscribe(principal, socket('socket-1'), 'c', { instanceId: INSTANCE });
    await rooms.typing(principal, 'socket-1', { instanceId: INSTANCE, typing: true, userId: 'forged' }, emit);
    expect(emitted).toEqual([
      { room: ROOM, signal: { instanceId: INSTANCE, userId: 'user-a', typing: true } },
    ]);
  });

  it('a socket cannot type into a room it did not join, even for an instance it knows', async () => {
    const { rooms, socket, emitted, emit } = setup();
    await rooms.subscribe(principal, socket('socket-1'), 'c', { instanceId: 'other' });
    await rooms.typing(principal, 'socket-1', { instanceId: INSTANCE, typing: true }, emit);
    expect(emitted).toEqual([]);
  });

  it('drops a repeated signal faster than the minimum interval but always lets "stopped" through', async () => {
    const { rooms, socket, emitted, emit, advance } = setup();
    await rooms.subscribe(principal, socket('socket-1'), 'c', { instanceId: INSTANCE });
    const send = (typing: boolean) => rooms.typing(principal, 'socket-1', { instanceId: INSTANCE, typing }, emit);
    await send(true);
    advance(200);
    await send(true);
    expect(emitted).toHaveLength(1);
    advance(50);
    await send(false);
    expect(emitted.map((item) => item.signal.typing)).toEqual([true, false]);
    advance(900);
    await send(false);
    expect(emitted).toHaveLength(3);
  });

  it('forgetting a socket drops its rooms, so it cannot type afterwards', async () => {
    const { rooms, socket, emitted, emit } = setup();
    await rooms.subscribe(principal, socket('socket-1'), 'c', { instanceId: INSTANCE });
    rooms.forget('socket-1');
    await rooms.typing(principal, 'socket-1', { instanceId: INSTANCE, typing: true }, emit);
    expect(emitted).toEqual([]);
  });
});

describe('HttpProcedureAccessClient', () => {
  const reply = (status: number) => ({ ok: status >= 200 && status < 300, status });

  it('calls the chat-access endpoint with only the access cookie', async () => {
    const fetcher = jest.fn(async () => reply(200));
    const client = new HttpProcedureAccessClient('http://procedure-api:3334/', fetcher);
    await expect(client.canJoin('ep_access=abc; ep_refresh=SECRET; ep_csrf=x', INSTANCE)).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://procedure-api:3334/api/procedure/v1/instances/instance-1/chat-access');
    expect(init.headers).toEqual({ cookie: 'ep_access=abc' });
    expect(JSON.stringify(init)).not.toContain('SECRET');
  });

  it('answers false without calling the network when there is no access cookie', async () => {
    const fetcher = jest.fn();
    const client = new HttpProcedureAccessClient('http://x', fetcher as never);
    await expect(client.canJoin('ep_refresh=only', INSTANCE)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('a %s means "not allowed"', async (status) => {
    const client = new HttpProcedureAccessClient('http://x', async () => reply(status));
    await expect(client.canJoin('ep_access=a', INSTANCE)).resolves.toBe(false);
  });

  it('throws on a server error so the caller can remember it only briefly', async () => {
    const client = new HttpProcedureAccessClient('http://x', async () => reply(500));
    await expect(client.canJoin('ep_access=a', INSTANCE)).rejects.toThrow('500');
  });

  it('encodes the instance id in the URL', async () => {
    const fetcher = jest.fn(async () => reply(200));
    const client = new HttpProcedureAccessClient('http://x', fetcher);
    await client.canJoin('ep_access=a', 'a/b');
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toContain('/instances/a%2Fb/chat-access');
  });
});
