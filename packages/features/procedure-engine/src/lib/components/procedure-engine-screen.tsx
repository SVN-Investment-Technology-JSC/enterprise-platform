'use client';

import type {
  ProcedureDefinition,
  ProcedureRuntimeAction,
  ProcedureWorkspace,
} from '@enterprise-platform/contracts-procedure-engine';
import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { useCallback, useEffect, useState } from 'react';
import {
  applyProcedureAction,
  loadProcedureWorkspace,
  startProcedureInstance,
} from '../procedure-api';
import { createOrganizationUnit, deleteOrganizationUnit, loadOrganization } from '../organization-api';
import { OrganizationBoard } from './organization-board';
import { RcsiBoard } from './rcsi-board';
import { WorkspaceBoard } from './workspace-board';
import styles from './procedure-engine.module.scss';

type View = 'workspace' | 'raci' | 'org-chart';

const vietnameseDateFormatter = new Intl.DateTimeFormat('vi-VN');

export function ProcedureEngineScreen() {
  const [view, setView] = useState<View>('workspace');
  const [workspace, setWorkspace] = useState<ProcedureWorkspace>();
  const [organization, setOrganization] = useState<TenantOrganizationSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [procedureData, organizationData] = await Promise.all([
        loadProcedureWorkspace(),
        loadOrganization(),
      ]);
      setWorkspace(procedureData);
      setOrganization(organizationData);
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
  ) =>
    perform(`${nextAction}:${instanceId}`, () =>
      applyProcedureAction(instanceId, nextAction, comment),
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
          <p>Tích hợp Platform</p>
          <button className={view === 'org-chart' ? styles.activeNav : undefined} onClick={() => navigate('org-chart')} type="button"><span>03</span> Sơ đồ tổ chức</button>
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
          <div className={styles.actor}>
            <span>
              {workspace?.actor.name.slice(0, 1).toUpperCase() ?? '…'}
            </span>
            <div>
              <strong>{workspace?.actor.name ?? 'Đang tải'}</strong>
              <small>Tenant user · quyền do Platform Core cấp</small>
            </div>
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
            definitions={workspace.definitions}
            instances={workspace.instances}
            onAction={action}
            onOpenDefinitions={() => navigate('raci')}
            onStart={start}
          />
        ) : view === 'raci' ? (
          <RcsiBoard definitions={workspace.definitions} organization={organization} />
        ) : organization ? (
          <OrganizationBoard organization={organization} canManage={workspace.permissions.canManageDefinitions} busy={busy}
            onCreate={(input) => perform('create-unit', () => createOrganizationUnit(input))}
            onDelete={(id) => perform(`delete-unit:${id}`, () => deleteOrganizationUnit(id))}/>
        ) : <section className={styles.loading}><span/><p>Đang nạp cơ cấu tổ chức…</p></section>}
      </main>
    </div>
  );
}
