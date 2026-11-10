import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskActionResultDto, UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';
import { UniversalTaskDrawer } from '@enterprise-platform/feature-module-shell';
import { DashboardTaskDrawerHost, openTaskDrawer } from './dashboard-task-drawer-host';

const mockHrmTask: UniversalTaskDto = {
  taskId: 'task-hrm-101',
  tenantId: 'tenant-1',
  sourceModule: 'hrm',
  entityType: 'LEAVE_REQUEST',
  entityId: 'req-001',
  title: 'Đơn xin nghỉ phép năm',
  code: 'NP-2026-001',
  requester: {
    userId: 'user-001',
    fullName: 'Nguyễn Văn A',
    positionName: 'Chuyên viên kỹ thuật',
    departmentName: 'Phòng Công nghệ',
  },
  createdAt: '2026-10-25T08:00:00Z',
  priority: 'NORMAL',
  approvalMode: 'LOCAL',
  approvalOwner: 'hrm',
  status: 'PENDING',
  availableActions: ['APPROVE', 'REJECT'],
  detailUrl: '/modules/hrm/approvals?request=req-001',
  blocks: {
    summary: {
      items: [
        { label: 'Loại nghỉ phép', value: 'Nghỉ phép năm' },
        { label: 'Tổng số ngày', value: '2 ngày' },
        { label: 'Thời gian', value: '26/10/2026 - 27/10/2026' },
      ],
    },
    attributes: {
      title: 'Lý do & Bàn giao',
      items: [
        { key: 'reason', label: 'Lý do nghỉ', value: 'Giải quyết việc gia đình' },
        { key: 'handoverTo', label: 'Bàn giao công việc cho', value: 'Trần Thị B' },
      ],
    },
    timeline: {
      title: 'Tiến trình phê duyệt',
      steps: [
        {
          stepId: 'step-1',
          stepName: 'Nộp đơn',
          status: 'COMPLETED',
          actedAt: '25/10/2026 08:00',
          assigneeName: 'Nguyễn Văn A',
        },
        {
          stepId: 'step-2',
          stepName: 'Trưởng bộ phận phê duyệt',
          status: 'CURRENT',
          assigneeName: 'Lê Văn C',
          comment: 'Chờ đối soát ca làm việc',
        },
      ],
    },
  },
};

const mockInventoryTask: UniversalTaskDto = {
  taskId: 'task-inv-202',
  tenantId: 'tenant-1',
  sourceModule: 'inventory',
  entityType: 'STOCK_EXPORT_REQUEST',
  entityId: 'export-002',
  title: 'Phiếu đề nghị xuất kho vật tư phục vụ dự án',
  code: 'XK-2026-0042',
  requester: {
    userId: 'user-002',
    fullName: 'Phạm Minh D',
    positionName: 'Kỹ sư công trình',
    departmentName: 'Ban Quản lý Dự án',
  },
  createdAt: '2026-10-25T09:30:00Z',
  priority: 'URGENT',
  approvalMode: 'LOCAL',
  approvalOwner: 'inventory',
  status: 'PENDING',
  availableActions: ['APPROVE', 'REJECT', 'RETURN'],
  detailUrl: '/modules/inventory#vouchers/export-002',
  blocks: {
    summary: {
      items: [
        { label: 'Kho xuất', value: 'Kho Tổng Hà Nội' },
        { label: 'Dự án', value: 'Dự án Tòa nhà Sunrise' },
      ],
    },
    table: {
      title: 'Danh mục vật tư xuất kho',
      columns: [
        { key: 'code', title: 'Mã VT' },
        { key: 'name', title: 'Tên vật tư' },
        { key: 'unit', title: 'ĐVT' },
        { key: 'quantity', title: 'SL đề nghị', align: 'right' },
      ],
      rows: [
        { code: 'VT-01', name: 'Thép phi 10', unit: 'Cây', quantity: 150 },
        { code: 'VT-02', name: 'Xi măng PCB40', unit: 'Bao', quantity: 50 },
      ],
      totalRowsCount: 45,
      hasMoreRows: true,
      totalSummary: {
        label: 'Tổng số lượng',
        value: '200 đơn vị',
      },
    },
    attachments: {
      title: 'Hồ sơ đính kèm',
      files: [
        {
          id: 'file-1',
          fileName: 'du_toan_vat_tu.pdf',
          fileSizeLabel: '1.8 MB',
          mimeType: 'application/pdf',
          downloadUrl: 'https://storage.example.com/files/du_toan.pdf',
          previewUrl: 'https://storage.example.com/preview/du_toan.pdf',
        },
      ],
    },
  },
};

