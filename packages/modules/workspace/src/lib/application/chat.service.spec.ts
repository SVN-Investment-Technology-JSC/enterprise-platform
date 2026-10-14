import type {
  ChatMessage,
  ProjectRole,
  SendChatMessageRequest,
  WorkspaceDocument,
} from '@enterprise-platform/contracts-workspace';
import { ChatService } from './chat.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Store giả tối giản cho nhánh gửi tin. Chỉ dự án `p1` tồn tại; tài liệu và
 * tin nhắn cha được khai theo từng test.
 */
function makeStore(options: {
  roles: Record<string, ProjectRole>;
  documents?: Partial<WorkspaceDocument>[];
  messages?: Partial<ChatMessage>[];
}) {
  const sent: { attachmentDocumentId: string | null; mentions: string[] }[] = [];
  const edits: { mentions: readonly string[]; newlyMentioned: readonly string[] }[] = [];
  const listed: { limit: number; before?: string }[] = [];
  const marked: string[] = [];
  const store = {
    project: {
      findById: async (_tenant: string, id: string) =>
        id === 'p1' ? ({ id: 'p1', code: 'DA-1', name: 'Dự án' } as never) : undefined,
    },
    member: {
      roleOf: async (_tenant: string, _projectId: string, userId: string) =>
        options.roles[userId],
      list: async () =>
        Object.entries(options.roles).map(([userId, role]) => ({ userId, role })),
    },
    workItem: { findById: async () => undefined },
    document: {
      findById: async (_tenant: string, id: string) =>
        options.documents?.find((document) => document.id === id) as
          | WorkspaceDocument
          | undefined,
    },
    chat: {
      findMessage: async (_tenant: string, id: string) =>
        options.messages?.find((message) => message.id === id) as ChatMessage | undefined,
      ensureChannel: async () => ({ id: 'c1', projectId: 'p1' }),
      sendMessage: async (
        _tenant: string,
        _actor: string,
        input: { attachmentDocumentId: string | null; mentions: string[] },
      ) => {
        sent.push({ attachmentDocumentId: input.attachmentDocumentId, mentions: input.mentions });
        return { id: 'm-new' } as ChatMessage;
      },
      markRead: async (_tenant: string, channelId: string) => {
        marked.push(channelId);
      },
      findChannel: async () => ({ id: 'c1', projectId: 'p1' }),
      findChannelById: async () => ({ id: 'c1', projectId: 'p1' }),
      listMessages: async (_tenant: string, _channel: string, limit: number, before?: string) => {
        listed.push({ limit, before });
        return { messages: [{ id: 'm1' }] as ChatMessage[], hasMore: true };
      },
      editMessage: async (
        _tenant: string,
        _actor: string,
        id: string,
        _body: string,
        mentions: readonly string[],
        newlyMentioned: readonly string[],
      ) => {
        edits.push({ mentions, newlyMentioned });
        return { id } as ChatMessage;
      },
    },
  };
  return { store: store as unknown as WorkspaceStore, sent, edits, listed, marked };
}

