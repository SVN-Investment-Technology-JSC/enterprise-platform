import {
  APPROVAL_OUT_OF_SCOPE,
  PROCEDURE_IN_PROGRESS,
  SELF_APPROVAL_FORBIDDEN,
  approvalScopeSql,
  assertCanDecide,
  assertNotSelfDecision,
  computeSubordinateUserIds,
  type HrmApprovalDeps,
  type HrmOrgScopePort,
} from './hrm-approval-policy.js';

const TENANT = 'tenant-1';
const ACTOR = 'user-manager';
const OWNER = 'user-staff';

function fakeDeps(options: {
  ownerUserId?: string | null;
  link?: boolean;
  allowSelf?: boolean;
  subordinates?: string[];
  missing?: boolean;
}): HrmApprovalDeps {
  const orgScope: HrmOrgScopePort = {
    subordinateUserIds: async () => new Set(options.subordinates ?? []),
  };
  return {
    tenantId: TENANT,
    orgScope,
    db: {
      query: async (sql: string) => {
        if (sql.includes('to_regclass'))
          return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('approval_policy_settings'))
          return {
            rows: [{ allow_self_approval: options.allowSelf === true }],
            rowCount: 1,
          };
        if (sql.includes('procedure_links'))
          return {
            rows: options.link ? [{ '?column?': 1 }] : [],
            rowCount: options.link ? 1 : 0,
          };
        if (options.missing) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              employee_id: 'emp-1',
              user_id: 'ownerUserId' in options ? options.ownerUserId : OWNER,
            },
          ],
          rowCount: 1,
        };
      },
    } as never,
  };
}

const manager = { userId: ACTOR, permissions: ['hrm.leave.approve'] };

