'use client';

import {
  MAX_WORK_ITEM_ESTIMATE_HOURS,
  WORK_ITEM_TYPES,
  type DirectoryPerson,
  type RelatedObjectKind,
  type WorkItemPriority,
  type WorkItemReopenPolicy,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import {
  fromLocalInput,
  type SearchableSelectExtra,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { ChevronDown, ChevronRight, Copy, Info, Trash2, Truck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ProcedureOption } from '../procedure-api';
import { cloneCompletion, emptyCompletion, type CompletionDraft } from '../completion-draft';
import type { PendingRelatedObject } from '../related-objects.model';
import { ITEM_TYPE_LABELS, formatDate, priorityKeys, priorityLabel } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Tooltip } from './tooltip';
import { Choice } from './choice';
import { CompletionConditionsEditor } from './completion-conditions-editor';
import { ReopenPolicyField } from './reopen-policy-field';
import { Input, Label, Textarea } from './form-controls';
import {
  EMPTY_PROGRESS_METHOD,
  ProgressMethodFields,
  type ProgressMethodDraft,
} from './progress-method-fields';
import { ProjectPeoplePicker } from './project-people-picker';
import { RelatedObjectsEditor } from './related-objects-editor';
import { TagPicker } from './tag-picker';
import { TitleInput } from './title-input';
import { TransportSection } from './transport-section';
import { useSourceTransport, type SourceTransportState } from './use-source-transport';

/** Mọi ô trong form tạo nhiều việc cao bằng nhau. */
const FIELD_HEIGHT = 36;

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
  /** Cách tính tiến độ và các trường đi kèm. */
  progress: ProgressMethodDraft;
  procedureDefinitionId: string;
  completion: CompletionDraft;
  /** Ai được hoàn tác việc này sau khi hoàn thành. */
  reopenPolicy: WorkItemReopenPolicy;
  /** Cha đã hoàn thành: true là mở lại cha rồi tạo, false là chưa chọn (không tạo được). */
  reopenParent: boolean;
  /** Hồ sơ ở module khác gắn vào việc này sau khi tạo xong. */
  relatedObjects: PendingRelatedObject[];
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
  progress: EMPTY_PROGRESS_METHOD,
  procedureDefinitionId: '',
  completion: emptyCompletion(),
  reopenPolicy: 'assignee',
  reopenParent: false,
  relatedObjects: [],
};

let lastKey = 0;

/**
 * Dòng mới với khoá riêng; ô nào không truyền thì để trống. Điều kiện hoàn thành được chép độc lập và bỏ id:
 * dòng nháp luôn là việc sắp tạo, không phải điều kiện đã lưu của việc khác.
 */
export function draftRow(from: Partial<DraftFields> = {}): DraftRow {
  lastKey += 1;
  return {
    ...BLANK,
    ...from,
    participantUserIds: [...(from.participantUserIds ?? [])],
    tagIds: [...(from.tagIds ?? [])],
    progress: { ...(from.progress ?? BLANK.progress) },
    completion: cloneCompletion(from.completion ?? BLANK.completion),
    relatedObjects: [...(from.relatedObjects ?? [])],
    key: lastKey,
  };
}

export interface WorkItemDraftEditorProps {
  readonly open: boolean;
  readonly index: number;
  readonly row: DraftRow;
  readonly removable: boolean;
  /** Chỉ có nghĩa khi có từ hai việc trở lên: việc đang thu gọn chỉ còn thanh tiêu đề. */
  readonly collapsed?: boolean;
  readonly onToggleCollapsed?: () => void;
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
  /** `done`: công việc cha đã hoàn thành, thêm việc con vào đó phải mở lại cha. */
  readonly parentOptions: ReadonlyArray<{ value: string; label: string; done?: boolean }>;
  /** `undefined` là đang tải danh sách quy trình. */
  readonly procedures: readonly ProcedureOption[] | undefined;
  /** Loại hồ sơ gắn được ("Đối tượng liên quan"); rỗng thì không có khối đó. */
  readonly relatedKinds: readonly RelatedObjectKind[];
}

/** Lựa chọn của ô "Người phụ trách": thành viên dự án, rồi nhóm "Ngoài dự án" gập sau một nút. */
export interface AssigneeChoices {
  readonly options: readonly SearchableSelectOption[];
  readonly extra?: SearchableSelectExtra;
}

