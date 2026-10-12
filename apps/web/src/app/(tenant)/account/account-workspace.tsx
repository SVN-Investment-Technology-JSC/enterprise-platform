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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  weak: { label: 'Yếu', bars: 1, color: 'bg-red-500', text: 'text-red-600' },
  fair: { label: 'Trung bình', bars: 2, color: 'bg-amber-500', text: 'text-amber-600' },
  strong: { label: 'Mạnh', bars: 3, color: 'bg-emerald-500', text: 'text-emerald-600' },
};

const EMPTY_DRAFT = { currentPassword: '', newPassword: '', confirmation: '' };

export function AccountWorkspace({ principal }: { principal: AuthenticatedPrincipal }) {
  const initials = principal.displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden p-4 sm:p-6">
      <div className="mb-4 shrink-0">
        <PageBreadcrumb
          className="mb-1.5"
          items={[
            { label: principal.kind === 'platform-admin' ? 'Platform' : 'Tenant Portal', href: principal.kind === 'platform-admin' ? '/platform' : '/dashboard' },
            { label: 'Tài khoản của tôi' },
          ]}
        />
        <h1 className="text-2xl font-bold tracking-tight text-[#0d1c2d] sm:text-3xl">Tài khoản của tôi</h1>
        <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
          Xem thông tin tài khoản và tự đổi mật khẩu đăng nhập của bạn.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        {/* Master: hồ sơ */}
        <aside className="min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col items-center border-b border-slate-100 px-6 pb-6 pt-8 text-center">
            <div className="relative">
              <div className="grid size-20 place-items-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-2xl font-bold tracking-wider text-white ring-4 ring-blue-50">
                {initials || <UserRound className="size-8" />}
              </div>
              <span className="absolute bottom-1 right-1 size-4 rounded-full bg-emerald-500 ring-[3px] ring-white" />
            </div>
            <p className="mt-4 text-lg font-bold text-slate-900">{principal.displayName}</p>
            <p className="text-sm text-slate-500">{principal.email}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {(principal.roles.length ? principal.roles : [principal.kind]).map((role) => (
                <span
                  key={role}
                  className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700"
                >
                  {ROLE_LABELS[role] ?? role}
                </span>
              ))}
            </div>
          </div>

          <dl className="divide-y divide-slate-100 px-6 py-2 text-sm">
            <ProfileRow icon={<UserRound />} label="Họ và tên" value={principal.displayName} />
            <ProfileRow icon={<Mail />} label="Email đăng nhập" value={principal.email} />
            {principal.kind === 'tenant-user' ? (
              <ProfileRow icon={<Building2 />} label="Doanh nghiệp" value={principal.tenantSlug.toUpperCase()} />
            ) : null}
            <ProfileRow
              icon={<ShieldCheck />}
              label="Loại tài khoản"
              value={principal.kind === 'platform-admin' ? 'Quản trị nền tảng' : 'Người dùng doanh nghiệp'}
            />
          </dl>

          <p className="mx-6 mb-6 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            {principal.kind === 'platform-admin'
              ? 'Họ tên và email của tài khoản quản trị nền tảng được cấu hình khi khởi tạo hệ thống.'
              : 'Họ tên và email do quản trị viên doanh nghiệp quản lý. Liên hệ quản trị viên nếu cần thay đổi.'}
          </p>
        </aside>

        {/* Detail: bảo mật */}
        <section className="min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
              <KeyRound className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Đổi mật khẩu</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Sau khi đổi, các phiên đăng nhập trên thiết bị khác sẽ bị đăng xuất. Phiên hiện tại được giữ lại.
              </p>
            </div>
          </div>
          <ChangePasswordForm />
        </section>
      </div>
    </main>
  );
}

function ProfileRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-slate-400 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="truncate font-medium text-slate-800">{value}</dd>
      </div>
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
    <form className="grid gap-6 px-6 py-6 2xl:grid-cols-[minmax(0,460px)_minmax(280px,1fr)]" onSubmit={submit} noValidate>
      <div className="max-w-xl space-y-4">
        <PasswordField
          label="Mật khẩu hiện tại"
          autoComplete="current-password"
          value={draft.currentPassword}
          invalid={currentInvalid}
          onChange={(value) => update('currentPassword', value)}
        />
        <div className="space-y-2">
          <PasswordField
            label="Mật khẩu mới"
            autoComplete="new-password"
            value={draft.newPassword}
            onChange={(value) => update('newPassword', value)}
          />
          {strength !== 'empty' ? (
            <div className="flex items-center gap-3" aria-live="polite">
              <div className="grid flex-1 grid-cols-3 gap-1">
                {[1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    className={cn(
                      'h-1.5 rounded-full',
                      bar <= STRENGTH[strength].bars ? STRENGTH[strength].color : 'bg-slate-200',
                    )}
                  />
                ))}
              </div>
              <span className={cn('w-20 text-right text-xs font-semibold', STRENGTH[strength].text)}>
                {STRENGTH[strength].label}
              </span>
            </div>
          ) : null}
        </div>
        <PasswordField
          label="Xác nhận mật khẩu mới"
          autoComplete="new-password"
          value={draft.confirmation}
          invalid={draft.confirmation.length > 0 && draft.confirmation !== draft.newPassword}
          onChange={(value) => update('confirmation', value)}
        />

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
            {success}
          </p>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Button className="bg-[#091426] px-4 hover:bg-[#1e293b]" disabled={!canSubmit} type="submit">
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
          </Button>
          <Button
            disabled={busy || (!draft.currentPassword && !draft.newPassword && !draft.confirmation)}
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setError(undefined);
              setCurrentInvalid(false);
            }}
            type="button"
            variant="outline"
          >
            Nhập lại
          </Button>
        </div>
      </div>

      <div className="h-fit max-w-xl rounded-xl border border-slate-200 bg-slate-50/70 p-4 2xl:max-w-none">
        <p className="text-sm font-semibold text-slate-800">Yêu cầu mật khẩu</p>
        <ul className="mt-3 space-y-2 text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-2">
              {rule.passed ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="size-4 shrink-0 text-slate-300" />
              )}
              <span className={cn('min-w-0 flex-1', rule.passed ? 'text-slate-800' : 'text-slate-500')}>{rule.label}</span>
              {rule.required ? null : (
                <span className="shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Khuyến nghị
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
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
}: {
  label: string;
  autoComplete: 'current-password' | 'new-password';
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-slate-700" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete}
          className="h-9 pr-10"
          maxLength={PASSWORD_MAX_LENGTH}
          onChange={(event) => onChange(event.currentTarget.value)}
          type={visible ? 'text' : 'password'}
          value={value}
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}
