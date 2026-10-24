'use client';
import { useCallback, useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import type { ApprovalRoutePositionOption } from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { InfoNote, SettingsField, SettingsSection, StatusPill } from './settings-kit';
import type { ApprovalPolicySettings } from './approval-policy-view';

/**
 * Thẻ chọn chức danh dự phòng cuối: người giữ chức danh này duyệt đơn của nhân viên không có "Báo cáo cho".
 * Để trống = không dùng bậc dự phòng cuối (đơn của nhân viên đó chỉ do người có quyền duyệt toàn bộ xử lý).
 */
export function LastResortApproverCard(props: {
  positions: readonly ApprovalRoutePositionOption[];
}) {
  const [settings, setSettings] = useState<ApprovalPolicySettings | null>(null);
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

  const current = settings?.lastResortPositionId ?? '';
  const options = props.positions.map((p) => ({ value: p.id, label: p.name }));
  if (current && !options.some((o) => o.value === current))
    options.unshift({
      value: current,
      label: settings?.lastResortPositionName ?? 'Chức danh đã chọn',
    });

  async function save(positionId: string | null) {
    setBusy(true);
    setError('');
    try {
      const result = await hrmFetch<{ data: ApprovalPolicySettings }>(
        '/approval-policy-settings/last-resort',
        { method: 'PUT', body: JSON.stringify({ positionId }) },
      );
      setSettings(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      icon={UserCheck}
      tone="blue"
      title="Người duyệt dự phòng cuối"
      description="Chức danh duyệt đơn của nhân viên chưa có “Báo cáo cho”."
      actions={
        <StatusPill tone={current ? 'green' : 'slate'}>
          {settings ? (current ? 'Đang dùng' : 'Không dùng') : 'Đang tải'}
        </StatusPill>
      }
      bodyClassName="space-y-3"
    >
      <InfoNote tone="blue">
        Để trống thì đơn của nhân viên chưa có “Báo cáo cho” chỉ do người có quyền duyệt toàn bộ xử lý.
      </InfoNote>
      <SettingsField label="Chức danh dự phòng cuối" className="max-w-md">
        <div role="group" aria-label="Chức danh dự phòng cuối">
          <SearchableSelect
            options={options}
            value={current}
            clearable
            disabled={busy || !settings}
            placeholder="Không dùng"
            onChange={(value) => void save(value || null)}
          />
        </div>
      </SettingsField>
      {error && <InfoNote tone="red" role="alert">{error}</InfoNote>}
    </SettingsSection>
  );
}
