import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  PROJECT_REFS_STORAGE_KEY,
  PROJECT_REFS_TTL_MS,
  resetInstanceProjectCache,
  useInstanceProject,
  useInstanceProjectLookup,
  useInstanceProjects,
} from './use-instance-project';

const mockAuthFetch = jest.fn();
jest.mock('@enterprise-platform/shared-ui', () => ({ authFetch: (...args: unknown[]) => mockAuthFetch(...args) }));

const ok = (body: unknown) => ({ ok: true, json: async () => body });
type Instance = Parameters<typeof useInstanceProject>[0];

beforeEach(() => {
  mockAuthFetch.mockReset();
  resetInstanceProjectCache();
});

describe('dự án của hồ sơ (thông tin hồ sơ hiện tên dự án)', () => {
  it('hồ sơ đã chụp tên dự án: dùng luôn, không gọi Workspace', () => {
    const instance = {
      id: 'i1',
      workspaceProject: { projectId: 'p1', projectCode: 'DA-IMP-123', projectName: 'Dự án Đăkrơsa' },
    } as unknown as Instance;
    const { result } = renderHook(() => useInstanceProject(instance));
    expect(result.current).toMatchObject({ projectId: 'p1', projectName: 'Dự án Đăkrơsa' });
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it('hồ sơ cũ mở từ công việc, chưa lưu dự án: một lượt project-refs ra cả dự án lẫn tên', async () => {
    mockAuthFetch.mockResolvedValue(
      ok({ projects: [{ id: 'p9', code: 'DA-IMP-009', name: 'Dự án Lộc Ninh' }], workItems: [{ id: 'w1', projectId: 'p9' }] }),
    );
    const instance = { id: 'i2', sourceType: 'workspace_work_item', sourceId: 'w1' } as unknown as Instance;
    const { result } = renderHook(() => useInstanceProject(instance));
    await waitFor(() => expect(result.current?.projectName).toBe('Dự án Lộc Ninh'));
    expect(result.current).toMatchObject({ projectId: 'p9', projectCode: 'DA-IMP-009', workItemId: 'w1' });
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch.mock.calls[0][0]).toBe('/api/workspace/v1/project-refs?workItemIds=w1');
  });

  it('có dự án nhưng thiếu tên: tra theo id dự án; Workspace không trả thì giữ mã', async () => {
    mockAuthFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    const instance = {
      id: 'i3',
      workspaceLink: { status: 'linked', projectId: 'p2', projectCode: 'DA-002' },
    } as unknown as Instance;
    const { result } = renderHook(() => useInstanceProject(instance));
    await waitFor(() =>
      expect(mockAuthFetch).toHaveBeenCalledWith('/api/workspace/v1/project-refs?projectIds=p2', { cache: 'no-store' }),
    );
    expect(result.current).toMatchObject({ projectId: 'p2', projectCode: 'DA-002' });
    expect(result.current?.projectName).toBeUndefined();
  });

  it('hồ sơ không thuộc dự án nào: không có dự án, không gọi Workspace', () => {
    const { result } = renderHook(() => useInstanceProject({ id: 'i4', sourceType: 'manual' } as unknown as ProcedureInstance));
    expect(result.current).toBeUndefined();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});

describe('dự án của cả danh sách (Tổng quan gom theo dự án)', () => {
  it('cả danh sách chỉ tốn MỘT lượt gọi Workspace, gom mọi dự án và công việc còn thiếu tên', async () => {
    mockAuthFetch.mockResolvedValue(
      ok({ projects: [{ id: 'p2', code: 'DA-002', name: 'Dự án Phú Mỹ' }], workItems: [{ id: 'w1', projectId: 'p2' }] }),
    );
    const instances = [
      { id: 'a', workspaceProject: { projectId: 'p1', projectCode: 'DA-001', projectName: 'Dự án Đăkrơsa' } },
      { id: 'b', workspaceLink: { status: 'linked', projectId: 'p2', projectCode: 'DA-002' } },
      { id: 'c', workspaceLink: { status: 'pending', projectId: 'p2', projectCode: 'DA-002' } },
      { id: 'd', sourceType: 'workspace_work_item', sourceId: 'w1' },
      { id: 'e', sourceType: 'manual' },
    ] as unknown as ProcedureInstance[];
    const { result } = renderHook(() => useInstanceProjects(instances));
    expect(result.current.get('a')?.projectName).toBe('Dự án Đăkrơsa');
    await waitFor(() => expect(result.current.get('b')?.projectName).toBe('Dự án Phú Mỹ'));
    expect(result.current.get('c')?.projectName).toBe('Dự án Phú Mỹ');
    await waitFor(() =>
      expect(result.current.get('d')).toMatchObject({ projectId: 'p2', projectName: 'Dự án Phú Mỹ', workItemId: 'w1' }),
    );
    expect(result.current.has('e')).toBe(false);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch.mock.calls[0][0]).toBe('/api/workspace/v1/project-refs?projectIds=p2&workItemIds=w1');
  });
});

describe('bộ nhớ dùng chung giữa bảng và cửa sổ hồ sơ, lưu trên trình duyệt', () => {
  const legacy = { id: 'old-1', sourceType: 'workspace_work_item', sourceId: 'w7' } as unknown as Instance;
  const refs = ok({ projects: [{ id: 'p7', code: 'DA-007', name: 'Dự án Bình Phước' }], workItems: [{ id: 'w7', projectId: 'p7' }] });
  const stored = (at: number) =>
    JSON.stringify({ v: 1, projects: { p7: ['DA-007', 'Dự án Bình Phước', at] }, workItems: { w7: ['p7', at] } });

  it('cửa sổ đọc ngay tên bảng đã tra (lần vẽ đầu), không gọi lại Workspace', async () => {
    mockAuthFetch.mockResolvedValue(refs);
    const list = renderHook(() => useInstanceProjects([legacy as never]));
    await waitFor(() => expect(list.result.current.get('old-1')?.projectName).toBe('Dự án Bình Phước'));
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    const renders: ReturnType<typeof useInstanceProjectLookup>[] = [];
    renderHook(() => {
      const value = useInstanceProjectLookup(legacy);
      renders.push(value);
      return value;
    });
    // Ngay lần vẽ đầu, không chờ effect.
    expect(renders[0]).toMatchObject({
      pending: false,
      project: { projectId: 'p7', projectCode: 'DA-007', projectName: 'Dự án Bình Phước' },
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    // Kết quả được lưu trên trình duyệt cho lần tải trang sau.
    expect(JSON.parse(window.localStorage.getItem(PROJECT_REFS_STORAGE_KEY) ?? '{}')).toMatchObject({
      v: 1,
      projects: { p7: ['DA-007', 'Dự án Bình Phước', expect.any(Number)] },
      workItems: { w7: ['p7', expect.any(Number)] },
    });
  });

  it('tải lại trang: tên dự án hiện ngay từ bản lưu, rồi tra lại ngầm một lượt và cập nhật', async () => {
    window.localStorage.setItem(PROJECT_REFS_STORAGE_KEY, stored(Date.now() - 60_000));
    mockAuthFetch.mockResolvedValue(
      ok({ projects: [{ id: 'p7', code: 'DA-007', name: 'Dự án Bình Phước (mới)' }], workItems: [{ id: 'w7', projectId: 'p7' }] }),
    );
    const { result } = renderHook(() => useInstanceProject(legacy));
    expect(result.current?.projectName).toBe('Dự án Bình Phước');
    await waitFor(() => expect(result.current?.projectName).toBe('Dự án Bình Phước (mới)'));
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
  });

  it('bản lưu quá 24 giờ thì bỏ: còn đang tra (pending), gọi Workspace', async () => {
    window.localStorage.setItem(PROJECT_REFS_STORAGE_KEY, stored(Date.now() - PROJECT_REFS_TTL_MS - 1000));
    mockAuthFetch.mockResolvedValue(refs);
    const withCode = {
      id: 'i-code',
      workspaceLink: { status: 'linked', projectId: 'p7', projectCode: 'DA-007' },
    } as unknown as Instance;
    const { result } = renderHook(() => useInstanceProjectLookup(withCode));
    // Chưa có tên: vẫn có mã dự án để hiện, đánh dấu đang tra.
    expect(result.current).toMatchObject({ pending: true, project: { projectCode: 'DA-007' } });
    expect(result.current.project?.projectName).toBeUndefined();
    await waitFor(() => expect(result.current.project?.projectName).toBe('Dự án Bình Phước'));
    expect(result.current.pending).toBe(false);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
  });

  it('bản lưu hỏng không làm vỡ trang: bỏ qua, tra lại, ghi đè bằng bản đúng', async () => {
    window.localStorage.setItem(PROJECT_REFS_STORAGE_KEY, '{không phải json');
    mockAuthFetch.mockResolvedValue(refs);
    const { result } = renderHook(() => useInstanceProject(legacy));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.projectName).toBe('Dự án Bình Phước'));
    expect(JSON.parse(window.localStorage.getItem(PROJECT_REFS_STORAGE_KEY) ?? '{}').v).toBe(1);
  });

  it('lượt tra lỗi: thôi "đang tra", giữ mã dự án', async () => {
    mockAuthFetch.mockRejectedValue(new Error('mạng'));
    const withCode = { id: 'i-x', workspaceLink: { status: 'linked', projectId: 'p8', projectCode: 'DA-008' } } as unknown as Instance;
    const { result } = renderHook(() => useInstanceProjectLookup(withCode));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.project).toMatchObject({ projectCode: 'DA-008' });
  });

  it('danh sách lớn: không còn trần 30, chia lượt theo trần 200 id của Workspace', async () => {
    mockAuthFetch.mockResolvedValue(ok({ projects: [], workItems: [] }));
    const many = Array.from({ length: 250 }, (_, index) => ({
      id: `i${index}`,
      workspaceLink: { status: 'linked', projectId: `p${String(index).padStart(3, '0')}`, projectCode: `DA-${index}` },
    })) as unknown as ProcedureInstance[];
    renderHook(() => useInstanceProjects(many));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(2));
    const counts = mockAuthFetch.mock.calls.map((call) =>
      (new URL(String(call[0]), 'http://x').searchParams.get('projectIds') ?? '').split(',').length,
    );
    expect(counts).toEqual([200, 50]);
  });
});
