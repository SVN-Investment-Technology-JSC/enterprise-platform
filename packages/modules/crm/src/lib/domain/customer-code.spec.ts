import {
  DEFAULT_CUSTOMER_CODE_RULE,
  formatCustomerCode,
  normalizeCustomerCode,
  normalizeCustomerCodeRule,
  parseCustomerCodeRule,
} from './customer-code.js';

describe('mã khách hàng (TC-CUS-01, TC-CUS-02)', () => {
  it('sinh mã từ tiền tố và độ dài cấu hình', () => {
    expect(formatCustomerCode({ prefix: 'KH', length: 6 }, 1)).toBe('KH000001');
    expect(formatCustomerCode({ prefix: 'QA-CRM-KH', length: 3 }, 42n)).toBe('QA-CRM-KH042');
  });

  it('số vượt độ dài giữ đủ chữ số, không cắt (không bao giờ sinh trùng)', () => {
    expect(formatCustomerCode({ prefix: 'KH', length: 3 }, 12345)).toBe('KH12345');
  });

  it('số thứ tự phải dương', () => {
    expect(() => formatCustomerCode(DEFAULT_CUSTOMER_CODE_RULE, 0)).toThrow();
  });

  it('chuẩn hoá quy tắc: tiền tố viết hoa, độ dài 3 đến 12', () => {
    expect(normalizeCustomerCodeRule({ prefix: ' kh ', length: 6 })).toEqual({ prefix: 'KH', length: 6 });
    expect(normalizeCustomerCodeRule({ prefix: '', length: '4' })).toEqual({ prefix: '', length: 4 });
    expect(() => normalizeCustomerCodeRule({ prefix: 'KH', length: 2 })).toThrow('Độ dài phần số');
    expect(() => normalizeCustomerCodeRule({ prefix: 'KH', length: 13 })).toThrow('Độ dài phần số');
    expect(() => normalizeCustomerCodeRule({ prefix: 'KHÁCH', length: 6 })).toThrow('Tiền tố');
    expect(() => normalizeCustomerCodeRule({ prefix: 'ABCDEFGHIJK', length: 6 })).toThrow('Tiền tố');
  });

  it('quy tắc lưu hỏng thì dùng mặc định', () => {
    expect(parseCustomerCodeRule({ prefix: 'NCC', length: 5 })).toEqual({ prefix: 'NCC', length: 5 });
    expect(parseCustomerCodeRule(null)).toEqual(DEFAULT_CUSTOMER_CODE_RULE);
    expect(parseCustomerCodeRule({ prefix: 'KH', length: 99 })).toEqual(DEFAULT_CUSTOMER_CODE_RULE);
  });

  it('mã nhập tay: viết hoa, rỗng để hệ thống sinh, ký tự lạ bị chặn', () => {
    expect(normalizeCustomerCode(' qa-crm-kh01 ')).toBe('QA-CRM-KH01');
    expect(normalizeCustomerCode('')).toBeNull();
    expect(normalizeCustomerCode(undefined)).toBeNull();
    expect(() => normalizeCustomerCode('KH 01')).toThrow('Mã khách hàng');
    expect(() => normalizeCustomerCode(12)).toThrow('Mã khách hàng');
    expect(() => normalizeCustomerCode('K'.repeat(51))).toThrow('Mã khách hàng');
  });
});
