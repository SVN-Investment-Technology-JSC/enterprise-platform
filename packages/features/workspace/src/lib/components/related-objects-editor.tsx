'use client';

import {
  RELATED_OBJECT_MAX_PER_ENTITY,
  type RelatedObjectCandidate,
  type RelatedObjectKind,
} from '@enterprise-platform/contracts-workspace';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { ChevronDown, Link2, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  candidateDescription,
  completedRelated,
  pendingRelatedRow,
  relatedDisplayLabel,
  type PendingRelatedObject,
} from '../related-objects.model';
import { pendingFromCreated } from '../related-object-create.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { RelatedObjectCreateDialog } from './related-object-create-dialog';
import { Tooltip } from './tooltip';

/** Chờ một nhịp sau phím cuối rồi mới hỏi nơi lưu hồ sơ, để không gọi mỗi phím. */
const SEARCH_DEBOUNCE_MS = 300;

/** Giá trị ẩn thứ `index` của ô chọn loại: chỉ gồm ký tự không gõ được (U+2063), nên gõ tìm chỉ khớp theo tên loại. */
function hiddenValue(index: number): string {
  return '\u2063'.repeat(index + 1);
}

export interface RelatedObjectPickerProps {
  readonly kinds: readonly RelatedObjectKind[];
  readonly kind: string;
  readonly objectId: string;
  /** Nhãn của hồ sơ đang chọn, để ô chọn hiện đúng khi hồ sơ đó không nằm trong kết quả tìm hiện tại. */
  readonly label: string;
  /** Tên loại khi `kind` không còn trong `kinds` (vd hồ sơ phía trước do "Tạo từ" thêm). */
  readonly kindLabel?: string;
  /** Tên cho đọc màn hình, ví dụ "Đối tượng liên quan 2". */
  readonly ariaLabel: string;
  readonly height?: number;
  readonly disabled?: boolean;
  readonly kindPlaceholder?: string;
  /** Hồ sơ đã chọn ở chỗ khác (dòng khác, hoặc đã gắn sẵn): hiện mờ, không chọn được. */
  readonly isTaken?: (kind: string, objectId: string) => boolean;
  readonly onKindChange: (kind: string) => void;
  /** `undefined` khi người dùng xoá lựa chọn. */
  readonly onPick: (candidate: RelatedObjectCandidate | undefined) => void;
  /** Loại đang chọn tạo nhanh được: thêm mục "Tạo mới" cuối danh sách hồ sơ. */
  readonly onCreate?: () => void;
}

/**
 * Hai ô chọn liền nhau: loại hồ sơ ("Báo giá"), rồi hồ sơ của loại đó. Ô hồ sơ hỏi nơi lưu hồ sơ theo
 * chữ người dùng gõ (chờ một nhịp sau phím cuối); dòng phụ là gợi ý phân biệt và trạng thái.
 */
