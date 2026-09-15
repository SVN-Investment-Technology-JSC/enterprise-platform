'use client';

import type {
  CreateMaintenanceIncidentRequest,
  MaintenanceFrequency,
  MaintenanceFrequencyCatalog,
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceMatrix,
  MaintenanceOccurrence,
  MaintenancePriority,
  MaintenanceSettingsSnapshot,
  MaintenanceWorkspace,
} from '@enterprise-platform/contracts-maintenance';
import {
  DashboardCardPicker,
  DashboardView,
  ModuleSettingsView,
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { RotateCcw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AssetTaskPanel } from './components/asset-task-panel';
import { IncidentForm } from './components/incident-form';
import { FrequencyCatalogEditor } from './components/frequency-catalog-editor';
import { MaintenanceHistory } from './components/maintenance-history';
import { MaintenanceSchedulesTable } from './components/maintenance-schedules';
import {
  completeMaintenanceOccurrence,
  createMaintenanceIncident,
  createMaintenanceSchedule,
  loadMaintenanceHistory,
  loadTenantMembers,
  loadMaintenanceMatrix,
  loadMaintenanceWorkspace,
  loadOrganizationUnitNames,
  loadMaintenanceSettings,
  loadTenantHomePath,
  removeAssetFromMatrix,
  runMaintenanceNow,
  saveMaintenanceMatrix,
  loadPerformersByInstanceCode,
  saveMaintenanceSetting,
  skipNextOccurrence,
  updateMaintenanceSchedule,
  uploadOccurrenceAttachment,
} from './maintenance-api';
import {
  MAINTENANCE_DASHBOARD_CARDS,
  type MaintenanceDashboardData,
} from './maintenance-dashboard.cards';
import {
  AlertTriangle,
  CalendarClock,
  Grid3X3,
  History as LucideHistory,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { MaintenanceMatrixBoard } from './components/maintenance-matrix';
import styles from './maintenance.module.scss';

type View = 'dashboard' | 'matrix' | 'schedules' | 'occurrences' | 'history' | 'settings';

const NAV: readonly ModuleNavItem<View>[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard style={{ width: '1rem', height: '1rem' }} /> },
  { id: 'matrix', label: 'Ma trận bảo trì', group: 'Vận hành', icon: <Grid3X3 style={{ width: '1rem', height: '1rem' }} /> },
  { id: 'schedules', label: 'Lịch bảo trì', group: 'Vận hành', icon: <CalendarClock style={{ width: '1rem', height: '1rem' }} /> },
  { id: 'occurrences', label: 'Phiếu phát sinh', group: 'Vận hành', icon: <AlertTriangle style={{ width: '1rem', height: '1rem' }} /> },
  { id: 'history', label: 'Lịch sử', group: 'Vận hành', icon: <LucideHistory style={{ width: '1rem', height: '1rem' }} /> },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị', icon: <Settings style={{ width: '1rem', height: '1rem' }} /> },
];

const VIEW_IDS = NAV.map((item) => item.id);

/** Nhãn dự phòng khi chưa đọc được danh mục tần suất từ cấu hình module. */
const FALLBACK_FREQUENCY_LABEL: Record<string, string> = {
  day: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  quarter: 'Quý',
  year: 'Năm',
};

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

const OCCURRENCE_STATUS_LABELS: Record<string, string> = {
  planned: 'Đã lên lịch',
  in_progress: 'Đang xử lý',
  dispatch_pending: 'Chờ tạo phiếu',
  generated: 'Đã tạo phiếu',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  blocked: 'Bị chặn',
};

const OCC_KIND_OPTIONS = [
  { value: 'all', label: 'Tất cả loại phát sinh' },
  { value: 'preventive', label: 'Bảo trì định kỳ' },
  { value: 'incident', label: 'Sự cố đột xuất' },
];

const OCC_PRIORITY_OPTIONS = [
  { value: 'all', label: 'Tất cả mức ưu tiên' },
  { value: 'High', label: 'Cao' },
  { value: 'Normal', label: 'Thường' },
  { value: 'Low', label: 'Thấp' },
];

const OCC_STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'planned', label: 'Đã lên lịch' },
  { value: 'dispatch_pending', label: 'Chờ tạo phiếu' },
  { value: 'generated', label: 'Đã tạo phiếu' },
  { value: 'blocked', label: 'Bị chặn' },
];

const OCC_PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15 / trang' },
  { value: '30', label: '30 / trang' },
  { value: '45', label: '45 / trang' },
  { value: '60', label: '60 / trang' },
];

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
  }).format(new Date(value));
}

