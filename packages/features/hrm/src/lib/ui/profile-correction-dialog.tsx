'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Info, Loader2, Send } from 'lucide-react';
import { HrmApiError, hrmFetch } from '../hrm-api';
import {
  PROFILE_CORRECTION_FIELDS,
  buildProfileCorrectionPayload,
  formatProfileValue,
  type ProfileCorrectionField,
} from '../profile-correction-model';
import {
  PROCEDURE_UNAVAILABLE_MESSAGE,
  interpretBindingResponse,
  visibleDynamicAttributes,
  type BindingLoadState,
} from '../request-form-attributes';
import { uploadHrmAttachment } from '../hrm-attachment-upload';
import { Button } from './button';
import { DatePickerInput } from './date-picker-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { DynamicAttributeForm } from './dynamic-attribute-form';
import { Input } from './input';
import { toast } from './toast';

export interface ProfileCorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Các trường được phép đề nghị đính chính trong hộp thoại này. */
  fields: readonly ProfileCorrectionField[];
  /** Giá trị hiện tại trong hồ sơ (ngày dạng YYYY-MM-DD, null khi không có hoặc bị ẩn). */
  current: Partial<Record<ProfileCorrectionField, string | null>>;
  /** Id nhân viên của người gửi đơn, dùng cho thuộc tính kiểu tệp của biểu mẫu quy trình. */
  employeeId?: string;
  onSubmitted?: () => void;
}

/**
 * Hộp thoại đề nghị đính chính hồ sơ (đơn profile_correction). Gửi tới POST /profile-corrections
 * với { changes, reason, attributes } giống biểu mẫu trong màn hình Đơn từ của tôi.
 */
