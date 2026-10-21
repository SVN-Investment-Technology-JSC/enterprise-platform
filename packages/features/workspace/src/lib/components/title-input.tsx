'use client';

import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { fold } from './people-picker';

/** Số gợi ý hiện cùng lúc. */
const MAX_SUGGESTIONS = 8;

/**
 * Tên công việc đã dùng (mới nhất trước), tải một lần mỗi khi form mở. Lỗi thì không gợi ý gì, ô nhập vẫn
 * dùng bình thường.
 */
export function useRecentTitles(open: boolean): readonly string[] {
  const [titles, setTitles] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .listWorkItemTitles()
      .then((result) => {
        if (alive) setTitles(result.items);
      })
      .catch(() => {
        if (alive) setTitles([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  return titles;
}

export interface TitleInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Tên đã dùng, mới nhất trước. */
  readonly history: readonly string[];
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly autoFocus?: boolean;
  /** Dán nhiều dòng: nơi gọi tách thành nhiều công việc. Vắng thì dán như thường. */
  readonly onPasteLines?: (lines: string[]) => void;
}

/**
 * Ô nhập tên công việc. Bấm vào là hiện các tên đã dùng gần đây; gõ thì lọc theo chữ (không phân biệt dấu).
 * Lên/Xuống để chọn, Enter để lấy tên đó, Esc để đóng danh sách.
 */
export function TitleInput({
  value,
  onChange,
  history,
  placeholder,
  ariaLabel = 'Tên công việc',
  autoFocus,
  onPasteLines,
}: TitleInputProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const suggestions = useMemo(() => {
    const needle = fold(value.trim());
    return history
      .filter((title) => title !== value && (!needle || fold(title).includes(needle)))
      .slice(0, MAX_SUGGESTIONS);
  }, [history, value]);

  const pick = (title: string) => {
    onChange(title);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      // Ô nằm trong form của hộp thoại: Enter lúc đang chọn gợi ý không được gửi form.
      event.preventDefault();
      pick(suggestions[active] as string);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!onPasteLines) return;
    const lines = event.clipboardData
      .getData('text')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    event.preventDefault();
    onPasteLines(lines);
  };

  return (
    <div className={styles.titleInput}>
      <input
        value={value}
        required
        maxLength={200}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {open && suggestions.length > 0 ? (
        <ul className={styles.titleSuggestions} role="listbox" aria-label="Tên công việc đã dùng">
          {suggestions.map((title, index) => (
            <li key={title}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? styles.mentionActive : undefined}
                // mousedown chạy trước blur của ô nhập: chặn để danh sách không đóng trước khi chọn.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(title)}
              >
                {title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
