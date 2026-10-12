'use client';

import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { authFetch } from '@enterprise-platform/shared-ui';
import {
  Building2,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  PASSWORD_MAX_LENGTH,
  canSubmitPasswordChange,
  passwordRules,
  passwordStrength,
  type PasswordStrength,
} from './password-rules';

const ROLE_LABELS: Record<string, string> = {
  'tenant-admin': 'Quản trị doanh nghiệp',
  'tenant-user': 'Người dùng',
  'platform-admin': 'Quản trị nền tảng',
};

const STRENGTH: Record<Exclude<PasswordStrength, 'empty'>, { label: string; bars: number; color: string; text: string }> = {
  weak: { label: 'Yếu', bars: 1, color: 'bg-[#ef4444]', text: 'text-[#b91c1c]' },
  fair: { label: 'Trung bình', bars: 2, color: 'bg-[#f59e0b]', text: 'text-[#b45309]' },
  strong: { label: 'Mạnh', bars: 3, color: 'bg-[#10b981]', text: 'text-[#047857]' },
};

const EMPTY_DRAFT = { currentPassword: '', newPassword: '', confirmation: '' };

export function AccountWorkspace({ principal }: { principal: AuthenticatedPrincipal }) {
  const roleNames = principal.kind === 'tenant-user' ? principal.roleNames : undefined;
  const initials = principal.displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex flex-col gap-4 text-[14px] text-[#18181b]">
      <div>
        {principal.kind === 'platform-admin' ? (
          <PageBreadcrumb
            className="mb-1.5"
            items={[{ label: 'Platform', href: '/platform' }, { label: 'Tài khoản của tôi' }]}
          />
        ) : null}
        <h1 className="m-0 text-[22px] font-bold tracking-[-0.3px]">Tài khoản của tôi</h1>
        <p className="mt-1 text-[13.5px] text-slate-600">
          Xem thông tin tài khoản và tự đổi mật khẩu đăng nhập của bạn.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* Hồ sơ */}
        <section
          aria-label="Thông tin tài khoản"
          className="flex min-w-0 max-w-full flex-[1_1_300px] flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
        >
          <div className="relative flex flex-col items-center gap-2 overflow-hidden border-b border-[#ffc90a]/20 bg-gradient-to-br from-[#1c1c20] to-[#2a2a2f] px-5 pb-5 pt-[26px] text-center">
            <span
              aria-hidden="true"
              className="absolute -right-[70px] -top-[90px] size-[220px] rounded-full bg-[radial-gradient(circle,rgba(255,201,10,.18)_0%,transparent_70%)]"
            />
            <span className="relative">
              <span
                aria-hidden="true"
                className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-[#ffc90a] to-[#d9ab00] text-[26px] font-extrabold text-[#18181b] shadow-[0_0_0_4px_rgba(255,201,10,.18)]"
              >
                {initials || <UserRound className="size-8" />}
              </span>
              <span
                aria-label="Đang trực tuyến"
                className="absolute bottom-1 right-0.5 size-3.5 rounded-full border-[3px] border-[#232327] bg-[#10b981]"
              />
            </span>
            <b className="relative text-[17px] text-white">{principal.displayName}</b>
            <span className="relative break-all text-[13px] text-white/70">{principal.email}</span>
            <div className="relative flex flex-wrap justify-center gap-1.5">
              {(principal.roles.length ? principal.roles : [principal.kind]).map((role) => (
                <span
                  key={role}
                  className="rounded-full border border-[#ffc90a]/50 bg-[#ffc90a]/[.12] px-2.5 py-0.5 text-[12px] font-semibold text-[#ffd84d]"
                >
                  {ROLE_LABELS[role] ?? roleNames?.[role] ?? role}
                </span>
              ))}
            </div>
          </div>

          <dl className="m-0 flex flex-col py-2">
            <ProfileRow icon={<UserRound />} label="Họ và tên" value={principal.displayName} />
            <ProfileRow icon={<Mail />} label="Email đăng nhập" value={breakAfterAt(principal.email)} />
            {principal.kind === 'tenant-user' ? (
              <ProfileRow icon={<Building2 />} label="Doanh nghiệp" value={principal.tenantSlug.toUpperCase()} />
            ) : null}
            <ProfileRow
              icon={<ShieldCheck />}
              label="Loại tài khoản"
              value={principal.kind === 'platform-admin' ? 'Quản trị nền tảng' : 'Người dùng doanh nghiệp'}
            />
          </dl>

          <p className="mx-4 mb-4 mt-0 rounded-[10px] border border-[#f1f3f6] bg-[#fafbfc] px-3 py-2.5 text-[12.5px] text-slate-600">
            {principal.kind === 'platform-admin'
              ? 'Họ tên và email của tài khoản quản trị nền tảng được cấu hình khi khởi tạo hệ thống.'
              : 'Họ tên và email do quản trị viên doanh nghiệp quản lý. Liên hệ quản trị viên nếu cần thay đổi.'}
          </p>
        </section>

        {/* Bảo mật */}
        <section
          aria-labelledby="account-password-title"
          className="flex min-w-0 flex-[999_1_520px] flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
        >
          <div className="flex items-start gap-3 border-b border-[#eef0f3] bg-[#fafbfc] px-5 py-4">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#fff6d6] text-[#8a6400]"
            >
              <KeyRound className="size-4" />
            </span>
            <div>
              <h2 id="account-password-title" className="m-0 text-[16px] font-bold">
                Đổi mật khẩu
              </h2>
              <p className="mt-0.5 text-[12.5px] text-slate-500">
                Sau khi đổi, các phiên đăng nhập trên thiết bị khác sẽ bị đăng xuất. Phiên hiện tại được giữ lại.
              </p>
            </div>
          </div>
          <ChangePasswordForm />
        </section>
      </div>
    </div>
  );
}

