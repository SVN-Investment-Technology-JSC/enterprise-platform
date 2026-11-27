'use client';

import type {
  ProcedureAttachment,
  ProcedureAttributeValue,
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureApplyAction,
  ProcedureSettingsSnapshot,
  ProcedureWorkspace,
  ReverseProcedureInstanceRequest,
  RelinkProcedureWorkspaceRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { PROCEDURE_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-procedure-engine';
import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import {
  ModuleSettingsView,
  ModuleShell,
  useAssistantSaved,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import {
  AppIcon,
  formatDate,
  initialReturnTarget,
  returnPathFor,
  type ReturnTarget,
} from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Settings, Table2 } from 'lucide-react';
import {
  applyProcedureAction,
  cancelProcedureSubtask,
  completeProcedureSubtask,
  createProcedureDefinition,
  loadProcedureAttachments,
  archiveProcedureDefinition,
  deleteProcedureDefinition,
  loadAssetCatalog,
  loadMaterialCatalog,
  requestProcedureMaterials,
  setProcedureInstanceAsset,
  type AssetCatalogItem,
  type MaterialCatalogItem,
  recheckStepMaterials,
  loadProcedureSettings,
  loadProcedureInstance,
  loadProcedureWorkspace,
  loadTenantHomePath,
  publishProcedureDefinition,
  reviseProcedureDefinition,
  postProcedureComment,
  saveProcedureSetting,
  setProcedureSubtasks,
  uploadProcedureAttachment,
  deleteProcedureInstance,
  relinkProcedureWorkspace,
  setProcedureDefinitionBulkActions,
  setProcedureDefinitionCategory,
  updateProcedureDefinition,
  validateProcedureDefinition,
  saveProcedureAttributeValues,
  reverseProcedureInstance,
  startProcedureInstance,
} from '../procedure-api';
import { loadOrganization } from '../organization-api';
import { mergeInstances, useProcedureLive } from '../use-procedure-live';
import { loadWorkItemProjectId, type ProjectWorkItemInput } from '../workspace-api';
import { GroupCatalogEditor, type GroupCatalogValue } from './group-catalog-editor';
import { OrganizationBoard } from './organization-board';
import { RcsiBoard } from './rcsi-board';
import type { StartHandoff } from './start-instance-form';
import { WorkspaceBoard } from './workspace-board';
import styles from './procedure-engine.module.scss';
import { returnSourceLabel } from './return-source-label';


type View = 'workspace' | 'raci' | 'org-chart' | 'settings';

// Biểu tượng là bắt buộc khi rail thu gọn: không có thì rail chỉ còn chữ tắt.
// "Hồ sơ xử lý" là màn làm việc duy nhất (trang "Tổng quan" đã bỏ) và là màn mở mặc định.
const NAV: readonly ModuleNavItem<View>[] = [
  { id: 'workspace', label: 'Hồ sơ xử lý', group: 'Người dùng', icon: <AppIcon slot="sidebar.procedure.workspace" fallback={ClipboardList} size={16} /> },
  { id: 'raci', label: 'Ma trận RCSI', group: 'Thiết kế', icon: <AppIcon slot="sidebar.procedure.raci" fallback={Table2} size={16} /> },
  // { id: 'org-chart', label: 'Sơ đồ tổ chức', group: 'Thiết kế' },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị', icon: <AppIcon slot="nav.settings" fallback={Settings} size={16} /> },
];

const VIEW_IDS = NAV.map((item) => item.id);
/**
 * Hash của trang "Tổng quan" cũ (`#dashboard`, kể cả `#overview`): link đã lưu / đã chia sẻ mở "Hồ sơ xử lý" thay vì trang
 * trống. Hằng ở cấp module để `useHashView` không phân giải lại mỗi lần render.
 */
const LEGACY_PROCEDURE_VIEWS: Readonly<Record<string, View>> = { dashboard: 'workspace', overview: 'workspace' };

/**
 * Đổi hash cũ trên thanh địa chỉ thành hash mới (`#dashboard` -> `#workspace`), thay mục lịch sử đang có (không thêm mục
 * mới, nút Back không quay lại hash cũ). Cần cho Hồ sơ xử lý: cửa sổ hồ sơ chỉ ghi `#workspace/<id>` khi hash đang là của
 * màn này.
 */
function replaceLegacyHash(): void {
  const raw = window.location.hash.slice(1);
  const separator = raw.indexOf('/');
  const head = separator < 0 ? raw : raw.slice(0, separator);
  const target = LEGACY_PROCEDURE_VIEWS[head];
  if (!target) return;
  const tail = separator < 0 ? '' : raw.slice(separator);
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${target}${tail}`);
}

const START_ACTION_KEYS = [PROCEDURE_ASSISTANT_ACTIONS.startInstance.key];

export function ProcedureEngineScreen() {
  const { view, sub, navigate } = useHashView<View>({
    views: VIEW_IDS,
    fallback: 'workspace',
    legacy: LEGACY_PROCEDURE_VIEWS,
  });
  useEffect(() => {
    replaceLegacyHash();
    window.addEventListener('hashchange', replaceLegacyHash);
    return () => window.removeEventListener('hashchange', replaceLegacyHash);
  }, []);
  const [workspace, setWorkspace] = useState<ProcedureWorkspace>();
  /** Thu rail để nhường chỗ cho sơ đồ tổ chức trên Ma trận RCSI. */
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [organization, setOrganization] = useState<TenantOrganizationContext>();
  const [error, setError] = useState<string>();
  /** Thông báo việc đã xong, ví dụ mã hồ sơ vừa mở. Lỗi vẫn đi đường `error`. */
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [attachments, setAttachments] = useState<ProcedureAttachment[]>([]);
  const [homePath, setHomePath] = useState('/');
  const [settings, setSettings] = useState<ProcedureSettingsSnapshot>();
  const [savingCards, setSavingCards] = useState(false);
  const [groupDraft, setGroupDraft] = useState<GroupCatalogValue>();
  const [settingsSection, setSettingsSection] = useState('groups');
  const [materialCatalog, setMaterialCatalog] = useState<MaterialCatalogItem[]>([]);
  const [assetCatalog, setAssetCatalog] = useState<AssetCatalogItem[]>([]);
  /** Ô trên dòng đường dẫn; trang đặt nút thao tác của mình vào đây. */
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);

  /** Tăng mỗi lần bắt đầu nạp danh sách hồ sơ; kết quả của lần nạp cũ hơn bị bỏ. */
  const listGeneration = useRef(0);

  /**
   * Làm mới ĐÚNG một hồ sơ (khi người khác có trao đổi mới) thay vì nạp lại cả workspace kèm đính kèm của
   * mọi hồ sơ. Lỗi thì bỏ qua: đây chỉ là cập nhật tiện lợi, lần tải lại đầy đủ kế tiếp sẽ kéo về.
   */
  const refreshInstance = useCallback(async (instanceId: string) => {
    const generation = listGeneration.current;
    try {
      const fresh = await loadProcedureInstance(instanceId);
      // Một lần nạp danh sách bắt đầu sau lần này đã mang bản mới hơn: đừng ghi đè bằng bản cũ.
      if (generation !== listGeneration.current) return;
      setWorkspace((current) => {
        if (!current) return current;
        const instances = mergeInstances(
          current.instances,
          current.instances.map((item) => (item.id === instanceId ? fresh : item)),
        );
        return instances === current.instances ? current : { ...current, instances };
      });
    } catch {
      // Không còn là người tham gia, hoặc mất mạng: giữ nguyên bản đang hiện.
    }
  }, []);

  /**
   * Làm mới nhẹ danh sách hồ sơ (dòng, số đếm các tab, chi tiết đang mở): chỉ `/workspace`, không nạp lại sơ đồ tổ
   * chức, danh mục và đính kèm như `reload`. Dùng khi quay lại tab và theo nhịp; lỗi thì giữ bản đang hiện.
   */
  const refreshList = useCallback(async () => {
    const generation = ++listGeneration.current;
    try {
      const fresh = await loadProcedureWorkspace();
      if (generation !== listGeneration.current) return;
      setWorkspace((current) => {
        if (!current) return current;
        const instances = mergeInstances(current.instances, fresh.instances);
        return instances === current.instances ? current : { ...current, instances };
      });
    } catch {
      // Mất mạng hay phiên hết hạn: lần tải kế tiếp sẽ thử lại.
    }
  }, []);

  const reload = useCallback(async () => {
    ++listGeneration.current;
    try {
      setError(undefined);
      const [procedureData, organizationData, materials, assets] = await Promise.all([
        loadProcedureWorkspace(),
        loadOrganization(),
        loadMaterialCatalog(),
        loadAssetCatalog(),
      ]);
      setWorkspace(procedureData);
      setOrganization(organizationData);
      setMaterialCatalog(materials);
      setAssetCatalog(assets);

      // Tải đính kèm cho MỌI hồ sơ nhìn thấy được, không chỉ hồ sơ đang chạy:
      // AC-ATT-05 yêu cầu tra cứu lại tài liệu sau khi hồ sơ đã kết thúc.
      const files = await Promise.all(
        procedureData.instances.map((item) => loadProcedureAttachments(item.id).catch(() => [])),
      );
      setAttachments(files.flat());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không thể tải module Quy trình.',
      );
    }
  }, []);

  useEffect(() => {
    void reload();
    void loadTenantHomePath().then(setHomePath);
  }, [reload]);

  // Card Trợ lý vừa khởi tạo hồ sơ: tải lại danh sách hồ sơ như khi tự khởi tạo.
  useAssistantSaved(START_ACTION_KEYS, () => void reload());

  /**
   * Người khác duyệt, trả về, hoàn duyệt, huỷ hồ sơ: dòng, số đếm và chi tiết đang mở tự cập nhật. Tín hiệu của
   * hồ sơ có trong danh sách làm mới đúng hồ sơ đó; ngoài ra nạp nhẹ danh sách khi quay lại tab và theo nhịp.
   * Mở thẳng một hồ sơ (`#workspace/<id>`, ví dụ từ thông báo) thì vào phòng của nó. Hồ sơ chọn trong danh sách do
   * bảng tự giữ nên khung này không biết để vào phòng; tab Trao đổi của hồ sơ đó vẫn giữ phòng.
   */
  const listedIds = useMemo(
    () => new Set((workspace?.instances ?? []).map((instance) => instance.id)),
    [workspace?.instances],
  );
  useProcedureLive({
    roomInstanceId: view === 'workspace' ? sub : undefined,
    watches: (instanceId) => listedIds.has(instanceId),
    onSignal: refreshInstance,
    onPoll: refreshList,
    paused: busy !== undefined || !workspace || view !== 'workspace',
  });

  /**
   * Cấu hình chỉ nạp khi thật sự cần: màn cài đặt cần cả bản gốc để so sánh
   * thay đổi.
   */
  useEffect(() => {
    // Ma trận cần danh mục nhóm; workspace cần quy trình mượn/xuất và mua đã
    // cấu hình, để biết có phải hỏi người bấm chọn quy trình hay không.
    if (
      view !== 'settings' &&
      view !== 'raci' &&
      view !== 'workspace'
    ) {
      return;
    }
    if (settings) return;
    void loadProcedureSettings()
      .then((loaded) => {
        setSettings(loaded);
        setGroupDraft(loaded['catalog.group'].value);
      })
      .catch(() => setSettings(undefined));
  }, [view, settings]);

  /** Chạy một thao tác (báo bận, lỗi, nạp lại) và trả về thao tác có thành công không. */
  const attempt = useCallback(
    async (
      key: string,
      operation: () => Promise<unknown>,
      /**
       * Nạp lại nền, không bắt người dùng chờ: form tạo đơn đóng ngay khi hồ
       * sơ đã mở, danh sách tự cập nhật sau. Nạp lại cả workspace (kèm đính
       * kèm của mọi hồ sơ) có lúc mất nhiều giây.
       */
      options?: { readonly reloadInBackground?: boolean },
    ) => {
      try {
        setBusy(key);
        setError(undefined);
        setNotice(undefined);
        await operation();
        if (options?.reloadInBackground) void reload();
        else await reload();
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Thao tác không thành công.',
        );
        return false;
      } finally {
        setBusy(undefined);
      }
    },
    [reload],
  );
  const perform = useCallback(
    async (
      key: string,
      operation: () => Promise<unknown>,
      options?: { readonly reloadInBackground?: boolean },
    ): Promise<void> => {
      await attempt(key, operation, options);
    },
    [attempt],
  );

  /**
   * Tiêu đề mở hồ sơ do module khác chuyển sang.
   *
   * Kho không tự tạo hồ sơ bên Quy trình — thao tác ở module này không ghi dữ
   * liệu của module kia. Nó chỉ đưa người dùng sang đây kèm sẵn nội dung, còn
   * bấm mở là người dùng, trong đúng module sở hữu dữ liệu đó.
   */
  const [handoffTitle, setHandoffTitle] = useState<string>();
  /** Hồ sơ điều chỉnh: id hồ sơ đã huỷ hiệu lực, lấy từ `?adjustFrom=`. */
  const [adjustFromId, setAdjustFromId] = useState<string>();
  const [adjustment, setAdjustment] = useState<{
    readonly instance: ProcedureInstance;
    readonly handoff: StartHandoff;
  }>();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const title = params.get('startTitle');
    const adjustFrom = params.get('adjustFrom');
    if (!title && !adjustFrom) return;
    if (title) setHandoffTitle(title);
    if (adjustFrom) setAdjustFromId(adjustFrom);
    navigate('workspace');
    // Dọn khỏi thanh địa chỉ để tải lại trang không mở lại form lần nữa.
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    // Chỉ chạy một lần lúc mở trang; `navigate` ổn định qua các lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thông báo "Cần lập hồ sơ điều chỉnh" dẫn về đây: đợi danh sách hồ sơ nạp
  // xong thì mở form tạo đơn điền sẵn theo hồ sơ đã huỷ hiệu lực.
  useEffect(() => {
    if (!adjustFromId || !workspace) return;
    setAdjustFromId(undefined);
    const original = workspace.instances.find((item) => item.id === adjustFromId);
    if (!original || original.status !== 'reversed') {
      setError('Không mở được hồ sơ điều chỉnh: hồ sơ gốc không còn ở trạng thái huỷ hiệu lực.');
      return;
    }
    const existing = workspace.instances.find(
      (item) => item.adjustmentOf?.instanceId === original.id && item.status === 'running',
    );
    if (existing) {
      setNotice(`Hồ sơ ${original.code} đã có hồ sơ điều chỉnh ${existing.code} đang xử lý.`);
      return;
    }
    const open = (projectId?: string) => {
      setAdjustment({
        instance: original,
        handoff: {
          definitionId: original.definitionId,
          startDueAt: original.startDueAt,
          endDueAt: original.endDueAt,
          projectId,
          note: `Hồ sơ điều chỉnh cho ${original.code} (đã huỷ hiệu lực: ${original.reversal?.reason ?? ''}). Hồ sơ mới phải dùng cùng quy trình.`,
        },
      });
      setHandoffTitle(`Điều chỉnh ${original.code}: ${original.title}`);
    };
    // Hồ sơ mở từ công việc "Theo quy trình" không lưu dự án: tra dự án của
    // công việc gốc để hồ sơ điều chỉnh tạo công việc mới trong cùng dự án.
    if (original.workspaceLink?.projectId) open(original.workspaceLink.projectId);
    else if (original.sourceType === 'workspace_work_item' && original.sourceId) {
      void loadWorkItemProjectId(original.sourceId).then(open);
    } else open();
  }, [adjustFromId, workspace]);

  const reverse = async (instanceId: string, input: ReverseProcedureInstanceRequest) => {
    const reversed = await reverseProcedureInstance(instanceId, input);
    setNotice(
      !input.createAdjustment
        ? `Đã huỷ hiệu lực ${reversed.code}.`
        : reversed.sourceType === 'hrm_request'
          ? `Đã huỷ hiệu lực ${reversed.code}. Người gửi đơn HRM sẽ nhận thông báo kèm form đơn điều chỉnh.`
          : `Đã huỷ hiệu lực ${reversed.code}. Người khởi tạo (vai S) đã được báo để lập hồ sơ điều chỉnh.`,
    );
    await reload();
  };

  const removeInstance = async (instanceId: string, reason: string) => {
    const code = workspace?.instances.find((instance) => instance.id === instanceId)?.code ?? '';
    await deleteProcedureInstance(instanceId, reason);
    setNotice(`Đã xoá đơn ${code}.`);
    await reload();
  };

  const relinkWorkspace = async (instanceId: string, input: RelinkProcedureWorkspaceRequest) => {
    const pending = await relinkProcedureWorkspace(instanceId, input);
    setNotice(
      `Đã gửi yêu cầu đổi công việc liên kết của ${pending.code} sang dự án ${input.projectCode}; Workspace đang xử lý.`,
    );
    await reload();
  };

  // Hồ sơ gắn dự án chờ Workspace tạo công việc qua sự kiện (vài giây): nạp lại
  // định kỳ tới khi có kết quả, để tên hồ sơ có mã công việc mà không cần F5.
  const hasPendingWorkspaceLink = Boolean(
    workspace?.instances.some((instance) => instance.workspaceLink?.status === 'pending'),
  );
  useEffect(() => {
    if (!hasPendingWorkspaceLink) return;
    const timer = setTimeout(() => void reload(), 3000);
    return () => clearTimeout(timer);
  }, [hasPendingWorkspaceLink, workspace, reload]);

  const start = (
    definition: ProcedureDefinition,
    customPayload?: {
      title?: string;
      startDueAt?: string;
      endDueAt?: string;
      isHourlyScheduling?: boolean;
      managerId?: string;
      managerName?: string;
      observerIds?: string[];
      observerNames?: string[];
      /** Gắn dự án: đơn này là một công việc mới của dự án bên Workspace. */
      workItem?: ProjectWorkItemInput & { readonly projectCode: string };
      /** Người submit (giữ vai S); khác người đang đăng nhập là tạo đơn hộ. */
      submitterUserId?: string;
      submitterName?: string;
    },
  ) =>
    perform(`start:${definition.id}`, async () => {
      const title =
        customPayload?.title?.trim() ||
        handoffTitle ||
        `${definition.name} · ${formatDate(new Date())}`;
      const schedule = {
        startDueAt: customPayload?.startDueAt,
        endDueAt: customPayload?.endDueAt,
        isHourlyScheduling: customPayload?.isHourlyScheduling,
        managerId: customPayload?.managerId,
        managerName: customPayload?.managerName,
        observerIds: customPayload?.observerIds,
        observerNames: customPayload?.observerNames,
        submitterUserId: customPayload?.submitterUserId,
        submitterName: customPayload?.submitterName,
      };
      const adjustmentOfInstanceId =
        adjustment?.instance.definitionId === definition.id ? adjustment.instance.id : undefined;
      const workItem = customPayload?.workItem;
      if (!workItem) {
        await startProcedureInstance(definition.id, { title, ...schedule, adjustmentOfInstanceId });
        return;
      }

      // Gắn dự án: Quy trình chỉ mở hồ sơ của mình và gửi yêu cầu kèm theo.
      // Workspace nhận sự kiện, tự kiểm quyền và tạo công việc, rồi báo mã
      // công việc về để tên hồ sơ thành `EVN-CV013-…`.
      const { projectCode, projectId, ...draft } = workItem;
      const instance = await startProcedureInstance(definition.id, {
        title,
        ...schedule,
        workspaceLink: { projectId, projectCode, workItem: draft },
        adjustmentOfInstanceId,
      });
      setNotice(
        `Đã mở hồ sơ ${instance.code}. Workspace đang tạo công việc trong dự án ${projectCode}; ` +
          'tên hồ sơ sẽ gắn mã công việc sau ít giây.',
      );
    }, { reloadInBackground: true }).then(() => {
      setHandoffTitle(undefined);
      setAdjustment(undefined);
    });

  const action = (
    instanceId: string,
    nextAction: ProcedureApplyAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) =>
    attempt(`${nextAction}:${instanceId}`, () =>
      applyProcedureAction(instanceId, nextAction, comment, returnToStepId, attributeValues),
    ).then((done) => {
      // Mở hồ sơ từ trang chủ (`?returnTo=`): xử lý xong đúng hồ sơ đó thì tự quay về. Trao đổi không tính.
      const back = done && nextAction !== 'comment' ? returnPathFor(instanceId) : undefined;
      if (back) window.location.assign(back);
    });

  /** Mở từ trang khác kèm `?returnTo=`: hiện dải "xử lý xong sẽ tự quay về". Đọc sau khi gắn để khớp SSR. */
  const [returnTarget, setReturnTarget] = useState<ReturnTarget>();
  useEffect(() => setReturnTarget(initialReturnTarget()), []);

  const saveGroups = async () => {
    if (!settings || !groupDraft) return;
    setSavingCards(true);
    try {
      const saved = await saveProcedureSetting(
        'catalog.group',
        groupDraft,
        settings['catalog.group'].version,
      );
      setSettings({
        ...settings,
        'catalog.group': saved as ProcedureSettingsSnapshot['catalog.group'],
      });
      setGroupDraft((saved as ProcedureSettingsSnapshot['catalog.group']).value);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được danh mục nhóm.');
    } finally {
      setSavingCards(false);
    }
  };

  /** Mã nhóm đang được ít nhất một quy trình dùng — không cho xoá, chỉ cho tắt. */
  const usedGroupCodes = useMemo(
    () =>
      new Set(
        (workspace?.definitions ?? [])
          .map((definition) => definition.category)
          .filter((code): code is string => Boolean(code)),
      ),
    [workspace],
  );

  /** Nhóm đang bật, theo đúng thứ tự admin đã sắp trong Cài đặt. */
  const activeGroups = useMemo(
    () =>
      (settings?.['catalog.group'].value.options ?? [])
        .filter((group) => group.isActive)
        .map((group) => ({ code: group.code, label: group.label })),
    [settings],
  );

  const groupsDirty =
    groupDraft !== undefined &&
    JSON.stringify(groupDraft) !== JSON.stringify(settings?.['catalog.group'].value);
  const canDesign = workspace?.permissions.canManageDefinitions ?? false;

  return (
    <ModuleShell<View>
      moduleKey="procedure-engine"
      appearance="light"
      title="Quy trình"
      nav={NAV}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      actor={workspace?.actor.name}
      actions={<div ref={setHeadSlot} className={styles.headSlot} />}
      banner={
        <>
        {returnTarget ? (
          <div className={styles.notice} role="status">
            <span>Mở từ {returnSourceLabel(returnTarget.path)} · xử lý xong hồ sơ này sẽ tự quay về.</span>
            <a href={returnTarget.path}>Về {returnSourceLabel(returnTarget.path)}</a>
          </div>
        ) : null}
        {error ? (
          <div className={styles.error} role="alert">
            <strong>Không thể hoàn tất yêu cầu</strong>
            <span>{error}</span>
            <button onClick={() => void reload()} type="button">
              Thử lại
            </button>
          </div>
        ) : notice ? (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice(undefined)} type="button">
              Đóng
            </button>
          </div>
        ) : null}
        </>
      }
    >
      {!workspace ? (
        <section className={styles.loading} aria-live="polite">
          <span />
          <p>Đang nạp module Quy trình…</p>
        </section>
      ) : view === 'settings' ? (
        // Mục "Thẻ tổng quan" đã bỏ cùng trang Tổng quan; khoá `dashboard.cards` vẫn nằm ở server, giao diện không đọc nữa.
        <ModuleSettingsView
          sections={[
            {
              id: 'groups',
              label: 'Nhóm quy trình',
              render: () =>
                groupDraft ? (
                  <GroupCatalogEditor
                    value={groupDraft}
                    usedCodes={usedGroupCodes}
                    disabled={!canDesign || savingCards}
                    onChange={setGroupDraft}
                  />
                ) : null,
            },
          ]}
          activeSectionId={settingsSection}
          onSectionChange={setSettingsSection}
          readOnly={!canDesign}
          dirty={groupsDirty}
          saving={savingCards}
          onSave={saveGroups}
          onReset={() => setGroupDraft(settings?.['catalog.group'].value)}
        />
      ) : view === 'workspace' ? (
        <WorkspaceBoard
          onRefreshInstance={refreshInstance}
          // Bảng của giao diện mới: duyệt / không duyệt hàng loạt xong thì nạp nhẹ danh sách và báo kết quả.
          onChanged={refreshList}
          onNotice={(message) => {
            setError(undefined);
            setNotice(message);
          }}
          onError={setError}
          headSlot={headSlot}
          initialInstanceId={sub}
          canCreateInstances={workspace.permissions.canCreateInstances}
          busy={busy}
          groups={activeGroups}
          handoffTitle={handoffTitle}
          handoff={adjustment?.handoff}
          canReverse={workspace.permissions.canOverrideActions}
          onReverse={reverse}
          onDeleteInstance={removeInstance}
          onRelinkWorkspace={relinkWorkspace}
          onSupplementFile={(instanceId, file) =>
            perform(`supplement:${instanceId}`, async () => {
              await uploadProcedureAttachment(instanceId, file, undefined, true);
            })
          }
          materialCatalog={materialCatalog}
          assetCatalog={assetCatalog}
          onPickAsset={(instanceId, assetCode) =>
            perform('asset', () => setProcedureInstanceAsset(instanceId, assetCode))
          }
          onRequestMaterials={(instanceId, input) =>
            perform(`materials:${input.subtaskId}`, async () => {
              const response = await requestProcedureMaterials(instanceId, input);
              const summary = response.opened
                .map((entry) => `${entry.code} (${entry.definitionName})`)
                .join(', ');
              setNotice(`Đã mở hồ sơ xin vật tư: ${summary}.`);
              return response.instance;
            })
          }
          actorName={workspace.actor.name}
          actorId={workspace.actor.id}
          organization={organization}
          attachments={attachments}
          definitions={workspace.definitions}
          instances={workspace.instances}
          onAction={action}
          onSaveAttributes={(instanceId, values) =>
            perform('attributes', () => saveProcedureAttributeValues(instanceId, values))
          }
          onOpenDefinitions={() => navigate('raci')}
          onStart={start}
          onSeedSubtasks={(instanceId) =>
            perform('subtasks', () => setProcedureSubtasks(instanceId))
          }
          onSetSubtasks={(instanceId, items, executionMode) =>
            perform('subtasks', () => setProcedureSubtasks(instanceId, items, executionMode))
          }
          onRecheckMaterials={(instanceId) =>
            perform('materials', () => recheckStepMaterials(instanceId))
          }
          onCompleteSubtask={(instanceId, subtaskId) =>
            perform(`subtask-done:${subtaskId}`, () =>
              completeProcedureSubtask(instanceId, subtaskId),
            )
          }
          onCancelSubtask={(instanceId, subtaskId) =>
            perform(`subtask-cancel:${subtaskId}`, () =>
              cancelProcedureSubtask(instanceId, subtaskId),
            )
          }
          onUploadEvidence={(instanceId, subtaskId, file) =>
            perform(`upload:${subtaskId}`, async () => {
              await uploadProcedureAttachment(instanceId, file, subtaskId);
            })
          }
          onUploadFile={(instanceId, file) =>
            perform('upload', async () => {
              await uploadProcedureAttachment(instanceId, file);
            })
          }
          onSendComment={(instanceId, body, mentions, replyToId) =>
            perform('comment', () =>
              postProcedureComment(instanceId, body, mentions, replyToId),
            )
          }
        />
      ) : view === 'raci' ? (
        <RcsiBoard
          headSlot={headSlot}
          railCollapsed={railCollapsed}
          definitions={workspace.definitions}
          organization={organization}
          materialCatalog={materialCatalog}
          groups={activeGroups}
          onDeleteDefinition={workspace.permissions.canPublishDefinitions ? (definitionId) =>
            perform('archive-definition', async () => {
              await archiveProcedureDefinition(definitionId);
              // Cập nhật ngay trên màn: nạp lại toàn bộ chạy nền, có thể chậm vì Kho.
              setWorkspace((current) => current && {
                ...current,
                definitions: current.definitions.map((item) =>
                  item.id === definitionId ? { ...item, status: 'archived' } : item,
                ),
              });
            }, { reloadInBackground: true })
          : undefined}
          onDeleteArchivedDefinition={canDesign && workspace.permissions.canOverrideActions ? (definitionId) =>
            perform('delete-definition', async () => {
              await deleteProcedureDefinition(definitionId);
              setWorkspace((current) => current && {
                ...current,
                definitions: current.definitions.filter((item) => item.id !== definitionId),
              });
            }, { reloadInBackground: true })
          : undefined}
          busy={Boolean(busy)}
          onCreateDefinition={canDesign ? (input) =>
            perform('create-definition', () =>
              createProcedureDefinition({
                ...input,
                // Quy trình mới luôn có sẵn bước 1: bản nháp phải có ít nhất một bước.
                steps: [{ key: 'B1', order: 1, name: 'Bước 1', assignments: [] }],
              }),
            )
          : undefined}
          onChangeGroupDefinition={canDesign ? (id, category) =>
            perform(`group:${id}`, () => setProcedureDefinitionCategory(id, category))
          : undefined}
          onChangeBulkActionsDefinition={canDesign ? (id, value) =>
            perform(`bulk-actions:${id}`, () => setProcedureDefinitionBulkActions(id, value))
          : undefined}
          onUpdateDefinition={canDesign ? (id, steps, flow) =>
            perform(`update:${id}`, () => updateProcedureDefinition(id, steps, flow))
          : undefined}
          onValidateDefinition={(id) => validateProcedureDefinition(id)}
          onPublishDefinition={workspace.permissions.canPublishDefinitions ? (id) =>
            perform(`publish:${id}`, () => publishProcedureDefinition(id))
          : undefined}
          onReviseDefinition={canDesign ? (id) =>
            perform(`revise:${id}`, () => reviseProcedureDefinition(id))
          : undefined}
        />
      ) : organization ? (
        <OrganizationBoard organization={organization} onReload={reload} />
      ) : <section className={styles.loading}><span /><p>Đang nạp cơ cấu tổ chức…</p></section>}
    </ModuleShell>
  );
}
