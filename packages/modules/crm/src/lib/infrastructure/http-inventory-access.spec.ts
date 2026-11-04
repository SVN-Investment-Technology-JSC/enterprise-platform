import { HttpInventoryAccess, interpretInventoryDecision } from './http-inventory-access.js';

const INPUT = { tenantId: 't1', userId: 'u1', sessionId: 's1' };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const reader = (fetcher: jest.Mock, token = 'secret') =>
  new HttpInventoryAccess('http://platform/decisions', token, fetcher as unknown as typeof fetch);

describe('HttpInventoryAccess', () => {
  it('được phép: đã mua Kho và được vào; gửi moduleKey inventory, quyền inventory.read, kèm service token', async () => {
    const fetcher = jest.fn().mockResolvedValue(reply({ allowed: true }));
    await expect(reader(fetcher).read(INPUT)).resolves.toEqual({ inventoryEntitled: true, canAccessInventory: true });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://platform/decisions');
    expect(init.headers['x-service-token']).toBe('secret');
    expect(JSON.parse(init.body)).toEqual({
      sessionId: 's1',
      userId: 'u1',
      tenantId: 't1',
      moduleKey: 'inventory',
      permission: 'inventory.read',
    });
  });

  it('chưa mua Kho: cả hai false (TC-FB-10)', async () => {
    const fetcher = jest.fn().mockResolvedValue(reply({ allowed: false, code: 'MODULE_NOT_ENTITLED' }));
    await expect(reader(fetcher).read(INPUT)).resolves.toEqual({ inventoryEntitled: false, canAccessInventory: false });
  });

  it('đã mua nhưng không có quyền: entitled true, canAccess false (TC-FB-12)', async () => {
    for (const code of ['MODULE_ROLE_FORBIDDEN', 'PERMISSION_DENIED']) {
      const fetcher = jest.fn().mockResolvedValue(reply({ allowed: false, code }));
      await expect(reader(fetcher).read(INPUT)).resolves.toEqual({ inventoryEntitled: true, canAccessInventory: false });
    }
  });

  it('lỗi mạng, HTTP lỗi, thiếu phiên hay thiếu token: cả hai false, không ném (TC-FB-14)', async () => {
    const none = { inventoryEntitled: false, canAccessInventory: false };
    await expect(reader(jest.fn().mockRejectedValue(new Error('down'))).read(INPUT)).resolves.toEqual(none);
    await expect(reader(jest.fn().mockResolvedValue(reply({}, false))).read(INPUT)).resolves.toEqual(none);
    const unused = jest.fn();
    await expect(reader(unused).read({ ...INPUT, sessionId: undefined })).resolves.toEqual(none);
    await expect(reader(unused, '').read(INPUT)).resolves.toEqual(none);
    expect(unused).not.toHaveBeenCalled();
  });

  it('payload lạ coi như không có Kho', () => {
    expect(interpretInventoryDecision(null)).toEqual({ inventoryEntitled: false, canAccessInventory: false });
    expect(interpretInventoryDecision({ allowed: 'yes' })).toEqual({ inventoryEntitled: false, canAccessInventory: false });
    expect(interpretInventoryDecision({ allowed: false, code: 'SESSION_INACTIVE' }).inventoryEntitled).toBe(false);
  });
});
