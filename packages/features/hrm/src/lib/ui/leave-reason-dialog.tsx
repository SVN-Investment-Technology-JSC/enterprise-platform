'use client';
import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { LeaveField, LeaveSwitch } from './leave-form-controls';

/**
 * Hộp thoại thêm / sửa MỘT lý do nghỉ (danh mục cấu hình). Lý do nghỉ khác với "Mô tả":
 * mô tả là văn bản tự do do người làm đơn nhập, không cấu hình ở đây.
 * Lý do phép năm khóa các trường hưởng lương và trừ quỹ (server luôn ép có lương, trừ quỹ).
 */
export function LeaveReasonDialog({
  row,
  onClose,
  onSaved,
}: {
  /** Có `row` là sửa, không có là thêm mới. */
  row?: HrmLeaveType;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const uid = useId();
  const annual = Boolean(row?.isAnnual);
  const [code, setCode] = useState('');
  const [name, setName] = useState(row?.name ?? '');
  const [paid, setPaid] = useState(row?.paid ?? true);
  const [requiresAttachment, setRequiresAttachment] = useState(
    row?.requiresAttachment ?? false,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      if (!name.trim()) throw new Error('Cần nhập Tên lý do nghỉ');
      if (!row && !code.trim()) throw new Error('Cần nhập Mã lý do nghỉ');
      if (row && !reason.trim()) throw new Error('Cần nhập Ghi chú thay đổi');
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setBusy(true);
    try {
      if (row) {
        await hrmFetch(`/leave-types/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            // Lý do phép năm luôn có lương: không gửi `paid`, server cũng từ chối đổi.
            ...(annual ? {} : { paid }),
            requiresAttachment,
            expectedUpdatedAt: row.updatedAt,
            reason: reason.trim(),
          }),
        });
        await onSaved(`Đã cập nhật lý do nghỉ "${name.trim()}".`);
      } else {
        await hrmFetch('/leave-types', {
          method: 'POST',
          body: JSON.stringify({
            code: code.trim(),
            name: name.trim(),
            unit: 'DAYS',
            paid,
            requiresAttachment,
            active: true,
          }),
        });
        await onSaved(`Đã thêm lý do nghỉ "${name.trim()}".`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được dữ liệu');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden bg-white p-0 sm:max-w-[640px]">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-5 py-4 pr-12">
          <DialogTitle className="text-base font-bold text-slate-900">
            {row ? `Sửa lý do nghỉ ${row.code}` : 'Thêm lý do nghỉ'}
          </DialogTitle>
          <p className="mt-1 text-xs text-slate-500">
            Lý do nghỉ là danh mục do quản trị cấu hình. Người làm đơn chọn một
            lý do rồi nhập thêm Mô tả (văn bản tự do) nếu cần.
          </p>
        </DialogHeader>
        <form
          onSubmit={submit}
          noValidate
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {annual ? (
              <p
                role="note"
                className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"
              >
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Đây là lý do Phép năm: luôn có lương, trừ quỹ phép năm và không
                  thể ngừng. Cách cộng phép cấu hình ở Chính sách phép năm.
                </span>
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {row ? (
                <LeaveField label="Mã">
                  <p className="flex h-9 items-center font-mono text-xs text-slate-700">
                    {row.code}
                  </p>
                </LeaveField>
              ) : (
                <LeaveField
                  label="Mã lý do nghỉ"
                  required
                  htmlFor={`${uid}-code`}
                  hint="Ví dụ: NGHI_OM. Không đổi được sau khi tạo."
                >
                  <Input
                    id={`${uid}-code`}
                    maxLength={50}
                    className="h-9 text-xs"
                    disabled={busy}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </LeaveField>
              )}
              <LeaveField
                label="Tên lý do nghỉ"
                required
                htmlFor={`${uid}-name`}
                className="sm:col-span-2"
              >
                <Input
                  id={`${uid}-name`}
                  maxLength={255}
                  className="h-9 text-xs"
                  disabled={busy}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </LeaveField>
            </div>

            <div className="flex items-start gap-3">
              <LeaveSwitch
                label="Có lương"
                checked={annual ? true : paid}
                disabled={busy || annual}
                onChange={setPaid}
              />
              <div>
                <p className="text-xs font-medium text-slate-700">Có lương</p>
                <p className="text-[11px] leading-snug text-slate-500">
                  {annual || paid
                    ? 'Ngày nghỉ được tính là ngày công có lương trong bảng công.'
                    : 'Không lương: ngày nghỉ không được tính công.'}{' '}
                  {annual
                    ? 'Phép năm luôn có lương.'
                    : 'Không đổi được sau khi lý do đã có đơn.'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <LeaveSwitch
                label="Cần chứng từ"
                checked={requiresAttachment}
                disabled={busy}
                onChange={setRequiresAttachment}
              />
              <div>
                <p className="text-xs font-medium text-slate-700">
                  Cần chứng từ
                </p>
                <p className="text-[11px] leading-snug text-slate-500">
                  Người làm đơn phải đính kèm chứng từ (ví dụ giấy khám bệnh).
                </p>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              {annual
                ? 'Trừ quỹ phép năm: Có.'
                : 'Trừ quỹ phép năm: Không. Chỉ lý do Phép năm mới trừ quỹ phép, dù có lương hay không lương.'}
            </p>

            {row ? (
              <LeaveField
                label="Ghi chú thay đổi"
                required
                htmlFor={`${uid}-reason`}
                hint="Ghi vào nhật ký kiểm toán. Đây là ghi chú của quản trị, không phải Mô tả ở đơn nghỉ."
              >
                <Input
                  id={`${uid}-reason`}
                  maxLength={1000}
                  className="h-9 text-xs"
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </LeaveField>
            ) : null}
          </div>
          {error ? (
            <div className="px-5 py-2">
              <p
                role="alert"
                className="rounded border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600"
              >
                {error}
              </p>
            </div>
          ) : null}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="h-8 text-xs"
            >
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-8 bg-blue-600 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              {busy ? 'Đang lưu...' : 'Lưu lý do nghỉ'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
