/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import AdvancesScreen from './advances-screen';

let mockAllowed = new Set<string>();
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockAllowed],
    loading: false,
    error: '',
    displayName: '',
    can: (a: string) => mockAllowed.has(a),
    any: (list: readonly string[]) => list.some((a) => mockAllowed.has(a)),
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

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

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const advance = {
  id: 'a1',
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Nguyễn Văn An',
  requestDate: '2026-10-02',
  reason: 'Việc gia đình',
  requestedAmount: 5000000,
  approvedAmount: 5000000,
  disbursedAmount: 5000000,
  totalDeductedAmount: 0,
  remainingBalance: 5000000,
  numberOfInstallments: 2,
  status: 'DISBURSED',
};

beforeEach(() => {
  fetchMock.mockReset();
  mockAllowed = new Set(['hrm.advance.read']);
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/salary-advance-requests') return { data: [advance] };
    return { data: [] };
  }) as never);
});

describe('AdvancesScreen', () => {
  it('đầu trang dùng tiêu đề mới của tab Ứng và thu hồi cùng mô tả quy trình', async () => {
    render(<AdvancesScreen />);
    expect(screen.getByRole('heading', { name: 'Ứng và thu hồi' })).toBeTruthy();
    expect(screen.getByText(/Quy trình khép kín/)).toBeTruthy();
    expect(await screen.findAllByText('Nguyễn Văn An')).not.toHaveLength(0);
  });

  it('giữ liên kết sang đơn từ và phê duyệt ở góc phải tiêu đề', async () => {
    render(<AdvancesScreen />);
    const link = screen.getByRole('link', { name: 'Đơn từ và phê duyệt' });
    expect(link.getAttribute('href')).toBe('/requests');
    await screen.findAllByText('Nguyễn Văn An');
  });

  it('vẫn có ô tìm và danh sách khoản ứng', async () => {
    render(<AdvancesScreen />);
    expect(screen.getByLabelText('Tìm khoản ứng lương')).toBeTruthy();
    await screen.findByText('Danh sách khoản ứng (1)');
  });
});