export function RelatedObjectPicker({
  kinds,
  kind,
  objectId,
  label,
  kindLabel,
  ariaLabel,
  height,
  disabled = false,
  kindPlaceholder = 'Chọn loại hồ sơ…',
  isTaken,
  onKindChange,
  onPick,
  onCreate,
}: RelatedObjectPickerProps) {
  // Chữ đang tìm gắn với loại lúc gõ: đổi loại thì tự về rỗng, không phải xoá tay.
  const [search, setSearch] = useState({ kind, text: '' });
  const query = search.kind === kind ? search.text : '';
  const [results, setResults] = useState<readonly RelatedObjectCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!kind) {
      setResults([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        void api
          .searchRelatedObjects(kind, query)
          .then((result) => {
            if (!alive) return;
            setResults(result.items);
            setError(undefined);
          })
          .catch((cause) => {
            if (!alive) return;
            setResults([]);
            setError((cause as { message?: string })?.message ?? 'Không tìm được hồ sơ lúc này.');
          })
          .finally(() => {
            if (alive) setLoading(false);
          }),
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [kind, query]);

  /**
   * Ô chọn loại là danh sách tên loại phẳng ("Báo giá", "Phiếu xuất kho"...), đúng thứ tự server trả. Người dùng không
   * cần biết hồ sơ thuộc phân hệ nào, nên không ghép tên phân hệ và chỉ lọc theo tên loại: giá trị của mỗi mục là một
   * chuỗi ký tự ẩn (ô chọn chung lọc cả theo giá trị), đổi lại thành khoá loại khi chọn.
   */
  const kindChoices = useMemo(() => {
    const entries: { key: string; label: string }[] = kinds.map((entry) => ({ key: entry.key, label: entry.label }));
    // Loại đang chọn mà không còn trong danh sách vẫn hiện đúng tên, không mất lựa chọn.
    if (kind && !entries.some((entry) => entry.key === kind)) entries.push({ key: kind, label: kindLabel ?? 'Hồ sơ khác' });
    return entries.map((entry, index) => ({ ...entry, value: hiddenValue(index) }));
  }, [kinds, kind, kindLabel]);
  const kindValue = kindChoices.find((entry) => entry.key === kind)?.value ?? '';

  const recordOptions: SearchableSelectOption[] = results.map((candidate) => {
    const taken = candidate.id !== objectId && Boolean(isTaken?.(kind, candidate.id));
    return {
      value: candidate.id,
      label: relatedDisplayLabel(candidate.code, candidate.label),
      description: taken ? 'Đã chọn ở dòng khác' : candidateDescription(candidate.hint, candidate.status),
      disabled: taken,
    };
  });
  if (objectId && !recordOptions.some((option) => option.value === objectId)) {
    recordOptions.unshift({ value: objectId, label: label || objectId });
  }

  /** Bắt chữ người dùng gõ trong ô hồ sơ (ô chọn chung không báo ra ngoài) để hỏi lại module gốc. */
  const captureTyping = (event: FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) setSearch({ kind, text: target.value });
  };

  return (
    <div className={styles.relatedPicker}>
      <Choice
        label={`${ariaLabel}: loại hồ sơ`}
        value={kindValue}
        height={height}
        disabled={disabled}
        placeholder={kindPlaceholder}
        options={kindChoices.map((entry) => ({ value: entry.value, label: entry.label }))}
        onChange={(value) => {
          const chosen = kindChoices.find((entry) => entry.value === value);
          if (chosen) onKindChange(chosen.key);
        }}
      />
      <div role="group" aria-label={`${ariaLabel}: hồ sơ`} onInputCapture={captureTyping}>
        <SearchableSelect
          options={recordOptions}
          value={objectId}
          height={height}
          disabled={disabled || !kind}
          placeholder={kind ? 'Gõ mã hoặc tên để tìm hồ sơ…' : 'Chọn loại trước'}
          emptyText={loading ? 'Đang tìm…' : (error ?? 'Không có hồ sơ nào khớp.')}
          clearable
          footerAction={onCreate && !disabled ? { label: 'Tạo mới…', onClick: onCreate } : undefined}
          onChange={(value) => {
            if (value === objectId) return;
            if (!value) {
              // Xoá lựa chọn: lần mở sau tìm lại từ đầu thay vì giữ kết quả của chữ đã gõ trước đó.
              setSearch({ kind, text: '' });
              onPick(undefined);
              return;
            }
            const candidate = results.find((entry) => entry.id === value);
            if (candidate) onPick(candidate);
          }}
        />
      </div>
    </div>
  );
}

export interface RelatedObjectsEditorProps {
  readonly kinds: readonly RelatedObjectKind[];
  /** Danh sách chờ gắn; component chỉ báo danh sách mới qua `onChange`, không tự gọi API gắn. */
  readonly value: readonly PendingRelatedObject[];
  readonly onChange: (next: PendingRelatedObject[]) => void;
  /** Tiền tố tên cho đọc màn hình, để nhiều khối trên một form không trùng nhau. */
  readonly ariaPrefix: string;
  /** Hồ sơ đã gắn sẵn (tab Liên quan): không chọn lại được, và tính vào giới hạn mỗi dự án hay công việc. */
  readonly existing?: ReadonlyArray<{ readonly kind: string; readonly objectId: string }>;
  /** Mặc định gập được (khối nằm trong form dài); `false` thì luôn mở (hộp thoại chỉ có khối này). */
  readonly collapsible?: boolean;
  /** Điều khiển từ ngoài việc mở hay gập; vắng thì tự giữ, bắt đầu theo `defaultOpen`. */
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly height?: number;
  readonly disabled?: boolean;
  /** Người xem được thêm liên kết; `false` thì không có nút "+" (vẫn gỡ được dòng có `canRemove`). Mặc định bật. */
  readonly canAdd?: boolean;
}

