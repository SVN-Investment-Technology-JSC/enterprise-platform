import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type {
  ProcedureRoomMessage,
  ProcedureTypingMessage,
  ProcedureTypingSignal,
} from '@enterprise-platform/contracts-realtime';
import { readCookie } from './realtime-runtime';

/** Phòng thời gian thực của một hồ sơ quy trình; tenant nằm trong tên phòng nên không thể lẫn giữa các tenant. */
export function procedureRoom(tenantId: string, instanceId: string): string {
  return `tenant:${tenantId}:procedure:${instanceId}`;
}

/** Hỏi dịch vụ Quy trình xem người này có được vào phòng của hồ sơ không. */
export interface ProcedureAccessClient {
  canJoin(cookieHeader: string | undefined, instanceId: string): Promise<boolean>;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Gọi procedure-api bằng chính cookie phiên của người xin vào phòng.
 *
 * Quyền (có phải người tham gia hồ sơ không) do module Quy trình quyết định theo luật RACI/chức danh/đơn vị/
 * ủy quyền; dịch vụ realtime không đọc dữ liệu hồ sơ và không tự suy ra quyền. Chỉ chuyển cookie `ep_access`.
 * 403/404 là "không được vào"; lỗi mạng ném ra để người gọi nhớ ngắn hạn thay vì từ chối lâu dài.
 */
export class HttpProcedureAccessClient implements ProcedureAccessClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs = 2_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async canJoin(cookieHeader: string | undefined, instanceId: string): Promise<boolean> {
    const access = readCookie(cookieHeader, 'ep_access');
    if (!access) return false;
    const response = await this.fetcher(
      `${this.baseUrl}/api/procedure/v1/instances/${encodeURIComponent(instanceId)}/chat-access`,
      { headers: { cookie: `ep_access=${access}` }, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    if (response.ok) return true;
    if (response.status === 403 || response.status === 404 || response.status === 401) return false;
    throw new Error(`procedure-api chat-access returned ${response.status}`);
  }
}

/** Id hồ sơ: chuỗi ngắn gồm chữ, số, `.` `_` `-` (không để client nhét ký tự lạ vào tên phòng). */
const INSTANCE_ID = /^[A-Za-z0-9._-]{1,100}$/;

export function parseRoomMessage(value: unknown): ProcedureRoomMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { instanceId } = value as Record<string, unknown>;
  if (typeof instanceId !== 'string' || !INSTANCE_ID.test(instanceId)) return undefined;
  return { instanceId };
}

export function parseProcedureTypingMessage(value: unknown): ProcedureTypingMessage | undefined {
  const room = parseRoomMessage(value);
  if (!room) return undefined;
  const { typing } = value as Record<string, unknown>;
  if (typeof typing !== 'boolean') return undefined;
  return { instanceId: room.instanceId, typing };
}

/** Socket tối thiểu mà lớp này cần; `socket.io` `Socket` thoả mãn. */
export interface RoomSocket {
  readonly id: string;
  /** `false` khi socket đã đóng; vắng thì coi là còn mở. */
  readonly connected?: boolean;
  join(room: string): Promise<void> | void;
  leave(room: string): Promise<void> | void;
}

interface CacheEntry {
  readonly allowed: boolean;
  readonly expiresAt: number;
}

/**
 * Phòng theo hồ sơ cho trao đổi quy trình, và "đang nhập" trong phòng đó.
 *
 * Người tham gia hồ sơ suy ra động (RACI, chức danh, đơn vị, ủy quyền, việc con) nên không liệt kê được lúc
 * ghi như Workspace. Thay vào đó mỗi người MỞ hồ sơ thì xin vào phòng của hồ sơ; tín hiệu chỉ đến những
 * người đang mở nó. Mỗi lần xin vào đều được procedure-api kiểm quyền, kết quả nhớ tạm để mở đi mở lại không
 * thành một lời gọi HTTP mỗi lần.
 *
 * Đánh đổi chấp nhận được: người vừa mất quyền với hồ sơ vẫn ở trong phòng tới khi rời hoặc nối lại, nhưng
 * tín hiệu chỉ mang id và việc lấy nội dung vẫn bị kiểm quyền ở API, nên không lộ nội dung.
 */
export class RealtimeProcedureRooms {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<boolean>>();
  private readonly joined = new Map<string, Set<string>>();
  private readonly lastTyping = new Map<string, { at: number; typing: boolean }>();

