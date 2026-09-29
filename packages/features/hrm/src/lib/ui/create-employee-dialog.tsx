'use client';

import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Input } from './input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';

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
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Thêm hồ sơ nhân viên</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm font-medium">
              Mã nhân viên
              <Input
                name="employeeCode"
                required
                maxLength={50}
                autoComplete="off"
              />
            </label>
            <label className="text-sm font-medium">
              Họ và tên
              <Input
                name="fullName"
                required
                maxLength={180}
                autoComplete="off"
              />
            </label>
            <label className="text-sm font-medium">
              Ngày vào làm
              <Input name="joinDate" type="date" required />
            </label>
            <label className="text-sm font-medium">
              Email công việc
              <Input name="workEmail" type="email" maxLength={255} />
            </label>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Trạng thái làm việc</p>
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
          <div className="space-y-1">
            <p className="text-sm font-medium">
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
            <p className="text-xs text-slate-500">
              Có thể tạo hồ sơ và quản lý công, phép, lương trước khi cấp tài
              khoản.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Đang lưu…' : 'Tạo hồ sơ'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
