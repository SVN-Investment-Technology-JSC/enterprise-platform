'use client';

import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_TYPES,
  type DirectoryPerson,
  type WorkItemPriority,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import {
  fromLocalInput,
  type SearchableSelectExtra,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Copy, Truck, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ProcedureOption } from '../procedure-api';
import { ITEM_TYPE_LABELS, PRIORITY_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { ProjectPeoplePicker } from './project-people-picker';
import { TagPicker } from './tag-picker';
import { TitleInput } from './title-input';
import { TransportSection } from './transport-section';
import { useSourceTransport, type SourceTransportState } from './use-source-transport';

/** Chiều cao ô trong form tạo nhiều việc: gọn hơn form thường để mỗi việc nằm trên ít dòng. */
const COMPACT = 32;

/** Một công việc sẽ tạo, đủ mọi trường của riêng nó. */
export interface DraftRow {
  readonly key: number;
  parentId: string;
  title: string;
  description: string;
  itemType: WorkItemType;
  executionType: 'manual' | 'procedure';
  priority: WorkItemPriority;
  assigneeUserId: string;
  participantUserIds: string[];
  tagIds: string[];
  plannedStart: string;
  plannedEnd: string;
  estimateHours: string;
  procedureDefinitionId: string;
}

export type DraftFields = Omit<DraftRow, 'key'>;

const BLANK: DraftFields = {
  parentId: '',
  title: '',
  description: '',
  itemType: 'task',
  executionType: 'manual',
  priority: 'normal',
  assigneeUserId: '',
  participantUserIds: [],
  tagIds: [],
  plannedStart: '',
  plannedEnd: '',
  estimateHours: '',
  procedureDefinitionId: '',
};

let lastKey = 0;

/** Dòng mới với khoá riêng; ô nào không truyền thì để trống. */
export function draftRow(from: Partial<DraftFields> = {}): DraftRow {
  lastKey += 1;
  return {
    ...BLANK,
    ...from,
    participantUserIds: [...(from.participantUserIds ?? [])],
    tagIds: [...(from.tagIds ?? [])],
    key: lastKey,
  };
}

export interface WorkItemDraftEditorProps {
  readonly open: boolean;
  readonly index: number;
  readonly row: DraftRow;
  readonly removable: boolean;
  readonly onChange: (patch: Partial<DraftFields>) => void;
  readonly onRemove: () => void;
  readonly onDuplicate: () => void;
  readonly onPasteLines: (lines: string[]) => void;
  /** Báo khối phương tiện của dòng cho form, để kiểm và lấy payload khi gửi. */
  readonly onTransport: (key: number, state: SourceTransportState | undefined) => void;
  readonly history: readonly string[];
  readonly assigneeChoices: AssigneeChoices;
  /** Dòng của ô "Người phụ trách": tên kèm thẻ trong / ngoài dự án. */
  readonly renderAssignee: (option: SearchableSelectOption) => ReactNode;
  readonly participantPeople: readonly DirectoryPerson[];
  readonly nameOf: (userId: string) => string;
  readonly directoryLoaded: boolean;
  /** Thành viên dự án: đứng đầu ô "Người thực hiện cùng", người còn lại gập sau nút "Ngoài dự án". */
  readonly memberIds: ReadonlySet<string>;
  readonly parentOptions: ReadonlyArray<{ value: string; label: string }>;
  /** `undefined` là đang tải danh sách quy trình. */
  readonly procedures: readonly ProcedureOption[] | undefined;
}

/** Lựa chọn của ô "Người phụ trách": thành viên dự án, rồi nhóm "Ngoài dự án" gập sau một nút. */
export interface AssigneeChoices {
  readonly options: readonly SearchableSelectOption[];
  readonly extra?: SearchableSelectExtra;
}

/**
 * Một công việc trong form "Công việc mới": dòng đầu là tên, người phụ trách, ngày và giờ; dòng hai là phân loại
 * (loại, ưu tiên, công việc cha, cách thực hiện); dòng ba là người cùng làm và nhãn; dòng bốn là mô tả, kèm khối
 * phương tiện mở khi cần.
 */
export function WorkItemDraftEditor({
  open,
  index,
  row,
  removable,
  onChange,
  onRemove,
  onDuplicate,
  onPasteLines,
  onTransport,
  history,
  assigneeChoices,
  renderAssignee,
  participantPeople,
  nameOf,
  directoryLoaded,
  memberIds,
  parentOptions,
  procedures,
}: WorkItemDraftEditorProps) {
  const isPhase = row.itemType === 'phase';
  const [showTransport, setShowTransport] = useState(false);

  // Mỗi việc một khối phương tiện riêng: khung giờ gợi ý theo ngày của chính việc đó.
  const transport = useSourceTransport({
    open,
    sourceType: 'WORK_ITEM',
    followsSource: false,
    defaultRange: row.plannedStart
      ? {
          startAt: fromLocalInput(`${row.plannedStart}T08:00`),
          endAt: fromLocalInput(`${row.plannedEnd || row.plannedStart}T17:00`),
        }
      : null,
  });

  useEffect(() => {
    onTransport(row.key, isPhase ? undefined : transport);
  }, [onTransport, row.key, isPhase, transport]);
  useEffect(() => () => onTransport(row.key, undefined), [onTransport, row.key]);

  const hasTransport = Boolean(transport.value.mode);

  return (
    <section className={styles.draftItem} aria-label={`Công việc ${index + 1}`}>
      <span className={styles.draftIndex}>{index + 1}</span>

      <div className={styles.draftBody}>
        <div className={styles.draftLineMain}>
          <label className={styles.draftField}>
            <span>Tên công việc</span>
            <TitleInput
              value={row.title}
              history={history}
              ariaLabel={`Tên công việc ${index + 1}`}
              placeholder={index === 0 ? 'Gõ tên, hoặc dán nhiều dòng để tạo nhiều việc' : undefined}
              onChange={(title) => onChange({ title })}
              onPasteLines={onPasteLines}
            />
          </label>
          <div className={styles.draftField}>
            <span>Người phụ trách</span>
            {isPhase ? (
              <span className={styles.draftNone}>Nhóm không giao người</span>
            ) : (
              <Choice
                label={`Người phụ trách ${index + 1}`}
                value={row.assigneeUserId}
                height={COMPACT}
                emptyOption="Chưa giao"
                options={assigneeChoices.options}
                extra={assigneeChoices.extra}
                renderOption={renderAssignee}
                onChange={(value) => onChange({ assigneeUserId: value })}
              />
            )}
          </div>
          <div className={styles.draftField}>
            <span>Bắt đầu</span>
            <DatePickerInput
              height={COMPACT}
              value={row.plannedStart}
              onChange={(value) => onChange({ plannedStart: value })}
            />
          </div>
          <div className={styles.draftField}>
            <span>Kết thúc</span>
            <DatePickerInput
              height={COMPACT}
              value={row.plannedEnd}
              onChange={(value) => onChange({ plannedEnd: value })}
            />
          </div>
          <label className={styles.draftField}>
            <span>Giờ</span>
            {isPhase ? (
              <span className={styles.draftNone}>—</span>
            ) : (
              <input
                type="number"
                min={0}
                step="0.5"
                aria-label={`Giờ ước lượng ${index + 1}`}
                value={row.estimateHours}
                onChange={(event) => onChange({ estimateHours: event.target.value })}
              />
            )}
          </label>
        </div>

        <div className={styles.draftLine}>
          <div className={styles.draftField}>
            <span>Loại</span>
            <Choice
              label={`Loại ${index + 1}`}
              value={row.itemType}
              height={COMPACT}
              options={WORK_ITEM_TYPES.map((type) => ({ value: type, label: ITEM_TYPE_LABELS[type] }))}
              onChange={(value) => onChange({ itemType: value as WorkItemType })}
            />
          </div>
          <div className={styles.draftField}>
            <span>Ưu tiên</span>
            <Choice
              label={`Độ ưu tiên ${index + 1}`}
              value={row.priority}
              height={COMPACT}
              options={WORK_ITEM_PRIORITIES.map((priority) => ({
                value: priority,
                label: PRIORITY_LABELS[priority],
              }))}
              onChange={(value) => onChange({ priority: value as WorkItemPriority })}
            />
          </div>
          <div className={styles.draftField}>
            <span>Công việc cha</span>
            <Choice
              label={`Công việc cha ${index + 1}`}
              value={row.parentId}
              height={COMPACT}
              options={[{ value: '', label: 'Gốc dự án' }, ...parentOptions]}
              onChange={(value) => onChange({ parentId: value })}
            />
          </div>
          {isPhase ? null : (
            <div className={styles.draftField}>
              <span>Cách thực hiện</span>
              <Choice
                label={`Cách thực hiện ${index + 1}`}
                value={row.executionType}
                height={COMPACT}
                options={[
                  { value: 'manual', label: 'Thủ công' },
                  { value: 'procedure', label: 'Theo quy trình' },
                ]}
                onChange={(value) => onChange({ executionType: value as 'manual' | 'procedure' })}
              />
            </div>
          )}
          {!isPhase && row.executionType === 'procedure' ? (
            <div className={styles.draftField}>
              <span>Quy trình</span>
              {procedures === undefined ? (
                <span className={styles.draftNone}>Đang tải quy trình…</span>
              ) : procedures.length === 0 ? (
                <span className={styles.draftNone}>Không đọc được quy trình nào.</span>
              ) : (
                <Choice
                  label={`Quy trình ${index + 1}`}
                  value={row.procedureDefinitionId}
                  height={COMPACT}
                  required
                  placeholder="Chọn quy trình…"
                  options={procedures.map((procedure) => ({
                    value: procedure.id,
                    label: `${procedure.code} · ${procedure.name}`,
                  }))}
                  onChange={(value) => onChange({ procedureDefinitionId: value })}
                />
              )}
            </div>
          ) : null}
        </div>

        <div className={styles.draftLine}>
          {isPhase ? null : (
            <div className={styles.draftField}>
              <span>Người thực hiện cùng</span>
              <ProjectPeoplePicker
                people={participantPeople}
                memberIds={memberIds}
                selected={row.participantUserIds}
                exclude={row.assigneeUserId ? [row.assigneeUserId] : []}
                nameOf={nameOf}
                loaded={directoryLoaded}
                onChange={(participantUserIds) => onChange({ participantUserIds })}
              />
            </div>
          )}
          <div className={styles.draftField}>
            <span>Nhãn</span>
            <TagPicker selected={row.tagIds} onChange={(tagIds) => onChange({ tagIds })} />
          </div>
        </div>

        <div className={styles.draftLine}>
          <label className={`${styles.draftField} ${styles.draftFieldGrow}`}>
            <span>Mô tả</span>
            <textarea
              rows={1}
              aria-label={`Mô tả ${index + 1}`}
              value={row.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>
        </div>

        {!isPhase && (showTransport || hasTransport) ? (
          <div className={styles.draftTransport}>
            <TransportSection
              state={transport}
              editableRange
              idPrefix={`work-item-draft-${row.key}-transport`}
            />
          </div>
        ) : null}
      </div>

      <div className={styles.draftActions}>
        {isPhase ? null : (
          <button
            type="button"
            className={
              showTransport || hasTransport
                ? `${styles.iconButton} ${styles.iconButtonActive}`
                : styles.iconButton
            }
            aria-label={`Phương tiện đi lại cho công việc ${index + 1}`}
            aria-pressed={showTransport || hasTransport}
            title="Phương tiện đi lại"
            disabled={hasTransport}
            onClick={() => setShowTransport((current) => !current)}
          >
            <Truck size={13} />
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Nhân bản công việc ${index + 1}`}
          title="Nhân bản (chép mọi trường trừ tên)"
          onClick={onDuplicate}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Bỏ công việc ${index + 1}`}
          title="Bỏ công việc này"
          disabled={!removable}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      </div>
    </section>
  );
}
