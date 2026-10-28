import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import {
  DashboardPendingProcedureSection,
  type DashboardProcedureItem,
} from './dashboard-pending-procedure-section';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn(),
  }),
}));

const mockProcedureItem: DashboardProcedureItem = {
  id: 'ins-001',
  code: 'HS-2026-001',
  title: 'Hồ sơ đề xuất mua sắm linh kiện',
  definitionName: 'Mua sắm thiết bị',
  currentStepName: 'Trưởng bộ phận duyệt',
};

describe('DashboardPendingProcedureSection', () => {
  it('hiển thị số lượng ban đầu và cập nhật tức thì (optimistic) khi có hành động hoàn tất', () => {
    render(
      <DashboardPendingProcedureSection
        initialItems={[mockProcedureItem]}
        initialTotal={16}
        viewAllHref="/modules/procedure#workspace"
      />,
    );

    expect(screen.getByText('Hồ sơ cần bạn xử lý')).toBeTruthy();
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByText('Hồ sơ đề xuất mua sắm linh kiện')).toBeTruthy();
    expect(screen.getByText('HS-2026-001')).toBeTruthy();
    expect(screen.getByText('Mua sắm thiết bị')).toBeTruthy();
    expect(screen.getByText('Trưởng bộ phận duyệt')).toBeTruthy();
    expect(screen.getByText('Xem đủ 16 hồ sơ trong Quy trình')).toBeTruthy();

    // Giả lập sự kiện xử lý thành công hồ sơ từ Universal Task Drawer
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ep:task-action-completed', {
          detail: { taskId: 'procedure:ins-001' },
        }),
      );
    });

    // Số lượng giảm xuống 15 ngay lập tức (16 -> 15) và hồ sơ biến mất khỏi danh sách
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.queryByText('Hồ sơ đề xuất mua sắm linh kiện')).toBeNull();
  });

  it('bấm nút Xử lý phát sự kiện ep:open-task-drawer với taskId chuẩn procedure:<id>', () => {
    const handleOpenDrawer = jest.fn();
    window.addEventListener('ep:open-task-drawer', handleOpenDrawer);

    render(
      <DashboardPendingProcedureSection
        initialItems={[mockProcedureItem]}
        initialTotal={1}
        viewAllHref="/modules/procedure#workspace"
      />,
    );

    const actionButton = screen.getByRole('button', { name: 'Xử lý' });
    fireEvent.click(actionButton);

    expect(handleOpenDrawer).toHaveBeenCalled();
    const event = handleOpenDrawer.mock.calls[0][0] as CustomEvent;
    expect(event.detail.taskId).toBe('procedure:ins-001');

    window.removeEventListener('ep:open-task-drawer', handleOpenDrawer);
  });

  it('hiển thị trạng thái trống khi không có hồ sơ nào', () => {
    render(
      <DashboardPendingProcedureSection
        initialItems={[]}
        initialTotal={0}
        viewAllHref="/modules/procedure#workspace"
      />,
    );

    expect(screen.getByText('Không có hồ sơ nào chờ bạn thao tác.')).toBeTruthy();
  });
});