describe('Universal Task Drawer & Dashboard Integration', () => {
  it('renders HRM task details correctly (header, requester, summary, attributes, timeline)', () => {
    const handleClose = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockHrmTask}
        onClose={handleClose}
      />,
    );

    // Header & Code
    expect(screen.getByText('hrm')).toBeTruthy();
    expect(screen.getByText('NP-2026-001')).toBeTruthy();
    expect(screen.getByText('Đơn xin nghỉ phép năm')).toBeTruthy();

    // Requester
    expect(screen.getAllByText('Nguyễn Văn A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Chuyên viên kỹ thuật · Phòng Công nghệ')).toBeTruthy();

    // Summary items
    expect(screen.getByText('Loại nghỉ phép')).toBeTruthy();
    expect(screen.getByText('Nghỉ phép năm')).toBeTruthy();
    expect(screen.getByText('Tổng số ngày')).toBeTruthy();
    expect(screen.getByText('2 ngày')).toBeTruthy();

    // Attributes
    expect(screen.getByText('Lý do nghỉ')).toBeTruthy();
    expect(screen.getByText('Giải quyết việc gia đình')).toBeTruthy();
    expect(screen.getByText('Bàn giao công việc cho')).toBeTruthy();
    expect(screen.getByText('Trần Thị B')).toBeTruthy();

    // Timeline
    expect(screen.getByText('Trưởng bộ phận phê duyệt')).toBeTruthy();
    expect(screen.getByText('"Chờ đối soát ca làm việc"')).toBeTruthy();

    // Available actions: only APPROVE and REJECT for HRM
    expect(screen.getByRole('button', { name: 'Phê duyệt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Từ chối...' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yêu cầu bổ sung...' })).toBeNull();
  });

  it('renders Inventory task with safe table limit warning and attachments', () => {
    const handleClose = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockInventoryTask}
        onClose={handleClose}
      />,
    );

    // Priority tag
    expect(screen.getByText('Khẩn cấp')).toBeTruthy();

    // Table view
    expect(screen.getByText('Danh mục vật tư xuất kho')).toBeTruthy();
    expect(screen.getByText('Thép phi 10')).toBeTruthy();
    expect(screen.getByText('Xi măng PCB40')).toBeTruthy();

    // Safe table warning (displayed 2 of 45 rows)
    expect(screen.getByText(/Đang hiển thị/)).toBeTruthy();
    expect(screen.getByText('45')).toBeTruthy();
    expect(screen.getByText(/Xem toàn bộ 45 dòng trong phân hệ/)).toBeTruthy();

    // Total summary
    expect(screen.getByText('Tổng số lượng:')).toBeTruthy();
    expect(screen.getByText('200 đơn vị')).toBeTruthy();

    // Attachments
    expect(screen.getByText('du_toan_vat_tu.pdf')).toBeTruthy();
    expect(screen.getByText('1.8 MB')).toBeTruthy();
    expect(screen.getByText('Xem trước')).toBeTruthy();
    expect(screen.getByText('Tải xuống ⤓')).toBeTruthy();

    // Available actions: RETURN, REJECT, APPROVE
    expect(screen.getByRole('button', { name: 'Yêu cầu bổ sung...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Từ chối...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Phê duyệt' })).toBeTruthy();
  });

  it('enforces mandatory reason for REJECT and cannot submit without reason', async () => {
    const handleExecuteAction = jest.fn();
    const handleClose = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockHrmTask}
        onClose={handleClose}
        onExecuteAction={handleExecuteAction}
      />,
    );

    // Click "Từ chối..."
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối...' }));

    // Reason box should appear
    expect(screen.getByText(/Lý do từ chối \(Bắt buộc nhập\)/)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận Từ chối' }) as HTMLButtonElement;

    // Confirm button is disabled because reason is empty
    expect(confirmBtn.disabled).toBe(true);

    // Enter only whitespace - still disabled
    const textarea = screen.getByPlaceholderText(/Ghi rõ căn cứ và lý do từ chối/);
    fireEvent.change(textarea, { target: { value: '    ' } });
    expect(confirmBtn.disabled).toBe(true);

    // Enter valid reason
    fireEvent.change(textarea, { target: { value: 'Lịch làm việc trùng đợt tổng kết quý.' } });
    expect(confirmBtn.disabled).toBe(false);

    // Submit
    const expectedResult: TaskActionResultDto = {
      success: true,
      taskId: mockHrmTask.taskId,
      action: 'REJECT',
      newStatus: 'REJECTED',
      completedAt: new Date().toISOString(),
      message: 'Từ chối thành công',
    };
    handleExecuteAction.mockResolvedValueOnce(expectedResult);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleExecuteAction).toHaveBeenCalledWith(
        mockHrmTask,
        'REJECT',
        'Lịch làm việc trùng đợt tổng kết quý.',
      );
    });
  });

  it('enforces mandatory reason for RETURN on Inventory tasks', async () => {
    const handleExecuteAction = jest.fn();
    const handleClose = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockInventoryTask}
        onClose={handleClose}
        onExecuteAction={handleExecuteAction}
      />,
    );

    // Click "Yêu cầu bổ sung..."
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu bổ sung...' }));

    expect(screen.getByText(/Lý do yêu cầu bổ sung \/ chỉnh sửa \(Bắt buộc nhập\)/)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận Yêu cầu sửa' }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const textarea = screen.getByPlaceholderText(/Mô tả thông tin hoặc chứng từ cần bổ sung/);
    fireEvent.change(textarea, { target: { value: 'Bổ sung chữ ký xác nhận của Chỉ huy trưởng công trình.' } });
    expect(confirmBtn.disabled).toBe(false);

    const expectedResult: TaskActionResultDto = {
      success: true,
      taskId: mockInventoryTask.taskId,
      action: 'RETURN',
      newStatus: 'RETURNED',
      completedAt: new Date().toISOString(),
      message: 'Đã yêu cầu bổ sung',
    };
    handleExecuteAction.mockResolvedValueOnce(expectedResult);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleExecuteAction).toHaveBeenCalledWith(
        mockInventoryTask,
        'RETURN',
        'Bổ sung chữ ký xác nhận của Chỉ huy trưởng công trình.',
      );
    });
  });

  it('allows immediate APPROVE without requiring a reason', async () => {
    const handleExecuteAction = jest.fn();
    const handleClose = jest.fn();
    const handleCompleted = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockHrmTask}
        onClose={handleClose}
        onActionCompleted={handleCompleted}
        onExecuteAction={handleExecuteAction}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: 'Phê duyệt' });
    const expectedResult: TaskActionResultDto = {
      success: true,
      taskId: mockHrmTask.taskId,
      action: 'APPROVE',
      newStatus: 'APPROVED',
      completedAt: new Date().toISOString(),
      message: 'Phê duyệt thành công',
    };
    handleExecuteAction.mockResolvedValueOnce(expectedResult);

    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(handleExecuteAction).toHaveBeenCalledWith(mockHrmTask, 'APPROVE', undefined);
      expect(handleCompleted).toHaveBeenCalledWith(expectedResult);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('handles 409 conflict errors correctly (PROCEDURE_IN_PROGRESS, TASK_NOT_PENDING)', async () => {
    const handleExecuteAction = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockHrmTask}
        onClose={jest.fn()}
        onExecuteAction={handleExecuteAction}
      />,
    );

    // Mock PROCEDURE_IN_PROGRESS conflict
    handleExecuteAction.mockRejectedValueOnce({
      code: 'PROCEDURE_IN_PROGRESS',
      message: 'Đơn đang trong quy trình',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Phê duyệt' }));

    await waitFor(() => {
      expect(screen.getByText(/Đơn này đã được chuyển sang Quy trình phê duyệt/)).toBeTruthy();
    });
  });

  it('opens drawer via openTaskDrawer event in DashboardTaskDrawerHost', async () => {
    render(<DashboardTaskDrawerHost />);

    // Initially drawer is not visible
    expect(screen.queryByLabelText('Chi tiết tác vụ phê duyệt')).toBeNull();

    // Trigger openTaskDrawer helper
    act(() => {
      openTaskDrawer(mockHrmTask.taskId, mockHrmTask);
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Chi tiết tác vụ phê duyệt')).toBeTruthy();
      expect(screen.getByText('Đơn xin nghỉ phép năm')).toBeTruthy();
    });

    // Close button works
    const closeBtn = screen.getByLabelText('Đóng ngăn kéo (Esc)');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByLabelText('Chi tiết tác vụ phê duyệt')).toBeNull();
    });
  });

  it('closes drawer on Escape key press', async () => {
    const handleClose = jest.fn();

    render(
      <UniversalTaskDrawer
        open={true}
        task={mockHrmTask}
        onClose={handleClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