export function MaintenanceScreen() {
  const { view, navigate } = useHashView<View>({ views: VIEW_IDS, fallback: 'dashboard' });
  const [matrix, setMatrix] = useState<MaintenanceMatrix>();
  const [unitNames, setUnitNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [workspace, setWorkspace] = useState<MaintenanceWorkspace>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assetQuery, setAssetQuery] = useState('');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [taskAsset, setTaskAsset] = useState<string>();
  const [homePath, setHomePath] = useState('/');
  const [history, setHistory] = useState<MaintenanceHistoryPage>();
  const [historyFilter, setHistoryFilter] = useState<MaintenanceHistoryFilter>({});
  const [selectedOccurrence, setSelectedOccurrence] = useState<MaintenanceOccurrence>();
  const [members, setMembers] = useState<readonly { userId: string; displayName: string }[]>([]);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [performers, setPerformers] = useState<ReadonlyMap<string, string[]>>(new Map());
  const [settings, setSettings] = useState<MaintenanceSettingsSnapshot>();
  const [cardDraft, setCardDraft] = useState<readonly string[]>([]);
  const [freqDraft, setFreqDraft] = useState<MaintenanceFrequencyCatalog>();
  const [settingsSection, setSettingsSection] = useState('dashboard');
  const [savingCards, setSavingCards] = useState(false);

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [nextWorkspace, nextMatrix] = await Promise.all([
        loadMaintenanceWorkspace(),
        loadMaintenanceMatrix(),
      ]);
      setWorkspace(nextWorkspace);
      setMatrix(nextMatrix);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải Maintenance.');
    }
  }, []);

  useEffect(() => {
    void reload();
    void loadTenantHomePath().then(setHomePath);
    void loadOrganizationUnitNames().then(setUnitNames);
    void loadTenantMembers().then(setMembers);
  }, [reload]);

  /**
   * Cấu hình chỉ nạp khi thật sự cần: dashboard cần biết thẻ nào bật, màn cài
   * đặt cần cả bản gốc để so sánh thay đổi. Các view còn lại không dùng tới.
   */
  useEffect(() => {
    // Ma trận và form lịch cũng cần cấu hình: danh mục tần suất nằm trong đó.
    if (view === 'occurrences' || view === 'history') return;
    if (settings) return;
    void loadMaintenanceSettings()
      .then((loaded) => {
        setSettings(loaded);
        setCardDraft(loaded['dashboard.cards'].value.cardIds);
        setFreqDraft(loaded['catalog.frequency'].value);
      })
      .catch(() => setSettings(undefined));
  }, [view, settings]);

  /**
   * Mã thiết bị phải là mã có thật bên Kho — gõ tay sinh ra lịch trỏ vào thiết bị
   * không tồn tại, và lỗi chỉ lộ ra lúc scheduler chạy. Vẫn cho gõ tự do để tìm,
   * nhưng chặn ngay ở client nếu không khớp mã nào.
   */
  const assetOptions = useMemo(
    () =>
      [...(matrix?.rows ?? [])]
        .map((row) => row.asset)
        .sort((left, right) => left.code.localeCompare(right.code, 'vi')),
    [matrix],
  );
  const pickedAsset = assetOptions.find(
    (asset) => asset.code.toLowerCase() === assetQuery.trim().toLowerCase(),
  );

  const procedureOptions = useMemo(
    () =>
      (workspace?.procedureCatalog ?? []).map((entry) => ({
        value: entry.definitionId,
        label: `${entry.code} · ${entry.name}`,
      })),
    [workspace],
  );

  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!pickedAsset) {
      setError(`Không có thiết bị nào mã “${assetQuery.trim()}” trong Kho.`);
      return;
    }
    setBusy(true);
    try {
      await createMaintenanceSchedule({
        assetCode: pickedAsset.code,
        procedureDefinitionId: procedureDefinitionId || String(form.get('procedureDefinitionId') ?? '') || undefined,
        frequency: form.get('frequency') as MaintenanceFrequency,
        priority: form.get('priority') as MaintenancePriority,
        startDate: String(form.get('startDate') ?? ''),
        activate: form.get('activate') === 'on',
      });
      setCreating(false);
      setAssetQuery('');
      setProcedureDefinitionId('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được lịch bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  const skipOnce = async (id: string) => {
    setBusy(true);
    try {
      await skipNextOccurrence(id);
      // Màn này chưa có băng thông báo riêng; hạn mới hiện ngay ở cột "Đến hạn"
      // sau khi nạp lại, nên không cần nói thêm.
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không bỏ qua được kỳ bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSchedule = async (id: string, status: 'active' | 'paused') => {
    setBusy(true);
    try {
      await updateMaintenanceSchedule(id, { status });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không cập nhật được lịch.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Thêm thiết bị vào ma trận = tạo ngay một lịch tạm dừng, chưa bật chu kỳ nào.
   *
   * Cần một bản ghi thật thì hàng mới sống sót qua lần tải lại; giữ ở trạng thái
   * tạm dừng để scheduler chưa sinh phiếu cho tới khi người dùng tick chu kỳ.
   */
  const addAssetToMatrix = async (assetCode: string) => {
    setBusy(true);
    try {
      await createMaintenanceSchedule({
        assetCode,
        frequency: frequencyOptions[0]?.id ?? 'month',
        priority: 'Normal',
        startDate: new Date().toISOString().slice(0, 10),
        activate: false,
      });
      await reload();
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thêm được thiết bị vào ma trận.');
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = async (assetCode: string) => {
    setBusy(true);
    try {
      await removeAssetFromMatrix(assetCode);
      await reload();
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không gỡ được thiết bị khỏi ma trận.');
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (assetCode: string, frequency?: MaintenanceFrequency) => {
    setBusy(true);
    try {
      const result = await runMaintenanceNow(assetCode, frequency);
      await reload();
      setError(
        result.generated === 0
          ? `Chưa sinh được phiếu cho ${assetCode}; kiểm tra lại chu kỳ đang bật.`
          : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được phiếu bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  const saveMatrix = async (
    entries: Parameters<typeof saveMaintenanceMatrix>[0]['entries'],
  ) => {
    setBusy(true);
    try {
      const result = await saveMaintenanceMatrix({ entries });
      await reload();
      setError(
        result.created + result.reactivated + result.paused + result.updated === 0
          ? 'Không có thay đổi nào cần lưu.'
          : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được ma trận bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Lịch sử tải riêng, KHÔNG gộp vào `reload()`: đổi một bộ lọc mà kéo theo
   * refetch cả workspace lẫn ma trận là lãng phí và làm giao diện giật.
   */
  const loadHistory = useCallback(
    async (filter: MaintenanceHistoryFilter, append = false) => {
      setBusy(true);
      try {
        const page = await loadMaintenanceHistory(filter);
        setHistory((current) =>
          append && current ? { ...page, items: [...current.items, ...page.items] } : page,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không tải được lịch sử bảo trì.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (view !== 'history') return;
    void loadHistory(historyFilter);
    // Người thực hiện đọc từ Quy trình, chỉ khi thật sự mở màn Lịch sử — không
    // nạp sẵn ở mọi màn cho một cột phụ.
    void loadPerformersByInstanceCode().then(setPerformers);
  }, [view, historyFilter, loadHistory]);

  const submitIncident = async (
    input: CreateMaintenanceIncidentRequest,
    files?: File[],
  ) => {
    setBusy(true);
    try {
      const created = await createMaintenanceIncident(input);
      if (files && files.length > 0) {
        await Promise.all(
          files.map((file) => uploadOccurrenceAttachment(created.id, file)),
        );
      }
      setIncidentOpen(false);
      setError(undefined);
      await reload();
      navigate('history');
      setHistoryFilter({});
      setSelectedOccurrence(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được sự cố.');
    } finally {
      setBusy(false);
    }
  };

  const closeOut = async (id: string, note: string) => {
    setBusy(true);
    try {
      const saved = await completeMaintenanceOccurrence(id, note);
      setSelectedOccurrence(saved);
      await Promise.all([reload(), loadHistory(historyFilter)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đánh dấu hoàn thành được.');
    } finally {
      setBusy(false);
    }
  };

  const canManage = workspace?.permissions.canManageSchedules ?? false;

  const saveCards = async () => {
    if (!settings) return;
    setSavingCards(true);
    try {
      const saved = await saveMaintenanceSetting(
        'dashboard.cards',
        { cardIds: cardDraft },
        settings['dashboard.cards'].version,
      );
      setSettings({
        ...settings,
        'dashboard.cards': saved as MaintenanceSettingsSnapshot['dashboard.cards'],
      });
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
    } finally {
      setSavingCards(false);
    }
  };

  /**
   * Tần suất đang bật, theo thứ tự admin đã sắp trong Cài đặt. Chưa nạp được
   * cấu hình thì dùng năm tần suất dựng sẵn để ma trận vẫn hiện đúng cột.
   */
  const frequencyOptions = useMemo(() => {
    const options = (settings?.['catalog.frequency'].value.options ?? []).filter(
      (option) => option.isActive,
    );
    if (options.length === 0) {
      return Object.entries(FALLBACK_FREQUENCY_LABEL).map(([id, label]) => ({ id, label }));
    }
    return options.map((option) => ({ id: option.code, label: option.label }));
  }, [settings]);

  const frequencyLabel = (code: string) =>
    frequencyOptions.find((option) => option.id === code)?.label ??
    FALLBACK_FREQUENCY_LABEL[code] ??
    code;

  const saveFrequencies = async () => {
    if (!settings || !freqDraft) return;
    setSavingCards(true);
    try {
      const saved = await saveMaintenanceSetting(
        'catalog.frequency',
        freqDraft,
        settings['catalog.frequency'].version,
      );
      setSettings({
        ...settings,
        'catalog.frequency': saved as MaintenanceSettingsSnapshot['catalog.frequency'],
      });
      setFreqDraft((saved as MaintenanceSettingsSnapshot['catalog.frequency']).value);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được danh mục tần suất.');
    } finally {
      setSavingCards(false);
    }
  };

  const freqDirty =
    freqDraft !== undefined &&
    JSON.stringify(freqDraft) !== JSON.stringify(settings?.['catalog.frequency'].value);

  /** Mã tần suất đang có lịch dùng — tắt được nhưng không xoá được. */
  const usedFrequencies = useMemo(
    () => new Set((workspace?.schedules ?? []).map((item) => item.frequency)),
    [workspace],
  );

  const storedCards = settings?.['dashboard.cards'].value.cardIds ?? [];
  const cardsDirty =
    cardDraft.length !== storedCards.length ||
    cardDraft.some((id, index) => id !== storedCards[index]);

  // Bộ lọc & Phân trang cho Bảng Phiếu Công Việc Phát Sinh (Occurrences)
  const [occSearch, setOccSearch] = useState('');
  const [occKind, setOccKind] = useState('all');
  const [occPriority, setOccPriority] = useState('all');
  const [occStatus, setOccStatus] = useState('all');
  const [occAsset, setOccAsset] = useState('all');
  const [occPageSize, setOccPageSize] = useState('15');
  const [occCurrentPage, setOccCurrentPage] = useState(1);

  // Danh sách các thiết bị duy nhất có trong occurrences
  const occAssetOptions = useMemo(() => {
    if (!workspace?.occurrences) return [{ value: 'all', label: 'Tất cả thiết bị' }];
    const map = new Map<string, string>();
    for (const occ of workspace.occurrences) {
      if (occ.assetCode && !map.has(occ.assetCode)) {
        map.set(occ.assetCode, occ.assetName ? `${occ.assetCode} - ${occ.assetName}` : occ.assetCode);
      }
    }
    const list = Array.from(map.entries()).map(([value, label]) => ({ value, label }));
    return [{ value: 'all', label: 'Tất cả thiết bị' }, ...list];
  }, [workspace?.occurrences]);

  const filteredOccurrences = useMemo(() => {
    if (!workspace?.occurrences) return [];
    const query = occSearch.trim().toLowerCase();

    return workspace.occurrences.filter((occ) => {
      if (occKind !== 'all' && occ.kind !== occKind) return false;
      if (occPriority !== 'all' && occ.priority !== occPriority) return false;
      if (occStatus !== 'all' && occ.status !== occStatus) return false;
      if (occAsset !== 'all' && occ.assetCode !== occAsset) return false;

      if (!query) return true;

      const codeMatch = occ.code ? occ.code.toLowerCase().includes(query) : false;
      const assetMatch = occ.assetCode ? occ.assetCode.toLowerCase().includes(query) : false;
      const assetNameMatch = occ.assetName ? occ.assetName.toLowerCase().includes(query) : false;
      const titleMatch = occ.title ? occ.title.toLowerCase().includes(query) : false;
      const scheduleMatch = occ.scheduleTitle ? occ.scheduleTitle.toLowerCase().includes(query) : false;
      const procMatch = occ.procedureInstanceCode ? occ.procedureInstanceCode.toLowerCase().includes(query) : false;

      return codeMatch || assetMatch || assetNameMatch || titleMatch || scheduleMatch || procMatch;
    });
  }, [workspace?.occurrences, occSearch, occKind, occPriority, occStatus, occAsset]);

  const occTotalRecords = filteredOccurrences.length;
  const numPageSize = Number(occPageSize) || 15;
  const occTotalPages = Math.max(1, Math.ceil(occTotalRecords / numPageSize));
  const safeOccCurrentPage = Math.min(occCurrentPage, occTotalPages);

  const paginatedOccurrences = useMemo(() => {
    const start = (safeOccCurrentPage - 1) * numPageSize;
    return filteredOccurrences.slice(start, start + numPageSize);
  }, [filteredOccurrences, safeOccCurrentPage, numPageSize]);

  const isOccFilterActive =
    occSearch.trim() !== '' ||
    occKind !== 'all' ||
    occPriority !== 'all' ||
    occStatus !== 'all' ||
    occAsset !== 'all';

  const resetOccFilters = () => {
    setOccSearch('');
    setOccKind('all');
    setOccPriority('all');
    setOccStatus('all');
    setOccAsset('all');
    setOccCurrentPage(1);
  };

  return (
    <ModuleShell<View>
      moduleKey="maintenance"
      title="Bảo trì phòng ngừa"
      subtitle="Lập lịch theo thiết bị và sinh phiếu công việc sang Quy trình. Thiết bị được quản lý trong module Kho & Vật tư."
      nav={NAV}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
      actions={
        <>
          {/* Ai đang đăng nhập: các phân hệ khác đều hiện, thiếu ở đây thì người
              dùng không biết mình đang thao tác dưới danh nghĩa nào. */}
          {workspace ? (
            <span className={styles.actor}>
              <strong>{workspace.actor.name}</strong>
            </span>
          ) : null}
        </>
      }
      banner={
        error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null
      }
    >

      {incidentOpen && workspace && matrix ? (
        <IncidentForm
          assets={matrix.rows}
          catalog={workspace.procedureCatalog}
          members={members}
          busy={busy}
          onCancel={() => setIncidentOpen(false)}
          onSubmit={submitIncident}
        />
      ) : null}

      {!workspace ? (
        <p className={styles.empty}>Đang tải dữ liệu bảo trì…</p>
      ) : (
        <>
          {view === 'dashboard' ? (
            <DashboardView<MaintenanceDashboardData>
              catalog={MAINTENANCE_DASHBOARD_CARDS}
              selection={settings?.['dashboard.cards'].value.cardIds ?? []}
              data={{ workspace, matrix }}
            />
          ) : null}

          {view === 'settings' ? (
            <ModuleSettingsView
              sections={[
                {
                  id: 'dashboard',
                  label: 'Thẻ tổng quan',
                  description:
                    'Chọn những thẻ hiện trên trang Tổng quan và sắp xếp thứ tự hiển thị.',
                  render: () => (
                    <DashboardCardPicker<MaintenanceDashboardData>
                      catalog={MAINTENANCE_DASHBOARD_CARDS}
                      selection={cardDraft}
                      onChange={setCardDraft}
                      max={6}
                      disabled={!canManage || savingCards}
                    />
                  ),
                },
                {
                  id: 'frequencies',
                  label: 'Tần suất bảo trì',
                  description:
                    'Chu kỳ cho lịch bảo trì. Số kỳ và đơn vị quyết định ngày đến hạn kế tiếp; đổi nhãn thì lịch không đổi.',
                  render: () =>
                    freqDraft ? (
                      <FrequencyCatalogEditor
                        value={freqDraft}
                        usedCodes={usedFrequencies}
                        disabled={!canManage || savingCards}
                        onChange={setFreqDraft}
                      />
                    ) : null,
                },
              ]}
              activeSectionId={settingsSection}
              onSectionChange={setSettingsSection}
              readOnly={!canManage}
              dirty={settingsSection === 'frequencies' ? freqDirty : cardsDirty}
              saving={savingCards}
              onSave={settingsSection === 'frequencies' ? saveFrequencies : saveCards}
              onReset={() =>
                settingsSection === 'frequencies'
                  ? setFreqDraft(settings?.['catalog.frequency'].value)
                  : setCardDraft(storedCards)
              }
            />
          ) : null}

      {workspace ? (
        <MinimalPopupForm
          isOpen={creating}
          title="Lịch bảo trì mới"
          subtitle="Thiết lập chu kỳ bảo trì phòng ngừa định kỳ cho thiết bị trong hệ thống."
          onClose={() => {
            setCreating(false);
            setProcedureDefinitionId('');
          }}
        >
          <form onSubmit={submitSchedule}>
            <div className={styles.formGrid}>
              <label className={styles.formGridFull}>
                Thiết bị (từ danh mục Kho)
                <input
                  name="assetCode"
                  required
                  list="schedule-assets"
                  autoComplete="off"
                  placeholder="Gõ để tìm theo mã hoặc tên thiết bị…"
                  value={assetQuery}
                  onChange={(event) => setAssetQuery(event.target.value)}
                />
                {/* Danh mục đã nạp sẵn cho ma trận, không cần gọi thêm API. */}
                <datalist id="schedule-assets">
                  {assetOptions.map((asset) => (
                    <option key={asset.code} value={asset.code}>
                      {asset.name}
                    </option>
                  ))}
                </datalist>
                <span className={styles.fieldHint}>
                  {assetQuery.trim() ? (
                    pickedAsset ? (
                      <strong className={styles.assetOk}>{pickedAsset.name}</strong>
                    ) : (
                      <span className={styles.assetUnknown}>Chưa khớp thiết bị nào trong Kho</span>
                    )
                  ) : (
                    <span>Sẵn sàng tìm kiếm trong {assetOptions.length} thiết bị</span>
                  )}
                </span>
              </label>

              <label className={styles.formGridFull}>
                Quy trình nghiệp vụ áp dụng
                <SearchableSelect
                  name="procedureDefinitionId"
                  options={procedureOptions}
                  value={procedureDefinitionId}
                  placeholder={
                    procedureOptions.length === 0
                      ? '— Không có quy trình —'
                      : 'Gõ mã hoặc tên quy trình để tìm kiếm (tự chọn)…'
                  }
                  emptyText="Không tìm thấy quy trình phù hợp"
                  disabled={busy || procedureOptions.length === 0}
                  clearable
                  onChange={(val) => setProcedureDefinitionId(val)}
                />
              </label>

              <label>
                Tần suất bảo trì
                <select
                  name="frequency"
                  defaultValue={
                    frequencyOptions.some((option) => option.id === 'month')
                      ? 'month'
                      : frequencyOptions[0]?.id
                  }
                >
                  {frequencyOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Mức độ ưu tiên
                <select name="priority" defaultValue="Normal">
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Ngày bắt đầu áp dụng
                <input name="startDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </label>

              <div className={styles.checkboxField}>
                <span className={styles.fieldLabel}>Trạng thái kích hoạt</span>
                <label className={styles.checkboxCard}>
                  <input name="activate" type="checkbox" defaultChecked />
                  <span>Kích hoạt và theo dõi lịch ngay</span>
                </label>
              </div>
            </div>
            <div className={styles.formActions}>
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                onClick={() => setCreating(false)}
              >
                Huỷ
              </button>
              <button type="submit" className={`${styles.action} ${styles.actionPrimary}`} disabled={busy}>
                {busy ? 'Đang lưu…' : 'Lưu lịch bảo trì'}
              </button>
            </div>
          </form>
        </MinimalPopupForm>
      ) : null}

          {view === 'matrix' && matrix ? (
            <div className={taskAsset ? styles.matrixWithPanel : undefined}>
            <MaintenanceMatrixBoard
              matrix={matrix}
              frequencies={frequencyOptions}
              onAddAsset={addAssetToMatrix}
              onRemoveAsset={removeAsset}
              onRunNow={runNow}
              onOpenHistory={(assetCode) => {
                // Đặt bộ lọc TRƯỚC khi đổi màn: effect nạp lịch sử chạy theo
                // `view`, đổi màn trước thì nó nạp một lượt không lọc rồi lượt
                // thứ hai mới đúng — người dùng thấy danh sách nhảy.
                setHistoryFilter({ assetCode });
                navigate('history');
              }}
              canManage={canManage}
              busy={busy}
              unitNames={unitNames}
              onSave={saveMatrix}
              // Xem tại chỗ; hồ sơ thiết bị vẫn thuộc Kho, Bảo trì chỉ đọc.
              onEditTasks={setTaskAsset}
            />
            {taskAsset ? (
              <AssetTaskPanel assetCode={taskAsset} onClose={() => setTaskAsset(undefined)} />
            ) : null}
            </div>
          ) : null}

          {view === 'history' ? (
            <MaintenanceHistory
              performers={performers}
              page={history}
              filter={historyFilter}
              busy={busy}
              canManage={canManage}
              selected={selectedOccurrence}
              onFilter={setHistoryFilter}
              onLoadMore={() => void loadHistory({ ...historyFilter, cursor: history?.nextCursor }, true)}
              onSelect={setSelectedOccurrence}
              onComplete={closeOut}
            />
          ) : null}

          {view === 'schedules' ? (
            <MaintenanceSchedulesTable
              schedules={workspace.schedules}
              canManage={canManage}
              busy={busy}
              frequencyLabel={frequencyLabel}
              onToggle={(id, nextStatus) => void toggleSchedule(id, nextStatus)}
              onSkipOnce={(id) => void skipOnce(id)}
              onCreateSchedule={() => setCreating(true)}
            />
          ) : null}

          {view === 'occurrences' ? (
            <section className={styles.occCard}>
              {/* Tiêu đề & Hành động */}
              <div className={styles.occHeader}>
                <div>
                  <h2>Phiếu công việc phát sinh</h2>
                  <p>
                    Theo dõi danh sách các sự cố đột xuất và phiếu bảo trì phát sinh ngoài kế hoạch định kỳ.
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className={`${styles.action} ${styles.actionIncident}`}
                    onClick={() => setIncidentOpen(true)}
                    disabled={busy}
                  >
                    Tạo sự cố
                  </button>
                ) : null}
              </div>

              {/* VÙNG 1: BỘ LỌC TỨC THÌ (SEARCH + SEARCHABLE SELECTS + RESET) */}
              <div className={styles.occControlsBar}>
                <div className={styles.occControlsLeft}>
                  {/* Tìm kiếm tức thời */}
                  <div className={styles.occSearchBox}>
                    <span className={styles.occSearchIcon}>
                      <Search size={15} />
                    </span>
                    <input
                      type="search"
                      placeholder="Tìm mã sự cố, thiết bị, tiêu đề, quy trình…"
                      value={occSearch}
                      aria-label="Tìm kiếm phiếu phát sinh"
                      onChange={(e) => {
                        setOccSearch(e.target.value);
                        setOccCurrentPage(1);
                      }}
                    />
                  </div>

                  {/* Lọc theo Nguồn / Phân loại */}
                  <div className={styles.occFilterSelectWrapper}>
                    <SearchableSelect
                      options={OCC_KIND_OPTIONS}
                      value={occKind}
                      placeholder="Loại phát sinh…"
                      clearable={false}
                      onChange={(val) => {
                        setOccKind(val || 'all');
                        setOccCurrentPage(1);
                      }}
                    />
                  </div>

                  {/* Lọc theo Mức ưu tiên */}
                  <div className={styles.occFilterSelectWrapper}>
                    <SearchableSelect
                      options={OCC_PRIORITY_OPTIONS}
                      value={occPriority}
                      placeholder="Mức ưu tiên…"
                      clearable={false}
                      onChange={(val) => {
                        setOccPriority(val || 'all');
                        setOccCurrentPage(1);
                      }}
                    />
                  </div>

                  {/* Lọc theo Trạng thái */}
                  <div className={styles.occFilterSelectWrapper}>
                    <SearchableSelect
                      options={OCC_STATUS_OPTIONS}
                      value={occStatus}
                      placeholder="Trạng thái…"
                      clearable={false}
                      onChange={(val) => {
                        setOccStatus(val || 'all');
                        setOccCurrentPage(1);
                      }}
                    />
                  </div>

                  {/* Lọc theo Thiết bị */}
                  <div className={styles.occFilterSelectWrapper}>
                    <SearchableSelect
                      options={occAssetOptions}
                      value={occAsset}
                      placeholder="Thiết bị…"
                      clearable={false}
                      onChange={(val) => {
                        setOccAsset(val || 'all');
                        setOccCurrentPage(1);
                      }}
                    />
                  </div>

                  {/* Nút Xoá bộ lọc khi có điều kiện active */}
                  {isOccFilterActive ? (
                    <button
                      type="button"
                      className={styles.occResetBtn}
                      title="Đặt lại toàn bộ bộ lọc"
                      onClick={resetOccFilters}
                    >
                      <RotateCcw size={13} />
                      <span>Xoá bộ lọc</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {/* VÙNG 2: THÂN BẢNG DỮ LIỆU */}
              <div className={styles.occTableWrap}>
                <table className={styles.occTable}>
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Lịch / Nguồn phát sinh</th>
                      <th style={{ width: '14%' }}>Thiết bị</th>
                      <th style={{ width: '15%' }}>Đến hạn</th>
                      <th style={{ width: '11%' }}>Ưu tiên</th>
                      <th style={{ width: '16%' }}>Trạng thái</th>
                      <th style={{ width: '16%' }}>Hồ sơ quy trình</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOccurrences.map((occurrence) => {
                      const isIncident = occurrence.kind === 'incident';
                      return (
                        <tr key={occurrence.id}>
                          <td>
                            <div>
                              <span
                                className={`${styles.occKindBadge} ${
                                  isIncident ? styles.occKindIncident : styles.occKindPreventive
                                }`}
                              >
                                {isIncident ? 'Sự cố' : 'Định kỳ'}
                              </span>
                              <strong>
                                {occurrence.scheduleTitle ||
                                  occurrence.title ||
                                  (isIncident ? 'Sự cố đột xuất' : 'Phiếu bảo trì')}
                              </strong>
                            </div>
                            {isIncident && occurrence.code ? (
                              <span className={styles.sub} style={{ marginTop: '3px' }}>
                                [{occurrence.code}] {occurrence.title !== occurrence.scheduleTitle ? occurrence.title : ''}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <span className={styles.occAssetBadge}>{occurrence.assetCode}</span>
                            {occurrence.assetName ? (
                              <span className={styles.sub} style={{ marginTop: '2px' }}>
                                {occurrence.assetName}
                              </span>
                            ) : null}
                          </td>
                          <td>{formatDateTime(occurrence.dueAt)}</td>
                          <td>
                            <span
                              className={`${styles.occPriorityPill} ${
                                occurrence.priority === 'High'
                                  ? styles.occPrioHigh
                                  : occurrence.priority === 'Normal'
                                  ? styles.occPrioNormal
                                  : styles.occPrioLow
                              }`}
                            >
                              {PRIORITY_LABEL[occurrence.priority] ?? occurrence.priority}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`${styles.occStatusBadge} ${
                                styles[`occStatus_${occurrence.status}`] ?? ''
                              }`}
                            >
                              ● {OCCURRENCE_STATUS_LABELS[occurrence.status] ?? occurrence.status}
                            </span>
                            {occurrence.failureReason && !/^Procedure API trả về \d+\.$/.test(occurrence.failureReason) ? (
                              <span className={styles.sub} style={{ color: '#dc2626', marginTop: '2px' }}>
                                {occurrence.failureReason}
                              </span>
                            ) : null}
                          </td>
                          <td className={styles.code}>
                            {occurrence.procedureInstanceCode ? (
                              <strong>{occurrence.procedureInstanceCode}</strong>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {paginatedOccurrences.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={styles.occEmpty}>
                          {isOccFilterActive
                            ? 'Không tìm thấy phiếu phát sinh nào khớp với bộ lọc hiện tại.'
                            : 'Chưa có phiếu công việc phát sinh.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* VÙNG 3: FOOTER CHÂN BẢNG & PHÂN TRANG */}
              <div className={styles.occFooterBar}>
                <div className={styles.occFooterLeft}>
                  <span className={styles.occTotalRecords}>
                    Hiển thị{' '}
                    <strong>
                      {occTotalRecords > 0 ? (safeOccCurrentPage - 1) * numPageSize + 1 : 0}–
                      {Math.min(safeOccCurrentPage * numPageSize, occTotalRecords)}
                    </strong>{' '}
                    / <strong>{occTotalRecords}</strong> phiếu
                  </span>
                  <label className={styles.occPageSizeLabel}>
                    <span>Hiển thị:</span>
                    <div className={styles.occPageSizeSelect}>
                      <SearchableSelect
                        options={OCC_PAGE_SIZE_OPTIONS}
                        value={occPageSize}
                        clearable={false}
                        onChange={(val) => {
                          setOccPageSize(val || '15');
                          setOccCurrentPage(1);
                        }}
                      />
                    </div>
                  </label>
                </div>

                <div className={styles.occFooterRight}>
                  <div className={styles.occPaginationGroup}>
                    <button
                      type="button"
                      className={styles.occPageBtn}
                      disabled={safeOccCurrentPage <= 1}
                      onClick={() => setOccCurrentPage((p) => Math.max(1, p - 1))}
                      title="Trang trước"
                    >
                      ← Trước
                    </button>
                    <span className={styles.occPageIndicator}>
                      {safeOccCurrentPage} / {occTotalPages}
                    </span>
                    <button
                      type="button"
                      className={styles.occPageBtn}
                      disabled={safeOccCurrentPage >= occTotalPages}
                      onClick={() => setOccCurrentPage((p) => Math.min(occTotalPages, p + 1))}
                      title="Trang sau"
                    >
                      Sau →
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
    </ModuleShell>
  );
}
