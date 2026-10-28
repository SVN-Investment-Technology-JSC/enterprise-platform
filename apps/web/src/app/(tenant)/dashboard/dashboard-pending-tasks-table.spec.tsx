import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardPendingTasksTable } from './dashboard-pending-tasks-table';
import type { UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';

const mockTask: UniversalTaskDto = {
  taskId: 'hrm:leave:req-001',
  tenantId: 't-test',
  sourceModule: 'hrm',
  entityType: 'LEAVE_REQUEST',
  entityId: 'req-001',
  title: 'Đơn nghỉ phép năm - Lê Văn C',
  code: 'NP-001',
  requester: {
    userId: 'u-1',
    fullName: 'Lê Văn C',
    departmentName: 'Phòng Kế toán',
  },
  createdAt: '2026-10-26T10:00:00.000Z',
  priority: 'HIGH',
  approvalMode: 'LOCAL',
  approvalOwner: 'hrm',
  status: 'PENDING',
  availableActions: ['APPROVE', 'REJECT'],
  detailUrl: '/modules/hrm/approvals?request=req-001',
  blocks: {
    summary: {
      items: [{ label: 'Loại nghỉ', value: 'Phép năm' }],
    },
  },
};

describe('DashboardPendingTasksTable', () => {
  it('hiển thị thông báo khi không có đơn nào', () => {
    render(
      <DashboardPendingTasksTable
        tasks={[]}
        total={0}
        viewAllHref="/modules/hrm/approvals"
        viewAllLabel="Xem đủ đơn trong Nhân sự"
      />,
    );

    expect(screen.getByText('Không có đơn từ nào chờ bạn duyệt.')).toBeTruthy();
  });

  it('hiển thị danh sách đơn và kích hoạt openTaskDrawer khi click', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <DashboardPendingTasksTable
        tasks={[mockTask]}
        total={5}
        viewAllHref="/modules/hrm/approvals"
        viewAllLabel="Xem đủ 5 đơn trong Nhân sự"
      />,
    );

    expect(screen.getByText('Đơn nghỉ phép năm - Lê Văn C')).toBeTruthy();
    expect(screen.getByText('NP-001')).toBeTruthy();
    expect(screen.getByText('Lê Văn C')).toBeTruthy();
    expect(screen.getByText('Phòng Kế toán')).toBeTruthy();
    expect(screen.getByText('Chờ duyệt')).toBeTruthy();
    expect(screen.getByText('Xem đủ 5 đơn trong Nhân sự')).toBeTruthy();

    const actionBtn = screen.getByText('Xử lý');
    fireEvent.click(actionBtn);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ep:open-task-drawer',
        detail: {
          taskId: 'hrm:leave:req-001',
          task: mockTask,
        },
      }),
    );

    dispatchSpy.mockRestore();
  });
});
