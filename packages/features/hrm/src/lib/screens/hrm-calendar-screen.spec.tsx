/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import HrmCalendarScreen from './hrm-calendar-screen';

jest.mock('antd', () => ({
  Tabs: ({ items }: { items: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }> }) => (
    <div>
      {items.map((item) => (
        <section key={item.key}>
          <div>{item.label}</div>
          <div>{item.children}</div>
        </section>
      ))}
    </div>
  ),
  Table: () => <div data-testid="table" />,
}));

jest.mock('../hrm-api', () => ({
  hrmFetch: jest.fn(),
}));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ data: [] } as never);
});

it('uses the shared notification center instead of the legacy calendar notification feed', async () => {
  render(<HrmCalendarScreen />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const paths = fetchMock.mock.calls.map(([path]) => path);
  expect(paths).toEqual(expect.arrayContaining([expect.stringContaining('/my-calendar?'), '/request-workflows']));
  expect(paths).not.toContain('/my-notifications');
  expect(screen.queryByText('Thông báo')).toBeNull();
});
