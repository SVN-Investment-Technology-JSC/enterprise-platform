'use client';

import type { LoginPortal, LoginResponse } from '@enterprise-platform/contracts-identity';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import styles from './login-form.module.scss';

interface LoginFormProps {
  portal: LoginPortal;
  eyebrow: string;
  title: string;
  description: string;
}

interface AccountOption {
  value: string;
  label: string;
  defaultPassword?: string;
}

const DEFAULT_SEED_PASSWORD = 'replace-with-a-local-secret';

const TENANT_ACCOUNTS: AccountOption[] = [
  { value: 'admin@minhlong.local', label: 'Minh Long Admin (Full Modules · Năng lượng)', defaultPassword: DEFAULT_SEED_PASSWORD },
  { value: 'admin@dakrosa.local', label: 'DakRoSa Admin (Procedure Engine)', defaultPassword: DEFAULT_SEED_PASSWORD },
  { value: 'admin@anphat.local', label: 'An Phát Admin (CRM)', defaultPassword: DEFAULT_SEED_PASSWORD },
  { value: 'custom', label: '-- Nhập tài khoản khác --' },
];

const PLATFORM_ACCOUNTS: AccountOption[] = [
  { value: 'superadmin@platform.local', label: 'Superadmin Platform (Platform Core)', defaultPassword: DEFAULT_SEED_PASSWORD },
  { value: 'custom', label: '-- Nhập tài khoản khác --' },
];

export function LoginForm({ portal, eyebrow, title, description }: LoginFormProps) {
  const router = useRouter();
  const platform = portal === 'platform';
  const accounts = platform ? PLATFORM_ACCOUNTS : TENANT_ACCOUNTS;

  const [selectedAccount, setSelectedAccount] = useState<string>(accounts[0]?.value ?? 'custom');
  const [email, setEmail] = useState(accounts[0]?.value !== 'custom' ? accounts[0]?.value ?? '' : '');
  const [password, setPassword] = useState(accounts[0]?.defaultPassword ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function handleAccountChange(val: string) {
    setSelectedAccount(val);
    if (val === 'custom') {
      setEmail('');
      setPassword('');
    } else {
      const acc = accounts.find((a) => a.value === val);
      setEmail(acc?.value ?? '');
      setPassword(acc?.defaultPassword ?? DEFAULT_SEED_PASSWORD);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/v1/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, portal }),
      });
      const payload = await response.json() as LoginResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? 'Đăng nhập không thành công.');
      router.replace(payload.redirectTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Đăng nhập không thành công.');
    } finally {
      setBusy(false);
    }
  }

  const isCustom = selectedAccount === 'custom';

  return (
    <main className={`${styles.page} ${platform ? styles.platform : styles.tenant}`}>
      <section className={styles.context}>
        <Link href="/">← Chọn cổng khác</Link>
        <div>
          <span>{platform ? 'Platform Core' : 'Tenant Portal'}</span>
          <h1>{platform ? 'Quản trị nền tảng.' : 'Không gian doanh nghiệp.'}</h1>
          <p>
            {platform
              ? 'Khu vực dành riêng cho superadmin vận hành tenant, module và entitlement.'
              : 'Platform Core sẽ xác định tenant, quyền truy cập và dedicated database sau khi đăng nhập.'}
          </p>
        </div>
      </section>

      <section className={styles.login}>
        <form onSubmit={submit}>
          <div>
            <small>{eyebrow}</small>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>

          <label>
            Chọn tài khoản có sẵn
            <select
              value={selectedAccount}
              onChange={(e) => handleAccountChange(e.target.value)}
            >
              {accounts.map((acc) => (
                <option key={acc.value} value={acc.value}>
                  {acc.label}
                </option>
              ))}
            </select>
          </label>

          {isCustom ? (
            <>
              <label>
                Email
                <input
                  autoComplete="username"
                  autoFocus
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  required
                  type="email"
                  value={email}
                  placeholder="name@example.com"
                />
              </label>
              <label>
                Mật khẩu
                <input
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  required
                  type="password"
                  value={password}
                  placeholder="Nhập mật khẩu"
                />
              </label>
            </>
          ) : (
            <div style={{ fontSize: '0.78rem', color: '#52667a', background: '#f0f5fa', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', lineHeight: 1.4 }}>
              <strong>Tài khoản:</strong> {email} <br />
              <strong>Mật khẩu:</strong> <code>••••••••••••</code> (Tự động điền)
            </div>
          )}

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button disabled={busy} type="submit">
            {busy ? 'Đang xác minh…' : platform ? 'Đăng nhập Platform Core' : 'Đăng nhập Tenant Portal'}
          </button>
          <footer>
            {platform ? 'Chỉ tài khoản platform-admin được chấp nhận.' : 'Chỉ tài khoản thuộc tenant đang hoạt động được chấp nhận.'}
          </footer>
        </form>
      </section>
    </main>
  );
}