export function ProfileCorrectionDialog({
  open,
  onOpenChange,
  fields,
  current,
  employeeId,
  onSubmitted,
}: ProfileCorrectionDialogProps) {
  const [proposed, setProposed] = useState<
    Partial<Record<ProfileCorrectionField, string>>
  >({});
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [binding, setBinding] = useState<BindingLoadState | null>(null);
  const [loadingBinding, setLoadingBinding] = useState(false);
  const [bindingReload, setBindingReload] = useState(0);
  const [dynamicValues, setDynamicValues] = useState<Record<string, unknown>>(
    {},
  );

  const fieldsKey = fields.join('|');
  // Mở hộp thoại: điền sẵn giá trị hiện tại để người dùng chỉ sửa phần cần đính chính.
  useEffect(() => {
    if (!open) return;
    const initial: Partial<Record<ProfileCorrectionField, string>> = {};
    for (const field of fields) initial[field] = current[field] ?? '';
    setProposed(initial);
    setReason('');
    setEvidence('');
    setError('');
    setDynamicValues({});
  }, [open, fieldsKey]);

  // Biểu mẫu thuộc tính động của quy trình duyệt đơn đính chính (nếu có cấu hình).
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingBinding(true);
    (async () => {
      let state: BindingLoadState;
      try {
        const body = await hrmFetch<unknown>(
          '/procedure-definitions/binding?kind=profile_correction',
        );
        state = interpretBindingResponse(200, body);
      } catch (e) {
        state =
          e instanceof HrmApiError
            ? interpretBindingResponse(e.status, e.body)
            : {
                status: 'error',
                message:
                  e instanceof Error
                    ? `Không tải được biểu mẫu quy trình: ${e.message}`
                    : 'Không tải được biểu mẫu quy trình',
              };
      }
      if (!active) return;
      setBinding(state);
      setLoadingBinding(false);
    })();
    return () => {
      active = false;
    };
  }, [open, bindingReload]);

  const attributes =
    binding?.status === 'ready' ? visibleDynamicAttributes(binding.attributes) : [];

  const handleSubmit = useCallback(async () => {
    setError('');
    const payload = buildProfileCorrectionPayload({
      fields,
      current,
      proposed,
      reason,
      evidence,
    });
    if (payload.changedFields.length === 0) {
      setError('Bạn chưa nhập giá trị đề xuất khác với hồ sơ hiện tại.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Vui lòng nhập lý do đính chính (tối thiểu 3 ký tự).');
      return;
    }
    setSubmitting(true);
    try {
      await hrmFetch('/profile-corrections', {
        method: 'POST',
        body: JSON.stringify({
          changes: payload.changes,
          reason: payload.reason,
          attributes: dynamicValues,
        }),
      });
      toast.success({
        title: 'Đã gửi đề nghị đính chính',
        description:
          'Hồ sơ chỉ thay đổi sau khi được duyệt. Theo dõi tiến độ tại Đơn từ của tôi.',
      });
      onOpenChange(false);
      onSubmitted?.();
    } catch (e) {
      if (e instanceof HrmApiError && e.code === 'PROCEDURE_UNAVAILABLE') {
        setError(PROCEDURE_UNAVAILABLE_MESSAGE);
      } else {
        setError(
          e instanceof Error
            ? e.message
            : 'Không thể gửi đề nghị đính chính. Vui lòng thử lại.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    current,
    dynamicValues,
    evidence,
    fields,
    onOpenChange,
    onSubmitted,
    proposed,
    reason,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="p-5 border-b border-slate-200 bg-slate-50">
          <DialogTitle>Đề nghị đính chính hồ sơ</DialogTitle>
          <DialogDescription>
            Nhập giá trị đúng cho các mục cần đính chính. Phòng Nhân sự đối chiếu
            minh chứng rồi mới cập nhật vào hồ sơ.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-4 text-xs max-h-[70vh] overflow-y-auto">
          {error && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-300 rounded-lg flex items-start gap-2 text-red-800"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="bg-blue-50/70 p-3 rounded-lg border border-blue-200 text-blue-900 flex items-start gap-2">
            <Info className="size-4 shrink-0 mt-0.5 text-blue-700" />
            <span>
              Chỉ các mục có giá trị khác hồ sơ hiện tại mới được đưa vào đơn.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((field) => {
              const def = PROFILE_CORRECTION_FIELDS[field];
              return (
                <div key={field} className="space-y-1">
                  <label className="font-semibold text-slate-800 block">
                    {def.label}
                    <span className="text-[10px] text-slate-400 font-normal ml-1">
                      (Hiện tại: {formatProfileValue(field, current[field])})
                    </span>
                  </label>
                  {def.kind === 'date' ? (
                    <DatePickerInput
                      aria-label={`${def.label} đề xuất`}
                      value={proposed[field] ?? ''}
                      onChange={(value) =>
                        setProposed((prev) => ({ ...prev, [field]: value }))
                      }
                      placeholder={def.placeholder}
                    />
                  ) : (
                    <Input
                      aria-label={`${def.label} đề xuất`}
                      value={proposed[field] ?? ''}
                      onChange={(event) =>
                        setProposed((prev) => ({
                          ...prev,
                          [field]: event.target.value,
                        }))
                      }
                      placeholder={def.placeholder}
                      className="text-xs"
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-800 block" htmlFor="profile-correction-evidence">
              Minh chứng đính kèm (không bắt buộc)
            </label>
            <Input
              id="profile-correction-evidence"
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="Ví dụ: Đã gửi bản scan hai mặt CCCD cho phòng Nhân sự"
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-800 block" htmlFor="profile-correction-reason">
              Lý do đính chính *
            </label>
            <textarea
              id="profile-correction-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Nêu lý do và căn cứ đính chính..."
              className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          {binding?.status === 'error' && (
            <div className="p-2.5 rounded-md border border-red-200 bg-red-50 text-[11px] text-red-700 flex items-center justify-between gap-2">
              <span>{binding.message}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs h-7 shrink-0"
                onClick={() => setBindingReload((value) => value + 1)}
              >
                Thử lại
              </Button>
            </div>
          )}
          {loadingBinding ? (
            <div className="py-2 text-center text-slate-400 flex items-center justify-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin text-[#021E73]" />
              <span>Đang tải biểu mẫu quy trình duyệt...</span>
            </div>
          ) : (
            <DynamicAttributeForm
              attributes={attributes}
              values={dynamicValues}
              onChange={(code, value) =>
                setDynamicValues((prev) => {
                  const next = { ...prev };
                  if (value === undefined) delete next[code];
                  else next[code] = value;
                  return next;
                })
              }
              onUploadFile={
                employeeId
                  ? (file) => uploadHrmAttachment(employeeId, file)
                  : undefined
              }
            />
          )}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Hủy
          </Button>
          <Button
            type="button"
            permission="hrm.self.request"
            size="sm"
            className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            <span>{submitting ? 'Đang gửi...' : 'Gửi đề nghị'}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
