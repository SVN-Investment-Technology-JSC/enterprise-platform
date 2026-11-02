import type { TenderProfile } from '@enterprise-platform/contracts-crm';
import {
  EMPTY_TENDER_DRAFT,
  buildCreateRequest,
  buildResultRequest,
  buildUpdateRequest,
  draftFromProfile,
  isTenderConflict,
  isTenderPipeline,
  parseWinningPrice,
  tenderActions,
  tenderErrorMessage,
  toLocalInput,
} from './tender.model';

const NOW = new Date('2026-11-02T08:00:00');
const writer = { isTenantAdmin: false, canWriteOpportunity: true, canApproveQuote: false };
const approver = { isTenantAdmin: false, canWriteOpportunity: false, canApproveQuote: true };
type PlanPatch = { status?: TenderProfile['plan']['status']; submittedBy?: string | null };
const base = (patch: Partial<Omit<TenderProfile, 'plan'>> & { plan?: PlanPatch } = {}) => {
  const { plan, ...rest } = patch;
  return {
    editable: true,
    planLocked: false,
    hasJointVenture: false,
    result: null,
    scenario: null,
    ...rest,
    plan: { status: 'DRAFT' as const, submittedBy: null, ...plan },
  };
};

describe('tender.model', () => {
  it('isTenderPipeline theo profile', () => {
    expect(isTenderPipeline({ profile: 'TENDER' })).toBe(true);
    expect(isTenderPipeline({ profile: 'SALES' })).toBe(false);
    expect(isTenderPipeline(undefined)).toBe(false);
  });

  it('tenderActions: soạn, liên danh, trình, kết quả', () => {
    expect(tenderActions(base(), writer)).toEqual(['edit', 'submit', 'result']);
    expect(tenderActions(base({ hasJointVenture: true }), writer)).toContain('partners');
    expect(tenderActions(base({ hasJointVenture: true, planLocked: true, plan: { status: 'PENDING' } }), writer)).not.toContain('partners');
    expect(tenderActions(base({ plan: { status: 'APPROVED' } }), writer)).toEqual(['edit', 'result']);
    expect(tenderActions(base({ plan: { status: 'REJECTED' } }), writer)).toContain('submit');
    expect(tenderActions(base({ editable: false }), writer)).toEqual([]);
    expect(tenderActions(base(), approver)).toEqual([]);
  });

  it('tenderActions: duyệt cần quyền, đang chờ, không phải người trình', () => {
    const pending = base({ planLocked: true, plan: { status: 'PENDING', submittedBy: 'u1' } });
    expect(tenderActions(pending, approver, 'u2')).toEqual(['approve', 'reject']);
    expect(tenderActions(pending, approver, 'u1')).toEqual([]);
    expect(tenderActions(pending, writer, 'u2')).toEqual(['edit', 'result']);
    expect(tenderActions(base({ editable: false, planLocked: true, plan: { status: 'PENDING', submittedBy: 'u1' } }), approver, 'u2')).toEqual([]);
  });

  it('buildCreateRequest kiểm trường bắt buộc và hạn nộp', () => {
    expect(buildCreateRequest(EMPTY_TENDER_DRAFT, NOW)).toEqual({ ok: false, message: 'Vui lòng nhập tên gói thầu.' });
    expect(buildCreateRequest({ ...EMPTY_TENDER_DRAFT, packageName: 'Gói 1' }, NOW)).toEqual({ ok: false, message: 'Vui lòng nhập bên mời thầu.' });
    const past = buildCreateRequest({ ...EMPTY_TENDER_DRAFT, packageName: 'G', inviterName: 'B', submissionDeadline: '2026-11-01T08:00' }, NOW);
    expect(past).toEqual({ ok: false, message: 'Hạn nộp không được ở quá khứ.' });
    const ok = buildCreateRequest(
      { ...EMPTY_TENDER_DRAFT, packageName: ' G ', inviterName: 'B', submissionDeadline: '2026-12-01T08:00', submissionMethod: 'ONLINE', hasJointVenture: true },
      NOW,
    );
    expect(ok.ok && ok.body).toMatchObject({ packageName: 'G', inviterName: 'B', submissionMethod: 'ONLINE', hasJointVenture: true, packageCode: null, scenario: null });
    expect(ok.ok && ok.body.submissionDeadline).toBe(new Date('2026-12-01T08:00').toISOString());
  });

  it('buildUpdateRequest không gửi lại hạn nộp không đổi và kèm version', () => {
    const profile = { submissionDeadline: '2026-10-01T01:00:00.000Z', version: 4, packageName: 'G', inviterName: 'B' } as TenderProfile;
    const draft = { ...EMPTY_TENDER_DRAFT, packageName: 'G2', inviterName: 'B', submissionDeadline: toLocalInput(profile.submissionDeadline) };
    const built = buildUpdateRequest(draft, profile, NOW);
    expect(built.ok && built.body.version).toBe(4);
    expect(built.ok && 'submissionDeadline' in built.body).toBe(false);
    const changed = buildUpdateRequest({ ...draft, submissionDeadline: '' }, profile, NOW);
    expect(changed.ok && changed.body.submissionDeadline).toBeNull();
  });

  it('draftFromProfile chuyển giá trị rỗng thành chuỗi rỗng', () => {
    const draft = draftFromProfile({
      packageName: 'G', inviterName: 'B', packageCode: null, submissionDeadline: null, submissionMethod: null,
      submitterUserId: null, hasJointVenture: false, scenario: null,
    } as unknown as TenderProfile);
    expect(draft).toEqual({ ...EMPTY_TENDER_DRAFT, packageName: 'G', inviterName: 'B' });
  });

  it('parseWinningPrice và buildResultRequest', () => {
    expect(parseWinningPrice('1.500.000')).toBe(1500000);
    expect(parseWinningPrice('0')).toBeUndefined();
    expect(parseWinningPrice('abc')).toBeUndefined();
    expect(buildResultRequest({ result: 'WON', winningPrice: '', winnerName: '', reason: '' }, 3).ok).toBe(false);
    expect(buildResultRequest({ result: 'WON', winningPrice: '2.000', winnerName: ' ABC ', reason: 'x' }, 3)).toEqual({
      ok: true,
      body: { version: 3, result: 'WON', winningPrice: 2000, winnerName: 'ABC', reason: null },
    });
    expect(buildResultRequest({ result: 'LOST', winningPrice: '', winnerName: '', reason: ' ' }, 3)).toEqual({
      ok: false,
      message: 'Vui lòng nhập lý do trượt thầu.',
    });
    expect(buildResultRequest({ result: 'LOST', winningPrice: '5', winnerName: 'Đối thủ', reason: 'Giá cao' }, 3)).toEqual({
      ok: true,
      body: { version: 3, result: 'LOST', winnerName: 'Đối thủ', reason: 'Giá cao' },
    });
  });

  it('lỗi: STALE_VERSION cần tải lại, thiếu điều kiện liệt kê, còn lại dùng lời server', () => {
    expect(isTenderConflict({ code: 'STALE_VERSION' })).toBe(true);
    expect(isTenderConflict({ code: 'PLAN_LOCKED' })).toBe(false);
    expect(tenderErrorMessage({ code: 'STALE_VERSION' }, 'x')).toContain('tải lại');
    expect(tenderErrorMessage({ missing: [{ message: 'Phương án chưa duyệt' }] }, 'x')).toContain('Phương án chưa duyệt');
    expect(tenderErrorMessage({ code: 'PLAN_LOCKED', message: 'Phương án đang chờ duyệt' }, 'x')).toBe('Phương án đang chờ duyệt');
    expect(tenderErrorMessage(undefined, 'dự phòng')).toBe('dự phòng');
  });
});
