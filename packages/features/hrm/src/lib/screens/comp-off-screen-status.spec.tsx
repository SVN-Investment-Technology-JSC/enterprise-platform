/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { compOffApi } from '../hrm-comp-off-api';
import CompOffScreen from './comp-off-screen';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.comp_off.view'],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => p === 'hrm.comp_off.view',
    any: (list: readonly string[]) => list.includes('hrm.comp_off.view' as never),
  }),
}));
jest.mock('../hrm-comp-off-api', () => ({
  compOffApi: { status: jest.fn(), balances: jest.fn() },
}));
jest.mock('../ui/comp-off/comp-off-conversion-panel', () => ({ CompOffConversionPanel: () => null }));
jest.mock('../ui/comp-off/overtime-classify-panel', () => ({ OvertimeClassifyPanel: () => null }));

const api = compOffApi as jest.Mocked<typeof compOffApi>;

beforeEach(() => {
  jest.clearAllMocks();
  api.balances.mockResolvedValue([]);
});

describe('màn Quỹ nghỉ bù khi quỹ bị tắt trong cấu hình', () => {
  it('báo quỹ đang tắt kèm đường dẫn tới cấu hình', async () => {
    api.status.mockResolvedValue({ fundEnabled: false, formulaEnabled: false });
    render(<CompOffScreen />);
    const notice = await screen.findByTestId('comp-off-disabled');
    expect(notice.textContent).toContain('đang tắt');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/settings?view=overtime-comp');
  });

  it('không báo gì khi quỹ đang bật', async () => {
    api.status.mockResolvedValue({ fundEnabled: true, formulaEnabled: false });
    render(<CompOffScreen />);
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(screen.queryByTestId('comp-off-disabled')).toBeNull();
  });
});
