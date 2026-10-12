/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import PersonnelDecisionsScreen from './personnel-decisions-screen';

const mockActions = new Set<string>(['hrm.appointment.manage']);
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockActions],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.has(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.has(p)),
  }),
}));

let mockDecisions: unknown[] = [];
jest.mock('../hrm-personnel-decisions-api', () => ({
  usePersonnelDecisions: () => ({ data: mockDecisions, loading: false, error: '', reload: jest.fn() }),
  runPersonnelDecisionCommand: jest.fn(),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmEmployeeOptions: jest.fn(async () => []) };
});
jest.mock('../ui/personnel-decision-dialog', () => ({ PersonnelDecisionDialog: () => null }));

// antd Table cần matchMedia, ResizeObserver và getComputedStyle(elt, pseudoElt), jsdom chưa hỗ trợ.
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  window.getComputedStyle = ((elt: Element) => nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});

const decision = (over: Record<string, unknown>) => ({
  id: String(over.decisionNo),
  decisionNo: 'QD-1',
  decisionType: 'TRANSFER',
  status: 'APPLIED',
  employeeId: 'e1',
  employeeName: 'Nguyễn Văn An',
  employeeCode: 'NV001',
  effectiveDate: '2026-10-01',
  reason: 'Điều chuyển theo yêu cầu công việc',
  managerMode: 'KEEP',
  subordinateMode: 'KEEP',
  salaryChanged: false,
  appliedSteps: {},
  applyAttempts: 0,
  version: 1,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
  ...over,
});

beforeEach(() => {
  mockDecisions = [
    decision({ decisionNo: 'QD-001', toUnitName: 'Phòng Kỹ thuật', employeeName: 'An', effectiveDate: '2026-01-05' }),
    decision({ decisionNo: 'QD-002', toUnitName: 'Phòng Kỹ thuật', employeeName: 'Bình', status: 'DRAFT', effectiveDate: '2026-09-01' }),
    decision({ decisionNo: 'QD-003', toUnitName: 'Ban Tổng Giám đốc', employeeName: 'Cường', status: 'APPROVED' }),
    decision({ decisionNo: 'QD-004', fromUnitName: 'Phòng Kinh doanh', employeeName: 'Dung', status: 'REJECTED' }),
    decision({ decisionNo: 'QD-005', employeeName: 'Em' }),
  ];
});

describe('Quyết định nhân sự theo phòng ban', () => {
  it('mặc định nhóm theo phòng ban, mỗi nhóm có số quyết định, số đang xử lý và đã áp dụng', () => {
    render(<PersonnelDecisionsScreen />);
    const groups = screen.getAllByTestId(/^decision-group-/).map((g) => g.getAttribute('data-testid'));
    expect(groups).toEqual([
      'decision-group-Ban Tổng Giám đốc',
      'decision-group-Phòng Kinh doanh',
      'decision-group-Phòng Kỹ thuật',
      'decision-group-Chưa xác định đơn vị',
    ]);
    const tech = screen.getByTestId('decision-group-Phòng Kỹ thuật');
    expect(tech.textContent).toContain('2 quyết định');
    expect(tech.textContent).toContain('1 đang xử lý');
    expect(tech.textContent).toContain('1 đã áp dụng');
    // quyết định mới (01/09) trước quyết định cũ (05/01) trong nhóm
    const numbers = within(tech).getAllByText(/^QD-00\d$/).map((n) => n.textContent);
    expect(numbers).toEqual(['QD-002', 'QD-001']);
  });

  it('bốn thẻ tổng quan đếm trên toàn bộ quyết định', () => {
    render(<PersonnelDecisionsScreen />);
    const stat = (key: string) => screen.getByTestId(`decision-stat-${key}`).textContent ?? '';
    expect(stat('total')).toContain('5');
    expect(stat('total')).toContain('4 phòng ban');
    expect(stat('open')).toContain('2');
    expect(stat('applied')).toContain('2');
    expect(stat('closed')).toContain('1');
  });

  it('thu gọn và mở rộng một phòng ban, thu gọn tất cả', () => {
    render(<PersonnelDecisionsScreen />);
    const tech = screen.getByTestId('decision-group-Phòng Kỹ thuật');
    expect(within(tech).getByText('QD-001')).toBeTruthy();
    fireEvent.click(within(tech).getByRole('button', { name: /Phòng Kỹ thuật/ }));
    expect(within(tech).queryByText('QD-001')).toBeNull();
    fireEvent.click(within(tech).getByRole('button', { name: /Phòng Kỹ thuật/ }));
    expect(within(tech).getByText('QD-001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn tất cả' }));
    expect(screen.queryByText('QD-001')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng tất cả' }));
    expect(screen.getByText('QD-001')).toBeTruthy();
  });

  it('lọc theo phòng ban chỉ còn nhóm đó; tìm kiếm lọc theo tên', () => {
    render(<PersonnelDecisionsScreen />);
    fireEvent.change(screen.getByLabelText('Tìm quyết định'), { target: { value: 'Cường' } });
    expect(screen.getAllByTestId(/^decision-group-/)).toHaveLength(1);
    expect(screen.getByTestId('decision-group-Ban Tổng Giám đốc')).toBeTruthy();
  });

  it('chuyển sang danh sách phẳng có thêm cột Phòng ban', () => {
    render(<PersonnelDecisionsScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Danh sách' }));
    expect(screen.queryByTestId(/^decision-group-/)).toBeNull();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Phòng ban');
    expect(screen.getByText('QD-005')).toBeTruthy();
  });

  it('chưa có quyết định nào thì báo rõ', () => {
    mockDecisions = [];
    render(<PersonnelDecisionsScreen />);
    expect(screen.getByText(/Chưa có quyết định nhân sự nào/)).toBeTruthy();
  });
});
