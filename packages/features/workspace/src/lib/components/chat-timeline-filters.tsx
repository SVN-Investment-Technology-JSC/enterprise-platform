'use client';

import type { ProjectMember, WorkItem } from '@enterprise-platform/contracts-workspace';
import {
  CHAT_TIMELINE_MAX_QUERY_LENGTH,
  CHAT_TIMELINE_PROJECT_NODE,
} from '@enterprise-platform/contracts-workspace';
import { AtSign, ListFilter, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  EMPTY_FILTER_DRAFT,
  panelFilterCount,
  type TimelineFilterDraft,
} from '../chat-timeline.model';
import styles from '../workspace.module.scss';
import { DatePickField } from './date-pick-field';
import { Input } from './form-controls';
import { MultiSelectBox } from './multi-select-box';
import { Tooltip } from './tooltip';
import { fold } from './people-picker';

export interface ChatTimelineFiltersProps {
  readonly draft: TimelineFilterDraft;
  readonly onChange: (draft: TimelineFilterDraft) => void;
  readonly members: readonly ProjectMember[];
  readonly items: readonly WorkItem[];
  readonly nameOf: (userId: string) => string;
  /**
   * Chỗ trên hàng tab của trang để đặt thanh lọc, nhờ vậy khung chat không mất thêm một hàng. `undefined`: đặt ngay trong
   * khung (có viền, một hàng riêng); `null`: chỗ đó chưa sẵn sàng nên chưa vẽ gì.
   */
  readonly slot?: HTMLElement | null;
}

/** Chỗ chừa cho ô gõ "Thêm…" trong ô chọn nhiều: ít hơn mặc định để chip hiện nhiều hơn trước khi gộp "+n". */
const FILTER_INPUT_RESERVE_PX = 56;

interface PickOption {
  readonly id: string;
  readonly label: string;
  /** Dòng phụ nhỏ, ví dụ trạng thái hay chức danh. */
  readonly hint?: string;
}

/**
 * Thanh lọc của dòng thời gian, GỌN và CỐ ĐỊNH CHIỀU CAO: một hàng gồm ô tìm, nút "Nhắc tôi", nút "Bộ lọc" và nút
 * xoá. Các bộ lọc còn lại (người gửi, công việc, khoảng ngày, đính kèm) nằm trong bảng nổi mở từ nút "Bộ lọc", nên
 * bật hay tắt bộ lọc không bao giờ đẩy bố cục bên dưới. Nút xoá luôn có mặt (mờ đi khi chưa lọc gì) cũng vì lẽ đó.
 *
 * Người gửi và công việc chọn nhiều được (khớp một trong số đã chọn); các nhóm khác nhau cộng dồn (VÀ). Lọc ở server
 * nên "Xem tin cũ hơn" vẫn đúng trên kết quả lọc.
 */
