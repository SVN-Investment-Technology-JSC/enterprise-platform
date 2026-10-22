'use client';

import {
  formatAttributeValue,
  type ProcedureActivity,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeValue,
  type ProcedureInstance,
  type ProcedureInstanceStep,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, formatDateTime as formatSharedDateTime } from '@enterprise-platform/shared-ui';
import type { ReactNode } from 'react';
import { attributeSlots } from './attribute-form';
import styles from './step-detail-dialog.module.scss';

/** Thao tác chốt bước: người làm thao tác này là người thực hiện bước. */
const CLOSING_ACTIONS: ReadonlySet<ProcedureActivity['action']> = new Set(['complete', 'approve', 'reject', 'return']);

export interface StepDetail {
  /** Người chốt bước (hoàn tất, duyệt, từ chối, trả lại); bước đầu không có thì là người lập hồ sơ. */
  readonly performerName?: string;
  readonly performedAt?: string;
  readonly startedAt?: string;
  /** Thời gian từ lúc bước bắt đầu tới lúc chốt, dạng "2 giờ 15 phút". */
  readonly duration?: string;
  readonly sla?: { readonly onTime: boolean; readonly dueAt: string };
  /** Mọi thao tác ghi trên bước, cũ trước mới sau. */
  readonly activity: readonly ProcedureActivity[];
  /** Giá trị nhập ở bước: ô riêng của bước và ô chung được nhập trong khoảng thời gian của bước. */
  readonly values: readonly {
    readonly key: string;
    readonly definition: ProcedureAttributeDefinition;
    readonly value: ProcedureAttributeValue;
    readonly scopeLabel: string;
  }[];
}

export function formatDuration(fromIso: string, toIso: string): string | undefined {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return undefined;
  if (minutes < 1) return 'dưới 1 phút';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days ? `${days} ngày` : '', hours ? `${hours} giờ` : '', rest && !days ? `${rest} phút` : '']
    .filter(Boolean)
    .join(' ');
}

export function stepDetail(instance: ProcedureInstance, step: ProcedureInstanceStep): StepDetail {
  const activity = instance.activity
    .filter((entry) => entry.stepInstanceId === step.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const closing = [...activity].reverse().find((entry) => CLOSING_ACTIONS.has(entry.action));
  const isFirst = Math.min(...instance.steps.map((item) => item.order)) === step.order;
  const start = isFirst ? instance.activity.find((entry) => entry.action === 'start') : undefined;
  const performer = closing ?? start;
  const performedAt = closing?.createdAt ?? step.completedAt ?? start?.createdAt;
  const startedAt = step.startedAt ?? (isFirst ? instance.startedAt : undefined);

  const from = startedAt ? Date.parse(startedAt) : Number.NEGATIVE_INFINITY;
  const to = performedAt ? Date.parse(performedAt) : Number.POSITIVE_INFINITY;
  const stepPrefix = `step:${step.definitionStepId}:`;
  const values = attributeSlots(instance).flatMap((slot) => {
    const record = instance.attributeValues?.[slot.key];
    if (!record) return [];
    const enteredAt = Date.parse(record.enteredAt);
    // Server ghi giá trị cùng mốc `now` với thao tác chốt bước trước, cũng là lúc bước này bắt đầu:
    // mốc bắt đầu phải loại trừ, không thì giá trị bước trước nhập lọt sang bước này. Bước đầu thì
    // giá trị nhập lúc lập hồ sơ trùng đúng mốc bắt đầu nên tính cả mốc đó.
    const afterStart = isFirst ? enteredAt >= from : enteredAt > from;
    const belongs = slot.key.startsWith(stepPrefix) || (afterStart && enteredAt <= to);
    return belongs ? [{ ...slot, value: record.value }] : [];
  });

  return {
    performerName: performer?.actorName,
    performedAt,
    startedAt,
    duration: startedAt && performedAt ? formatDuration(startedAt, performedAt) : undefined,
    sla:
      step.slaDueAt && performedAt
        ? { onTime: Date.parse(performedAt) <= Date.parse(step.slaDueAt), dueAt: step.slaDueAt }
        : undefined,
    activity,
    values,
  };
}

function formatDateTime(value?: string): string {
  return formatSharedDateTime(value, '—');
}

/**
 * Popup xem lại một bước đã đi qua: ai làm, làm lúc nào, mất bao lâu, đã nhập
 * gì và đã thao tác gì. Chỉ đọc; xử lý bước đang chạy vẫn ở khung chi tiết.
 */
export function StepDetailDialog({
  instance,
  step,
  statusLabel,
  roles,
  extra,
  onClose,
}: {
  instance: ProcedureInstance;
  step: ProcedureInstanceStep;
  statusLabel: string;
  /** Dòng vai RACI của bước, dựng sẵn ở timeline để hiện cùng một kiểu. */
  roles: ReactNode;
  /** Phần riêng của bước như phiếu Tài chính, tài liệu đã nộp. */
  extra?: ReactNode;
  onClose: () => void;
}) {
  const detail = stepDetail(instance, step);

  return (
    <MinimalPopupForm
      isOpen
      title={`Bước ${step.order} · ${step.name}`}
      subtitle={`${instance.code} · ${instance.title}`}
      maxWidth={680}
      onClose={onClose}
    >
      <div className={styles.body}>
        <dl className={styles.facts}>
          <div>
            <dt>Trạng thái</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div>
            <dt>Người thực hiện</dt>
            <dd>{detail.performerName ?? '—'}</dd>
          </div>
          <div>
            <dt>Ngày thực hiện</dt>
            <dd>{formatDateTime(detail.performedAt)}</dd>
          </div>
          <div>
            <dt>Bắt đầu bước</dt>
            <dd>{formatDateTime(detail.startedAt)}</dd>
          </div>
          <div>
            <dt>Thời gian xử lý</dt>
            <dd>{detail.duration ?? '—'}</dd>
          </div>
          <div>
            <dt>Hạn xử lý</dt>
            <dd>
              {detail.sla ? (
                <>
                  {formatDateTime(detail.sla.dueAt)}{' '}
                  <span className={detail.sla.onTime ? styles.onTime : styles.late}>
                    {detail.sla.onTime ? 'Đúng hạn' : 'Trễ hạn'}
                  </span>
                </>
              ) : step.slaHours ? (
                `${step.slaHours} giờ`
              ) : (
                'Không đặt hạn'
              )}
            </dd>
          </div>
        </dl>

        <section className={styles.section}>
          <h3>Phân công</h3>
          <div className={styles.roles}>{roles}</div>
        </section>

        {detail.values.length ? (
          <section className={styles.section}>
            <h3>Thông tin đã nhập</h3>
            <dl className={styles.values}>
              {detail.values.map((item) => (
                <div key={item.key}>
                  <dt>
                    {item.definition.name} <small>{item.scopeLabel}</small>
                  </dt>
                  <dd>{formatAttributeValue(item.value, item.definition)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {extra}

        <section className={styles.section}>
          <h3>Thao tác tại bước</h3>
          {detail.activity.length ? (
            <ol className={styles.activity}>
              {detail.activity.map((entry) => (
                <li key={entry.id}>
                  <div className={styles.activityHead}>
                    <strong>{entry.actorName}</strong>
                    <span>{entry.summary}</span>
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  </div>
                  {entry.comment ? <p className={styles.comment}>{entry.comment}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>Chưa có thao tác nào được ghi ở bước này.</p>
          )}
        </section>
      </div>
    </MinimalPopupForm>
  );
}