describe('assertCanDecide', () => {
  it('tự duyệt đơn của chính mình bị 403 SELF_APPROVAL_FORBIDDEN', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ ownerUserId: ACTOR, subordinates: [ACTOR] }),
      ),
    ).rejects.toMatchObject({
      response: { code: SELF_APPROVAL_FORBIDDEN },
      status: 403,
    });
  });

  it('quản trị tenant cũng không được tự duyệt', async () => {
    await expect(
      assertCanDecide(
        { userId: ACTOR, permissions: ['tenant.manage'] },
        { id: 'r1', decision: 'approve' },
        'leave',
        fakeDeps({ ownerUserId: ACTOR }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('cho phép tự duyệt khi tenant bật ngoại lệ', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ ownerUserId: ACTOR, allowSelf: true }),
      ),
    ).resolves.toBeUndefined();
  });

  it('chủ đơn rút đơn (cancel) không bị coi là tự duyệt', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1', decision: 'cancel' },
        'leave',
        fakeDeps({ ownerUserId: ACTOR }),
      ),
    ).resolves.toBeUndefined();
  });

  it('nhân viên khác đơn vị bị 403 APPROVAL_OUT_OF_SCOPE', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ subordinates: ['someone-else'] }),
      ),
    ).rejects.toMatchObject({
      response: { code: APPROVAL_OUT_OF_SCOPE },
      status: 403,
    });
  });

  it('nhân viên chưa liên kết tài khoản chỉ duyệt được bằng approve.all', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ ownerUserId: null, subordinates: [OWNER] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('cấp dưới cùng đơn vị được duyệt', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ subordinates: [OWNER] }),
      ),
    ).resolves.toBeUndefined();
  });

  it('quyền approve.all duyệt toàn tenant dù khác đơn vị', async () => {
    await expect(
      assertCanDecide(
        { userId: ACTOR, permissions: ['hrm.leave.approve.all'] },
        { id: 'r1' },
        'leave',
        fakeDeps({ subordinates: [] }),
      ),
    ).resolves.toBeUndefined();
  });

  it('approve.all của loại đơn khác không có tác dụng', async () => {
    await expect(
      assertCanDecide(
        { userId: ACTOR, permissions: ['hrm.ot.approve.all'] },
        { id: 'r1' },
        'leave',
        fakeDeps({ subordinates: [] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('đơn có liên kết quy trình trả 409 PROCEDURE_IN_PROGRESS', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ subordinates: [OWNER], link: true }),
      ),
    ).rejects.toMatchObject({
      response: { code: PROCEDURE_IN_PROGRESS },
      status: 409,
    });
  });

  it('hủy hiệu lực (reverse) đơn đã duyệt qua Procedure không bị chặn 409 nhưng vẫn kiểm phạm vi', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1', decision: 'reverse' },
        'leave',
        fakeDeps({ subordinates: [OWNER], link: true }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1', decision: 'reverse' },
        'leave',
        fakeDeps({ subordinates: [], link: true }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('đơn không tồn tại trả 404', async () => {
    await expect(
      assertCanDecide(
        manager,
        { id: 'r1' },
        'leave',
        fakeDeps({ missing: true }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('computeSubordinateUserIds', () => {
  const snapshot = {
    units: [
      { id: 'dept', parentId: null, headMembershipId: 'head-user' },
      { id: 'team', parentId: 'dept', headMembershipId: null },
      { id: 'pos-boss', parentId: 'dept' },
      { id: 'pos-staff', parentId: 'team', reportsToPositionId: 'pos-boss' },
      { id: 'pos-other', parentId: 'other' },
    ],
    positions: [
      { id: 'pos-staff', reportsToPositionId: 'pos-boss' },
      { id: 'pos-boss' },
      { id: 'pos-other' },
    ],
    members: [
      { userId: 'boss', unitId: 'pos-boss', positionId: 'pos-boss' },
      { userId: 'staff', unitId: 'pos-staff', positionId: 'pos-staff' },
      { userId: 'stranger', unitId: 'pos-other', positionId: 'pos-other' },
      { userId: 'head-user', unitId: 'pos-other', positionId: 'pos-other' },
      {
        userId: 'overridden',
        unitId: 'pos-staff',
        positionId: 'pos-staff',
        reportsToPositionOverrideId: 'pos-other',
      },
    ],
  };

  it('lấy cấp dưới theo chuỗi báo cáo cho', () => {
    const result = computeSubordinateUserIds(snapshot, 'boss');
    expect([...result]).toEqual(['staff']);
  });

  it('ô ghi đè báo cáo cho thắng giá trị của chức danh', () => {
    expect(
      computeSubordinateUserIds(snapshot, 'stranger').has('overridden'),
    ).toBe(true);
  });

  it('trưởng đơn vị thấy mọi thành viên trong cây đơn vị', () => {
    const result = computeSubordinateUserIds(snapshot, 'head-user');
    expect(result.has('staff')).toBe(true);
    expect(result.has('boss')).toBe(true);
    expect(result.has('stranger')).toBe(false);
    expect(result.has('head-user')).toBe(false);
  });
});

describe('approvalScopeSql', () => {
  it('toàn tenant chỉ loại chính người duyệt', () => {
    const out = approvalScopeSql(
      { all: true, userIds: [], excludeUserId: ACTOR },
      'r',
      3,
    );
    expect(out.params).toEqual([ACTOR]);
    expect(out.sql).toContain('$3::uuid');
  });
  it('theo phạm vi dùng ANY của danh sách cấp dưới', () => {
    const out = approvalScopeSql(
      { all: false, userIds: ['a', 'b'], excludeUserId: null },
      'r',
      4,
    );
    expect(out.params).toEqual([['a', 'b']]);
    expect(out.sql).toContain('ANY($4::uuid[])');
  });
  it('toàn tenant và cho tự duyệt không thêm điều kiện', () => {
    expect(
      approvalScopeSql({ all: true, userIds: [], excludeUserId: null }, 'r', 1),
    ).toEqual({ sql: 'TRUE', params: [] });
  });
});

describe('assertNotSelfDecision (thao tác qua Procedure Engine)', () => {
  it('chặn chủ đơn tự duyệt hoặc từ chối đơn của mình', async () => {
    const deps = fakeDeps({ ownerUserId: ACTOR });
    for (const action of ['APPROVE', 'reject', 'RETURN', 'complete'])
      await expect(
        assertNotSelfDecision({ userId: ACTOR }, 'req-1', 'leave', action, deps),
      ).rejects.toMatchObject({ response: { code: SELF_APPROVAL_FORBIDDEN } });
  });

  it('cho chủ đơn rút đơn (CANCEL)', async () => {
    const deps = fakeDeps({ ownerUserId: ACTOR });
    await expect(
      assertNotSelfDecision({ userId: ACTOR }, 'req-1', 'leave', 'cancel', deps),
    ).resolves.toBeUndefined();
  });

  it('cho người khác xử lý, để PE tự kiểm quyền', async () => {
    const deps = fakeDeps({ ownerUserId: OWNER });
    await expect(
      assertNotSelfDecision({ userId: ACTOR }, 'req-1', 'leave', 'APPROVE', deps),
    ).resolves.toBeUndefined();
  });

  it('cho phép khi tenant bật ngoại lệ tự duyệt', async () => {
    const deps = fakeDeps({ ownerUserId: ACTOR, allowSelf: true });
    await expect(
      assertNotSelfDecision({ userId: ACTOR }, 'req-1', 'leave', 'APPROVE', deps),
    ).resolves.toBeUndefined();
  });
});
