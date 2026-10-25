import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
jest.mock('./hrm-approval-policy', () => ({
  ...jest.requireActual('./hrm-approval-policy'),
  participatesInProcedureOfRequest: jest.fn(async () => false),
}));
import { participatesInProcedureOfRequest } from './hrm-approval-policy';
import {
  assertCanWrite,
  canReadAllRequests,
  createComment,
  hasApprovePermission,
  listComments,
  normalizeRequestKind,
  resolveThreadAccess,
  mentionableUserIds,
  searchMentionCandidates,
  validateCommentBody,
  validMentions,
  type RequestOwner,
  assertThreadOpen,
  isThreadClosed,
} from './hrm-request-comment';

const TENANT = 'tenant-1';
const OWNER_USER = '00000000-0000-4000-8000-0000000000a1';
const BOSS = '00000000-0000-4000-8000-0000000000b1';
const PEER = '00000000-0000-4000-8000-0000000000c1';
const REQ = '00000000-0000-4000-8000-0000000000d1';
const owner: RequestOwner = { employeeId: 'emp-1', employeeName: 'Nguyễn Văn A', userId: OWNER_USER };

function fakeDb(handlers: { match: RegExp; rows: unknown[] }[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const h = handlers.find((x) => x.match.test(sql));
      return { rows: h?.rows ?? [], rowCount: h?.rows.length ?? 0 };
    }),
  };
  return { db, calls };
}

describe('normalizeRequestKind', () => {
  it('nhận loại đơn chữ hoa của màn duyệt và chữ thường của API', () => {
    expect(normalizeRequestKind('LEAVE')).toBe('leave');
    expect(normalizeRequestKind('ATTENDANCE')).toBe('correction');
    expect(normalizeRequestKind('PROFILE')).toBe('profile_correction');
    expect(normalizeRequestKind('business-trip')).toBe('business_trip');
    expect(() => normalizeRequestKind('khac')).toThrow(BadRequestException);
    expect(() => normalizeRequestKind(undefined)).toThrow(BadRequestException);
  });
});

describe('validateCommentBody', () => {
  it('bỏ khoảng trắng đầu cuối, từ chối rỗng và quá dài', () => {
    expect(validateCommentBody('  Đồng ý  ')).toBe('Đồng ý');
    expect(() => validateCommentBody('   ')).toThrow(BadRequestException);
    expect(() => validateCommentBody(undefined)).toThrow(BadRequestException);
    expect(() => validateCommentBody('x'.repeat(4001))).toThrow('tối đa 4000');
  });
});

describe('quyền xem và viết trong luồng trao đổi', () => {
  const resolve = (actor: { userId: string; permissions?: string[] }, inScope: boolean, mentioned = false) =>
    resolveThreadAccess(
      fakeDb([{ match: /request_comments/, rows: mentioned ? [{ '?column?': 1 }] : [] }]).db,
      TENANT,
      actor,
      'leave',
      REQ,
      owner,
      async () => inScope,
    );

  it('chủ đơn luôn được; người quản trị xem được mọi đơn', async () => {
    expect(await resolve({ userId: OWNER_USER }, false)).toBe('OWNER');
    expect(await resolve({ userId: PEER, permissions: ['hrm.request.read'] }, false)).toBe('ALL');
    expect(await resolve({ userId: PEER, permissions: ['hrm.request.approve.all'] }, false)).toBe('ALL');
    expect(await resolve({ userId: PEER, permissions: ['hrm.manage'] }, false)).toBe('ALL');
  });

  it('người duyệt chỉ được khi đơn thuộc phạm vi cấp dưới của họ', async () => {
    const boss = { userId: BOSS, permissions: ['hrm.request.approve'] };
    expect(await resolve(boss, true)).toBe('APPROVER');
    expect(await resolve(boss, false)).toBeNull();
    // quyền duyệt cũ theo từng loại đơn đã gộp, không còn tác dụng
    expect(await resolve({ userId: BOSS, permissions: ['hrm.ot.approve'] }, true)).toBeNull();
  });

  it('người được nhắc tên trong luồng được đọc và trả lời; người lạ thì không', async () => {
    expect(await resolve({ userId: PEER, permissions: [] }, false, true)).toBe('PARTICIPANT');
    const stranger = await resolve({ userId: PEER, permissions: [] }, false, false);
    expect(stranger).toBeNull();
    expect(() => assertCanWrite(stranger)).toThrow(ForbiddenException);
  });

  it('người tham gia quy trình của đơn (chưa tới lượt) được vào luồng như người tham gia', async () => {
    (participatesInProcedureOfRequest as jest.Mock).mockResolvedValueOnce(true);
    expect(await resolve({ userId: PEER, permissions: [] }, false, false)).toBe('PARTICIPANT');
  });

  it('hàm quyền thuần', () => {
    expect(canReadAllRequests({ userId: 'x', permissions: ['hrm.request.approve'] }, 'leave')).toBe(false);
    expect(canReadAllRequests({ userId: 'x', permissions: ['hrm.request.approve.all'] }, 'ot')).toBe(true);
    expect(hasApprovePermission({ userId: 'x', permissions: ['hrm.request.approve'] }, 'business_trip')).toBe(true);
    expect(hasApprovePermission({ userId: 'x', permissions: ['hrm.trip.approve'] }, 'leave')).toBe(false);
  });
});

