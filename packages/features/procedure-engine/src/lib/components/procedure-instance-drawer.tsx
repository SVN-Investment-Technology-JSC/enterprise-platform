'use client';

import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureAttachment,
  ProcedureAttributeValue,
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureRuntimeAction,
  RelinkProcedureWorkspaceRequest,
  ReverseProcedureInstanceRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadOrganization } from '../organization-api';
import {
  applyProcedureAction,
  cancelProcedureSubtask,
  completeProcedureSubtask,
  deleteProcedureInstance,
  loadAssetCatalog,
  loadMaterialCatalog,
  loadProcedureAttachments,
  loadProcedureInstance,
  loadProcedureWorkspace,
  postProcedureComment,
  recheckStepMaterials,
  relinkProcedureWorkspace,
  requestProcedureMaterials,
  reverseProcedureInstance,
  saveProcedureAttributeValues,
  setProcedureInstanceAsset,
  setProcedureSubtasks,
  uploadProcedureAttachment,
  type AssetCatalogItem,
  type MaterialCatalogItem,
} from '../procedure-api';
import styles from './procedure-instance-drawer.module.scss';
import { WorkspaceBoard } from './workspace-board';

/** Người đang đăng nhập: Dashboard đã biết sẵn nên không phải gọi cả `/workspace` chỉ để lấy hai giá trị này. */
export interface ProcedureDrawerActor {
  readonly id: string;
  readonly name: string;
}

export interface ProcedureInstanceDrawerProps {
  /** Hồ sơ cần xử lý; đổi giá trị thì nạp hồ sơ khác. */
  readonly instanceId: string;
  readonly actor: ProcedureDrawerActor;
  readonly onClose: () => void;
  /** Gọi sau mỗi thao tác làm đổi hồ sơ (duyệt, hoàn thành, trả lại, từ chối, xoá...) để màn gọi tải lại danh sách. */
  readonly onChanged?: () => void;
}

/** Những thao tác xử lý xong một lượt: hồ sơ chuyển đi nên drawer đóng, khác với trao đổi vẫn ở lại. */
const CLOSING_ACTIONS: ReadonlySet<ProcedureRuntimeAction> = new Set([
  'complete',
  'approve',
  'reject',
  'return',
  'cancel',
]);

/**
 * Quy trình đã công bố, để người thực thi chọn quy trình "mượn/xuất" hay "mua sắm" khi xin vật tư. Chưa có đường lấy
 * riêng nên đọc từ `/workspace` (nặng), vì vậy chỉ nạp khi hồ sơ đang ở pha có thể xin vật tư và giữ lại một lúc cho
 * các lần mở sau.
 */
const DEFINITIONS_TTL_MS = 5 * 60_000;
let definitionsCache: { at: number; value: Promise<ProcedureDefinition[]> } | undefined;
function loadPublishedDefinitions(): Promise<ProcedureDefinition[]> {
  if (definitionsCache && Date.now() - definitionsCache.at < DEFINITIONS_TTL_MS) return definitionsCache.value;
  const value = Promise.resolve()
    .then(() => loadProcedureWorkspace())
    .then((workspace) => workspace.definitions.filter((definition) => definition.status === 'published'))
    .catch((cause: unknown) => {
      if (definitionsCache?.value === value) definitionsCache = undefined;
      throw cause;
    });
  definitionsCache = { at: Date.now(), value };
  return value;
}

/** Pha có thể giao bước con và xin vật tư; quản trị xử lý thay cũng cần. */
const MATERIAL_STAGES: ReadonlySet<string> = new Set(['R', 'E']);

/**
 * Xử lý một hồ sơ Quy trình ngay ngoài module (Dashboard), với đủ chức năng của màn "Hồ sơ xử lý": điền thông tin, xem
 * và tải tài liệu, trao đổi, tiến trình từng bước, bước con, vật tư, bước Tài chính, trả lại, huỷ, xoá. Dùng lại chính
 * `WorkspaceBoard` ở chế độ `embedded` nên mọi luật hiển thị theo `authorization` của hồ sơ giữ nguyên, không có bản sao.
 */
