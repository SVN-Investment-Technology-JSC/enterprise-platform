import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { submitterOptionsOf } from './submitter-options';

const organization = {
  members: [
    { membershipId: 'm1', userId: 'u1', displayName: 'Cúc', positionName: 'Kế toán', isHead: false },
    { membershipId: 'm2', userId: 'u2', displayName: 'An', positionName: 'Kỹ sư', isHead: false },
    // Một người kiêm hai chức danh: chỉ một dòng.
    { membershipId: 'm3', userId: 'u2', displayName: 'An', positionName: 'Tổ trưởng', isHead: true },
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

  it('người đang tạo chưa có trong sơ đồ tổ chức vẫn đứng đầu', () => {
    expect(submitterOptionsOf(organization, { id: 'x', name: 'Khách' })[0]).toEqual({ userId: 'x', name: 'Khách' });
  });
});
