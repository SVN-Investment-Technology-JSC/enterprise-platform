import { randomUUID } from 'node:crypto';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type {
  ChatTypingMessage,
  RealtimeEventEnvelope,
  WorkspaceChatTyping,
} from '@enterprise-platform/contracts-realtime';
import { readCookie } from './realtime-runtime';

/** Hỏi dịch vụ workspace ai cần nhận tín hiệu "đang nhập" của một node. */
export interface TypingRecipientsClient {
  recipients(
    cookieHeader: string | undefined,
    entityType: string,
    entityId: string,
  ): Promise<readonly string[]>;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Gọi workspace-api bằng chính cookie phiên của người đang gõ.
 *
 * Quyền (có phải thành viên dự án không, có được nhắn không) do module workspace
 * quyết định, dịch vụ realtime không đọc DB workspace và không tự suy ra quyền.
 * Chỉ chuyển cookie `ep_access`, không chuyển cả header cookie.
 */
export class HttpTypingRecipientsClient implements TypingRecipientsClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs = 2_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async recipients(
    cookieHeader: string | undefined,
    entityType: string,
    entityId: string,
  ): Promise<readonly string[]> {
    const access = readCookie(cookieHeader, 'ep_access');
    if (!access) return [];
    const query = new URLSearchParams({ entityType, entityId });
    const response = await this.fetcher(
      `${this.baseUrl}/api/workspace/v1/chat-typing/recipients?${query.toString()}`,
      {
        headers: { cookie: `ep_access=${access}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { userIds?: unknown };
    return Array.isArray(body.userIds)
      ? body.userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  }
}

const ENTITY_TYPES = new Set(['project', 'work_item']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 1_000;

/** Đọc tin client gửi lên; sai dạng thì bỏ qua lặng lẽ (đây chỉ là tín hiệu tạm). */
export function parseTypingMessage(value: unknown): ChatTypingMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { entityType, entityId, typing } = value as Record<string, unknown>;
  if (typeof entityType !== 'string' || !ENTITY_TYPES.has(entityType)) return undefined;
  if (typeof entityId !== 'string' || !UUID.test(entityId)) return undefined;
  if (typeof typing !== 'boolean') return undefined;
  return { entityType: entityType as ChatTypingMessage['entityType'], entityId, typing };
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly userIds: readonly string[];
}

/**
 * "Đang nhập" theo thời gian thực, không qua outbox và không ghi DB.
 *
 * Client báo qua socket; dịch vụ này (1) giới hạn tần suất theo từng socket,
 * (2) hỏi workspace-api ai là người nhận (có lưu tạm để một người gõ liên tục
 * không làm mỗi lần gõ thành một lời gọi HTTP), (3) đẩy bao thư vào phòng cá
 * nhân của từng người nhận. Người gõ do máy chủ lấy từ phiên đăng nhập, client
 * không tự khai được là ai.
 */
export class RealtimeChatTyping {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<readonly string[]>>();
  private readonly lastSent = new Map<string, { at: number; typing: boolean }>();

  constructor(
    private readonly recipients: TypingRecipientsClient,
    private readonly enabled = true,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 60_000,
    /** Lỗi/không có quyền cũng được nhớ, để người gõ liên tục không dồn tải lên workspace-api. */
    private readonly failureTtlMs = 15_000,
    private readonly minIntervalMs = 800,
    private readonly maxEntries = 5_000,
  ) {}

  async handle(
    principal: TenantUserPrincipal,
    socketId: string,
    cookieHeader: string | undefined,
    raw: unknown,
    emit: (event: RealtimeEventEnvelope) => Promise<void>,
  ): Promise<void> {
    if (!this.enabled) return;
    const message = parseTypingMessage(raw);
    if (!message) return;
    if (!this.allow(socketId, message)) return;

    const userIds = await this.recipientsOf(principal, cookieHeader, message);
    if (userIds.length === 0) return;

    const data: WorkspaceChatTyping = {
      entityType: message.entityType,
      entityId: message.entityId,
      userId: principal.userId,
      typing: message.typing,
    };
    const occurredAt = new Date(this.now()).toISOString();
    await Promise.allSettled(
      [...new Set(userIds)]
        .filter((userId) => userId !== principal.userId)
        .slice(0, MAX_RECIPIENTS)
        .map((userId) =>
          emit({
            id: randomUUID(),
            event: 'workspace.chat.typing',
            version: 1,
            tenantId: principal.tenantId,
            userId,
            // Tín hiệu tạm, không nằm trong chuỗi thông báo có thứ tự.
            sequence: 1,
            occurredAt,
            data,
          }),
        ),
    );
  }

  /** Socket đóng thì bỏ trạng thái giới hạn tần suất của nó. */
  forget(socketId: string): void {
    const prefix = `${socketId}:`;
    for (const key of this.lastSent.keys()) {
      if (key.startsWith(prefix)) this.lastSent.delete(key);
    }
  }

  /**
   * Mỗi socket và node tối đa một tín hiệu mỗi `minIntervalMs`. Riêng việc đổi từ
   * "đang gõ" sang "ngừng" luôn được qua để chữ báo tắt ngay khi gửi tin.
   */
  private allow(socketId: string, message: ChatTypingMessage): boolean {
    const key = `${socketId}:${message.entityId}`;
    const at = this.now();
    const previous = this.lastSent.get(key);
    if (previous && previous.typing === message.typing && at - previous.at < this.minIntervalMs) {
      return false;
    }
    if (this.lastSent.size >= this.maxEntries) this.lastSent.clear();
    this.lastSent.set(key, { at, typing: message.typing });
    return true;
  }

  private async recipientsOf(
    principal: TenantUserPrincipal,
    cookieHeader: string | undefined,
    message: ChatTypingMessage,
  ): Promise<readonly string[]> {
    const key = `${principal.tenantId}:${principal.userId}:${message.entityType}:${message.entityId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.userIds;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.recipients
      .recipients(cookieHeader, message.entityType, message.entityId)
      .then(
        (userIds) => this.remember(key, userIds, this.ttlMs),
        () => this.remember(key, [], this.failureTtlMs),
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private remember(key: string, userIds: readonly string[], ttlMs: number): readonly string[] {
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    // Danh sách rỗng (không có quyền hay lỗi) chỉ nhớ ngắn, kẻo một lỗi thoáng qua chặn cả phiên.
    this.cache.set(key, {
      expiresAt: this.now() + (userIds.length === 0 ? Math.min(ttlMs, this.failureTtlMs) : ttlMs),
      userIds,
    });
    return userIds;
  }
}
