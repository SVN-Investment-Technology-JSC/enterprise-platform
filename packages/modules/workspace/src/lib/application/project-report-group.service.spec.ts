import type { Project, ProjectReportGroup, ProjectRole } from '@enterprise-platform/contracts-workspace';
import {
  PROJECT_REPORT_GROUPS_KEY,
  ProjectReportGroupService,
  buildReportGroups,
  canSetProjectReportGroup,
  knownReportGroupId,
  parseReportGroups,
} from './project-report-group.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const admin: WorkspaceActor = {
  tenantId: 't1',
  userId: 'admin',
  displayName: 'Admin',
  isTenantAdmin: true,
  canManage: true,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};
const plain: WorkspaceActor = { ...admin, userId: 'u1', isTenantAdmin: false, canManage: false };

const catalog = (): ProjectReportGroup[] => [
  { id: 'g-dv', name: 'Dịch vụ', sortOrder: 0 },
  { id: 'g-tn', name: 'Thí nghiệm', sortOrder: 1 },
];

const project = (patch: Partial<Project> = {}): Project =>
  ({
    id: 'p1',
    code: 'DA-001',
    name: 'Dự án A',
    status: 'active',
    ownerUserId: 'owner',
    createdBy: 'creator',
    reportGroupId: null,
    metadata: {},
    ...patch,
  }) as Project;

function setup(options: { stored?: unknown; project?: Project; role?: ProjectRole } = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  let stored: unknown = 'stored' in options ? options.stored : catalog();
  const store = {
    settings: {
      get: async (_tenantId: string, key: string) => (key === PROJECT_REPORT_GROUPS_KEY ? stored : undefined),
      set: async (...args: unknown[]) => {
        calls.push({ op: 'set', args });
        stored = args[2];
      },
    },
    project: {
      findById: async () => options.project,
      setReportGroup: async (...args: unknown[]) => {
        calls.push({ op: 'setReportGroup', args });
        return { ...options.project, reportGroupId: args[2] };
      },
      clearReportGroups: async (...args: unknown[]) => calls.push({ op: 'clearReportGroups', args }),
    },
    member: { roleOf: async () => options.role },
  } as unknown as WorkspaceStore;
  let counter = 0;
  const service = new ProjectReportGroupService(store, () => `new-${++counter}`);
  return { service, calls };
}

describe('ProjectReportGroupService — danh mục nhóm báo cáo', () => {
  it('ai cũng đọc được; chỉ quản trị được lưu', async () => {
    const { service, calls } = setup();
    expect(await service.list(plain)).toEqual({ items: catalog(), canEdit: false });
    expect((await service.list(admin)).canEdit).toBe(true);
    expect((await service.list({ ...plain, canManage: true })).canEdit).toBe(true);
    await expect(service.save(plain, { items: [{ name: 'Bán hàng' }] })).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toEqual([]);
  });

  it('lưu: giữ id nhóm cũ, sinh id cho nhóm mới, thứ tự theo danh sách gửi lên', async () => {
    const { service, calls } = setup();
    const result = await service.save(admin, {
      items: [{ name: '  O&M ' }, { id: 'g-tn', name: 'Thí   nghiệm điện' }, { id: 'g-dv', name: 'Dịch vụ' }],
    });
    const expected = [
      { id: 'new-1', name: 'O&M', sortOrder: 0 },
      { id: 'g-tn', name: 'Thí nghiệm điện', sortOrder: 1 },
      { id: 'g-dv', name: 'Dịch vụ', sortOrder: 2 },
    ];
    expect(result).toEqual({ items: expected, canEdit: true });
    expect(calls).toEqual([{ op: 'set', args: ['t1', PROJECT_REPORT_GROUPS_KEY, expected, 'admin'] }]);
  });

  it('nhóm bị bỏ khỏi danh sách: dự án đang gán nhóm đó về chưa phân nhóm', async () => {
    const { service, calls } = setup();
    await service.save(admin, { items: [{ id: 'g-tn', name: 'Thí nghiệm' }] });
    expect(calls[1]).toEqual({ op: 'clearReportGroups', args: ['t1', ['g-dv']] });
  });

  it('danh mục chưa có hoặc dữ liệu hỏng thì đọc ra rỗng / bỏ dòng hỏng', async () => {
    expect((await setup({ stored: undefined }).service.list(plain)).items).toEqual([]);
    expect(
      parseReportGroups([
        { id: 'b', name: 'Bán hàng', sortOrder: 2 },
        { id: 'a', name: ' Dịch vụ ', sortOrder: 1 },
        { id: 'a', name: 'Trùng id', sortOrder: 3 },
        { id: '', name: 'Không id' },
        { id: 'c', name: '   ' },
        null,
        'rác',
      ]),
    ).toEqual([
      { id: 'a', name: 'Dịch vụ', sortOrder: 1 },
      { id: 'b', name: 'Bán hàng', sortOrder: 2 },
    ]);
    expect(parseReportGroups({ not: 'array' })).toEqual([]);
  });
});