describe('mentionableUserIds', () => {
  it('gồm chủ đơn, người tạo hộ và người đã tham gia luồng trao đổi, không gồm ai khác', async () => {
    const { db } = fakeDb([
      { match: /submitted_by/, rows: [{ submitted_by: BOSS }] },
      { match: /request_comments/, rows: [{ author_user_id: PEER, mention_user_ids: [REQ] }] },
    ]);
    const people = await mentionableUserIds(db, TENANT, 'leave', REQ, owner);
    expect([...people].sort()).toEqual([OWNER_USER, BOSS, PEER, REQ].sort());
  });

  it('đơn chưa có người tạo hộ hay trao đổi thì chỉ có chủ đơn', async () => {
    const people = await mentionableUserIds(fakeDb().db, TENANT, 'ot', REQ, owner);
    expect([...people]).toEqual([OWNER_USER]);
  });
});

describe('validMentions', () => {
  it('chỉ giữ người dùng thuộc tenant, bỏ chính mình, bỏ trùng và id sai định dạng', async () => {
    const { db, calls } = fakeDb([{ match: /core_schema\.employees/, rows: [{ user_id: PEER }] }]);
    const result = await validMentions(db, TENANT, BOSS, [PEER, PEER, BOSS, 'khong-phai-uuid', 5]);
    expect(result).toEqual([PEER]);
    expect(calls[0].params[1]).toEqual([PEER]);
    expect(await validMentions(fakeDb().db, TENANT, BOSS, undefined)).toEqual([]);
  });

  it('nhắc người ngoài phạm vi liên quan tới đơn thì bị từ chối', async () => {
    const { db } = fakeDb([{ match: /core_schema.employees/, rows: [{ user_id: PEER }] }]);
    await expect(validMentions(db, TENANT, BOSS, [PEER], new Set([OWNER_USER]))).rejects.toThrow('liên quan tới đơn');
    expect(await validMentions(db, TENANT, BOSS, [PEER], new Set([PEER]))).toEqual([PEER]);
  });

  it('quá nhiều người nhắc một lần bị từ chối', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await expect(validMentions(fakeDb().db, TENANT, BOSS, many)).rejects.toThrow('tối đa 20');
  });
});

