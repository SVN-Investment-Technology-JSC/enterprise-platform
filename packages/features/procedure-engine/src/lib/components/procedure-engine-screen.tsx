'use client';

import type {
  ProcedureAttachment,
  ProcedureDefinition,
  ProcedureRuntimeAction,
  ProcedureSettingsSnapshot,
  ProcedureWorkspace,
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
import {
  applyProcedureAction,
  cancelProcedureSubtask,
  completeProcedureSubtask,
  createProcedureDefinition,
  loadProcedureAttachments,
  deleteProcedureDefinition,
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
  startProcedureInstance,
} from '../procedure-api';
import { loadOrganization } from '../organization-api';
import {
  PROCEDURE_DASHBOARD_CARDS,
  type ProcedureDashboardData,
} from '../procedure-dashboard.cards';
import { GroupCatalogEditor, type GroupCatalogValue } from './group-catalog-editor';
import { OrganizationBoard } from './organization-board';
import { RcsiBoard } from './rcsi-board';
import { WorkspaceBoard } from './workspace-board';
import styles from './procedure-engine.module.scss';

type View = 'dashboard' | 'workspace' | 'raci' | 'org-chart' | 'settings';

const NAV: readonly ModuleNavItem<View>[] = [
  { id: 'dashboard', label: 'Tổng quan' },
  { id: 'workspace', label: 'Workspace', group: 'Người dùng' },
  { id: 'raci', label: 'Ma trận RCSI', group: 'Thiết kế' },
  { id: 'org-chart', label: 'Sơ đồ tổ chức', group: 'Thiết kế' },
  { id: 'settings', label: 'Cài đặt', group: 'Quản trị' },
];

const VIEW_IDS = NAV.map((item) => item.id);

const vietnameseDateFormatter = new Intl.DateTimeFormat('vi-VN');

export function ProcedureEngineScreen() {
  const { view, navigate } = useHashView<View>({ views: VIEW_IDS, fallback: 'dashboard' });
  const [workspace, setWorkspace] = useState<ProcedureWorkspace>();
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
    async (key: string, operation: () => Promise<unknown>) => {
      try {
        setBusy(key);
        setError(undefined);
        setNotice(undefined);
        await operation();
        await reload();
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const title = params.get('startTitle');
    if (!title) return;
    setHandoffTitle(title);
    navigate('workspace');
    // Dọn khỏi thanh địa chỉ để tải lại trang không mở lại form lần nữa.
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    // Chỉ chạy một lần lúc mở trang; `navigate` ổn định qua các lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (definition: ProcedureDefinition) =>
    perform(`start:${definition.id}`, () =>
      startProcedureInstance(
        definition.id,
        handoffTitle ?? `${definition.name} · ${vietnameseDateFormatter.format(new Date())}`,
      ),
    ).then(() => setHandoffTitle(undefined));

  const action = (
    instanceId: string,
    nextAction: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) =>
    perform(`${nextAction}:${instanceId}`, () =>
      applyProcedureAction(instanceId, nextAction, comment, returnToStepId),
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
      title="Procedure Engine"
      subtitle="Thiết kế quy trình theo ma trận RCSI và xử lý hồ sơ công việc."
      nav={NAV}
      view={view}
      onViewChange={navigate}
      homeHref={homePath}
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
            busy={busy}
            groups={activeGroups}
            handoffTitle={handoffTitle}
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
            definitions={workspace.definitions}
            organization={organization}
            materialCatalog={materialCatalog}
            groups={activeGroups}
            onDeleteDefinition={(definitionId) =>
              perform('delete-definition', () => deleteProcedureDefinition(definitionId))
            }
            busy={Boolean(busy)}
            onCreateDefinition={(input) =>
              perform('create-definition', () =>
                createProcedureDefinition({
                  ...input,
                  // Quy trình mới luôn có sẵn bước 1: bản nháp phải có ít nhất một bước.
                  steps: [{ key: 'B1', order: 1, name: 'Bước 1', assignments: [] }],
                }),
              )
            }
            onChangeGroupDefinition={(id, category) =>
              perform(`group:${id}`, () => setProcedureDefinitionCategory(id, category))
            }
            onUpdateDefinition={(id, steps) =>
              perform(`update:${id}`, () => updateProcedureDefinition(id, steps))
            }
            onPublishDefinition={(id) =>
              perform(`publish:${id}`, () => publishProcedureDefinition(id))
            }
            onReviseDefinition={(id) =>
              perform(`revise:${id}`, () => reviseProcedureDefinition(id))
            }
          />
        ) : organization ? (
          <OrganizationBoard organization={organization} onReload={reload} />
        ) : <section className={styles.loading}><span/><p>Đang nạp cơ cấu tổ chức…</p></section>}
    </ModuleShell>
  );
}
