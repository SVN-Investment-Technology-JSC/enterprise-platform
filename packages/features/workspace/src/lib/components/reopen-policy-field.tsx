'use client';

import {
  DEFAULT_WORK_ITEM_REOPEN_POLICY,
  WORK_ITEM_REOPEN_POLICIES,
  type WorkItemReopenPolicy,
} from '@enterprise-platform/contracts-workspace';
import { RotateCcw } from 'lucide-react';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Label } from './form-controls';

export const REOPEN_POLICY_LABELS: Record<WorkItemReopenPolicy, string> = {
  assignee: 'Người thực hiện và quản lý được hoàn tác',
  manager: 'Chỉ quản lý dự án được hoàn tác',
  none: 'Không cho hoàn tác',
};

export const reopenPolicyOf = (policy: WorkItemReopenPolicy | undefined): WorkItemReopenPolicy =>
  policy ?? DEFAULT_WORK_ITEM_REOPEN_POLICY;

/**
 * Ai được hoàn tác công việc sau khi hoàn thành — do người tạo việc chọn. Cùng cách trình bày với khối điều kiện
 * hoàn thành: chỉ chọn, không gõ.
 */
export function ReopenPolicyField({
  idPrefix,
  value,
  onChange,
  readOnly = false,
  readOnlyReason,
}: {
  readonly idPrefix: string;
  readonly value: WorkItemReopenPolicy;
  readonly onChange: (next: WorkItemReopenPolicy) => void;
  readonly readOnly?: boolean;
  readonly readOnlyReason?: string;
}) {
  return (
    <div className={styles.reopenField}>
      <div className={styles.reopenText}>
        <Label className={styles.reopenLabel}>
          <RotateCcw size={14} aria-hidden="true" /> Hoàn tác sau khi hoàn thành
        </Label>
        {readOnly && readOnlyReason ? <p className={styles.fieldHint}>{readOnlyReason}</p> : null}
      </div>
      <div className={styles.reopenChoice}>
        <Choice
          label={`Quy định hoàn tác (${idPrefix})`}
          value={value}
          height={36}
          selectOnly
          disabled={readOnly}
          options={WORK_ITEM_REOPEN_POLICIES.map((policy) => ({
            value: policy,
            label: REOPEN_POLICY_LABELS[policy],
          }))}
          onChange={(policy) => onChange(policy as WorkItemReopenPolicy)}
        />
      </div>
    </div>
  );
}
