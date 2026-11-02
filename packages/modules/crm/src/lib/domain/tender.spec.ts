import { CrmConflictError, CrmValidationError } from './crm.error.js';
import {
  assertDeadlineNotPast,
  assertTenderPlanReady,
  assertTenderPlanSubmittable,
  normalizeNewTenderProfile,
  normalizeTenderPartner,
  normalizeTenderProfilePatch,
  normalizeTenderResult,
  tenderPlanImpact,
} from './tender.js';

const NOW = new Date('2026-11-02T03:00:00.000Z');
const base = { packageName: ' Gói thầu A ', inviterName: 'Sở Y tế' };

describe('hồ sơ thầu: chuẩn hoá khi tạo (TC-TND-01)', () => {
  it('tên gói và bên mời thầu bắt buộc, được cắt khoảng trắng; còn lại mặc định rỗng', () => {
    expect(normalizeNewTenderProfile(base, NOW)).toEqual({
      packageName: 'Gói thầu A',
      inviterName: 'Sở Y tế',
      packageCode: null,
      submissionDeadline: null,
      submissionMethod: null,
      submitterUserId: null,
      hasJointVenture: false,
      scenario: null,
    });
    expect(() => normalizeNewTenderProfile({ inviterName: 'X' }, NOW)).toThrow(CrmValidationError);
    expect(() => normalizeNewTenderProfile({ packageName: 'X' }, NOW)).toThrow(CrmValidationError);
  });

  it('hạn nộp ở quá khứ bị từ chối, hạn tương lai được chuẩn hoá sang ISO UTC', () => {
    expect(() => normalizeNewTenderProfile({ ...base, submissionDeadline: '2026-11-01T00:00:00Z' }, NOW)).toThrow(
      expect.objectContaining({ code: 'DEADLINE_IN_PAST' }),
    );
    expect(normalizeNewTenderProfile({ ...base, submissionDeadline: '2026-11-10T09:00:00+07:00' }, NOW).submissionDeadline).toBe(
      '2026-11-10T02:00:00.000Z',
    );
    expect(() => normalizeNewTenderProfile({ ...base, submissionDeadline: 'không phải ngày' }, NOW)).toThrow(CrmValidationError);
    expect(() => assertDeadlineNotPast(null, NOW)).not.toThrow();
  });

  it('hình thức nộp chỉ nhận ONLINE, IN_PERSON, POST; liên danh phải là boolean', () => {
    expect(normalizeNewTenderProfile({ ...base, submissionMethod: 'POST' }, NOW).submissionMethod).toBe('POST');
    expect(() => normalizeNewTenderProfile({ ...base, submissionMethod: 'FAX' }, NOW)).toThrow(CrmValidationError);
    expect(() => normalizeNewTenderProfile({ ...base, hasJointVenture: 'có' }, NOW)).toThrow(CrmValidationError);
    expect(() => normalizeNewTenderProfile({ ...base, submitterUserId: 'abc' }, NOW)).toThrow(CrmValidationError);
  });
});

describe('hồ sơ thầu: chuẩn hoá khi sửa', () => {
  it('chỉ trường có trong request mới đổi; null xoá giá trị', () => {
    expect(normalizeTenderProfilePatch({ version: 1, packageCode: null, scenario: ' Kịch bản 1 ' }, null, NOW)).toEqual({
      packageCode: null,
      scenario: 'Kịch bản 1',
    });
    expect(normalizeTenderProfilePatch({ version: 1 }, null, NOW)).toEqual({});
  });

  it('hạn nộp đã qua không đổi thì lưu được trường khác; đổi sang quá khứ thì bị từ chối', () => {
    const past = '2026-10-01T00:00:00.000Z';
    expect(normalizeTenderProfilePatch({ submissionDeadline: past }, past, NOW)).toEqual({ submissionDeadline: past });
    expect(() => normalizeTenderProfilePatch({ submissionDeadline: '2026-10-02T00:00:00.000Z' }, past, NOW)).toThrow(CrmValidationError);
    expect(normalizeTenderProfilePatch({ submissionDeadline: null }, past, NOW)).toEqual({ submissionDeadline: null });
  });

  it('tên gói không được xoá trống', () => {
    expect(() => normalizeTenderProfilePatch({ packageName: ' ' }, null, NOW)).toThrow(CrmValidationError);
  });
});

