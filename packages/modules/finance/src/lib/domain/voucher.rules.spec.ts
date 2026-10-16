import type { SaveFinanceVoucherRequest } from '@enterprise-platform/contracts-finance';
import {
  assertPostingDateAllowed,
  computeVoucherPermissions,
  isValidDate,
  normalizeVoucherInput,
  validateForSubmit,
  type PermissionInput,
  type SubmitReferences,
} from './voucher.rules.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const receipt = (over: Partial<SaveFinanceVoucherRequest> = {}): SaveFinanceVoucherRequest => ({
  kind: 'RECEIPT',
  voucherDate: '2026-10-14',
  postingDate: '2026-10-14',
  content: 'Thu tiền hàng đợt 1',
  reasonId: ID(1),
  accountId: ID(2),
  counterpartyGroupId: ID(3),
  lines: [{ description: 'Hàng A', quantity: 2, unitAmount: 150_000, total: 0 }],
  ...over,
});

describe('normalizeVoucherInput', () => {
  it('server tự tính thành tiền và tổng, không tin số client gửi', () => {
    const v = normalizeVoucherInput(receipt({ lines: [{ description: 'Hàng A', quantity: 2, unitAmount: 150_000, total: 1 }] }));
    expect(v.lines).toEqual([{ lineNo: 1, description: 'Hàng A', quantity: 2, unitAmount: 150_000, total: 300_000 }]);
    expect(v.totalAmount).toBe(300_000);
  });

  it('bỏ qua dòng trắng nhưng báo lỗi dòng có tiền mà thiếu diễn giải', () => {
    const v = normalizeVoucherInput(
      receipt({
        lines: [
          { description: '', quantity: 1, unitAmount: 0, total: 0 },
          { description: 'B', quantity: 1, unitAmount: 5, total: 5 },
        ],
      }),
    );
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0].lineNo).toBe(1);
    expect(() => normalizeVoucherInput(receipt({ lines: [{ description: ' ', quantity: 1, unitAmount: 5, total: 5 }] }))).toThrow(/thiếu diễn giải/);
  });

  it('từ chối số liệu sai: số lượng <= 0, tiền âm, vượt giới hạn, ngày không có trong lịch', () => {
    const bad = (over: Partial<SaveFinanceVoucherRequest>) => () => normalizeVoucherInput(receipt(over));
    expect(bad({ lines: [{ description: 'A', quantity: 0, unitAmount: 5, total: 0 }] })).toThrow(/Số lượng/);
    expect(bad({ lines: [{ description: 'A', quantity: 1, unitAmount: -5, total: 0 }] })).toThrow(/không được âm/);
    expect(bad({ lines: [{ description: 'A', quantity: 1, unitAmount: 1e16, total: 0 }] })).toThrow(/vượt giới hạn/);
    expect(bad({ voucherDate: '2026-02-30' })).toThrow(/Ngày lập phiếu/);
    expect(bad({ content: '   ' })).toThrow(/Nội dung/);
    expect(bad({ reasonId: 'abc' })).toThrow(/Lý do/);
  });

  it('lệnh chuyển tiền dùng số tiền riêng và bỏ các trường chỉ có ở phiếu thu/chi', () => {
    const v = normalizeVoucherInput({
      kind: 'TRANSFER',
      voucherDate: '2026-10-14',
      postingDate: '2026-10-14',
      content: 'Chuyển quỹ',
      accountId: ID(2),
      destAccountId: ID(4),
      amount: 5_000_000,
      reasonId: ID(1),
      taxIncluded: true,
      taxRate: 10,
      lines: [{ description: 'bị bỏ', quantity: 1, unitAmount: 9, total: 9 }],
    });
    expect(v).toMatchObject({ totalAmount: 5_000_000, reasonId: null, taxIncluded: false, taxRate: 0 });
    expect(v.lines).toEqual([]);
  });

  it('thuế suất chỉ giữ khi bật "Bao gồm thuế"; hoá đơn được kiểm', () => {
    expect(normalizeVoucherInput(receipt({ taxIncluded: false, taxRate: 8 })).taxRate).toBe(0);
    expect(normalizeVoucherInput(receipt({ taxIncluded: true, taxRate: 8 })).taxRate).toBe(8);
    expect(() => normalizeVoucherInput(receipt({ taxIncluded: true, taxRate: 120 }))).toThrow(/100%/);
    expect(() => normalizeVoucherInput(receipt({ invoices: [{ invoiceNo: '', invoiceDate: null, taxCode: null, amount: 1 }] }))).toThrow(/số hoá đơn/);
    const ok = normalizeVoucherInput(receipt({ invoices: [{ invoiceNo: ' HD01 ', invoiceDate: '2026-10-01', taxCode: null, amount: 10 }] }));
    expect(ok.invoices[0].invoiceNo).toBe('HD01');
  });

  it('ghi chú: khử trùng HTML, chỉ giữ ảnh tham chiếu bằng marker, từ chối vượt giới hạn độ dài', () => {
    const v = normalizeVoucherInput(
      receipt({ note: '<p>Xin chào <strong>bạn</strong></p><script>alert(1)</script><img src="javascript:alert(1)"><img src="voucher-note-image://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee">' }),
    );
    // <script> bị loại hẳn; src không hợp lệ bị tước (ảnh vỡ, không thực thi được) chứ không giữ nguyên.
    expect(v.note).not.toContain('<script');
    expect(v.note).not.toContain('javascript:');
    expect(v.note).toContain('<img src="voucher-note-image://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"');
    expect(() => normalizeVoucherInput(receipt({ note: 'x'.repeat(20_001) }))).toThrow(/Ghi chú/);
  });
});

