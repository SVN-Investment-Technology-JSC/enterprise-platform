/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
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

describe('TimeSettingsScreen tab', () => {
  it('không còn tab Lịch làm / OFF / Lễ (quản lý ở Phân ca); đường dẫn cũ ?tab=calendar rơi về Quy định chấm công', async () => {
    render(<TimeSettingsScreen />);
    expect(
      (await screen.findAllByRole('button', { name: 'Tạo phiên bản mới' }))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: 'Lịch làm / OFF / Lễ' })).toBeNull();
    expect(document.getElementById('time-settings-panel-calendar')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('rules');
  });
});
