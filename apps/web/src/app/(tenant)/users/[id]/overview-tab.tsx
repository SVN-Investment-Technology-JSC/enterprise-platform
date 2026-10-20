'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from '@/components/ui/sonner';
import { useUpdateUserMutation } from '@/store/tenant-api';
import { errorMessage } from '../../authorization/user-permission-grants-dialog';
import {
  buildTenantEmail,
  sanitizeTenantEmailLocal,
} from '../tenant-user-email';
import type { TenantCoreUser } from '../user-types';
import { StatusBadge, UserCard } from '../user-ui';
import { EmployeeProfileContent } from '../employee-profile-panel';
import { formatDateTime } from './history-model';

const FIELD =
  'h-9 w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 text-[14px] text-[#18181b] outline-none focus:border-[#ffc90a] read-only:bg-[#f6f7f9] read-only:text-slate-600';
const LABEL = 'text-[13px] font-semibold text-slate-700';
const BTN =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-md px-3.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY = `${BTN} bg-[#ffc90a] font-bold text-[#18181b] hover:bg-[#ffd84d]`;
const BTN_SECONDARY = `${BTN} border border-[#e5e7eb] bg-white text-slate-700 hover:bg-[#f4f6f9]`;
const TITLE = 'm-0 text-[15px] font-bold text-[#18181b]';

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;

