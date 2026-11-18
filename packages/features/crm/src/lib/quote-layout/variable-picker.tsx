'use client';

/**
 * Danh sách biến để chèn vào ô chữ của trình thiết kế (plan mục 5.3, 9.3): nhóm theo bảng 5.3, tìm theo nhãn tiếng Việt
 * (gõ không dấu cũng ra), có trường tuỳ biến đang bật. Chèn tại vị trí con trỏ do ô gọi tự làm bằng `insertAtCaret`.
 */
import {
  QUOTE_LAYOUT_VARIABLES,
  QUOTE_LAYOUT_VARIABLE_GROUPS,
  QUOTE_LAYOUT_VARIABLE_GROUP_LABELS,
  type CustomFieldDefinition,
  type QuoteLayoutVariableGroup,
} from '@enterprise-platform/contracts-crm';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './layout-designer.module.scss';
import { customFieldVariable } from './quote-layout.data';

/** Bỏ dấu tiếng Việt, chữ thường: "Tên khách" và "ten khach" khớp nhau. */
export function foldVietnamese(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export interface VariableOption {
  readonly key: string;
  readonly label: string;
}

export interface VariableGroup {
  readonly id: QuoteLayoutVariableGroup | 'custom';
  readonly label: string;
  readonly items: readonly VariableOption[];
}

/** Biến theo nhóm, lọc theo từ khoá (khớp nhãn hoặc tên biến, không phân biệt dấu). Chỉ trường tuỳ biến đang bật. */
export function filterQuoteVariables(query: string, customFields: readonly CustomFieldDefinition[] = []): VariableGroup[] {
  const words = foldVietnamese(query).split(/\s+/).filter(Boolean);
  const matches = (option: VariableOption) => {
    const haystack = `${foldVietnamese(option.label)} ${option.key.toLowerCase()}`;
    return words.every((word) => haystack.includes(word));
  };
  const groups: VariableGroup[] = QUOTE_LAYOUT_VARIABLE_GROUPS.map((group) => ({
    id: group,
    label: QUOTE_LAYOUT_VARIABLE_GROUP_LABELS[group],
    items: QUOTE_LAYOUT_VARIABLES.filter((variable) => variable.group === group).map(({ key, label }) => ({ key, label })),
  }));
  groups.push({
    id: 'custom',
    label: QUOTE_LAYOUT_VARIABLE_GROUP_LABELS.custom,
    items: [...customFields]
      .filter((field) => field.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))
      .map((field) => ({ key: customFieldVariable(field.id), label: field.name })),
  });
  return groups.map((group) => ({ ...group, items: group.items.filter(matches) })).filter((group) => group.items.length > 0);
}

/** Chèn `{{biến}}` vào chuỗi tại vùng chọn `[start, end)` (thay vùng chọn nếu có); trả chuỗi mới và vị trí con trỏ sau chỗ chèn. */
export function insertAtCaret(value: string, start: number | null | undefined, end: number | null | undefined, insert: string): { value: string; caret: number } {
  const from = typeof start === 'number' ? Math.max(0, Math.min(value.length, start)) : value.length;
  const to = typeof end === 'number' ? Math.max(from, Math.min(value.length, end)) : from;
  return { value: value.slice(0, from) + insert + value.slice(to), caret: from + insert.length };
}

export const variableToken = (key: string) => `{{${key}}}`;

export interface VariablePickerProps {
  readonly customFields?: readonly CustomFieldDefinition[];
  readonly onPick: (key: string) => void;
  readonly onClose: () => void;
}

/** Bảng chọn biến (nổi dưới nút "Chèn biến"); Esc hoặc bấm ra ngoài thì đóng. */
export function VariablePicker({ customFields = [], onPick, onClose }: VariablePickerProps) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchId = useId();
  const groups = useMemo(() => filterQuoteVariables(query, customFields), [query, customFields]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className={styles.variablePicker}
      role="dialog"
      aria-label="Chèn biến"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label className={styles.variableSearch} htmlFor={searchId}>
        <Search size={14} aria-hidden="true" />
        <input
          id={searchId}
          autoFocus
          value={query}
          placeholder="Tìm biến theo tên (không dấu cũng được)"
          aria-label="Tìm biến"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = groups[0]?.items[0];
            if (event.key === 'Enter' && first) {
              event.preventDefault();
              onPick(first.key);
            }
          }}
        />
      </label>
      <div className={styles.variableList}>
        {groups.length === 0 ? <p className={styles.muted}>Không có biến phù hợp.</p> : null}
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.label}>
            <div className={styles.variableGroupLabel}>{group.label}</div>
            {group.items.map((item) => (
              <button key={item.key} type="button" className={styles.variableItem} onClick={() => onPick(item.key)}>
                <span>{item.label}</span>
                <code>{variableToken(item.key)}</code>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
