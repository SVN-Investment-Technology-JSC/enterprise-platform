'use client';

import type {
  ProcedureAttachment,
  ProcedureDefinition,
  ProcedureRuntimeAction,
  ProcedureWorkspace,
} from '@enterprise-platform/contracts-procedure-engine';
import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useState } from 'react';
import {
  applyProcedureAction,
  cancelProcedureSubtask,
  completeProcedureSubtask,
  createProcedureDefinition,
  loadProcedureAttachments,
  deleteProcedureDefinition,
  loadMaterialCatalog,
  recheckStepMaterials,
  loadProcedureWorkspace,
  loadTenantHomePath,
  publishProcedureDefinition,
  reviseProcedureDefinition,
  setProcedureCategory,
  postProcedureComment,
  setProcedureSubtasks,
  uploadProcedureAttachment,
  updateProcedureDefinition,
  startProcedureInstance,
} from '../procedure-api';
import { loadOrganization } from '../organization-api';
import { OrganizationBoard } from './organization-board';
import { RcsiBoard } from './rcsi-board';
import { WorkspaceBoard } from './workspace-board';
import styles from './procedure-engine.module.scss';

type View = 'workspace' | 'raci' | 'org-chart';

const vietnameseDateFormatter = new Intl.DateTimeFormat('vi-VN');

export function ProcedureEngineScreen() {
  const [view, setView] = useState<View>('workspace');
  const [workspace, setWorkspace] = useState<ProcedureWorkspace>();
  const [organization, setOrganization] = useState<TenantOrganizationContext>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [attachments, setAttachments] = useState<ProcedureAttachment[]>([]);
  const [homePath, setHomePath] = useState('/');
  const [materialCatalog, setMaterialCatalog] = useState<
    { code: string; name: string; unit: string }[]
  >([]);

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [procedureData, organizationData, materials] = await Promise.all([
        loadProcedureWorkspace(),
        loadOrganization(),
        loadMaterialCatalog(),
      ]);
      setWorkspace(procedureData);
      setOrganization(organizationData);
      setMaterialCatalog(materials);

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
    const syncHash = () => {
      const hash = window.location.hash.slice(1) as View;
      setView(['workspace','raci','org-chart'].includes(hash) ? hash : 'workspace');
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    void reload();
    void loadTenantHomePath().then(setHomePath);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [reload]);

  const navigate = (next: View) => {
    window.location.hash = next;
    setView(next);
  };

  const perform = useCallback(
    async (key: string, operation: () => Promise<unknown>) => {
      try {
        setBusy(key);
        setError(undefined);
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

  const start = (definition: ProcedureDefinition) =>
    perform(`start:${definition.id}`, () =>
      startProcedureInstance(
        definition.id,
        `${definition.name} · ${vietnameseDateFormatter.format(new Date())}`,
      ),
    );

  const action = (
    instanceId: string,
    nextAction: ProcedureRuntimeAction,
    comment?: string,
    returnToStepId?: string,
  ) =>
    perform(`${nextAction}:${instanceId}`, () =>
      applyProcedureAction(instanceId, nextAction, comment, returnToStepId),
    );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>PE</span>
          <div>
            <strong>Procedure Engine</strong>
            <span>Enterprise Platform</span>
          </div>
        </div>

        <nav
          aria-label="Điều hướng Procedure Engine"
          className={styles.navigation}
        >
          <p>Người dùng</p>
          <button
            className={view === 'workspace' ? styles.activeNav : undefined}
            onClick={() => navigate('workspace')}
            type="button"
          >
            <span>01</span> Workspace
          </button>
          <p>Thiết kế</p>
          <button
            className={view === 'raci' ? styles.activeNav : undefined}
            onClick={() => navigate('raci')}
            type="button"
          >
            <span>02</span> Ma trận RCSI
          </button>
          <button className={view === 'org-chart' ? styles.activeNav : undefined} onClick={() => navigate('org-chart')} type="button"><span>03</span> Sơ đồ tổ chức</button>
          <a className={styles.backLink} href={homePath}>← Trang chủ</a>
        </nav>

        <div className={styles.tenantCard}>
          <span>Dữ liệu tenant</span>
          <strong>{workspace?.tenantId ?? 'Đang kết nối…'}</strong>
          <small>Dedicated database boundary</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Vertical slice 01</span>
            <h1>
              {view === 'workspace' ? 'Workspace xử lý' : view === 'raci' ? 'Ma trận RCSI' : 'Sơ đồ tổ chức'}
            </h1>
          </div>
          <div className={styles.sessionActions}>
            <div className={styles.actor}>
              <span>
                {workspace?.actor.name.slice(0, 1).toUpperCase() ?? '…'}
              </span>
              <div>
                <strong>{workspace?.actor.name ?? 'Đang tải'}</strong>
                <small>Tenant user · quyền do Platform Core cấp</small>
              </div>
            </div>
            <SessionLogoutButton portal="tenant" />
          </div>
        </header>

        {error ? (
          <div className={styles.error} role="alert">
            <strong>Không thể hoàn tất yêu cầu</strong>
            <span>{error}</span>
            <button onClick={() => void reload()} type="button">
              Thử lại
            </button>
          </div>
        ) : null}

        {!workspace ? (
          <section className={styles.loading} aria-live="polite">
            <span />
            <p>Đang nạp không gian Procedure Engine…</p>
          </section>
        ) : view === 'workspace' ? (
          <WorkspaceBoard
            busy={busy}
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
            onSendComment={(instanceId, body, mentions) =>
              perform('comment', () => postProcedureComment(instanceId, body, mentions))
            }
          />
        ) : view === 'raci' ? (
          <RcsiBoard
            definitions={workspace.definitions}
            organization={organization}
            materialCatalog={materialCatalog}
            onDeleteDefinition={(definitionId) =>
              perform('delete-definition', () => deleteProcedureDefinition(definitionId))
            }
            busy={Boolean(busy)}
            canDesign={workspace.permissions.canManageDefinitions}
            onCreateDefinition={(input) =>
              perform('create-definition', () =>
                createProcedureDefinition({
                  ...input,
                  // Quy trình mới luôn có sẵn bước 1: bản nháp phải có ít nhất một bước.
                  steps: [{ key: 'B1', order: 1, name: 'Bước 1', assignments: [] }],
                }),
              )
            }
            onUpdateDefinition={(id, steps) =>
              perform(`update:${id}`, () => updateProcedureDefinition(id, steps))
            }
            onSetDefinitionCategory={(id, category) =>
              perform(`category:${id}`, () => setProcedureCategory(id, category))
            }
            onPublishDefinition={(id) =>
              perform(`publish:${id}`, () => publishProcedureDefinition(id))
            }
            onReviseDefinition={(id) =>
              perform(`revise:${id}`, () => reviseProcedureDefinition(id))
            }
          />
        ) : organization ? (
          <OrganizationBoard organization={organization} />
        ) : <section className={styles.loading}><span/><p>Đang nạp cơ cấu tổ chức…</p></section>}
      </main>
    </div>
  );
}