describe('hạch toán cho dự án/công việc và dự án liên quan', () => {
  const P1 = ID(11).toUpperCase();
  const P2 = ID(12);
  const W1 = ID(21);

  it('mặc định không hạch toán, không dự án liên quan', () => {
    expect(normalizeVoucherInput(receipt())).toMatchObject({ allocation: null, relatedProjectIds: [] });
  });

  it('hạch toán cho dự án: chỉ cần dự án, id chuẩn hoá chữ thường', () => {
    const v = normalizeVoucherInput(receipt({ allocation: { type: 'PROJECT', projectId: P1 } }));
    expect(v.allocation).toEqual({ type: 'PROJECT', projectId: ID(11), workItemId: null });
  });

  it('hạch toán cho công việc: bắt buộc công việc; hạch toán cho dự án không được kèm công việc', () => {
    expect(normalizeVoucherInput(receipt({ allocation: { type: 'WORK_ITEM', projectId: P2, workItemId: W1 } })).allocation).toEqual({
      type: 'WORK_ITEM',
      projectId: P2,
      workItemId: W1,
    });
    expect(() => normalizeVoucherInput(receipt({ allocation: { type: 'WORK_ITEM', projectId: P2 } }))).toThrow(/công việc/);
    expect(() => normalizeVoucherInput(receipt({ allocation: { type: 'PROJECT', projectId: P2, workItemId: W1 } }))).toThrow(/không kèm công việc/);
  });

  it('từ chối hình thức lạ, thiếu dự án và id không hợp lệ', () => {
    expect(() => normalizeVoucherInput(receipt({ allocation: { type: 'TEAM' as never, projectId: P2 } }))).toThrow(/Hình thức hạch toán/);
    expect(() => normalizeVoucherInput(receipt({ allocation: { type: 'PROJECT', projectId: '' } }))).toThrow(/Chọn dự án/);
    expect(() => normalizeVoucherInput(receipt({ allocation: { type: 'PROJECT', projectId: 'abc' } }))).toThrow(/không hợp lệ/);
    expect(() => normalizeVoucherInput(receipt({ allocation: { type: 'WORK_ITEM', projectId: P2, workItemId: 'abc' } }))).toThrow(/không hợp lệ/);
  });

  it('lệnh chuyển tiền không hạch toán cho dự án', () => {
    expect(() =>
      normalizeVoucherInput({
        kind: 'TRANSFER',
        voucherDate: '2026-10-14',
        postingDate: '2026-10-14',
        content: 'Chuyển quỹ',
        accountId: ID(2),
        destAccountId: ID(4),
        amount: 1_000,
        allocation: { type: 'PROJECT', projectId: P2 },
      }),
    ).toThrow(/Lệnh chuyển tiền không hạch toán/);
  });

  it('dự án liên quan: bỏ trùng, bỏ dự án đang hạch toán, kiểm id và giới hạn số lượng', () => {
    const v = normalizeVoucherInput(
      receipt({ allocation: { type: 'PROJECT', projectId: P2 }, relatedProjectIds: [P1, P1.toLowerCase(), P2, ID(13)] }),
    );
    expect(v.relatedProjectIds).toEqual([ID(11), ID(13)]);
    expect(() => normalizeVoucherInput(receipt({ relatedProjectIds: ['abc'] }))).toThrow(/không hợp lệ/);
    expect(() => normalizeVoucherInput(receipt({ relatedProjectIds: [''] }))).toThrow(/không hợp lệ/);
    expect(() => normalizeVoucherInput(receipt({ relatedProjectIds: 'x' as never }))).toThrow(/không hợp lệ/);
    const many = Array.from({ length: 51 }, (_, index) => ID(100 + index));
    expect(() => normalizeVoucherInput(receipt({ relatedProjectIds: many }))).toThrow(/Tối đa 50/);
  });

  it('lệnh chuyển tiền vẫn gắn được dự án liên quan (chỉ tham chiếu)', () => {
    const v = normalizeVoucherInput({
      kind: 'TRANSFER',
      voucherDate: '2026-10-14',
      postingDate: '2026-10-14',
      content: 'Chuyển quỹ',
      accountId: ID(2),
      destAccountId: ID(4),
      amount: 1_000,
      relatedProjectIds: [P1],
    });
    expect(v.allocation).toBeNull();
    expect(v.relatedProjectIds).toEqual([ID(11)]);
  });
});

