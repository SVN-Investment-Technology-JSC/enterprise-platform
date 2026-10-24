import { randomUUID } from 'node:crypto';
import type { ChatTypingRecipients } from '@enterprise-platform/contracts-chat';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type {
  CoreChatTyping,
  CoreChatTypingMessage,
  RealtimeEventEnvelope,
} from '@enterprise-platform/contracts-realtime';
import { readCookie } from './realtime-runtime';

/** Hỏi core API (chat nội bộ) ai cần nhận tín hiệu "đang nhập" của một cuộc trò chuyện. */
export interface CoreChatTypingRecipientsClient {
  recipients(cookieHeader: string | undefined, conversationId: string): Promise<ChatTypingRecipients | null>;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Gọi core API bằng cookie phiên của người đang gõ: core quyết định người đó có ở trong cuộc trò chuyện không và ai
 * nhận; realtime không đọc DB chat. Chỉ chuyển cookie `ep_access`.
 */
export class HttpCoreChatTypingClient implements CoreChatTypingRecipientsClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs = 2_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async recipients(cookieHeader: string | undefined, conversationId: string): Promise<ChatTypingRecipients | null> {
    const access = readCookie(cookieHeader, 'ep_access');
    if (!access) return null;
    const response = await this.fetcher(
      `${this.baseUrl}/api/platform/v1/chat/conversations/${encodeURIComponent(conversationId)}/typing-recipients`,
      { headers: { cookie: `ep_access=${access}` }, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { audience?: unknown; userIds?: unknown };
    if (body.audience === 'company') return { audience: 'company' };
    if (body.audience !== 'members' || !Array.isArray(body.userIds)) return null;
    return {
      audience: 'members',
      userIds: body.userIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 1_000;

/** Đọc tin client gửi lên; sai dạng thì bỏ qua lặng lẽ (đây chỉ là tín hiệu tạm). */
export function parseCoreChatTypingMessage(value: unknown): CoreChatTypingMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { conversationId, typing } = value as Record<string, unknown>;
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) return undefined;
  if (typeof typing !== 'boolean') return undefined;
  return { conversationId, typing };
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly recipients: ChatTypingRecipients | null;
}

export interface CoreChatTypingEmitter {
  /** Gửi vào phòng cá nhân của một người. */
  user(event: RealtimeEventEnvelope): Promise<void>;
  /** Gửi cho mọi phiên của công ty (cuộc chung), trừ socket đang gõ. */
  company(event: RealtimeEventEnvelope, exceptSocketId: string): Promise<void>;
}

/**
 * "Đang nhập" của chat core: không qua outbox, không ghi DB. Giới hạn tần suất theo socket, nhớ tạm người nhận để gõ
 * liên tục không thành mỗi lần gõ một lời gọi HTTP, người gõ lấy từ phiên chứ không từ client.
 */
export class RealtimeCoreChatTyping {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ChatTypingRecipients | null>>();
  private readonly lastSent = new Map<string, { at: number; typing: boolean }>();

  constructor(
    private readonly client: CoreChatTypingRecipientsClient,
    private readonly enabled = true,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30_000,
    private readonly failureTtlMs = 10_000,
    private readonly minIntervalMs = 800,
    private readonly maxEntries = 5_000,
  ) {}

  async handle(
    principal: TenantUserPrincipal,
    socketId: string,
    cookieHeader: string | undefined,
    raw: unknown,
    emit: CoreChatTypingEmitter,
  ): Promise<void> {
    if (!this.enabled) return;
    const message = parseCoreChatTypingMessage(raw);
    if (!message || !this.allow(socketId, message)) return;
    const recipients = await this.recipientsOf(principal, cookieHeader, message.conversationId);
    if (!recipients) return;
    const data: CoreChatTyping = { conversationId: message.conversationId, userId: principal.userId, typing: message.typing };
    const envelope = (userId: string): RealtimeEventEnvelope => ({
      id: randomUUID(),
      event: 'core.chat.typing',
      version: 1,
      tenantId: principal.tenantId,
      userId,
      // Tín hiệu tạm, không nằm trong chuỗi thông báo có thứ tự.
      sequence: 1,
      occurredAt: new Date(this.now()).toISOString(),
      data,
    });
    if (recipients.audience === 'company') {
      // Với sự kiện theo phòng, `userId` của bao thư là người thực hiện.
      await emit.company(envelope(principal.userId), socketId);
      return;
    }
    await Promise.allSettled(
      [...new Set(recipients.userIds)]
        .filter((userId) => userId !== principal.userId)
        .slice(0, MAX_RECIPIENTS)
        .map((userId) => emit.user(envelope(userId))),
    );
  }

  forget(socketId: string): void {
    const prefix = `${socketId}:`;
    for (const key of this.lastSent.keys()) if (key.startsWith(prefix)) this.lastSent.delete(key);
  }

  /** Mỗi socket và cuộc tối đa một tín hiệu mỗi `minIntervalMs`; đổi trạng thái (gõ / ngừng) luôn được qua. */
  private allow(socketId: string, message: CoreChatTypingMessage): boolean {
    const key = `${socketId}:${message.conversationId}`;
    const at = this.now();
    const previous = this.lastSent.get(key);
    if (previous && previous.typing === message.typing && at - previous.at < this.minIntervalMs) return false;
    if (this.lastSent.size >= this.maxEntries) this.lastSent.clear();
    this.lastSent.set(key, { at, typing: message.typing });
    return true;
  }

  private async recipientsOf(
    principal: TenantUserPrincipal,
    cookieHeader: string | undefined,
    conversationId: string,
  ): Promise<ChatTypingRecipients | null> {
    const key = `${principal.tenantId}:${principal.userId}:${conversationId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.recipients;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const request = this.client
      .recipients(cookieHeader, conversationId)
      .then(
        (recipients) => this.remember(key, recipients, recipients ? this.ttlMs : this.failureTtlMs),
        () => this.remember(key, null, this.failureTtlMs),
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private remember(key: string, recipients: ChatTypingRecipients | null, ttlMs: number): ChatTypingRecipients | null {
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    this.cache.set(key, { expiresAt: this.now() + ttlMs, recipients });
    return recipients;
  }
}
