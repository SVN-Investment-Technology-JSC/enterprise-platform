'use client';

import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import styles from '../workspace.module.scss';
import { tagColor, useTags } from './use-tags';

export interface TagPickerProps {
  readonly selected: readonly string[];
  readonly onChange: (tagIds: string[]) => void;
}

/** Bỏ dấu để gõ "khan" vẫn ra "khẩn". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
}

/** Chọn nhãn có sẵn, hoặc gõ tên mới rồi Enter để tạo nhãn. */
export function TagPicker({ selected, onChange }: TagPickerProps) {
  const tags = useTags();
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string>();

  const needle = fold(term.trim());
  const suggestions = useMemo(
    () =>
      tags.tags
        .filter((tag) => tag.isActive && !selected.includes(tag.id))
        .filter((tag) => !needle || fold(tag.name).includes(needle))
        .slice(0, 8),
    [tags.tags, selected, needle],
  );
  const exact = tags.tags.find((tag) => fold(tag.name) === needle);

  const add = (tagId: string) => {
    onChange([...selected, tagId]);
    setTerm('');
    setError(undefined);
  };

  const createFromTerm = async () => {
    const name = term.trim();
    if (!name) return;
    if (exact) {
      if (exact.isActive && !selected.includes(exact.id)) add(exact.id);
      return;
    }
    try {
      add((await tags.create(name)).id);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tạo được nhãn.');
    }
  };

  return (
    <div className={styles.peoplePicker}>
      {selected.length > 0 ? (
        <ul className={styles.chipList}>
          {selected.map((tagId) => {
            const tag = tags.find(tagId);
            const color = tag ? tagColor(tag) : '#475569';
            return (
              <li key={tagId} className={styles.tagChip} style={{ borderColor: color, color }}>
                {tag?.name ?? '…'}
                <button
                  type="button"
                  aria-label={`Bỏ nhãn ${tag?.name ?? ''}`}
                  onClick={() => onChange(selected.filter((entry) => entry !== tagId))}
                >
                  <X size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        value={term}
        placeholder="Gõ để tìm hoặc tạo nhãn"
        aria-label="Thêm nhãn"
        onFocus={() => setError(undefined)}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void createFromTerm();
          }
        }}
      />
      {term.trim() ? (
        <ul className={styles.mentionList}>
          {suggestions.map((tag) => (
            <li key={tag.id}>
              <button type="button" onClick={() => add(tag.id)}>
                <span className={styles.tagDot} style={{ background: tagColor(tag) }} />
                {tag.name}
              </button>
            </li>
          ))}
          {term.trim() && !exact ? (
            <li>
              <button type="button" onClick={() => void createFromTerm()}>
                Tạo nhãn <strong>{term.trim().toLocaleLowerCase('vi')}</strong>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {error ? <p className={styles.fieldHint}>{error}</p> : null}
    </div>
  );
}
