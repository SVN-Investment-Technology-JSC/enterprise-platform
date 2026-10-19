'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  useMemo,
  type CSSProperties,
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
  /** Chiều cao ô nhập (px). Mặc định 38; dùng 36/32 để thẳng hàng với Input h-9/h-8 cùng khu vực. */
  readonly height?: number;
  /**
   * Kiểu chọn thuần tuý: ô bên ngoài chỉ hiện giá trị đã chọn (con trỏ bấm, không gõ trực tiếp); ô tìm kiếm nằm trong danh sách
   * xổ ra. Mặc định (false) vẫn là gõ trực tiếp trên ô để lọc.
   */
  readonly searchInDropdown?: boolean;
  readonly clearable?: boolean;
  readonly onChange?: (value: string) => void;
  readonly renderOption?: (option: SearchableSelectOption, isSelected: boolean) => ReactNode;
}

/** Danh sách không hẹp hơn mức này, để nhãn dài vẫn đọc được trong ô hẹp. */
const DROPDOWN_MIN_WIDTH = 280;
/** Chiều cao tối đa của danh sách, như trước. */
const DROPDOWN_MAX_HEIGHT = 220;
/** Khoảng cách giữ với mép cửa sổ. */
const VIEWPORT_GAP = 8;

/**
 * Vị trí danh sách tính theo ô nhập trên màn hình.
 *
 * Danh sách dùng `position: fixed` theo toạ độ của ô, nên không còn bị cắt bởi
 * card, bảng hay hộp thoại có `overflow: hidden/auto` bao ngoài. Nó vẫn nằm
 * trong DOM của ô (không portal), để các hộp thoại và popover đang dùng
 * `contains()` để biết "bấm ra ngoài" không đóng nhầm khi chọn một mục.
 * Bên dưới không đủ chỗ mà bên trên rộng hơn thì lật lên trên.
 *
 * Khung bao có `transform`, `filter`, `backdrop-filter`, `contain`… thì `fixed`
 * tính theo khung đó chứ không theo cửa sổ (`origin`), nên trừ gốc của nó ra.
 */
function dropdownPlacement(
  anchor: DOMRect,
  origin: { x: number; y: number },
): { box: CSSProperties; listMaxHeight: number; origin: { x: number; y: number }; upward: boolean } {
  const width = Math.min(
    Math.max(anchor.width, DROPDOWN_MIN_WIDTH),
    window.innerWidth - VIEWPORT_GAP * 2,
  );
  const left = Math.min(
    Math.max(anchor.left, VIEWPORT_GAP),
    window.innerWidth - width - VIEWPORT_GAP,
  );
  const below = window.innerHeight - anchor.bottom - VIEWPORT_GAP;
  const above = anchor.top - VIEWPORT_GAP;
  const upward = below < 160 && above > below;
  const room = Math.max((upward ? above : below) - 4, 120);
  const box: CSSProperties = {
    position: 'fixed',
    left: left - origin.x,
    width,
    right: 'auto',
    // Lật lên: mép dưới danh sách bám mép trên ô, không cần biết danh sách cao bao nhiêu.
    top: (upward ? anchor.top - 4 : anchor.bottom + 4) - origin.y,
    bottom: 'auto',
    transform: upward ? 'translateY(-100%)' : undefined,
    zIndex: 10000,
  };
  return { box, listMaxHeight: Math.min(DROPDOWN_MAX_HEIGHT, room), origin, upward };
}

/** Giá trị CSS có hiệu lực: không rỗng (môi trường không hỗ trợ thuộc tính) và không phải `none`. */
const isSet = (value: string | undefined, unset = 'none'): boolean => Boolean(value) && value !== unset;

/**
 * Gốc toạ độ mà `position: fixed` thực sự dùng: (0, 0) của cửa sổ, hoặc góc
 * trong (đã tính cuộn) của khung bao gần nhất tạo khối chứa cho phần tử fixed.
 */
