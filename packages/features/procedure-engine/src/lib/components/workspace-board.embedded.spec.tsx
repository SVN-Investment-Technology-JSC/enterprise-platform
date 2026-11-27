/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { WorkspaceBoard } from './workspace-board';
import { CASE_LAYOUT_STORAGE_KEY } from './case-layout-a/case-layout';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));

const mockReleaseRoom = jest.fn();
const mockRetainRoom = jest.fn<() => void, [string]>(() => mockReleaseRoom);
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  retainProcedureRoom: (instanceId: string) => mockRetainRoom(instanceId),
}));

// Các test trong file này kiểm giao diện CŨ (màn đầy đủ) và chế độ nhúng; giao diện A có test riêng ở case-layout-a.
beforeEach(() => window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy'));
afterEach(() => window.localStorage.clear());

const instance = {
  id: 'inst-1',
  code: 'PR-1',
  title: 'Đề nghị mua vật tư',
  definitionId: 'def',
  definitionCode: 'PR',
  definitionName: 'Đề nghị mua',
  definitionVersion: 1,
  status: 'running',
  initiatedBy: 'u-1',
  startedAt: '2026-10-22T01:15:00.000Z',
  currentStepId: 'step-2',
  activity: [],
  authorization: {
    myRoles: ['A'],
    currentRoleStage: 'A',
    availableActions: ['comment', 'approve', 'reject'],
    isOverride: false,
    editableAttributeKeys: [],
  },
  steps: [
    {
      id: 'step-2',
      definitionStepId: 'def-2',
      key: 'approve',
      order: 2,
      name: 'Giám đốc duyệt',
      status: 'active',
      currentRoleStage: 'A',
      assignments: [],
    },
  ],
} as unknown as ProcedureInstance;

const baseProps = {
  definitions: [],
  instances: [instance],
  initialInstanceId: 'inst-1',
  canCreateInstances: true,
  onAction: jest.fn(async () => undefined),
  onOpenDefinitions: jest.fn(),
  onStart: jest.fn(async () => undefined),
};

describe('WorkspaceBoard ở chế độ embedded (drawer ngoài module)', () => {
  it('chỉ có khung chi tiết của hồ sơ: không có thanh lọc, danh sách và nút tạo đơn', () => {
    render(<WorkspaceBoard {...baseProps} embedded />);
    expect(screen.getByLabelText('Chi tiết hồ sơ PR-1')).toBeTruthy();
    expect(screen.getByText('Đề nghị mua vật tư')).toBeTruthy();
    expect(screen.queryByLabelText('Danh sách hồ sơ')).toBeNull();
    expect(screen.queryByLabelText('Tìm hồ sơ')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Lọc theo trạng thái' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tạo đơn/ })).toBeNull();
  });

  it('giữ đủ tiến trình, trao đổi, tệp, nhật ký và các nút xử lý theo quyền', () => {
    render(<WorkspaceBoard {...baseProps} embedded />);
    const tabs = screen.getByRole('tablist', { name: 'Nội dung hồ sơ' });
    for (const label of ['Tiến trình', 'Trao đổi', 'Tệp & tài liệu', 'Nhật ký']) {
      expect(tabs.textContent).toContain(label);
    }
    expect(screen.getAllByRole('button', { name: /Phê duyệt/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Từ chối/ }).length).toBeGreaterThan(0);
  });

  it('vẫn có hồ sơ đang xem sau khi hoàn tất, không bị bộ lọc "Đang xử lý" làm biến mất', () => {
    render(<WorkspaceBoard {...baseProps} embedded instances={[{ ...instance, status: 'completed' } as ProcedureInstance]} />);
    expect(screen.getByLabelText('Chi tiết hồ sơ PR-1')).toBeTruthy();
  });

  it('không nhúng thì vẫn là màn đầy đủ: có danh sách và thanh lọc', () => {
    render(<WorkspaceBoard {...baseProps} />);
    expect(screen.getByLabelText('Danh sách hồ sơ')).toBeTruthy();
    expect(screen.getByLabelText('Tìm hồ sơ')).toBeTruthy();
  });

  it('người vừa duyệt thấy nút Hoàn duyệt; bấm và xác nhận thì gửi hành động withdraw', () => {
    const onAction = jest.fn(async () => undefined);
    const withdrawable = {
      ...instance,
      authorization: {
        ...instance.authorization,
        availableActions: [],
        canWithdraw: true,
        withdrawStepName: 'Kế toán kiểm tra',
      },
    } as unknown as ProcedureInstance;
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[withdrawable]} embedded />);
    // Nút ở đầu hồ sơ đứng trước nút trong khung chờ.
    fireEvent.click(screen.getAllByRole('button', { name: 'Hoàn duyệt' })[0] as HTMLElement);
    expect(screen.getByText(/quay lại bước “Kế toán kiểm tra”/)).toBeTruthy();
    // Nút xác nhận trong hộp xác nhận đứng ngay sau nút mở hộp.
    fireEvent.click(screen.getAllByRole('button', { name: 'Hoàn duyệt' })[1] as HTMLElement);
    expect(onAction).toHaveBeenCalledWith('inst-1', 'withdraw', undefined, undefined, undefined);
  });

  it('không có quyền hoàn duyệt thì không hiện nút', () => {
    render(<WorkspaceBoard {...baseProps} embedded />);
    expect(screen.queryByRole('button', { name: 'Hoàn duyệt' })).toBeNull();
  });

  it('khung "Chưa tới lượt bạn" cũng có nút Hoàn duyệt cho người vừa xử lý pha trước', () => {
    const onAction = jest.fn(async () => undefined);
    const waiting = {
      ...instance,
      authorization: {
        ...instance.authorization,
        myRoles: ['R'],
        availableActions: [],
        canWithdraw: true,
        withdrawStepName: 'Giám đốc duyệt',
      },
    } as unknown as ProcedureInstance;
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[waiting]} embedded />);
    expect(screen.getByText(/Chưa tới lượt bạn/)).toBeTruthy();
    // Một nút ở đầu hồ sơ (cần xác nhận) và một nút ngay trong khung chờ (bấm là gửi).
    const buttons = screen.getAllByRole('button', { name: 'Hoàn duyệt' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onAction).toHaveBeenCalledWith('inst-1', 'withdraw', undefined, undefined, undefined);
  });

  /** Người duyệt cuối của bước 1 vừa chuyển hồ sơ sang bước 2, nơi họ không giữ vai nào. */
  const movedOn = {
    ...instance,
    authorization: {
      myRoles: [],
      currentRoleStage: 'A',
      availableActions: [],
      isOverride: false,
      editableAttributeKeys: [],
      canWithdraw: true,
      withdrawStepName: 'Kế toán trưởng duyệt',
      withdrawStepId: 'step-1',
    },
    steps: [
      {
        id: 'step-1',
        definitionStepId: 'def-1',
        key: 'kt',
        order: 1,
        name: 'Kế toán trưởng duyệt',
        status: 'completed',
        currentRoleStage: 'A',
        assignments: [],
      },
      ...(instance.steps ?? []),
    ],
  } as unknown as ProcedureInstance;

  it('người duyệt cuối đã chuyển bước: Hoàn duyệt hiện trên dòng bước vừa xong và trong khung "không giữ vai"', () => {
    const onAction = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[movedOn]} embedded />);
    expect(screen.getByText('Bạn không giữ vai ở bước này.')).toBeTruthy();
    // Đầu hồ sơ, dòng bước vừa xong, khung xử lý của bước hiện tại.
    const buttons = screen.getAllByRole('button', { name: 'Hoàn duyệt' });
    expect(buttons).toHaveLength(3);
    expect(screen.getByText(/Bạn vừa xử lý xong bước này/)).toBeTruthy();
    expect(screen.getByText(/Bạn vừa xử lý xong bước “Kế toán trưởng duyệt”/)).toBeTruthy();

    // Nút trên dòng bước vừa xong gửi thẳng withdraw, không mở popup xem lại bước.
    const timelineButton = screen
      .getByText(/Bạn vừa xử lý xong bước này/)
      .parentElement?.querySelector('button') as HTMLElement;
    fireEvent.click(timelineButton);
    expect(onAction).toHaveBeenCalledWith('inst-1', 'withdraw', undefined, undefined, undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nút trong khung "không giữ vai" cũng gửi withdraw', () => {
    const onAction = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[movedOn]} embedded />);
    const panelButton = screen
      .getByText(/Bạn vừa xử lý xong bước “Kế toán trưởng duyệt”/)
      .parentElement?.querySelector('button') as HTMLElement;
    fireEvent.click(panelButton);
    expect(onAction).toHaveBeenCalledWith('inst-1', 'withdraw', undefined, undefined, undefined);
  });

  it('không hoàn duyệt được thì dòng bước đã xong không có lời mời', () => {
    const closed = {
      ...movedOn,
      authorization: { ...movedOn.authorization, canWithdraw: false, withdrawStepId: undefined },
    } as unknown as ProcedureInstance;
    render(<WorkspaceBoard {...baseProps} instances={[closed]} embedded />);
    expect(screen.getByText('Bạn không giữ vai ở bước này.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hoàn duyệt' })).toBeNull();
  });
});

