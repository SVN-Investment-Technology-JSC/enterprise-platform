'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Input } from './input';
import { InfoNote, SettingsField, SettingsSection, StatusPill } from './settings-kit';
import {
  MAX_POLICY_REASON_LENGTH,
  policyStatusView,
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
  const reasonId = useId();

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
  const status = policyStatusView(settings);

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
    <SettingsSection
      icon={ShieldAlert}
      tone="amber"
      title="Chính sách tự duyệt đơn (duyệt trực tiếp)"
      description="Mặc định người duyệt không được tự duyệt đơn của chính mình."
      actions={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      bodyClassName="space-y-3"
    >
      <InfoNote tone="amber">
        Chỉ bật ngoại lệ khi tổ chức không có người duyệt thay thế. Mọi thay đổi
        được ghi nhật ký kiểm toán kèm lý do.
      </InfoNote>
      <div className="flex flex-wrap items-start gap-3">
        <SettingsField
          label="Lý do thay đổi"
          htmlFor={reasonId}
          hint={
            reasonError ? (
              <span className="text-red-600">{reasonError}</span>
            ) : (
              'Tối thiểu 10 ký tự.'
            )
          }
          className="min-w-0 flex-1 basis-64"
        >
          <Input
            id={reasonId}
            aria-label="Lý do thay đổi chính sách"
            placeholder="Lý do thay đổi (tối thiểu 10 ký tự)"
            maxLength={MAX_POLICY_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-9"
          />
        </SettingsField>
        <div className="pt-5">
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
            <Button
              variant="outline"
              disabled={blocked || busy}
              className="h-9 px-3 text-xs"
            >
              {copy.buttonLabel}
            </Button>
          </Popconfirm>
        </div>
      </div>
      {error && <InfoNote tone="red" role="alert">{error}</InfoNote>}
    </SettingsSection>
  );
}