function fixedOrigin(from: HTMLElement | null): { x: number; y: number } {
  for (let el = from; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const establishes =
      isSet(cs.transform) ||
      // Thuộc tính riêng translate / rotate / scale (Tailwind v4: -translate-x-1/2, scale-95) cũng tạo khối chứa cho
      // phần tử fixed như `transform`; thiếu chúng thì danh sách trong hộp thoại bị lệch cả bề rộng hộp thoại.
      isSet(cs.translate) ||
      isSet(cs.rotate) ||
      isSet(cs.scale) ||
      isSet(cs.perspective) ||
      isSet(cs.filter) ||
      isSet(cs.backdropFilter) ||
      /paint|layout|strict|content/.test(cs.contain) ||
      /transform|translate|rotate|scale|perspective|filter/.test(cs.willChange);
    // `container-type` (Tailwind `@container`) không tạo khối chứa cho phần tử fixed trên trình duyệt hiện nay (chỉ
    // chứa style và inline-size, không có layout containment). Coi nó là khối chứa làm danh sách bị đẩy lệch cả một
    // đoạn bằng toạ độ của khung `@container`; trường hợp trình duyệt nào đó vẫn tính thì `useLayoutEffect` hiệu chỉnh.
    if (establishes) {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + el.clientLeft - el.scrollLeft,
        y: rect.top + el.clientTop - el.scrollTop,
      };
    }
  }
  return { x: 0, y: 0 };
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
  height,
  searchInDropdown = false,
  clearable = true,
  onChange,
  renderOption,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownSearchRef = useRef<HTMLInputElement>(null);
  // Từ khoá gõ trong ô tìm của danh sách (chỉ dùng khi searchInDropdown).
  const [dropdownQuery, setDropdownQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof dropdownPlacement>>();
  const correctionsRef = useRef(0);
  const id = useId();

  const selectedOption = options.find((opt) => opt.value === value);
  const selectedOptionLabelRef = useRef('');
  selectedOptionLabelRef.current = selectedOption ? selectedOption.label : '';

  // Đồng bộ giá trị hiển thị trên ô input khi đã chọn hoặc khi prop value đổi
  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption ? selectedOption.label : '');
    }
  }, [value, selectedOption, isOpen]);

  // Lọc theo từ khóa tìm kiếm (hỗ trợ tiếng Việt không dấu)
  const filteredOptions = useMemo(() => {
    const keyword = searchInDropdown ? dropdownQuery : query;
    if (!keyword.trim() || (!searchInDropdown && selectedOption && query === selectedOption.label)) {
      return options;
    }
    const q = removeVietnameseTones(keyword.trim());
    return options.filter((opt) => {
      const labelMatch = removeVietnameseTones(opt.label).includes(q);
      const valueMatch = removeVietnameseTones(opt.value).includes(q);
      const descMatch = opt.description ? removeVietnameseTones(opt.description).includes(q) : false;
      return labelMatch || valueMatch || descMatch;
    });
  }, [options, query, dropdownQuery, searchInDropdown, selectedOption]);

  // Đóng dropdown khi click ngoài (hỗ trợ cả mousedown và click ở pha capture để không bị dialog chặn)
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
        setQuery(selectedOptionLabelRef.current);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('click', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [isOpen]);

  // Esc khi dropdown đang mở chỉ đóng dropdown. Dialog/Drawer (base-ui, Radix) nghe Esc trên document
  // (có thể ở pha capture) nên stopPropagation ở pha bubble của React là quá muộn:
  // chặn sớm nhất có thể ở window (pha capture) và tự đóng dropdown tại đây.
  useEffect(() => {
    if (!isOpen) return;
    const handleEscapeCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setIsOpen(false);
      setQuery(selectedOptionLabelRef.current);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', handleEscapeCapture, true);
    return () => window.removeEventListener('keydown', handleEscapeCapture, true);
  }, [isOpen]);

  // Tự động focus ô input khi mở dropdown. Chỉ phụ thuộc isOpen: nếu phụ thuộc cả selectedOption thì mỗi lần
  // danh sách tuỳ chọn được tạo lại khi đang mở (parent render lại), chữ đang gõ bị bôi đen và ký tự tiếp theo
  // thay thế toàn bộ, nên ô tìm chỉ lọc theo đúng ký tự cuối.
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(-1);
      setDropdownQuery('');
      const timer = setTimeout(() => {
        if (searchInDropdown) {
          // Kiểu chọn thuần tuý: đưa con trỏ vào ô tìm trong danh sách, ô ngoài giữ nguyên giá trị đã chọn.
          dropdownSearchRef.current?.focus();
          return;
        }
        inputRef.current?.focus();
        // Bôi đen nhãn đang chọn: gõ vào là thay thế để tìm, không nối thêm
        // vào sau nhãn cũ (trước đây "Tất cả (30)" + "hieu luc" không lọc ra gì).
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
    setQuery(selectedOptionLabelRef.current);
    return undefined;
  }, [isOpen, searchInDropdown]);

  // Đặt danh sách theo ô nhập, và đặt lại khi trang hay khung chứa cuộn,
  // hoặc cửa sổ đổi cỡ, để nó luôn bám đúng ô.
  useLayoutEffect(() => {
    if (!isOpen) return;
    correctionsRef.current = 0;
    const place = () => {
      const container = containerRef.current;
      if (container) {
        correctionsRef.current = 0;
        setPlacement(dropdownPlacement(container.getBoundingClientRect(), fixedOrigin(container)));
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [isOpen]);

  // Hiệu chỉnh gốc toạ độ: đo vị trí thật của danh sách và so với chỗ cần đặt (mép dưới ô). Nếu khung bao nào đó
  // làm `fixed` tính theo gốc khác với suy luận ở `fixedOrigin`, độ lệch được cộng vào gốc rồi đặt lại.
  useLayoutEffect(() => {
    if (!isOpen || !placement) return;
    const box = dropdownRef.current;
    const container = containerRef.current;
    if (!box || !container) return;
    const wanted = dropdownPlacement(container.getBoundingClientRect(), { x: 0, y: 0 }).box;
    const actual = box.getBoundingClientRect();
    // Chưa có kích thước thật (chưa bố cục, hoặc môi trường không đo được): không hiệu chỉnh.
    if (actual.width === 0 && actual.height === 0) return;
    const dx = actual.left - (wanted.left as number);
    const dy = (placement.upward ? actual.bottom : actual.top) - (wanted.top as number);
    // Tối đa vài lần mỗi lần mở để không lặp vô hạn nếu có khung bao làm vị trí không hội tụ.
    if ((Math.abs(dx) > 1 || Math.abs(dy) > 1) && correctionsRef.current < 3) {
      correctionsRef.current += 1;
      setPlacement(
        dropdownPlacement(container.getBoundingClientRect(), {
          x: placement.origin.x + dx,
          y: placement.origin.y + dy,
        }),
      );
    }
  }, [isOpen, placement]);

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
    const chosen = options.find((opt) => opt.value === optionValue);
    if (chosen) {
      selectedOptionLabelRef.current = chosen.label;
    }
    onChange?.(optionValue);
    setIsOpen(false);
    setQuery(chosen ? chosen.label : '');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectedOptionLabelRef.current = '';
    onChange?.('');
    setQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || (searchInDropdown && e.key === ' ')) {
        e.preventDefault();
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
        // Khi dropdown đang mở, Esc chỉ đóng dropdown, không lan lên đóng Dialog/Drawer chứa nó.
        if (isOpen) e.stopPropagation();
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
      style={
        height && height < 38
          ? ({
              ...style,
              // Ô thấp hơn mặc định thì chữ và đệm dọc nhỏ lại theo (xem .input trong module css).
              '--ss-font-size': height <= 32 ? '12px' : '12.5px',
              '--ss-pad-y': '4px',
            } as React.CSSProperties)
          : style
      }
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

      {/* Ô Input Combobox tương tác trực tiếp (kiểu chọn thuần tuý: chỉ hiện giá trị, tìm trong danh sách) */}
      <div className={styles.inputWrapper}>
        {/* Kiểu chọn thuần tuý không có kính lúp ở ô ngoài. Không ẩn bằng `hidden`: `.searchIcon` đặt `display: flex`, nên
            app không có preflight Tailwind (`[hidden] { display: none !important }`) vẫn vẽ nó đè lên giá trị đã chọn. */}
        {searchInDropdown ? null : (
          <span className={styles.searchIcon}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          className={`${styles.input} ${searchInDropdown ? styles.inputSelectOnly : ''} ${disabled ? styles.inputDisabled : ''}`}
          style={height ? { height } : undefined}
          readOnly={searchInDropdown}
          placeholder={isOpen && !searchInDropdown ? (searchPlaceholder ?? placeholder) : placeholder}
          title={!isOpen && query ? query : undefined}
          value={query}
          disabled={disabled}
          onClick={() => {
            if (!disabled) setIsOpen(true);
          }}
          onChange={(e) => {
            if (searchInDropdown) return;
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
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled) {
                setIsOpen((prev) => !prev);
                if (!isOpen && !searchInDropdown) inputRef.current?.focus();
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

      {/* Dropdown Menu kết quả: fixed theo ô để không bị card hay hộp thoại cắt */}
      {isOpen && placement ? (
        <div
          ref={dropdownRef}
          className={`${styles.dropdown} ${placement.upward ? styles.dropdownUp : ''}`}
          style={placement.box}
        >
          {searchInDropdown ? (
            <div className={styles.dropdownSearch}>
              <span className={styles.dropdownSearchIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                ref={dropdownSearchRef}
                type="text"
                className={styles.dropdownSearchInput}
                aria-label="Tìm trong danh sách"
                placeholder={searchPlaceholder ?? 'Tìm kiếm…'}
                value={dropdownQuery}
                onChange={(e) => {
                  setDropdownQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>
          ) : null}
          <ul
            id={`listbox-${id}`}
            role="listbox"
            ref={listRef}
            className={styles.optionsList}
            style={{ maxHeight: placement.listMaxHeight }}
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
                    onMouseDown={(e) => {
                      // Ngăn mất focus của ô nhập và ngăn trình duyệt kích hoạt lại form control nếu nằm trong thẻ <label>
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
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
