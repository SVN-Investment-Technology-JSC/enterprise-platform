import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { submitterOptionsOf } from './submitter-options';

const organization = {
  units: [
    { id: 'kt', name: 'Phòng Kế toán' },
    { id: 'kd', name: 'Phòng Kỹ thuật' },
  ],
  members: [
    { membershipId: 'm1', userId: 'u1', displayName: 'Cúc', positionName: 'Kế toán', unitId: 'kt', isHead: false },
    { membershipId: 'm2', userId: 'u2', displayName: 'An', positionName: 'Kỹ sư', unitId: 'kd', isHead: false },
    // Một người kiêm hai chức danh: chỉ một dòng.
    { membershipId: 'm3', userId: 'u2', displayName: 'An', positionName: 'Tổ trưởng', unitId: 'kd', isHead: true },
    { membershipId: 'm4', userId: 'u3', displayName: 'Bình', isHead: false },
  ],
} as unknown as TenantOrganizationSnapshot;

describe('submitterOptionsOf — người chọn được làm người submit', () => {
  it('mọi người trong tenant, không trùng, xếp theo tên, người đang tạo đứng đầu', () => {
    expect(submitterOptionsOf(organization, { id: 'u1', name: 'Cúc' }).map((person) => person.userId)).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(submitterOptionsOf(organization).map((person) => person.name)).toEqual(['An', 'Bình', 'Cúc']);
  });

  it('dòng phụ là chức danh rồi bộ phận, gộp đủ khi kiêm nhiệm', () => {
    const people = submitterOptionsOf(organization);
    expect(people.find((person) => person.userId === 'u2')?.hint).toBe('Kỹ sư, Tổ trưởng · Phòng Kỹ thuật');
    expect(people.find((person) => person.userId === 'u1')?.hint).toBe('Kế toán · Phòng Kế toán');
    expect(people.find((person) => person.userId === 'u3')?.hint).toBeUndefined();
  });

  it('người đang tạo chưa có trong sơ đồ tổ chức vẫn đứng đầu', () => {
    expect(submitterOptionsOf(organization, { id: 'x', name: 'Khách' })[0]).toEqual({ userId: 'x', name: 'Khách' });
  });
});
