import {
  formatProjectCode,
  nextProjectCodeNumber,
  projectCodeParts,
  projectCodeTemplateError,
} from './project-code.js';

const ctx = { year: 2026, month: 3, groupCode: 'DVTN', groupName: 'Dịch vụ thí nghiệm' };

describe('projectCodeParts + formatProjectCode', () => {
  it('ví dụ theo loại dự án: DA_{NHOM}_{SO:4} → DA_DVTN_0001', () => {
    expect(formatProjectCode(projectCodeParts('DA_{NHOM}_{SO:4}', ctx), 1)).toBe('DA_DVTN_0001');
  });

  it('ví dụ theo năm: DA_{NAM}_{SO:3} → DA_2026_001; năm 2 số và tháng', () => {
    expect(formatProjectCode(projectCodeParts('DA_{NAM}_{SO:3}', ctx), 1)).toBe('DA_2026_001');
    expect(formatProjectCode(projectCodeParts('{NAM2}{THANG}-{SO:2}', ctx), 7)).toBe('2603-07');
  });

  it('chấp nhận chữ thường và khoảng trắng khi gõ quy tắc', () => {
    expect(formatProjectCode(projectCodeParts(' da_{nhom}_{so:4} ', ctx), 12)).toBe('DA_DVTN_0012');
  });

  it('số thứ tự ở giữa: phần sau số giữ nguyên', () => {
    expect(projectCodeParts('DA-{SO:3}-{NAM}', ctx)).toEqual({ prefix: 'DA-', suffix: '-2026', width: 3 });
  });

  it('quy tắc cần mã nhóm mà nhóm chưa có mã thì báo rõ tên nhóm', () => {
    expect(() => projectCodeParts('DA_{NHOM}_{SO:4}', { year: 2026, month: 1, groupName: 'Thí nghiệm' })).toThrow(
      'Nhóm dự án "Thí nghiệm" chưa có mã viết tắt',
    );
    expect(() => projectCodeParts('DA_{NHOM}_{SO:4}', { year: 2026, month: 1 })).toThrow('chọn nhóm dự án');
  });
});

describe('nextProjectCodeNumber', () => {
  const parts = { prefix: 'DA_DVTN_', suffix: '', width: 4 };

  it('lấy số lớn nhất cùng phần đầu rồi cộng một; dãy của nhóm khác không tính', () => {
    expect(nextProjectCodeNumber(parts, ['DA_DVTN_0001', 'DA_DVTN_0007', 'DA_KT_0050', 'DA_DVTN_ABC'])).toBe(8);
  });

  it('chưa có mã nào thì bắt đầu từ 1; số vượt độ rộng vẫn được tính', () => {
    expect(nextProjectCodeNumber(parts, [])).toBe(1);
    expect(nextProjectCodeNumber({ prefix: 'DA-', suffix: '', width: 2 }, ['DA-99', 'DA-100'])).toBe(101);
  });

  it('năm mới là một dãy mới', () => {
    expect(nextProjectCodeNumber({ prefix: 'DA_2027_', suffix: '', width: 3 }, ['DA_2026_015'])).toBe(1);
  });
});

describe('projectCodeTemplateError', () => {
  it('quy tắc hợp lệ', () => {
    expect(projectCodeTemplateError('DA_{NHOM}_{SO:4}')).toBeUndefined();
    expect(projectCodeTemplateError('DA-{NAM}-{SO:3}')).toBeUndefined();
  });

  it('phải có đúng một số thứ tự, độ rộng 2–6', () => {
    expect(projectCodeTemplateError('DA_{NAM}')).toContain('đúng một token số thứ tự');
    expect(projectCodeTemplateError('{SO:3}{SO:3}')).toContain('đúng một token số thứ tự');
    expect(projectCodeTemplateError('DA{SO:1}')).toContain('từ 2 đến 6');
  });

  it('token lạ hay ký tự lạ bị từ chối', () => {
    expect(projectCodeTemplateError('DA_{LOAI}_{SO:3}')).toContain('Token không hợp lệ');
    expect(projectCodeTemplateError('DA.{SO:3}')).toContain('chỉ được có');
    expect(projectCodeTemplateError('')).toContain('không được để trống');
  });

  it('mã sinh ra quá dài bị từ chối', () => {
    expect(projectCodeTemplateError(`${'A'.repeat(28)}{SO:6}`)).toContain('dài quá 32');
  });
});
