import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { Inject } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { RealtimeAuthClient } from './realtime-runtime';
import { REALTIME_AUTH_CLIENT } from './realtime-tokens';
import { RealtimeMetrics } from './realtime-health';
import { verifiedSocketPrincipal } from './realtime-recovery-security';

export const REALTIME_SOCKET_PATH = '/realtime/socket.io';
export const REALTIME_RECOVERY_MS = 2 * 60_000;
const SOCKET_IO_EVENT_PACKET = 2;
const SOCKET_IO_CLUSTER_BROADCAST = 3;
const SOCKET_IO_CLUSTER_DISCONNECT = 6;

interface ReliableRedisStreamsAdapter {
  readonly uid: string;
  doPublish(message: {
    readonly uid: string;
    readonly nsp: string;
    readonly type: number;
    readonly data: unknown;
  }): Promise<string>;
}

export function userRoom(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

export class RealtimeOriginPolicy {
  private readonly allowed: ReadonlySet<string>;

  constructor(origins: readonly string[]) {
    this.allowed = new Set(
      origins.map((value) => normalizeOrigin(value)).filter((value): value is string => Boolean(value)),
    );
  }

  allows(origin: string | undefined): boolean {
    const normalized = normalizeOrigin(origin);
    return Boolean(normalized && this.allowed.has(normalized));
  }
}

type Schedule = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;

export class RealtimeSessionRevalidator {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly auth: RealtimeAuthClient,
    private readonly schedule: Schedule = setTimeout,
    private readonly random: () => number = Math.random,
    private readonly intervalMs = 60_000,
  ) {}

  watch(client: Socket, cookieHeader: string | undefined, expected: TenantUserPrincipal): void {
    this.unwatch(client);
    const scheduleNext = () => {
      if (!client.connected) return;
      const delay = this.intervalMs * (0.8 + this.random() * 0.4);
      const timer = this.schedule(() => {
        void this.revalidate(client, cookieHeader, expected, scheduleNext);
      }, delay);
      this.timers.set(client.id, timer);
    };
    scheduleNext();
  }

  unwatch(client: Pick<Socket, 'id'>): void {
    const timer = this.timers.get(client.id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(client.id);
  }

  private async revalidate(
    client: Socket,
    cookieHeader: string | undefined,
    expected: TenantUserPrincipal,
    scheduleNext: () => void,
  ): Promise<void> {
    try {
      const current = await this.auth.authenticate(cookieHeader);
      if (!client.connected) { this.unwatch(client); return; }
      if (
        current.sessionId !== expected.sessionId ||
        current.tenantId !== expected.tenantId ||
        current.userId !== expected.userId
      ) {
        client.disconnect(true);
        this.unwatch(client);
        return;
      }
      scheduleNext();
    } catch {
      client.disconnect(true);
      this.unwatch(client);
    }
  }
}

@WebSocketGateway({
  path: REALTIME_SOCKET_PATH,
  transports: ['websocket'],
  serveClient: false,
  connectionStateRecovery: {
    maxDisconnectionDuration: REALTIME_RECOVERY_MS,
    skipMiddlewares: false,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;
  private readonly authenticatedSockets = new Set<string>();

  constructor(
    @Inject(REALTIME_AUTH_CLIENT)
    private readonly auth: RealtimeAuthClient,
    private readonly origins: RealtimeOriginPolicy,
    private readonly revalidator: RealtimeSessionRevalidator,
    private readonly metrics: RealtimeMetrics = new RealtimeMetrics(),
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const origin = headerText(client.handshake.headers.origin);
    if (!this.origins.allows(origin)) {
      this.metrics.authFailed('origin');
      client.disconnect(true);
      return;
    }
    const cookieHeader = headerText(client.handshake.headers.cookie);
    try {
      const principal = verifiedSocketPrincipal(client.request) ?? await this.auth.authenticate(cookieHeader);
      if (!client.connected) return;
      await client.join(userRoom(principal.tenantId, principal.userId));
      await client.join(sessionRoom(principal.sessionId));
      if (!client.connected) return;
      client.data.principal = principal;
      this.authenticatedSockets.add(client.id);
      this.metrics.socketConnected();
      if (client.recovered) this.metrics.reconnected();
      // Per-connection control frames must not inflate the shared recovery log.
      this.server.local.to(client.id).emit('session.ready', {
        sessionId: principal.sessionId,
        tenantId: principal.tenantId,
        userId: principal.userId,
      });
      this.revalidator.watch(client, cookieHeader, principal);
    } catch {
      this.metrics.authFailed('session');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.revalidator.unwatch(client);
    if (this.authenticatedSockets.delete(client.id)) {
      this.metrics.socketDisconnected();
    }
  }

  async emitUserEvent(event: RealtimeEventEnvelope): Promise<void> {
    if (!this.server) throw new Error('Realtime gateway is not ready.');
    const room = userRoom(event.tenantId, event.userId);
    const offset = await this.publishClusterEvent(room, event.event, event);
    this.metrics.deliveryPublished(event.event, event.occurredAt);
    this.server.local.to(room).emit(event.event, event, offset);
  }

  async disconnectSession(
    sessionId: string,
    event: { readonly tenantId: string; readonly userId: string; readonly reason: string },
  ): Promise<void> {
    if (!this.server) throw new Error('Realtime gateway is not ready.');
    const room = sessionRoom(sessionId);
    const payload = {
      sessionId,
      tenantId: event.tenantId,
      userId: event.userId,
      reason: event.reason,
    };
    const offset = await this.publishClusterEvent(room, 'session.revoked', payload);
    await this.publishClusterDisconnect(room);
    this.metrics.sessionRevoked();
    this.server.local.to(room).emit('session.revoked', payload, offset);
    this.server.local.in(room).disconnectSockets(true);
  }

  private adapter(): { readonly namespace: string; readonly adapter: ReliableRedisStreamsAdapter } {
    const namespace = this.server.of('/');
    const adapter = namespace.adapter as unknown as ReliableRedisStreamsAdapter;
    if (!adapter || typeof adapter.uid !== 'string' || typeof adapter.doPublish !== 'function') {
      throw new Error('Redis Streams Socket.IO adapter is not configured.');
    }
    return { namespace: namespace.name, adapter };
  }

  private async publishClusterEvent(
    room: string,
    eventName: string,
    payload: unknown,
  ): Promise<string> {
    const { namespace, adapter } = this.adapter();
    return adapter.doPublish({
      uid: adapter.uid,
      nsp: namespace,
      type: SOCKET_IO_CLUSTER_BROADCAST,
      data: {
        packet: {
          type: SOCKET_IO_EVENT_PACKET,
          nsp: namespace,
          data: [eventName, payload],
        },
        opts: { rooms: [room], except: [], flags: {} },
      },
    });
  }

  private async publishClusterDisconnect(room: string): Promise<void> {
    const { namespace, adapter } = this.adapter();
    await adapter.doPublish({
      uid: adapter.uid,
      nsp: namespace,
      type: SOCKET_IO_CLUSTER_DISCONNECT,
      data: {
        opts: { rooms: [room], except: [], flags: {} },
        close: true,
      },
    });
  }
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function headerText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
