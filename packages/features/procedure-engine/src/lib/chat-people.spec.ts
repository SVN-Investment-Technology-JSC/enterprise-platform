import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { chatPeopleOf } from './chat-people';

const member = (userId: string, displayName: string, extra: Record<string, unknown> = {}) => ({
  membershipId: `m-${userId}`,
  userId,
  displayName,
  email: `${userId}@x.vn`,
  isHead: false,
  ...extra,
});

const unit = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: id,
  name: id,
  typeId: 't',
  typeName: 'Phòng',
  typeCategory: 'unit',
  memberCount: 0,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

function organization(
  members: ReturnType<typeof member>[],
  units: ReturnType<typeof unit>[] = [],
): TenantOrganizationSnapshot {
  return { tenantId: 't', generatedAt: '', unitTypes: [], units, positions: [], members, membershipSubjects: {} } as unknown as TenantOrganizationSnapshot;
}

function instance(patch: Record<string, unknown> = {}): ProcedureInstance {
  return {
    id: 'i1',
    initiatedBy: 'u-init',
    steps: [],
    // Hồ sơ không lưu tên người khởi tạo; tên lấy từ nhật ký thao tác của chính họ.
    activity: [{ id: 'a0', action: 'start', actorId: 'u-init', actorName: 'Người Khởi Tạo', summary: '', createdAt: '' }],
    ...patch,
  } as unknown as ProcedureInstance;
}

const step = (assignments: Record<string, unknown>[], resolutions: unknown[] = []) => ({
  id: 's1',
  assignments,
  resolutions,
});

