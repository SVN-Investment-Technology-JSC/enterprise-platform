/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import TimeSettingsScreen from './time-settings-screen';

const mockActions = new Set<string>();
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

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

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
  window.getComputedStyle = ((elt: Element) =>
    nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});

beforeEach(() => {
  mockActions.clear();
  mockActions.add('hrm.time.configure');
  mockActions.add('hrm.device.manage');
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/time-settings')
      return {
        data: {
          calendar: [
            {
              id: 'c1',
              work_date: '2026-09-02',
              name: 'Quốc khánh',
              day_kind: 'HOLIDAY',
              paid: true,
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          sites: [],
          devices: [],
          versions: [],
          holidayStatus: {
            year: 2026,
            count: 1,
            missing: false,
            warning: null,
            templateLabel: '',
          },
        },
      };
    throw new Error(`unexpected ${path}`);
  }) as never);
  window.history.replaceState(null, '', '/?tab=calendar');
});

describe('TimeSettingsScreen tab Lịch', () => {
  it('chỉ đọc: có biểu ngữ liên kết sang Phân ca và không có nút thêm, sửa, xóa', async () => {
    render(<TimeSettingsScreen />);
    expect(await screen.findByText('Quốc khánh')).toBeTruthy();
    const panel = document.getElementById(
      'time-settings-panel-calendar',
    ) as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(
      within(panel).getByText(
        'Lịch lễ/Tết và ngày nghỉ được quản lý tại Phân ca',
      ),
    ).toBeTruthy();
    const link = within(panel).getByRole('link', { name: 'Phân ca' });
    expect(link.getAttribute('href')).toBe('/timekeeping?view=schedules');
    for (const name of [
      'Cấu hình ngày',
      'Nạp lịch nghỉ lễ theo năm',
      'Nhân bản từ năm trước',
      'Sửa',
      'Xóa',
    ]) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
    // Tab quy định chấm công vẫn giữ nguyên nút cấu hình.
    expect(
      screen.getByRole('button', { name: 'Thêm phiên bản', hidden: true }),
    ).toBeTruthy();
  });
});
