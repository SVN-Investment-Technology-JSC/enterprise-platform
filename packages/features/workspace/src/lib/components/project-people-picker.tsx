'use client';

import type { DirectoryPerson } from '@enterprise-platform/contracts-workspace';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import styles from '../workspace.module.scss';
import { fold } from './people-picker';

export interface ProjectPeoplePickerProps {
  /** Mọi người chọn được (thường là cả danh bạ công ty). */
  readonly people: readonly DirectoryPerson[];
  /** Thành viên dự án: đứng đầu danh sách; người còn lại gập sau nút "Ngoài dự án". */
  readonly memberIds: ReadonlySet<string>;
  readonly selected: readonly string[];
  readonly onChange: (userIds: string[]) => void;
  readonly nameOf: (userId: string) => string;
  /** Không cho chọn, ví dụ người phụ trách của chính việc đó. */
  readonly exclude?: readonly string[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Danh bạ đã tải xong. Chỉ khi đó danh bạ rỗng mới là "chưa có ai". */
  readonly loaded?: boolean;
}

/** Dòng phụ của một người: chức danh rồi bộ phận. */
export function personDetail(person: DirectoryPerson): string {
  return [person.positionName, person.unitNames.join(', ')].filter(Boolean).join(' · ');
}

/**
 * Chọn nhiều người theo dự án, cùng kiểu ô "Người phụ trách": bấm vào ô là mở danh sách, thành viên dự án đứng
 * đầu, người ngoài dự án gập sau nút "Ngoài dự án" kèm hai ô lọc riêng (tên; chức danh / bộ phận). Chọn một người
 * thì danh sách vẫn mở để chọn tiếp; người đã chọn hiện thành chip phía trên.
 */
export function ProjectPeoplePicker({
  people,
  memberIds,
  selected,
  onChange,
  nameOf,
  exclude = [],
  placeholder = 'Tìm người theo tên, chức danh hoặc bộ phận',
  disabled = false,
  loaded = true,
}: ProjectPeoplePickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [detailFilter, setDetailFilter] = useState('');
  /** Dòng đang được chọn bằng phím Lên/Xuống, đếm trên cả hai nhóm đang hiện. */
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài thì đóng danh sách. Đóng ở `click` chứ không ở `mousedown`: danh sách nằm trong luồng trang, gập
  // lúc nhấn chuột thì nút bên dưới (vd "Lưu thay đổi") dịch lên và cú bấm trượt khỏi nút.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [open]);

  const { inside, outside, outsideTotal } = useMemo(() => {
    const hidden = new Set([...selected, ...exclude]);
    const needle = fold(term.trim());
    const byName = fold(nameFilter.trim());
    const byDetail = fold(detailFilter.trim());
    const matches = (person: DirectoryPerson) =>
      !needle ||
      fold([person.displayName, person.email ?? '', personDetail(person)].join(' ')).includes(needle);
    const candidates = people.filter((person) => !hidden.has(person.userId) && matches(person));
    const rest = candidates.filter((person) => !memberIds.has(person.userId));
    return {
      inside: candidates.filter((person) => memberIds.has(person.userId)),
      outside: rest.filter(
        (person) =>
          (!byName || fold(person.displayName).includes(byName)) &&
          (!byDetail || fold(personDetail(person)).includes(byDetail)),
      ),
      outsideTotal: rest.length,
    };
  }, [people, memberIds, selected, exclude, term, nameFilter, detailFilter]);

  // Gõ tìm ở ô chính thì tìm luôn trong nhóm ngoài dự án, không cần bấm mở.
  const showOutside = outsideOpen || Boolean(term.trim());
  const visible = showOutside ? [...inside, ...outside] : inside;

  const add = (userId: string) => {
    onChange([...selected, userId]);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'Enter') {
      // Ô nằm trong `<form>` của hộp thoại: để Enter lọt xuống là gửi luôn cả form.
      event.preventDefault();
      const person = visible[active];
      if (person) add(person.userId);
    } else if (event.key === 'ArrowDown' && visible.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % visible.length);
    } else if (event.key === 'ArrowUp' && visible.length > 0) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? visible.length - 1 : index - 1));
    } else if (event.key === 'Escape' && open) {
      // Chỉ đóng danh sách; không để Esc đóng luôn hộp thoại.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  const row = (person: DirectoryPerson, index: number) => {
    const member = memberIds.has(person.userId);
    const detail = personDetail(person);
    return (
      <li key={person.userId}>
        <button
          type="button"
          aria-selected={index === active}
          className={index === active ? styles.groupPickerActive : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => add(person.userId)}
        >
          <span className={styles.assigneeOptionRow}>
            <span>{person.displayName}</span>
            <span className={member ? styles.assigneeTagIn : styles.assigneeTagOut}>
              {member ? 'Trong dự án' : 'Ngoài dự án'}
            </span>
          </span>
          {detail ? <span className={styles.assigneeOptionHint}>{detail}</span> : null}
        </button>
      </li>
    );
  };

  return (
    <div ref={box} className={styles.peoplePicker}>
      {selected.length > 0 ? (
        <ul className={styles.chipList}>
          {selected.map((userId) => (
            <li key={userId} className={styles.chip}>
              {nameOf(userId)}
              {memberIds.has(userId) ? null : <span className={styles.outsideTag}>Ngoài dự án</span>}
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

      {disabled ? null : loaded && people.length === 0 ? (
        <p className={styles.muted} role="status">
          Danh bạ tổ chức đang trống. Quản trị viên tenant cần bổ nhiệm người vào chức danh ở Tenant Portal trước.
        </p>
      ) : (
        <>
          <input
            value={term}
            placeholder={placeholder}
            aria-label={placeholder}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
          />
          {open ? (
            <ul className={styles.groupPickerList} role="listbox" aria-multiselectable="true">
              {inside.map(row)}
              {inside.length === 0 ? (
                <li className={styles.groupPickerEmpty}>
                  {term.trim() ? 'Không có thành viên dự án nào khớp.' : 'Đã chọn hết thành viên dự án.'}
                </li>
              ) : null}
              {outsideTotal > 0 ? (
                <li>
                  <button
                    type="button"
                    className={styles.groupPickerToggle}
                    aria-expanded={outsideOpen}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setOutsideOpen((value) => !value)}
                  >
                    <span>Ngoài dự án ({outsideTotal})</span>
                    <ChevronDown
                      size={14}
                      style={{ transform: outsideOpen ? 'rotate(180deg)' : undefined }}
                    />
                  </button>
                </li>
              ) : null}
              {outsideOpen && outsideTotal > 0 ? (
                <li className={styles.groupPickerFilters}>
                  <input
                    value={nameFilter}
                    placeholder="Tên"
                    aria-label="Lọc người ngoài dự án theo tên"
                    onChange={(event) => {
                      setNameFilter(event.target.value);
                      setActive(-1);
                    }}
                  />
                  <input
                    value={detailFilter}
                    placeholder="Chức danh / bộ phận"
                    aria-label="Lọc người ngoài dự án theo chức danh hoặc bộ phận"
                    onChange={(event) => {
                      setDetailFilter(event.target.value);
                      setActive(-1);
                    }}
                  />
                </li>
              ) : null}
              {showOutside ? outside.map((person, offset) => row(person, inside.length + offset)) : null}
              {outsideOpen && outsideTotal > 0 && outside.length === 0 ? (
                <li className={styles.groupPickerEmpty}>Không có ai khớp.</li>
              ) : null}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