describe('WorkspaceBoard - hồ sơ đang mở khi dữ liệu nạp lại', () => {
  const second = { ...instance, id: 'inst-2', code: 'PR-2', title: 'Đề nghị thanh toán' } as ProcedureInstance;

  it('hồ sơ đang mở rời bộ lọc sau khi nạp lại (vừa hoàn tất) thì vẫn giữ nguyên, không nhảy sang hồ sơ khác', () => {
    const { rerender } = render(<WorkspaceBoard {...baseProps} initialInstanceId={undefined} instances={[instance, second]} />);
    fireEvent.click(screen.getByRole('button', { name: /Đề nghị thanh toán/ }));
    expect(screen.getByLabelText('Chi tiết hồ sơ PR-2')).toBeTruthy();

    rerender(
      <WorkspaceBoard
        {...baseProps}
        initialInstanceId={undefined}
        instances={[instance, { ...second, status: 'completed' } as ProcedureInstance]}
      />,
    );
    expect(screen.getByLabelText('Chi tiết hồ sơ PR-2')).toBeTruthy();
    expect(screen.queryByLabelText('Chi tiết hồ sơ PR-1')).toBeNull();
  });

  it('hồ sơ đã chọn không còn trong danh sách thì về hồ sơ đầu trang', () => {
    const { rerender } = render(<WorkspaceBoard {...baseProps} initialInstanceId={undefined} instances={[instance, second]} />);
    fireEvent.click(screen.getByRole('button', { name: /Đề nghị thanh toán/ }));
    rerender(<WorkspaceBoard {...baseProps} initialInstanceId={undefined} instances={[instance]} />);
    expect(screen.getByLabelText('Chi tiết hồ sơ PR-1')).toBeTruthy();
  });

  it('vào phòng thời gian thực của hồ sơ đang mở, đổi hồ sơ thì rời phòng cũ', () => {
    mockRetainRoom.mockClear();
    mockReleaseRoom.mockClear();
    render(<WorkspaceBoard {...baseProps} initialInstanceId={undefined} instances={[instance, second]} />);
    expect(mockRetainRoom).toHaveBeenLastCalledWith('inst-1');
    fireEvent.click(screen.getByRole('button', { name: /Đề nghị thanh toán/ }));
    expect(mockReleaseRoom).toHaveBeenCalledTimes(1);
    expect(mockRetainRoom).toHaveBeenLastCalledWith('inst-2');
  });
});