describe('buildReportGroups — kiểm tra danh sách', () => {
  const id = () => 'x';

  it('tên rỗng, quá 80 ký tự, trùng tên không phân biệt hoa thường đều bị chặn', () => {
    expect(() => buildReportGroups({ items: [{ name: '  ' }] }, [], id)).toThrow('không được để trống');
    expect(() => buildReportGroups({ items: [{ name: 'a'.repeat(81) }] }, [], id)).toThrow('80 ký tự');
    expect(buildReportGroups({ items: [{ name: 'a'.repeat(80) }] }, [], id)[0]?.name).toHaveLength(80);
    expect(() =>
      buildReportGroups({ items: [{ name: 'Dịch vụ' }, { name: 'DỊCH  VỤ' }] }, [], id),
    ).toThrow('Trùng tên nhóm báo cáo');
  });

  it('tối đa 30 nhóm; danh sách sai dạng báo lỗi', () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ name: `Nhóm ${index}` }));
    expect(() => buildReportGroups({ items: many }, [], id)).toThrow('Tối đa 30');
    let n = 0;
    expect(buildReportGroups({ items: many.slice(0, 30) }, [], () => `id-${n++}`)).toHaveLength(30);
    expect(() => buildReportGroups(undefined, [], id)).toThrow('không hợp lệ');
    expect(() => buildReportGroups({ items: 'x' } as never, [], id)).toThrow('không hợp lệ');
  });

  it('id lạ hoặc gửi hai lần cùng id bị chặn; id rỗng là nhóm mới', () => {
    expect(() => buildReportGroups({ items: [{ id: 'ghost', name: 'Ma' }] }, catalog(), id)).toThrow(
      'không còn trong danh mục',
    );
    expect(() =>
      buildReportGroups({ items: [{ id: 'g-dv', name: 'A' }, { id: 'g-dv', name: 'B' }] }, catalog(), id),
    ).toThrow('gửi hai lần');
    expect(buildReportGroups({ items: [{ id: '', name: 'Mới' }] }, catalog(), () => 'fresh')).toEqual([
      { id: 'fresh', name: 'Mới', sortOrder: 0 },
    ]);
  });

  it('danh sách rỗng là xoá hết nhóm', () => {
    expect(buildReportGroups({ items: [] }, catalog(), id)).toEqual([]);
  });
});