/** Cho email xuống dòng ngay sau "@" thay vì cắt giữa tên miền khi cột hẹp. */
function breakAfterAt(email: string): ReactNode {
  const at = email.indexOf('@');
  if (at < 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

function ProfileRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-[#f1f3f6] px-5 py-2.5 first:border-t-0">
      <span className="shrink-0 text-slate-500 [&_svg]:size-4">{icon}</span>
      <dt className="shrink-0 basis-[120px] text-[12.5px] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function ChangePasswordForm() {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [currentInvalid, setCurrentInvalid] = useState(false);
  const [success, setSuccess] = useState<string>();

  const rules = passwordRules(draft);
  const strength = passwordStrength(draft.newPassword);
  const canSubmit = canSubmitPasswordChange(draft) && !busy;

  function update(field: keyof typeof EMPTY_DRAFT, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setError(undefined);
    setSuccess(undefined);
    if (field === 'currentPassword') setCurrentInvalid(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const response = await authFetch('/api/auth/v1/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: draft.currentPassword,
          newPassword: draft.newPassword,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string | string[];
        revokedSessions?: number;
      };
      if (!response.ok) {
        const message = Array.isArray(payload.message) ? payload.message[0] : payload.message;
        if (response.status === 401) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        if (message === 'Mật khẩu hiện tại không đúng.') setCurrentInvalid(true);
        throw new Error(message ?? `Không thể đổi mật khẩu (HTTP ${response.status}).`);
      }
      const revoked = payload.revokedSessions ?? 0;
      const detail =
        revoked > 0
          ? `Đã đăng xuất ${revoked} phiên đăng nhập trên thiết bị khác.`
          : 'Không có phiên đăng nhập nào khác cần đăng xuất.';
      setDraft(EMPTY_DRAFT);
      setSuccess(`Mật khẩu đã được cập nhật. ${detail}`);
      toast.success('Đổi mật khẩu thành công.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đổi mật khẩu. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-wrap items-start gap-5 p-5" onSubmit={submit} noValidate>
      <div className="flex min-w-0 max-w-[460px] flex-[1_1_300px] flex-col gap-3.5">
        <PasswordField
          label="Mật khẩu hiện tại"
          autoComplete="current-password"
          value={draft.currentPassword}
          invalid={currentInvalid}
          onChange={(value) => update('currentPassword', value)}
        />
        <PasswordField
          label="Mật khẩu mới"
          autoComplete="new-password"
          value={draft.newPassword}
          onChange={(value) => update('newPassword', value)}
        >
          {strength !== 'empty' ? (
            <span className="flex items-center gap-2" aria-live="polite">
              <span aria-hidden="true" className="grid flex-1 grid-cols-3 gap-1">
                {[1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    className={cn(
                      'h-[5px] rounded-full',
                      bar <= STRENGTH[strength].bars ? STRENGTH[strength].color : 'bg-[#e5e7eb]',
                    )}
                  />
                ))}
              </span>
              <span className={cn('min-w-16 text-right text-[12px] font-semibold', STRENGTH[strength].text)}>
                {STRENGTH[strength].label}
              </span>
            </span>
          ) : null}
        </PasswordField>
        <PasswordField
          label="Xác nhận mật khẩu mới"
          autoComplete="new-password"
          value={draft.confirmation}
          invalid={draft.confirmation.length > 0 && draft.confirmation !== draft.newPassword}
          onChange={(value) => update('confirmation', value)}
        />

        {error ? (
          <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p
            className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-800"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap gap-2">
          <button
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-[#18181b] px-4 text-[13px] font-semibold text-white hover:bg-[#2a2a2f] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canSubmit}
            type="submit"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
            {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
          </button>
          <button
            className="h-10 cursor-pointer rounded-lg border border-[#eef0f3] bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-[#fafbfc] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy || (!draft.currentPassword && !draft.newPassword && !draft.confirmation)}
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setError(undefined);
              setCurrentInvalid(false);
            }}
            type="button"
          >
            Nhập lại
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 rounded-xl border border-[#f1f3f6] bg-[#fafbfc] px-4 py-3.5">
        <p className="m-0 flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.6px] text-slate-500">
          <span aria-hidden="true" className="h-3.5 w-[3px] rounded-sm bg-[#ffc90a]" />
          Yêu cầu mật khẩu
        </p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={cn('flex items-center gap-2 text-[13px]', rule.passed ? 'text-[#18181b]' : 'text-slate-600')}
            >
              {rule.passed ? (
                <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-[#059669]" />
              ) : (
                <Circle aria-hidden="true" className="size-4 shrink-0 text-[#d1d5db]" />
              )}
              <span className="min-w-0 flex-1">{rule.label}</span>
              {rule.required ? null : (
                <span className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.4px] text-[#9ca3af]">
                  Khuyến nghị
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-1 border-t border-[#eef0f3] pt-2.5 text-[12px] text-slate-500">
          Không dùng lại mật khẩu của dịch vụ khác. Nên dùng cụm từ dài, dễ nhớ với bạn nhưng khó đoán với người khác.
        </p>
      </div>
    </form>
  );
}

function PasswordField({
  label,
  autoComplete,
  value,
  invalid,
  onChange,
  children,
}: {
  label: string;
  autoComplete: 'current-password' | 'new-password';
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-[5px]">
      <label className="text-[13px] font-semibold text-slate-700" htmlFor={id}>
        {label}
      </label>
      <span
        className={cn(
          'flex h-10 items-center overflow-hidden rounded-lg border bg-white focus-within:ring-2',
          invalid
            ? 'border-[#fca5a5] focus-within:ring-red-100'
            : 'border-[#e5e7eb] focus-within:border-[#ffc90a] focus-within:ring-[#ffc90a]/25',
        )}
      >
        <input
          id={id}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete}
          className="h-[38px] min-w-0 flex-1 border-0 bg-transparent px-3 text-[14px] text-[#18181b] outline-none [&::-ms-reveal]:hidden"
          maxLength={PASSWORD_MAX_LENGTH}
          onChange={(event) => onChange(event.currentTarget.value)}
          type={visible ? 'text' : 'password'}
          value={value}
        />
        <button
          type="button"
          className="grid h-[38px] w-10 shrink-0 cursor-pointer place-items-center text-slate-500 transition-colors hover:text-[#18181b]"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
      {children}
    </div>
  );
}