/** Tab "Tổng quan": thông tin tài khoản sửa tại chỗ, đặt lại mật khẩu và thông tin phụ. */
export function OverviewTab({
  user,
  tenantSlug,
  canEdit,
  canReadOrganization,
}: {
  readonly user: TenantCoreUser;
  readonly tenantSlug: string;
  readonly canEdit: boolean;
  readonly canReadOrganization: boolean;
}) {
  const [updateUser, { isLoading: saving }] = useUpdateUserMutation();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const savedLocal = sanitizeTenantEmailLocal(user.email);
  // Bản nháp chỉ chứa trường người dùng đã gõ; trường chưa đụng tới luôn theo dữ liệu mới nhất.
  const [draft, setDraft] = useState<{ fullName?: string; email?: string }>({});
  const [password, setPassword] = useState('');
  const fullName = draft.fullName ?? user.fullName;
  const emailLocal = draft.email ?? savedLocal;
  const nameChanged = fullName.trim() !== user.fullName;
  const emailChanged = emailLocal !== savedLocal;
  const dirty = nameChanged || emailChanged;
  const valid = fullName.trim().length > 0 && emailLocal.length > 0;
  const passwordValid =
    password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!dirty || !valid || saving) return;
    try {
      await updateUser({
        id: user.id,
        patch: {
          ...(nameChanged ? { fullName: fullName.trim() } : {}),
          ...(emailChanged
            ? { email: buildTenantEmail(emailLocal, tenantSlug) }
            : {}),
        },
      }).unwrap();
      setDraft({});
      toast.success(`Đã cập nhật thông tin của "${fullName.trim()}".`);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thể lưu người dùng.'));
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    if (!passwordValid || saving) return;
    try {
      await updateUser({ id: user.id, patch: { password } }).unwrap();
      setPassword('');
      toast.success('Đã đặt lại mật khẩu.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thể đặt lại mật khẩu.'));
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <UserCard aria-label="Thông tin tài khoản" className="p-4 sm:p-5">
          <h2 className={`${TITLE} mb-3.5`}>Thông tin tài khoản</h2>
          <form onSubmit={saveProfile} className="flex flex-col gap-3.5">
            <fieldset
              disabled={saving}
              className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor={nameId} className={LABEL}>
                  Họ và tên
                </label>
                <input
                  id={nameId}
                  required
                  maxLength={180}
                  readOnly={!canEdit}
                  className={FIELD}
                  value={fullName}
                  onChange={(e) =>
                    setDraft({ ...draft, fullName: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={emailId} className={LABEL}>
                  Email
                </label>
                <span className="flex items-center overflow-hidden rounded-md border border-[#e5e7eb] focus-within:border-[#ffc90a]">
                  <input
                    id={emailId}
                    required
                    autoComplete="username"
                    readOnly={!canEdit}
                    className="h-9 min-w-0 flex-1 bg-white px-2.5 text-[14px] outline-none read-only:bg-[#f6f7f9] read-only:text-slate-600"
                    value={emailLocal}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        email: sanitizeTenantEmailLocal(e.target.value),
                      })
                    }
                  />
                  <span className="flex h-9 shrink-0 items-center border-l border-[#e5e7eb] bg-[#f6f7f9] px-2.5 text-[14px] text-slate-500">
                    @{tenantSlug}.com
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className={LABEL}>Trạng thái</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={user.status} />
                  {canEdit ? (
                    <span className="text-[12px] text-slate-500">
                      Đổi trạng thái bằng nút ở đầu trang.
                    </span>
                  ) : null}
                </span>
              </div>
            </fieldset>
            {canEdit ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eef0f3] pt-3.5">
                <button
                  type="button"
                  aria-label="Hủy thay đổi thông tin"
                  className={BTN_SECONDARY}
                  disabled={!dirty || saving}
                  onClick={() => setDraft({})}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  aria-label="Lưu thông tin người dùng"
                  className={BTN_PRIMARY}
                  disabled={!dirty || !valid || saving}
                >
                  {saving ? 'Đang lưu…' : 'Lưu'}
                </button>
              </div>
            ) : (
              <p className="m-0 text-[12px] text-slate-500">
                Bạn không có quyền sửa thông tin của tài khoản này.
              </p>
            )}
          </form>
        </UserCard>

        {canReadOrganization ? <EmployeeProfileContent user={user} /> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <UserCard aria-label="Thông tin phụ" className="p-4 sm:p-5">
          <h2 className={`${TITLE} mb-3.5`}>Thông tin phụ</h2>
          <dl className="m-0 flex flex-col gap-3 text-[13px]">
            <Row label="Mã người dùng">
              <span className="break-all font-mono text-[12px]">{user.id}</span>
            </Row>
            {user.username ? (
              <Row label="Tên đăng nhập">{user.username}</Row>
            ) : null}
            <Row label="Loại tài khoản">
              {user.systemRole === 'tenant-admin'
                ? 'Quản trị viên tenant'
                : 'Người dùng'}
            </Row>
            <Row label="Ngày tạo">{formatDateTime(user.createdAt)}</Row>
            <Row label="Cập nhật gần nhất">
              {formatDateTime(user.updatedAt)}
            </Row>
          </dl>
        </UserCard>
        {canEdit ? (
          <UserCard aria-label="Đặt lại mật khẩu" className="p-4 sm:p-5">
            <h2 className={`${TITLE} mb-1`}>Đặt lại mật khẩu</h2>
            <p className="m-0 mb-3.5 text-[13px] text-slate-500">
              Mật khẩu mới có hiệu lực ngay. Để trống nếu không muốn đổi.
            </p>
            <form onSubmit={resetPassword} className="flex flex-col gap-1">
              <label htmlFor={passwordId} className={LABEL}>
                Mật khẩu mới
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={passwordId}
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  maxLength={MAX_PASSWORD}
                  className={`${FIELD} min-w-0 flex-[1_1_220px]`}
                  value={password}
                  disabled={saving}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="submit"
                  aria-label="Đặt lại mật khẩu"
                  className={BTN_PRIMARY}
                  disabled={!passwordValid || saving}
                >
                  Đặt lại
                </button>
              </div>
              <span className="text-[12px] text-slate-500">
                Từ {MIN_PASSWORD} đến {MAX_PASSWORD} ký tự.
              </span>
            </form>
          </UserCard>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[#f1f3f6] pb-3 last:border-b-0 last:pb-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="m-0 font-medium text-[#18181b]">{children}</dd>
    </div>
  );
}
