import { HttpOrganizationDirectory, parseDirectory } from './http-organization-directory.js';

const payload = {
  tenantId: 't1',
  units: [
    { id: 'unit-it', name: 'Khối CNTT' },
    { id: 'unit-qa', name: 'Ban Chất lượng' },
  ],
  members: [
    { membershipId: 'm1', userId: 'u2', displayName: 'Nguyễn Thị Mai', email: 'mai@x.vn', unitId: 'unit-it' },
    { membershipId: 'm2', userId: 'u2', displayName: 'Nguyễn Thị Mai', email: 'mai@x.vn', unitId: 'unit-qa' },
    { membershipId: 'm3', userId: 'u1', displayName: 'Trần Quốc Khánh', positionName: 'Trưởng phòng' },
    { membershipId: 'm4', displayName: 'Không có userId' },
    'rác',
  ],
};

describe('parseDirectory', () => {
  it('gộp nhiều membership của một người thành một dòng, giữ các đơn vị', () => {
    const people = parseDirectory(payload);
    // Sắp theo tên: "Nguyễn" đứng trước "Trần".
    expect(people.map((person) => person.userId)).toEqual(['u2', 'u1']);
    expect(people.find((person) => person.userId === 'u2')?.unitNames).toEqual([
      'Khối CNTT',
      'Ban Chất lượng',
    ]);
    expect(people.find((person) => person.userId === 'u1')?.positionName).toBe('Trưởng phòng');
  });

  it('bỏ qua dòng thiếu userId và phần tử không phải đối tượng', () => {
    expect(parseDirectory(payload)).toHaveLength(2);
  });

  it('người bổ nhiệm vào chức danh hiện tên đơn vị cha, không hiện tên chức danh', () => {
    // Đúng hình dạng Tenant Core trả: `unitId` là id node chức danh, chức danh
    // có thể lồng dưới chức danh khác trước khi tới node đơn vị.
    const people = parseDirectory({
      units: [
        { id: 'dept', name: 'Phòng Dự án', typeCategory: 'unit' },
        { id: 'lead', name: 'Trưởng phòng', typeCategory: 'position', parentId: 'dept' },
        { id: 'staff', name: 'Chuyên viên dự án', typeCategory: 'position', parentId: 'lead' },
        { id: 'orphan', name: 'Cố vấn', typeCategory: 'position' },
      ],
      members: [
        { userId: 'u1', displayName: 'An', unitId: 'staff', positionName: 'Chuyên viên dự án' },
        { userId: 'u2', displayName: 'Bình', unitId: 'orphan', positionName: 'Cố vấn' },
      ],
    });
    expect(people.find((person) => person.userId === 'u1')?.unitNames).toEqual(['Phòng Dự án']);
    // Chức danh không nằm dưới đơn vị nào thì giữ tên node được bổ nhiệm.
    expect(people.find((person) => person.userId === 'u2')?.unitNames).toEqual(['Cố vấn']);
  });

  it('payload lạ trả mảng rỗng chứ không ném lỗi', () => {
    expect(parseDirectory(null)).toEqual([]);
    expect(parseDirectory({ members: 'không phải mảng' })).toEqual([]);
  });
});

describe('HttpOrganizationDirectory', () => {
  const ok = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response);

  it('gửi service token và cache theo tenant', async () => {
    const calls: { url: string; token: string }[] = [];
    const fetcher = ((url: string, init: RequestInit) => {
      calls.push({ url, token: (init.headers as Record<string, string>)['x-service-token'] });
      return ok();
    }) as unknown as typeof fetch;
    const directory = new HttpOrganizationDirectory('http://core/ctx', 'secret', fetcher);

    await directory.list('t1');
    await directory.list('t1');
    expect(calls).toEqual([{ url: 'http://core/ctx/t1', token: 'secret' }]);
  });

  it('lỗi mạng trả degraded, không ném', async () => {
    const fetcher = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    const directory = new HttpOrganizationDirectory('http://core/ctx', 'secret', fetcher);
    await expect(directory.list('t1')).resolves.toEqual({ people: [], degraded: true });
  });

  it('Tenant Core trả lỗi HTTP cũng là degraded', async () => {
    const fetcher = (() => Promise.resolve({ ok: false } as Response)) as unknown as typeof fetch;
    const directory = new HttpOrganizationDirectory('http://core/ctx', 'secret', fetcher);
    await expect(directory.list('t1')).resolves.toMatchObject({ degraded: true });
  });
});