export function ProcedureInstanceDrawer({ instanceId, actor, onClose, onChanged }: ProcedureInstanceDrawerProps) {
  const [instance, setInstance] = useState<ProcedureInstance>();
  const [attachments, setAttachments] = useState<ProcedureAttachment[]>([]);
  const [organization, setOrganization] = useState<TenantOrganizationContext>();
  const [materialCatalog, setMaterialCatalog] = useState<MaterialCatalogItem[]>([]);
  const [assetCatalog, setAssetCatalog] = useState<AssetCatalogItem[]>([]);
  const [definitions, setDefinitions] = useState<ProcedureDefinition[]>([]);
  const [error, setError] = useState<string>();
  /** Việc đã xong cần cho người dùng biết (ví dụ hồ sơ xin vật tư vừa mở). */
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  /** Chặn ghi đè bằng kết quả của hồ sơ cũ khi đổi `instanceId` giữa chừng. */
  const current = useRef(instanceId);
  current.current = instanceId;

  const refresh = useCallback(async () => {
    const id = instanceId;
    const [fresh, files] = await Promise.all([
      loadProcedureInstance(id),
      loadProcedureAttachments(id).catch(() => [] as ProcedureAttachment[]),
    ]);
    if (current.current !== id) return;
    setInstance(fresh);
    setAttachments(files);
  }, [instanceId]);

  useEffect(() => {
    setInstance(undefined);
    setAttachments([]);
    setError(undefined);
    setNotice(undefined);
    setLoadFailed(false);
    let alive = true;
    void refresh().catch((cause: unknown) => {
      if (!alive) return;
      setLoadFailed(true);
      setError(cause instanceof Error ? cause.message : 'Không tải được hồ sơ.');
    });
    // Danh mục phụ chỉ phục vụ vài bước (vật tư, tài sản) và sơ đồ tổ chức để gắn tên người: thiếu quyền hay lỗi thì
    // bỏ qua, các phần còn lại vẫn dùng được.
    void Promise.all([
      loadOrganization().catch(() => undefined),
      loadMaterialCatalog().catch(() => [] as MaterialCatalogItem[]),
      loadAssetCatalog().catch(() => [] as AssetCatalogItem[]),
    ]).then(([org, materials, assets]) => {
      if (!alive) return;
      setOrganization(org);
      setMaterialCatalog(materials);
      setAssetCatalog(assets);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const needsDefinitions =
    instance?.authorization?.isOverride === true ||
    MATERIAL_STAGES.has(String(instance?.authorization?.currentRoleStage ?? ''));
  useEffect(() => {
    if (!needsDefinitions) return;
    let alive = true;
    // Thiếu danh sách thì chỉ không chọn được quy trình khi xin vật tư; các phần khác vẫn dùng được.
    void loadPublishedDefinitions().then(
      (loaded) => alive && setDefinitions(loaded),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [needsDefinitions]);

  /** Nạp lại hồ sơ sau khi đã ghi thành công; lỗi nạp chỉ nhắc người dùng mở lại, không biến thao tác thành thất bại. */
  const refreshAfterWrite = useCallback(async () => {
    try {
      await refresh();
    } catch {
      setError('Đã thực hiện nhưng chưa nạp lại được hồ sơ. Hãy đóng và mở lại hồ sơ để xem nội dung mới nhất.');
    }
  }, [refresh]);

  /**
   * Chạy một thao tác: báo bận, lỗi hiện ngay trên drawer, xong thì nạp lại đúng hồ sơ này.
   * Trả về thao tác có thành công không.
   */
  const perform = useCallback(
    async (key: string, operation: () => Promise<unknown>): Promise<boolean> => {
      try {
        setBusy(key);
        setError(undefined);
        setNotice(undefined);
        try {
          await operation();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Thao tác không thành công.');
          return false;
        }
        // Đã ghi xong: nạp lại hồ sơ lỗi thì không được báo là thao tác thất bại (người dùng sẽ làm lại và bị trùng).
        await refreshAfterWrite();
        return true;
      } finally {
        setBusy(undefined);
      }
    },
    [refreshAfterWrite],
  );

  const onAction = async (
    id: string,
    action: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
    attributeValues?: Record<string, ProcedureAttributeValue>,
  ) => {
    const done = await perform(`${action}:${id}`, () =>
      applyProcedureAction(id, action, comment, returnToStepId, attributeValues),
    );
    if (!done) return;
    if (action !== 'comment') onChanged?.();
    if (CLOSING_ACTIONS.has(action)) onClose();
  };

  const onDeleteInstance = async (id: string, reason: string) => {
    await deleteProcedureInstance(id, reason);
    onChanged?.();
    onClose();
  };

  const onRelinkWorkspace = async (id: string, input: RelinkProcedureWorkspaceRequest) => {
    await relinkProcedureWorkspace(id, input);
    await refreshAfterWrite();
    onChanged?.();
  };

  const onReverse = async (id: string, input: ReverseProcedureInstanceRequest) => {
    await reverseProcedureInstance(id, input);
    await refreshAfterWrite();
    onChanged?.();
  };

  /** Người khác vừa trao đổi: nạp lại đúng hồ sơ, lỗi mạng thì giữ bản đang hiện. */
  const onRefreshInstance = async () => {
    try {
      await refresh();
    } catch {
      // Cập nhật tiện lợi, lần thao tác kế tiếp sẽ nạp lại.
    }
  };

  return (
    <>
      {/* Không đóng khi bấm nền: bản nháp thuộc tính, ý kiến và tệp đang điền sẽ mất. Đóng bằng nút X. */}
      <div className={styles.backdrop} aria-hidden />
      <aside
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={instance ? `Xử lý hồ sơ ${instance.code}` : 'Xử lý hồ sơ'}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>Xử lý hồ sơ</h2>
            <p className={styles.subtitle}>{instance ? `${instance.code} · ${instance.title}` : 'Đang tải…'}</p>
          </div>
          <button type="button" className={styles.close} aria-label="Đóng" disabled={busy !== undefined} onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </header>
        {error ? (
          <p role="alert" className={`${styles.banner} ${styles.error}`}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={`${styles.banner} ${styles.notice}`}>
            {notice}
          </p>
        ) : null}
        <div className={styles.body}>
          {instance ? (
            <WorkspaceBoard
              embedded
              busy={busy}
              actorId={actor.id}
              actorName={actor.name}
              organization={organization}
              definitions={definitions}
              instances={[instance]}
              initialInstanceId={instance.id}
              canCreateInstances={false}
              canReverse={instance.authorization?.isOverride === true}
              materialCatalog={materialCatalog}
              assetCatalog={assetCatalog}
              attachments={attachments}
              onAction={onAction}
              onOpenDefinitions={() => undefined}
              onStart={() => Promise.reject(new Error('Không tạo hồ sơ mới từ đây.'))}
              onRefreshInstance={onRefreshInstance}
              onReverse={onReverse}
              onDeleteInstance={onDeleteInstance}
              onRelinkWorkspace={onRelinkWorkspace}
              onSaveAttributes={(id, values) =>
                perform('attributes', () => saveProcedureAttributeValues(id, values)).then(() => undefined)
              }
              onPickAsset={(id, assetCode) => void perform('asset', () => setProcedureInstanceAsset(id, assetCode))}
              onRequestMaterials={(id, input) =>
                void perform(`materials:${input.subtaskId}`, async () => {
                  const response = await requestProcedureMaterials(id, input);
                  const summary = response.opened.map((entry) => `${entry.code} (${entry.definitionName})`).join(', ');
                  setNotice(`Đã mở hồ sơ xin vật tư: ${summary}.`);
                  // Hồ sơ con mới mở: danh sách ngoài Dashboard cũng phải nạp lại.
                  onChanged?.();
                })
              }
              onSeedSubtasks={(id) => void perform('subtasks', () => setProcedureSubtasks(id))}
              onSetSubtasks={(id, items, mode) =>
                void perform('subtasks', () => setProcedureSubtasks(id, items, mode))
              }
              onRecheckMaterials={(id) => void perform('materials', () => recheckStepMaterials(id))}
              onCompleteSubtask={(id, subtaskId) =>
                void perform(`subtask-done:${subtaskId}`, () => completeProcedureSubtask(id, subtaskId))
              }
              onCancelSubtask={(id, subtaskId) =>
                void perform(`subtask-cancel:${subtaskId}`, () => cancelProcedureSubtask(id, subtaskId))
              }
              onUploadEvidence={(id, subtaskId, file) =>
                void perform(`upload:${subtaskId}`, () => uploadProcedureAttachment(id, file, subtaskId))
              }
              onUploadFile={async (id, file) => {
                // Báo lỗi lên để bảng KHÔNG chạy hành động khi tệp đính kèm chưa lên được.
                if (!(await perform('upload', () => uploadProcedureAttachment(id, file)))) {
                  throw new Error('Tải tệp lên không thành công.');
                }
              }}
              onSupplementFile={(id, file) =>
                void perform(`supplement:${id}`, () => uploadProcedureAttachment(id, file, undefined, true))
              }
              onSendComment={(id, body, mentions, replyToId) =>
                void perform('comment', () => postProcedureComment(id, body, mentions, replyToId))
              }
            />
          ) : (
            <p className={styles.state}>{loadFailed ? 'Không mở được hồ sơ này.' : 'Đang tải hồ sơ…'}</p>
          )}
        </div>
      </aside>
    </>
  );
}
