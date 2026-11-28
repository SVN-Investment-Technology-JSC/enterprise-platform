import { loadRelatedProjects, resetRelatedProjectsCache } from './workspace-api';

const mockAuthFetch = jest.fn();
jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: (...args: unknown[]) => mockAuthFetch(...args) }));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  mockAuthFetch.mockReset();
  resetRelatedProjectsCache();
});

describe('danh sách dự án để chọn (mở / đổi dự án cho hồ sơ)', () => {
  it('một lượt project-options thay cho lật từng trang; chỉ dự án mình là thành viên, ghi được, còn mở', async () => {
    mockAuthFetch.mockResolvedValue(
      ok({
        items: [
          { id: 'p2', code: 'DA-002', name: 'Dự án B', myRole: 'member', myPermissions: ['project.update_related'] },
          { id: 'p1', code: 'DA-001', name: 'Dự án A', myRole: 'owner', myPermissions: ['project.update_all', 'project.manage_members'] },
          { id: 'p3', code: 'DA-003', name: 'Chỉ xem', myRole: 'viewer', myPermissions: [] },
          { id: 'p4', code: 'DA-004', name: 'Không thuộc', myPermissions: ['project.update_all'] },
        ],
      }),
    );
    const projects = await loadRelatedProjects();
    expect(projects.map((project) => project.id)).toEqual(['p1', 'p2']);
    expect(projects[0]).toMatchObject({ canAssignOthers: true, canManageMembers: true });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch.mock.calls[0][0]).toBe('/api/workspace/v1/project-options');
  });

  it('mở lại trong một phút dùng danh sách đã nhớ, không gọi lại', async () => {
    mockAuthFetch.mockResolvedValue(ok({ items: [{ id: 'p1', code: 'DA-001', name: 'A', myRole: 'owner' }] }));
    await loadRelatedProjects();
    await loadRelatedProjects();
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
  });

  it('Workspace cũ chưa có project-options: quay về lật trang danh sách dự án', async () => {
    mockAuthFetch.mockImplementation(async (url: string) =>
      url.includes('project-options')
        ? { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }
        : ok({ items: [{ id: 'p1', code: 'DA-001', name: 'A', myRole: 'member' }], total: 1 }),
    );
    expect((await loadRelatedProjects()).map((project) => project.id)).toEqual(['p1']);
  });
});
