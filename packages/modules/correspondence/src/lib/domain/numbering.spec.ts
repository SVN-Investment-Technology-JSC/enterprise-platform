import { abbreviate, formatLetterNumber, numberFormatError, type Register } from '@enterprise-platform/contracts-correspondence';
import { letterNumber, pickRegister } from './numbering.js';

const register = (id: string, extra: Partial<Register> = {}): Register => ({
  id,
  direction: 'outgoing',
  name: id,
  numberFormat: '{so}/{loai}-{coquan}',
  confidential: false,
  letterTypes: [],
  isDefault: false,
  isActive: true,
  sortOrder: 0,
  issuedThisYear: 0,
  inUse: false,
  ...extra,
});

describe('Số và ký hiệu văn bản', () => {
  it('ghép theo mẫu, số dưới 10 thêm 0, phần trống bỏ luôn dấu nối thừa', () => {
    expect(formatLetterNumber('{so}/{loai}-{coquan}', { seq: 5, year: 2026, type: 'QĐ', org: 'SVN' })).toBe('05/QĐ-SVN');
    expect(formatLetterNumber('{so}/{loai}-{coquan}', { seq: 5, year: 2026, type: 'QĐ' })).toBe('05/QĐ');
    expect(formatLetterNumber('{so}/{coquan}-{donvi}', { seq: 123, year: 2026, org: 'SVN', unit: 'KD' })).toBe('123/SVN-KD');
    expect(formatLetterNumber('{so}/{nam}/{loai}', { seq: 12, year: 2026, type: 'TB' })).toBe('12/2026/TB');
  });

  it('ký hiệu viết tắt: chữ cái đầu, tên đơn vị bỏ "Phòng", "Ban"', () => {
    expect(abbreviate('Quyết định')).toBe('QĐ');
    expect(abbreviate('Thông báo')).toBe('TB');
    expect(abbreviate('Phòng Kinh doanh', true)).toBe('KD');
    expect(abbreviate('Ban Kiểm soát', true)).toBe('KS');
    expect(abbreviate('Văn phòng', true)).toBe('VP');
  });

  it('mẫu số phải có {so} và chỉ dùng phần đã biết', () => {
    expect(numberFormatError('{so}/{loai}-{coquan}')).toBeUndefined();
    expect(numberFormatError('')).toBe('Nhập mẫu số.');
    expect(numberFormatError('QĐ-SVN')).toContain('{so}');
    expect(numberFormatError('{so}/{phong}')).toContain('{phong}');
  });

  it('văn bản đi dùng mẫu riêng của loại văn bản; đơn vị chưa có ký hiệu thì lấy chữ cái đầu', () => {
    const settings = { orgCode: 'SVN', unitCodes: [] };
    expect(letterNumber(register('r'), { name: 'Quyết định' }, settings, { seq: 3, year: 2026 })).toBe('03/QĐ-SVN');
    expect(
      letterNumber(register('r'), { name: 'Công văn', numberFormat: '{so}/{coquan}-{donvi}' }, settings, {
        seq: 14,
        year: 2026,
        unitId: 'u1',
        unitName: 'Phòng Kinh doanh',
      }),
    ).toBe('14/SVN-KD');
    expect(
      letterNumber(register('r', { direction: 'incoming', numberFormat: '{so}/CVĐ' }), { name: 'Công văn', numberFormat: '{so}/{donvi}' }, settings, {
        seq: 1,
        year: 2026,
      }),
    ).toBe('01/CVĐ');
  });
});

describe('Chọn sổ đăng ký', () => {
  const registers = [
    register('default', { isDefault: true }),
    register('secret', { confidential: true }),
    register('decisions', { letterTypes: ['decision'] }),
    register('stopped', { letterTypes: ['notice'], isActive: false }),
  ];

  it('văn bản thường không vào sổ mật; sổ ghi đúng loại văn bản trước sổ mặc định', () => {
    expect(pickRegister(registers, 'outgoing', { kind: 'decision', restricted: false }).id).toBe('decisions');
    expect(pickRegister(registers, 'outgoing', { kind: 'notice', restricted: false }).id).toBe('default');
    expect(pickRegister(registers, 'outgoing', { kind: 'notice', restricted: true }).id).toBe('secret');
  });

  it('không có sổ mật đang dùng thì vào sổ mặc định; sổ được chọn phải đang dùng', () => {
    const plain = registers.filter((item) => item.id !== 'secret');
    expect(pickRegister(plain, 'outgoing', { kind: 'notice', restricted: true }).id).toBe('default');
    expect(pickRegister(registers, 'outgoing', { kind: 'notice', restricted: false }, 'decisions').id).toBe('decisions');
    expect(() => pickRegister(registers, 'outgoing', { kind: 'notice', restricted: false }, 'stopped')).toThrow('không còn dùng');
    expect(() => pickRegister([], 'incoming', { kind: 'notice', restricted: false })).toThrow('Chưa có sổ đăng ký');
  });
});
