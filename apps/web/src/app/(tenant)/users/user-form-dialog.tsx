'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useCreateUserMutation } from '@/store/tenant-api';
import { buildTenantEmail, sanitizeTenantEmailLocal } from './tenant-user-email';

const FIELD =
  'h-9 w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 text-[14px] text-[#18181b] outline-none focus:border-[#ffc90a]';
const BUTTON_BASE =
  'h-9 cursor-pointer rounded-md px-3.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';

interface FormState {
  fullName: string;
  email: string;
  password: string;
}

const EMPTY: FormState = { fullName: '', email: '', password: '' };

/** Hộp thoại thêm người dùng; tạo xong chuyển sang trang chi tiết để gán vai trò và quyền. */
export function UserFormDialog({
  open,
  onOpenChange,
  tenantSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [createUser, { isLoading }] = useCreateUserMutation();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState('');

  function handleOpenChange(next: boolean) {
    if (isLoading) return;
    if (!next) {
      setForm(EMPTY);
      setError('');
    }
    onOpenChange(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    setError('');
    try {
      const user = await createUser({
        fullName: form.fullName,
        email: buildTenantEmail(form.email, tenantSlug),
        password: form.password,
      }).unwrap();
      toast.success(`Đã tạo người dùng ${user.fullName}.`);
      setForm(EMPTY);
      onOpenChange(false);
      router.push(`/users/${user.id}`);
    } catch (cause) {
      setError(
        (cause as { message?: string } | undefined)?.message ??
          'Không thể tạo người dùng.',
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-[10px] p-6">
        <DialogHeader>
          <DialogTitle>Thêm người dùng</DialogTitle>
          <DialogDescription>
            Tài khoản mới chưa có quyền. Gán vai trò ở trang chi tiết sau khi
            tạo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-4">
          <fieldset disabled={isLoading} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-semibold text-slate-700">
                Họ và tên
              </span>
              <input
                required
                maxLength={180}
                className={FIELD}
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-semibold text-slate-700">
                Email
              </span>
              <span className="flex items-center overflow-hidden rounded-md border border-[#e5e7eb] focus-within:border-[#ffc90a]">
                <input
                  required
                  autoComplete="username"
                  className="h-9 min-w-0 flex-1 px-2.5 text-[14px] outline-none"
                  value={form.email}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      email: sanitizeTenantEmailLocal(e.target.value),
                    })
                  }
                />
                <span className="flex h-9 items-center border-l border-[#e5e7eb] bg-[#f6f7f9] px-2.5 text-slate-500">
                  @{tenantSlug}.com
                </span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-semibold text-slate-700">
                Mật khẩu
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                maxLength={128}
                className={FIELD}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <span className="text-[12px] text-[#64748b]">
                Từ 6 đến 128 ký tự.
              </span>
            </label>
            {error && (
              <p role="alert" className="m-0 text-[14px] text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 border-t border-[#e5e7eb] pt-4">
              <button
                type="button"
                className={`${BUTTON_BASE} border border-[#d1d5db] bg-transparent text-[#4b5563] hover:bg-[#f1f5f9]`}
                onClick={() => handleOpenChange(false)}
              >
                Hủy
              </button>
              <button
                type="submit"
                className={`${BUTTON_BASE} bg-[#ffc90a] font-bold text-[#18181b] hover:bg-[#ffd84d]`}
              >
                {isLoading ? 'Đang tạo…' : 'Tạo người dùng'}
              </button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
