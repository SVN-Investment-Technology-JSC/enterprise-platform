import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import {
  HttpTypingRecipientsClient,
  parseTypingMessage,
  RealtimeChatTyping,
  type TypingRecipientsClient,
} from './realtime-chat-typing';

const ENTITY = '11111111-1111-4111-8111-111111111111';
const principal = {
  tenantId: 'tenant-a',
  userId: 'user-typist',
  sessionId: 'session-1',
} as unknown as TenantUserPrincipal;
const message = { entityType: 'work_item', entityId: ENTITY, typing: true };

function setup(options: { recipients?: string[]; failing?: boolean; enabled?: boolean } = {}) {
  let clock = 1_000_000;
  const calls: string[] = [];
  const client: TypingRecipientsClient = {
    recipients: jest.fn(async (_cookie, entityType, entityId) => {
      calls.push(`${entityType}:${entityId}`);
      if (options.failing) throw new Error('workspace-api down');
      return options.recipients ?? ['user-a', 'user-b'];
    }),
  };
  const typing = new RealtimeChatTyping(client, options.enabled ?? true, () => clock);
  const emitted: RealtimeEventEnvelope[] = [];
  const emit = async (event: RealtimeEventEnvelope) => {
    emitted.push(event);
  };
  const send = (raw: unknown, socketId = 'socket-1') =>
    typing.handle(principal, socketId, 'ep_access=token', raw, emit);
  return { typing, client, calls, emitted, send, advance: (ms: number) => (clock += ms) };
}

describe('parseTypingMessage', () => {
  it('accepts a well-formed message', () => {
    expect(parseTypingMessage(message)).toEqual(message);
  });

  it.each([
    ['null', null],
    ['not an object', 'typing'],
    ['unknown entity type', { ...message, entityType: 'document' }],
    ['entity id that is not a uuid', { ...message, entityId: "x'; DROP" }],
    ['typing that is not a boolean', { ...message, typing: 'yes' }],
    ['missing fields', {}],
  ])('ignores %s', (_label, value) => {
    expect(parseTypingMessage(value)).toBeUndefined();
  });
});