/**
 * Khối "Đối tượng liên quan": mỗi dòng chọn loại rồi chọn hồ sơ, nút X bỏ dòng, nút tròn "+" thêm dòng. Không cho
 * chọn một hồ sơ hai lần, tối đa `RELATED_OBJECT_MAX_PER_ENTITY` dòng (tính cả liên kết đã lưu). Dòng có `existingId`
 * (form sửa) là liên kết đã lưu: chỉ hiện loại và hồ sơ, nút X chỉ khi `canRemove`. Không có loại nào (công ty không
 * dùng module nào cung cấp hồ sơ) và không có liên kết đã lưu thì không hiện gì.
 */
export function RelatedObjectsEditor({
  kinds,
  value,
  onChange,
  ariaPrefix,
  existing = [],
  collapsible = true,
  open,
  defaultOpen = false,
  onOpenChange,
  height,
  disabled = false,
  canAdd = true,
}: RelatedObjectsEditorProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  /** Dòng đang mở hộp thoại "Tạo mới" (loại của dòng tạo nhanh được ở module gốc). */
  const [creating, setCreating] = useState<{ readonly key: string; readonly kind: string; readonly kindLabel?: string }>();
  const addable = canAdd && kinds.length > 0;
  if (!addable && value.length === 0) return null;

  const isOpen = !collapsible || (open ?? openState);
  const limit = Math.max(RELATED_OBJECT_MAX_PER_ENTITY - existing.length, 0);
  const atLimit = value.length >= limit;
  const chosen = completedRelated(value);

  /** Dòng mới lấy sẵn loại của dòng cuối (thường gắn nhiều hồ sơ cùng loại); chỉ có một loại thì chọn luôn. */
  const blankRow = () =>
    pendingRelatedRow({ kind: value[value.length - 1]?.kind || (kinds.length === 1 ? kinds[0].key : '') });

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
    // Mở khối còn trống thì có sẵn một dòng để chọn ngay.
    if (next && addable && value.length === 0 && limit > 0) onChange([blankRow()]);
  };

  const update = (key: string, patch: Partial<PendingRelatedObject>) =>
    onChange(value.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  /** Loại tạo nhanh được (module gốc khai báo `create` cho người đang xem). */
  const creatable = (kind: string) => kinds.find((entry) => entry.key === kind && entry.create);

  const takenBy = (key: string) => (kind: string, objectId: string) =>
    value.some((row) => row.key !== key && row.kind === kind && row.objectId === objectId) ||
    existing.some((entry) => entry.kind === kind && entry.objectId === objectId);

  // Khi gập: tên các hồ sơ đã chọn, để biết có gì bên trong mà không phải mở ra.
  const summary =
    chosen.length === 0
      ? ''
      : chosen.length <= 3
        ? chosen.map((row) => row.label).join(', ')
        : `${chosen
            .slice(0, 3)
            .map((row) => row.label)
            .join(', ')} và ${chosen.length - 3} hồ sơ khác`;

  const title = (
    <span className={styles.completionTitle}>
      Đối tượng liên quan
      {chosen.length > 0 ? <span className={styles.completionCount}>{chosen.length}</span> : null}
    </span>
  );

  return (
    <div className={styles.relatedEditor}>
      {collapsible ? (
        <button
          type="button"
          className={styles.relatedEditorHead}
          aria-expanded={isOpen}
          onClick={() => setOpen(!isOpen)}
        >
          <span className={styles.completionBadge} aria-hidden="true">
            <Link2 size={16} />
          </span>
          <span className={styles.completionHeadText}>
            {title}
            {summary && !isOpen ? <span className={styles.completionSub}>{summary}</span> : null}
          </span>
          <ChevronDown
            size={18}
            aria-hidden
            className={isOpen ? `${styles.relatedEditorChevron} ${styles.relatedEditorChevronOpen}` : styles.relatedEditorChevron}
          />
        </button>
      ) : null}

      {isOpen ? (
        <div className={collapsible ? styles.relatedEditorBody : styles.relatedEditorBodyFlat}>
          {value.length > 0 ? (
            <ol className={styles.relatedRows}>
              {value.map((row, index) => (
                <li key={row.key} className={styles.relatedRow}>
                  <span className={styles.completionIndex} aria-hidden="true">
                    {index + 1}
                  </span>
                  {row.existingId ? (
                    // Liên kết đã lưu: loại và hồ sơ cố định, muốn đổi thì gỡ rồi thêm dòng mới.
                    <span className={styles.relatedFixed}>
                      <span className={styles.relatedKind}>{row.kindLabel ?? row.kind}</span>
                      <span className={styles.relatedFixedLabel}>{row.label || row.objectId}</span>
                    </span>
                  ) : (
                    <RelatedObjectPicker
                      kinds={kinds}
                      kind={row.kind}
                      objectId={row.objectId}
                      label={row.label}
                      kindLabel={row.kindLabel}
                      ariaLabel={`${ariaPrefix} ${index + 1}`}
                      height={height}
                      disabled={disabled}
                      isTaken={takenBy(row.key)}
                      onKindChange={(kind) => {
                        if (kind !== row.kind) update(row.key, { kind, objectId: '', label: '', kindLabel: undefined });
                      }}
                      onPick={(candidate) =>
                        update(
                          row.key,
                          candidate
                            ? { objectId: candidate.id, label: relatedDisplayLabel(candidate.code, candidate.label) }
                            : { objectId: '', label: '' },
                        )
                      }
                      onCreate={
                        creatable(row.kind)
                          ? () => setCreating({ key: row.key, kind: row.kind, kindLabel: creatable(row.kind)?.label })
                          : undefined
                      }
                    />
                  )}
                  {/* Hồ sơ chưa có ở module gốc: tạo ngay tại đây, xong thì thành hồ sơ đã chọn của dòng. */}
                  {!row.existingId && !row.objectId && creatable(row.kind) ? (
                    <Tooltip content={`Tạo ${(creatable(row.kind)?.label ?? 'hồ sơ').toLocaleLowerCase('vi')} mới`}>
                      <button
                        type="button"
                        className={styles.draftIconButton}
                        aria-label={`Tạo mới ${ariaPrefix.toLowerCase()} ${index + 1}`}
                        disabled={disabled}
                        onClick={() => setCreating({ key: row.key, kind: row.kind, kindLabel: creatable(row.kind)?.label })}
                      >
                        <Plus size={15} />
                      </button>
                    </Tooltip>
                  ) : null}
                  {row.existingId && !row.canRemove ? (
                    <span className={styles.relatedRemoveSpacer} aria-hidden="true" />
                  ) : (
                    <Tooltip content={row.existingId ? 'Gỡ liên kết' : 'Bỏ dòng này'}>
                      <button
                        type="button"
                        className={`${styles.draftIconButton} ${styles.draftIconRemove}`}
                        aria-label={`Bỏ ${ariaPrefix.toLowerCase()} ${index + 1}`}
                        disabled={disabled}
                        onClick={() => onChange(value.filter((entry) => entry.key !== row.key))}
                      >
                        <X size={15} />
                      </button>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          {addable ? (
            <div className={styles.relatedAddRow}>
              <button
                type="button"
                className={styles.relatedAdd}
                disabled={disabled || atLimit}
                aria-label={`Thêm dòng ${ariaPrefix.toLowerCase()}`}
                onClick={() => onChange([...value, blankRow()])}
              >
                <span className={styles.relatedAddIcon} aria-hidden="true">
                  <Plus size={14} />
                </span>
                Thêm đối tượng
              </button>
              {atLimit ? (
                <span className={styles.fieldHint}>
                  {`Tối đa ${RELATED_OBJECT_MAX_PER_ENTITY} đối tượng.`}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <RelatedObjectCreateDialog
        kind={creating?.kind}
        kindLabel={creating?.kindLabel}
        onClose={() => setCreating(undefined)}
        onCreated={(created) => {
          // Hồ sơ mới thành một dòng bình thường: form tạo gắn sau khi tạo xong, form sửa gắn lúc lưu.
          const target = creating;
          setCreating(undefined);
          if (!target) return;
          if (value.some((row) => row.key === target.key)) update(target.key, pendingFromCreated(created));
          else if (value.length < limit) onChange([...value, pendingRelatedRow({ kind: target.kind, ...pendingFromCreated(created) })]);
        }}
      />
    </div>
  );
}
