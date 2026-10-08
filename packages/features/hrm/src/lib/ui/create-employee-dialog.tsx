'use client';

import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Input } from './input';
import { DatePickerInput } from './date-picker-input';
import { AlertCircle, Loader2, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog';

export function CreateEmployeeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<
    { id: string; fullName: string; email: string }[]
  >([]);
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('OFFICIAL');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    setUserId('');
    hrmFetch<{ data: typeof accounts }>('/employees/accounts')
      .then((result) => {
        if (active) setAccounts(result.data);
      })
      .catch((err) => {
        if (active)
          setError(
            err instanceof Error ? err.message : 'Không tải được tài khoản',
          );
      });
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white shadow-2xl rounded-xl">
        <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80 flex flex-row items-start gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 border border-blue-100">
            <UserPlus className="size-5" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-base font-bold text-slate-900">
              Thêm hồ sơ nhân viên
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed">
              Khai báo thông tin cơ bản để tạo hồ sơ; có thể liên kết tài khoản
              đăng nhập ngay hoặc bổ sung sau.
            </DialogDescription>
          </div>
        </DialogHeader>
        <form
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            const form = new FormData(event.currentTarget);
            setSaving(true);
            setError('');
            try {
              await hrmFetch('/employees', {
                method: 'POST',
                body: JSON.stringify({
                  employeeCode: form.get('employeeCode'),
                  fullName: form.get('fullName'),
                  joinDate: form.get('joinDate'),
                  workEmail: form.get('workEmail'),
                  userId: userId || null,
                  employmentStatus: status,
                }),
              });
              await onCreated();
              onClose();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'Không lưu được hồ sơ',
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 block text-xs">
                Mã nhân viên <span className="text-rose-500">*</span>
              </label>
              <Input
                name="employeeCode"
                required
                maxLength={50}
                autoComplete="off"
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 block text-xs">
                Họ và tên <span className="text-rose-500">*</span>
              </label>
              <Input
                name="fullName"
                required
                maxLength={180}
                autoComplete="off"
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 block text-xs">
                Ngày vào làm <span className="text-rose-500">*</span>
              </label>
              <DatePickerInput name="joinDate" required />
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 block text-xs">
                Email công việc
              </label>
              <Input
                name="workEmail"
                type="email"
                maxLength={255}
                className="text-xs h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-700 text-xs">Trạng thái làm việc</p>
            <SearchableSelect
              value={status}
              onChange={(value) => setStatus(value || 'OFFICIAL')}
              clearable={false}
              options={[
                { value: 'OFFICIAL', label: 'Chính thức' },
                { value: 'PROBATION', label: 'Thử việc' },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-700 text-xs">
              Tài khoản liên kết (không bắt buộc)
            </p>
            <SearchableSelect
              value={userId}
              onChange={(value) => setUserId(value || '')}
              clearable
              options={accounts.map((a) => ({
                value: a.id,
                label: a.fullName,
                description: a.email,
              }))}
              placeholder="Chọn tài khoản chưa liên kết"
            />
            <p className="text-[11px] text-slate-400">
              Có thể tạo hồ sơ và quản lý công, phép, lương trước khi cấp tài
              khoản.
            </p>
          </div>
          {error && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2"
            >
              <AlertCircle className="size-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}
          </div>
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
              className="text-xs h-8"
            >
              Hủy bỏ
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs flex items-center gap-1.5"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {saving ? 'Đang lưu…' : 'Tạo hồ sơ'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