describe('validateForSubmit', () => {
  const refs = (over: Partial<SubmitReferences> = {}): SubmitReferences => ({
    account: { name: 'VCB', isActive: true, openingDate: '2026-01-01' },
    dest: null,
    reason: { kind: 'RECEIPT', isActive: true },
    counterpartyGroup: { isActive: true },
    ...over,
  });

  it('phiếu thu đủ thông tin thì hợp lệ', () => {
    expect(validateForSubmit(normalizeVoucherInput(receipt()), refs())).toEqual([]);
  });

  it('thiếu lý do, đối tượng, tài khoản, dòng chi tiết thì báo từng lỗi', () => {
    const errors = validateForSubmit(
      normalizeVoucherInput(receipt({ reasonId: null, counterpartyGroupId: null, accountId: null, lines: [] })),
      refs({ account: null, reason: null, counterpartyGroup: null }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'Số tiền phải lớn hơn 0.',
        'Cần ít nhất một dòng chi tiết.',
        'Chọn lý do thu.',
        'Chọn đối tượng thu.',
        'Chọn tài khoản thu.',
      ]),
    );
  });

  it('lý do sai loại, tài khoản ngừng dùng hoặc ngày hạch toán trước ngày bắt đầu đều bị chặn', () => {
    const errors = validateForSubmit(
      normalizeVoucherInput(receipt({ postingDate: '2025-12-31', voucherDate: '2025-12-31' })),
      refs({ reason: { kind: 'PAYMENT', isActive: true }, account: { name: 'VCB', isActive: false, openingDate: '2026-01-01' } }),
    );
    expect(errors).toContain('Lý do không đúng loại phiếu.');
    expect(errors).toContain('Tài khoản thu đã ngừng sử dụng.');
    expect(errors.some((e) => e.includes('trước ngày bắt đầu sử dụng'))).toBe(true);
  });

  it('lệnh chuyển tiền cần nguồn khác đích và số tiền dương', () => {
    const transfer = (over: Partial<SaveFinanceVoucherRequest>) =>
      normalizeVoucherInput({
        kind: 'TRANSFER',
        voucherDate: '2026-10-14',
        postingDate: '2026-10-14',
        content: 'Chuyển quỹ',
        accountId: ID(2),
        destAccountId: ID(4),
        amount: 1000,
        ...over,
      });
    const both = {
      account: { name: 'A', isActive: true, openingDate: '2026-01-01' },
      dest: { name: 'B', isActive: true, openingDate: '2026-01-01' },
    };
    expect(validateForSubmit(transfer({}), refs(both))).toEqual([]);
    // Nguồn trùng đích bị chặn ngay khi chuẩn hoá (trước cả khi lưu nháp).
    expect(() => transfer({ destAccountId: ID(2) })).toThrow(/khác nhau/);
    expect(validateForSubmit(transfer({ amount: 0 }), refs(both))).toContain('Số tiền phải lớn hơn 0.');
    expect(validateForSubmit(transfer({ destAccountId: null }), refs({ account: both.account }))).toContain('Chọn tài khoản đích.');
  });
});

