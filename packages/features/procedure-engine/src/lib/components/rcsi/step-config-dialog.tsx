'use client';

import type {
  ProcedureDefinition,
  ProcedureStepDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import { branchOfStep, type BranchTarget } from './flow-edit';
import styles from './flow-editors.module.scss';

export interface StepConfigChange {
  readonly slaHours?: number;
  readonly linkedDefinitionId?: string;
  /** undefined = không đổi nhánh; null = về trục chính. */
  readonly branch?: BranchTarget | null;
}

const TRUNK = '__trunk__';

/**
 * Cấu hình một bước: SLA, quy trình nối tiếp, nhánh chứa bước, và lối vào
 * thuộc tính. Gom vào một Dialog để hàng bước trên ma trận chỉ còn tên bước và
 * vài nút, không chen chúc ô nhập.
 */
export function StepConfigDialog({
  definition,
  step,
  linkTargets,
  readOnly,
  onClose,
  onSave,
  onOpenAttributes,
}: {
  definition: ProcedureDefinition;
  step: ProcedureStepDefinition;
  linkTargets: readonly ProcedureDefinition[];
  readOnly: boolean;
  onClose: () => void;
  onSave: (change: StepConfigChange) => void;
  onOpenAttributes: () => void;
}) {
  const current = branchOfStep(definition, step.id);
  const [sla, setSla] = useState(step.slaHours ? String(step.slaHours) : '');
  const [link, setLink] = useState(step.linkedDefinitionId ?? '');
  const [branch, setBranch] = useState(current ? `${current.gatewayId}:${current.branchId}` : TRUNK);
  const [error, setError] = useState<string>();

  // Bước đang có điểm rẽ nhánh đứng sau thì không đưa vào nhánh được: đó là
  // rẽ nhánh lồng nhau, chưa hỗ trợ.
  const hasGatewayAfter = (definition.gateways ?? []).some((gateway) => gateway.afterStepId === step.id);
  const branchOptions = useMemo(() => {
    const stepName = (id: string) => definition.steps.find((item) => item.id === id)?.name ?? '';
    return [
      { value: TRUNK, label: 'Trục chính (không thuộc nhánh nào)' },
      ...(definition.gateways ?? []).flatMap((gateway) =>
        gateway.branches.map((item) => ({
          value: `${gateway.id}:${item.id}`,
          label: item.label,
          description: `${gateway.name} · sau bước “${stepName(gateway.afterStepId)}”`,
          disabled: hasGatewayAfter || gateway.afterStepId === step.id,
        })),
      ),
    ];
  }, [definition, hasGatewayAfter, step.id]);

  const save = () => {
    const trimmed = sla.trim();
    const slaHours = trimmed ? Number(trimmed) : undefined;
    if (slaHours !== undefined && (!Number.isInteger(slaHours) || slaHours < 1 || slaHours > 8760)) {
      setError('SLA phải là số giờ nguyên từ 1 đến 8760.');
      return;
    }
    const previous = current ? `${current.gatewayId}:${current.branchId}` : TRUNK;
    let nextBranch: BranchTarget | null | undefined;
    if (branch !== previous) {
      if (branch === TRUNK) {
        nextBranch = null;
      } else {
        const [gatewayId = '', branchId = ''] = branch.split(':');
        nextBranch = { gatewayId, branchId };
      }
    }
    onSave({ slaHours, linkedDefinitionId: link || undefined, branch: nextBranch });
  };

  return (
    <MinimalPopupForm
      isOpen
      title={`Cấu hình bước “${step.name}”`}
      subtitle="SLA, quy trình nối tiếp, nhánh chứa bước và thuộc tính người thực hiện nhập."
      maxWidth="620px"
      onClose={onClose}
    >
      <div className={styles.editor}>
        <label className={styles.fieldRow}>
          <span>SLA (giờ)</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={sla}
            placeholder="Bỏ trống = bước không có SLA"
            disabled={readOnly}
            onChange={(event) => setSla(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </label>

        <div className={styles.fieldRow}>
          <span>Quy trình nối tiếp</span>
          <SearchableSelect
            options={linkTargets
              .filter((candidate) => candidate.id !== definition.id)
              .map((candidate) => ({ value: candidate.id, label: candidate.name, description: candidate.code }))}
            value={link}
            placeholder="Không nối tiếp"
            disabled={readOnly}
            onChange={setLink}
          />
          <small className={styles.hint}>Bước xong thì tự mở hồ sơ mới cho quy trình được chọn.</small>
        </div>

        {(definition.gateways ?? []).length ? (
          <div className={styles.fieldRow}>
            <span>Thuộc nhánh</span>
            <SearchableSelect
              options={branchOptions}
              value={branch}
              clearable={false}
              disabled={readOnly}
              onChange={(value) => setBranch(value || TRUNK)}
            />
            <small className={styles.hint}>
              {hasGatewayAfter
                ? 'Bước này có điểm rẽ nhánh đứng sau nên phải ở trục chính (chưa hỗ trợ rẽ nhánh lồng nhau).'
                : 'Bước được đặt vào cuối nhánh đã chọn. Về trục chính thì bước đứng ngay sau điểm hợp.'}
            </small>
          </div>
        ) : null}

        <div className={styles.fieldRow}>
          <span>Thuộc tính của bước</span>
          <button type="button" className={styles.linkButton} onClick={onOpenAttributes}>
            <ListChecks size={14} aria-hidden="true" />
            {step.attributes?.length ? `${step.attributes.length} thuộc tính — xem / sửa` : 'Khai báo thuộc tính'}
          </button>
        </div>

        {error ? <p className={styles.errorText}>{error}</p> : null}

        <footer className={styles.footer}>
          <span />
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              {readOnly ? 'Đóng' : 'Huỷ'}
            </button>
            {readOnly ? null : (
              <button type="button" className={styles.submitButton} onClick={save}>
                Lưu cấu hình
              </button>
            )}
          </div>
        </footer>
      </div>
    </MinimalPopupForm>
  );
}