describe('đối tác liên danh (TC-TND-14)', () => {
  it('tên bắt buộc, phạm vi không bắt buộc', () => {
    expect(normalizeTenderPartner({ name: ' Công ty B ', scope: ' Thi công ' })).toEqual({ name: 'Công ty B', scope: 'Thi công' });
    expect(normalizeTenderPartner({ name: 'Công ty C' })).toEqual({ name: 'Công ty C', scope: null });
    expect(() => normalizeTenderPartner({ scope: 'x' })).toThrow(CrmValidationError);
  });
});

describe('kết quả thầu (TC-TND-09, TC-TND-10)', () => {
  it('Trúng: bắt buộc giá trúng lớn hơn 0, lý do bị bỏ', () => {
    expect(normalizeTenderResult({ result: 'WON', winningPrice: 1_500_000_000, winnerName: 'Chính mình', reason: 'x' })).toEqual({
      result: 'WON',
      winningPrice: 1_500_000_000,
      winnerName: 'Chính mình',
      reason: null,
    });
    expect(() => normalizeTenderResult({ result: 'WON' })).toThrow(expect.objectContaining({ code: 'WINNING_PRICE_REQUIRED' }));
    expect(() => normalizeTenderResult({ result: 'WON', winningPrice: 0 })).toThrow(CrmValidationError);
  });

  it('Trượt: bắt buộc lý do; giá trúng và đơn vị trúng của bên thắng không bắt buộc', () => {
    expect(() => normalizeTenderResult({ result: 'LOST', reason: '  ' })).toThrow(expect.objectContaining({ code: 'LOST_REASON_REQUIRED' }));
    expect(normalizeTenderResult({ result: 'LOST', reason: 'Giá cao hơn', winnerName: 'Đối thủ', winningPrice: 900 })).toEqual({
      result: 'LOST',
      winningPrice: 900,
      winnerName: 'Đối thủ',
      reason: 'Giá cao hơn',
    });
    expect(() => normalizeTenderResult({ result: 'MAYBE' })).toThrow(CrmValidationError);
    expect(() => normalizeTenderResult({})).toThrow(expect.objectContaining({ code: 'RESULT_REQUIRED' }));
  });
});

describe('duyệt phương án chào thầu (TC-TND-03..05)', () => {
  it('chỉ trình khi đang soạn hoặc bị trả về; chờ duyệt hay đã duyệt thì 409', () => {
    expect(() => assertTenderPlanSubmittable('DRAFT')).not.toThrow();
    expect(() => assertTenderPlanSubmittable('REJECTED')).not.toThrow();
    expect(() => assertTenderPlanSubmittable('PENDING')).toThrow(CrmConflictError);
    expect(() => assertTenderPlanSubmittable('APPROVED')).toThrow(CrmConflictError);
  });

  it('cả hai nhánh cần kịch bản; nhánh có liên danh cần thêm ít nhất một đối tác', () => {
    expect(() => assertTenderPlanReady({ scenario: null, hasJointVenture: false }, 0)).toThrow(expect.objectContaining({ code: 'SCENARIO_REQUIRED' }));
    expect(() => assertTenderPlanReady({ scenario: 'Phương án', hasJointVenture: false }, 0)).not.toThrow();
    expect(() => assertTenderPlanReady({ scenario: 'Phương án', hasJointVenture: true }, 0)).toThrow(expect.objectContaining({ code: 'PARTNERS_REQUIRED' }));
    expect(() => assertTenderPlanReady({ scenario: 'Phương án', hasJointVenture: true }, 2)).not.toThrow();
  });

  it('sửa kịch bản, liên danh khi chờ duyệt bị khoá; đã duyệt thì sửa được nhưng phải duyệt lại', () => {
    expect(() => tenderPlanImpact('PENDING')).toThrow(expect.objectContaining({ code: 'PLAN_LOCKED' }));
    expect(tenderPlanImpact('APPROVED')).toEqual({ resetsApproval: true });
    expect(tenderPlanImpact('DRAFT')).toEqual({ resetsApproval: false });
    expect(tenderPlanImpact('REJECTED')).toEqual({ resetsApproval: false });
  });
});