describe('createComment: ghi bình luận và sự kiện thông báo cùng giao dịch', () => {
  const base = {
    tenantId: TENANT,
    kind: 'leave' as const,
    requestId: REQ,
    owner,
    body: 'Cho em xin thêm giấy tờ nhé',
    commentKind: 'COMMENT' as const,
    decision: null,
  };
  const events = (calls: { sql: string; params: unknown[] }[]) =>
    calls.filter((c) => c.sql.includes('outbox_events')).map((c) => ({ type: c.params[2] as string, payload: JSON.parse(String(c.params[4])).payload }));
  const withInsert = () => fakeDb([{ match: /INSERT INTO hrm_schema\.request_comments/, rows: [{ id: 'cm-1', created_at: new Date('2026-10-11T03:00:00Z') }] }]);

  it('người duyệt viết: chủ đơn nhận thông báo, người được nhắc nhận thông báo riêng, không báo cho người duyệt', async () => {
    const { db, calls } = withInsert();
    const result = await createComment(db, {
      ...base,
      actor: { userId: BOSS, name: 'Trần Quản Lý' },
      access: 'APPROVER',
      mentionUserIds: [PEER],
    });
    expect(result).toEqual({ id: 'cm-1', createdAt: '2026-10-11T03:00:00.000Z' });
    const types = events(calls).map((e) => e.type);
    expect(types).toEqual(['hrm.request.comment.mentioned', 'hrm.request.comment.to-requester']);
    const mention = events(calls)[0].payload;
    expect(mention.mentionedUserIds).toEqual([PEER]);
    expect(mention.summary).toContain('Trần Quản Lý trao đổi về đơn nghỉ phép của Nguyễn Văn A');
    expect(mention.deepLink).toBe(`/modules/hrm/approvals?request=${REQ}&comment=cm-1`);
    const toRequester = events(calls)[1].payload;
    expect(toRequester.recipientUserIds).toEqual([OWNER_USER]);
    expect(toRequester.deepLink).toBe(`/modules/hrm/requests?request=${REQ}&comment=cm-1`);
  });

  it('chủ đơn trả lời: báo cho người có quyền duyệt loại đơn, không tự báo cho mình', async () => {
    const { db, calls } = withInsert();
    await createComment(db, { ...base, actor: { userId: OWNER_USER, name: 'Nguyễn Văn A' }, access: 'OWNER', mentionUserIds: [] });
    const list = events(calls);
    expect(list.map((e) => e.type)).toEqual(['hrm.request.comment.to-approvers']);
    expect(list[0].payload.approvalPermissions).toEqual(['hrm.request.approve.all', 'hrm.manage']);
  });

  it('ý kiến kèm quyết định có lời nêu rõ đã duyệt hay từ chối; nhắc chính chủ đơn thì chỉ báo một lần', async () => {
    const { db, calls } = withInsert();
    await createComment(db, {
      ...base,
      actor: { userId: BOSS, name: 'Trần Quản Lý' },
      access: 'APPROVER',
      body: 'Duyệt, nhớ bàn giao việc',
      commentKind: 'DECISION',
      decision: 'APPROVE',
      mentionUserIds: [OWNER_USER],
    });
    const list = events(calls);
    expect(list.map((e) => e.type)).toEqual(['hrm.request.comment.mentioned']);
    expect(list[0].payload.summary).toContain('đã phê duyệt đơn nghỉ phép của Nguyễn Văn A: Duyệt, nhớ bàn giao việc');
    expect(list[0].payload.deepLink).toBe(`/modules/hrm/requests?request=${REQ}&comment=cm-1`);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.request_comments'));
    expect(insert?.params.slice(5, 8)).toEqual(['DECISION', 'APPROVE', 'Duyệt, nhớ bàn giao việc']);
  });

  it('trích nội dung dài trong thông báo', async () => {
    const { db, calls } = withInsert();
    await createComment(db, { ...base, actor: { userId: BOSS, name: 'Q' }, access: 'APPROVER', body: 'a'.repeat(500), mentionUserIds: [] });
    expect(events(calls)[0].payload.summary.length).toBeLessThan(260);
    expect(events(calls)[0].payload.summary.endsWith('…')).toBe(true);
  });
});

