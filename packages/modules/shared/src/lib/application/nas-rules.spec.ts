import {
  accountNameCandidates,
  hiddenNasEntry,
  nasAccess,
  nasEntryName,
  normalizeNasPath,
  suggestLinks,
  type NasRuleRecord,
} from './nas-rules.js';

const rules: NasRuleRecord[] = [
  { share: 'SAVINA', principalType: 'group', principalName: 'users', rule: 'read' },
  { share: 'SAVINA', principalType: 'group', principalName: 'Ban Quản Lý', rule: 'write' },
  { share: 'SAVINA', principalType: 'user', principalName: 'nhanvienb', rule: 'deny' },
  { share: 'KINH DOANH', principalType: 'group', principalName: 'Kinh Doanh', rule: 'write' },
];

describe('nasAccess – luật quyền như NAS', () => {
  it('gộp quyền của tài khoản và các nhóm: Đọc/Ghi thắng Chỉ đọc, kèm lý do', () => {
    expect(nasAccess({ name: 'quanly', groups: ['users', 'Ban Quản Lý'], disabled: false }, rules, 'SAVINA')).toEqual({
      access: 'write',
      via: ['nhóm Ban Quản Lý'],
    });
    expect(nasAccess({ name: 'nhanviena', groups: ['users'], disabled: false }, rules, 'SAVINA')).toEqual({
      access: 'read',
      via: ['nhóm users'],
    });
  });

  it('Không truy cập thắng mọi quyền khác', () => {
    expect(nasAccess({ name: 'nhanvienb', groups: ['users', 'Ban Quản Lý'], disabled: false }, rules, 'SAVINA')).toEqual({
      access: 'none',
      via: ['tài khoản nhanvienb'],
    });
  });

  it('không có dòng nào khớp, tài khoản bị khoá, hay chưa ghép thì không vào được', () => {
    expect(nasAccess({ name: 'nhanviena', groups: ['users'], disabled: false }, rules, 'KINH DOANH').access).toBe('none');
    expect(nasAccess({ name: 'quanly', groups: ['Ban Quản Lý'], disabled: true }, rules, 'SAVINA').access).toBe('none');
    expect(nasAccess(undefined, rules, 'SAVINA').access).toBe('none');
  });

  it('tên tài khoản, tên nhóm không phân biệt hoa thường như DSM', () => {
    expect(nasAccess({ name: 'NhanVienB', groups: [], disabled: false }, rules, 'SAVINA').access).toBe('none');
    expect(nasAccess({ name: 'x', groups: ['kinh doanh'], disabled: false }, rules, 'KINH DOANH').access).toBe('write');
  });
});

describe('ghép tài khoản NAS với nhân sự ERP', () => {
  it('tên tài khoản theo họ tên: tên cộng chữ đầu họ và tên đệm', () => {
    expect(accountNameCandidates('Phạm Thị Diễm Thúy')).toEqual(['thuyptd', 'thuyp']);
    expect(accountNameCandidates('Đỗ Thanh Bảo')).toEqual(['baodt', 'baod']);
    expect(accountNameCandidates('An')).toEqual(['an']);
  });

  it('ghép khi khớp đúng một người; trùng nhiều người hay một người khớp nhiều tài khoản thì để ghép tay', () => {
    const people = [
      { userId: 'u1', name: 'Phạm Thị Diễm Thúy', email: 'thuy.pham@congty.vn' },
      { userId: 'u2', name: 'Đỗ Thanh Bảo', email: 'bao.do@congty.vn' },
      { userId: 'u3', name: 'Đinh Thanh Bảo', email: 'bao.dinh@congty.vn' },
      { userId: 'u4', name: 'Hồ Văn Thọ', email: 'tho.ho@congty.vn' },
    ];
    const links = suggestLinks(
      [{ name: 'thuyptd' }, { name: 'baodt' }, { name: 'tho.ho' }, { name: 'savina', email: 'Thuy.Pham@congty.vn' }, { name: 'khac' }],
      people,
    );
    // baodt khớp cả u2 lẫn u3; thuyptd và savina cùng khớp u1.
    expect(Object.fromEntries(links)).toEqual({ 'tho.ho': 'u4' });
    expect(Object.fromEntries(suggestLinks([{ name: 'thuyptd' }], people))).toEqual({ thuyptd: 'u1' });
  });
});

describe('đường dẫn và tên trên NAS', () => {
  it('chuẩn hoá đường dẫn, chặn thoát khỏi thư mục chia sẻ', () => {
    expect(normalizeNasPath('')).toBe('');
    expect(normalizeNasPath('/HỢP ĐỒNG 2025//HĐ 01/')).toBe('HỢP ĐỒNG 2025/HĐ 01');
    for (const bad of ['../etc', 'a/../../b', 'a/./b', 'a\\b', 'a\0b', 42]) {
      expect(() => normalizeNasPath(bad)).toThrow('Đường dẫn không hợp lệ.');
    }
  });

  it('tên mới không chứa ký tự NAS không nhận', () => {
    expect(nasEntryName('  Hồ sơ 2026 ')).toBe('Hồ sơ 2026');
    for (const bad of ['', 'a/b', 'a:b', 'tên?', 'kết thúc.', '..']) expect(() => nasEntryName(bad)).toThrow();
  });

  it('ẩn thư mục hệ thống của NAS', () => {
    expect(hiddenNasEntry('@eaDir')).toBe(true);
    expect(hiddenNasEntry('#snapshot')).toBe(true);
    expect(hiddenNasEntry('#recycle')).toBe(false);
    expect(hiddenNasEntry('HỢP ĐỒNG')).toBe(false);
  });
});
