'use client';

import { useSettingsEmbedded } from '../ui/settings-center';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Plus } from 'lucide-react';
import { useHrmPermissions } from '../hrm-permissions';
import { resolveTimeSettingsTab } from '../hrm-navigation';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import { PageTitle } from '../ui/page-title';
import {
  InfoNote,
  SectionTabs,
  StatusPill,
  kitPanelProps,
} from '../ui/settings-kit';
import { SitesPanel } from '../ui/time-settings/list-panels';
import { PolicyDialog } from '../ui/time-settings/policy-dialog';
import { RulesPanel } from '../ui/time-settings/rules-panel';
import { SiteDialog, type SiteFormState } from '../ui/time-settings/site-dialog';
import {
  SECTION_META,
  TIME_SETTINGS_TABS,
  emptyPolicyForm,
  pickCurrentVersion,
  previewPolicyImpact,
  today,
  type EmployeeOption,
  type PolicyFormState,
  type Settings,
  type TimeSettingsTab,
} from '../ui/time-settings/time-settings-model';

export { DAY_KIND_LABELS } from '../ui/time-settings/time-settings-model';

const emptySite = (): SiteFormState => ({
  name: '',
  latitude: 0,
  longitude: 0,
  radiusMeters: 100,
});

/**
 * Nhóm "Chấm công": hai mục độc lập (Quy định chấm công, Địa điểm GPS) chọn bằng
 * `?tab=`. Trong Trung tâm cấu hình mỗi mục là một trang riêng (thanh bên đã có sẵn các mục nên không vẽ thanh tab);
 * ngoài trung tâm có thanh tab ngang cuộn được.
 */