describe('RealtimeChatTyping', () => {
  it('emits an id-only envelope to each recipient and never to the typist', async () => {
    const { send, emitted } = setup({ recipients: ['user-a', 'user-b', 'user-typist', 'user-a'] });
    await send(message);

    expect(emitted.map((event) => event.userId).sort()).toEqual(['user-a', 'user-b']);
    expect(emitted[0]).toMatchObject({
      event: 'workspace.chat.typing',
      version: 1,
      tenantId: 'tenant-a',
      sequence: 1,
      data: { entityType: 'work_item', entityId: ENTITY, userId: 'user-typist', typing: true },
    });
  });

  it('takes the typist from the session, never from the client payload', async () => {
    const { send, emitted } = setup();
    await send({ ...message, userId: 'someone-else', tenantId: 'tenant-b' });
    for (const event of emitted) {
      expect(event.tenantId).toBe('tenant-a');
      expect((event.data as { userId: string }).userId).toBe('user-typist');
    }
  });

  it('asks workspace-api once and reuses the answer while typing continues', async () => {
    const { send, calls, advance } = setup();
    await send(message);
    advance(3_000);
    await send(message);
    advance(3_000);
    await send(message);
    expect(calls).toHaveLength(1);
  });

  it('asks again after the cache expires', async () => {
    const { send, calls, advance } = setup();
    await send(message);
    advance(61_000);
    await send(message);
    expect(calls).toHaveLength(2);
  });

  it('shares one in-flight lookup between concurrent events', async () => {
    const { typing, client, emitted } = setup();
    const emit = async (event: RealtimeEventEnvelope) => {
      emitted.push(event);
    };
    await Promise.all([
      typing.handle(principal, 's1', 'ep_access=t', message, emit),
      typing.handle(principal, 's2', 'ep_access=t', message, emit),
    ]);
    expect(client.recipients).toHaveBeenCalledTimes(1);
  });

  it('drops a repeated signal that arrives faster than the minimum interval', async () => {
    const { send, emitted, advance } = setup({ recipients: ['user-a'] });
    await send(message);
    advance(200);
    await send(message);
    expect(emitted).toHaveLength(1);
    advance(700);
    await send(message);
    expect(emitted).toHaveLength(2);
  });

  it('lets "stopped typing" through immediately so the label disappears when the message is sent', async () => {
    const { send, emitted, advance } = setup({ recipients: ['user-a'] });
    await send(message);
    advance(50);
    await send({ ...message, typing: false });
    expect(emitted.map((event) => (event.data as { typing: boolean }).typing)).toEqual([true, false]);
  });

  it('throttles each socket separately', async () => {
    const { send, emitted } = setup({ recipients: ['user-a'] });
    await send(message, 'socket-1');
    await send(message, 'socket-2');
    expect(emitted).toHaveLength(2);
  });

  it('forgetting a socket resets its throttle', async () => {
    const { typing, send, emitted } = setup({ recipients: ['user-a'] });
    await send(message, 'socket-1');
    typing.forget('socket-1');
    await send(message, 'socket-1');
    expect(emitted).toHaveLength(2);
  });

  it('emits nothing when workspace-api fails, and does not retry on every keystroke', async () => {
    const { send, emitted, calls, advance } = setup({ failing: true });
    await send(message);
    advance(1_000);
    await send(message);
    expect(emitted).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('retries after the short failure window so a blip does not silence the whole session', async () => {
    const { send, calls, advance } = setup({ failing: true });
    await send(message);
    advance(16_000);
    await send(message);
    expect(calls).toHaveLength(2);
  });

  it('emits nothing when the user has no recipients (forbidden or alone in the project)', async () => {
    const { send, emitted } = setup({ recipients: [] });
    await send(message);
    expect(emitted).toEqual([]);
  });

  it('does nothing when disabled or when the payload is malformed', async () => {
    const off = setup({ enabled: false });
    await off.send(message);
    expect(off.client.recipients).not.toHaveBeenCalled();

    const bad = setup();
    await bad.send({ entityType: 'project', entityId: 'nope', typing: true });
    expect(bad.client.recipients).not.toHaveBeenCalled();
  });
});

describe('HttpTypingRecipientsClient', () => {
  const ok = (userIds: unknown) => ({ ok: true, json: async () => ({ userIds }) });

  it('calls the workspace recipients endpoint with only the access cookie', async () => {
    const fetcher = jest.fn(async () => ok(['user-a', 'user-b']));
    const client = new HttpTypingRecipientsClient('http://workspace-api:3337/', fetcher);
    const result = await client.recipients(
      'ep_access=abc; ep_refresh=SECRET; ep_csrf=xyz',
      'work_item',
      ENTITY,
    );

    expect(result).toEqual(['user-a', 'user-b']);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(
      `http://workspace-api:3337/api/workspace/v1/chat-typing/recipients?entityType=work_item&entityId=${ENTITY}`,
    );
    expect(init.headers).toEqual({ cookie: 'ep_access=abc' });
    expect(JSON.stringify(init)).not.toContain('SECRET');
  });

  it('returns nothing without an access cookie, without calling the network', async () => {
    const fetcher = jest.fn();
    const client = new HttpTypingRecipientsClient('http://x', fetcher as never);
    expect(await client.recipients('ep_refresh=only', 'project', ENTITY)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns nothing on 403 and ignores a malformed body', async () => {
    const forbidden = new HttpTypingRecipientsClient('http://x', async () => ({
      ok: false,
      json: async () => ({}),
    }));
    expect(await forbidden.recipients('ep_access=a', 'project', ENTITY)).toEqual([]);

    const odd = new HttpTypingRecipientsClient('http://x', async () => ok([1, null, '', 'user-a']));
    expect(await odd.recipients('ep_access=a', 'project', ENTITY)).toEqual(['user-a']);

    const garbage = new HttpTypingRecipientsClient('http://x', async () => ok('not-an-array'));
    expect(await garbage.recipients('ep_access=a', 'project', ENTITY)).toEqual([]);
  });
});
