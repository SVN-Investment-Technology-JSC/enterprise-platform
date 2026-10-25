'use client';

import { useSettingsEmbedded } from '../ui/settings-center';
import { useCallback, useEffect, useState } from 'react';
import { History, Plus } from 'lucide-react';
import { useHrmPermissions } from '../hrm-permissions';
import { resolveTimeSettingsTab } from '../hrm-navigation';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import { PageTitle } from '../ui/page-title';
import { InfoNote, SectionTabs, StatusPill, kitPanelProps } from '../ui/settings-kit';
import { LocationCard } from '../ui/time-settings/location-card';
import { SitesPanel } from '../ui/time-settings/list-panels';
import { SiteDialog, emptySiteForm, type SiteFormState } from '../ui/time-settings/site-dialog';
import {
  SECTION_META,
  TIME_SETTINGS_TABS,
  formatIpText,
  normalizeMarks,
  parseIpText,
  tenantHasAssignments,
  type LocationSettings,
  type Settings,
  type SiteRow,
  type TimeSettingsTab,
  type UnitOption,
} from '../ui/time-settings/time-settings-model';

export { DAY_KIND_LABELS } from '../ui/time-settings/time-settings-model';

const DEFAULT_LOCATION: LocationSettings = {
  locationCheck: false,
  maxGpsAccuracyMeters: 100,
  legacyPolicy: false,
  configured: false,
};

/** Biểu mẫu sửa từ một địa điểm đã có: tách phân công COMPANY/UNIT (sửa được) khỏi chức danh/nhân viên (giữ nguyên). */
function siteToForm(row: SiteRow, units: readonly UnitOption[]): SiteFormState {
  const assignments = row.assignments ?? [];
  const marks = normalizeMarks(units, {
    companyWide: assignments.some((a) => a.scope_type === 'COMPANY'),
    unitIds: assignments.filter((a) => a.scope_type === 'UNIT').map((a) => a.scope_id),
    excludedUnitIds: assignments.filter((a) => a.scope_type === 'UNIT_EXCLUDE').map((a) => a.scope_id),
  });
  return {
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: Number(row.radius_meters),
    ipText: formatIpText(row.allowed_ips),
    companyWide: marks.companyWide,
    unitIds: [...marks.unitIds],
    excludedUnitIds: [...marks.excludedUnitIds],
    keptAssignments: assignments.filter((a) => a.scope_type === 'POSITION' || a.scope_type === 'EMPLOYEE'),
    reason: '',
  };
}

/** Phân công gửi lên máy chủ: toàn công ty (nếu chọn), đơn vị được tick, đơn vị ngoại lệ, và phân công chức danh/nhân viên giữ nguyên. */
export function assignmentsPayload(site: SiteFormState) {
  return [
    ...(site.companyWide ? [{ scopeType: 'COMPANY' as const, scopeId: '' }] : []),
    ...site.unitIds.map((scopeId) => ({ scopeType: 'UNIT' as const, scopeId })),
    ...site.excludedUnitIds.map((scopeId) => ({ scopeType: 'UNIT_EXCLUDE' as const, scopeId })),
    ...site.keptAssignments.map((a) => ({ scopeType: a.scope_type, scopeId: a.scope_id })),
  ];
}

/**
 * Mục "Địa điểm GPS" của nhóm "Chấm công": gộp quy định kiểm tra vị trí, địa điểm (GPS kèm IP nếu cần) và phòng ban được
 * gán (kế thừa xuống đơn vị con) vào một trang. Chọn bằng `?tab=`; đường dẫn cũ `?tab=rules` rơi về mục này.
 * Trong Trung tâm cấu hình mỗi mục là một trang riêng (thanh bên đã có sẵn các mục nên không vẽ thanh tab).
 */
