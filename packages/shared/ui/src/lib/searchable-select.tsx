'use client';

import {
  useEffect,
  useRef,
  useState,
  useId,
  useMemo,
  type ReactNode,
} from 'react';
import styles from './searchable-select.module.css';

export interface SearchableSelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly badge?: string;
  readonly disabled?: boolean;
}

export interface SearchableSelectProps {
  readonly options: readonly SearchableSelectOption[];
  readonly value?: string;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly name?: string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly clearable?: boolean;
  readonly onChange?: (value: string) => void;
  readonly renderOption?: (option: SearchableSelectOption, isSelected: boolean) => ReactNode;
}

/** Chuẩn hoá chuỗi tiếng Việt không dấu */
function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function SearchableSelect({
  options,
  value = '',
  placeholder = 'Tìm mã hoặc tên để chọn (hỗ trợ tiếng Việt không dấu)…',
  searchPlaceholder,
  emptyText = 'Không tìm thấy kết quả phù hợp',
  disabled = false,
  required = false,
  name,
  className,
  style,
  clearable = true,
  onChange,
  renderOption,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selectedOption = options.find((opt) => opt.value === value);

  // Đồng bộ giá trị hiển thị trên ô input khi đã chọn hoặc khi prop value đổi
  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption ? selectedOption.label : '');
    }
  }, [value, selectedOption, isOpen]);

  // Lọc theo từ khóa tìm kiếm (hỗ trợ tiếng Việt không dấu)
  const filteredOptions = useMemo(() => {
    if (!query.trim() || (selectedOption && query === selectedOption.label)) {
      return options;
    }
    const q = removeVietnameseTones(query.trim());
    return options.filter((opt) => {
      const labelMatch = removeVietnameseTones(opt.label).includes(q);
      const valueMatch = removeVietnameseTones(opt.value).includes(q);
      const descMatch = opt.description ? removeVietnameseTones(opt.description).includes(q) : false;
      return labelMatch || valueMatch || descMatch;
    });
  }, [options, query, selectedOption]);

  // Đóng dropdown khi click ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery(selectedOption ? selectedOption.label : '');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedOption]);

  // Tự động focus ô input khi mở dropdown
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(-1);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setQuery(selectedOption ? selectedOption.label : '');
    }
  }, [isOpen, selectedOption]);

  // Cuộn đến phần tử đang active bằng phím mũi tên
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll(`.${styles.optionItem}`);
      if (items[activeIndex]) {
        (items[activeIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  const handleSelect = (optionValue: string) => {
    onChange?.(optionValue);
    setIsOpen(false);
    const chosen = options.find((opt) => opt.value === optionValue);
    setQuery(chosen ? chosen.label : '');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.('');
    setQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        setIsOpen(true);
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
          const selected = filteredOptions[activeIndex];
          if (!selected.disabled) {
            handleSelect(selected.value);
          }
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setIsOpen(false);
        setQuery(selectedOption ? selectedOption.label : '');
        break;
      }
      case 'Tab': {
        setIsOpen(false);
        break;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className ?? ''}`}
      style={style}
    >
      {/* Hidden input để hỗ trợ form submission và HTML5 required validation */}
      {name ? (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required}
          aria-hidden="true"
        />
      ) : null}

      {/* Ô Input Combobox tương tác trực tiếp */}
      <div className={styles.inputWrapper}>
        <span className={styles.searchIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          className={`${styles.input} ${disabled ? styles.inputDisabled : ''}`}
          placeholder={isOpen ? (searchPlaceholder ?? placeholder) : placeholder}
          value={query}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />

        <div className={styles.actions}>
          {clearable && (query || value) && !disabled ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={handleClear}
              title="Xoá tìm kiếm"
              aria-label="Xoá tìm kiếm"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : null}

          <button
            type="button"
            className={styles.toggleButton}
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setIsOpen((prev) => !prev);
                if (!isOpen) inputRef.current?.focus();
              }
            }}
          >
            <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* Dropdown Menu kết quả */}
      {isOpen ? (
        <div className={styles.dropdown}>

          <ul
            id={`listbox-${id}`}
            role="listbox"
            ref={listRef}
            className={styles.optionsList}
          >
            {filteredOptions.length === 0 ? (
              <li className={styles.emptyState}>{emptyText}</li>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = opt.value === value;
                const isActive = index === activeIndex;

                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    className={`${styles.optionItem} ${isSelected ? styles.optionSelected : ''} ${
                      isActive ? styles.optionActive : ''
                    } ${opt.disabled ? styles.optionDisabled : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!opt.disabled) handleSelect(opt.value);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    {renderOption ? (
                      renderOption(opt, isSelected)
                    ) : (
                      <div className={styles.optionContent}>
                        <div className={styles.optionLabelRow}>
                          <span className={styles.optionText}>{opt.label}</span>
                          {opt.badge ? (
                            <span className={styles.optionBadge}>{opt.badge}</span>
                          ) : null}
                        </div>
                        {opt.description ? (
                          <span className={styles.optionDescription}>{opt.description}</span>
                        ) : null}
                      </div>
                    )}
                    {isSelected ? (
                      <span className={styles.checkIcon}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