/**
 * Một công việc trong form "Công việc mới", xếp trên lưới 4 cột đều nhau: tên (cả hàng); loại, ưu tiên, công việc
 * cha, cách thực hiện; người phụ trách, ngày bắt đầu, ngày kết thúc, giờ; người cùng làm và nhãn (mỗi ô nửa hàng);
 * mô tả (cả hàng), kèm khối phương tiện mở khi cần.
 */
export function WorkItemDraftEditor({
  open,
  index,
  row,
  removable,
  collapsed: collapsedProp = false,
  onToggleCollapsed,
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
  relatedKinds,
}: WorkItemDraftEditorProps) {
  const isPhase = row.itemType === 'phase';
  const doneParent = row.parentId ? parentOptions.find((option) => option.value === row.parentId && option.done) : undefined;
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

  // Từ hai việc trở lên mỗi việc là một thẻ riêng có thanh tiêu đề (số thứ tự, tên, các nút) và thu gọn được.
  const multi = removable;
  const collapsed = multi && collapsedProp;

  const actions = (
    <div className={styles.draftActions}>
      {isPhase ? null : (
        <Tooltip content="Phương tiện đi lại">
          <span className={styles.tooltipAnchor}>
            <button
              type="button"
              className={
                showTransport || hasTransport
                  ? `${styles.draftIconButton} ${styles.draftIconTruck} ${styles.draftIconButtonActive}`
                  : `${styles.draftIconButton} ${styles.draftIconTruck}`
              }
              aria-label={`Phương tiện đi lại cho công việc ${index + 1}`}
              aria-pressed={showTransport || hasTransport}
              disabled={hasTransport}
              onClick={() => setShowTransport((current) => !current)}
            >
              <Truck size={16} />
            </button>
          </span>
        </Tooltip>
      )}
      <Tooltip content="Nhân bản (chép mọi trường trừ tên)">
        <button
          type="button"
          className={`${styles.draftIconButton} ${styles.draftIconCopy}`}
          aria-label={`Nhân bản công việc ${index + 1}`}
          onClick={onDuplicate}
        >
          <Copy size={16} />
        </button>
      </Tooltip>
      <Tooltip content="Bỏ công việc này">
        <span className={styles.tooltipAnchor}>
          <button
            type="button"
            className={`${styles.draftIconButton} ${styles.draftIconRemove}`}
            aria-label={`Bỏ công việc ${index + 1}`}
            disabled={!removable}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </button>
        </span>
      </Tooltip>
    </div>
  );

  return (
    <section
      className={multi ? `${styles.draftItem} ${styles.draftItemCard}` : styles.draftItem}
      aria-label={`Công việc ${index + 1}`}
    >
      {multi ? (
        <header className={styles.draftCardHead}>
          <button
            type="button"
            className={styles.draftCardToggle}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Mở rộng' : 'Thu gọn'} công việc ${index + 1}`}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
            <span className={styles.draftCardNumber}>{index + 1}</span>
          </button>
          <span className={styles.draftCardSummary}>
            <span className={row.title.trim() ? styles.draftCardTitle : styles.draftCardTitleEmpty}>
              {row.title.trim() || 'Chưa đặt tên'}
            </span>
            {collapsed ? (
              <span className={styles.draftCardMeta}>
                {[
                  row.assigneeUserId ? nameOf(row.assigneeUserId) : 'Chưa giao',
                  row.plannedEnd ? `Hạn ${formatDate(row.plannedEnd)}` : undefined,
                  priorityLabel(row.priority),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : null}
          </span>
          {actions}
        </header>
      ) : null}
      <div className={collapsed ? `${styles.draftGrid} ${styles.draftGridCollapsed}` : styles.draftGrid}>
        <div className={`${styles.draftField} ${styles.draftSpanAll}`}>
          <Label>Tên công việc</Label>
          <div className={styles.draftTitleRow}>
            <div className={styles.draftTitleInput}>
              <TitleInput
                value={row.title}
                history={history}
                ariaLabel={`Tên công việc ${index + 1}`}
                placeholder={index === 0 ? 'Gõ tên, hoặc dán nhiều dòng để tạo nhiều việc' : undefined}
                onChange={(title) => onChange({ title })}
                onPasteLines={onPasteLines}
              />
            </div>
            {multi ? null : actions}
          </div>
        </div>

        <div className={styles.draftField}>
          <Label>Người phụ trách</Label>
          {isPhase ? (
            <span className={styles.draftNone}>Nhóm không giao người</span>
          ) : (
            <Choice
              label={`Người phụ trách ${index + 1}`}
              value={row.assigneeUserId}
              height={FIELD_HEIGHT}
              emptyOption="Chưa giao"
              options={assigneeChoices.options}
              extra={assigneeChoices.extra}
              renderOption={renderAssignee}
              onChange={(value) => onChange({ assigneeUserId: value })}
            />
          )}
        </div>
        <div className={styles.draftField}>
          <Label>Bắt đầu</Label>
          <DatePickerInput
            height={FIELD_HEIGHT}
            value={row.plannedStart}
            onChange={(value) => onChange({ plannedStart: value })}
          />
        </div>
        <div className={styles.draftField}>
          <Label>Kết thúc</Label>
          <DatePickerInput
            height={FIELD_HEIGHT}
            value={row.plannedEnd}
            onChange={(value) => onChange({ plannedEnd: value })}
          />
        </div>
        <div className={styles.draftField}>
          <Label>Ưu tiên</Label>
          <Choice
            label={`Độ ưu tiên ${index + 1}`}
            selectOnly
            value={row.priority}
            height={FIELD_HEIGHT}
            options={priorityKeys().map((priority) => ({
              value: priority,
              label: priorityLabel(priority),
            }))}
            onChange={(value) => onChange({ priority: value as WorkItemPriority })}
          />
        </div>

        <div className={styles.draftField}>
          <Label>Loại</Label>
          <Choice
            label={`Loại ${index + 1}`}
            selectOnly
            value={row.itemType}
            height={FIELD_HEIGHT}
            options={WORK_ITEM_TYPES.map((type) => ({ value: type, label: ITEM_TYPE_LABELS[type] }))}
            onChange={(value) =>
              onChange({
                itemType: value as WorkItemType,
                // Nhóm công việc không có khối lượng hay đầu việc: bỏ cách tính đã chọn khi còn là Công việc.
                ...(value === 'phase' &&
                row.progress.progressMethod !== 'manual' &&
                row.progress.progressMethod !== 'child_weight'
                  ? { progress: EMPTY_PROGRESS_METHOD }
                  : {}),
              })
            }
          />
        </div>
        <div className={styles.draftField}>
          <Label>Công việc cha</Label>
          <Choice
            label={`Công việc cha ${index + 1}`}
            value={row.parentId}
            height={FIELD_HEIGHT}
            options={[{ value: '', label: 'Gốc dự án' }, ...parentOptions]}
            onChange={(value) => onChange({ parentId: value })}
          />
        </div>
        <div className={styles.draftField}>
          <Label>Cách thực hiện</Label>
          {isPhase ? (
            <span className={styles.draftNone}>Nhóm không có cách thực hiện</span>
          ) : (
            <Choice
              label={`Cách thực hiện ${index + 1}`}
              selectOnly
              value={row.executionType}
              height={FIELD_HEIGHT}
              options={[
                { value: 'manual', label: 'Thủ công' },
                { value: 'procedure', label: 'Theo quy trình' },
              ]}
              onChange={(value) => onChange({ executionType: value as 'manual' | 'procedure' })}
            />
          )}
        </div>
        <div className={styles.draftField}>
          <Label htmlFor={`draft-hours-${row.key}`}>Giờ ước lượng</Label>
          {isPhase ? (
            <span className={styles.draftNone}>—</span>
          ) : (
            <Input
              id={`draft-hours-${row.key}`}
              type="number"
              min={0}
              max={MAX_WORK_ITEM_ESTIMATE_HOURS}
              step="0.5"
              placeholder="0"
              aria-label={`Giờ ước lượng ${index + 1}`}
              value={row.estimateHours}
              onChange={(event) => onChange({ estimateHours: event.target.value })}
            />
          )}
        </div>
        <div className={`${styles.draftField} ${styles.draftSpanAll}`}>
          <ProgressMethodFields
            idPrefix={`draft-${row.key}`}
            creating
            methods={isPhase ? ['manual', 'child_weight'] : ['manual', 'quantity', 'checklist', 'child_weight']}
            value={row.progress}
            onChange={(patch) => onChange({ progress: { ...row.progress, ...patch } })}
          />
        </div>
        {!isPhase && row.executionType === 'procedure' ? (
          <div className={`${styles.draftField} ${styles.draftSpanAll}`}>
            <Label>Quy trình</Label>
            {procedures === undefined ? (
              <span className={styles.draftNone}>Đang tải quy trình…</span>
            ) : procedures.length === 0 ? (
              <span className={styles.draftNone}>Không đọc được quy trình nào.</span>
            ) : (
              <Choice
                label={`Quy trình ${index + 1}`}
                value={row.procedureDefinitionId}
                height={FIELD_HEIGHT}
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

        {doneParent ? (
          <div
            className={`${styles.parentDoneNotice} ${styles.draftSpanAll}`}
            role="group"
            aria-label={`Công việc cha đã hoàn thành ${index + 1}`}
          >
            <span className={styles.parentDoneIcon} aria-hidden="true">
              <Info size={16} />
            </span>
            <div className={styles.parentDoneText}>
              <strong>Công việc cha đã hoàn thành</strong>
            </div>
            <div className={styles.parentDoneChoice}>
              <Choice
                label={`Cách xử lý công việc cha đã hoàn thành ${index + 1}`}
                value={row.reopenParent ? 'reopen' : 'block'}
                height={FIELD_HEIGHT}
                selectOnly
                options={[
                  { value: 'reopen', label: 'Mở lại công việc cha rồi tạo' },
                  { value: 'block', label: 'Không tạo ở đây (chọn cha khác)' },
                ]}
                onChange={(value) => onChange({ reopenParent: value === 'reopen' })}
              />
            </div>
          </div>
        ) : null}

        {isPhase ? null : (
          <div className={`${styles.draftField} ${styles.draftSpanHalf}`}>
            <Label>Người thực hiện cùng</Label>
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
        <div
          className={`${styles.draftField} ${isPhase ? styles.draftSpanAll : styles.draftSpanHalf}`}
        >
          <Label>Nhãn</Label>
          <TagPicker selected={row.tagIds} onChange={(tagIds) => onChange({ tagIds })} />
        </div>

        <div className={`${styles.draftField} ${styles.draftSpanAll}`}>
          <Label htmlFor={`draft-note-${row.key}`}>Mô tả</Label>
          <Textarea
            id={`draft-note-${row.key}`}
            rows={2}
            placeholder="Mô tả ngắn về công việc (không bắt buộc)"
            aria-label={`Mô tả ${index + 1}`}
            value={row.description}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </div>

        {/* Mỗi việc một danh sách riêng, gập sẵn: phần lớn việc không cần gắn hồ sơ nào. */}
        {relatedKinds.length > 0 ? (
          <div className={`${styles.draftOptions} ${styles.draftSpanAll}`}>
            <RelatedObjectsEditor
              kinds={relatedKinds}
              value={row.relatedObjects}
              onChange={(relatedObjects) => onChange({ relatedObjects })}
              ariaPrefix={`Đối tượng liên quan của công việc ${index + 1}`}
              height={FIELD_HEIGHT}
            />
          </div>
        ) : null}

        {isPhase ? null : (
          <div className={`${styles.draftOptions} ${styles.draftSpanAll}`}>
            <CompletionConditionsEditor
              idPrefix={`draft-${row.key}`}
              value={row.completion}
              onChange={(completion) => onChange({ completion })}
            />
            <ReopenPolicyField
              idPrefix={`draft-${row.key}`}
              value={row.reopenPolicy}
              onChange={(reopenPolicy) => onChange({ reopenPolicy })}
            />
          </div>
        )}

        {!isPhase && (showTransport || hasTransport) ? (
          <div className={`${styles.draftTransport} ${styles.draftSpanAll}`}>
            <TransportSection
              state={transport}
              editableRange
              idPrefix={`work-item-draft-${row.key}-transport`}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
