import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { randomUUID } from 'node:crypto';
import { Inject, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RealtimeChatTyping } from './realtime-chat-typing';
import { RealtimeProcedureRooms } from './realtime-procedure-rooms';
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

/** Mọi phiên của một công ty; chỉ dùng cho tín hiệu không mang dữ liệu riêng của ai. */
export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
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
    @Optional() private readonly typing?: RealtimeChatTyping,
    @Optional() private readonly rooms?: RealtimeProcedureRooms,
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
      await client.join(tenantRoom(principal.tenantId));
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

  /**
   * Client báo "tôi đang gõ / ngừng gõ" ở một node chat.
   *
   * Chỉ socket đã xác thực mới được gửi; người gõ lấy từ phiên chứ không từ nội
   * dung tin. Đây là tín hiệu tạm nên mọi lỗi đều bị nuốt: mất một lần "đang gõ"
   * không được làm hỏng kết nối hay chặn các tin chat thật.
   */
  @SubscribeMessage('chat.typing')
  async handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const principal = client.data.principal as TenantUserPrincipal | undefined;
    if (!principal || !this.typing || !this.authenticatedSockets.has(client.id)) return;
    try {
      await this.typing.handle(
        principal,
        client.id,
        headerText(client.handshake.headers.cookie),
        body,
        (event) => this.emitUserEvent(event),
      );
    } catch {
      // Best-effort.
    }
  }

  /**
   * Xin vào phòng của một hồ sơ quy trình (khi người dùng mở hồ sơ).
   *
   * Chỉ socket đã xác thực; mỗi lần đều được procedure-api kiểm quyền bằng cookie của chính người đó. Trả về
   * `{ ok }` làm xác nhận (acknowledgement) để client biết đã vào phòng; mọi lỗi đều thành `ok: false`.
   */
  @SubscribeMessage('procedure.subscribe')
  async handleProcedureSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const principal = client.data.principal as TenantUserPrincipal | undefined;
    if (!principal || !this.rooms || !this.authenticatedSockets.has(client.id)) return { ok: false };
    try {
      const ok = await this.rooms.subscribe(
        principal,
        client,
        headerText(client.handshake.headers.cookie),
        body,
      );
      this.metrics.procedureJoin(ok ? 'joined' : 'denied');
      return { ok };
    } catch {
      this.metrics.procedureJoin('error');
      return { ok: false };
    }
  }

  @SubscribeMessage('procedure.unsubscribe')
  async handleProcedureUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const principal = client.data.principal as TenantUserPrincipal | undefined;
    if (!principal || !this.rooms || !this.authenticatedSockets.has(client.id)) return;
    try {
      await this.rooms.unsubscribe(principal, client, body);
    } catch {
      // Best-effort: rời phòng lỗi thì phòng tự dọn khi socket đóng.
    }
  }

  /** "Đang nhập" trong hồ sơ: chỉ socket đã vào phòng của hồ sơ đó; không gửi ngược lại cho chính socket đó. */
  @SubscribeMessage('procedure.typing')
  async handleProcedureTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const principal = client.data.principal as TenantUserPrincipal | undefined;
    if (!principal || !this.rooms || !this.authenticatedSockets.has(client.id)) return;
    try {
      await this.rooms.typing(principal, client.id, body, (room, signal) =>
        this.emitRoomEvent(
          room,
          {
            id: randomUUID(),
            event: 'procedure.comment.typing',
            version: 1,
            tenantId: principal.tenantId,
            userId: principal.userId,
            // Tín hiệu tạm, không nằm trong chuỗi thông báo có thứ tự.
            sequence: 1,
            occurredAt: new Date().toISOString(),
            data: signal,
          },
          [client.id],
        ),
      );
    } catch {
      // Best-effort như "đang nhập" của Workspace.
    }
  }

  handleDisconnect(client: Socket): void {
    this.rooms?.forget(client.id);
    this.typing?.forget(client.id);
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

  /**
   * Đẩy một bao thư vào MỘT PHÒNG (khác phòng cá nhân), kể cả các replica khác qua Redis Streams.
   * `except` là id socket không nhận (ví dụ chính người đang gõ). Với sự kiện theo phòng, `userId` của
   * bao thư là người thực hiện chứ không phải người nhận.
   */
  async emitRoomEvent(
    room: string,
    event: RealtimeEventEnvelope,
    except: readonly string[] = [],
  ): Promise<void> {
    if (!this.server) throw new Error('Realtime gateway is not ready.');
    const offset = await this.publishClusterEvent(room, event.event, event, except);
    this.metrics.deliveryPublished(event.event, event.occurredAt);
    const target = this.server.local.to(room);
    (except.length > 0 ? target.except([...except]) : target).emit(event.event, event, offset);
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
    except: readonly string[] = [],
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
        opts: { rooms: [room], except: [...except], flags: {} },
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
