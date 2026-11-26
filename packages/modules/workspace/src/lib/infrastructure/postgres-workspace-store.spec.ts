import { chatMessageNoticeEvent, chatSignalEvent, mentionEvent, qualified } from './postgres-workspace-store.js';

describe('chatSignalEvent', () => {
  const message = { id: 'm1', channelId: 'c1', createdBy: 'actor' };
  const channel = { entityType: 'work_item' as const, entityId: 'w1', projectId: 'p1' };

  it('mang định danh và người nhận, không mang nội dung tin', () => {
    const event = chatSignalEvent(message, channel, 'edited', 'actor', ['a', 'b']);
    expect(event).toEqual({
      type: 'workspace.chat.changed',
      aggregateType: 'workspace-chat-message',
      aggregateId: 'm1',
      payload: {
        channelId: 'c1',
        entityType: 'work_item',
        entityId: 'w1',
        projectId: 'p1',
        messageId: 'm1',
        change: 'edited',
        actorUserId: 'actor',
        recipientUserIds: ['a', 'b'],
      },
    });
    expect(JSON.stringify(event)).not.toContain('body');
  });

  it('loại người gửi và trùng lặp khỏi danh sách người nhận', () => {
    const event = chatSignalEvent(message, channel, 'created', 'actor', ['a', 'actor', 'a']);
    expect(event.payload.recipientUserIds).toEqual(['a']);
  });
});

describe('qualified', () => {
  it('gắn tiền tố cho MỌI cột của hằng viết nhiều dòng', () => {
    // Đúng dạng các hằng `*_COLUMNS`: xuống dòng rồi thụt lề sau dấu phẩy.
    const columns = `id, title,
       status, created_by,
       created_at`;
    expect(qualified(columns, 'w')).toBe(
      'w.id, w.title, w.status, w.created_by, w.created_at',
    );
  });

  it('không sinh cột rỗng khi có dấu phẩy thừa ở cuối', () => {
    expect(qualified('id, code,\n', 'p')).toBe('p.id, p.code');
  });
});

describe('chatMessageNoticeEvent', () => {
  const message = {
    id: 'message-1',
    channelId: 'channel-1',
    body: '  Anh xem giúp phần thanh toán nhé  ',
    mentions: ['user-3'],
    createdBy: 'user-1',
  };
  const context = {
    entityType: 'work_item' as const,
    entityId: 'item-1',
    projectId: 'project-1',
    entityLabel: 'CV003 · Thanh toán đợt 1',
    memberUserIds: ['user-1', 'user-2', 'user-3', 'user-2'],
  };

  it('notifies the people of the item except the sender and anyone mentioned (they get the mention notice)', () => {
    expect(chatMessageNoticeEvent(message, context)).toEqual({
      type: 'workspace.chat.message.created',
      aggregateType: 'workspace-chat-message',
      aggregateId: 'message-1',
      payload: {
        messageId: 'message-1',
        threadId: 'channel-1',
        entityType: 'work_item',
        entityId: 'item-1',
        projectId: 'project-1',
        entityLabel: 'CV003 · Thanh toán đợt 1',
        recipientUserIds: ['user-2'],
        actorUserId: 'user-1',
        excerpt: 'Anh xem giúp phần thanh toán nhé',
        deepLink: '/workspace/chat/channel-1?message=message-1',
        sourceType: 'workspace_chat_message',
      },
    });
  });

  it('writes nothing when nobody is left to notify', () => {
    expect(chatMessageNoticeEvent(message, { ...context, memberUserIds: ['user-1', 'user-3'] })).toBeUndefined();
    expect(chatMessageNoticeEvent(message, { ...context, memberUserIds: [] })).toBeUndefined();
  });

  it('truncates a long excerpt and describes an attachment-only message', () => {
    const long = chatMessageNoticeEvent({ ...message, mentions: [], body: 'x'.repeat(500) }, context);
    expect((long?.payload as { excerpt: string }).excerpt).toHaveLength(160);
    const file = chatMessageNoticeEvent(
      { ...message, mentions: [], body: '', attachmentDocumentIds: ['doc-1'] },
      context,
    );
    expect((file?.payload as { excerpt: string }).excerpt).toBe('Đã gửi tệp đính kèm.');
  });
});

describe('mentionEvent', () => {
  it('carries only durable recipient and source facts', () => {
    expect(
      mentionEvent({
        id: 'message-1',
        channelId: 'channel-1',
        body: 'Trao đổi với @An',
        mentions: ['user-2'],
        createdBy: 'user-1',
      }),
    ).toEqual({
      type: 'workspace.mention.created',
      aggregateType: 'workspace-chat-message',
      aggregateId: 'message-1',
      payload: {
        mentionId: 'message-1',
        threadId: 'channel-1',
        mentionedUserIds: ['user-2'],
        actorUserId: 'user-1',
        excerpt: 'Trao đổi với @An',
        deepLink: '/workspace/chat/channel-1?message=message-1',
        sourceType: 'workspace_chat_message',
      },
    });
  });
});
