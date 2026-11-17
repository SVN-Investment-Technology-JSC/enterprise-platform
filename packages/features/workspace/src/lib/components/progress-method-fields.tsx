'use client';

import {
  QUANTITY_UNIT_MAX_LENGTH,
  type WorkItemProgressMethod,
} from '@enterprise-platform/contracts-workspace';
import { WORK_ITEM_PROGRESS_METHOD_INFO } from '../project-progress-methods';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Field } from './dialog';

/** Giá trị đang soạn của phần "Cách tính tiến độ" trong form công việc. */
export interface ProgressMethodDraft {
  progressMethod: WorkItemProgressMethod;
  /** Chuỗi người dùng gõ; rỗng là chưa nhập. */
  quantityTarget: string;
  quantityUnit: string;
  equalChildWeight: boolean;
  /** Chỉ khi tạo mới: mỗi dòng một đầu việc tạo sẵn. */
  checklistText: string;
}

export const EMPTY_PROGRESS_METHOD: ProgressMethodDraft = {
  progressMethod: 'manual',
  quantityTarget: '',
  quantityUnit: '',
  equalChildWeight: true,
  checklistText: '',
};

/** Lỗi nhập liệu của phần này, hoặc `undefined` khi hợp lệ. */
export function progressMethodProblem(draft: ProgressMethodDraft): string | undefined {
  if (draft.progressMethod !== 'quantity') return undefined;
  const target = Number(draft.quantityTarget);
  if (!draft.quantityTarget.trim() || !Number.isFinite(target) || target <= 0) {
    return 'Nhập khối lượng cần hoàn thành lớn hơn 0.';
  }
  if (!draft.quantityUnit.trim()) return 'Nhập đơn vị của khối lượng (ví dụ: bộ, m, trang).';
  return undefined;
}

/** Các trường gửi lên server cho phần này; cách khác `quantity` không mang khối lượng. */
export function progressMethodPayload(draft: ProgressMethodDraft, options: { readonly withChecklist: boolean }) {
  return {
    progressMethod: draft.progressMethod,
    quantityTarget: draft.progressMethod === 'quantity' ? Number(draft.quantityTarget) : undefined,
    quantityUnit: draft.progressMethod === 'quantity' ? draft.quantityUnit.trim() : undefined,
    equalChildWeight: draft.progressMethod === 'child_weight' ? draft.equalChildWeight : undefined,
    checklistTitles:
      options.withChecklist && draft.progressMethod === 'checklist'
        ? draft.checklistText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : undefined,
  };
}

/**
 * Chọn cách tính tiến độ của công việc (bám 1Office) kèm các trường phát sinh theo từng cách: khối lượng và đơn vị,
 * danh sách đầu việc tạo sẵn, chia đều tỷ trọng việc con.
 */
export function ProgressMethodFields({
  value,
  onChange,
  methods,
  creating,
  idPrefix,
}: {
  readonly value: ProgressMethodDraft;
  readonly onChange: (patch: Partial<ProgressMethodDraft>) => void;
  /** Các cách cho chọn (nhóm công việc không có khối lượng hay đầu việc). */
  readonly methods: readonly WorkItemProgressMethod[];
  /** Tạo mới thì có ô nhập đầu việc tạo sẵn; sửa thì đầu việc quản lý ở tab Tổng quan. */
  readonly creating: boolean;
  readonly idPrefix: string;
}) {
  const info = WORK_ITEM_PROGRESS_METHOD_INFO[value.progressMethod];
  return (
    <>
      <Field label="Cách tính tiến độ" hint={info.description}>
        <Choice
          label="Cách tính tiến độ công việc"
          value={value.progressMethod}
          selectOnly
          options={methods.map((method) => ({ value: method, label: WORK_ITEM_PROGRESS_METHOD_INFO[method].label }))}
          onChange={(next) => onChange({ progressMethod: next as WorkItemProgressMethod })}
        />
      </Field>
      {value.progressMethod === 'quantity' ? (
        <div className={styles.fieldRow}>
          <Field label="Khối lượng cần hoàn thành">
            <input
              id={`${idPrefix}-quantity-target`}
              type="number"
              min={0}
              step="any"
              value={value.quantityTarget}
              onChange={(event) => onChange({ quantityTarget: event.target.value })}
            />
          </Field>
          <Field label="Đơn vị">
            <input
              id={`${idPrefix}-quantity-unit`}
              maxLength={QUANTITY_UNIT_MAX_LENGTH}
              placeholder="bộ, m, trang…"
              value={value.quantityUnit}
              onChange={(event) => onChange({ quantityUnit: event.target.value })}
            />
          </Field>
        </div>
      ) : null}
      {value.progressMethod === 'checklist' && creating ? (
        <Field label="Đầu việc" hint="Mỗi dòng một đầu việc, theo đúng thứ tự. Thêm hay bớt sau ở tab Tổng quan của công việc.">
          <textarea
            id={`${idPrefix}-checklist`}
            rows={4}
            value={value.checklistText}
            onChange={(event) => onChange({ checklistText: event.target.value })}
          />
        </Field>
      ) : null}
      {value.progressMethod === 'child_weight' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={value.equalChildWeight}
            onChange={(event) => onChange({ equalChildWeight: event.target.checked })}
          />
          Chia đều tỷ trọng cho các việc con
        </label>
      ) : null}
    </>
  );
}
