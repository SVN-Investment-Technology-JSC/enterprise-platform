import { HttpInventoryOrganizationReader, parseOrganization } from './http-organization.reader.js';

const payload = {
  units: [
    { id: 'u1', name: 'Phòng Kho', typeCategory: 'department' },
    { id: 'p2', name: 'Thủ kho', typeCategory: 'position' },
    { id: 'p1', name: 'Kế toán trưởng', typeCategory: 'position' },
  ],
  members: [
    { userId: 'a', unitId: 'u1', positionId: 'p1' },
    { userId: 'a', unitId: 'u1', positionId: 'p2' },
    { userId: 'b', unitId: 'u1' }, // chỉ thuộc đơn vị, không giữ chức danh
  ],
};

describe('đọc sơ đồ tổ chức cho người duyệt cố định', () => {
  it('chỉ lấy chức danh (không lấy đơn vị), xếp theo tên; người chỉ thuộc đơn vị không giữ chức danh nào', () => {
    const snapshot = parseOrganization(payload);
    expect(snapshot.positions.map((p) => p.name)).toEqual(['Kế toán trưởng', 'Thủ kho']);
    expect(snapshot.held.get('a')).toEqual(['p1', 'p2']);
    expect(snapshot.held.get('b')).toBeUndefined();
  });

  it('Tenant Core lỗi thì ném 503, không rơi về "ai cũng duyệt được"', async () => {
    const reader = new HttpInventoryOrganizationReader('http://core', 'token', async () => {
      throw new Error('mạng lỗi');
    });
    await expect(reader.heldPositionIds('t', 'a')).rejects.toMatchObject({ statusCode: 503, code: 'ORGANIZATION_UNAVAILABLE' });
  });

  it('đọc thành công thì dùng lại bản trong bộ nhớ đệm', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const reader = new HttpInventoryOrganizationReader('http://core', 'token', fetcher as unknown as typeof fetch);
    expect(await reader.heldPositionIds('t', 'a')).toEqual(['p1', 'p2']);
    expect((await reader.positions('t')).length).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
