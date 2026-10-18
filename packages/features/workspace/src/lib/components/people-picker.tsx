'use client';

import type { DirectoryPerson } from '@enterprise-platform/contracts-workspace';
import { X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import styles from '../workspace.module.scss';

export interface PeoplePickerProps {
  readonly people: readonly DirectoryPerson[];
  readonly selected: readonly string[];
  readonly onChange: (userIds: string[]) => void;
  readonly nameOf: (userId: string) => string;
  /** Không cho chọn — ví dụ chính người tổ chức, hay người đã là thành viên. */
  readonly exclude?: readonly string[];
  /**
   * Nhãn gắn cạnh tên một người — trả về chuỗi để hiện (vd "Ngoài dự án") hoặc
   * `undefined` để bỏ qua. Dùng cho cả gợi ý tìm và chip đã chọn.
   */
  readonly tagFor?: (userId: string) => string | undefined;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  /** Danh bạ không đọc được: hiện câu giải thích thay cho ô tìm. */
  readonly degraded?: boolean;
  /** Danh bạ đã tải xong. Chỉ khi đó danh bạ rỗng mới là "chưa có ai". */
  readonly loaded?: boolean;
}

/**
 * Danh bạ lấy từ cơ cấu tổ chức của Tenant Core, nên chỉ người đã được bổ
 * nhiệm vào một chức danh mới có mặt. Tenant chưa dựng cơ cấu thì danh bạ
 * rỗng — phải nói rõ lý do, không thì người dùng tưởng module hỏng.
 */
const DIRECTORY_SCOPE_NOTE =
  'Danh bạ chỉ gồm người đã được bổ nhiệm vào một chức danh trong cơ cấu tổ chức.';

/** Số gợi ý tối đa. Danh bạ vài nghìn người thì không ai cuộn hết. */
const MAX_SUGGESTIONS = 8;

/** Bỏ dấu để gõ "nguyen" vẫn ra "Nguyễn". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Chọn nhiều người từ danh bạ tổ chức.
 *
 * Tìm theo tên, email và tên đơn vị, không phân biệt dấu. Người đã chọn hiện
 * thành chip phía trên ô tìm, bấm ✕ để bỏ.
 */
export function PeoplePicker({
  people,
  selected,
  onChange,
  nameOf,
  exclude = [],
  tagFor,
  disabled = false,
  placeholder = 'Tìm theo tên, email hoặc đơn vị',
  degraded = false,
  loaded = true,
}: PeoplePickerProps) {
  const [term, setTerm] = useState('');
  /** Gợi ý đang được chọn bằng phím Lên/Xuống. */
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => {
    const needle = fold(term.trim());
    if (!needle) return [];
    const hidden = new Set([...selected, ...exclude]);
    return people
      .filter((person) => !hidden.has(person.userId))
      .filter((person) =>
        fold([person.displayName, person.email ?? '', ...person.unitNames].join(' ')).includes(needle),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [people, selected, exclude, term]);

  const add = (userId: string) => {
    onChange([...selected, userId]);
    setTerm('');
    setActive(0);
  };

  /**
   * Phím trong ô tìm. Ô nằm trong `<form>` của hộp thoại: để Enter lọt xuống
   * là gửi luôn cả form khi người dùng chỉ định chọn một gợi ý.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const person = suggestions[Math.min(active, suggestions.length - 1)];
      if (person) add(person.userId);
    } else if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Escape' && term) {
      // Chỉ xoá ô tìm; không để Esc đóng luôn hộp thoại.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setTerm('');
      setActive(0);
    }
  };

  return (
    <div className={styles.peoplePicker}>
      {selected.length > 0 ? (
        <ul className={styles.chipList}>
          {selected.map((userId) => (
            <li key={userId} className={styles.chip}>
              {nameOf(userId)}
              {tagFor?.(userId) ? (
                <span className={styles.outsideTag}>{tagFor(userId)}</span>
              ) : null}
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Bỏ ${nameOf(userId)}`}
                  onClick={() => onChange(selected.filter((entry) => entry !== userId))}
                >
                  <X size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {disabled ? null : degraded ? (
        <p className={styles.muted}>Không đọc được danh bạ tổ chức lúc này. Thử lại sau ít phút.</p>
      ) : loaded && people.length === 0 ? (
        <p className={styles.muted} role="status">
          Danh bạ tổ chức đang trống. Quản trị viên tenant cần dựng cơ cấu tổ chức (đơn vị, chức
          danh) và bổ nhiệm người vào chức danh ở Tenant Portal trước, sau đó mới chọn được người
          ở đây.
        </p>
      ) : (
        <>
          <input
            value={term}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {suggestions.length > 0 ? (
            <ul className={styles.mentionList}>
              {suggestions.map((person, index) => (
                <li key={person.userId}>
                  <button
                    type="button"
                    aria-selected={index === active}
                    className={index === active ? styles.mentionActive : undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => add(person.userId)}
                  >
                    <strong>{person.displayName}</strong>
                    {tagFor?.(person.userId) ? (
                      <span className={styles.outsideTag}>{tagFor(person.userId)}</span>
                    ) : null}
                    {person.unitNames.length > 0 || person.email ? (
                      <span className={styles.muted}>
                        {' '}
                        · {[person.unitNames.join(', '), person.email].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : term.trim() ? (
            <p className={styles.muted}>Không tìm thấy ai khớp. {DIRECTORY_SCOPE_NOTE}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