export default function TimeSettingsScreen() {
  const { can } = useHrmPermissions();
  const embedded = useSettingsEmbedded();
  const allowedTabs = can('hrm.time.configure') ? TIME_SETTINGS_TABS : [];
  const allowedTabIds = allowedTabs.map((tab) => tab.id);
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab = resolveTimeSettingsTab(requestedTab, allowedTabIds) as TimeSettingsTab | '';

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
    if (urlReady && activeTab && requestedTab !== activeTab) selectTab(activeTab);
  }, [activeTab, requestedTab, selectTab, urlReady]);

  const [data, setData] = useState<Settings>({ calendar: [], sites: [] });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [site, setSite] = useState<SiteFormState>(emptySiteForm);
  /** `keepError`: tải lại sau một thao tác ghi không được xoá lỗi vừa báo. */
  const load = useCallback(async (keepError = false) => {
    if (!keepError) setError('');
    try {
      const result = await hrmFetch<{ data: Settings }>('/time-settings');
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Ngừng địa điểm sau khi người dùng xác nhận ở hộp xác nhận; máy chủ vẫn ghi nhật ký với lý do cố định. */
  async function remove(row: { id: string; updated_at: string }) {
    setError('');
    setMessage('');
    try {
      await hrmFetch(`/time-settings/sites/${row.id}/deactivate`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Ngừng địa điểm chấm công', expectedUpdatedAt: row.updated_at }),
      });
      setMessage('Đã ngừng địa điểm.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không ngừng được địa điểm');
    } finally {
      // Tải lại cả khi lỗi (vd phiên bản đã đổi) để danh sách khớp với máy chủ.
      void load(true);
    }
  }

  function openAddDialog() {
    setSite(emptySiteForm());
    setDialogOpen(true);
  }
  function openEditDialog(row: SiteRow) {
    setSite(siteToForm(row, data.units ?? []));
    setDialogOpen(true);
  }

  /** Lưu địa điểm rồi gán phòng ban: hai việc ghi liên tiếp, báo rõ nếu việc gán lỗi sau khi địa điểm đã lưu. */
  async function submitSite() {
    const allowedIps = parseIpText(site.ipText);
    const fields = {
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      radiusMeters: site.radiusMeters,
      allowedIps,
    };
    setBusy(true);
    setError('');
    setMessage('');
    let savedId = site.id;
    try {
      if (site.id) {
        const row = data.sites.find((s) => s.id === site.id);
        await hrmFetch(`/time-settings/sites/${site.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...fields, reason: site.reason, expectedUpdatedAt: row?.updated_at }),
        });
      } else {
        const created = await hrmFetch<{ data: { id: string } }>('/time-settings/sites', {
          method: 'POST',
          body: JSON.stringify(fields),
        });
        savedId = created.data.id;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được địa điểm');
      setBusy(false);
      return;
    }
    try {
      await hrmFetch(`/time-settings/sites/${savedId}/assignments`, {
        method: 'PUT',
        body: JSON.stringify({ assignments: assignmentsPayload(site), reason: site.reason || 'Gán địa điểm khi tạo' }),
      });
      setDialogOpen(false);
      const noScope = assignmentsPayload(site).every((a) => a.scopeType === 'UNIT_EXCLUDE') && tenantHasAssignments(data.sites);
      setMessage(
        noScope
          ? 'Đã lưu địa điểm. Lưu ý: chưa gán phòng ban nào nên chưa ai chấm công được tại đây.'
          : 'Đã lưu địa điểm.',
      );
    } catch (e) {
      setDialogOpen(false);
      setError(
        `Đã lưu địa điểm nhưng chưa gán được phòng ban: ${e instanceof Error ? e.message : 'lỗi không rõ'}. Mở lại địa điểm để gán.`,
      );
    } finally {
      setBusy(false);
      void load(true);
    }
  }

  async function saveLocation(next: { locationCheck: boolean; maxGpsAccuracyMeters: number }) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await hrmFetch('/time-settings/location', { method: 'PUT', body: JSON.stringify(next) });
      setMessage('Đã lưu cài đặt kiểm tra vị trí.');
      void load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cài đặt');
    } finally {
      setBusy(false);
    }
  }

  const meta = activeTab ? SECTION_META[activeTab] : null;
  const activeSites = data.sites.filter((s) => s.active).length;
  const location = data.location ?? DEFAULT_LOCATION;

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
    data.sites.length > 0 ? (
      <StatusPill tone={location.locationCheck ? 'green' : 'slate'}>
        {location.locationCheck ? `Đang kiểm vị trí · ${activeSites} địa điểm` : 'Chưa bật kiểm tra vị trí'}
      </StatusPill>
    ) : null;

  const primaryAction = (
    <Button permission="hrm.time.configure" onClick={openAddDialog} className="h-9 gap-1.5 px-4 text-xs font-semibold">
      <Plus className="size-4" />
      <span>Thêm địa điểm</span>
    </Button>
  );

  const panelProps = (id: TimeSettingsTab) =>
    embedded
      ? { id: `time-settings-panel-${id}`, role: 'region' as const, 'aria-label': SECTION_META[id].title }
      : kitPanelProps('time-settings', id);

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      {allowedTabs.length === 0 ? (
        <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
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

          {urlReady && activeTab === 'sites' ? (
            <div {...panelProps('sites')} className="space-y-4">
              <LocationCard
                key={`${location.locationCheck}-${location.maxGpsAccuracyMeters}-${location.legacyPolicy}`}
                value={location}
                canConfigure={can('hrm.time.configure')}
                busy={busy}
                activeSites={activeSites}
                onSave={(next) => void saveLocation(next)}
              />
              <SitesPanel
                rows={data.sites}
                canConfigure={can('hrm.time.configure')}
                onAdd={openAddDialog}
                onEdit={openEditDialog}
                onStop={(row) => remove(row)}
              />
            </div>
          ) : null}
        </>
      )}

      <SiteDialog
        open={dialogOpen}
        busy={busy}
        site={site}
        units={data.units ?? []}
        setSite={setSite}
        onClose={() => setDialogOpen(false)}
        onSubmit={() => void submitSite()}
      />
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