describe('chatPeopleOf — nhắc NGƯỜI, không nhắc cả chức danh', () => {
  it('mở rộng chức danh thành từng người đang giữ (lỗi gốc: chip "A, B" là một chức danh)', () => {
    const org = organization([
      member('u-quynh', 'Nguyễn Trần Như Quỳnh', { positionId: 'pos-ketoan', positionName: 'Kế toán' }),
      member('u-quyen', 'Bùi Công Quyền', { positionId: 'pos-ketoan', positionName: 'Kế toán' }),
      member('u-khac', 'Người Khác', { positionId: 'pos-khac' }),
    ]);
    const people = chatPeopleOf(
      instance({ steps: [step([{ id: 'a', role: 'A', subjectType: 'position', subjectId: 'pos-ketoan' }])] }),
      org,
    );
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining(['u-quynh', 'u-quyen']));
    expect(people.map((p) => p.name)).toEqual(expect.arrayContaining(['Nguyễn Trần Như Quỳnh', 'Bùi Công Quyền']));
    // Không có "người" nào mang id hay tên của chính chức danh.
    expect(people.some((p) => p.id === 'pos-ketoan')).toBe(false);
    expect(people.some((p) => p.name.includes(','))).toBe(false);
    expect(people.map((p) => p.id)).not.toContain('u-khac');
  });

  it('người khởi tạo luôn có mặt, kèm nhãn', () => {
    const people = chatPeopleOf(instance(), organization([]));
    expect(people).toEqual([{ id: 'u-init', name: 'Người Khởi Tạo', hint: 'Người khởi tạo' }]);
  });

  it('vai giao thẳng cho người dùng tên trong sơ đồ tổ chức, rơi về nhãn của vai khi sơ đồ chưa có', () => {
    const org = organization([member('u-a', 'Tên Trong Sơ Đồ')]);
    const inst = instance({
      steps: [
        step([
          { id: '1', role: 'R', subjectType: 'user', subjectId: 'u-a', subjectLabel: 'Nhãn cũ' },
          { id: '2', role: 'C', subjectType: 'user', subjectId: 'u-b', subjectLabel: 'Chỉ có nhãn' },
        ]),
      ],
    });
    const people = chatPeopleOf(inst, org);
    expect(people.find((p) => p.id === 'u-a')?.name).toBe('Tên Trong Sơ Đồ');
    expect(people.find((p) => p.id === 'u-b')?.name).toBe('Chỉ có nhãn');
  });

  it('vai giao cho đơn vị chỉ gồm TRƯỞNG đơn vị, không gồm mọi thành viên', () => {
    const org = organization(
      [
        member('u-truong', 'Trưởng Phòng', { unitId: 'unit-a', isHead: true }),
        member('u-nv', 'Nhân Viên', { unitId: 'unit-a' }),
      ],
      [unit('unit-a')],
    );
    const people = chatPeopleOf(
      instance({ steps: [step([{ id: 'a', role: 'A', subjectType: 'organization_unit', subjectId: 'unit-a' }])] }),
      org,
    );
    expect(people.map((p) => p.id)).toContain('u-truong');
    expect(people.map((p) => p.id)).not.toContain('u-nv');
  });

  it('đơn vị chưa có trưởng thì leo lên đơn vị cha gần nhất có trưởng', () => {
    const org = organization(
      [member('u-tong', 'Tổng Giám Đốc', { unitId: 'cong-ty', isHead: true })],
      [unit('cong-ty'), unit('phong-con', { parentId: 'cong-ty' })],
    );
    const people = chatPeopleOf(
      instance({ steps: [step([{ id: 'a', role: 'A', subjectType: 'organization_unit', subjectId: 'phong-con' }])] }),
      org,
    );
    expect(people.map((p) => p.id)).toContain('u-tong');
  });

  it('chống vòng lặp trong cây đơn vị bị hỏng', () => {
    const org = organization([], [unit('a', { parentId: 'b' }), unit('b', { parentId: 'a' })]);
    expect(() =>
      chatPeopleOf(
        instance({ steps: [step([{ id: 'x', role: 'A', subjectType: 'organization_unit', subjectId: 'a' }])] }),
        org,
      ),
    ).not.toThrow();
  });

  it('"toàn bộ nhân viên" và "quản lý trực tiếp chưa giải" không biến thành người nào', () => {
    const org = organization([member('u-a', 'A')]);
    const people = chatPeopleOf(
      instance({
        steps: [
          step([
            { id: '1', role: 'S', subjectType: 'everyone', subjectId: '*' },
            { id: '2', role: 'A', subjectType: 'initiator_manager', subjectId: 'rule' },
          ]),
        ],
      }),
      org,
    );
    expect(people.map((p) => p.id)).toEqual(['u-init']);
  });

  it('vai quản lý trực tiếp đã được giải ra người/chức danh lúc chạy thì được tính', () => {
    const org = organization([
      member('u-sep', 'Sếp Trực Tiếp'),
      member('u-p1', 'Người Giữ Chức Danh', { positionId: 'pos-x' }),
    ]);
    const people = chatPeopleOf(
      instance({
        steps: [
          step(
            [],
            [
              { assignmentId: 'a', rule: 'initiator_manager', chain: [], usedFallback: false, resolvedAt: '', resolvedTo: { subjectType: 'user', subjectId: 'u-sep' } },
              { assignmentId: 'b', rule: 'initiator_manager', chain: [], usedFallback: false, resolvedAt: '', resolvedTo: { subjectType: 'position', subjectId: 'pos-x' } },
            ],
          ),
        ],
      }),
      org,
    );
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining(['u-sep', 'u-p1']));
  });

  it('gồm người được ủy quyền và người nhận việc con', () => {
    const org = organization([member('u-uq', 'Người Ủy Quyền')]);
    const people = chatPeopleOf(
      instance({
        delegations: [{ id: 'd', delegatedBy: 'x', delegatedByName: 'X', delegatedTo: 'u-uq', roles: [], createdAt: '' }],
        subtasks: [{ id: 's', assigneeId: 'u-vc', assigneeName: 'Người Việc Con' }],
      }),
      org,
    );
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining(['u-uq', 'u-vc']));
  });

  it('một người xuất hiện ở nhiều vai chỉ được liệt kê một lần', () => {
    const org = organization([member('u-a', 'A', { positionId: 'p1' })]);
    const people = chatPeopleOf(
      instance({
        steps: [
          step([
            { id: '1', role: 'R', subjectType: 'user', subjectId: 'u-a' },
            { id: '2', role: 'A', subjectType: 'position', subjectId: 'p1' },
          ]),
        ],
      }),
      org,
    );
    expect(people.filter((p) => p.id === 'u-a')).toHaveLength(1);
  });

  it('loại chính mình khi được yêu cầu', () => {
    const people = chatPeopleOf(instance(), organization([]), 'u-init');
    expect(people).toEqual([]);
  });

  it('trùng tên hiển thị thì thêm đuôi id để `@Tên` chỉ đúng một người', () => {
    const org = organization([
      member('aaaa1111', 'Nguyễn Văn A', { positionId: 'p' }),
      member('bbbb2222', 'Nguyễn Văn A', { positionId: 'p' }),
    ]);
    const people = chatPeopleOf(
      instance({ steps: [step([{ id: '1', role: 'R', subjectType: 'position', subjectId: 'p' }])] }),
      org,
    );
    const names = people.filter((p) => p.id !== 'u-init').map((p) => p.name);
    expect(new Set(names).size).toBe(2);
    expect(names).toEqual(expect.arrayContaining(['Nguyễn Văn A #aaaa', 'Nguyễn Văn A #bbbb']));
  });

  it('chưa có sơ đồ tổ chức thì vẫn dùng được các tên đã có trong hồ sơ', () => {
    const people = chatPeopleOf(
      instance({ subtasks: [{ id: 's', assigneeId: 'u-vc', assigneeName: 'Người Việc Con' }] }),
      undefined,
    );
    expect(people.map((p) => p.id)).toEqual(['u-init', 'u-vc']);
  });
});
