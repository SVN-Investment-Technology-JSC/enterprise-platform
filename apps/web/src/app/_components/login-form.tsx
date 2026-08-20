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

export function LoginForm({ portal, eyebrow, title, description }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

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

  const platform = portal === 'platform';
  return (
    <main className={`${styles.page} ${platform ? styles.platform : styles.tenant}`}>
      <section className={styles.context}>
        <Link href="/">← Chọn cổng khác</Link>
        <div>
          <span>{platform ? 'Quản trị hệ thống' : 'Doanh nghiệp'}</span>
          <h1>{platform ? 'Quản trị hệ thống.' : 'Không gian làm việc.'}</h1>
          <p>
            {platform
              ? 'Dành riêng cho người vận hành hệ thống: tạo doanh nghiệp, cấp phân hệ. Không truy cập được dữ liệu của doanh nghiệp.'
              : 'Quy trình, bảo trì và kho vật tư của doanh nghiệp bạn, trong cùng một nơi.'}
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
            Email
            <input autoComplete="username" autoFocus onChange={(event) => setEmail(event.currentTarget.value)} required type="email" value={email} />
          </label>
          <label>
            Mật khẩu
            <input autoComplete="current-password" onChange={(event) => setPassword(event.currentTarget.value)} required type="password" value={password} />
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button disabled={busy} type="submit">
            {busy ? 'Đang xác minh…' : 'Đăng nhập'}
          </button>
          <footer>
            {platform
              ? 'Chỉ dành cho người quản trị hệ thống. Nhân sự doanh nghiệp đăng nhập ở cổng doanh nghiệp.'
              : 'Tài khoản do doanh nghiệp của bạn cấp. Nếu chưa có, liên hệ người quản trị nội bộ.'}
          </footer>
        </form>
      </section>
    </main>
  );
}
