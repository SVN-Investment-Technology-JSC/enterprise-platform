import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { canDeleteQuote, quoteActions, signed } from './quote.model';

const writer = { ...CRM_NO_CAPABILITIES, canWriteQuote: true };
const lead = { ...writer, canApproveQuote: true };
const detail = (status: Parameters<typeof quoteActions>[0]['version']['status'], extra: Partial<Parameters<typeof quoteActions>[0]> = {}) => ({
  currentVersion: 1,
  procedure: null,
  version: { versionNo: 1, status, submittedBy: 'nv1' },
  ...extra,
});

describe('quoteActions', () => {
  it('nút theo trạng thái và quyền', () => {
    expect(quoteActions(detail('DRAFT'), writer)).toEqual(['edit', 'submit']);
    expect(quoteActions(detail('APPROVED'), writer)).toEqual(['revise', 'send']);
    expect(quoteActions(detail('SENT'), writer)).toEqual(['revise', 'accept', 'decline']);
    expect(quoteActions(detail('PENDING'), writer)).toEqual([]);
    expect(quoteActions(detail('PENDING'), lead, 'tn')).toEqual(['approve', 'reject']);
    expect(quoteActions(detail('EXPIRED'), lead)).toEqual([]);
  });

  it('không tự duyệt; đang duyệt qua Quy trình thì không duyệt tay; phiên bản cũ không có nút', () => {
    expect(quoteActions(detail('PENDING'), lead, 'nv1')).toEqual([]);
    const running = { id: 'l', status: 'RUNNING' as const, instanceId: 'i', instanceCode: null, result: null, lastError: null, attempts: 1 };
    expect(quoteActions(detail('PENDING', { procedure: running }), lead, 'tn')).toEqual([]);
    expect(quoteActions({ ...detail('APPROVED'), currentVersion: 2 }, writer)).toEqual([]);
  });

  it('số có dấu', () => {
    expect(signed(1000, String)).toBe('+1000');
    expect(signed(-5, String)).toBe('-5');
    expect(signed(0, String)).toBe('0');
  });
});

describe('canDeleteQuote', () => {
  const one = (status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'SENT', versions = 1) => ({
    ownerUserId: 'u1',
    versions: Array.from({ length: versions }, () => ({})) as never,
    version: { status },
  });
  it('người phụ trách xoá được báo giá Nháp, Chờ duyệt có một phiên bản', () => {
    expect(canDeleteQuote(one('DRAFT'), writer, 'u1')).toBe(true);
    expect(canDeleteQuote(one('PENDING'), writer, 'u1')).toBe(true);
  });
  it('đã duyệt, đã gửi, hoặc có phiên bản trước: không xoá', () => {
    expect(canDeleteQuote(one('APPROVED'), writer, 'u1')).toBe(false);
    expect(canDeleteQuote(one('SENT'), writer, 'u1')).toBe(false);
    expect(canDeleteQuote(one('DRAFT', 2), { ...writer, canManage: true }, 'u1')).toBe(false);
  });
  it('người khác chỉ xoá được khi có quyền quản trị bán hàng', () => {
    expect(canDeleteQuote(one('DRAFT'), writer, 'u2')).toBe(false);
    expect(canDeleteQuote(one('DRAFT'), { ...writer, canManage: true }, 'u2')).toBe(true);
    expect(canDeleteQuote(one('DRAFT'), { ...CRM_NO_CAPABILITIES }, 'u1')).toBe(false);
  });
});
