import {
  maskAccountNumber,
  maskPayrollTotalBank,
  redactSensitiveDocuments,
  redactSensitiveProfile,
  redactSensitiveRow,
} from './hrm-profile-visibility';

describe('Che dữ liệu nhạy cảm hồ sơ (ISS-BE-048, SEC-BE048-01)', () => {
  it('dòng hồ sơ thô: bỏ số, ngày cấp, nơi cấp, ngày hết hạn và mã tệp ảnh CCCD', () => {
    const row = {
      employee_id: 'e1',
      full_name: 'Nguyễn Văn A',
      identity_card_number: '001200000001',
      identity_card_issued_date: '2020-01-01',
      identity_card_issued_place: 'Cục CS',
      identity_card_expiry_date: '2045-01-01',
      identity_card_front_attachment_id: 'file-front',
      identity_card_back_attachment_id: 'file-back',
      photo_attachment_id: 'file-photo',
      bank_account_number: '0123456789',
    };
    const redacted = redactSensitiveRow(row);
    expect(redacted).toMatchObject({
      identity_card_number: null,
      identity_card_issued_date: null,
      identity_card_issued_place: null,
      identity_card_expiry_date: null,
      identity_card_front_attachment_id: null,
      identity_card_back_attachment_id: null,
      bank_account_number: null,
    });
    expect(redacted.employee_id).toBe('e1');
    expect(redacted.photo_attachment_id).toBe('file-photo');
    // Không sửa đối tượng gốc.
    expect(row.identity_card_front_attachment_id).toBe('file-front');
  });

  it('hồ sơ camelCase: bỏ ngày cấp và ngày hết hạn CCCD, không thêm khóa không có', () => {
    const redacted = redactSensitiveProfile({
      fullName: 'A',
      identityCardNumber: '001',
      identityCardIssuedDate: '2020-01-01',
    });
    expect(redacted).toEqual({ fullName: 'A', identityCardNumber: null, identityCardIssuedDate: null });
  });

  it('giấy tờ hồ sơ: bỏ tệp ảnh và ngày hết hạn CCCD, giữ ảnh thẻ và bằng cấp', () => {
    const photo = { id: 'p' };
    const redacted = redactSensitiveDocuments({
      employeeId: 'e1',
      identityCardExpiryDate: '2045-01-01',
      photo,
      identityCardFront: { id: 'f' },
      identityCardBack: { id: 'b' },
      qualifications: [],
    });
    expect(redacted).toEqual({
      employeeId: 'e1',
      identityCardExpiryDate: null,
      photo,
      identityCardFront: null,
      identityCardBack: null,
      qualifications: [],
    });
  });
});

describe('Che số tài khoản trong bảng tổng lương (SEC-BE048-04)', () => {
  it('chỉ giữ 4 số cuối', () => {
    expect(maskAccountNumber('0123 4567 891234')).toBe('****1234');
    expect(maskAccountNumber('12')).toBe('****12');
    expect(maskAccountNumber(null)).toBeNull();
    expect(maskAccountNumber('')).toBe('');
  });

  it('che bank_account_number trong beneficiary_snapshot, giữ tên ngân hàng', () => {
    const row = {
      id: 't1',
      net_salary: '1000',
      beneficiary_snapshot: { full_name: 'A', bank_name: 'VCB', bank_account_number: '0011001234' },
    };
    expect(maskPayrollTotalBank(row)).toEqual({
      id: 't1',
      net_salary: '1000',
      beneficiary_snapshot: { full_name: 'A', bank_name: 'VCB', bank_account_number: '****1234' },
    });
    expect(row.beneficiary_snapshot.bank_account_number).toBe('0011001234');
  });

  it('dòng chưa có snapshot thì giữ nguyên', () => {
    const row = { id: 't1', beneficiary_snapshot: null };
    expect(maskPayrollTotalBank(row)).toBe(row);
  });
});