export default function TimeSettingsScreen() {
  const { can } = useHrmPermissions();
  // Trong trung tâm cấu hình, các tab con đã nằm ở thanh bên nên không vẽ thanh tab riêng.
  const embedded = useSettingsEmbedded();
  const allowedTabs = can('hrm.time.configure') ? TIME_SETTINGS_TABS : [];
  const allowedTabIds = allowedTabs.map((tab) => tab.id);
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab = resolveTimeSettingsTab(
    requestedTab,
    allowedTabIds,
  ) as TimeSettingsTab | '';

  useEffect(() => {
    const sync = () => {
      setRequestedTab(new URLSearchParams(window.location.search).get('tab'));
      setUrlReady(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const selectTab = useCallback((tab: TimeSettingsTab) => {
    setRequestedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    if (urlReady && activeTab && requestedTab !== activeTab) {
      selectTab(activeTab);
    }
  }, [activeTab, requestedTab, selectTab, urlReady]);

  const [data, setData] = useState<Settings>({
    calendar: [],
    sites: [],
    versions: [],
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<HrmAction | null>(null);
  const [dialog, setDialog] = useState<'policy' | 'site' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [policy, setPolicy] = useState<PolicyFormState>(emptyPolicyForm);
  const [site, setSite] = useState<SiteFormState>(emptySite);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await hrmFetch<{ data: Settings }>('/time-settings');
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình');
    }
  }, []);
  const policyPreview = useMemo(
    () => previewPolicyImpact(data.versions, policy),
    [data.versions, policy],
  );
  async function loadEmployees() {
    if (employees.length) return;
    try {
      // /employee-options chỉ cần quyền đọc HRM (vai trò chấm công không có quyền xem hồ sơ).
      setEmployees(await hrmEmployeeOptions());
    } catch {
      setError('Không tải được danh sách nhân viên để chọn phạm vi áp dụng');
    }
  }
  async function mutate(path: string, method: string, body: unknown) {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    setMessage('Đã lưu thay đổi cấu hình.');
    // Ghi đã thành công: tải lại tách riêng để lỗi tải không khiến người dùng gửi lại.
    void load();
  }
  function editSite(row: Settings['sites'][number]) {
    setAction({
      title: 'Cập nhật địa điểm chấm công',
      columns: 2,
      fields: [
        { key: 'name', label: 'Tên địa điểm', value: row.name },
        {
          key: 'latitude',
          label: 'Vĩ độ',
          type: 'number',
          min: -90,
          max: 90,
          step: 'any',
          value: row.latitude,
        },
        {
          key: 'longitude',
          label: 'Kinh độ',
          type: 'number',
          min: -180,
          max: 180,
          step: 'any',
          value: row.longitude,
        },
        {
          key: 'radiusMeters',
          label: 'Bán kính (m)',
          type: 'number',
          min: 1,
          max: 100000,
          value: row.radius_meters,
        },
        { key: 'reason', label: 'Lý do thay đổi' },
      ],
      submit: async (v) =>
        mutate(`/time-settings/sites/${row.id}`, 'PATCH', {
          ...v,
          latitude: Number(v.latitude),
          longitude: Number(v.longitude),
          radiusMeters: Number(v.radiusMeters),
          expectedUpdatedAt: row.updated_at,
        }),
    });
  }
  function remove(row: { id: string; updated_at: string }) {
    setAction({
      title: 'Ngừng địa điểm',
      confirmTitle: 'Xác nhận thay đổi cấu hình?',
      description:
        'Giữ lịch sử và chứng cứ đã ghi nhận. Kỳ công mở bị ảnh hưởng phải tính lại.',
      fields: [{ key: 'reason', label: 'Lý do' }],
      submit: async (v) =>
        mutate(`/time-settings/sites/${row.id}/deactivate`, 'POST', {
          ...v,
          expectedUpdatedAt: row.updated_at,
        }),
    });
  }
  useEffect(() => {
    void load();
  }, [load]);
  async function save(
    path: string,
    body: unknown,
    done = 'Đã lưu cấu hình.',
  ) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await hrmFetch<{ data?: { warnings?: string[] } }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setDialog(null);
      const warnings = result?.data?.warnings ?? [];
      setMessage(
        warnings.length ? `${done} Lưu ý: ${warnings.join(' ')}` : done,
      );
      // Ghi đã thành công: tải lại tách riêng để không bị gửi lại khi tải lỗi.
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  function openPolicyDialog() {
    setPolicy(emptyPolicyForm());
    setDialog('policy');
    void loadEmployees();
  }
  function openSiteDialog() {
    setSite(emptySite());
    setDialog('site');
  }
  function submitPolicy() {
    void save('/time-settings/policy', {
      effectiveFrom: policy.effectiveFrom,
      effectiveTo: policy.effectiveTo || null,
      reason: policy.reason,
      employeeIds: policy.scope === 'EMPLOYEES' ? policy.employeeIds : [],
      timezone: policy.timezone,
      requireIp: policy.requireIp,
      requireGps: policy.requireGps,
      maxGpsAccuracyMeters: policy.maxGpsAccuracyMeters,
      allowedIps: policy.allowedIps
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  const meta = activeTab ? SECTION_META[activeTab] : null;
  const currentVersion = pickCurrentVersion(data.versions, today());
  const activeSites = data.sites.filter((s) => s.active).length;

  const historyButton = can('hrm.audit.read') ? (
    <Button
      type="button"
      variant="outline"
      onClick={() => setHistoryOpen(true)}
      className="h-9 gap-1.5 px-3 text-xs font-semibold"
    >
      <History className="size-4" />
      <span>Lịch sử thay đổi</span>
    </Button>
  ) : null;

  const badge =
    activeTab === 'rules' ? (
      currentVersion ? (
        <StatusPill tone="green">{`Đang áp dụng · v${currentVersion.version_no}`}</StatusPill>
      ) : data.versions.length ? (
        <StatusPill tone="amber">Chưa có quy định áp dụng</StatusPill>
      ) : null
    ) : activeTab === 'sites' && data.sites.length > 0 ? (
      <StatusPill tone="green">{`${activeSites} đang dùng`}</StatusPill>
    ) : null;

  const primaryAction =
    activeTab === 'rules' ? (
      <Button
        permission="hrm.time.configure"
        onClick={openPolicyDialog}
        className="h-9 gap-1.5 px-4 text-xs font-semibold"
      >
        <Plus className="size-4" />
        <span>Tạo phiên bản mới</span>
      </Button>
    ) : activeTab === 'sites' ? (
      <Button
        permission="hrm.time.configure"
        onClick={openSiteDialog}
        className="h-9 gap-1.5 px-4 text-xs font-semibold"
      >
        <Plus className="size-4" />
        <span>Thêm địa điểm</span>
      </Button>
    ) : null;

  const panelProps = (id: TimeSettingsTab) =>
    embedded
      ? { id: `time-settings-panel-${id}`, role: 'region' as const, 'aria-label': SECTION_META[id].title }
      : kitPanelProps('time-settings', id);

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      {allowedTabs.length === 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
        >
          Bạn không có quyền xem nhóm cấu hình này.
        </div>
      ) : (
        <>
          {meta ? (
            <PageTitle
              title={meta.title}
              description={meta.description}
              badge={badge}
              actions={
                <>
                  {historyButton}
                  {primaryAction}
                </>
              }
            />
          ) : null}

          {embedded ? null : (
            <SectionTabs
              tabs={allowedTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
              active={activeTab}
              onChange={(id) => selectTab(id as TimeSettingsTab)}
              ariaLabel="Cấu hình chấm công"
              idPrefix="time-settings"
            />
          )}

          {error ? (
            <InfoNote tone="red" role="alert">
              {error}
            </InfoNote>
          ) : null}
          {message ? (
            <InfoNote tone="green" role="status">
              {message}
            </InfoNote>
          ) : null}

          {urlReady && activeTab === 'rules' ? (
            <div {...panelProps('rules')}>
              <RulesPanel versions={data.versions} onCreate={openPolicyDialog} />
            </div>
          ) : null}
          {urlReady && activeTab === 'sites' ? (
            <div {...panelProps('sites')}>
              <SitesPanel
                rows={data.sites}
                canConfigure={can('hrm.time.configure')}
                onAdd={openSiteDialog}
                onEdit={editSite}
                onStop={remove}
              />
            </div>
          ) : null}
        </>
      )}

      <PolicyDialog
        open={dialog === 'policy'}
        busy={busy}
        policy={policy}
        setPolicy={setPolicy}
        employees={employees}
        impact={policyPreview}
        onClose={() => setDialog(null)}
        onSubmit={submitPolicy}
      />
      <SiteDialog
        open={dialog === 'site'}
        busy={busy}
        site={site}
        setSite={setSite}
        onClose={() => setDialog(null)}
        onSubmit={() => void save('/time-settings/sites', site, 'Đã thêm địa điểm.')}
      />
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
      {meta ? (
        <ConfigHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          description={meta.historyDescription}
          actionPrefixes={meta.historyPrefixes}
        />
      ) : null}
    </div>
  );
}
