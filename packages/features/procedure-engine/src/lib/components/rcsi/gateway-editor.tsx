'use client';

import {
  PROCEDURE_OPERATORS_BY_TYPE,
  PROCEDURE_OPERATOR_LABELS,
  buildFlowIndex,
  describeConditionRule,
  dominatorStepIds,
  findBranchOverlaps,
  isCodeList,
  operatorNeedsUpperBound,
  operatorNeedsValue,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeRef,
  type ProcedureBranchDefinition,
  type ProcedureConditionRule,
  type ProcedureDefinition,
  type ProcedureGatewayDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { MinimalPopupForm, Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flowRowInfo } from './flow-edit';
import styles from './flow-editors.module.scss';

interface AttributeChoice {
  readonly value: string;
  readonly ref: ProcedureAttributeRef;
  readonly definition: ProcedureAttributeDefinition;
  readonly label: string;
  readonly description: string;
}

const refValue = (ref: ProcedureAttributeRef) =>
  ref.scope === 'process' ? `process:${ref.code}` : `step:${ref.stepId}:${ref.code}`;

let localCounter = 0;
const localId = () => `new-${Date.now().toString(36)}-${(localCounter += 1)}`;

/**
 * Thuộc tính được dùng làm điều kiện: của quy trình, hoặc của bước CHẮC CHẮN
 * đã đi qua trước điểm rẽ nhánh (cùng luật server kiểm lúc công bố).
 */
function attributeChoices(definition: ProcedureDefinition, afterStepId: string): AttributeChoice[] {
  const index = buildFlowIndex(definition.steps, definition.gateways);
  const allowed = dominatorStepIds(index, afterStepId);
  allowed.add(afterStepId);
  const rows = flowRowInfo(definition);
  const choices: AttributeChoice[] = (definition.attributes ?? []).map((attribute) => {
    const ref: ProcedureAttributeRef = { scope: 'process', code: attribute.code };
    return { value: refValue(ref), ref, definition: attribute, label: attribute.name, description: 'Thuộc tính quy trình' };
  });
  for (const step of [...definition.steps].sort((left, right) => left.order - right.order)) {
    if (!allowed.has(step.id)) continue;
    for (const attribute of step.attributes ?? []) {
      const ref: ProcedureAttributeRef = { scope: 'step', stepId: step.id, code: attribute.code };
      choices.push({ value: refValue(ref), ref, definition: attribute, label: attribute.name, description: `Bước ${rows.get(step.id)?.label ?? step.order} · ${step.name}` });
    }
  }
  return choices;
}

function ValueInput({
  attribute,
  value,
  onChange,
}: {
  attribute: ProcedureAttributeDefinition;
  value: ProcedureConditionRule['value'] | undefined;
  onChange: (next: ProcedureConditionRule['value'] | undefined) => void;
}) {
  if (attribute.type === 'select') {
    const options = (attribute.options ?? []).map((option) => ({ value: option.code, label: option.label }));
    return (
      <SearchableSelect
        options={options}
        value={typeof value === 'string' ? value : ''}
        placeholder="Chọn giá trị…"
        onChange={(next) => onChange(next || undefined)}
      />
    );
  }
  if (attribute.type === 'boolean') {
    return (
      <SearchableSelect
        options={[
          { value: 'true', label: 'Có' },
          { value: 'false', label: 'Không' },
        ]}
        value={value === true ? 'true' : value === false ? 'false' : ''}
        clearable={false}
        onChange={(next) => onChange(next === 'true')}
      />
    );
  }
  if (attribute.type === 'date') {
    return (
      <input
        className={styles.input}
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  }
  return (
    <input
      className={styles.input}
      inputMode="decimal"
      placeholder={attribute.type === 'money' ? 'Số tiền (đ)' : attribute.type === 'percent' ? '%' : 'Số'}
      defaultValue={typeof value === 'number' ? new Intl.NumberFormat('vi-VN').format(value) : ''}
      key={typeof value === 'number' ? String(value) : 'empty'}
      onBlur={(event) => {
        const cleaned = event.target.value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
        const parsed = cleaned ? Number(cleaned) : undefined;
        onChange(parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined);
      }}
    />
  );
}

function RuleRow({
  rule,
  choices,
  onChange,
  onRemove,
}: {
  rule: ProcedureConditionRule;
  choices: readonly AttributeChoice[];
  onChange: (next: ProcedureConditionRule) => void;
  onRemove: () => void;
}) {
  const choice = choices.find((item) => item.value === refValue(rule.attribute));
  const operators = choice ? PROCEDURE_OPERATORS_BY_TYPE[choice.definition.type] : [];
  const multiSelect = rule.operator === 'in' && choice?.definition.type === 'select';
  return (
    <div className={styles.ruleRow}>
      <SearchableSelect
        options={choices.map((item) => ({ value: item.value, label: item.label, description: item.description }))}
        value={choice?.value ?? ''}
        placeholder="Thuộc tính…"
        clearable={false}
        onChange={(next) => {
          const picked = choices.find((item) => item.value === next);
          if (!picked) return;
          const allowed = PROCEDURE_OPERATORS_BY_TYPE[picked.definition.type];
          onChange({
            ...rule,
            attribute: picked.ref,
            operator: allowed.includes(rule.operator) ? rule.operator : (allowed[0] ?? 'not_empty'),
            value: undefined,
            valueTo: undefined,
          });
        }}
      />
      <SearchableSelect
        options={operators.map((operator) => ({ value: operator, label: PROCEDURE_OPERATOR_LABELS[operator] }))}
        value={rule.operator}
        clearable={false}
        disabled={!choice}
        onChange={(next) =>
          onChange({ ...rule, operator: next as ProcedureConditionRule['operator'], value: undefined, valueTo: undefined })
        }
      />
      <div className={styles.ruleValue}>
        {!choice || !operatorNeedsValue(rule.operator) ? null : multiSelect ? (
          <div className={styles.checkList}>
            {(choice.definition.options ?? []).map((option) => {
              const current = isCodeList(rule.value) ? rule.value : [];
              return (
                <label key={option.code}>
                  <input
                    type="checkbox"
                    checked={current.includes(option.code)}
                    onChange={(event) =>
                      onChange({
                        ...rule,
                        value: event.target.checked
                          ? [...current, option.code]
                          : current.filter((code) => code !== option.code),
                      })
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        ) : (
          <>
            <ValueInput attribute={choice.definition} value={rule.value} onChange={(value) => onChange({ ...rule, value })} />
            {operatorNeedsUpperBound(rule.operator) ? (
              <>
                <span className={styles.rangeDash}>đến</span>
                <ValueInput
                  attribute={choice.definition}
                  value={rule.valueTo}
                  onChange={(value) =>
                    onChange({ ...rule, valueTo: typeof value === 'number' || typeof value === 'string' ? value : undefined })
                  }
                />
              </>
            ) : null}
          </>
        )}
      </div>
      <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Xoá điều kiện">
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Hộp thoại cấu hình một điểm rẽ nhánh: tên, thứ tự nhánh, điều kiện từng nhánh. */
export function GatewayEditor({
  definition,
  gateway,
  onClose,
  onSave,
  onRemove,
}: {
  definition: ProcedureDefinition;
  gateway: ProcedureGatewayDefinition;
  onClose: () => void;
  onSave: (next: ProcedureGatewayDefinition) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<ProcedureGatewayDefinition>(() => structuredClone(gateway));
  const choices = useMemo(() => attributeChoices(definition, gateway.afterStepId), [definition, gateway.afterStepId]);
  const definitionOf = (ref: ProcedureAttributeRef) => choices.find((item) => item.value === refValue(ref))?.definition;
  const overlaps = useMemo(() => findBranchOverlaps(draft), [draft]);
  const stepName = (id: string) => definition.steps.find((step) => step.id === id)?.name ?? id;

  const conditional = draft.branches.filter((branch) => !branch.isDefault);
  const fallback = draft.branches.find((branch) => branch.isDefault);

  const setBranches = (branches: ProcedureBranchDefinition[]) =>
    // Nhánh mặc định luôn đứng cuối — nó chỉ được xét khi mọi nhánh khác trượt.
    setDraft({ ...draft, branches: [...branches.filter((b) => !b.isDefault), ...branches.filter((b) => b.isDefault)] });
  const updateBranch = (branchId: string, change: (branch: ProcedureBranchDefinition) => ProcedureBranchDefinition) =>
    setBranches(draft.branches.map((branch) => (branch.id === branchId ? change(branch) : branch)));
  const move = (branchId: string, delta: -1 | 1) => {
    const list = [...conditional];
    const from = list.findIndex((branch) => branch.id === branchId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    const [item] = list.splice(from, 1);
    if (item) list.splice(to, 0, item);
    setBranches([...list, ...(fallback ? [fallback] : [])]);
  };
  const addBranch = () => {
    const taken = new Set(draft.branches.map((branch) => branch.key));
    let counter = conditional.length + 1;
    while (taken.has(`N${counter}`)) counter += 1;
    setBranches([
      ...conditional,
      {
        id: localId(),
        key: `N${counter}`,
        label: `Nhánh ${counter}`,
        isDefault: false,
        condition: { combinator: 'and', rules: [] },
        stepIds: [],
      },
      ...(fallback ? [fallback] : []),
    ]);
  };

  const save = () => {
    // Id tạm của nhánh mới được bỏ để server cấp id thật.
    onSave({
      ...draft,
      branches: draft.branches.map((branch) =>
        branch.id.startsWith('new-')
          ? {
              ...branch,
              id: '',
              condition: branch.condition
                ? { ...branch.condition, rules: branch.condition.rules.map((rule) => (rule.id.startsWith('new-') ? { ...rule, id: '' } : rule)) }
                : undefined,
            }
          : {
              ...branch,
              condition: branch.condition
                ? { ...branch.condition, rules: branch.condition.rules.map((rule) => (rule.id.startsWith('new-') ? { ...rule, id: '' } : rule)) }
                : undefined,
            },
      ),
    });
  };

  return (
    <MinimalPopupForm
      isOpen
      title="Cấu hình điểm rẽ nhánh"
      subtitle={`Đặt sau bước “${stepName(gateway.afterStepId)}”. Hệ thống xét các nhánh từ trên xuống và đi nhánh đầu tiên khớp điều kiện.`}
      maxWidth="880px"
      onClose={onClose}
    >
      <div className={styles.editor}>
        <label className={styles.fieldRow}>
          <span>Tên điểm rẽ nhánh</span>
          <input className={styles.input} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>

        {choices.length === 0 ? (
          <p className={styles.warning}>
            Chưa có thuộc tính nào dùng được làm điều kiện. Hãy khai báo thuộc tính cho quy trình hoặc cho một bước đứng
            trước điểm rẽ nhánh (nút “Thuộc tính” trên hàng bước).
          </p>
        ) : null}

        <ol className={styles.branchList}>
          {conditional.map((branch, position) => (
            <li key={branch.id || branch.key} className={styles.branchCard}>
              <header className={styles.branchHead}>
                <span className={styles.branchIndex}>{position + 1}</span>
                <input
                  className={styles.input}
                  value={branch.label}
                  aria-label="Nhãn nhánh"
                  onChange={(event) => updateBranch(branch.id, (item) => ({ ...item, label: event.target.value }))}
                />
                <div className={styles.combinator} role="radiogroup" aria-label="Cách nối điều kiện">
                  {(['and', 'or'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={branch.condition?.combinator === value}
                      className={branch.condition?.combinator === value ? styles.combinatorOn : undefined}
                      onClick={() =>
                        updateBranch(branch.id, (item) => ({
                          ...item,
                          condition: { combinator: value, rules: item.condition?.rules ?? [] },
                        }))
                      }
                    >
                      {value === 'and' ? 'VÀ' : 'HOẶC'}
                    </button>
                  ))}
                </div>
                <button type="button" className={styles.iconButton} onClick={() => move(branch.id, -1)} disabled={position === 0} aria-label="Lên">
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button type="button" className={styles.iconButton} onClick={() => move(branch.id, 1)} disabled={position === conditional.length - 1} aria-label="Xuống">
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <Popconfirm
                  title={`Xoá nhánh “${branch.label}”?`}
                  description={
                    branch.stepIds.length
                      ? `${branch.stepIds.length} bước của nhánh sẽ trở thành bước tuần tự trên trục chính.`
                      : 'Nhánh chưa có bước nào.'
                  }
                  okText="Xoá"
                  cancelText="Huỷ"
                  okType="danger"
                  placement="top-end"
                  onConfirm={() => setBranches(draft.branches.filter((item) => item.id !== branch.id))}
                >
                  <button type="button" className={styles.iconButton} aria-label="Xoá nhánh">
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </Popconfirm>
              </header>

              {(branch.condition?.rules ?? []).map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  choices={choices}
                  onChange={(next) =>
                    updateBranch(branch.id, (item) => ({
                      ...item,
                      condition: {
                        combinator: item.condition?.combinator ?? 'and',
                        rules: (item.condition?.rules ?? []).map((candidate) => (candidate.id === rule.id ? next : candidate)),
                      },
                    }))
                  }
                  onRemove={() =>
                    updateBranch(branch.id, (item) => ({
                      ...item,
                      condition: {
                        combinator: item.condition?.combinator ?? 'and',
                        rules: (item.condition?.rules ?? []).filter((candidate) => candidate.id !== rule.id),
                      },
                    }))
                  }
                />
              ))}
              <div className={styles.branchFoot}>
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={!choices.length}
                  onClick={() => {
                    const first = choices[0];
                    if (!first) return;
                    updateBranch(branch.id, (item) => ({
                      ...item,
                      condition: {
                        combinator: item.condition?.combinator ?? 'and',
                        rules: [
                          ...(item.condition?.rules ?? []),
                          {
                            id: localId(),
                            attribute: first.ref,
                            operator: PROCEDURE_OPERATORS_BY_TYPE[first.definition.type][0] ?? 'not_empty',
                          },
                        ],
                      },
                    }));
                  }}
                >
                  <Plus size={13} aria-hidden="true" /> Thêm điều kiện
                </button>
                <span className={styles.preview}>
                  {(branch.condition?.rules ?? [])
                    .map((rule) => describeConditionRule(rule, definitionOf(rule.attribute)))
                    .join(branch.condition?.combinator === 'or' ? ' hoặc ' : ' và ') || 'Chưa có điều kiện'}
                </span>
                <span className={styles.stepCount}>
                  {branch.stepIds.length ? branch.stepIds.map(stepName).join(' → ') : 'Chưa có bước (đi thẳng tới điểm hợp)'}
                </span>
              </div>
            </li>
          ))}
          {fallback ? (
            <li className={`${styles.branchCard} ${styles.defaultBranch}`}>
              <header className={styles.branchHead}>
                <span className={styles.branchIndex}>—</span>
                <input
                  className={styles.input}
                  value={fallback.label}
                  aria-label="Nhãn nhánh mặc định"
                  onChange={(event) => updateBranch(fallback.id, (item) => ({ ...item, label: event.target.value }))}
                />
                <span className={styles.defaultTag}>Mặc định</span>
              </header>
              <div className={styles.branchFoot}>
                <span className={styles.preview}>Khi không nhánh nào ở trên khớp</span>
                <span className={styles.stepCount}>
                  {fallback.stepIds.length ? fallback.stepIds.map(stepName).join(' → ') : 'Chưa có bước (đi thẳng tới điểm hợp)'}
                </span>
              </div>
            </li>
          ) : null}
        </ol>

        <button type="button" className={styles.linkButton} onClick={addBranch}>
          <Plus size={13} aria-hidden="true" /> Thêm nhánh có điều kiện
        </button>

        {overlaps.length ? (
          <ul className={styles.warningList}>
            {overlaps.map((overlap) => {
              const label = (id: string) => draft.branches.find((branch) => branch.id === id)?.label ?? '';
              return (
                <li key={`${overlap.branchId}:${overlap.overlapsBranchId}`}>
                  {overlap.shadowed
                    ? `Nhánh “${label(overlap.branchId)}” bị nhánh “${label(overlap.overlapsBranchId)}” che hoàn toàn — sẽ không bao giờ được chọn.`
                    : `Nhánh “${label(overlap.branchId)}” chồng khoảng giá trị với “${label(overlap.overlapsBranchId)}”; phần giao đi nhánh đứng trước.`}
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className={styles.hint}>
          Thêm bước cho từng nhánh bằng nút “+ Bước” trên hàng nhánh của ma trận. Mọi nhánh hợp về bước trục chính
          kế tiếp.
        </p>

        <footer className={styles.footer}>
          <Popconfirm
            title="Xoá điểm rẽ nhánh này?"
            description="Các bước trong nhánh được giữ lại và chạy tuần tự trên trục chính."
            okText="Xoá"
            cancelText="Huỷ"
            okType="danger"
            placement="top-start"
            onConfirm={onRemove}
          >
            <button type="button" className={styles.dangerButton}>
              Xoá điểm rẽ nhánh
            </button>
          </Popconfirm>
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Huỷ
            </button>
            <button type="button" className={styles.submitButton} onClick={save}>
              Lưu cấu hình
            </button>
          </div>
        </footer>
      </div>
    </MinimalPopupForm>
  );
}
