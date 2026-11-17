'use client';

import {
  APPROVER_RULE_LABELS,
  STEP_TYPE_LABELS,
  conditionSet,
  stepApplies,
  stepTypeOf,
  type ApproverRule,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type LetterDirection,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { flowLabels, plannedWorkflow } from '../correspondence.model';
import styles from '../correspondence.module.scss';
import { SelectField } from './form-dialog';

type Facts = { readonly kind: string; readonly urgency: string; readonly confidentiality: string };

/** Ai làm bước theo luật: tên người, chức danh (kèm người giữ), trưởng đơn vị… lấy theo sơ đồ tổ chức. */
function ruleText(rule: ApproverRule, directory: CorrespondenceDirectory | undefined): string {
  const person = (id: string) => directory?.people.find((item) => item.userId === id)?.name ?? 'Người dùng';
  const position = (id: string) => {
    const found = directory?.positions.find((item) => item.id === id);
    return found ? `${found.name}${found.holderNames.length > 0 ? ` (${found.holderNames.join(', ')})` : ''}` : 'Chức danh';
  };
  const unit = (id: string) => directory?.units.find((item) => item.id === id)?.name ?? 'Đơn vị';
  switch (rule.type) {
    case 'users':
      return rule.userIds.map(person).join(', ');
    case 'positions':
      return rule.positionIds.map(position).join(', ');
    case 'unit_heads':
      return `Trưởng ${rule.unitIds.map(unit).join(', ')}`;
    case 'choose':
      return `Người trình chọn${rule.pool === 'leaders' ? ' trong lãnh đạo' : rule.pool === 'positions' ? ' theo chức danh' : ' theo phòng ban'}`;
    default:
      return APPROVER_RULE_LABELS[rule.type];
  }
}

function stepWho(step: WorkflowStep, directory: CorrespondenceDirectory | undefined): string {
  const type = stepTypeOf(step);
  if (type === 'process') {
    if (!step.units?.length) return 'Phòng ban do người làm bước trước chọn';
    const names = step.units.map((item) => directory?.units.find((unit) => unit.id === item.unitId)?.name ?? 'Phòng ban').join(', ');
    return `${step.lockUnits ? 'Luôn giao' : 'Giao sẵn'}: ${names}`;
  }
  if (!step.approver) return 'Người làm văn thư';
  return `${ruleText(step.approver, directory)}${step.mode === 'all' ? ' · tất cả cùng duyệt' : ''}${step.directs ? ' · bút phê' : ''}`;
}

/**
 * Chọn quy trình cho một công văn: trống là quy trình tự chọn theo điều kiện, loại văn bản, mặc định; chọn
 * thì công văn chạy đúng quy trình đó. Bên dưới là xem trước các bước, ai làm, bước nào không áp dụng.
 */
export function WorkflowPicker({
  config,
  direction,
  facts,
  value,
  directory,
  onChange,
}: {
  readonly config: CorrespondenceConfig;
  readonly direction: LetterDirection;
  /** Phân loại đang chọn: quyết định quy trình tự chọn và bước có điều kiện. */
  readonly facts: Facts;
  /** Quy trình chọn riêng; trống là tự chọn. */
  readonly value: string;
  readonly directory?: CorrespondenceDirectory;
  readonly onChange: (workflowId: string) => void;
}) {
  const auto = plannedWorkflow(config, direction, facts.kind, facts);
  const chosen = value ? config.workflows.find((item) => item.id === value && item.isActive) : undefined;
  const workflow = chosen ?? auto;
  const options = config.workflows
    .filter((item) => item.isActive && item.direction === direction)
    .map((item) => ({
      value: item.id,
      label: item.name,
      description: [item.isDefault ? 'Mặc định' : '', item.id === auto?.id ? 'Theo cấu hình cho công văn này' : '', `${item.steps.length} bước`]
        .filter(Boolean)
        .join(' · '),
    }));
  const labels = workflow ? flowLabels(workflow, direction) : [];
  return (
    <div className={styles.workflowPicker}>
      <SelectField label="Quy trình">
        <SearchableSelect
          options={options}
          value={value}
          placeholder={auto ? `Theo cấu hình: ${auto.name}` : 'Chưa có quy trình đang dùng'}
          clearable
          onChange={(next) => onChange(next ?? '')}
        />
        <span className={styles.hint}>
          {chosen ? 'Công văn này chạy đúng quy trình đã chọn.' : 'Để trống: theo quy trình cấu hình cho loại văn bản (hay quy trình mặc định).'}
        </span>
      </SelectField>
      {workflow ? (
        <ol className={styles.workflowPreview} aria-label={`Xem trước quy trình ${workflow.name}`}>
          <li>
            <b>{labels[0]}</b>
            <span className={styles.hint}>Ô đầu</span>
          </li>
          {workflow.steps.map((step) => {
            const applies = stepApplies(step, facts);
            return (
              <li key={step.key} className={applies ? undefined : styles.workflowSkipped}>
                <b>{step.name}</b>
                <span className={styles.hint}>
                  {STEP_TYPE_LABELS[stepTypeOf(step)]} · {stepWho(step, directory)}
                  {conditionSet(step.condition) ? ` · ${step.condition?.skip ? 'bỏ qua khi khớp điều kiện' : 'chỉ khi khớp điều kiện'}` : ''}
                  {applies ? '' : ' · không áp dụng cho công văn này'}
                </span>
              </li>
            );
          })}
          <li>
            <b>{labels.at(-1)}</b>
            <span className={styles.hint}>Ô cuối</span>
          </li>
        </ol>
      ) : (
        <p className={styles.notice}>Chưa có quy trình đang dùng cho luồng này. Nhờ người quản trị vào Cấu hình đặt quy trình mặc định.</p>
      )}
    </div>
  );
}
