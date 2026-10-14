import { tenantActionHeld } from '@enterprise-platform/contracts-identity';
import {
  FINANCE_KIND_PERMISSIONS,
  FINANCE_VOUCHER_KINDS,
  type FinanceVoucherKind,
} from '@enterprise-platform/contracts-finance';

/** Người gọi API Tài chính, dựng từ access-decision của Platform. */
export interface FinanceActor {
  tenantId: string;
  userId: string;
  displayName: string;
  /** Mọi action đang giữ (đã gồm action được bao hàm bởi finance.manage khi Platform mở rộng). */
  permissions: readonly string[];
}

/** Quản trị tenant (`tenant.manage`) có mọi quyền Tài chính, giống cách HRM xử lý. */
export function can(actor: FinanceActor, action: string): boolean {
  return actor.permissions.includes('tenant.manage') || tenantActionHeld(actor.permissions, action);
}

export const canCreate = (actor: FinanceActor, kind: FinanceVoucherKind) =>
  can(actor, FINANCE_KIND_PERMISSIONS[kind].create);
export const canApprove = (actor: FinanceActor, kind: FinanceVoucherKind) =>
  can(actor, FINANCE_KIND_PERMISSIONS[kind].approve);

export const approvableKinds = (actor: FinanceActor): FinanceVoucherKind[] =>
  FINANCE_VOUCHER_KINDS.filter((kind) => canApprove(actor, kind));
export const creatableKinds = (actor: FinanceActor): FinanceVoucherKind[] =>
  FINANCE_VOUCHER_KINDS.filter((kind) => canCreate(actor, kind));

/** Xem được toàn bộ phiếu (không chỉ phiếu của mình). */
export const canReadAll = (actor: FinanceActor) => can(actor, 'finance.read');

/**
 * Xem số dư, sổ cái và tổng hợp tài khoản: phải có quyền đọc, quản lý tài khoản, xem báo cáo hoặc duyệt.
 * Người chỉ có quyền lập phiếu chỉ được chọn tài khoản (mã, tên), không xem số dư công ty.
 */
export function canSeeBalances(actor: FinanceActor): boolean {
  return (
    canReadAll(actor) ||
    can(actor, 'finance.account.manage') ||
    can(actor, 'finance.report.read') ||
    approvableKinds(actor).length > 0
  );
}

/** Có ít nhất một quyền Tài chính (điều kiện tối thiểu để dùng API). */
export function hasAnyFinanceAccess(actor: FinanceActor): boolean {
  return (
    can(actor, 'finance.read') ||
    creatableKinds(actor).length > 0 ||
    approvableKinds(actor).length > 0 ||
    can(actor, 'finance.account.manage') ||
    can(actor, 'finance.report.read') ||
    can(actor, 'finance.settings.manage')
  );
}