describe('computeVoucherPermissions', () => {
  const base: PermissionInput = {
    status: 'DRAFT',
    createdBy: 'u1',
    actorId: 'u1',
    canCreate: true,
    canApprove: false,
    allowSelfApproval: false,
    approvalMode: 'DIRECT',
    procedureCanAct: null,
  };

  it('phiếu tạo từ hồ sơ quy trình (INHERITED): không có thao tác thường nào, kể cả với chủ phiếu và người duyệt', () => {
    for (const status of ['DRAFT', 'APPROVED'] as const)
      expect(computeVoucherPermissions({ ...base, status, canApprove: true, approvalMode: 'INHERITED' })).toEqual({
        canEdit: false,
        canSubmit: false,
        canApprove: false,
        canReject: false,
        canCancel: false,
        canReverse: false,
        canDelete: false,
        canRetryProcedure: false,
        sourced: { canEditSourced: false, canPost: false, canReturnSource: false, canTakeOver: false, canRetryReversal: false },
      });
  });

  it('chủ phiếu sửa, gửi duyệt, huỷ, xoá được khi còn nháp; người khác thì không', () => {
    expect(computeVoucherPermissions(base)).toMatchObject({ canEdit: true, canSubmit: true, canCancel: true, canDelete: true, canApprove: false });
    expect(computeVoucherPermissions({ ...base, actorId: 'u2' })).toMatchObject({ canEdit: false, canSubmit: false, canDelete: false });
  });

  it('không tự duyệt phiếu của mình trừ khi tenant bật ngoại lệ', () => {
    const pending = { ...base, status: 'PENDING' as const, canApprove: true };
    expect(computeVoucherPermissions(pending).canApprove).toBe(false);
    expect(computeVoucherPermissions({ ...pending, allowSelfApproval: true }).canApprove).toBe(true);
    expect(computeVoucherPermissions({ ...pending, actorId: 'u2', canCreate: false }).canApprove).toBe(true);
  });

  it('chế độ quy trình: chỉ người đang được giao bước hiện tại mới duyệt', () => {
    const pending = {
      ...base,
      actorId: 'u2',
      canCreate: false,
      status: 'PENDING' as const,
      canApprove: true,
      approvalMode: 'PROCEDURE' as const,
    };
    expect(computeVoucherPermissions({ ...pending, procedureCanAct: false }).canApprove).toBe(false);
    expect(computeVoucherPermissions({ ...pending, procedureCanAct: null }).canApprove).toBe(false);
    expect(computeVoucherPermissions({ ...pending, procedureCanAct: true })).toMatchObject({ canApprove: true, canReject: true });
  });

  it('chỉ người có quyền duyệt mới đảo phiếu đã ghi sổ; phiếu đã ghi sổ không sửa/huỷ thường', () => {
    const approved = { ...base, status: 'APPROVED' as const };
    expect(computeVoucherPermissions(approved)).toMatchObject({ canEdit: false, canCancel: false, canReverse: false, canDelete: false });
    expect(computeVoucherPermissions({ ...approved, canApprove: true }).canReverse).toBe(true);
  });

  it('phiếu bị từ chối được chủ phiếu sửa và gửi lại', () => {
    expect(computeVoucherPermissions({ ...base, status: 'REJECTED' })).toMatchObject({ canEdit: true, canSubmit: true, canDelete: false });
  });

  it('phiếu đang chờ duyệt trực tiếp: chủ phiếu sửa và xoá được ngay (không qua nháp); qua quy trình thì không', () => {
    const pendingDirect = { ...base, status: 'PENDING' as const };
    expect(computeVoucherPermissions(pendingDirect)).toMatchObject({ canEdit: true, canDelete: true, canSubmit: false });
    const pendingProcedure = { ...base, status: 'PENDING' as const, approvalMode: 'PROCEDURE' as const };
    expect(computeVoucherPermissions(pendingProcedure)).toMatchObject({ canEdit: false, canDelete: false });
    // Người không phải chủ phiếu thì không sửa/xoá được dù đang chờ duyệt trực tiếp.
    expect(computeVoucherPermissions({ ...pendingDirect, actorId: 'u2', canCreate: false })).toMatchObject({ canEdit: false, canDelete: false });
  });
});

describe('ngày hạch toán', () => {
  it('chặn ngày trong kỳ đã khoá sổ hoặc ở tương lai', () => {
    expect(() => assertPostingDateAllowed('2026-09-30', '2026-09-30', '2026-10-14')).toThrow(/khoá đến ngày/);
    expect(() => assertPostingDateAllowed('2026-10-20', null, '2026-10-14')).toThrow(/tương lai/);
    expect(() => assertPostingDateAllowed('2026-10-01', '2026-09-30', '2026-10-14')).not.toThrow();
  });

  it('kiểm ngày theo lịch', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('14/10/2026')).toBe(false);
    expect(isValidDate(null)).toBe(false);
  });
});
