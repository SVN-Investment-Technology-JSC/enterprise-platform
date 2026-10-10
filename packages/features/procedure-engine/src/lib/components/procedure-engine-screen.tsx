'use client';

import type {
  ProcedureAttachment,
  ProcedureAttributeValue,
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureRuntimeAction,
  ProcedureSettingsSnapshot,
  ProcedureWorkspace,
  ReverseProcedureInstanceRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import {
  DashboardCardPicker,
  DashboardView,
  ModuleSettingsView,
  ModuleShell,
  useHashView,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, LayoutDashboard, Settings, Table2, Users } from 'lucide-react';
import {
  applyProcedureAction,
  cancelProcedureSubtask,
  completeProcedureSubtask,
  createProcedureDefinition,
  loadProcedureAttachments,
  archiveProcedureDefinition,
  loadAssetCatalog,
  loadMaterialCatalog,
  requestProcedureMaterials,
  setProcedureInstanceAsset,
  type AssetCatalogItem,
  type MaterialCatalogItem,
  recheckStepMaterials,
  loadProcedureSettings,
  loadProcedureWorkspace,
  loadTenantHomePath,
  publishProcedureDefinition,
  reviseProcedureDefinition,
  postProcedureComment,
  saveProcedureSetting,
  setProcedureSubtasks,
  uploadProcedureAttachment,
  setProcedureDefinitionCategory,
  updateProcedureDefinition,
  validateProcedureDefinition,
  saveProcedureAttributeValues,
  reverseProcedureInstance,
  startProcedureInstance,
} from '../procedure-api';
import { loadOrganization, setPositionReportsTo } from '../organization-api';
import { loadWorkItemProjectId, type ProjectWorkItemInput } from '../workspace-api';
import { PositionManagement } from './position-management';
import {
  PROCEDURE_DASHBOARD_CARDS,
  type ProcedureDashboardData,
} from '../procedure-dashboard.cards';
import { GroupCatalogEditor, type GroupCatalogValue } from './group-catalog-editor';
import { OrganizationBoard } from './organization-board';
import { RcsiBoard } from './rcsi-board';
import { WorkspaceBoard, type StartHandoff } from './workspace-board';
import styles from './procedure-engine.module.scss';

type View = 'dashboard' | 'workspace' | 'raci' | 'positions' | 'org-chart' | 'settings';

// Biểu tượng là bắt buộc khi rail thu gọn: không có thì rail chỉ còn chữ tắt.
const NAV: readonly ModuleNavItem<View>[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard size={16} aria-hidden /> },
  { id: 'workspace', label: 'Workspace', group: 'Người dùng', icon: <ClipboardList size={16} aria-hidden /> },
  { id: 'raci', label: 'Ma trận RCSI', group: 'Thiết kế', icon: <Table2 size={16} aria-hidden /> },
  { id: 'positions', label: 'Quản lý chức danh', group: 'Thiết kế', icon: <Users size={16} aria-hidden /> },
  // { id: 'org-chart', label: 'Sơ đồ tổ chức', group: 'Thiết kế' },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị', icon: <Settings size={16} aria-hidden /> },
];

const VIEW_IDS = NAV.map((item) => item.id);

const vietnameseDateFormatter = new Intl.DateTimeFormat('vi-VN');