describe('canSetProjectReportGroup — ai được đổi nhóm báo cáo của dự án', () => {
  const someone = { userId: 'u9', isTenantAdmin: false, canAdminProjects: false };
  const target = { createdBy: 'creator', ownerUserId: 'owner' };

  it('quản trị tenant và người giữ workspace.project.admin luôn được', () => {
    expect(canSetProjectReportGroup({ ...someone, isTenantAdmin: true }, target, undefined)).toBe(true);
    expect(canSetProjectReportGroup({ ...someone, canAdminProjects: true }, target, undefined)).toBe(true);
  });

  it('mọi thành viên, kể cả người xem, được', () => {
    for (const role of ['owner', 'manager', 'member', 'viewer', 'custom_role'] as ProjectRole[]) {
      expect(canSetProjectReportGroup(someone, target, role)).toBe(true);
    }
  });

  it('người tạo hoặc chủ nhiệm dù không còn trong danh sách thành viên vẫn được; người ngoài thì không', () => {
    expect(canSetProjectReportGroup({ ...someone, userId: 'creator' }, target, undefined)).toBe(true);
    expect(canSetProjectReportGroup({ ...someone, userId: 'owner' }, target, undefined)).toBe(true);
    expect(canSetProjectReportGroup(someone, target, undefined)).toBe(false);
  });
});

describe('ProjectReportGroupService.setForProject', () => {
  it('thành viên gán nhóm có trong danh mục; store nhận đúng id', async () => {
    const { service, calls } = setup({ project: project(), role: 'viewer' });
    const saved = await service.setForProject(plain, 'p1', { reportGroupId: 'g-tn' });
    expect(saved.reportGroupId).toBe('g-tn');
    expect(calls).toEqual([{ op: 'setReportGroup', args: ['t1', 'p1', 'g-tn'] }]);
  });

  it('null bỏ nhóm; không đổi gì thì không ghi', async () => {
    const { service, calls } = setup({ project: project({ reportGroupId: 'g-dv' }), role: 'member' });
    await service.setForProject(plain, 'p1', { reportGroupId: null });
    expect(calls).toEqual([{ op: 'setReportGroup', args: ['t1', 'p1', null] }]);

    const same = setup({ project: project({ reportGroupId: 'g-dv' }), role: 'member' });
    expect((await same.service.setForProject(plain, 'p1', { reportGroupId: 'g-dv' })).reportGroupId).toBe('g-dv');
    expect(same.calls).toEqual([]);
  });

  it('dự án không có: 404; người ngoài dự án: 403', async () => {
    await expect(setup().service.setForProject(plain, 'p404', { reportGroupId: null })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      setup({ project: project() }).service.setForProject(plain, 'p1', { reportGroupId: 'g-dv' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('người tạo không là thành viên và quản trị tenant vẫn đổi được', async () => {
    const creator = setup({ project: project() });
    await creator.service.setForProject({ ...plain, userId: 'creator' }, 'p1', { reportGroupId: 'g-dv' });
    expect(creator.calls).toHaveLength(1);
    const tenantAdmin = setup({ project: project() });
    await tenantAdmin.service.setForProject(admin, 'p1', { reportGroupId: 'g-dv' });
    expect(tenantAdmin.calls).toHaveLength(1);
  });

  it('id không có trong danh mục hoặc thiếu trường: 400', async () => {
    const { service, calls } = setup({ project: project(), role: 'owner' });
    await expect(service.setForProject(plain, 'p1', { reportGroupId: 'ghost' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.setForProject(plain, 'p1', {} as never)).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toEqual([]);
  });

  it('dự án đã lưu trữ vẫn đổi được nhóm báo cáo (để báo cáo năm gom đúng lĩnh vực)', async () => {
    const { service, calls } = setup({
      project: project({ archivedAt: '2026-10-01T00:00:00.000Z' }),
      role: 'member',
    });
    await service.setForProject(plain, 'p1', { reportGroupId: 'g-dv' });
    expect(calls).toHaveLength(1);
  });
});

describe('knownReportGroupId', () => {
  it('id lạ (nhóm đã xoá) hay rỗng là chưa phân nhóm', () => {
    expect(knownReportGroupId(catalog(), 'g-dv')).toBe('g-dv');
    expect(knownReportGroupId(catalog(), 'deleted')).toBeNull();
    expect(knownReportGroupId(catalog(), undefined)).toBeNull();
    expect(knownReportGroupId(catalog(), null)).toBeNull();
  });
});
