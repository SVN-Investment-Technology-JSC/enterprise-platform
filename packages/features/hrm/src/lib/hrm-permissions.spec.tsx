import { render, screen, waitFor, act } from '@testing-library/react';
import { HRM_PERMISSIONS_INVALIDATED_EVENT, HrmApiError, hrmFetch } from './hrm-api';
import { HrmPermissionsProvider, useHrmPermissions } from './hrm-permissions';

jest.mock('./hrm-api', () => {
  const actual = jest.requireActual('./hrm-api');
  return {
    ...actual,
    hrmFetch: jest.fn(),
  };
});

const mockedHrmFetch = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

function Probe() {
  const { actions, loading, error } = useHrmPermissions();
  if (loading) return <div>loading</div>;
  if (error) return <div>error:{error}</div>;
  return <div>actions:{actions.join(',')}</div>;
}

describe('HrmPermissionsProvider', () => {
  beforeEach(() => {
    mockedHrmFetch.mockReset();
  });

  it('keeps existing permissions when a background refresh fails with 503', async () => {
    mockedHrmFetch
      .mockResolvedValueOnce({ data: { actions: ['hrm.self.read'], displayName: 'An' } })
      .mockRejectedValueOnce(new HrmApiError('Service Unavailable', 503));

    render(
      <HrmPermissionsProvider>
        <Probe />
      </HrmPermissionsProvider>,
    );

    await waitFor(() => expect(screen.getByText('actions:hrm.self.read')).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(new Event(HRM_PERMISSIONS_INVALIDATED_EVENT));
    });

    await waitFor(() => expect(mockedHrmFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('actions:hrm.self.read')).toBeTruthy();
  });

  it('clears permissions and shows error when refresh returns 403', async () => {
    mockedHrmFetch
      .mockResolvedValueOnce({ data: { actions: ['hrm.self.read'], displayName: 'An' } })
      .mockRejectedValueOnce(new HrmApiError('Forbidden', 403));

    render(
      <HrmPermissionsProvider>
        <Probe />
      </HrmPermissionsProvider>,
    );

    await waitFor(() => expect(screen.getByText('actions:hrm.self.read')).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(new Event(HRM_PERMISSIONS_INVALIDATED_EVENT));
    });

    await waitFor(() => expect(screen.getByText('error:Forbidden')).toBeTruthy());
  });
});
