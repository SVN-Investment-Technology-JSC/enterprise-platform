/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { WorkspaceBoard } from './workspace-board';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));

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
});