export function ProcedureEngineScreen() {
  const { view, sub, navigate } = useHashView<View>({ views: VIEW_IDS, fallback: 'dashboard' });
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
  const [cardDraft, setCardDraft] = useState<readonly string[]>([]);
  const [savingCards, setSavingCards] = useState(false);
  const [groupDraft, setGroupDraft] = useState<GroupCatalogValue>();
  const [settingsSection, setSettingsSection] = useState('dashboard');
  const [materialCatalog, setMaterialCatalog] = useState<MaterialCatalogItem[]>([]);
  const [assetCatalog, setAssetCatalog] = useState<AssetCatalogItem[]>([]);

  const reload = useCallback(async () => {
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
          : 'Không thể tải Procedure Engine.',
      );
    }
  }, []);

  useEffect(() => {
    void reload();
    void loadTenantHomePath().then(setHomePath);
  }, [reload]);

  /**
   * Cấu hình chỉ nạp khi thật sự cần: dashboard cần biết thẻ nào bật, màn cài
   * đặt cần cả bản gốc để so sánh thay đổi.
   */
  useEffect(() => {
    // Ma trận cần danh mục nhóm; workspace cần quy trình mượn/xuất và mua đã
    // cấu hình, để biết có phải hỏi người bấm chọn quy trình hay không.
    if (
      view !== 'dashboard' &&
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
        setCardDraft(loaded['dashboard.cards'].value.cardIds);
        setGroupDraft(loaded['catalog.group'].value);
      })
      .catch(() => setSettings(undefined));
  }, [view, settings]);

  const perform = useCallback(
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
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Thao tác không thành công.',
        );
      } finally {
        setBusy(undefined);
      }
    },
    [reload],
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
    },
  ) =>
    perform(`start:${definition.id}`, async () => {
      const title =
        customPayload?.title?.trim() ||
        handoffTitle ||
        `${definition.name} · ${vietnameseDateFormatter.format(new Date())}`;
      const schedule = {
        startDueAt: customPayload?.startDueAt,
        endDueAt: customPayload?.endDueAt,
        isHourlyScheduling: customPayload?.isHourlyScheduling,
        managerId: customPayload?.managerId,
        managerName: customPayload?.managerName,
        observerIds: customPayload?.observerIds,
        observerNames: customPayload?.observerNames,
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
    nextAction: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) =>
    perform(`${nextAction}:${instanceId}`, () =>
      applyProcedureAction(instanceId, nextAction, comment, returnToStepId, attributeValues),
    );

  const saveCards = async () => {
    if (!settings) return;
    setSavingCards(true);
    try {
      const saved = await saveProcedureSetting(
        'dashboard.cards',
        { cardIds: cardDraft },
        settings['dashboard.cards'].version,
      );
      setSettings({
        ...settings,
        'dashboard.cards': saved as ProcedureSettingsSnapshot['dashboard.cards'],
      });
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
    } finally {
      setSavingCards(false);
    }
  };

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

  const storedCards = settings?.['dashboard.cards'].value.cardIds ?? [];
  const groupsDirty =
    groupDraft !== undefined &&
    JSON.stringify(groupDraft) !== JSON.stringify(settings?.['catalog.group'].value);
  const cardsDirty =
    cardDraft.length !== storedCards.length ||
    cardDraft.some((id, index) => id !== storedCards[index]);
  const canDesign = workspace?.permissions.canManageDefinitions ?? false;

  return (
    <ModuleShell<View>
      moduleKey="procedure-engine"
      appearance="light"
      title="Procedure Engine"
      subtitle="Thiết kế quy trình theo ma trận RCSI và xử lý hồ sơ công việc."
      nav={NAV}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
      collapsible
      collapsed={railCollapsed}
      onCollapsedChange={setRailCollapsed}
      actor={workspace?.actor.name}
      banner={
        error ? (
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
        ) : null
      }
    >
      {!workspace ? (
        <section className={styles.loading} aria-live="polite">
          <span />
          <p>Đang nạp không gian Procedure Engine…</p>
        </section>
      ) : view === 'dashboard' ? (
        <DashboardView<ProcedureDashboardData>
          catalog={PROCEDURE_DASHBOARD_CARDS}
          selection={settings?.['dashboard.cards'].value.cardIds ?? []}
          data={{ workspace }}
        />
      ) : view === 'settings' ? (
        <ModuleSettingsView
          sections={[
            {
              id: 'dashboard',
              label: 'Thẻ tổng quan',
              description:
                'Chọn những thẻ hiện trên trang Tổng quan và sắp xếp thứ tự hiển thị.',
              render: () => (
                <DashboardCardPicker<ProcedureDashboardData>
                  catalog={PROCEDURE_DASHBOARD_CARDS}
                  selection={cardDraft}
                  onChange={setCardDraft}
                  max={6}
                  disabled={!canDesign || savingCards}
                />
              ),
            },
            {
              id: 'groups',
              label: 'Nhóm quy trình',
              description:
                'Quy trình phải thuộc một nhóm mới công bố được. Nhóm đang có quy trình dùng thì tắt chứ không xoá.',
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
          dirty={settingsSection === 'groups' ? groupsDirty : cardsDirty}
          saving={savingCards}
          onSave={settingsSection === 'groups' ? saveGroups : saveCards}
          onReset={() =>
            settingsSection === 'groups'
              ? setGroupDraft(settings?.['catalog.group'].value)
              : setCardDraft(storedCards)
          }
        />
      ) : view === 'workspace' ? (
        <WorkspaceBoard
          initialInstanceId={sub}
          canCreateInstances={workspace.permissions.canCreateInstances}
          busy={busy}
          groups={activeGroups}
          handoffTitle={handoffTitle}
          handoff={adjustment?.handoff}
          canReverse={workspace.permissions.canOverrideActions}
          onReverse={reverse}
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
          railCollapsed={railCollapsed}
          definitions={workspace.definitions}
          organization={organization}
          materialCatalog={materialCatalog}
          groups={activeGroups}
          onDeleteDefinition={workspace.permissions.canPublishDefinitions ? (definitionId) =>
            perform('archive-definition', () => archiveProcedureDefinition(definitionId))
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
      ) : view === 'positions' && organization ? (
        <PositionManagement
          organization={organization}
          canEdit={workspace.permissions.canOverrideActions}
          onSave={async (positionId, reportsToPositionId) => {
            await setPositionReportsTo(positionId, reportsToPositionId);
            setOrganization(await loadOrganization());
          }}
        />
      ) : organization ? (
        <OrganizationBoard organization={organization} onReload={reload} />
      ) : <section className={styles.loading}><span /><p>Đang nạp cơ cấu tổ chức…</p></section>}
    </ModuleShell>
  );
}
