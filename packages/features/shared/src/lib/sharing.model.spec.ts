import type { SharedDirectory, SharedFolderSharing } from '@enterprise-platform/contracts-shared';
import {
  draftsFrom,
  emptyDraft,
  grantsFrom,
  parsePrincipal,
  principalOptions,
  principalValue,
  takenPrincipals,
} from './sharing.model';

const directory: SharedDirectory = {
  people: [
    { userId: 'u-1', displayName: 'Trần Thí Nghiệm', unitNames: ['Phòng TN điện'], positionName: 'Kỹ sư' },
    { userId: 'u-2', displayName: 'Lê Kinh Doanh', email: 'kd@savina.vn', unitNames: [] },
  ],
  nodes: [
    { id: 'n-1', name: 'Khối thí nghiệm', kind: 'unit', parentId: 'n-0', path: 'Công ty' },
    { id: 'n-2', name: 'Kỹ sư', kind: 'position', parentId: 'n-1', path: 'Công ty › Khối thí nghiệm' },
  ],
  degraded: false,
};

const sharing: SharedFolderSharing = {
  folderId: 'f-1',
  folderName: '6. Khối Thí nghiệm',
  owner: { userId: 'admin', name: 'Quản trị' },
  shares: [
    {
      principalType: 'unit',
      principalId: 'n-1',
      role: 'editor',
      label: 'Khối thí nghiệm',
      detail: 'Công ty',
      missing: false,
      expired: false,
    },
    {
      principalType: 'user',
      principalId: 'u-2',
      role: 'viewer',
      expiresOn: '2026-10-01',
      label: 'Lê Kinh Doanh',
      missing: false,
      expired: true,
    },
  ],
  inherited: [],
};

describe('ô chọn đối tượng', () => {
  it('Mọi người, rồi phòng ban, chức danh kèm đường dẫn, rồi nhân sự kèm chức danh, phòng ban', () => {
    const options = principalOptions(directory, new Set());
    expect(options.map((option) => [option.value, option.label, option.description, option.badge])).toEqual([
      ['everyone:', 'Mọi người', undefined, 'Mọi người'],
      ['unit:n-1', 'Khối thí nghiệm', 'Công ty', 'Phòng ban'],
      ['position:n-2', 'Kỹ sư', 'Công ty › Khối thí nghiệm', 'Chức danh'],
      ['user:u-1', 'Trần Thí Nghiệm', 'Kỹ sư · Phòng TN điện', 'Nhân sự'],
      ['user:u-2', 'Lê Kinh Doanh', 'kd@savina.vn', 'Nhân sự'],
    ]);
  });

  it('bỏ đối tượng đã có dòng, trừ chính dòng đang sửa', () => {
    const taken = takenPrincipals(draftsFrom(sharing));
    expect([...taken]).toEqual(['unit:n-1', 'user:u-2']);
    const values = principalOptions(directory, taken, 'unit:n-1').map((option) => option.value);
    expect(values).toEqual(['everyone:', 'unit:n-1', 'position:n-2', 'user:u-1']);
  });

  it('không có danh bạ thì vẫn chọn được Mọi người', () => {
    expect(principalOptions(undefined, new Set()).map((option) => option.value)).toEqual(['everyone:']);
  });

  it('đọc lại giá trị của ô chọn', () => {
    expect(parsePrincipal(principalValue('everyone'))).toEqual({ principalType: 'everyone', principalId: undefined });
    expect(parsePrincipal('position:n-2')).toEqual({ principalType: 'position', principalId: 'n-2' });
    expect(parsePrincipal('group:x')).toBeUndefined();
  });
});

describe('dòng nháp', () => {
  it('dòng đã lưu giữ đối tượng, quyền, thời hạn và trạng thái hết hạn', () => {
    const [unit, person] = draftsFrom(sharing);
    expect(unit).toMatchObject({ saved: true, principalType: 'unit', role: 'editor', limited: false, expiresOn: '' });
    expect(person).toMatchObject({ saved: true, limited: true, expiresOn: '2026-10-01', expired: true });
  });

  it('gửi lên: bỏ dòng chưa chọn đối tượng, thời hạn chỉ khi chọn "Đến ngày"', () => {
    const [unit, person] = draftsFrom(sharing);
    const result = grantsFrom([unit, { ...person, limited: false }, emptyDraft()]);
    expect(result).toEqual({
      grants: [
        { principalType: 'unit', principalId: 'n-1', role: 'editor', expiresOn: undefined },
        { principalType: 'user', principalId: 'u-2', role: 'viewer', expiresOn: undefined },
      ],
    });
  });

  it('thiếu quyền hay thiếu ngày hết hạn thì báo theo tên đối tượng', () => {
    const [unit] = draftsFrom(sharing);
    expect(grantsFrom([{ ...unit, role: '' }])).toEqual({ error: 'Chọn quyền cho Khối thí nghiệm.' });
    expect(grantsFrom([{ ...unit, limited: true, expiresOn: '' }])).toEqual({
      error: 'Chọn ngày hết hạn cho Khối thí nghiệm.',
    });
  });

  it('dòng mới mặc định quyền Xem, không thời hạn', () => {
    expect(emptyDraft()).toMatchObject({ saved: false, role: 'viewer', limited: false });
  });
});
