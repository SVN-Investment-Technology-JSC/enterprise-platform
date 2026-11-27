/** @jest-environment jsdom */
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { loadProjectWorkItems } from '../workspace-api';
import { RelinkWorkspaceDialog } from './instance-admin-dialogs';
import { instanceWorkspaceProject } from './instance-source';

jest.mock('../workspace-api', () => ({
  ...jest.requireActual('../workspace-api'),
  loadRelatedProjects: jest.fn(async () => [
    { id: 'p-hn', code: 'HN', name: 'Trạm Hà Nội', canAssignOthers: true, canManageMembers: true },
    { id: 'p-evn', code: 'EVN', name: 'Cải tạo trạm EVN', canAssignOthers: true, canManageMembers: true },
  ]),
  loadProjectWorkItems: jest.fn(async () => [
    { id: 'wi-src', code: 'CV013', title: 'Mua cáp Anten', depth: 0 },
    { id: 'wi-src-child', code: 'CV014', title: 'Việc con của công việc nguồn', depth: 1, parentId: 'wi-src' },
    { id: 'wi-a', code: 'CV001', title: 'Thi công', depth: 0 },
    { id: 'wi-a1', code: 'CV002', title: 'Kéo cáp', depth: 1, parentId: 'wi-a' },
  ]),
}));

/** Hồ sơ mở từ công việc "Theo quy trình" `wi-src` của dự án EVN, chưa có liên kết từ phía Quy trình. */
const SOURCED = {
  id: 'ins-1',
  code: 'HS-0001',
  title: 'EVN-CV013-Mua cáp Anten',
  sourceType: 'workspace_work_item',
  sourceId: 'wi-src',
  workspaceProject: { projectId: 'p-evn', projectCode: 'EVN', projectName: 'Cải tạo trạm EVN' },
} as unknown as ProcedureInstance;

describe('instanceWorkspaceProject sau khi đổi dự án hồ sơ mở từ công việc Workspace', () => {
  it('ưu tiên liên kết mới hơn bản chụp dự án / công việc nguồn cũ', () => {
    const relinked = {
      ...SOURCED,
      workspaceLink: {
        status: 'linked',
        projectId: 'p-hn',
        projectCode: 'HN',
        projectName: 'Trạm Hà Nội',
        workItemId: 'wi-new',
        workItemCode: 'CV009',
        baseTitle: 'Mua cáp Anten',
        workItem: {},
        requestedBy: 'u-1',
        requestedAt: '2026-11-27T08:00:00.000Z',
      },
    } as unknown as ProcedureInstance;
    expect(instanceWorkspaceProject(relinked)).toEqual({
      projectId: 'p-hn',
      projectCode: 'HN',
      projectName: 'Trạm Hà Nội',
      workItemId: 'wi-new',
      workItemCode: 'CV009',
    });
    // Trước khi đổi: bản chụp dự án và công việc nguồn.
    expect(instanceWorkspaceProject(SOURCED)).toMatchObject({ projectId: 'p-evn', workItemId: 'wi-src' });
  });
});

describe('RelinkWorkspaceDialog', () => {
  it('hồ sơ mở từ công việc Workspace: chọn dự án rồi công việc cha trên cây, công việc nguồn và nhánh con bị ẩn', async () => {
    const onRelink = jest.fn(async () => undefined);
    const onClose = jest.fn();
    render(<RelinkWorkspaceDialog instance={SOURCED} onClose={onClose} onRelink={onRelink} />);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    // Hộp thoại gọn: không còn đoạn mô tả dài phía trên.
    expect(screen.queryByText(/Hệ thống tạo công việc mới/)).toBeNull();
    // Chưa chọn dự án: cây công việc cha chưa mở.
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'Đổi dự án / công việc' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(await screen.findByPlaceholderText('Chọn dự án…'));
    fireEvent.click(await screen.findByRole('option', { name: /EVN · Cải tạo trạm EVN/ }));
    expect(loadProjectWorkItems).toHaveBeenCalledWith('p-evn');

    // Công việc cha là ô chọn thả xuống, mặc định "Gốc dự án"; bấm mới mở cây.
    fireEvent.click(await screen.findByRole('button', { name: 'Công việc cha: Gốc dự án' }));
    const tree = await screen.findByRole('tree', { name: 'Công việc cha' });
    expect(tree).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /CV001/ })).toBeTruthy());
    expect(screen.queryByRole('treeitem', { name: /CV013/ })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: /CV014/ })).toBeNull();

    const thiCong = screen.getByRole('treeitem', { name: /CV001/ });
    fireEvent.keyDown(thiCong, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('treeitem', { name: /CV002/ }));
    // Chọn xong thì cây đóng, ô chọn hiện công việc vừa chọn.
    expect(screen.getByRole('button', { name: /^Công việc cha: CV002/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Đổi dự án / công việc' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRelink).toHaveBeenCalledWith('ins-1', { projectId: 'p-evn', projectCode: 'EVN', parentId: 'wi-a1' });
  });
});
