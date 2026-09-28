import { hrmFetch } from './hrm-api';

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
});
