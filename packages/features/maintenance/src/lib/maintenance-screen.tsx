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
import { MAINTENANCE_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-maintenance';
import {
  ModuleSettingsView,
  ModuleShell,
  useAssistantSaved,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import {
  MinimalPopupForm,
  SearchableSelect,
  formatDateTime as formatSharedDateTime,
} from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { CalendarPlus, ListFilter, Plus, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { TablePagerBar } from './ui/table-pager-bar';
import { cn } from './utils';
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
  loadMaintenanceOccurrence,
  loadOrganizationUnitNames,
  loadMaintenanceSettings,
  loadMyDashboardCards,
  loadTenantHomePath,
  removeAssetFromMatrix,
  runMaintenanceNow,
  saveMaintenanceMatrix,
  loadPerformersByInstanceCode,
  saveMaintenanceSetting,
  retryMaintenanceDispatch,
  saveMyDashboardCards,
  skipNextOccurrence,
  updateMaintenanceSchedule,
  uploadOccurrenceAttachment,
} from './maintenance-api';
import {
  MAINTENANCE_DASHBOARD_CARDS,
  MaintenanceDashboardGrid,
  pickDashboardCards,
  type MaintenanceDashboardActions,
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
import { SELECT_CLASS } from './ui/select-class';
import { Tip } from './ui/tooltip';
import { useFillViewportHeight } from './ui/use-fill-viewport';
import { MaintenanceCardPicker } from './maintenance-card-picker';
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
const INCIDENT_ACTION_KEYS = [MAINTENANCE_ASSISTANT_ACTIONS.createIncident.key];

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

/** Màu chữ + chấm của trạng thái phiếu phát sinh. */
const OCC_STATUS_TEXT: Record<string, string> = {
  completed: 'text-green-800',
  in_progress: 'text-blue-600',
  planned: 'text-slate-600',
  dispatch_pending: 'text-amber-600',
  failed: 'text-red-600',
  blocked: 'text-purple-600',
  generated: 'text-sky-600',
};

const OCC_PAGE_SIZES = [15, 30, 45, 60];

/** Lớp dùng chung cho các ô trong form "Lịch bảo trì mới". */
const SCHEDULE_FIELD = 'flex flex-col gap-1.5';
const SCHEDULE_LABEL = 'text-sm font-semibold text-slate-700';

/** Số yêu cầu chạy cùng lúc khi xử lý hàng loạt: đủ nhanh mà không dồn dập lên máy chủ. */
const BATCH_CONCURRENCY = 4;

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return formatSharedDateTime(value, '—');
}

export function MaintenanceScreen() {
  const { view, sub, navigate: navigateRaw } = useHashView<View>({ views: VIEW_IDS, fallback: 'dashboard' });
  // Ma trận còn thay đổi chưa lưu: hỏi trước khi rời màn, vì chuyển màn tháo luôn ma trận và mất bản nháp.
  const matrixDirtyRef = useRef(false);
  const onMatrixDirtyChange = useCallback((dirty: boolean) => {
    matrixDirtyRef.current = dirty;
  }, []);
  const navigate = useCallback(
    (next: View, nextSub?: string) => {
      if (
        matrixDirtyRef.current &&
        next !== 'matrix' &&
        !window.confirm('Ma trận còn thay đổi chưa lưu. Rời khỏi màn này sẽ mất các thay đổi đó. Tiếp tục?')
      ) {
        return;
      }
      navigateRaw(next, nextSub);
    },
    [navigateRaw],
  );
  const [matrix, setMatrix] = useState<MaintenanceMatrix>();
  const [unitNames, setUnitNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [workspace, setWorkspace] = useState<MaintenanceWorkspace>();
  const [error, setError] = useState<string>();
  // Lỗi của thao tác ở màn trước không còn ý nghĩa sau khi chuyển màn (hộp thoại ngoài banner tự hiện lỗi của riêng nó).
  useEffect(() => {
    setError(undefined);
  }, [view]);
  // Banner lỗi nằm đầu vùng cuộn: lỗi do nút ở giữa trang (đóng phiếu, thử lại) sẽ nằm ngoài tầm nhìn nếu không cuộn tới.
  useEffect(() => {
    if (!error) return;
    document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scheduleStartDate, setScheduleStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [assetQuery, setAssetQuery] = useState('');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState<MaintenanceFrequency>('month');
  const [schedulePriority, setSchedulePriority] = useState<MaintenancePriority>('Normal');
  const [scheduleActivate, setScheduleActivate] = useState(true);
  const [taskAsset, setTaskAsset] = useState<string>();
  const [homePath, setHomePath] = useState('/');
  const [history, setHistory] = useState<MaintenanceHistoryPage>();
  const [historyFilter, setHistoryFilter] = useState<MaintenanceHistoryFilter>({});
  const [selectedOccurrence, setSelectedOccurrence] = useState<MaintenanceOccurrence>();
  useEffect(() => {
    if (view !== 'history' || !sub) return;
    let active = true;
    void loadMaintenanceOccurrence(sub).then((occurrence) => {
      if (active) setSelectedOccurrence(occurrence);
    }).catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [view, sub]);
  const [members, setMembers] = useState<readonly { userId: string; displayName: string }[]>([]);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [performers, setPerformers] = useState<ReadonlyMap<string, string[]>>(new Map());
  const [settings, setSettings] = useState<MaintenanceSettingsSnapshot>();
  /** Thẻ Tổng quan của riêng người dùng; null là chưa tuỳ chỉnh (dùng mặc định), undefined là đang tải. */
  const [myCards, setMyCards] = useState<readonly string[] | null>();
  const [savingMyCards, setSavingMyCards] = useState(false);
  const [freqDraft, setFreqDraft] = useState<MaintenanceFrequencyCatalog>();
  const [settingsSection, setSettingsSection] = useState('frequencies');
  const [savingSettings, setSavingSettings] = useState(false);

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
    // Lỗi nạp thẻ cá nhân không chặn màn hình: coi như chưa tuỳ chỉnh, dùng thẻ mặc định.
    void loadMyDashboardCards()
      .then((mine) => setMyCards(mine.cardIds))
      .catch(() => setMyCards(null));
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
  const assetSelectOptions = useMemo(
    () => assetOptions.map((asset) => ({ value: asset.code, label: `${asset.code} - ${asset.name}` })),
    [assetOptions],
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

  /** Đóng form tạo lịch và đưa mọi ô về mặc định cho lần mở sau. */
  const closeScheduleForm = () => {
    setCreating(false);
    setAssetQuery('');
    setProcedureDefinitionId('');
    setScheduleFrequency('month');
    setSchedulePriority('Normal');
    setScheduleActivate(true);
    setScheduleStartDate(new Date().toISOString().slice(0, 10));
  };

  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pickedAsset) {
      setError(assetQuery.trim() ? `Không có thiết bị nào mã “${assetQuery.trim()}” trong Kho.` : 'Vui lòng chọn thiết bị.');
      return;
    }
    if (!scheduleStartDate) {
      setError('Vui lòng chọn ngày bắt đầu áp dụng.');
      return;
    }
    setBusy(true);
    try {
      await createMaintenanceSchedule({
        assetCode: pickedAsset.code,
        procedureDefinitionId: procedureDefinitionId || undefined,
        frequency: effectiveFrequency,
        priority: schedulePriority,
        startDate: scheduleStartDate,
        activate: scheduleActivate,
      });
      closeScheduleForm();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được lịch bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Chạy một thao tác cho cả lô mục đã chọn. API chưa có đường gộp nên gọi từng mục, nhưng:
   *  - tối đa ${BATCH_CONCURRENCY} yêu cầu cùng lúc (các mục độc lập nhau, không cần chờ lần lượt);
   *  - nạp lại workspace + ma trận ĐÚNG MỘT lần sau cả lô, thay vì một lần cho mỗi mục;
   *  - gom lỗi thành một thông báo, mục lỗi không chặn các mục còn lại.
   */
  const runBatch = async <T,>(
    items: readonly string[],
    task: (item: string) => Promise<T>,
    failure: string,
  ): Promise<{ done: { item: string; value: T }[]; failed: string[] }> => {
    setBusy(true);
    const done: { item: string; value: T }[] = [];
    const failed: string[] = [];
    let firstMessage: string | undefined;
    try {
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const item = items[next++];
          try {
            done.push({ item, value: await task(item) });
          } catch (cause) {
            failed.push(item);
            firstMessage ??= cause instanceof Error ? cause.message : undefined;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, items.length) }, worker));
      await reload();
      setError(
        failed.length > 0
          ? `${failure} (${failed.length}/${items.length} mục lỗi: ${failed.join(', ')})${firstMessage ? ` — ${firstMessage}` : ''}`
          : undefined,
      );
    } finally {
      setBusy(false);
    }
    return { done, failed };
  };

  const skipOnce = async (ids: readonly string[]) => {
    // Hạn mới hiện ngay ở cột "Đến hạn" sau khi nạp lại, nên không cần thông báo thêm.
    await runBatch(ids, (id) => skipNextOccurrence(id), 'Không bỏ qua được kỳ bảo trì');
  };

  const toggleSchedule = async (ids: readonly string[], status: 'active' | 'paused') => {
    await runBatch(ids, (id) => updateMaintenanceSchedule(id, { status }), 'Không cập nhật được lịch');
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

  const removeAsset = async (assetCodes: readonly string[]) => {
    await runBatch(assetCodes, (code) => removeAssetFromMatrix(code), 'Không gỡ được thiết bị khỏi ma trận');
  };

  const runNow = async (assetCodes: readonly string[]) => {
    const { done, failed } = await runBatch(
      assetCodes,
      (code) => runMaintenanceNow(code),
      'Không tạo được phiếu bảo trì',
    );
    const empty = done.filter((entry) => entry.value.generated === 0).map((entry) => entry.item);
    // Lỗi API đã được runBatch báo; ở đây chỉ bổ sung các thiết bị gọi được nhưng không sinh ra phiếu nào.
    if (empty.length > 0 && failed.length === 0) {
      setError(`Chưa sinh được phiếu cho ${empty.join(', ')}; kiểm tra lại chu kỳ đang bật.`);
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

  // Card Trợ lý vừa tạo phiếu sự cố: tải lại như khi tự tạo, kể cả Lịch sử nếu đang xem, giữ nguyên bộ lọc.
  useAssistantSaved(INCIDENT_ACTION_KEYS, () => {
    void reload();
    if (view === 'history') void loadHistory(historyFilter);
  });

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

  /** Thử lại phiếu báo lỗi gửi Quy trình; `onDone` cho từng nơi gọi tự cập nhật phần của mình. */
  const retryDispatch = async (id: string) => {
    setBusy(true);
    // Xoá lỗi cũ trước: cùng một lỗi lặp lại phải đổi state thì banner mới cuộn lại vào tầm nhìn.
    setError(undefined);
    try {
      const saved = await retryMaintenanceDispatch(id);
      setSelectedOccurrence((current) => (current?.id === id ? saved : current));
      await Promise.all([reload(), loadHistory(historyFilter)]);
      // Đặt sau khi nạp lại (reload xoá lỗi). Gửi lại mà Quy trình vẫn từ chối thì nói rõ lý do, nếu không bấm xong
      // trông như không có chuyện gì xảy ra.
      setError(
        saved.status === 'failed'
          ? `Vẫn chưa tạo được phiếu bên Quy trình. ${saved.failureReason ?? ''}`.trim()
          : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không gửi lại được phiếu.');
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const canManage = workspace?.permissions.canManageSchedules ?? false;

  /** Đổi thẻ Tổng quan: áp dụng ngay trên giao diện rồi lưu; lỗi thì trả về bản cũ. */
  const changeMyCards = async (next: readonly string[] | null) => {
    const previous = myCards;
    setMyCards(next);
    setSavingMyCards(true);
    try {
      const saved = await saveMyDashboardCards(next);
      setMyCards(saved.cardIds);
      setError(undefined);
    } catch (cause) {
      setMyCards(previous);
      setError(cause instanceof Error ? cause.message : 'Không lưu được thẻ Tổng quan.');
    } finally {
      setSavingMyCards(false);
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

  /** Tần suất đang chọn nếu còn trong danh mục; không thì lấy mục đầu tiên (danh mục đổi trong Cài đặt). */
  const effectiveFrequency: MaintenanceFrequency = frequencyOptions.some((option) => option.id === scheduleFrequency)
    ? scheduleFrequency
    : (frequencyOptions[0]?.id ?? 'month');

  const frequencyLabel = (code: string) =>
    frequencyOptions.find((option) => option.id === code)?.label ??
    FALLBACK_FREQUENCY_LABEL[code] ??
    code;

  const saveFrequencies = async () => {
    if (!settings || !freqDraft) return;
    setSavingSettings(true);
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
      setSavingSettings(false);
    }
  };

  const freqDirty =
    freqDraft !== undefined &&
    JSON.stringify(freqDraft) !== JSON.stringify(settings?.['catalog.frequency'].value);

  /**
   * Thẻ Tổng quan đang hiển thị: lựa chọn của người dùng; chưa tuỳ chỉnh (null) thì lưới dùng thẻ mặc định của catalog.
   * Cấu hình `dashboard.cards` cũ của tenant không còn được đọc: màn chỉnh của admin đã bỏ, và các id trong đó có thể
   * đã không còn trong catalog (cũ bị gỡ), nên giữ lại chỉ làm Tổng quan thiếu thẻ.
   */
  const effectiveCards: readonly string[] | null = myCards ?? null;
  /** Danh sách tích sẵn trong bảng Tuỳ chỉnh: đúng những thẻ đang hiện, kể cả khi đó là mặc định. */
  const dashboardSelection = useMemo(
    () => pickDashboardCards(effectiveCards).map((card) => card.id),
    [effectiveCards],
  );

  /** Mã tần suất đang có lịch dùng — tắt được nhưng không xoá được. */
  const usedFrequencies = useMemo(
    () => new Set((workspace?.schedules ?? []).map((item) => item.frequency)),
    [workspace],
  );

  // Bộ lọc & Phân trang cho Bảng Phiếu Công Việc Phát Sinh (Occurrences)
  // Khung Phiếu phát sinh chiếm đúng phần cao còn lại của màn hình; đo lại khi chuyển tab hoặc khi dữ liệu tải xong (khung chỉ hiện sau đó).
  const occSectionRef = useRef<HTMLDivElement>(null);
  useFillViewportHeight(occSectionRef, 360, `${view}:${workspace ? 'ready' : 'loading'}`, 16);
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

  const occFilterCount = [occKind, occPriority, occStatus, occAsset].filter((value) => value !== 'all').length;
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

  /** Việc thẻ Tổng quan làm được: mở phiếu, mở danh sách đã lọc sẵn, đóng phiếu tại chỗ. */
  const dashboardActions: MaintenanceDashboardActions = {
    openOccurrence: (id) => navigate('history', id),
    openOccurrences: (kind) => {
      resetOccFilters();
      if (kind) setOccKind(kind);
      navigate('occurrences');
    },
    openHistoryByStatus: (status) => {
      setHistoryFilter({ status });
      navigate('history');
    },
    retryDispatch,
    completeOccurrence: async (id, note) => {
      setError(undefined);
      try {
        await completeMaintenanceOccurrence(id, note);
        setError(undefined);
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không đánh dấu hoàn thành được.');
        throw cause;
      }
    },
  };

  return (
    <ModuleShell<View>
      moduleKey="maintenance"
      appearance="light"
      title="Bảo trì phòng ngừa"
      subtitle="Lập lịch theo thiết bị và sinh phiếu công việc sang Quy trình. Thiết bị được quản lý trong module Kho & Vật tư."
      nav={NAV}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
      // Ai đang đăng nhập: khung sáng hiện tên này ở khối người dùng trên thanh
      // bên, như các phân hệ khác.
      actor={workspace?.actor.name}
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
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">Tổng quan</h2>
                  <p className="m-0 text-sm text-muted-foreground">
                    Việc cần xử lý hôm nay. Bấm Tuỳ chỉnh để chọn thẻ theo cách bạn làm việc; chỉ áp dụng cho tài khoản của bạn.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {workspace.permissions.canManageOccurrences ? (
                    <Button
                      type="button"
                      size="lg"
                      className="gap-1.5 rounded-md px-3"
                      onClick={() => setIncidentOpen(true)}
                    >
                      <Plus />
                      Ghi nhận sự cố
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="gap-1.5 rounded-md px-3"
                      onClick={() => setCreating(true)}
                    >
                      <CalendarPlus />
                      Tạo lịch bảo trì
                    </Button>
                  ) : null}
                  {myCards !== null && myCards !== undefined ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="rounded-md px-3"
                      disabled={savingMyCards}
                      onClick={() => void changeMyCards(null)}
                    >
                      <RotateCcw />
                      Đặt lại mặc định
                    </Button>
                  ) : null}
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          size="lg"
                          className="gap-1.5 rounded-md px-3"
                          aria-label="Tuỳ chỉnh thẻ Tổng quan"
                          disabled={myCards === undefined}
                        />
                      }
                    >
                      <SlidersHorizontal />
                      Tuỳ chỉnh
                      <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                        {dashboardSelection.length}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="max-h-[70vh] w-[26rem] overflow-y-auto">
                      <p className="m-0 mb-3 text-[0.8125rem] text-muted-foreground">
                        Tích để hiện thẻ, dùng mũi tên để đổi thứ tự. Thay đổi được lưu ngay.
                      </p>
                      <MaintenanceCardPicker<MaintenanceDashboardData>
                        catalog={MAINTENANCE_DASHBOARD_CARDS}
                        selection={dashboardSelection}
                        onChange={(next) => void changeMyCards(next)}
                        disabled={savingMyCards}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {myCards === undefined ? null : (
                <MaintenanceDashboardGrid
                  selection={effectiveCards}
                  data={{
                    workspace,
                    matrix,
                    canHandle: workspace.permissions.canManageOccurrences,
                    actions: dashboardActions,
                  }}
                />
              )}
            </div>
          ) : null}

          {view === 'settings' ? (
            <ModuleSettingsView
              sections={[
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
                        disabled={!canManage || savingSettings}
                        onChange={setFreqDraft}
                      />
                    ) : null,
                },
              ]}
              activeSectionId={settingsSection}
              onSectionChange={setSettingsSection}
              readOnly={!canManage}
              dirty={freqDirty}
              saving={savingSettings}
              onSave={saveFrequencies}
              onReset={() => setFreqDraft(settings?.['catalog.frequency'].value)}
            />
          ) : null}

      {workspace ? (
        <MinimalPopupForm
          isOpen={creating}
          title="Lịch bảo trì mới"
          subtitle="Thiết lập chu kỳ bảo trì phòng ngừa định kỳ cho thiết bị trong hệ thống."
          maxWidth="680px"
          // Kích thước cố định; màn thấp hơn thì popup co theo chiều cao màn hình, phần dư cuộn dọc trong form.
          popupClassName="h-[640px]"
          onClose={closeScheduleForm}
        >
          <form onSubmit={submitSchedule} noValidate className="flex min-h-0 flex-1 flex-col pt-2">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-2 pr-1.5">
              <div className={SCHEDULE_FIELD}>
                <span className={SCHEDULE_LABEL}>Thiết bị (từ danh mục Kho) *</span>
                {/* Danh mục đã nạp sẵn cho ma trận, không cần gọi thêm API. */}
                <SearchableSelect
                  className={SELECT_CLASS}
                  height={36}
                  options={assetSelectOptions}
                  value={assetQuery}
                  placeholder="Gõ để tìm theo mã hoặc tên thiết bị…"
                  emptyText="Không tìm thấy thiết bị phù hợp"
                  disabled={busy}
                  clearable
                  onChange={(val) => setAssetQuery(val)}
                />
                <span className="text-[0.8125rem] text-muted-foreground">
                  {pickedAsset ? (
                    <strong className="font-semibold text-emerald-700">{pickedAsset.name}</strong>
                  ) : (
                    <>Sẵn sàng tìm kiếm trong {assetOptions.length} thiết bị</>
                  )}
                </span>
              </div>

              <div className={SCHEDULE_FIELD}>
                <span className={SCHEDULE_LABEL}>Quy trình nghiệp vụ áp dụng</span>
                <SearchableSelect
                  className={SELECT_CLASS}
                  height={36}
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
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={SCHEDULE_FIELD}>
                  <span className={SCHEDULE_LABEL}>Tần suất bảo trì</span>
                  <SearchableSelect
                    className={SELECT_CLASS}
                    height={36}
                    searchInDropdown
                    hideDropdownSearch
                    clearable={false}
                    options={frequencyOptions.map((option) => ({ value: option.id, label: option.label }))}
                    value={effectiveFrequency}
                    disabled={busy}
                    onChange={(val) => val && setScheduleFrequency(val as MaintenanceFrequency)}
                  />
                </div>
                <div className={SCHEDULE_FIELD}>
                  <span className={SCHEDULE_LABEL}>Mức độ ưu tiên</span>
                  <SearchableSelect
                    className={SELECT_CLASS}
                    height={36}
                    searchInDropdown
                    hideDropdownSearch
                    clearable={false}
                    options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
                    value={schedulePriority}
                    disabled={busy}
                    onChange={(val) => val && setSchedulePriority(val as MaintenancePriority)}
                  />
                </div>
                <div className={SCHEDULE_FIELD}>
                  <span className={SCHEDULE_LABEL}>Ngày bắt đầu áp dụng</span>
                  <DatePickerInput value={scheduleStartDate} onChange={setScheduleStartDate} height={36} />
                </div>
                <div className={SCHEDULE_FIELD}>
                  <span className={SCHEDULE_LABEL}>Trạng thái kích hoạt</span>
                  <label className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900">
                    <Checkbox
                      checked={scheduleActivate}
                      disabled={busy}
                      onCheckedChange={(checked) => setScheduleActivate(Boolean(checked))}
                    />
                    <span>Kích hoạt và theo dõi lịch ngay</span>
                  </label>
                </div>
              </div>

              {error ? (
                <p role="alert" className="m-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-2 flex shrink-0 justify-end gap-3 border-t border-border pt-4">
              <Button type="button" variant="outline" size="lg" className="rounded-md px-4" onClick={closeScheduleForm}>
                Huỷ
              </Button>
              <Button
                type="submit"
                size="lg"
                className="rounded-md bg-blue-600 px-5 font-bold text-white hover:bg-blue-700"
                disabled={busy}
              >
                {busy ? 'Đang lưu…' : 'Lưu lịch bảo trì'}
              </Button>
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
              onDirtyChange={onMatrixDirtyChange}
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
              canManage={workspace.permissions.canManageOccurrences}
              selected={selectedOccurrence}
              onFilter={setHistoryFilter}
              onLoadMore={() => void loadHistory({ ...historyFilter, cursor: history?.nextCursor }, true)}
              onSelect={setSelectedOccurrence}
              onComplete={closeOut}
              onRetryDispatch={(id) => void retryDispatch(id).catch(() => undefined)}
            />
          ) : null}

          {view === 'schedules' ? (
            <MaintenanceSchedulesTable
              schedules={workspace.schedules}
              canManage={canManage}
              busy={busy}
              frequencyLabel={frequencyLabel}
              onToggle={(ids, nextStatus) => toggleSchedule(ids, nextStatus)}
              onSkipOnce={(ids) => skipOnce(ids)}
              onCreateSchedule={() => setCreating(true)}
            />
          ) : null}

          {view === 'occurrences' ? (
            <section className="flex min-h-0 flex-col gap-4">
              {/* Tiêu đề & hành động: nằm ngoài thẻ bảng, cùng kiểu các trang khác */}
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="m-0 mb-1 text-xl font-bold tracking-tight text-foreground">
                    Phiếu công việc phát sinh
                  </h2>
                  <p className="m-0 text-sm leading-snug text-muted-foreground">
                    Theo dõi danh sách các sự cố đột xuất và phiếu bảo trì phát sinh ngoài kế hoạch định kỳ.
                  </p>
                </div>
                {workspace.permissions.canManageOccurrences ? (
                  <Button
                    type="button"
                    size="lg"
                    className="rounded-md border-red-600 bg-red-600 px-4 text-white hover:bg-red-700"
                    onClick={() => setIncidentOpen(true)}
                    disabled={busy}
                  >
                    Tạo sự cố
                  </Button>
                ) : null}
              </header>

              {/* Thẻ bảng duy nhất: thanh công cụ, bảng, chân phân trang */}
              <div
                ref={occSectionRef}
                className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="relative min-w-[180px] max-w-[320px] flex-1 basis-60">
                    <Search
                      size={15}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      type="search"
                      className="h-9 rounded-md pl-8 text-sm"
                      placeholder="Tìm mã sự cố, thiết bị, tiêu đề, quy trình…"
                      value={occSearch}
                      aria-label="Tìm kiếm phiếu phát sinh"
                      onChange={(e) => {
                        setOccSearch(e.target.value);
                        setOccCurrentPage(1);
                      }}
                    />
                  </div>

                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button variant="outline" size="lg" className="gap-1.5 rounded-md px-3" aria-label="Bộ lọc" />
                      }
                    >
                      <ListFilter />
                      Bộ lọc
                      {occFilterCount > 0 ? (
                        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                          {occFilterCount}
                        </span>
                      ) : null}
                    </PopoverTrigger>
                    <PopoverContent className="w-72">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-semibold text-slate-700">Loại phát sinh</span>
                          <SearchableSelect
                            className={SELECT_CLASS}
                            options={OCC_KIND_OPTIONS}
                            value={occKind}
                            height={36}
                            searchInDropdown
                            hideDropdownSearch
                            clearable={false}
                            onChange={(val) => {
                              setOccKind(val || 'all');
                              setOccCurrentPage(1);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-semibold text-slate-700">Mức ưu tiên</span>
                          <SearchableSelect
                            className={SELECT_CLASS}
                            options={OCC_PRIORITY_OPTIONS}
                            value={occPriority}
                            height={36}
                            searchInDropdown
                            hideDropdownSearch
                            clearable={false}
                            onChange={(val) => {
                              setOccPriority(val || 'all');
                              setOccCurrentPage(1);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-semibold text-slate-700">Trạng thái</span>
                          <SearchableSelect
                            className={SELECT_CLASS}
                            options={OCC_STATUS_OPTIONS}
                            value={occStatus}
                            height={36}
                            searchInDropdown
                            hideDropdownSearch
                            clearable={false}
                            onChange={(val) => {
                              setOccStatus(val || 'all');
                              setOccCurrentPage(1);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-semibold text-slate-700">Thiết bị</span>
                          <SearchableSelect
                            className={SELECT_CLASS}
                            options={occAssetOptions}
                            value={occAsset}
                            height={36}
                            searchInDropdown
                            clearable={false}
                            onChange={(val) => {
                              setOccAsset(val || 'all');
                              setOccCurrentPage(1);
                            }}
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {isOccFilterActive ? (
                    <Tip content="Đặt lại toàn bộ bộ lọc">
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="gap-1.5 rounded-md px-3"
                        onClick={resetOccFilters}
                      >
                        <RotateCcw size={13} />
                        <span>Xoá bộ lọc</span>
                      </Button>
                    </Tip>
                  ) : null}
                </div>

              {/* Bảng: chiếm hết chiều cao còn lại của thẻ, quá dài thì chỉ cuộn trong bảng; tiêu đề cột đứng yên */}
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-slate-300 [&>th]:bg-[#e9eef5]">
                      <th className="w-[28%] px-3 py-2.5">Lịch / Nguồn phát sinh</th>
                      <th className="w-[14%] px-3 py-2.5">Thiết bị</th>
                      <th className="w-[15%] px-3 py-2.5">Đến hạn</th>
                      <th className="w-[11%] px-3 py-2.5">Ưu tiên</th>
                      <th className="w-[16%] px-3 py-2.5">Trạng thái</th>
                      <th className="w-[16%] px-3 py-2.5">Hồ sơ quy trình</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOccurrences.map((occurrence) => {
                      const isIncident = occurrence.kind === 'incident';
                      return (
                        <tr
                          key={occurrence.id}
                          className="border-t border-slate-100 align-top hover:bg-slate-50"
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 rounded px-1.5 font-semibold',
                                  isIncident
                                    ? 'border-red-300 bg-red-100 text-red-800'
                                    : 'border-green-200 bg-green-50 text-green-800',
                                )}
                              >
                                {isIncident ? 'Sự cố' : 'Định kỳ'}
                              </Badge>
                              <strong className="font-semibold text-slate-900">
                                {occurrence.scheduleTitle ||
                                  occurrence.title ||
                                  (isIncident ? 'Sự cố đột xuất' : 'Phiếu bảo trì')}
                              </strong>
                            </div>
                            {isIncident && occurrence.code ? (
                              <span className="mt-1 block text-sm text-slate-500">
                                [{occurrence.code}] {occurrence.title !== occurrence.scheduleTitle ? occurrence.title : ''}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
                              {occurrence.assetCode}
                            </span>
                            {occurrence.assetName ? (
                              <span className="mt-1 block text-sm text-slate-500">
                                {occurrence.assetName}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">{formatDateTime(occurrence.dueAt)}</td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant="outline"
                              className={
                                occurrence.priority === 'High'
                                  ? 'border-red-200 bg-red-50 font-bold text-red-700'
                                  : occurrence.priority === 'Normal'
                                  ? 'border-blue-200 bg-blue-50 font-bold text-blue-700'
                                  : 'border-slate-200 bg-slate-100 font-bold text-slate-600'
                              }
                            >
                              {PRIORITY_LABEL[occurrence.priority] ?? occurrence.priority}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 text-xs font-semibold',
                                OCC_STATUS_TEXT[occurrence.status] ?? 'text-slate-600',
                              )}
                            >
                              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                              {OCCURRENCE_STATUS_LABELS[occurrence.status] ?? occurrence.status}
                            </span>
                            {occurrence.failureReason && !/^Procedure API trả về \d+\.$/.test(occurrence.failureReason) ? (
                              <span className="mt-1 block text-sm text-red-600">
                                {occurrence.failureReason}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs">
                            {occurrence.procedureInstanceCode ? (
                              <strong className="font-bold">{occurrence.procedureInstanceCode}</strong>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {paginatedOccurrences.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                          {isOccFilterActive
                            ? 'Không tìm thấy phiếu phát sinh nào khớp với bộ lọc hiện tại.'
                            : 'Chưa có phiếu công việc phát sinh.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <TablePagerBar
                summary={
                  <>
                    Hiển thị{' '}
                    <strong>
                      {occTotalRecords > 0 ? (safeOccCurrentPage - 1) * numPageSize + 1 : 0}–
                      {Math.min(safeOccCurrentPage * numPageSize, occTotalRecords)}
                    </strong>{' '}
                    / <strong>{occTotalRecords}</strong> phiếu
                  </>
                }
                pageSize={numPageSize}
                pageSizeOptions={OCC_PAGE_SIZES}
                onPageSizeChange={(n) => {
                  setOccPageSize(String(n));
                  setOccCurrentPage(1);
                }}
              >
                <Tip content="Trang trước">
                  <span className="inline-flex">
                    <Button
                      variant="outline"
                      size="lg"
                      className="rounded-md px-3"
                      disabled={safeOccCurrentPage <= 1}
                      onClick={() => setOccCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      ← Trước
                    </Button>
                  </span>
                </Tip>
                <span className="px-1 text-sm font-bold text-foreground">
                  {safeOccCurrentPage} / {occTotalPages}
                </span>
                <Tip content="Trang sau">
                  <span className="inline-flex">
                    <Button
                      variant="outline"
                      size="lg"
                      className="rounded-md px-3"
                      disabled={safeOccCurrentPage >= occTotalPages}
                      onClick={() => setOccCurrentPage((p) => Math.min(occTotalPages, p + 1))}
                    >
                      Sau →
                    </Button>
                  </span>
                </Tip>
              </TablePagerBar>
              </div>
            </section>
          ) : null}
        </>
      )}
    </ModuleShell>
  );
}
