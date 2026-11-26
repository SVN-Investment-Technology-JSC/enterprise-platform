import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { WorkItemProcedureSteps } from '@enterprise-platform/contracts-workspace';
import { ProcedureStepsPanel, getWorkItemProcedureSteps } from '@enterprise-platform/feature-workspace';

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  getWorkItemProcedureSteps: jest.fn(),
  getStandaloneTaskProcedureSteps: jest.fn(),
}));

const mocked = getWorkItemProcedureSteps as jest.Mock;

const linked: WorkItemProcedureSteps = {
  linked: true,
  available: true,
  instanceId: 'i1',
  instanceCode: 'QT-001',
  status: 'running',
  progress: { completed: 1, total: 2 },
  steps: [
    {
      id: 's2',
      name: 'Duyệt hồ sơ',
      order: 20,
      status: 'active',
      roleStage: 'A',
      assigneeLabel: 'Trưởng phòng',
    },
    {
      id: 's1',
      name: 'Soạn hồ sơ',
      order: 10,
      status: 'completed',
      assigneeLabel: 'Nguyễn Văn A',
    },
    {
      id: 's3',
      name: 'Nhánh phụ',
      order: 30,
      status: 'skipped',
      assigneeLabel: 'Kế toán',
    },
  ],
  events: [
    {
      id: 'e1',
      action: 'approve',
      actorName: 'Nguyễn Văn A',
      createdAt: '2026-11-20T03:00:00.000Z',
    },
  ],
};

afterEach(() => {
  cleanup();
  mocked.mockReset();
});

describe('ProcedureStepsPanel', () => {
  it('renders ordered steps with status labels and a collapsed skipped group', async () => {
    mocked.mockResolvedValue(linked);
    render(<ProcedureStepsPanel kind="work-item" id="w1" />);
    expect(await screen.findByText('Soạn hồ sơ')).toBeTruthy();
    expect(screen.getByText('Duyệt hồ sơ')).toBeTruthy();
    expect(screen.getByText('Đã xong')).toBeTruthy();
    expect(screen.getByText('Đang xử lý')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.queryByText('Nhánh phụ')).toBeNull();
    const toggle = screen.getByRole('button', { name: /Nhánh không đi \(1\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Nhánh phụ')).toBeTruthy();
  });

  it('draws a gateway with the chosen and the not chosen branch', async () => {
    mocked.mockResolvedValue({
      ...linked,
      progress: { completed: 1, total: 3 },
      steps: [
        { id: 't1', name: 'Soạn hồ sơ', order: 10, status: 'completed', assigneeLabel: 'A' },
        { id: 'b1', name: 'Duyệt cấp cao', order: 20, status: 'active', assigneeLabel: 'Giám đốc' },
        { id: 'b2', name: 'Duyệt nhanh', order: 30, status: 'skipped', assigneeLabel: 'Trưởng phòng' },
        { id: 't2', name: 'Lưu trữ', order: 40, status: 'pending', assigneeLabel: 'Văn thư' },
      ],
      gateways: [
        {
          id: 'g1',
          name: 'Giá trị hợp đồng',
          afterStepId: 't1',
          chosenBranchId: 'br1',
          branches: [
            { id: 'br1', label: 'Trên 100 triệu', isDefault: false, stepIds: ['b1'] },
            { id: 'br2', label: 'Dưới 100 triệu', isDefault: true, stepIds: ['b2'] },
          ],
        },
      ],
    } satisfies WorkItemProcedureSteps);
    render(<ProcedureStepsPanel kind="work-item" id="w1" />);
    expect(await screen.findByText('Giá trị hợp đồng')).toBeTruthy();
    expect(screen.getByText('Trên 100 triệu')).toBeTruthy();
    expect(screen.getByText('(đã chọn)')).toBeTruthy();
    expect(screen.getByText('Dưới 100 triệu')).toBeTruthy();
    expect(screen.getByText('Mặc định')).toBeTruthy();
    expect(screen.getByText('Duyệt cấp cao')).toBeTruthy();
    expect(screen.getByText('Duyệt nhanh')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Nhánh không đi/ })).toBeNull();
  });

  it('shows the unavailable state and retries', async () => {
    mocked.mockResolvedValueOnce({
      linked: true,
      available: false,
      steps: [],
      events: [],
    });
    mocked.mockResolvedValueOnce(linked);
    render(<ProcedureStepsPanel kind="work-item" id="w1" />);
    expect(
      await screen.findByText(/Chưa đọc được các bước lúc này/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Soạn hồ sơ')).toBeTruthy();
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('renders nothing when the item is not linked', async () => {
    mocked.mockResolvedValue({
      linked: false,
      available: true,
      steps: [],
      events: [],
    });
    const { container } = render(
      <ProcedureStepsPanel kind="work-item" id="w1" />,
    );
    await waitFor(() => expect(mocked).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