describe('listComments', () => {
  it('gắn tên người được nhắc và cờ mine theo người đang xem', async () => {
    const { db } = fakeDb([
      {
        match: /FROM hrm_schema\.request_comments/,
        rows: [
          { id: 'c1', request_kind: 'leave', request_id: REQ, author_user_id: BOSS, author_name: 'Q', kind: 'COMMENT', decision: null, body: 'Chào @Bình', mention_user_ids: [PEER], created_at: '2026-10-11T03:00:00Z' },
          { id: 'c2', request_kind: 'leave', request_id: REQ, author_user_id: OWNER_USER, author_name: 'A', kind: 'DECISION', decision: 'APPROVE', body: 'ok', mention_user_ids: [], created_at: '2026-10-11T04:00:00Z' },
        ],
      },
      { match: /FROM core_schema\.employees/, rows: [{ user_id: PEER, full_name: 'Lê Văn Bình' }] },
    ]);
    const list = await listComments(db, TENANT, 'leave', REQ, OWNER_USER);
    expect(list.map((c) => c.mine)).toEqual([false, true]);
    expect(list[0].mentions).toEqual([{ userId: PEER, name: 'Lê Văn Bình' }]);
    expect(list[1]).toMatchObject({ kind: 'DECISION', decision: 'APPROVE', createdAt: '2026-10-11T04:00:00.000Z' });
  });
});

const ALLOWED = new Set([PEER, BOSS]);

describe('searchMentionCandidates', () => {
  it('tìm theo tên không dấu hoặc mã, tối đa 20 người', async () => {
    const rows = [
      { user_id: PEER, full_name: 'Lê Văn Bình', employee_code: 'NV010', department_name: 'Kho' },
      { user_id: BOSS, full_name: 'Trần Thị Hoa', employee_code: 'NV011', department_name: null },
    ];
    const { db } = fakeDb([{ match: /core_schema\.employees/, rows }]);
    expect((await searchMentionCandidates(db, TENANT, 'binh', OWNER_USER, ALLOWED)).map((c) => c.userId)).toEqual([PEER]);
    expect((await searchMentionCandidates(db, TENANT, 'NV011', OWNER_USER, ALLOWED)).map((c) => c.userId)).toEqual([BOSS]);
    expect(await searchMentionCandidates(db, TENANT, '', OWNER_USER, ALLOWED)).toHaveLength(2);
    expect(await searchMentionCandidates(db, TENANT, 'khongco', OWNER_USER, ALLOWED)).toEqual([]);
  });

  it('chỉ tìm trong những người liên quan tới đơn, không có ai liên quan thì không truy vấn', async () => {
    const { db, calls } = fakeDb([{ match: /core_schema.employees/, rows: [] }]);
    await searchMentionCandidates(db, TENANT, '', OWNER_USER, ALLOWED);
    expect(calls[0].params[2]).toEqual([PEER, BOSS]);
    const none = fakeDb();
    expect(await searchMentionCandidates(none.db, TENANT, '', OWNER_USER, new Set())).toEqual([]);
    expect(none.calls).toHaveLength(0);
  });
});

describe('luồng trao đổi theo trạng thái đơn', () => {
  it('đơn đang xử lý hoặc chưa biết trạng thái thì còn mở', () => {
    for (const status of ['PENDING', 'PEER_CONFIRMED', undefined]) {
      expect(isThreadClosed(status)).toBe(false);
      expect(() => assertThreadOpen(status, 'COMMENT')).not.toThrow();
    }
  });

  it('đơn đã huỷ/rút khoá cả bình luận lẫn ý kiến quyết định', () => {
    expect(isThreadClosed('CANCELLED')).toBe(true);
    expect(() => assertThreadOpen('CANCELLED', 'COMMENT')).toThrow(ConflictException);
    expect(() => assertThreadOpen('CANCELLED', 'DECISION')).toThrow(ConflictException);
  });

  it('đơn đã hoàn tất chỉ còn nhận ý kiến kèm quyết định', () => {
    for (const status of ['APPROVED', 'REJECTED', 'DISBURSED', 'REPAID']) {
      expect(isThreadClosed(status)).toBe(true);
      expect(() => assertThreadOpen(status, 'COMMENT')).toThrow(ConflictException);
      expect(() => assertThreadOpen(status, 'DECISION')).not.toThrow();
    }
  });
});
