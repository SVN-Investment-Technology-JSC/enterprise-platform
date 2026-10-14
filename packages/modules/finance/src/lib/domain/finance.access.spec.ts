import { approvableKinds, can, canReadAll, canSeeBalances, creatableKinds, hasAnyFinanceAccess, type FinanceActor } from './finance.access.js';

const actor = (permissions: string[]): FinanceActor => ({ tenantId: 't', userId: 'u', displayName: 'U', permissions });

describe('quyền Tài chính', () => {
  it('finance.manage bao hàm mọi quyền con; tenant.manage có tất cả', () => {
    const manager = actor(['finance.manage']);
    expect(can(manager, 'finance.payment.approve')).toBe(true);
    expect(can(manager, 'finance.settings.manage')).toBe(true);
    expect(approvableKinds(manager)).toEqual(['RECEIPT', 'PAYMENT', 'TRANSFER']);
    expect(can(actor(['tenant.manage']), 'finance.settings.manage')).toBe(true);
  });

  it('người chỉ lập phiếu thu: không duyệt, không xem số dư, không xem phiếu của người khác', () => {
    const creator = actor(['finance.receipt.create']);
    expect(creatableKinds(creator)).toEqual(['RECEIPT']);
    expect(approvableKinds(creator)).toEqual([]);
    expect(canSeeBalances(creator)).toBe(false);
    expect(canReadAll(creator)).toBe(false);
    expect(hasAnyFinanceAccess(creator)).toBe(true);
  });

  it('người duyệt phiếu chi thấy số dư; người không có quyền Tài chính không vào được', () => {
    expect(canSeeBalances(actor(['finance.payment.approve']))).toBe(true);
    expect(canSeeBalances(actor(['finance.report.read']))).toBe(true);
    expect(hasAnyFinanceAccess(actor(['hrm.read', 'inventory.read']))).toBe(false);
  });
});