const actorOf = (userId: string): WorkspaceActor => ({
  tenantId: 't1',
  userId,
  displayName: userId,
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

function serviceFor(store: WorkspaceStore) {
  return new ChatService(store, new ProjectService(store));
}

const toProject: SendChatMessageRequest = {
  entityType: 'project',
  entityId: 'p1',
  body: 'Chào cả nhóm',
};

describe('ChatService — gửi tin', () => {
  it('viewer không gửi được', async () => {
    const { store } = makeStore({ roles: { viewer: 'viewer' } });
    await expect(serviceFor(store).send(actorOf('viewer'), toProject)).rejects.toMatchObject({
      code: 'PROJECT_ROLE_FORBIDDEN',
    });
  });

  it('người ngoài dự án nhận 403', async () => {
    const { store } = makeStore({ roles: {} });
    await expect(serviceFor(store).send(actorOf('stranger'), toProject)).rejects.toMatchObject({
      code: 'PROJECT_FORBIDDEN',
    });
  });

  it('trả lời của một trả lời bị chặn — luồng tối đa hai cấp', async () => {
    const { store } = makeStore({
      roles: { me: 'member' },
      messages: [{ id: 'reply', parentId: 'root' }],
    });
    await expect(
      serviceFor(store).send(actorOf('me'), { ...toProject, parentId: 'reply' }),
    ).rejects.toMatchObject({ code: 'COMMENT_DEPTH_EXCEEDED' });
  });

  it('nhắc người ngoài dự án: tin vẫn gửi, người đó bị loại và báo lại', async () => {
    const { store, sent } = makeStore({ roles: { me: 'member', mate: 'member' } });
    const result = await serviceFor(store).send(actorOf('me'), {
      ...toProject,
      mentions: ['mate', 'outsider'],
    });
    expect(result.droppedMentions).toEqual(['outsider']);
    expect(sent[0]?.mentions).toEqual(['mate']);
  });
});

describe('ChatService — phân trang luồng tin', () => {
  const BEFORE = '11111111-1111-4111-8111-111111111111';

  it('mở luồng lấy trang mới nhất, báo còn tin cũ và đánh dấu đã đọc', async () => {
    const { store, listed, marked } = makeStore({ roles: { me: 'member' } });
    const thread = await serviceFor(store).thread(actorOf('me'), 'project', 'p1');
    expect(thread.hasMore).toBe(true);
    expect(listed).toEqual([{ limit: 50, before: undefined }]);
    expect(marked).toEqual(['c1']);
  });

  it('cuộn lên xem tin cũ: chuyển mốc cho store và KHÔNG đánh dấu đã đọc', async () => {
    const { store, listed, marked } = makeStore({ roles: { me: 'member' } });
    await serviceFor(store).thread(actorOf('me'), 'project', 'p1', BEFORE);
    expect(listed).toEqual([{ limit: 50, before: BEFORE }]);
    expect(marked).toEqual([]);
  });

  it('từ chối mốc không phải id tin nhắn trước khi chạm CSDL', async () => {
    const { store, listed } = makeStore({ roles: { me: 'member' } });
    await expect(
      serviceFor(store).thread(actorOf('me'), 'project', 'p1', "x'; DROP TABLE"),
    ).rejects.toMatchObject({ code: expect.any(String) });
    expect(listed).toEqual([]);
  });

  it('người ngoài dự án không xin được trang cũ', async () => {
    const { store } = makeStore({ roles: {} });
    await expect(
      serviceFor(store).thread(actorOf('stranger'), 'project', 'p1', BEFORE),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
  });
});

describe('ChatService — sửa tin và nhắc tên', () => {
  const stored = (mentions: string[]) =>
    [{ id: 'm1', channelId: 'c1', createdBy: 'me', isDeleted: false, createdAt: new Date().toISOString(), mentions }];

  it('chỉ người mới được nhắc mới được báo; người đã nhắc từ đầu không bị báo lại', async () => {
    const { store, edits } = makeStore({
      roles: { me: 'member', mate: 'member', boss: 'member' },
      messages: stored(['mate']),
    });
    await serviceFor(store).edit(actorOf('me'), 'm1', { body: 'Nhờ @mate @boss', mentions: ['mate', 'boss'] });
    expect(edits).toEqual([{ mentions: ['mate', 'boss'], newlyMentioned: ['boss'] }]);
  });

  it('người ngoài dự án vẫn bị loại khi sửa', async () => {
    const { store, edits } = makeStore({ roles: { me: 'member' }, messages: stored([]) });
    await serviceFor(store).edit(actorOf('me'), 'm1', { body: 'Nhờ @x', mentions: ['outsider'] });
    expect(edits).toEqual([{ mentions: [], newlyMentioned: [] }]);
  });
});

describe('ChatService — tài liệu đính kèm', () => {
  it('nhận tài liệu của chính dự án', async () => {
    const { store, sent } = makeStore({
      roles: { me: 'member' },
      documents: [{ id: 'd1', projectId: 'p1' }],
    });
    await serviceFor(store).send(actorOf('me'), { ...toProject, attachmentDocumentId: 'd1' });
    expect(sent[0]?.attachmentDocumentId).toBe('d1');
  });

  it('nhận tài liệu ở kho dùng chung', async () => {
    const { store, sent } = makeStore({
      roles: { me: 'member' },
      documents: [{ id: 'shared', projectId: undefined }],
    });
    await serviceFor(store).send(actorOf('me'), { ...toProject, attachmentDocumentId: 'shared' });
    expect(sent[0]?.attachmentDocumentId).toBe('shared');
  });

  it('từ chối tài liệu của dự án khác', async () => {
    const { store, sent } = makeStore({
      roles: { me: 'member' },
      documents: [{ id: 'other', projectId: 'p2' }],
    });
    await expect(
      serviceFor(store).send(actorOf('me'), { ...toProject, attachmentDocumentId: 'other' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(sent).toHaveLength(0);
  });

  it('từ chối id tài liệu không tồn tại', async () => {
    const { store } = makeStore({ roles: { me: 'member' } });
    await expect(
      serviceFor(store).send(actorOf('me'), { ...toProject, attachmentDocumentId: 'ghost' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
