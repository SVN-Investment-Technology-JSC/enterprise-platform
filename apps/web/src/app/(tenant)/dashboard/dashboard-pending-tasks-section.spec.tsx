import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { DashboardPendingTasksSection } from './dashboard-pending-tasks-section';
import type { UniversalTaskDto } from '@enterprise-platform/contracts-task-approval';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn(),
  }),
}));

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

describe('DashboardPendingTasksSection', () => {
  it('hiển thị số lượng ban đầu và cập nhật tức thì (optimistic) khi có hành động hoàn tất', () => {
    render(
      <DashboardPendingTasksSection
        initialTasks={[mockTask]}
        initialTotal={16}
        viewAllHref="/modules/hrm/approvals"
      />,
    );

    expect(screen.getByText('Đơn từ chờ bạn duyệt')).toBeTruthy();
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByText('Đơn nghỉ phép năm - Lê Văn C')).toBeTruthy();
    expect(screen.getByText('Xem đủ 16 đơn trong Nhân sự')).toBeTruthy();

    // Giả lập sự kiện duyệt thành công tác vụ
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ep:task-action-completed', {
          detail: { taskId: 'hrm:leave:req-001' },
        }),
      );
    });

    // Số lượng giảm xuống 15 ngay lập tức
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.queryByText('Đơn nghỉ phép năm - Lê Văn C')).toBeNull();
  });
});
