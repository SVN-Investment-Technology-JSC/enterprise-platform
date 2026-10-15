import {
  CHAT_EDIT_WINDOW_MINUTES,
  CHAT_ENTITY_TYPES,
  CHAT_PAGE_SIZE,
  MAX_CHAT_BODY_LENGTH,
  type ChatEntityType,
  type ChatMessage,
  type ChatThread,
  type ChatTypingRecipients,
  type SendChatMessageRequest,
  type SendChatMessageResponse,
  type UnreadSummary,
  type UpdateChatMessageRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ChatDepthExceededError,
  ChatEditForbiddenError,
  ChatMessageNotFoundError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { requireProjectRole, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ChatService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
  ) {}

  /**
   * Luồng tin của một node.
   *
   * Node chưa từng có ai nhắn vẫn mở được: trả kênh rỗng thay vì `404`. Kênh
   * chỉ sinh khi có người gửi tin đầu tiên.
   */
  async thread(
    actor: WorkspaceActor,
    entityType: string,
    entityId: string,
    before?: string,
  ): Promise<ChatThread> {
    if (before !== undefined && !UUID.test(before)) {
      throw new WorkspaceValidationError('Mốc phân trang "before" phải là id tin nhắn.');
    }
    const target = await this.resolve(actor, entityType, entityId);
    const channel = await this.store.chat.findChannel(
      actor.tenantId,
      target.entityType,
      target.entityId,
    );
    if (!channel) return { messages: [], hasMore: false };

    const page = await this.store.chat.listMessages(
      actor.tenantId,
      channel.id,
      CHAT_PAGE_SIZE,
      before,
    );
    // Xin trang cũ hơn chỉ là cuộn lại quá khứ, không phải xem thêm tin mới.
    if (before) return { channel, messages: page.messages, hasMore: page.hasMore };

    // Mở luồng ra là đã đọc, nhưng chỉ TỚI tin mới nhất vừa trả về: tin đến sau
    // lúc truy vấn trên chưa được hiển thị nên vẫn phải là chưa đọc.
    const newest = page.messages[page.messages.length - 1];
    if (newest) {
      await this.store.chat.markRead(actor.tenantId, channel.id, actor.userId, newest.id, {
        announce: true,
      });
    }
    const readers = await this.store.chat.listReaders(actor.tenantId, channel.id);
    return { channel, messages: page.messages, hasMore: page.hasMore, readers };
  }

  /**
   * Những người cần biết "có người đang nhập" ở một node: thành viên dự án và những người đã
   * mở luồng chat này (quản trị tenant xem được dự án mà không phải thành viên), trừ chính người hỏi.
   *
   * Chỉ người được phép nhắn (`member` trở lên) mới hỏi được, vì viewer không
   * có ô nhập. Dịch vụ realtime gọi hàm này bằng chính cookie của người đang gõ,
   * nên quyền vẫn do module này quyết định, không phải dịch vụ realtime.
   */
  async typingRecipients(
    actor: WorkspaceActor,
    entityType: string,
    entityId: string,
  ): Promise<ChatTypingRecipients> {
    const target = await this.resolve(actor, entityType, entityId);
    requireProjectRole(target.access, 'member');
    const members = await this.store.member.list(actor.tenantId, target.projectId);
    const channel = await this.store.chat.findChannel(actor.tenantId, target.entityType, target.entityId);
    const readers = channel ? await this.store.chat.listReaders(actor.tenantId, channel.id) : [];
    const userIds = new Set([...members.map((member) => member.userId), ...readers.map((reader) => reader.userId)]);
    userIds.delete(actor.userId);
    return { userIds: [...userIds] };
  }

  async send(
    actor: WorkspaceActor,
    input: SendChatMessageRequest,
  ): Promise<SendChatMessageResponse> {
    const target = await this.resolve(actor, input.entityType, input.entityId);
    // Nhắn tin là ghi; `viewer` chỉ đọc.
    requireProjectRole(target.access, 'member');

    const body = requireBody(input.body);
    const parentId = await this.resolveParent(actor, input.parentId);
    const { mentions, dropped } = await this.filterMentions(
      actor,
      target.projectId,
      input.mentions,
    );

    const attachmentDocumentId = await this.resolveAttachment(
      actor,
      target.projectId,
      input.attachmentDocumentId,
    );

    const channel = await this.store.chat.ensureChannel(actor.tenantId, actor.userId, {
      entityType: target.entityType,
      entityId: target.entityId,
      projectId: target.projectId,
    });

    const message = await this.store.chat.sendMessage(actor.tenantId, actor.userId, {
      channelId: channel.id,
      parentId,
      body,
      mentions,
      attachmentDocumentId,
    });

    // Người gửi coi như đã đọc chính tin của mình. Không cần báo cho người khác
    // (tin vừa gửi đã có tín hiệu `created`).
    await this.store.chat.markRead(actor.tenantId, channel.id, actor.userId, message.id);
    return { message, droppedMentions: dropped };
  }

  /**
   * Sửa tin trong cửa sổ 15 phút.
   *
   * Sửa được mãi mãi nghĩa là người khác đã đọc và phản hồi dựa trên một nội
   * dung có thể bị viết lại sau lưng họ. Quản trị viên tenant cũng không được
   * miễn — đây là chuyện toàn vẹn của cuộc trao đổi, không phải phân quyền.
   */
  async edit(
    actor: WorkspaceActor,
    messageId: string,
    input: UpdateChatMessageRequest,
  ): Promise<ChatMessage> {
    const { message, projectId } = await this.loadMessage(actor, messageId);
    if (message.createdBy !== actor.userId) {
      throw new ChatEditForbiddenError('Chỉ người gửi mới sửa được tin nhắn của mình.');
    }
    if (message.isDeleted) {
      throw new ChatEditForbiddenError('Tin nhắn đã thu hồi, không sửa lại được.');
    }
    const ageMinutes = (Date.now() - new Date(message.createdAt).getTime()) / 60_000;
    if (ageMinutes > CHAT_EDIT_WINDOW_MINUTES) {
      throw new ChatEditForbiddenError(
        `Chỉ sửa được tin nhắn trong ${CHAT_EDIT_WINDOW_MINUTES} phút đầu.`,
      );
    }

    const body = requireBody(input.body);
    const { mentions } = await this.filterMentions(actor, projectId, input.mentions);
    const alreadyMentioned = new Set(message.mentions);
    return this.store.chat.editMessage(
      actor.tenantId,
      actor.userId,
      messageId,
      body,
      mentions,
      mentions.filter((userId) => !alreadyMentioned.has(userId)),
    );
  }

  /**
   * Thu hồi tin nhắn.
   *
   * Xoá mềm: dòng ở lại để các trả lời bên dưới không mất ngữ cảnh.
   *
   * CHỈ người gửi mới thu hồi được tin của chính mình. Không ai khác được thu hồi
   * hộ — kể cả chủ dự án, quản lý hay quản trị viên tenant: tin nhắn là lời của
   * người gửi, và người khác đã đọc, trả lời dựa trên nó. Cũng giống việc sửa tin,
   * đây là chuyện toàn vẹn của cuộc trao đổi chứ không phải phân quyền.
   */
  async remove(actor: WorkspaceActor, messageId: string): Promise<ChatMessage> {
    // Vẫn đi qua `loadMessage` để người ngoài dự án nhận 403 trước, không biết tin có tồn tại.
    const { message } = await this.loadMessage(actor, messageId);
    if (message.createdBy !== actor.userId) {
      throw new ChatEditForbiddenError('Chỉ người gửi mới thu hồi được tin nhắn của mình.');
    }
    return this.store.chat.softDeleteMessage(actor.tenantId, actor.userId, messageId);
  }

  /**
   * Số tin chưa đọc của cả cây, trong một lời gọi.
   *
   * `rolledUp` cộng dồn lên nhánh cha: một tin nhắn ở node sâu vẫn phải nhìn
   * thấy được khi nhánh đang thu gọn, nếu không người dùng sẽ không bao giờ
   * biết là có.
   */
  async unread(actor: WorkspaceActor, projectId: string): Promise<UnreadSummary> {
    await this.projects.access(actor, projectId);

    const rows = await this.store.chat.unreadByProject(actor.tenantId, projectId, actor.userId);
    const byNode: Record<string, number> = {};
    for (const row of rows) byNode[row.entityId] = row.unread;

    const items = await this.store.workItem.listByProject(actor.tenantId, projectId);
    const parentOf = new Map(items.map((item) => [item.id, item.parentId]));

    const rolledUp: Record<string, number> = { ...byNode };
    for (const [nodeId, count] of Object.entries(byNode)) {
      if (count === 0) continue;
      // Đi ngược lên gốc, cộng dồn. `seen` chặn vòng lặp phòng khi dữ liệu
      // cây bị hỏng — thà cộng thiếu còn hơn treo cả request.
      const seen = new Set<string>([nodeId]);
      let cursor = parentOf.get(nodeId) ?? undefined;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        rolledUp[cursor] = (rolledUp[cursor] ?? 0) + count;
        cursor = parentOf.get(cursor) ?? undefined;
      }
      // Node gốc của cây vẫn thuộc về dự án, nên dự án luôn nhận phần cộng dồn.
      if (nodeId !== projectId) {
        rolledUp[projectId] = (rolledUp[projectId] ?? 0) + count;
      }
    }

    return {
      byNode,
      rolledUp,
      total: Object.values(byNode).reduce((sum, count) => sum + count, 0),
    };
  }

  /* ------------------------------------------------------------ nội bộ */

  /**
   * Phân giải node được nhắn tới và quyền truy cập dự án chứa nó.
   *
   * Không dùng `project_id` do client gửi lên: nó là thứ người gọi tự khai,
   * nên phải suy ra từ chính node để không ai nhắn xuyên dự án.
   */
  private async resolve(actor: WorkspaceActor, entityType: string, entityId: string) {
    if (!(CHAT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      throw new WorkspaceValidationError(`Loại node "${entityType}" không hỗ trợ chat.`);
    }
    const kind = entityType as ChatEntityType;

    if (kind === 'project') {
      const access = await this.projects.access(actor, entityId);
      return { entityType: kind, entityId, projectId: access.project.id, access };
    }

    const item = await this.store.workItem.findById(actor.tenantId, entityId);
    if (!item) throw new WorkItemNotFoundError(entityId);
    const access = await this.projects.access(actor, item.projectId);
    return { entityType: kind, entityId, projectId: item.projectId, access };
  }

  private async loadMessage(actor: WorkspaceActor, messageId: string) {
    const message = await this.store.chat.findMessage(actor.tenantId, messageId);
    if (!message) throw new ChatMessageNotFoundError(messageId);

    // Kênh mang sẵn `project_id`, nên quyền suy ra được mà không cần biết
    // node nào đang chứa luồng này.
    const channel = await this.store.chat.findChannelById(actor.tenantId, message.channelId);
    if (!channel) throw new ChatMessageNotFoundError(messageId);

    const access = await this.projects.access(actor, channel.projectId);
    return { message, projectId: channel.projectId, access };
  }

  /** Trả lời của trả lời bị chặn: luồng chỉ sâu tối đa hai cấp. */
  private async resolveParent(
    actor: WorkspaceActor,
    parentId: string | undefined,
  ): Promise<string | null> {
    if (!parentId) return null;
    const parent = await this.store.chat.findMessage(actor.tenantId, parentId);
    if (!parent) throw new ChatMessageNotFoundError(parentId);
    if (parent.parentId) throw new ChatDepthExceededError();
    return parent.id;
  }

  /**
   * Tài liệu đính kèm phải thuộc chính dự án này hoặc kho dùng chung.
   *
   * Cột `attachment_document_id` không có khoá ngoại (đa hình), nên không
   * kiểm ở đây thì một id bất kỳ — của dự án khác, hoặc không tồn tại — sẽ
   * được lưu nguyên và hiện ra như một tệp đính kèm hỏng.
   */
  private async resolveAttachment(
    actor: WorkspaceActor,
    projectId: string,
    documentId: string | null | undefined,
  ): Promise<string | null> {
    if (!documentId) return null;
    const document = await this.store.document.findById(actor.tenantId, documentId);
    if (!document || (document.projectId && document.projectId !== projectId)) {
      throw new WorkspaceValidationError(
        'Tài liệu đính kèm phải thuộc dự án này hoặc kho tài liệu dùng chung.',
      );
    }
    return document.id;
  }

  /**
   * Giữ lại những lượt nhắc trỏ tới thành viên thật của dự án.
   *
   * Id lạ bị loại nhưng tin vẫn gửi đi — chặn cả tin chỉ vì gõ nhầm một cái
   * tên là quá tay. Danh sách bị loại trả về để giao diện nói rõ ai sẽ không
   * nhận được thông báo.
   */
  private async filterMentions(
    actor: WorkspaceActor,
    projectId: string,
    mentions: readonly string[] | undefined,
  ): Promise<{ mentions: string[]; dropped: string[] }> {
    const requested = [...new Set(mentions ?? [])].filter(Boolean);
    if (requested.length === 0) return { mentions: [], dropped: [] };

    const members = await this.store.member.list(actor.tenantId, projectId);
    const allowed = new Set(members.map((member) => member.userId));
    return {
      mentions: requested.filter((userId) => allowed.has(userId)),
      dropped: requested.filter((userId) => !allowed.has(userId)),
    };
  }
}

function requireBody(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError('Nội dung tin nhắn không được để trống.');
  if (text.length > MAX_CHAT_BODY_LENGTH) {
    throw new WorkspaceValidationError(
      `Tin nhắn không được dài quá ${MAX_CHAT_BODY_LENGTH} ký tự.`,
    );
  }
  return text;
}
