'use client';

import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type {
  ProcedureManagerFallback,
  ProcedureRaciAssignment,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import styles from './flow-editors.module.scss';

const DYNAMIC_ROLES: readonly { value: ProcedureRaciRole; label: string }[] = [
  { value: 'A', label: 'A — Phê duyệt' },
  { value: 'C', label: 'C — Kiểm soát' },
  { value: 'R', label: 'R — Xem xét' },
  { value: 'I', label: 'I — Nhận thông tin' },
];

/**
 * Gán vai cho "Quản lý trực tiếp của người khởi tạo".
 *
 * Không nằm trên một cột của ma trận vì nó không trỏ vào chức danh cố định: hệ
 * thống tính ra người duyệt lúc bước được kích hoạt, theo quan hệ "Báo cáo cho".
 * Người dự phòng là bắt buộc — dùng khi leo tới gốc cây vẫn không có ai.
 */
export function DynamicApproverEditor({
  stepName,
  current,
  organization,
  onClose,
  onSave,
}: {
  stepName: string;
  current?: ProcedureRaciAssignment;
  organization?: TenantOrganizationSnapshot;
  onClose: () => void;
  onSave: (next: { role: ProcedureRaciRole; managerFallback: ProcedureManagerFallback } | undefined) => void;
}) {
  const [role, setRole] = useState<ProcedureRaciRole>(current?.role ?? 'A');
  const [fallback, setFallback] = useState(
    current?.managerFallback ? `${current.managerFallback.subjectType}:${current.managerFallback.subjectId}` : '',
  );
  const options = useMemo(() => {
    const unitName = new Map((organization?.units ?? []).map((unit) => [unit.id, unit.name]));
    const positions = (organization?.positions ?? []).map((position) => ({
      value: `position:${position.id}`,
      label: position.name,
      description: `Chức danh · ${unitName.get(position.unitId) ?? ''}`,
    }));
    const seen = new Set<string>();
    const users = (organization?.members ?? [])
      .filter((member) => !seen.has(member.userId) && seen.add(member.userId))
      .map((member) => ({ value: `user:${member.userId}`, label: member.displayName, description: 'Người dùng' }));
    return [...positions, ...users];
  }, [organization]);

  const save = () => {
    const [subjectType, ...rest] = fallback.split(':');
    const subjectId = rest.join(':');
    if (!subjectId || (subjectType !== 'position' && subjectType !== 'user')) return;
    onSave({
      role,
      managerFallback: {
        subjectType,
        subjectId,
        subjectLabel: options.find((option) => option.value === fallback)?.label,
      },
    });
  };

  return (
    <MinimalPopupForm
      isOpen
      title="Quản lý trực tiếp của người khởi tạo"
      subtitle={`Bước “${stepName}”: người duyệt được tính lúc bước bắt đầu, theo quan hệ “Báo cáo cho” của chức danh người khởi tạo. Chức danh trống thì hệ thống tự leo lên cấp trên.`}
      maxWidth="560px"
      onClose={onClose}
    >
      <div className={styles.editor}>
        <label className={styles.fieldRow}>
          <span>Vai trò</span>
          <SearchableSelect
            options={DYNAMIC_ROLES}
            value={role}
            clearable={false}
            onChange={(next) => setRole(next as ProcedureRaciRole)}
          />
        </label>
        <label className={styles.fieldRow}>
          <span>
            Người dự phòng <em>*</em>
          </span>
          <SearchableSelect
            options={options}
            value={fallback}
            placeholder="Chọn chức danh hoặc người dùng…"
            onChange={setFallback}
          />
          <small className={styles.hint}>
            Dùng khi người khởi tạo là người đứng đầu cây, hoặc cả chuỗi quản lý đều trống.
          </small>
        </label>
        <footer className={styles.footer}>
          {current ? (
            <button type="button" className={styles.dangerButton} onClick={() => onSave(undefined)}>
              Bỏ người duyệt động
            </button>
          ) : (
            <span />
          )}
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Huỷ
            </button>
            <button type="button" className={styles.submitButton} disabled={!fallback} onClick={save}>
              Lưu
            </button>
          </div>
        </footer>
      </div>
    </MinimalPopupForm>
  );
}
