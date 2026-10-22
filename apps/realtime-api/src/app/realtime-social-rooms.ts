import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { socialGroupRoom, type SocialRoomMessage } from '@enterprise-platform/contracts-realtime';
import { readCookie } from './realtime-runtime';
import type { RoomSocket } from './realtime-procedure-rooms';

/** Hỏi dịch vụ Mạng nội bộ xem người này có được vào phòng của nhóm không. */
export interface SocialGroupAccessClient {
  canJoin(cookieHeader: string | undefined, groupId: string): Promise<boolean>;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Gọi social-api bằng chính cookie phiên của người xin vào phòng (`GET /v1/realtime/groups/:id/access`).
 * 204 là được vào; 401/403/404 là "không được vào"; lỗi khác ném ra để người gọi nhớ ngắn hạn.
 */
export class HttpSocialGroupAccessClient implements SocialGroupAccessClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs = 2_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async canJoin(cookieHeader: string | undefined, groupId: string): Promise<boolean> {
    const access = readCookie(cookieHeader, 'ep_access');
    if (!access) return false;
    const response = await this.fetcher(
      `${this.baseUrl}/api/social/v1/realtime/groups/${encodeURIComponent(groupId)}/access`,
      { headers: { cookie: `ep_access=${access}` }, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    if (response.ok) return true;
    if ([401, 403, 404].includes(response.status)) return false;
    throw new Error(`social-api group access returned ${response.status}`);
  }
}

/** Id nhóm: chuỗi ngắn gồm chữ, số, `.` `_` `-` (không để client nhét ký tự lạ vào tên phòng). */
const GROUP_ID = /^[A-Za-z0-9._-]{1,100}$/;

export function parseSocialRoomMessage(value: unknown): SocialRoomMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { groupId } = value as Record<string, unknown>;
  if (typeof groupId !== 'string' || !GROUP_ID.test(groupId)) return undefined;
  return { groupId };
}

interface CacheEntry {
  readonly allowed: boolean;
  readonly expiresAt: number;
}

/**
 * Phòng theo nhóm cho tín hiệu bảng tin của nhóm (`social.feed.changed` của bài nhóm).
 *
 * Mỗi người MỞ một nhóm thì xin vào phòng; social-api kiểm tư cách thành viên bằng cookie của chính họ.
 * Kết quả nhớ tạm (ngắn, vì tư cách thành viên đổi thường) để mở đi mở lại không thành một lời gọi HTTP mỗi lần.
 *
 * Đánh đổi chấp nhận được: thành viên bị gỡ khỏi nhóm KHÔNG bị ép rời phòng ngay; họ vẫn nhận tín hiệu tới
 * khi rời phòng, nối lại hoặc đóng tab. Tín hiệu chỉ mang id bài và việc lấy nội dung vẫn bị kiểm quyền ở
 * social-api, nên không lộ nội dung nhóm riêng tư.
 */
export class RealtimeSocialRooms {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<boolean>>();
  private readonly joined = new Map<string, Set<string>>();

  constructor(
    private readonly access: SocialGroupAccessClient,
    private readonly enabled = true,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30_000,
    private readonly failureTtlMs = 10_000,
    /** Một socket (một tab) không được giữ quá số phòng này: chặn việc xin vào hàng loạt. */
    private readonly maxRoomsPerSocket = 10,
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
    const message = parseSocialRoomMessage(raw);
    if (!message) return false;
    const room = socialGroupRoom(principal.tenantId, message.groupId);
    const rooms = this.joined.get(socket.id) ?? new Set<string>();
    if (rooms.has(room)) return true;
    if (rooms.size >= this.maxRoomsPerSocket) return false;
    if (!(await this.allowed(principal, cookieHeader, message.groupId))) return false;
    // Socket có thể đã đóng trong lúc chờ kiểm quyền: không vào phòng và không để lại trạng thái rác.
    if (socket.connected === false) return false;
    // Hai yêu cầu song song cho nhiều nhóm có thể cùng vượt giới hạn lúc chờ: kiểm lại sau khi chờ.
    const current = this.joined.get(socket.id) ?? rooms;
    if (!current.has(room) && current.size >= this.maxRoomsPerSocket) return false;
    this.joined.set(socket.id, current);
    current.add(room);
    await socket.join(room);
    return true;
  }

  async unsubscribe(principal: TenantUserPrincipal, socket: RoomSocket, raw: unknown): Promise<void> {
    const message = parseSocialRoomMessage(raw);
    if (!message) return;
    const room = socialGroupRoom(principal.tenantId, message.groupId);
    const rooms = this.joined.get(socket.id);
    if (!rooms?.delete(room)) return;
    if (rooms.size === 0) this.joined.delete(socket.id);
    await socket.leave(room);
  }

  /** Socket đóng thì bỏ mọi trạng thái của nó (socket.io tự rút socket khỏi phòng). */
  forget(socketId: string): void {
    this.joined.delete(socketId);
  }

  private async allowed(
    principal: TenantUserPrincipal,
    cookieHeader: string | undefined,
    groupId: string,
  ): Promise<boolean> {
    const key = `${principal.tenantId}:${principal.userId}:${groupId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.allowed;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.access
      .canJoin(cookieHeader, groupId)
      .then(
        (allowed) => this.remember(key, allowed, this.ttlMs),
        // Lỗi (mạng, social-api tạm sập) coi là không vào được và chỉ nhớ ngắn.
        () => this.remember(key, false, this.failureTtlMs),
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private remember(key: string, allowed: boolean, ttlMs: number): boolean {
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    this.cache.set(key, {
      allowed,
      expiresAt: this.now() + (allowed ? ttlMs : Math.min(ttlMs, this.failureTtlMs)),
    });
    return allowed;
  }
}
