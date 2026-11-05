import { CrmValidationError } from './crm.error.js';
import { isValidTaxCode, normalizeTaxCode } from './tax-code.js';

describe('mã số thuế (TC-CUS-03, TC-CUS-04)', () => {
  it.each(['0101234567', '0101234567-001'])('nhận %s', (value) => {
    expect(isValidTaxCode(value)).toBe(true);
    expect(normalizeTaxCode(`  ${value} `)).toBe(value);
  });

  it.each(['01012345', '0101234567-01', 'ABC1234567', '01012 34567', '0101234567 -001', '01012345678', '0101234567-0011'])(
    'từ chối %s với thông báo tiếng Việt',
    (value) => {
      expect(() => normalizeTaxCode(value)).toThrow(CrmValidationError);
      expect(() => normalizeTaxCode(value)).toThrow('Mã số thuế không đúng định dạng');
    },
  );

  it('rỗng là chưa có MST; kiểu lạ là sai định dạng', () => {
    expect(normalizeTaxCode(undefined)).toBeNull();
    expect(normalizeTaxCode(null)).toBeNull();
    expect(normalizeTaxCode('   ')).toBeNull();
    expect(() => normalizeTaxCode(101234567)).toThrow('Mã số thuế không đúng định dạng');
  });
});
