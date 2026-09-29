import {
  HRM_PERMISSIONS_INVALIDATED_EVENT,
  hrmFetch,
} from './hrm-api';

describe('hrmFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses the shared HRM API contract', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'employee-1' } }),
    } as Response);
    globalThis.fetch = fetchMock;

    await expect(hrmFetch('/my-profile')).resolves.toEqual({
      data: { id: 'employee-1' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hrm/v1/my-profile',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('invalidates cached permissions immediately after a forbidden response', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response);
    globalThis.fetch = fetchMock;
    const listener = jest.fn();
    window.addEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, listener);

    await expect(hrmFetch('/time-settings/sites')).rejects.toMatchObject({
      name: 'HrmApiError',
      status: 403,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, listener);
  });

  it('does not recursively invalidate permissions when capabilities itself is forbidden', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response);
    globalThis.fetch = fetchMock;
    const listener = jest.fn();
    window.addEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, listener);

    await expect(hrmFetch('/capabilities')).rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(HRM_PERMISSIONS_INVALIDATED_EVENT, listener);
  });
});
