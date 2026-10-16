import { Logger } from '@nestjs/common';
import { HttpOrganizationReader, parseOrganization } from './http-organization-reader.js';

const payload = {
  version: 1,
  source: 'tenant-core',
  units: [
    { id: 'company', name: 'Công ty', typeCategory: 'unit' },
    { id: 'lab', name: 'Khối thí nghiệm', parentId: 'company', typeCategory: 'unit' },
    { id: 'engineer', name: 'Kỹ sư', parentId: 'lab', typeCategory: 'position' },
    { name: 'không có id' },
  ],
  members: [
    { userId: 'u1', unitId: 'engineer', positionId: 'engineer' },
    { userId: 'u2' },
  ],
};

describe('parseOrganization', () => {
  it('lấy node (đơn vị, chức danh) và phân công, bỏ dòng thiếu id', () => {
    expect(parseOrganization(payload)).toEqual({
      nodes: [
        { id: 'company', name: 'Công ty', parentId: undefined, kind: 'unit' },
        { id: 'lab', name: 'Khối thí nghiệm', parentId: 'company', kind: 'unit' },
        { id: 'engineer', name: 'Kỹ sư', parentId: 'lab', kind: 'position' },
      ],
      assignments: [{ userId: 'u1', nodeId: 'engineer' }],
      degraded: false,
    });
  });

  it('payload lạ thì rỗng chứ không vỡ', () => {
    expect(parseOrganization(null)).toEqual({ nodes: [], assignments: [], degraded: false });
    expect(parseOrganization({ units: 'x' })).toEqual({ nodes: [], assignments: [], degraded: false });
  });
});

describe('HttpOrganizationReader', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gửi service token, giữ bản sao một phút', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const reader = new HttpOrganizationReader('http://core/contexts', 'token', fetcher as typeof fetch);
    await reader.snapshot('tenant a');
    await reader.snapshot('tenant a');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://core/contexts/tenant%20a',
      expect.objectContaining({ headers: { 'x-service-token': 'token' } }),
    );
  });

  it('Tenant Core lỗi: dùng bản cũ nếu có, không thì rỗng, đều kèm degraded', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValue(new Response('', { status: 503 }));
    const reader = new HttpOrganizationReader('http://core/contexts', 'token', fetcher as typeof fetch);
    await expect(reader.snapshot('t')).resolves.toMatchObject({ degraded: false });
    now.mockReturnValue(1_000_000 + 61_000);
    await expect(reader.snapshot('t')).resolves.toMatchObject({ degraded: true, nodes: expect.any(Array) });
    expect((await reader.snapshot('t')).nodes).toHaveLength(3);
    await expect(reader.snapshot('other')).resolves.toEqual({ nodes: [], assignments: [], degraded: true });
  });
});
