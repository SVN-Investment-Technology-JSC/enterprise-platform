'use client';

import type {
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureRuntimeAction,
} from '@enterprise-platform/contracts-procedure-engine';
import { useMemo, useState } from 'react';
import styles from './procedure-engine.module.scss';

type Filter = 'all' | 'running' | 'completed' | 'rejected';

interface WorkspaceBoardProps {
  busy?: string;
  definitions: ProcedureDefinition[];
  instances: ProcedureInstance[];
  onAction: (
    instanceId: string,
    action: ProcedureRuntimeAction,
    comment?: string,
  ) => Promise<void>;
  onOpenDefinitions: () => void;
  onStart: (definition: ProcedureDefinition) => Promise<void>;
}

const actionLabels: Record<ProcedureRuntimeAction, string> = {
  approve: 'Phê duyệt',
  reject: 'Từ chối',
  return: 'Trả lại',
  complete: 'Hoàn tất pha',
  cancel: 'Hủy hồ sơ',
  comment: 'Trao đổi',
};

export function WorkspaceBoard({
  busy,
  definitions,
  instances,
  onAction,
  onOpenDefinitions,
  onStart,
}: WorkspaceBoardProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const filtered = useMemo(
    () =>
      filter === 'all'
        ? instances
        : instances.filter((instance) => instance.status === filter),
    [filter, instances],
  );
  const published = definitions.filter(
    (definition) => definition.status === 'published',
  );

  return (
    <section className={styles.content}>
      <div className={styles.summaryGrid}>
        <article>
          <span>Đang xử lý</span>
          <strong>
            {instances.filter((item) => item.status === 'running').length}
          </strong>
          <small>phiên có bước hiện hành</small>
        </article>
        <article>
          <span>Đã hoàn thành</span>
          <strong>
            {instances.filter((item) => item.status === 'completed').length}
          </strong>
          <small>phiên kết thúc đầy đủ</small>
        </article>
        <article>
          <span>Procedure khả dụng</span>
          <strong>{published.length}</strong>
          <small>bản đã công bố</small>
        </article>
      </div>

      <div className={styles.workspaceToolbar}>
        <div className={styles.filters} aria-label="Lọc trạng thái">
          {(['all', 'running', 'completed', 'rejected'] as const).map(
            (value) => (
              <button
                aria-pressed={filter === value}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {
                  {
                    all: 'Tất cả',
                    running: 'Đang xử lý',
                    completed: 'Hoàn thành',
                    rejected: 'Từ chối',
                  }[value]
                }
              </button>
            ),
          )}
        </div>
        {published[0] ? (
          <button
            className={styles.primaryButton}
            disabled={busy === `start:${published[0].id}`}
            onClick={() => void onStart(published[0])}
            type="button"
          >
            + Tạo đơn mới
          </button>
        ) : null}
      </div>

      {filtered.length ? (
        <div className={styles.instanceList}>
          {filtered.map((instance) => (
            <InstanceCard
              busy={busy}
              instance={instance}
              key={instance.id}
              onAction={onAction}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <span>↗</span>
          <h2>Chưa có phiên quy trình phù hợp</h2>
          <p>
            Hãy công bố một định nghĩa có RCSI hợp lệ rồi khởi tạo hồ sơ đầu
            tiên.
          </p>
          <button
            className={styles.secondaryButton}
            onClick={onOpenDefinitions}
            type="button"
          >
            Mở thiết kế quy trình
          </button>
        </div>
      )}
    </section>
  );
}

function InstanceCard({
  busy,
  instance,
  onAction,
}: {
  busy?: string;
  instance: ProcedureInstance;
  onAction: WorkspaceBoardProps['onAction'];
}) {
  const current = instance.steps.find(
    (step) => step.id === instance.currentStepId,
  );
  const completed = instance.steps.filter(
    (step) => step.status === 'completed',
  ).length;
  const actions =
    instance.authorization?.availableActions.filter(
      (action) => action !== 'comment',
    ) ?? [];

  return (
    <article className={styles.instanceCard}>
      <header>
        <div>
          <span className={styles.code}>{instance.code}</span>
          <h2>{instance.title}</h2>
          <p>
            {instance.definitionName} · phiên bản {instance.definitionVersion}
          </p>
        </div>
        <span className={`${styles.status} ${styles[instance.status]}`}>
          {
            {
              running: 'Đang xử lý',
              completed: 'Hoàn thành',
              rejected: 'Từ chối',
              cancelled: 'Đã hủy',
            }[instance.status]
          }
        </span>
      </header>

      <div className={styles.progressTrack}>
        {instance.steps.map((step) => (
          <div className={styles.progressStep} key={step.id}>
            <span className={styles[step.status]} />
            <div>
              <small>Bước {step.order}</small>
              <strong>{step.name}</strong>
              <em>
                {step.currentRoleStage
                  ? `Pha ${step.currentRoleStage}`
                  : step.status}
              </em>
            </div>
          </div>
        ))}
      </div>

      <footer>
        <div>
          <span>
            Tiến độ {completed}/{instance.steps.length}
          </span>
          {current ? (
            <strong>
              Hiện tại: {current.name} · {current.currentRoleStage}
            </strong>
          ) : null}
        </div>
        <div className={styles.actions}>
          {actions.map((action) => (
            <button
              className={
                action === 'complete' || action === 'approve'
                  ? styles.primaryButton
                  : styles.secondaryButton
              }
              disabled={busy === `${action}:${instance.id}`}
              key={action}
              onClick={() => void onAction(instance.id, action)}
              type="button"
            >
              {busy === `${action}:${instance.id}`
                ? 'Đang xử lý…'
                : actionLabels[action]}
            </button>
          ))}
        </div>
      </footer>
    </article>
  );
}
