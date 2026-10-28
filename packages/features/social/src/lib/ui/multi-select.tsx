'use client';

import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent } from './popover';
import styles from './multi-select.module.scss';

export interface MultiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface MultiSelectProps {
  readonly options: readonly MultiSelectOption[];
  /** Các giá trị đã chọn, theo thứ tự chọn. */
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
  /** Số mục tối đa; đủ rồi thì các mục chưa chọn bị khoá (mục đã chọn vẫn bỏ được). */
  readonly max?: number;
  readonly disabled?: boolean;
  readonly 'aria-label'?: string;
  /**
   * Có thì dưới danh sách hiện dòng thêm nhanh một mục: nhập tên, Enter hoặc bấm nút. Trả mục mới; ô tự chọn mục đó
   * (nếu chưa đủ `max`). Lỗi ném ra được hiện ngay dưới dòng nhập.
   */
  readonly onCreate?: (name: string) => Promise<MultiSelectOption>;
  readonly createPlaceholder?: string;
  readonly createLabel?: string;
  readonly createMaxLength?: number;
}

/** Cùng cỡ với các ô trong hộp soạn bài. */
const CREATE_CONTROL_CLASS = 'h-[38px] rounded-md px-3 text-[13.5px]!';

const norm = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

/**
 * Ô chọn nhiều mục kiểu Ant Design `Select mode="multiple"`: các mục đã chọn hiện thành thẻ ngay trong ô, danh sách xổ
 * ra có dấu tích ở từng mục, bấm mục để chọn hoặc bỏ mà danh sách vẫn mở. Có ô tìm (không phân biệt dấu); Esc chỉ
 * đóng danh sách, không đóng hộp thoại bên ngoài.
 */
export function MultiSelect({
  options,
  values,
  onChange,
  placeholder = 'Chọn',
  searchPlaceholder = 'Tìm…',
  emptyText = 'Không có mục nào',
  max,
  disabled = false,
  'aria-label': ariaLabel,
  onCreate,
  createPlaceholder = 'Tên mục mới',
  createLabel = 'Thêm',
  createMaxLength,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const labelOf = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const filtered = useMemo(() => {
    const needle = norm(query.trim());
    return needle ? options.filter((option) => norm(option.label).includes(needle)) : options;
  }, [options, query]);
  const full = max !== undefined && values.length >= max;
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Pha bắt: chặn Esc trước khi tới hộp thoại bên ngoài.
      event.stopImmediatePropagation();
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCreateError(undefined);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggle = (value: string) => {
    if (values.includes(value)) onChange(values.filter((item) => item !== value));
    else if (!full) onChange([...values, value]);
  };

  const create = async () => {
    const name = newName.trim();
    if (!onCreate || !name || creating) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const option = await onCreate(name);
      setNewName('');
      if (!values.includes(option.value) && !full) onChange([...values, option.value]);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Không thêm được.');
    } finally {
      setCreating(false);
    }
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (Math.min(current, filtered.length - 1) + step + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) toggle(option.value);
    } else if (event.key === 'Backspace' && query === '' && values.length > 0) {
      // Như Ant Design: Backspace khi ô tìm trống thì bỏ mục chọn cuối.
      onChange(values.slice(0, -1));
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // Tiêu điểm chuyển giữa ô tìm và danh sách không phải lý do để đóng.
        if (details.reason === 'focus-out') return;
        // Bấm đúng ô chọn thì để `onClick` của ô tự bật/tắt, tránh đóng rồi mở lại.
        if (details.reason === 'outside-press' && triggerRef.current?.contains(details.event.target as Node)) return;
        setOpen(false);
      }}
    >
      <div
        ref={triggerRef}
        className={styles.trigger}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-disabled={disabled || undefined}
        data-open={open || undefined}
        data-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKey}
      >
        <div className={styles.values}>
          {values.length === 0 ? <span className={styles.placeholder}>{placeholder}</span> : null}
          {values.map((value) => (
            <span key={value} className={styles.tag}>
              <span className={styles.tagLabel}>{labelOf.get(value) ?? value}</span>
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`Bỏ ${labelOf.get(value) ?? value}`}
                disabled={disabled}
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(value);
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
      </div>
      <PopoverContent
        anchor={triggerRef}
        side="bottom"
        align="start"
        sideOffset={4}
        finalFocus={false}
        className={styles.dropdown}
        // Không để cú bấm trong danh sách lan qua cây React tới lớp phủ của hộp thoại bên ngoài.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.search}>
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
        </div>
        {filtered.length === 0 ? (
          <p className={styles.empty}>{emptyText}</p>
        ) : (
          <ul id={listId} className={styles.list} role="listbox" aria-multiselectable="true">
            {filtered.map((option, index) => {
              const selected = values.includes(option.value);
              const locked = full && !selected;
              return (
                <li key={option.value} role="option" aria-selected={selected} aria-disabled={locked || undefined}>
                  <button
                    type="button"
                    className={styles.option}
                    data-selected={selected || undefined}
                    data-active={index === activeIndex || undefined}
                    disabled={locked}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      toggle(option.value);
                      searchRef.current?.focus();
                    }}
                  >
                    <span className={styles.optionLabel}>{option.label}</span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {onCreate ? (
          <>
            <hr className={styles.divider} />
            <div className={styles.add}>
              <Input
                className={`${CREATE_CONTROL_CLASS} ${styles.addInput}`}
                value={newName}
                maxLength={createMaxLength}
                placeholder={createPlaceholder}
                aria-label={createPlaceholder}
                disabled={creating}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void create();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                className={`${CREATE_CONTROL_CLASS} font-semibold`}
                disabled={!newName.trim() || creating}
                onClick={() => void create()}
              >
                <Plus size={14} aria-hidden="true" />
                {createLabel}
              </Button>
            </div>
            {createError ? (
              <p role="alert" className={styles.addError}>
                {createError}
              </p>
            ) : null}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