export function ChatTimelineFilters({ draft, onChange, members, items, nameOf, slot }: ChatTimelineFiltersProps) {
  const set = (patch: Partial<TimelineFilterDraft>) => onChange({ ...draft, ...patch });
  const [panelOpen, setPanelOpen] = useState(false);
  const panelBox = useRef<HTMLDivElement>(null);

  const authorOptions = useMemo<PickOption[]>(
    () => members.map((member) => ({ id: member.userId, label: nameOf(member.userId) })),
    [members, nameOf],
  );
  const nodeOptions = useMemo<PickOption[]>(
    () => [
      { id: CHAT_TIMELINE_PROJECT_NODE, label: 'Chat chung của dự án' },
      ...items.map((item) => ({ id: item.id, label: item.title, hint: item.code })),
    ],
    [items],
  );

  // Bấm ra ngoài bảng thì đóng; bấm vào danh sách xổ của ô chọn (nằm trong bảng) thì không.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!panelBox.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [panelOpen]);

  const facets = panelFilterCount(draft);
  const anything = facets > 0 || draft.mentionsMe || draft.q.trim() !== '';

  const bar = (
    <div
      className={slot ? `${styles.timelineFilters} ${styles.timelineFiltersSlot}` : styles.timelineFilters}
      role="search"
      aria-label="Lọc trao đổi"
    >
      <label className={styles.searchField}>
        <Search size={14} aria-hidden />
        <Input
          type="search"
          value={draft.q}
          maxLength={CHAT_TIMELINE_MAX_QUERY_LENGTH}
          placeholder="Tìm tin nhắn"
          aria-label="Tìm tin nhắn"
          onChange={(event) => set({ q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && draft.q) {
              event.stopPropagation();
              set({ q: '' });
            }
          }}
        />
      </label>
      <Tooltip content="Chỉ tin có nhắc tên bạn">
        <button
          type="button"
          className={draft.mentionsMe ? styles.timelineToggleOn : styles.timelineToggle}
          aria-pressed={draft.mentionsMe}
          aria-label="Nhắc tôi"
          onClick={() => set({ mentionsMe: !draft.mentionsMe })}
        >
          <AtSign size={13} aria-hidden />
          <span className={styles.timelineMentionLabel}>Nhắc tôi</span>
        </button>
      </Tooltip>
      <div ref={panelBox} className={styles.timelinePanelBox}>
        <button
          type="button"
          className={facets > 0 || panelOpen ? styles.timelineToggleOn : styles.timelineToggle}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((value) => !value)}
        >
          <ListFilter size={13} aria-hidden />
          Bộ lọc
          {facets > 0 ? <span className={styles.countBadge}>{facets}</span> : null}
        </button>
        {panelOpen ? (
          <div
            className={styles.timelinePanel}
            role="dialog"
            aria-label="Bộ lọc trao đổi"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setPanelOpen(false);
              }
            }}
          >
            <div className={styles.timelinePanelField}>
              <span>Người gửi</span>
              <MultiPick
                label="Người gửi"
                options={authorOptions}
                selected={draft.authors}
                onChange={(authors) => set({ authors })}
                placeholder="Chọn người gửi"
                emptyText="Không có thành viên phù hợp."
              />
            </div>
            <div className={styles.timelinePanelField}>
              <span>Công việc</span>
              <MultiPick
                label="Công việc"
                options={nodeOptions}
                selected={draft.nodes}
                onChange={(nodes) => set({ nodes })}
                placeholder="Chọn công việc"
                emptyText="Không có công việc phù hợp."
              />
            </div>
            <div className={styles.timelinePanelDates}>
              <label className={styles.timelinePanelField}>
                <span>Từ ngày</span>
                <DatePickField
                  aria-label="Từ ngày"
                  value={draft.fromDay}
                  max={draft.toDay || undefined}
                  onChange={(fromDay) => set({ fromDay })}
                />
              </label>
              <label className={styles.timelinePanelField}>
                <span>Đến ngày</span>
                <DatePickField
                  aria-label="Đến ngày"
                  value={draft.toDay}
                  min={draft.fromDay || undefined}
                  onChange={(toDay) => set({ toDay })}
                />
              </label>
            </div>
            <label className={styles.timelinePanelCheck}>
              <input
                type="checkbox"
                checked={draft.hasAttachment}
                onChange={(event) => set({ hasAttachment: event.target.checked })}
              />
              Chỉ tin có đính kèm
            </label>
          </div>
        ) : null}
      </div>
      <Tooltip content="Xoá bộ lọc">
        <button
          type="button"
          className={styles.timelineFilterClear}
          disabled={!anything}
          aria-label="Xoá bộ lọc"
          onClick={() => onChange(EMPTY_FILTER_DRAFT)}
        >
          <X size={15} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );

  if (slot === undefined) return bar;
  return slot ? createPortal(bar, slot) : null;
}

/**
 * Chọn nhiều mục kiểu Select nhiều lựa chọn (dùng lại `MultiSelectBox` như bộ chọn người của dự án): mục đã chọn hiện
 * thành chip trong ô, gõ để tìm (không phân biệt dấu), Lên/Xuống chọn dòng, Enter thêm.
 */
function MultiPick({
  label,
  options,
  selected,
  onChange,
  placeholder,
  emptyText,
}: {
  label: string;
  options: readonly PickOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(-1);

  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const candidates = useMemo(() => {
    const taken = new Set(selected);
    const needle = fold(term.trim());
    return options.filter(
      (option) => !taken.has(option.id) && (!needle || fold(`${option.label} ${option.hint ?? ''}`).includes(needle)),
    );
  }, [options, selected, term]);

  const add = (id: string) => {
    onChange([...selected, id]);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = candidates[active];
      if (option) add(option.id);
    } else if (event.key === 'ArrowDown' && candidates.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % candidates.length);
    } else if (event.key === 'ArrowUp' && candidates.length > 0) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? candidates.length - 1 : index - 1));
    } else if (event.key === 'Escape' && open) {
      // Chỉ đóng danh sách; không để Esc đóng luôn bảng bộ lọc.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  return (
    <MultiSelectBox
      chips={selected.map((id) => ({ id, label: byId.get(id)?.label ?? id }))}
      onRemove={(id) => onChange(selected.filter((entry) => entry !== id))}
      term={term}
      onTermChange={(next) => {
        setTerm(next);
        setActive(-1);
      }}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      open={open}
      onOpenChange={setOpen}
      inputReserve={FILTER_INPUT_RESERVE_PX}
    >
      <ul className={styles.groupPickerList} role="listbox" aria-label={label} aria-multiselectable="true">
        {candidates.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              aria-selected={index === active}
              className={index === active ? styles.groupPickerActive : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => add(option.id)}
            >
              <span className={styles.assigneeOptionRow}>
                <span>{option.label}</span>
              </span>
              {option.hint ? <span className={styles.assigneeOptionHint}>{option.hint}</span> : null}
            </button>
          </li>
        ))}
        {candidates.length === 0 ? (
          <li className={styles.groupPickerEmpty}>{term.trim() ? emptyText : 'Đã chọn hết.'}</li>
        ) : null}
      </ul>
    </MultiSelectBox>
  );
}
