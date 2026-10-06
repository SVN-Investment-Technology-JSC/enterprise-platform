import { mentionEvent, qualified } from './postgres-workspace-store.js';

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
