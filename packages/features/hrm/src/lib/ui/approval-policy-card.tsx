'use client';
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';
import {
  MAX_POLICY_REASON_LENGTH,
  policyToggleCopy,
  validatePolicyReason,
  type ApprovalPolicySettings,
} from './approval-policy-view';

/** Thẻ cấu hình ngoại lệ "cho phép tự duyệt" (chỉ nên hiển thị cho người có hrm.integration.manage). */
export function ApprovalPolicyCard() {
  const [settings, setSettings] = useState<ApprovalPolicySettings | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: ApprovalPolicySettings }>(
      '/approval-policy-settings',
    );
    setSettings(result.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  const copy = policyToggleCopy(settings?.allowSelfApproval === true);
  const reasonError = reason ? validatePolicyReason(reason) : '';
  const blocked = !settings || validatePolicyReason(reason) !== '';

  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await hrmFetch<{ data: ApprovalPolicySettings }>(
        '/approval-policy-settings',
        {
          method: 'PUT',
          body: JSON.stringify({
            allowSelfApproval: copy.target,
            reason: reason.trim(),
          }),
        },
      );
      setSettings(result.data);
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          <ShieldAlert className="size-4 text-amber-600" />
          Chính sách tự duyệt đơn (duyệt trực tiếp)
        </span>
        <Badge variant={settings?.allowSelfApproval ? 'destructive' : 'secondary'}>
          {settings
            ? settings.allowSelfApproval
              ? 'Đang cho phép tự duyệt'
              : 'Đang chặn tự duyệt'
            : 'Đang tải'}
        </Badge>
      </div>
      <p className="text-xs text-slate-600">
        Mặc định người duyệt không được tự duyệt đơn của chính mình. Chỉ bật ngoại
        lệ khi tổ chức không có người duyệt thay thế. Mọi thay đổi được ghi nhật ký
        kiểm toán kèm lý do.
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-64 flex-1">
          <Input
            aria-label="Lý do thay đổi chính sách"
            placeholder="Lý do thay đổi (tối thiểu 10 ký tự)"
            maxLength={MAX_POLICY_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {reasonError && (
            <span className="text-xs text-red-600">{reasonError}</span>
          )}
        </div>
        <Popconfirm
          title={copy.confirmTitle}
          description={copy.confirmDescription}
          okText={copy.okText}
          cancelText="Quay lại"
          okType={copy.okType}
          disabled={blocked || busy}
          loading={busy}
          onConfirm={save}
        >
          <Button variant="outline" disabled={blocked || busy} className="h-8 text-xs">
            {copy.buttonLabel}
          </Button>
        </Popconfirm>
      </div>
      {error && (
        <div role="alert" className="text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
