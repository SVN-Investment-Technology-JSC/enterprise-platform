import type { FinanceCapabilities } from '@enterprise-platform/contracts-finance';
import { canOpenKind, canOpenPage, canSeeBalances } from './finance-permissions';
import { financeNavigation } from './finance-navigation';

const caps = (over: Partial<FinanceCapabilities> = {}): FinanceCapabilities => ({
  canManage: false,
  canReadAll: false,
  receipt: { create: false, approve: false },
  payment: { create: false, approve: false },
  transfer: { create: false, approve: false },
  canManageAccounts: false,
  canReadReports: false,
  canManageSettings: false,
  procedureAvailable: false,
  ...over,
});

const visible = (c: FinanceCapabilities | null) => financeNavigation.filter((item) => canOpenPage(c, item.href)).map((item) => item.id);

describe('quyền hiện từng trang', () => {
  it('chưa tải quyền thì không trang nào mở được', () => {
    expect(visible(null)).toEqual([]);
  });

  it('người chỉ lập phiếu thu: thấy Dashboard và Phiếu thu, không thấy số dư/báo cáo/tuỳ chỉnh', () => {
    const c = caps({ receipt: { create: true, approve: false } });
    expect(visible(c)).toEqual(['dashboard', 'receipts']);
    expect(canSeeBalances(c)).toBe(false);
  });

  it('người duyệt phiếu chi: thấy Phiếu chi và Tài khoản (xem số dư để duyệt)', () => {
    const c = caps({ payment: { create: false, approve: true } });
    expect(visible(c)).toEqual(['dashboard', 'payments', 'accounts']);
    expect(canSeeBalances(c)).toBe(true);
  });

  it('kế toán xem toàn bộ: thấy mọi loại phiếu, tài khoản, báo cáo; Tuỳ chỉnh chỉ khi được cấu hình', () => {
    const reader = caps({ canReadAll: true, canReadReports: true });
    expect(visible(reader)).toEqual(['dashboard', 'receipts', 'payments', 'transfers', 'accounts', 'reports']);
    expect(visible(caps({ canReadAll: true, canManageSettings: true }))).toContain('settings');
    expect(canOpenKind(reader, 'TRANSFER')).toBe(true);
  });

  it('menu có đủ bảy mục theo thiết kế, đúng thứ tự', () => {
    expect(financeNavigation.map((item) => item.label)).toEqual(['Dashboard', 'Phiếu thu', 'Phiếu chi', 'Chuyển tiền', 'Tài khoản', 'Báo cáo', 'Tùy chỉnh']);
  });
});
