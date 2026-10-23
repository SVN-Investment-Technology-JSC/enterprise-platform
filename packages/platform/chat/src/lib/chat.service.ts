import { randomUUID } from 'node:crypto';
import {
  CHAT_EDIT_WINDOW_MINUTES,
  CHAT_MAX_ATTACHMENT_BYTES,
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MAX_BODY_LENGTH,
  CHAT_MAX_GROUP_MEMBERS,
  CHAT_MAX_PAGE_SIZE,
  CHAT_MAX_TITLE_LENGTH,
  CHAT_PAGE_SIZE,
  CHAT_RECEIPT_SIGNAL_MAX_MEMBERS,
  directChatKey,
  isChatAllowedType,
  isChatImageType,
  isChatReaction,
  type ChatAttachmentUrl,
  type ChatConversationList,
  type ChatConversationView,
  type ChatMessagePage,
  type ChatMessageView,
  type ChatSystemEvent,
  type ChatTypingRecipients,
  type ChatUnreadSummary,
  type CoreChatChange,
  type CreateGroupChatRequest,
  type InitiateChatAttachmentRequest,
  type InitiateChatAttachmentResponse,
  type SendChatMessageRequest,
  type SendChatMessageResponse,
  type UpdateChatConversationRequest,
  type UpdateChatMessageRequest,
} from '@enterprise-platform/contracts-chat';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantCoreAccess } from '@enterprise-platform/platform-identity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { writeChatSignal, writeMentionEvent } from './chat-events.js';
import * as store from './chat.store.js';
import type { ChatDb, ConversationRecord, MembershipRecord } from './chat.store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Kho đối tượng cho tệp đính kèm (MinIO/S3 qua `adapter-storage`). */
export interface ChatStorage {
  createUploadUrl(input: { readonly key: string; readonly contentType: string; readonly expiresInSeconds?: number }): Promise<string>;
  createDownloadUrl(
    key: string,
    expiresInSeconds?: number,
    options?: { readonly inline?: boolean; readonly contentType?: string; readonly fileName?: string },
  ): Promise<string>;
  objectMetadata(key: string): Promise<{ sizeBytes: number; contentType: string }>;
  deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}

export type ChatDatabases = Pick<TenantCoreAccess, 'pool' | 'transaction'>;

interface Access {
  readonly conversation: ConversationRecord;
  readonly member: MembershipRecord | null;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException(`${field} không hợp lệ.`);
  return value.toLowerCase();
}

