'use client';

import type {
  FinanceVoucherSourceField,
  ProcedureDefinition,
  ProcedureFinanceVoucherKind,
  ProcedureStepDefinition,
  ProcedureStepIntegration,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES,
  FINANCE_VOUCHER_SOURCE_FIELD_LABELS,
  FINANCE_VOUCHER_SOURCE_FIELDS,
  PROCEDURE_FINANCE_VOUCHER_KIND_LABELS,
  PROCEDURE_FINANCE_VOUCHER_KINDS,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { Landmark, ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  autoMatchedCandidate,
  candidatesForField,
  cleanIntegration,
  financeAttributeCandidates,
  financeReturnTargets,
} from './finance-step';
import { branchOfStep, type BranchTarget } from './flow-edit';
import styles from './flow-editors.module.scss';

export interface StepConfigChange {
  readonly slaHours?: number;
  readonly linkedDefinitionId?: string;
  /** undefined = không đổi nhánh; null = về trục chính. */
  readonly branch?: BranchTarget | null;
  /** Cấu hình bước Tài chính; undefined = bước thường. */
  readonly integration?: ProcedureStepIntegration;
}

const TRUNK = '__trunk__';
/** Giá trị của ô ánh xạ khi để server tự khớp theo mã chuẩn. */
const AUTO = '';
/** Vai được phép ở bước Tài chính: không có pha nào cần người bấm hoàn thành. */
const FINANCE_ALLOWED_ROLES = new Set(['R', 'I']);

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
  const [finance, setFinance] = useState<ProcedureStepIntegration | undefined>(step.integration);

  const financeCandidates = useMemo(() => financeAttributeCandidates(definition, step.id), [definition, step.id]);
  const returnTargets = useMemo(() => financeReturnTargets(definition, step.id), [definition, step.id]);
  const extraRoles = [...new Set(step.assignments.map((item) => item.role))].filter((role) => !FINANCE_ALLOWED_ROLES.has(role));
  const setMapping = (field: FinanceVoucherSourceField, key: string) =>
    setFinance((current) => (current ? { ...current, mapping: { ...current.mapping, [field]: key || undefined } } : current));

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
    onSave({
      slaHours,
      linkedDefinitionId: link || undefined,
      branch: nextBranch,
      integration: finance ? cleanIntegration(finance) : undefined,
    });
  };

  return (
    <MinimalPopupForm
      isOpen
      title={`Cấu hình bước “${step.name}”`}
      subtitle="SLA, quy trình nối tiếp, nhánh chứa bước, thuộc tính người thực hiện nhập và bước Tài chính."
      maxWidth="720px"
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

        <div className={styles.financeSection}>
          <label className={styles.financeToggle}>
            <input
              type="checkbox"
              checked={Boolean(finance)}
              disabled={readOnly}
              onChange={(event) =>
                setFinance(event.target.checked ? { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' } : undefined)
              }
            />
            <Landmark size={14} aria-hidden="true" />
            <span>Bước Tài chính</span>
          </label>
          <small className={styles.hint}>
            Khi hồ sơ tới bước này, module Tài chính tự tạo phiếu nháp từ thuộc tính của hồ sơ. Bước chỉ đóng khi kế toán ghi
            sổ; kế toán trả hồ sơ thì hồ sơ quay về bước đã chọn bên dưới.
          </small>

          {finance ? (
            <>
              <div className={styles.fieldRow}>
                <span>Loại phiếu</span>
                <SearchableSelect
                  options={PROCEDURE_FINANCE_VOUCHER_KINDS.map((kind) => ({
                    value: kind,
                    label: PROCEDURE_FINANCE_VOUCHER_KIND_LABELS[kind],
                  }))}
                  value={finance.voucherKind}
                  clearable={false}
                  disabled={readOnly}
                  onChange={(value) =>
                    setFinance((current) =>
                      current && value ? { ...current, voucherKind: value as ProcedureFinanceVoucherKind } : current,
                    )
                  }
                />
              </div>

              <div className={styles.fieldRow}>
                <span>Lấy dữ liệu phiếu từ thuộc tính hồ sơ</span>
                <div className={styles.mappingTable}>
                  {FINANCE_VOUCHER_SOURCE_FIELDS.map((field) => {
                    const auto = autoMatchedCandidate(field, financeCandidates);
                    const codes = FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES[field].join(', ');
                    const autoLabel = auto
                      ? `Tự khớp theo mã chuẩn: ${auto.attribute.name} (${auto.attribute.code})`
                      : `Tự khớp theo mã chuẩn (${codes}): chưa có thuộc tính khớp`;
                    return (
                      <div key={field} className={styles.mappingRow}>
                        <span className={styles.mappingLabel}>
                          {FINANCE_VOUCHER_SOURCE_FIELD_LABELS[field]}
                          {field === 'amount' ? <em> *</em> : null}
                        </span>
                        <SearchableSelect
                          options={[
                            { value: AUTO, label: autoLabel },
                            ...candidatesForField(field, financeCandidates).map((candidate) => ({
                              value: candidate.key,
                              label: candidate.attribute.name,
                              description: `${candidate.attribute.code} · ${candidate.scopeLabel}`,
                            })),
                          ]}
                          value={finance.mapping?.[field] ?? AUTO}
                          clearable={false}
                          disabled={readOnly}
                          onChange={(value) => setMapping(field, value)}
                        />
                      </div>
                    );
                  })}
                </div>
                <small className={styles.hint}>
                  Chỉ liệt kê thuộc tính cấp quy trình hoặc của bước chắc chắn đã đi qua trước bước này. Số tiền là bắt buộc;
                  các trường khác bỏ trống thì kế toán tự nhập trên phiếu.
                </small>
              </div>

              <div className={styles.fieldRow}>
                <span>Khi kế toán trả hồ sơ, chuyển về bước</span>
                <SearchableSelect
                  options={returnTargets.map((target) => ({ value: target.id, label: target.name, description: target.key }))}
                  value={finance.returnToStepId ?? ''}
                  placeholder="Bước liền trước trên đường đã đi"
                  disabled={readOnly}
                  onChange={(value) =>
                    setFinance((current) => (current ? { ...current, returnToStepId: value || undefined } : current))
                  }
                />
              </div>

              {extraRoles.length ? (
                <p className={styles.warning}>
                  Bước Tài chính chỉ được có vai R (người ghi sổ) và I (người được báo). Bước này đang có vai{' '}
                  {extraRoles.join(', ')}; hãy bỏ trước khi công bố.
                </p>
              ) : (
                <small className={styles.hint}>
                  Giao vai R cho chức danh kế toán hoặc thủ quỹ. Người ghi sổ cần thêm quyền ghi sổ phiếu tương ứng bên Tài chính.
                </small>
              )}
            </>
          ) : null}
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
