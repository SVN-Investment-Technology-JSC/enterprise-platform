import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import {
  SENSITIVE_HIDDEN_LABEL,
  buildEmployeesCsv,
  csvCell,
  employeeCompleteness,
  normalizeSearchText,
  sensitiveDisplay,
} from './hrm-employee-view';

function employee(over: Partial<HrmEmployeeProfile> = {}): HrmEmployeeProfile {
  return {
    employeeId: 'e1',
    tenantId: 't1',
    employeeCode: 'NV001',
    fullName: 'Nguyễn Văn An',
    email: 'an@example.com',
    department: 'Sản xuất',
    position: 'Kỹ sư',
    phone: '0900000000',
    joinDate: '2024-03-01',
    employmentStatus: 'OFFICIAL',
    identityCardNumber: '012345678901',
    taxCode: '8000000001',
    bankAccountNumber: '999888777',
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
    ...over,
  } as HrmEmployeeProfile;
}

describe('sensitiveDisplay', () => {
  it('shows the value when present', () => {
    expect(sensitiveDisplay('012345', false)).toEqual({ text: '012345', hidden: false });
  });
  it('hides null values for people without permission', () => {
    const view = sensitiveDisplay(null, false);
    expect(view.text).toBe(SENSITIVE_HIDDEN_LABEL);
    expect(view.hidden).toBe(true);
    expect(view.title).toContain('quyền');
  });
  it('shows an empty label when the viewer is allowed', () => {
    expect(sensitiveDisplay(null, true, 'Chưa liên kết')).toEqual({
      text: 'Chưa liên kết',
      hidden: false,
    });
    expect(sensitiveDisplay(undefined, true).text).toBe('Chưa cập nhật');
  });
});

describe('employeeCompleteness', () => {
  it('counts sensitive fields only for authorised viewers', () => {
    expect(employeeCompleteness(employee({ emergencyContactName: 'Mẹ' }), true)).toBe(100);
    const hidden = employee({
      identityCardNumber: null,
      taxCode: null,
      bankAccountNumber: null,
      emergencyContactName: 'Mẹ',
      dateOfBirth: '1990-01-01',
      currentAddress: 'Hà Nội',
    });
    expect(employeeCompleteness(hidden, false)).toBe(100);
    expect(employeeCompleteness(hidden, true)).toBe(50);
  });
});

describe('csv export', () => {
  it('escapes quotes, commas and formula prefixes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('nói "xin chào"')).toBe('"nói ""xin chào"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe('');
  });

  it('exports only non-sensitive displayed columns', () => {
    const csv = buildEmployeesCsv([employee()], { OFFICIAL: 'Chính thức' });
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('Mã nhân viên,Họ và tên,Email,Chức danh,Phòng ban,Ngày vào,Trạng thái');
    expect(row).toBe('NV001,Nguyễn Văn An,an@example.com,Kỹ sư,Sản xuất,2024-03-01,Chính thức');
    expect(csv).not.toContain('012345678901');
    expect(csv).not.toContain('8000000001');
    expect(csv).not.toContain('999888777');
  });

  it('tolerates missing optional values', () => {
    const csv = buildEmployeesCsv([
      employee({ fullName: null, email: null, position: null, department: null }),
    ]);
    expect(csv.split('\r\n')[1]).toBe('NV001,,,,,2024-03-01,OFFICIAL');
  });
});

describe('normalizeSearchText', () => {
  it('strips Vietnamese diacritics', () => {
    expect(normalizeSearchText('  Đỗ Thị Hương ')).toBe('do thi huong');
  });
});