function uuidList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${field} không hợp lệ.`);
  return [...new Set(value.map((item) => uuid(item, field)))];
}

function cleanTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!title) throw new BadRequestException('Nhập tên nhóm.');
  if (title.length > CHAT_MAX_TITLE_LENGTH) throw new BadRequestException(`Tên nhóm tối đa ${CHAT_MAX_TITLE_LENGTH} ký tự.`);
  return title;
}

function cleanBody(value: unknown): string {
  const body = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  if (body.length > CHAT_MAX_BODY_LENGTH) throw new BadRequestException(`Tin nhắn tối đa ${CHAT_MAX_BODY_LENGTH} ký tự.`);
  return body;
}

/** Tên tệp an toàn để làm khoá trong kho và để tải về: bỏ đường dẫn, ký tự điều khiển, giới hạn độ dài. */
export function safeFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  const printable = [...base].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  });
  const cleaned = printable.join('').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new BadRequestException('Tên tệp không hợp lệ.');
  return cleaned.length > 200 ? cleaned.slice(cleaned.length - 200) : cleaned;
}

function storageSafe(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-120) || 'file';
}

/**
 * Chat nội bộ của core: mọi người dùng doanh nghiệp đều dùng được, không cần bật phân hệ nào. Mọi thay đổi ghi
 * tín hiệu vào outbox cùng giao dịch (`core.chat.changed`, chỉ mang id); realtime-api chuyển tới trình duyệt.
 */
export class ChatService {
  /** Id cuộc chung toàn công ty theo tenant (khỏi ghi DB ở mỗi lần tải danh sách). */
  private readonly companyIds = new Map<string, string>();

  constructor(
    private readonly databases: ChatDatabases,
    private readonly storage: ChatStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /* ----------------------------- Cuộc trò chuyện ----------------------------- */

  /**
   * Danh sách cuộc trò chuyện. Tải danh sách nghĩa là trình duyệt của người này đã nhận tin mới: dời mốc "đã nhận"
   * và báo cho người gửi ở các cuộc nhỏ.
   */
  async conversations(principal: TenantUserPrincipal): Promise<ChatConversationList> {
    await this.ensureCompany(principal);
    await this.databases.transaction(principal.tenantId, async (db) => {
      const delivered = await store.markDelivered(db, principal.userId);
      for (const conversationId of delivered) {
        const members = await store.activeMembers(db, conversationId);
        if (members.length > CHAT_RECEIPT_SIGNAL_MAX_MEMBERS) continue;
        await this.signal(db, principal, conversationId, null, 'delivered', 'members', members.map((m) => m.userId));
      }
    });
    const items = await store.listConversations(await this.databases.pool(principal.tenantId), principal.userId);
    return { items, unreadTotal: unreadTotal(items) };
  }

  async unread(principal: TenantUserPrincipal): Promise<ChatUnreadSummary> {
    await this.ensureCompany(principal);
    const items = await store.listConversations(await this.databases.pool(principal.tenantId), principal.userId);
    return { unreadTotal: unreadTotal(items) };
  }

  async conversation(principal: TenantUserPrincipal, conversationId: string): Promise<ChatConversationView> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const pool = await this.databases.pool(principal.tenantId);
    await this.requireAccess(pool, principal, id);
    const [view] = await store.listConversations(pool, principal.userId, id);
    if (!view) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return view;
  }

  async company(principal: TenantUserPrincipal): Promise<ChatConversationView> {
    const record = await this.ensureCompany(principal);
    return this.conversation(principal, record.id);
  }

  async openDirect(principal: TenantUserPrincipal, peer: unknown): Promise<ChatConversationView> {
    const peerId = uuid(peer, 'Người nhận');
    if (peerId === principal.userId.toLowerCase()) throw new BadRequestException('Không thể nhắn tin cho chính mình.');
    const id = await this.databases.transaction(principal.tenantId, async (db) => {
      const [user] = await store.activeUsers(db, [peerId]);
      if (!user) throw new NotFoundException('Người nhận không còn hoạt động.');
      const record = await store.ensureDirectConversation(db, directChatKey(principal.userId, peerId), principal.userId, peerId);
      return record.id;
    });
    return this.conversation(principal, id);
  }

  async createGroup(principal: TenantUserPrincipal, input: CreateGroupChatRequest): Promise<ChatConversationView> {
    const title = cleanTitle(input?.title);
    const requested = uuidList(input?.memberIds, 'Thành viên').filter((id) => id !== principal.userId.toLowerCase());
    if (requested.length === 0) throw new BadRequestException('Chọn ít nhất một người vào nhóm.');
    if (requested.length + 1 > CHAT_MAX_GROUP_MEMBERS) throw new BadRequestException(`Nhóm tối đa ${CHAT_MAX_GROUP_MEMBERS} người.`);
    const id = await this.databases.transaction(principal.tenantId, async (db) => {
      const users = await store.activeUsers(db, requested);
      if (users.length === 0) throw new BadRequestException('Những người đã chọn không còn hoạt động.');
      const record = await store.createGroupConversation(db, title, principal.userId, users.map((u) => u.id));
      await this.systemMessage(db, principal, record.id, { type: 'group.created', title });
      await this.signal(db, principal, record.id, null, 'members.changed', 'members', users.map((u) => u.id));
      return record.id;
    });
    return this.conversation(principal, id);
  }

  async updateConversation(
    principal: TenantUserPrincipal,
    conversationId: string,
    input: UpdateChatConversationRequest,
  ): Promise<ChatConversationView> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const access = await this.requireAccess(db, principal, id, true);
      if (input?.title !== undefined) {
        if (access.conversation.kind !== 'group') throw new BadRequestException('Chỉ đổi được tên nhóm.');
        const title = cleanTitle(input.title);
        if (title !== access.conversation.title) {
          await store.setTitle(db, id, title);
          await this.systemMessage(db, principal, id, { type: 'title.changed', title });
          await this.signalMembers(db, principal, access.conversation, null, 'conversation.updated');
        }
      }
      if (input?.muted !== undefined) {
        if (typeof input.muted !== 'boolean') throw new BadRequestException('Giá trị tắt thông báo không hợp lệ.');
        if (access.conversation.kind === 'company') await store.ensureMemberRow(db, id, principal.userId);
        await store.setMuted(db, id, principal.userId, input.muted);
      }
    });
    return this.conversation(principal, id);
  }

  async addMembers(principal: TenantUserPrincipal, conversationId: string, userIds: unknown): Promise<ChatConversationView> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const requested = uuidList(userIds, 'Thành viên');
    if (requested.length === 0) throw new BadRequestException('Chọn người cần thêm.');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const access = await this.requireAccess(db, principal, id, true);
      if (access.conversation.kind !== 'group') throw new BadRequestException('Chỉ thêm được người vào nhóm.');
      const current = await store.activeMembers(db, id);
      if (current.length + requested.length > CHAT_MAX_GROUP_MEMBERS) throw new BadRequestException(`Nhóm tối đa ${CHAT_MAX_GROUP_MEMBERS} người.`);
      const users = await store.activeUsers(db, requested);
      const added = await store.addMembers(db, id, users.map((u) => u.id));
      if (added.length === 0) return;
      await this.systemMessage(db, principal, id, { type: 'members.added', userIds: added });
      await this.signal(db, principal, id, null, 'members.changed', 'members', [...current.map((m) => m.userId), ...added]);
    });
    return this.conversation(principal, id);
  }

  async removeMember(principal: TenantUserPrincipal, conversationId: string, userId: string): Promise<ChatConversationView> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const target = uuid(userId, 'Thành viên');
    if (target === principal.userId.toLowerCase()) throw new BadRequestException('Dùng "Rời nhóm" để tự rời khỏi nhóm.');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const access = await this.requireAccess(db, principal, id, true);
      if (access.conversation.kind !== 'group') throw new BadRequestException('Chỉ mời được người ra khỏi nhóm.');
      if (access.member?.role !== 'owner') throw new ForbiddenException('Chỉ trưởng nhóm mới mời được người ra khỏi nhóm.');
      const before = await store.activeMembers(db, id);
      if (!(await store.setMemberLeft(db, id, target))) throw new NotFoundException('Người này không còn trong nhóm.');
      await this.systemMessage(db, principal, id, { type: 'member.removed', userId: target });
      await this.signal(db, principal, id, null, 'members.changed', 'members', before.map((m) => m.userId));
    });
    return this.conversation(principal, id);
  }

  /** Rời nhóm; trưởng nhóm rời thì người vào nhóm sớm nhất còn lại làm trưởng nhóm. */
  async leave(principal: TenantUserPrincipal, conversationId: string): Promise<void> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const access = await this.requireAccess(db, principal, id, true);
      if (access.conversation.kind !== 'group') throw new BadRequestException('Chỉ rời được nhóm.');
      const before = await store.activeMembers(db, id);
      await store.setMemberLeft(db, id, principal.userId);
      const rest = before.filter((m) => m.userId.toLowerCase() !== principal.userId.toLowerCase());
      if (access.member?.role === 'owner' && rest.length > 0 && !rest.some((m) => m.role === 'owner')) {
        await store.setMemberRole(db, id, rest[0].userId, 'owner');
      }
      await this.systemMessage(db, principal, id, { type: 'member.left' });
      await this.signal(db, principal, id, null, 'members.changed', 'members', before.map((m) => m.userId));
    });
  }

  /* --------------------------------- Tin nhắn --------------------------------- */

  async messages(
    principal: TenantUserPrincipal,
    conversationId: string,
    options: { readonly before?: string; readonly limit?: string | number } = {},
  ): Promise<ChatMessagePage> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const before = options.before ? uuid(options.before, 'Mốc phân trang') : null;
    const limit = Math.min(Math.max(Number(options.limit ?? CHAT_PAGE_SIZE) || CHAT_PAGE_SIZE, 1), CHAT_MAX_PAGE_SIZE);
    const pool = await this.databases.pool(principal.tenantId);
    const access = await this.requireAccess(pool, principal, id);
    const [page, members, views] = await Promise.all([
      store.listMessages(pool, id, before, limit),
      store.memberWatermarks(pool, id, access.conversation.kind),
      store.listConversations(pool, principal.userId, id),
    ]);
    if (!views[0]) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return { conversation: views[0], messages: page.messages, hasMore: page.hasMore, members };
  }

  /** Người dùng đã xem tới tin `messageId` (giao diện gọi khi cuộc đang mở và cửa sổ đang hiện). */
  async markRead(principal: TenantUserPrincipal, conversationId: string, messageId: unknown): Promise<ChatConversationView> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const target = uuid(messageId, 'Mã tin nhắn');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const access = await this.requireAccess(db, principal, id);
      if (access.conversation.kind === 'company') await store.ensureMemberRow(db, id, principal.userId);
      const moved = await store.markRead(db, id, principal.userId, target);
      if (!moved || access.conversation.kind === 'company') return;
      const members = await store.activeMembers(db, id);
      if (members.length > CHAT_RECEIPT_SIGNAL_MAX_MEMBERS) return;
      await this.signal(db, principal, id, target, 'read', 'members', members.map((m) => m.userId));
    });
    return this.conversation(principal, id);
  }

  async send(principal: TenantUserPrincipal, conversationId: string, input: SendChatMessageRequest): Promise<SendChatMessageResponse> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const body = cleanBody(input?.body);
    const attachmentIds = uuidList(input?.attachmentIds, 'Tệp đính kèm');
    if (!body && attachmentIds.length === 0) throw new BadRequestException('Nhập nội dung tin nhắn.');
    if (attachmentIds.length > CHAT_MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(`Mỗi tin gửi kèm tối đa ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} tệp.`);
    }
    const requestedMentions = uuidList(input?.mentions, 'Người được nhắc');
    const replyToId = input?.replyToId ? uuid(input.replyToId, 'Tin được trả lời') : null;
    const clientId = typeof input?.clientId === 'string' && input.clientId.trim() ? input.clientId.trim().slice(0, 64) : null;

    const outcome = await this.databases.transaction(principal.tenantId, async (db) => {
      const access = await this.requireAccess(db, principal, id, true);
      if (clientId) {
        const existing = await store.findByClientId(db, id, principal.userId, clientId);
        if (existing) return { messageId: existing, droppedMentions: [] as string[] };
      }
      if (replyToId) {
        const parent = await store.findMessage(db, replyToId);
        if (!parent || parent.conversationId !== id || parent.kind !== 'text') throw new BadRequestException('Tin được trả lời không còn trong cuộc trò chuyện.');
      }
      const { kept, dropped } = await this.filterMentions(db, access.conversation, requestedMentions);
      const created = await store.insertMessage(db, {
        conversationId: id,
        senderId: principal.userId,
        kind: 'text',
        body,
        mentions: kept,
        replyToId,
        clientId,
        systemEvent: null,
      });
      const attached = await store.attachToMessage(db, { messageId: created.id, conversationId: id, uploadedBy: principal.userId, attachmentIds });
      if (attached !== attachmentIds.length) throw new BadRequestException('Có tệp đính kèm chưa tải lên xong hoặc không thuộc cuộc trò chuyện này.');
      if (access.conversation.kind === 'company') await store.ensureMemberRow(db, id, principal.userId);
      await store.markOwnMessage(db, id, principal.userId, created.createdAt);
      await this.signalMembers(db, principal, access.conversation, created.id, 'message.created');
      if (kept.length > 0) {
        await writeMentionEvent(
          db,
          {
            tenantId: principal.tenantId,
            conversationId: id,
            messageId: created.id,
            mentionedUserIds: kept,
            actorUserId: principal.userId,
            actorName: principal.displayName,
            conversationTitle: access.conversation.kind === 'direct' ? null : access.conversation.title,
            excerpt: store.excerptOf(body) || 'Đã gửi tệp đính kèm.',
          },
          this.newId,
        );
      }
      return { messageId: created.id, droppedMentions: dropped };
    });
    const message = await this.loadMessage(principal, outcome.messageId);
    return { message, droppedMentions: outcome.droppedMentions };
  }

  async edit(principal: TenantUserPrincipal, messageId: string, input: UpdateChatMessageRequest): Promise<ChatMessageView> {
    const id = uuid(messageId, 'Mã tin nhắn');
    const body = cleanBody(input?.body);
    const requestedMentions = uuidList(input?.mentions, 'Người được nhắc');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const message = await this.ownMessage(db, principal, id);
      const ageMinutes = (this.now().getTime() - Date.parse(message.createdAt)) / 60_000;
      if (ageMinutes > CHAT_EDIT_WINDOW_MINUTES) throw new ConflictException(`Chỉ sửa được tin trong ${CHAT_EDIT_WINDOW_MINUTES} phút sau khi gửi.`);
      const access = await this.requireAccess(db, principal, message.conversationId, true);
      const attachments = await db.query<{ n: string }>(`SELECT count(*) AS n FROM chat_schema.attachments WHERE message_id = $1`, [id]);
      if (!body && Number(attachments.rows[0]?.n ?? 0) === 0) throw new BadRequestException('Nhập nội dung tin nhắn.');
      const { kept } = await this.filterMentions(db, access.conversation, requestedMentions);
      await store.updateMessageBody(db, id, body, kept);
      await this.signalMembers(db, principal, access.conversation, id, 'message.edited');
      const newly = kept.filter((userId) => !message.mentions.map((m) => m.toLowerCase()).includes(userId));
      if (newly.length > 0) {
        await writeMentionEvent(
          db,
          {
            tenantId: principal.tenantId,
            conversationId: message.conversationId,
            messageId: id,
            mentionedUserIds: newly,
            actorUserId: principal.userId,
            actorName: principal.displayName,
            conversationTitle: access.conversation.kind === 'direct' ? null : access.conversation.title,
            excerpt: store.excerptOf(body),
          },
          this.newId,
        );
      }
    });
    return this.loadMessage(principal, id);
  }

  /** Thu hồi tin của chính mình (lúc nào cũng được): nội dung, tệp và cảm xúc bị xoá hẳn. */
  async recall(principal: TenantUserPrincipal, messageId: string): Promise<ChatMessageView> {
    const id = uuid(messageId, 'Mã tin nhắn');
    const keys = await this.databases.transaction(principal.tenantId, async (db) => {
      const message = await this.ownMessage(db, principal, id);
      const access = await this.requireAccess(db, principal, message.conversationId, true);
      const removed = await store.recallMessage(db, id);
      await this.signalMembers(db, principal, access.conversation, id, 'message.deleted');
      return removed;
    });
    if (keys.length > 0) await this.storage.deleteObjects(keys).catch(() => undefined);
    return this.loadMessage(principal, id);
  }

  async react(principal: TenantUserPrincipal, messageId: string, reaction: unknown): Promise<ChatMessageView> {
    const id = uuid(messageId, 'Mã tin nhắn');
    if (reaction !== null && !isChatReaction(reaction)) throw new BadRequestException('Cảm xúc không hợp lệ.');
    await this.databases.transaction(principal.tenantId, async (db) => {
      const message = await store.findMessage(db, id);
      if (!message) throw new NotFoundException('Không tìm thấy tin nhắn.');
      const access = await this.requireAccess(db, principal, message.conversationId);
      if (message.isDeleted || message.kind !== 'text') throw new BadRequestException('Không thả cảm xúc được cho tin này.');
      await store.setReaction(db, id, principal.userId, reaction);
      await this.signalMembers(db, principal, access.conversation, id, 'reaction.changed');
    });
    return this.loadMessage(principal, id);
  }

  /** Ai nhận "đang nhập": realtime-api hỏi bằng cookie của người gõ, nên người ngoài cuộc bị từ chối ở đây. */
  async typingRecipients(principal: TenantUserPrincipal, conversationId: string): Promise<ChatTypingRecipients> {
    const id = uuid(conversationId, 'Mã cuộc trò chuyện');
    const pool = await this.databases.pool(principal.tenantId);
    const access = await this.requireAccess(pool, principal, id);
    if (access.conversation.kind === 'company') return { audience: 'company' };
    const members = await store.activeMembers(pool, id);
    return {
      audience: 'members',
      userIds: members.map((m) => m.userId).filter((userId) => userId.toLowerCase() !== principal.userId.toLowerCase()),
    };
  }

  /* ------------------------------- Tệp đính kèm ------------------------------- */

  async initiateAttachment(principal: TenantUserPrincipal, input: InitiateChatAttachmentRequest): Promise<InitiateChatAttachmentResponse> {
    const conversationId = uuid(input?.conversationId, 'Mã cuộc trò chuyện');
    const fileName = safeFileName(input?.fileName);
    const contentType = typeof input?.contentType === 'string' ? input.contentType.toLowerCase().split(';')[0].trim() : '';
    if (!isChatAllowedType(contentType)) throw new BadRequestException('Loại tệp này không gửi được qua chat.');
    const sizeBytes = Number(input?.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException('Dung lượng tệp không hợp lệ.');
    if (sizeBytes > CHAT_MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(`Mỗi tệp tối đa ${Math.round(CHAT_MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
    }
    const attachmentId = this.newId();
    const storageKey = `tenants/${principal.tenantId}/core/chat/${conversationId}/${attachmentId}/${storageSafe(fileName)}`;
    const stale = await this.databases.transaction(principal.tenantId, async (db) => {
      await this.requireAccess(db, principal, conversationId);
      await store.insertAttachment(db, {
        id: attachmentId,
        conversationId,
        uploadedBy: principal.userId,
        fileName,
        contentType,
        sizeBytes,
        storageKey,
        isImage: isChatImageType(contentType),
      });
      return store.takeStaleUploads(db, principal.userId);
    });
    if (stale.length > 0) await this.storage.deleteObjects(stale).catch(() => undefined);
    const uploadUrl = await this.storage.createUploadUrl({ key: storageKey, contentType });
    return {
      attachment: { id: attachmentId, fileName, contentType, sizeBytes, isImage: isChatImageType(contentType) },
      uploadUrl,
      uploadHeaders: { 'content-type': contentType },
    };
  }

  /** Xác nhận đã tải lên: đối chiếu dung lượng thật trong kho với dung lượng đã khai. */
  async completeAttachment(principal: TenantUserPrincipal, attachmentId: string): Promise<{ readonly id: string }> {
    const id = uuid(attachmentId, 'Mã tệp');
    const pool = await this.databases.pool(principal.tenantId);
    const attachment = await store.findAttachment(pool, id);
    if (!attachment || attachment.uploadedBy.toLowerCase() !== principal.userId.toLowerCase()) throw new NotFoundException('Không tìm thấy tệp.');
    if (attachment.completed) return { id };
    let actual: number;
    try {
      actual = (await this.storage.objectMetadata(attachment.storageKey)).sizeBytes;
    } catch {
      throw new ConflictException('Tệp chưa tải lên xong. Vui lòng thử lại.');
    }
    if (actual !== attachment.sizeBytes) throw new ConflictException('Dung lượng tệp không khớp với khai báo.');
    await store.completeAttachment(pool, id);
    return { id };
  }

  /** URL tải về có hạn ngắn; ảnh mở thẳng trong trình duyệt (xem trước), tệp khác tải về với đúng tên. */
  async attachmentUrl(principal: TenantUserPrincipal, attachmentId: string): Promise<ChatAttachmentUrl> {
    const id = uuid(attachmentId, 'Mã tệp');
    const pool = await this.databases.pool(principal.tenantId);
    const attachment = await store.findAttachment(pool, id);
    if (!attachment || !attachment.completed || attachment.messageDeleted) throw new NotFoundException('Không tìm thấy tệp.');
    const own = attachment.uploadedBy.toLowerCase() === principal.userId.toLowerCase();
    if (!attachment.messageId && !own) throw new NotFoundException('Không tìm thấy tệp.');
    await this.requireAccess(pool, principal, attachment.conversationId);
    const url = await this.storage.createDownloadUrl(attachment.storageKey, DOWNLOAD_URL_TTL_SECONDS, {
      inline: attachment.isImage || attachment.contentType === 'application/pdf',
      contentType: attachment.contentType,
      fileName: attachment.fileName,
    });
    return { url, expiresAt: new Date(this.now().getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  /* --------------------------------- Nội bộ --------------------------------- */

  private async ensureCompany(principal: TenantUserPrincipal): Promise<ConversationRecord> {
    const pool = await this.databases.pool(principal.tenantId);
    const cached = this.companyIds.get(principal.tenantId);
    const known = cached ? await store.findConversation(pool, cached) : null;
    if (known) return known;
    const record = await store.ensureCompanyConversation(pool, principal.userId);
    this.companyIds.set(principal.tenantId, record.id);
    return record;
  }

  /**
   * Quyền vào một cuộc trò chuyện: cuộc chung toàn công ty là của mọi người; 1-1 và nhóm phải đang là thành viên.
   * Người ngoài nhận "không tìm thấy" để không lộ cuộc trò chuyện có tồn tại.
   */
  private async requireAccess(db: ChatDb, principal: TenantUserPrincipal, conversationId: string, lock = false): Promise<Access> {
    const conversation = await store.findConversation(db, conversationId, lock);
    if (!conversation) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    const member = await store.membershipOf(db, conversationId, principal.userId);
    if (conversation.kind !== 'company' && (!member || member.leftAt)) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return { conversation, member };
  }

  private async ownMessage(db: ChatDb, principal: TenantUserPrincipal, messageId: string) {
    const message = await store.findMessage(db, messageId, true);
    if (!message) throw new NotFoundException('Không tìm thấy tin nhắn.');
    if (message.senderId.toLowerCase() !== principal.userId.toLowerCase() || message.kind !== 'text') {
      throw new ForbiddenException('Chỉ người gửi mới sửa hoặc thu hồi được tin này.');
    }
    if (message.isDeleted) throw new ConflictException('Tin nhắn đã được thu hồi.');
    return message;
  }

  /** Chỉ nhắc được người trong cuộc trò chuyện (cuộc chung: mọi người đang hoạt động). */
  private async filterMentions(db: ChatDb, conversation: ConversationRecord, requested: readonly string[]) {
    if (requested.length === 0) return { kept: [] as string[], dropped: [] as string[] };
    const allowed =
      conversation.kind === 'company'
        ? new Set((await store.activeUsers(db, requested)).map((u) => u.id.toLowerCase()))
        : new Set((await store.activeMembers(db, conversation.id)).map((m) => m.userId.toLowerCase()));
    return {
      kept: requested.filter((id) => allowed.has(id)),
      dropped: requested.filter((id) => !allowed.has(id)),
    };
  }

  private async systemMessage(db: ChatDb, principal: TenantUserPrincipal, conversationId: string, event: ChatSystemEvent): Promise<void> {
    const created = await store.insertMessage(db, {
      conversationId,
      senderId: principal.userId,
      kind: 'system',
      body: '',
      mentions: [],
      replyToId: null,
      clientId: null,
      systemEvent: event,
    });
    await store.markOwnMessage(db, conversationId, principal.userId, created.createdAt);
  }

  private async signalMembers(
    db: ChatDb,
    principal: TenantUserPrincipal,
    conversation: ConversationRecord,
    messageId: string | null,
    change: CoreChatChange,
  ): Promise<void> {
    if (conversation.kind === 'company') {
      await this.signal(db, principal, conversation.id, messageId, change, 'company', []);
      return;
    }
    const members = await store.activeMembers(db, conversation.id);
    await this.signal(db, principal, conversation.id, messageId, change, 'members', members.map((m) => m.userId));
  }

  private signal(
    db: ChatDb,
    principal: TenantUserPrincipal,
    conversationId: string,
    messageId: string | null,
    change: CoreChatChange,
    audience: 'members' | 'company',
    recipientUserIds: readonly string[],
  ): Promise<void> {
    return writeChatSignal(
      db,
      { tenantId: principal.tenantId, conversationId, messageId, change, actorUserId: principal.userId, audience, recipientUserIds },
      this.newId,
    );
  }

  private async loadMessage(principal: TenantUserPrincipal, messageId: string): Promise<ChatMessageView> {
    const message = await store.loadMessageView(await this.databases.pool(principal.tenantId), messageId);
    if (!message) throw new NotFoundException('Không tìm thấy tin nhắn.');
    return message;
  }
}

function unreadTotal(items: readonly ChatConversationView[]): number {
  return items.filter((item) => !item.muted).reduce((sum, item) => sum + item.unreadCount, 0);
}