  constructor(
    private readonly access: ProcedureAccessClient,
    private readonly enabled = true,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 60_000,
    private readonly failureTtlMs = 15_000,
    /** Một socket (một tab) không được giữ quá số phòng này: chặn việc xin vào hàng loạt. */
    private readonly maxRoomsPerSocket = 10,
    private readonly minTypingIntervalMs = 800,
    private readonly maxEntries = 5_000,
  ) {}

  /** Xin vào phòng. Trả `true` khi đã vào (hoặc đã ở sẵn trong đó). */
  async subscribe(
    principal: TenantUserPrincipal,
    socket: RoomSocket,
    cookieHeader: string | undefined,
    raw: unknown,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const message = parseRoomMessage(raw);
    if (!message) return false;
    const room = procedureRoom(principal.tenantId, message.instanceId);
    const rooms = this.joined.get(socket.id) ?? new Set<string>();
    if (rooms.has(room)) return true;
    if (rooms.size >= this.maxRoomsPerSocket) return false;
    if (!(await this.allowed(principal, cookieHeader, message.instanceId))) return false;
    // Socket có thể đã đóng trong lúc chờ kiểm quyền: không vào phòng và không để lại trạng thái rác
    // cho một socket không còn (`forget` đã chạy trước đó nên sẽ không ai dọn nữa).
    if (socket.connected === false) return false;
    this.joined.set(socket.id, rooms);
    rooms.add(room);
    await socket.join(room);
    return true;
  }

  async unsubscribe(
    principal: TenantUserPrincipal,
    socket: RoomSocket,
    raw: unknown,
  ): Promise<void> {
    const message = parseRoomMessage(raw);
    if (!message) return;
    const room = procedureRoom(principal.tenantId, message.instanceId);
    const rooms = this.joined.get(socket.id);
    if (!rooms?.delete(room)) return;
    this.lastTyping.delete(`${socket.id}:${room}`);
    await socket.leave(room);
  }

  /**
   * "Đang nhập" trong phòng. Chỉ socket ĐÃ vào phòng (đã qua kiểm quyền) mới gửi được; người gõ do máy chủ
   * lấy từ phiên đăng nhập. Giới hạn tần suất theo socket và hồ sơ; riêng việc đổi từ "đang gõ" sang "ngừng"
   * luôn được qua để chữ báo tắt ngay khi người đó gửi tin.
   */
  async typing(
    principal: TenantUserPrincipal,
    socketId: string,
    raw: unknown,
    emit: (room: string, signal: ProcedureTypingSignal) => Promise<void>,
  ): Promise<void> {
    if (!this.enabled) return;
    const message = parseProcedureTypingMessage(raw);
    if (!message) return;
    const room = procedureRoom(principal.tenantId, message.instanceId);
    if (!this.joined.get(socketId)?.has(room)) return;

    const key = `${socketId}:${room}`;
    const at = this.now();
    const previous = this.lastTyping.get(key);
    if (previous && previous.typing === message.typing && at - previous.at < this.minTypingIntervalMs) return;
    if (this.lastTyping.size >= this.maxEntries) this.lastTyping.clear();
    this.lastTyping.set(key, { at, typing: message.typing });

    await emit(room, {
      instanceId: message.instanceId,
      userId: principal.userId,
      typing: message.typing,
    });
  }

  /** Socket đóng thì bỏ mọi trạng thái của nó (socket.io tự rút socket khỏi phòng). */
  forget(socketId: string): void {
    this.joined.delete(socketId);
    const prefix = `${socketId}:`;
    for (const key of this.lastTyping.keys()) {
      if (key.startsWith(prefix)) this.lastTyping.delete(key);
    }
  }

  private async allowed(
    principal: TenantUserPrincipal,
    cookieHeader: string | undefined,
    instanceId: string,
  ): Promise<boolean> {
    const key = `${principal.tenantId}:${principal.userId}:${instanceId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.allowed;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.access
      .canJoin(cookieHeader, instanceId)
      .then(
        (allowed) => this.remember(key, allowed, this.ttlMs),
        // Lỗi (mạng, procedure-api tạm sập) coi là không vào được và chỉ nhớ ngắn: không từ chối lâu dài
        // chỉ vì một lỗi thoáng qua, cũng không dồn tải lên procedure-api khi nó đang gặp sự cố.
        () => this.remember(key, false, this.failureTtlMs),
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private remember(key: string, allowed: boolean, ttlMs: number): boolean {
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    // Bị từ chối chỉ nhớ ngắn để người vừa được thêm vào hồ sơ vào được sớm.
    this.cache.set(key, {
      allowed,
      expiresAt: this.now() + (allowed ? ttlMs : Math.min(ttlMs, this.failureTtlMs)),
    });
    return allowed;
  }
}