describe('WorkspaceBoard - hồ sơ thuộc dự án nào', () => {
  it('hồ sơ mở từ công việc Workspace hiện mã, tên dự án và link mở dự án, công việc', () => {
    const fromWorkItem = {
      ...instance,
      sourceType: 'workspace_work_item',
      sourceId: 'wi-1',
      workspaceProject: { projectId: 'p-1', projectCode: 'EVN', projectName: 'Cải tạo trạm EVN' },
    } as unknown as ProcedureInstance;
    render(<WorkspaceBoard {...baseProps} instances={[fromWorkItem]} />);
    const project = screen.getByRole('link', { name: 'Cải tạo trạm EVN' });
    expect(project.getAttribute('href')).toBe('/modules/workspace?project=p-1#projects/project/p-1');
    expect(screen.getByRole('link', { name: 'Công việc' }).getAttribute('href')).toBe(
      '/modules/workspace?project=p-1#projects/work-item/wi-1',
    );
    // Thẻ trong danh sách có tên dự án (mã khi rê chuột).
    expect(screen.getByTitle('Dự án Cải tạo trạm EVN · EVN').textContent).toBe('Cải tạo trạm EVN');
  });

  it('hồ sơ gắn dự án từ Quy trình đọc dự án ở liên kết; bị Workspace từ chối thì không hiện', () => {
    const linked = {
      ...instance,
      workspaceLink: {
        status: 'linked',
        projectId: 'p-2',
        projectCode: 'HN',
        projectName: 'Hà Nội',
        baseTitle: 'x',
        workItem: {},
        requestedBy: 'u-1',
        requestedAt: '2026-10-22T01:15:00.000Z',
        workItemId: 'wi-2',
        workItemCode: 'CV013',
      },
    } as unknown as ProcedureInstance;
    const { unmount } = render(<WorkspaceBoard {...baseProps} instances={[linked]} embedded />);
    expect(screen.getByRole('link', { name: 'Hà Nội' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Công việc CV013' }).getAttribute('href')).toBe(
      '/modules/workspace?project=p-2#projects/work-item/wi-2',
    );
    unmount();

    const rejected = {
      ...linked,
      workspaceLink: { ...linked.workspaceLink, status: 'rejected', error: 'Không có quyền' },
    } as unknown as ProcedureInstance;
    render(<WorkspaceBoard {...baseProps} instances={[rejected]} embedded />);
    expect(screen.queryByText('Dự án')).toBeNull();
  });

  it('hồ sơ không thuộc dự án thì không có dòng Dự án', () => {
    render(<WorkspaceBoard {...baseProps} embedded />);
    expect(screen.queryByText('Dự án')).toBeNull();
  });
});
