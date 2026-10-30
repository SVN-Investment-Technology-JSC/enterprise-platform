'use client';

import { Check, Plus } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import styles from '../workspace.module.scss';
import { MultiSelectBox } from './multi-select-box';
import { tagColor, useTags } from './use-tags';

export interface TagPickerProps {
  readonly selected: readonly string[];
  readonly onChange: (tagIds: string[]) => void;
}

/** Bỏ dấu để gõ "khan" vẫn ra "khẩn". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
}

/**
 * Chọn nhãn kiểu Select nhiều lựa chọn (xem `MultiSelectBox`): nhãn đã chọn hiện thành chip trong ô, dư thì gộp "+n".
 * Danh sách xổ ra liệt kê nhãn có sẵn (bấm để chọn hoặc bỏ chọn) và có ô "Nhãn mới" ở chân để tạo thêm ngay tại đó,
 * như mẫu dropdown tuỳ biến của Ant Design. Gõ ở ô chính để lọc; Enter chọn nhãn trùng tên hoặc tạo mới.
 */
export function TagPicker({ selected, onChange }: TagPickerProps) {
  const tags = useTags();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string>();

  const needle = fold(term.trim());
  const options = useMemo(
    () => tags.tags.filter((tag) => tag.isActive && (!needle || fold(tag.name).includes(needle))),
    [tags.tags, needle],
  );

  const toggle = (tagId: string) => {
    onChange(selected.includes(tagId) ? selected.filter((entry) => entry !== tagId) : [...selected, tagId]);
    setError(undefined);
  };

  /** Chọn nhãn trùng tên nếu có, không thì tạo mới rồi chọn. Trả về có thành công không. */
  const chooseOrCreate = async (raw: string): Promise<boolean> => {
    const name = raw.trim();
    if (!name) return false;
    const exact = tags.tags.find((tag) => fold(tag.name) === fold(name));
    try {
      if (exact) {
        if (exact.isActive && !selected.includes(exact.id)) onChange([...selected, exact.id]);
      } else {
        onChange([...selected, (await tags.create(name)).id]);
      }
      setError(undefined);
      return true;
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không tạo được nhãn.');
      return false;
    }
  };

  const closeOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || !open) return;
    // Chỉ đóng danh sách; không để Esc đóng luôn hộp thoại.
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    setOpen(false);
  };

  return (
    <MultiSelectBox
      chips={selected.map((tagId) => {
        const tag = tags.find(tagId);
        return { id: tagId, label: tag?.name ?? '…', color: tag ? tagColor(tag) : '#475569' };
      })}
      onRemove={(tagId) => onChange(selected.filter((entry) => entry !== tagId))}
      term={term}
      onTermChange={setTerm}
      onKeyDown={(event) => {
        closeOnEscape(event);
        if (event.key === 'Enter') {
          // Ô nằm trong `<form>` của hộp thoại: để Enter lọt xuống là gửi luôn cả form.
          event.preventDefault();
          void chooseOrCreate(term).then((done) => {
            if (done) setTerm('');
          });
        }
      }}
      placeholder="Chọn hoặc gõ để tìm nhãn"
      open={open}
      onOpenChange={setOpen}
    >
      <ul className={styles.groupPickerList} role="listbox" aria-multiselectable="true">
        {options.map((tag) => {
          const checked = selected.includes(tag.id);
          return (
            <li key={tag.id}>
              <button
                type="button"
                role="option"
                aria-selected={checked}
                className={styles.tagOption}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(tag.id)}
              >
                <span className={styles.tagDot} style={{ background: tagColor(tag) }} />
                <span className={styles.tagOptionName}>{tag.name}</span>
                {checked ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            </li>
          );
        })}
        {options.length === 0 ? (
          <li className={styles.groupPickerEmpty}>
            {term.trim() ? 'Không có nhãn nào khớp. Nhấn Enter để tạo nhãn này.' : 'Chưa có nhãn nào. Tạo nhãn đầu tiên ở dưới.'}
          </li>
        ) : null}
      </ul>

      <div className={styles.multiFooter}>
        <input
          value={newName}
          placeholder="Tên nhãn mới"
          aria-label="Tên nhãn mới"
          onChange={(event) => {
            setNewName(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            closeOnEscape(event);
            if (event.key === 'Enter') {
              event.preventDefault();
              void chooseOrCreate(newName).then((done) => {
                if (done) setNewName('');
              });
            }
          }}
        />
        <button
          type="button"
          className={styles.buttonSmall}
          disabled={!newName.trim()}
          onClick={() =>
            void chooseOrCreate(newName).then((done) => {
              if (done) setNewName('');
            })
          }
        >
          <Plus size={13} /> Thêm nhãn
        </button>
      </div>
      {error ? <p className={`${styles.fieldHint} ${styles.multiFooterError}`}>{error}</p> : null}
    </MultiSelectBox>
  );
}
