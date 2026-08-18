'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function TenantResetPasswordForm({ tenantSlug }: { tenantSlug: string }) {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (password.length < 12) return setError('Mật khẩu mới cần có ít nhất 12 ký tự.');
    if (password !== confirmation) return setError('Xác nhận mật khẩu chưa khớp.');
    setBusy(true);
    try {
      const response = await fetch('/api/auth/v1/tenant-password-reset', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug, token: searchParams.get('token') ?? '', password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message ?? 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
      }
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 shadow-sm">
        <CardHeader>
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{tenantSlug}</p>
          <CardTitle>Đặt lại mật khẩu</CardTitle>
          <CardDescription>Đặt mật khẩu mới cho tài khoản quản trị viên doanh nghiệp.</CardDescription>
        </CardHeader>
        <CardContent>
          {complete ? (
            <div className="space-y-4">
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Mật khẩu đã được cập nhật. Các phiên đăng nhập trước đó đã được đăng xuất.</p>
              <Button className="w-full bg-[#091426] hover:bg-[#1e293b]" render={<Link href={`/t/${tenantSlug}/login`} />}>Đến trang đăng nhập</Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">Mật khẩu mới<Input autoComplete="new-password" minLength={12} onChange={(event) => setPassword(event.currentTarget.value)} required type="password" value={password} /></label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">Xác nhận mật khẩu<Input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmation(event.currentTarget.value)} required type="password" value={confirmation} /></label>
              {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
              <Button className="w-full bg-[#091426] hover:bg-[#1e293b]" disabled={busy} type="submit">{busy ? 'Đang cập nhật…' : 'Đặt lại mật khẩu'}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
